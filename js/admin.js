// Admin page (admin.html): the owner signs in with a Supabase Auth account
// listed in public.admins, then reads/writes the tables directly. Row-level
// security in supabase/schema.sql is what actually guards the data.
(function () {
  var cfg = window.LEESH || {};
  var WD = ["일", "월", "화", "수", "목", "금", "토"];
  var SESSION_KEY = "leesh_admin";
  var session = null;
  var state = { settings: null, rooms: [], day: null, bookings: [], members: [], slot: null };

  function $(sel) { return document.querySelector(sel); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function msg(node, text, kind) {
    node.textContent = text || "";
    node.className = "sys-msg" + (kind ? " sys-msg--" + kind : "");
  }
  function field(f, n) { return f.querySelector("[name=" + n + "]"); }
  function hhmm(m) { return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); }
  function dayLabel(d) {
    var dt = new Date(d + "T00:00:00Z");
    return (dt.getUTCMonth() + 1) + "/" + dt.getUTCDate() + "(" + WD[dt.getUTCDay()] + ")";
  }
  function addDays(d, n) {
    var dt = new Date(d + "T00:00:00Z");
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  }
  function todayKst() {
    return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  }
  function stamp(iso) {
    var d = new Date(new Date(iso).getTime() + 9 * 3600000);
    return d.toISOString().slice(5, 16).replace("T", " ").replace("-", "/");
  }
  function friendly(res, fallback) {
    var m = res && res.data && res.data.message ? res.data.message : "";
    if (/bookings_no_room_overlap/.test(m)) return "이미 예약된 시간과 겹칩니다.";
    if (/bookings_no_member_overlap/.test(m)) return "이 수강생은 같은 시간에 다른 방을 예약했습니다.";
    if (/bookings_member_id_fkey/.test(m)) return "없는 수강 ID입니다.";
    if (/foreign key/.test(m)) return "예약 기록이 있어 지울 수 없습니다. '사용 안 함'으로 바꿔주세요.";
    if (/duplicate key/.test(m)) return "같은 이름이 이미 있습니다.";
    if (res && res.status === 0) return LeeshAPI.NETWORK_ERROR;
    return fallback || "저장하지 못했습니다. 다시 시도해주세요.";
  }

  /* ---------------- sign-in ---------------- */

  function saveSession(s) {
    session = s;
    try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }
  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { return null; }
  }

  function authCall(grant, body) {
    return LeeshAPI.request("/auth/v1/token?grant_type=" + grant, {
      method: "POST", headers: LeeshAPI.headers(), body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok || !res.data || !res.data.access_token) return null;
      var d = res.data;
      return {
        access: d.access_token, refresh: d.refresh_token,
        expires: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
        email: d.user && d.user.email
      };
    });
  }

  /** A valid access token, refreshing it when it is about to expire. */
  function token() {
    if (!session) return Promise.resolve(null);
    if (session.expires - 60 > Date.now() / 1000) return Promise.resolve(session.access);
    return authCall("refresh_token", { refresh_token: session.refresh }).then(function (s) {
      if (!s) { signOut("다시 로그인해주세요."); return null; }
      s.email = s.email || session.email;
      saveSession(s);
      return s.access;
    });
  }

  /** REST call as the signed-in admin. Resolves to { ok, status, data }. */
  function api(path, opts) {
    opts = opts || {};
    return token().then(function (t) {
      if (!t) return { ok: false, status: 401, data: null };
      var h = LeeshAPI.headers(t);
      if (opts.method && opts.method !== "GET") h.Prefer = "return=representation";
      return LeeshAPI.request("/rest/v1/" + path, {
        method: opts.method || "GET", headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined
      });
    });
  }

  function signOut(note) {
    saveSession(null);
    $("#app").hidden = true;
    $("#adminWho").hidden = true;
    $("#loginForm").hidden = false;
    msg($("#loginMsg"), note || "");
  }

  function enter() {
    api("rpc/is_admin", { method: "POST", body: {} }).then(function (res) {
      if (!res.ok || res.data !== true) {
        signOut(res.status === 0 ? LeeshAPI.NETWORK_ERROR : "관리자로 등록된 계정이 아닙니다.");
        return;
      }
      $("#loginForm").hidden = true;
      $("#app").hidden = false;
      $("#adminWho").hidden = false;
      $("#adminWho").textContent = session.email || "";
      loadBase().then(function () { showTab("bookings"); });
    });
  }

  $("#loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target, btn = f.querySelector("button");
    btn.disabled = true;
    msg($("#loginMsg"), "로그인 중…");
    authCall("password", { email: field(f, "email").value.trim(), password: field(f, "password").value }).then(function (s) {
      btn.disabled = false;
      if (!s) { msg($("#loginMsg"), "이메일 또는 비밀번호가 맞지 않습니다.", "error"); return; }
      saveSession(s);
      f.reset();
      msg($("#loginMsg"), "");
      enter();
    });
  });
  $("#logout").addEventListener("click", function () { signOut("로그아웃했습니다."); });

  /* ---------------- tabs ---------------- */

  function showTab(name) {
    document.querySelectorAll("[data-tab]").forEach(function (b) {
      b.setAttribute("aria-selected", b.getAttribute("data-tab") === name ? "true" : "false");
    });
    document.querySelectorAll("[data-panel]").forEach(function (p) { p.hidden = p.getAttribute("data-panel") !== name; });
    if (name === "bookings") loadDay(state.day || todayKst());
    if (name === "members") loadMembers();
    if (name === "consults") loadConsults();
    if (name === "settings") renderSettings();
  }
  document.querySelectorAll("[data-tab]").forEach(function (b) {
    b.addEventListener("click", function () { showTab(b.getAttribute("data-tab")); });
  });

  function loadBase() {
    return Promise.all([api("settings?id=eq.1"), api("rooms?order=sort,id")]).then(function (r) {
      if (r[0].ok && r[0].data[0]) state.settings = r[0].data[0];
      if (r[1].ok) state.rooms = r[1].data;
    });
  }

  /* ---------------- 예약 현황 ---------------- */

  function loadDay(day) {
    state.day = day;
    $("#dayPick").value = day;
    closeSlot();
    var grid = $("#grid");
    grid.textContent = "";
    api("bookings?select=id,room_id,member_id,start_min,end_min,memo,members(name,phone)&status=eq.%ED%99%95%EC%A0%95&day=eq." + day + "&order=start_min")
      .then(function (res) {
        if (!res.ok) { grid.appendChild(el("caption", "sys-msg sys-msg--error", friendly(res, "불러오지 못했습니다."))); return; }
        state.bookings = res.data;
        renderGrid();
      });
  }

  function renderGrid() {
    var s = state.settings, grid = $("#grid");
    var rooms = state.rooms.filter(function (r) { return r.active; });
    grid.textContent = "";
    grid.appendChild(el("caption", "sr-only", dayLabel(state.day) + " 예약 현황"));
    var head = el("tr");
    head.appendChild(el("th", null, dayLabel(state.day)));
    rooms.forEach(function (r) { head.appendChild(el("th", null, r.name)); });
    grid.appendChild(el("thead")).appendChild(head);
    var body = grid.appendChild(el("tbody"));
    var covered = {};
    for (var t = s.open_min; t < s.close_min; t += s.unit_min) {
      var tr = el("tr");
      tr.appendChild(el("th", null, hhmm(t)));
      rooms.forEach(function (room) {
        var key = room.id + ":" + t;
        if (covered[key]) return;
        var b = state.bookings.filter(function (x) { return x.room_id === room.id && x.start_min <= t && t < x.end_min; })[0];
        var td = el("td");
        var btn = el("button", "adm__cell");
        btn.type = "button";
        if (b) {
          var span = Math.ceil((b.end_min - Math.max(b.start_min, t)) / s.unit_min);
          for (var k = 1; k < span; k++) covered[room.id + ":" + (t + k * s.unit_min)] = true;
          td.rowSpan = span;
          btn.className += b.member_id ? " is-booked" : " is-blocked";
          btn.textContent = b.member_id ? (b.members ? b.members.name : b.member_id) : (b.memo || "학원 사용");
          btn.title = hhmm(b.start_min) + "~" + hhmm(b.end_min) + (b.memo ? " · " + b.memo : "");
          btn.addEventListener("click", openSlot.bind(null, room, t, b));
        } else {
          btn.setAttribute("aria-label", room.name + " " + hhmm(t) + " 비어 있음");
          btn.addEventListener("click", openSlot.bind(null, room, t, null));
        }
        td.appendChild(btn);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    }
  }

  function openSlot(room, t, b) {
    var f = $("#slotForm");
    state.slot = { room: room, t: t, booking: b };
    f.hidden = false;
    msg($("#slotMsg"), "");
    $("#slotNew").hidden = !!b;
    $("#slotExisting").hidden = !b;
    if (b) {
      $("#slotTitle").textContent = room.name + " · " + dayLabel(state.day) + " " + hhmm(b.start_min) + "~" + hhmm(b.end_min);
      $("#slotInfo").textContent = b.member_id
        ? (b.members ? b.members.name : "") + " (" + b.member_id + (b.members && b.members.phone ? " · " + b.members.phone : "") + ")" + (b.memo ? " · " + b.memo : "")
        : "학원 사용 · " + (b.memo || "");
    } else {
      $("#slotTitle").textContent = room.name + " · " + dayLabel(state.day) + " " + hhmm(t) + " 부터";
      var sel = field(f, "hours");
      sel.textContent = "";
      var s = state.settings;
      for (var end = t + 60; end <= s.close_min; end += 60) {
        var clash = state.bookings.some(function (x) { return x.room_id === room.id && x.start_min < end && t < x.end_min; });
        if (clash) break;
        var o = el("option", null, (end - t) / 60 + "시간 (~" + hhmm(end) + ")");
        o.value = end;
        sel.appendChild(o);
      }
      field(f, "member").value = "";
      field(f, "memo").value = "";
    }
    f.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function closeSlot() { $("#slotForm").hidden = true; state.slot = null; }
  $("#slotClose").addEventListener("click", closeSlot);

  $("#slotForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target, sl = state.slot;
    if (!sl || sl.booking) return;
    var member = field(f, "member").value.trim().toUpperCase();
    api("bookings", { method: "POST", body: {
      room_id: sl.room.id, member_id: member || null, day: state.day,
      start_min: sl.t, end_min: Number(field(f, "hours").value), memo: field(f, "memo").value.trim() || null
    } }).then(function (res) {
      if (!res.ok) { msg($("#slotMsg"), friendly(res), "error"); return; }
      loadDay(state.day);
    });
  });

  $("#slotCancel").addEventListener("click", function () {
    var b = state.slot && state.slot.booking;
    if (!b || !confirm("이 예약을 취소할까요? 학생에게는 따로 연락해주세요.")) return;
    api("bookings?id=eq." + b.id, { method: "PATCH", body: {
      status: "취소", cancelled_at: new Date().toISOString(), memo: (b.memo ? b.memo + " / " : "") + "관리자 취소"
    } }).then(function (res) {
      if (!res.ok) { msg($("#slotMsg"), friendly(res), "error"); return; }
      loadDay(state.day);
    });
  });

  $("#dayPick").addEventListener("change", function () { if (this.value) loadDay(this.value); });
  $("#dayPrev").addEventListener("click", function () { loadDay(addDays(state.day, -1)); });
  $("#dayNext").addEventListener("click", function () { loadDay(addDays(state.day, 1)); });
  $("#dayToday").addEventListener("click", function () { loadDay(todayKst()); });

  /* ---------------- 수강 ID ---------------- */

  function loadMembers() {
    api("members?select=id,name,phone,status,expires_on,memo&order=id").then(function (res) {
      if (!res.ok) { msg($("#memberMsg"), friendly(res, "불러오지 못했습니다."), "error"); return; }
      state.members = res.data;
      renderMembers();
    });
  }

  function renderMembers() {
    var q = $("#memberSearch").value.trim().toLowerCase();
    var st = $("#memberFilter").value;
    var rows = state.members.filter(function (m) {
      if (st && m.status !== st) return false;
      return !q || [m.id, m.name, m.phone || ""].join(" ").toLowerCase().indexOf(q) !== -1;
    });
    var t = $("#memberTable");
    t.textContent = "";
    var head = el("tr");
    ["수강 ID", "이름", "전화번호", "상태", "기한", "메모", ""].forEach(function (h) { head.appendChild(el("th", null, h)); });
    t.appendChild(el("thead")).appendChild(head);
    var body = t.appendChild(el("tbody"));
    if (!rows.length) {
      var tr = el("tr"), td = el("td", "sys-empty", state.members.length ? "검색 결과가 없습니다." : "아직 발급한 수강 ID가 없습니다.");
      td.colSpan = 7;
      tr.appendChild(td);
      body.appendChild(tr);
    }
    rows.forEach(function (m) {
      var tr = el("tr");
      [m.id, m.name, m.phone || "", m.status, m.expires_on || "", m.memo || ""].forEach(function (v, i) {
        var td = el("td", i === 3 ? "adm__status adm__status--" + m.status : null, v);
        tr.appendChild(td);
      });
      var td = el("td");
      var b = el("button", "sys-link", "수정");
      b.type = "button";
      b.addEventListener("click", function () { openMember(m); });
      td.appendChild(b);
      tr.appendChild(td);
      body.appendChild(tr);
    });
  }

  function nextMemberId() {
    var n = state.members.reduce(function (max, m) {
      var hit = /^S(\d+)$/.exec(m.id);
      return hit ? Math.max(max, Number(hit[1])) : max;
    }, 0);
    return "S" + String(n + 1).padStart(3, "0");
  }

  function openMember(m) {
    var f = $("#memberForm");
    f.hidden = false;
    f.reset();
    msg($("#memberMsg"), "");
    f.dataset.editing = m ? "1" : "";
    $("#memberTitle").textContent = m ? m.name + " (" + m.id + ") 수정" : "새 수강 ID";
    $("#pinLabel").textContent = m ? "새 비밀번호 4자리 (바꿀 때만)" : "비밀번호 4자리 (기본: 전화번호 뒤 4자리)";
    field(f, "id").readOnly = !!m;
    field(f, "id").value = m ? m.id : nextMemberId();
    if (m) {
      field(f, "name").value = m.name;
      field(f, "phone").value = m.phone || "";
      field(f, "status").value = m.status;
      field(f, "expires").value = m.expires_on || "";
      field(f, "memo").value = m.memo || "";
    }
    field(f, m ? "name" : "name").focus();
  }
  $("#memberAdd").addEventListener("click", function () { openMember(null); });
  $("#memberClose").addEventListener("click", function () { $("#memberForm").hidden = true; });
  $("#memberSearch").addEventListener("input", renderMembers);
  $("#memberFilter").addEventListener("change", renderMembers);

  $("#memberForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target;
    var pin = field(f, "pin").value.trim();
    if (!pin && !f.dataset.editing) pin = field(f, "phone").value.replace(/\D/g, "").slice(-4);
    var args = {
      p_id: field(f, "id").value, p_name: field(f, "name").value, p_phone: field(f, "phone").value,
      p_status: field(f, "status").value, p_expires_on: field(f, "expires").value || null,
      p_memo: field(f, "memo").value, p_pin: pin || null
    };
    token().then(function (t) { return LeeshAPI.rpc("admin_save_member", args, t); }).then(function (res) {
      if (!res.ok) { msg($("#memberMsg"), res.error, "error"); return; }
      msg($("#memberMsg"), res.created
        ? res.id + " 발급했습니다. 비밀번호: " + pin
        : res.id + " 저장했습니다." + (pin ? " 새 비밀번호: " + pin : ""), "ok");
      f.dataset.editing = "1";
      field(f, "id").readOnly = true;
      field(f, "pin").value = "";
      loadMembers();
    });
  });

  /* ---------------- 상담 신청 ---------------- */

  var CONSULT_STATES = ["접수", "연락완료", "등록", "보류", "취소"];

  function loadConsults() {
    var st = $("#consultFilter").value;
    var list = $("#consultList");
    list.textContent = "";
    api("consults?order=created_at.desc&limit=300" + (st ? "&status=eq." + encodeURIComponent(st) : "")).then(function (res) {
      if (!res.ok) { list.appendChild(el("li", "sys-msg sys-msg--error", friendly(res, "불러오지 못했습니다."))); return; }
      if (!res.data.length) { list.appendChild(el("li", "sys-empty", "해당하는 상담 신청이 없습니다.")); return; }
      res.data.forEach(function (c) { list.appendChild(consultCard(c)); });
    });
  }

  function consultCard(c) {
    var li = el("li", "adm__card");
    var top = el("div", "adm__cardtop");
    top.appendChild(el("strong", null, c.name));
    var tel = el("a", null, c.phone);
    tel.href = "tel:" + c.phone.replace(/\D/g, "");
    top.appendChild(tel);
    top.appendChild(el("span", "sys-note", stamp(c.created_at)));
    li.appendChild(top);
    li.appendChild(el("p", null, c.method + (c.wish ? " · 희망: " + c.wish : "") + (c.track ? " · " + c.track : "")));
    if (c.message) li.appendChild(el("p", "adm__quote", c.message));
    var row = el("div", "adm__cardrow");
    var sel = el("select");
    sel.setAttribute("aria-label", "상태");
    CONSULT_STATES.forEach(function (s) { var o = el("option", null, s); if (s === c.status) o.selected = true; sel.appendChild(o); });
    var memo = el("input");
    memo.placeholder = "메모";
    memo.value = c.memo || "";
    var save = el("button", "sys-btn", "저장");
    save.type = "button";
    var note = el("span", "sys-msg");
    save.addEventListener("click", function () {
      api("consults?id=eq." + c.id, { method: "PATCH", body: { status: sel.value, memo: memo.value.trim() || null } }).then(function (res) {
        msg(note, res.ok ? "저장했습니다." : friendly(res), res.ok ? "ok" : "error");
      });
    });
    row.appendChild(sel);
    row.appendChild(memo);
    row.appendChild(save);
    li.appendChild(row);
    li.appendChild(note);
    return li;
  }
  $("#consultFilter").addEventListener("change", loadConsults);

  /* ---------------- 설정 ---------------- */

  function renderSettings() {
    loadBase().then(function () {
      renderRooms();
      var s = state.settings, f = $("#rulesForm");
      field(f, "open").value = s.open_min / 60;
      field(f, "close").value = s.close_min / 60;
      field(f, "unit").value = String(s.unit_min);
      field(f, "max").value = s.max_minutes / 60;
      field(f, "daily").value = s.daily_max_minutes / 60;
      field(f, "days").value = s.max_days;
      field(f, "cancel").value = s.cancel_minutes;
      msg($("#rulesMsg"), "");
    });
  }

  function renderRooms() {
    var t = $("#roomTable");
    t.textContent = "";
    var head = el("tr");
    ["순서", "이름", "종류", "예약 받기", ""].forEach(function (h) { head.appendChild(el("th", null, h)); });
    t.appendChild(el("thead")).appendChild(head);
    var body = t.appendChild(el("tbody"));
    state.rooms.forEach(function (r) { body.appendChild(roomRow(r)); });
  }

  function roomRow(r) {
    var tr = el("tr");
    var sort = el("input"); sort.type = "number"; sort.value = r.sort; sort.className = "adm__num"; sort.setAttribute("aria-label", "순서");
    var name = el("input"); name.value = r.name; name.setAttribute("aria-label", "이름");
    var kind = el("input"); kind.value = r.kind; kind.setAttribute("aria-label", "종류");
    var active = el("input"); active.type = "checkbox"; active.checked = r.active; active.setAttribute("aria-label", "예약 받기");
    var save = el("button", "sys-link", "저장"); save.type = "button";
    [sort, name, kind, active].forEach(function (c) { var td = el("td"); td.appendChild(c); tr.appendChild(td); });
    var td = el("td"); td.appendChild(save); tr.appendChild(td);
    save.addEventListener("click", function () {
      var body = { sort: Number(sort.value) || 0, name: name.value.trim(), kind: kind.value.trim() || "연습실", active: active.checked };
      var req = r.id ? api("rooms?id=eq." + r.id, { method: "PATCH", body: body }) : api("rooms", { method: "POST", body: body });
      req.then(function (res) {
        msg($("#roomMsg"), res.ok ? body.name + " 저장했습니다." : friendly(res), res.ok ? "ok" : "error");
        if (res.ok) loadBase().then(renderRooms);
      });
    });
    return tr;
  }

  $("#roomAdd").addEventListener("click", function () {
    var body = $("#roomTable tbody");
    var row = roomRow({ id: null, sort: state.rooms.length + 1, name: "", kind: "연습실", active: true });
    body.appendChild(row);
    row.querySelector("input:not([type=number])").focus();
  });

  $("#rulesForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target;
    var body = {
      open_min: Number(field(f, "open").value) * 60,
      close_min: Number(field(f, "close").value) * 60,
      unit_min: Number(field(f, "unit").value),
      max_minutes: Number(field(f, "max").value) * 60,
      daily_max_minutes: Math.round(Number(field(f, "daily").value) * 60),
      max_days: Number(field(f, "days").value),
      cancel_minutes: Number(field(f, "cancel").value)
    };
    if (body.close_min <= body.open_min) { msg($("#rulesMsg"), "닫는 시각이 여는 시각보다 늦어야 합니다.", "error"); return; }
    api("settings?id=eq.1", { method: "PATCH", body: body }).then(function (res) {
      msg($("#rulesMsg"), res.ok ? "저장했습니다. 홈페이지에 바로 적용돼요." : friendly(res), res.ok ? "ok" : "error");
      if (res.ok) state.settings = res.data[0];
    });
  });

  /* ---------------- start ---------------- */

  if (!LeeshAPI.enabled()) { $("#adminOff").hidden = false; return; }
  session = loadSession();
  if (session) enter(); else $("#loginForm").hidden = false;
})();
