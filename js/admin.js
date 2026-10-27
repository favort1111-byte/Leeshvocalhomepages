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
      if (opts.method && opts.method !== "GET") h.Prefer = "return=representation" + (opts.upsert ? ",resolution=merge-duplicates" : "");
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
      loadBase().then(function () { showTab("bookings"); countLinks(); });
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
    if (name === "records") loadRecords();
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
    $("#slotCancel").removeAttribute("data-armed");
    $("#slotCancel").textContent = "이 예약 취소";
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
    if (!b) return;
    var btn = this;
    if (btn.getAttribute("data-armed") !== "1") {
      btn.setAttribute("data-armed", "1");
      btn.textContent = "한 번 더 누르면 취소돼요";
      msg($("#slotMsg"), "학생에게는 따로 연락해주세요.");
      return;
    }
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
    api("members?select=id,name,phone,status,expires_on,memo,must_change_pin,kakao_user&order=id").then(function (res) {
      if (!res.ok) { msg($("#memberMsg"), friendly(res, "불러오지 못했습니다."), "error"); return; }
      state.members = res.data;
      renderMembers();
      loadLinks();
    });
  }

  /* 카카오 연결 요청: a student signed in with Kakao and said who they are; pick the 수강 ID and approve. */
  var WAITING = "status=eq." + encodeURIComponent("대기");
  function badge(n) {
    var b = $("#linkBadge");
    b.hidden = !n;
    b.textContent = n ? String(n) : "";
  }
  function countLinks() {
    api("link_requests?select=id&" + WAITING).then(function (res) { if (res.ok) badge(res.data.length); });
  }
  function loadLinks() {
    api("link_requests?select=*&" + WAITING + "&order=created_at").then(function (res) {
      if (!res.ok) return;
      badge(res.data.length);
      renderLinks(res.data);
    });
  }
  function renderLinks(list) {
    var box = $("#kakaoBox"), ul = $("#kakaoList");
    box.hidden = !list.length;
    ul.textContent = "";
    list.forEach(function (r) {
      var li = el("li", "adm__card");
      var top = el("div", "adm__cardtop");
      top.appendChild(el("strong", null, r.name));
      if (r.teacher) top.appendChild(el("span", null, r.teacher + " 선생님"));
      if (r.kakao_name) top.appendChild(el("span", "sys-note", "카카오 이름: " + r.kakao_name));
      top.appendChild(el("span", "sys-note", new Date(r.created_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })));
      li.appendChild(top);
      // same name first (and the teacher in the memo), then everyone still enrolled
      var name = r.name.replace(/\s/g, ""), teacher = (r.teacher || "").replace(/\s*\(.*\)/, "");
      var cands = state.members.filter(function (m) { return m.status !== "종료" && !m.kakao_user; }).map(function (m) {
        var score = (m.name.replace(/\s/g, "") === name ? 2 : 0) + (teacher && (m.memo || "").indexOf(teacher) !== -1 ? 1 : 0);
        return { m: m, score: score };
      }).sort(function (a, b) { return b.score - a.score || (a.m.id < b.m.id ? -1 : 1); });
      var row = el("div", "adm__cardrow");
      var sel = el("select");
      sel.setAttribute("aria-label", r.name + " 수강 ID 고르기");
      var none = el("option", null, "수강 ID 고르기");
      none.value = "";
      sel.appendChild(none);
      cands.forEach(function (c) {
        var o = el("option", null, (c.score >= 2 ? "★ " : "") + c.m.name + " (" + c.m.id + ")" + (c.m.memo ? " · " + c.m.memo : ""));
        o.value = c.m.id;
        sel.appendChild(o);
      });
      var best = cands.filter(function (c) { return c.score === cands[0].score && c.score >= 2; });
      if (best.length === 1) sel.value = best[0].m.id;
      var ok = el("button", "sys-btn", "승인");
      ok.type = "button";
      var no = el("button", "sys-link", "거절");
      no.type = "button";
      var note = el("p", "sys-msg");
      function decide(approve) {
        if (approve && !sel.value) { msg(note, "수강 ID를 골라주세요.", "error"); return; }
        ok.disabled = no.disabled = true;
        token().then(function (t) {
          return LeeshAPI.rpc("admin_kakao_decide", { p_request: r.id, p_member: approve ? sel.value : null, p_approve: approve }, t);
        }).then(function (res) {
          ok.disabled = no.disabled = false;
          if (!res.ok) { msg(note, res.error, "error"); return; }
          loadMembers();
        });
      }
      ok.addEventListener("click", function () { decide(true); });
      no.addEventListener("click", function () {
        if (no.getAttribute("data-armed") !== "1") { no.setAttribute("data-armed", "1"); no.textContent = "한 번 더 누르면 거절"; return; }
        decide(false);
      });
      row.appendChild(sel);
      row.appendChild(ok);
      row.appendChild(no);
      li.appendChild(row);
      li.appendChild(note);
      ul.appendChild(li);
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
    ["수강 ID", "이름", "전화번호", "상태", "기한", "메모", "로그인", ""].forEach(function (h) { head.appendChild(el("th", null, h)); });
    t.appendChild(el("thead")).appendChild(head);
    var body = t.appendChild(el("tbody"));
    if (!rows.length) {
      var tr = el("tr"), td = el("td", "sys-empty", state.members.length ? "검색 결과가 없습니다." : "아직 발급한 수강 ID가 없습니다.");
      td.colSpan = 8;
      tr.appendChild(td);
      body.appendChild(tr);
    }
    rows.forEach(function (m) {
      var tr = el("tr");
      [m.id, m.name, m.phone || "", m.status, m.expires_on || "", m.memo || ""].forEach(function (v, i) {
        var td = el("td", i === 3 ? "adm__status adm__status--" + m.status : null, v);
        tr.appendChild(td);
      });
      tr.appendChild(el("td", m.kakao_user ? "adm__kakao" : "sys-note", m.kakao_user ? "카카오" : m.must_change_pin ? "임시 비번(0000)" : "수강 ID"));
      var td = el("td");
      var b = el("button", "sys-link", "수정");
      b.type = "button";
      b.addEventListener("click", function () { openMember(m); });
      td.appendChild(b);
      if (m.kakao_user) {
        var u = el("button", "sys-link", "카카오 해제");
        u.type = "button";
        u.addEventListener("click", function () {
          if (u.getAttribute("data-armed") !== "1") { u.setAttribute("data-armed", "1"); u.textContent = "한 번 더 누르면 해제"; return; }
          token().then(function (t) { return LeeshAPI.rpc("admin_kakao_unlink", { p_member: m.id }, t); }).then(loadMembers);
        });
        td.appendChild(u);
      }
      tr.appendChild(td);
      body.appendChild(tr);
    });
  }

  function nextMemberId() {
    var n = state.members.reduce(function (max, m) {
      var hit = /^E(\d+)$/.exec(m.id);
      return hit ? Math.max(max, Number(hit[1])) : max;
    }, 0);
    return "E" + String(n + 1).padStart(3, "0");
  }

  function openMember(m) {
    var f = $("#memberForm");
    f.hidden = false;
    f.reset();
    msg($("#memberMsg"), "");
    f.dataset.editing = m ? "1" : "";
    $("#memberTitle").textContent = m ? m.name + " (" + m.id + ") 수정" : "새 수강 ID";
    $("#pinLabel").textContent = m ? "새 비밀번호 4자리 (바꿀 때만, 0000이면 학생이 다시 정해요)" : "비밀번호 4자리 (비우면 0000, 학생이 처음 로그인할 때 바꿔요)";
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
    if (!pin && !f.dataset.editing) pin = "0000"; // temporary: the student picks their own at first sign-in
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

  /* ---------------- 수업 기록 (레슨 노트 + 월말평가) ---------------- */

  function recMember() { return $("#recMember").value; }

  // 레슨 노트 switched off in js/config.js: the tab is just 월말평가 (the notes code and table stay)
  if (cfg.lessonNotes === false) {
    $("#noteForm").parentNode.hidden = true;
    $('[data-panel="records"] .adm__bar').hidden = true; // the student picker is for notes only
    $('[data-tab="records"]').textContent = "월말평가";
  }

  function loadRecords() {
    var sel = $("#recMember"), keep = sel.value;
    api("members?select=id,name,status,memo&order=id").then(function (res) {
      if (!res.ok) return;
      state.members = res.data; // 월말평가 올리기 matches names against these
      if (!evalMonth()) { // 평가는 3·6·9·12월: the latest one so far
        var t = todayKst(), y = Number(t.slice(0, 4)), q = Math.floor(Number(t.slice(5, 7)) / 3) * 3;
        if (!q) { y--; q = 12; }
        $("#evalMonth").value = y + "-" + String(q).padStart(2, "0");
      }
      loadEvalList();
      if (Object.keys(evalDraft).length) rebuildDraft();
      sel.textContent = "";
      res.data.filter(function (m) { return m.status !== "종료"; }).forEach(function (m) {
        var o = el("option", null, m.name + " (" + m.id + ")");
        o.value = m.id;
        o.setAttribute("data-name", m.name);
        sel.appendChild(o);
      });
      if (keep) sel.value = keep;
      var f = $("#noteForm");
      if (!field(f, "date").value) field(f, "date").value = todayKst();
      loadMemberRecords();
    });
  }

  function loadMemberRecords() {
    var id = recMember();
    var notes = $("#noteList");
    notes.textContent = "";
    if (!id) { notes.appendChild(el("li", "sys-empty", "수강 ID를 먼저 발급해주세요.")); return; }
    var q = "member_id=eq." + encodeURIComponent(id);
    api("lesson_notes?" + q + "&order=lesson_date.desc,id.desc&limit=50").then(function (res) {
      if (!res.ok) { notes.appendChild(el("li", "sys-msg sys-msg--error", friendly(res, "불러오지 못했습니다."))); return; }
      if (!res.data.length) notes.appendChild(el("li", "sys-empty", "아직 노트가 없어요."));
      res.data.forEach(function (n) {
        var li = el("li", "adm__card");
        var top = el("div", "adm__cardtop");
        top.appendChild(el("strong", null, n.lesson_date));
        if (n.teacher) top.appendChild(el("span", "sys-note", n.teacher));
        top.appendChild(deleteButton("lesson_notes", n.id, loadMemberRecords));
        li.appendChild(top);
        li.appendChild(el("p", "adm__quote", n.did));
        if (n.practice) li.appendChild(el("p", null, "연습: " + n.practice));
        notes.appendChild(li);
      });
    });
  }

  /** Delete takes a second tap, like cancelling a booking. */
  function deleteButton(table, id, after) {
    var b = el("button", "sys-link adm__del", "삭제");
    b.type = "button";
    b.addEventListener("click", function () {
      if (b.getAttribute("data-armed") !== "1") { b.setAttribute("data-armed", "1"); b.textContent = "한 번 더 누르면 삭제"; return; }
      api(table + "?id=eq." + id, { method: "DELETE" }).then(function (res) {
        if (!res.ok) { b.textContent = friendly(res, "삭제하지 못했습니다."); return; }
        after();
      });
    });
    return b;
  }



  $("#recMember").addEventListener("change", function () {
    $("#noteShare").hidden = true;
    $("#evalShare").hidden = true;
    loadMemberRecords();
  });

  /* ---------------- 카카오톡으로 보낼 주소 ---------------- */

  // Links straight into a screen (js/scene.js reads the #hash). Saved sign-ins open them without a login.
  var LINKS = [["레슨 노트", "#notes"], ["월말평가", "#evals"], ["연습실 예약", "booking.html"], ["상담 신청", "consult.html"]]
    .filter(function (l) { return cfg.lessonNotes !== false || l[1] !== "#notes"; });
  function siteLink(to) { return new URL(to.charAt(0) === "#" ? "./" + to : to, location.href).href; }
  function openHref(to) { return to.charAt(0) === "#" ? "index.html" + to : to; }

  /** Copy to the clipboard; if the browser refuses, select the text so it can be copied by hand. */
  function copyText(text, btn, box) {
    function done(ok) {
      var was = btn.textContent;
      btn.textContent = ok ? "복사했어요" : "길게 눌러 복사하세요";
      setTimeout(function () { btn.textContent = was; }, 1800);
      if (!ok && box) { box.focus(); box.select(); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } else done(false);
  }

  function linkRow(label, to) {
    var li = el("li");
    li.appendChild(el("b", null, label));
    li.appendChild(el("code", null, siteLink(to)));
    var copy = el("button", "sys-link", "주소 복사");
    copy.type = "button";
    copy.addEventListener("click", function () { copyText(siteLink(to), copy); });
    li.appendChild(copy);
    var a = el("a", "sys-link", "열어보기");
    a.href = openHref(to);
    a.target = "_blank";
    a.rel = "noopener";
    li.appendChild(a);
    return li;
  }
  LINKS.forEach(function (l) { $("#linkList").appendChild(linkRow(l[0], l[1])); });

  /** After saving a note or evaluation: a ready-to-send 카카오톡 message for that student. */
  function showShare(box, to, line) {
    var opt = $("#recMember").selectedOptions[0];
    var name = opt ? opt.getAttribute("data-name") : "";
    var text = "[이송희보컬레슨] " + name + "님, " + line + "\n👉 " + siteLink(to);
    box.textContent = "";
    box.appendChild(el("p", null, "학생에게 카톡으로 알려주세요."));
    var ta = el("textarea");
    ta.readOnly = true;
    ta.rows = 2;
    ta.value = text;
    box.appendChild(ta);
    var row = el("div", "adm__sharerow");
    var copy = el("button", "sys-btn", "문구 복사");
    copy.type = "button";
    copy.addEventListener("click", function () { copyText(text, copy, ta); });
    row.appendChild(copy);
    var a = el("a", "sys-link", "학생 화면으로 열어보기");
    a.href = openHref(to);
    a.target = "_blank";
    a.rel = "noopener";
    row.appendChild(a);
    box.appendChild(row);
    box.hidden = false;
  }

  $("#noteForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target;
    api("lesson_notes", { method: "POST", body: {
      member_id: recMember(), lesson_date: field(f, "date").value,
      teacher: field(f, "teacher").value.trim() || null,
      did: field(f, "did").value.trim(), practice: field(f, "practice").value.trim() || null
    } }).then(function (res) {
      if (!res.ok) { msg($("#noteMsg"), friendly(res), "error"); return; }
      msg($("#noteMsg"), "저장했어요. 학생 폴더에 바로 보여요.", "ok");
      showShare($("#noteShare"), "#notes", "오늘 레슨 노트가 올라왔어요.");
      field(f, "did").value = "";
      field(f, "practice").value = "";
      loadMemberRecords();
    });
  });

  /* ---------------- 월말평가 올리기 ----------------
     평가지 사진 (학생이름1.jpg, 학생이름2.jpg …) and/or the score table pasted from the
     "통합 결과" sheet → one row per student in eval_reports, pages in Storage eval-reports/<id>/<YYYY-MM>/<n>.webp */

  var EVAL_COLS = { name: ["학생명", "이름"], teacher: ["담당 트레이너", "담당", "선생님"], song: ["곡명", "곡"],
    basic: ["기본기"], technique: ["보컬 테크닉", "테크닉"], acting: ["액팅"], styling: ["스타일링"], total: ["총점"], stage: ["단계"] };
  var EVAL_ORDER = ["rank", "group", "name", "teacher", "song", "basic", "technique", "acting", "styling", "total", "stage"]; // the sheet's own order
  var evalDraft = {}; // name → { name, files: [{page, file}], score: {...}, member }

  function plain(t) { return String(t || "").replace(/\s+/g, ""); }
  function evalMonth() { return $("#evalMonth").value; }

  function parseScores(text) {
    var rows = text.split(/\r?\n/).map(function (l) { return l.split("\t").map(function (c) { return c.trim(); }); })
      .filter(function (r) { return r.some(Boolean); });
    var map = null, out = [];
    rows.forEach(function (r) {
      var hi = r.indexOf("학생명");
      if (hi !== -1 || r.indexOf("이름") !== -1) { // a header row: read the columns by their names
        map = {};
        Object.keys(EVAL_COLS).forEach(function (k) {
          var i = -1;
          EVAL_COLS[k].some(function (h) { i = r.indexOf(h); return i !== -1; });
          if (i !== -1) map[k] = i;
        });
        return;
      }
      var m = map;
      if (!m) { m = {}; EVAL_ORDER.forEach(function (k, i) { m[k] = i; }); if (!/^\d+$/.test(r[0])) EVAL_ORDER.slice(2).forEach(function (k, i) { m[k] = i; }); }
      var name = r[m.name];
      if (!name || name === "평균" || name === "합계") return;
      var sc = { name: name, teacher: r[m.teacher] || null, song: r[m.song] || null, stage: r[m.stage] || null };
      var okNum = true;
      ["basic", "technique", "acting", "styling", "total"].forEach(function (k) {
        var v = m[k] == null ? "" : String(r[m[k]] || "").replace(/[^0-9.]/g, "");
        sc[k] = v === "" ? null : Number(v);
        if (sc[k] != null && isNaN(sc[k])) okNum = false;
      });
      if (sc.total == null && sc.basic != null) sc.total = [sc.basic, sc.technique, sc.acting, sc.styling].reduce(function (a, b) { return a + (b || 0); }, 0);
      if (okNum && sc.total != null) out.push(sc);
    });
    return out;
  }

  /** The members a name could be: same name, then the teacher in the memo, then still enrolled. */
  function matchMember(name, teacher) {
    var n = plain(name), t = plain(teacher);
    var same = state.members.filter(function (m) { return plain(m.name) === n; });
    if (same.length > 1 && t) {
      var byT = same.filter(function (m) { return plain(m.memo).indexOf(t) !== -1; });
      if (byT.length) same = byT;
    }
    if (same.length > 1) {
      var live = same.filter(function (m) { return m.status !== "종료"; });
      if (live.length) same = live;
    }
    return { pick: same.length === 1 ? same[0].id : "", many: same.length > 1 };
  }

  function draftFor(name) {
    var key = plain(name);
    return evalDraft[key] || (evalDraft[key] = { name: name, files: [], score: null, member: "" });
  }

  /* PDF 평가지: js/vendor/pdfjs turns each page into a picture here in the browser, so students
     see the same pages as with photos. Which student a page belongs to: the file name if it is a
     student's name, otherwise the "학생명 ○○○" written on the page (one PDF can hold many students). */
  var pdfLib = null, pdfCache = new Map();
  var PDFJS = "js/vendor/pdfjs/";
  function loadPdfJs() {
    if (pdfLib) return pdfLib;
    pdfLib = new Promise(function (ok, fail) {
      var sc = document.createElement("script");
      sc.src = PDFJS + "pdf.min.js";
      sc.onload = function () { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js"; ok(window.pdfjsLib); };
      sc.onerror = function () { pdfLib = null; fail(new Error("pdf.js")); };
      document.head.appendChild(sc);
    });
    return pdfLib;
  }
  function isPdf(f) { return f.type === "application/pdf" || /\.pdf$/i.test(f.name); }
  function nameOnPage(items) {
    var words = items.map(function (it) { return String(it.str || "").trim(); }).filter(Boolean);
    var i = words.indexOf("학생명");
    if (i !== -1 && words[i + 1] && words[i + 1].length <= 20) return words[i + 1];
    var m = /([가-힣A-Za-z]{2,10})\s*학생\s*평가표/.exec(words.join(" "));
    return m ? m[1] : "";
  }
  function readPdf(f) {
    if (!pdfCache.has(f)) {
      pdfCache.set(f, loadPdfJs().then(function (lib) {
        return f.arrayBuffer().then(function (buf) {
          return lib.getDocument({ data: buf, cMapUrl: PDFJS + "cmaps/", cMapPacked: true }).promise;
        });
      }).then(function (doc) {
        var jobs = [];
        for (var n = 1; n <= doc.numPages; n++) {
          jobs.push(doc.getPage(n).then(function (pg) {
            return pg.getTextContent().then(function (tc) { return { page: pg, name: nameOnPage(tc.items) }; });
          }));
        }
        return Promise.all(jobs);
      }).catch(function () { return null; }));
    }
    return pdfCache.get(f);
  }
  function pagePicture(pg) {
    var v1 = pg.getViewport({ scale: 1 }), scale = Math.min(3, 1400 / v1.width), v = pg.getViewport({ scale: scale });
    var c = document.createElement("canvas");
    c.width = Math.round(v.width);
    c.height = Math.round(v.height);
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    return pg.render({ canvasContext: ctx, viewport: v }).promise.then(function () {
      return new Promise(function (done) {
        c.toBlob(function (b) {
          if (b && b.type === "image/webp") return done(b);
          c.toBlob(done, "image/jpeg", 0.85);
        }, "image/webp", 0.82);
      });
    });
  }
  function fileName(f) {
    var base = f.name.replace(/\.[^.]+$/, "");
    var hit = /^(.*?)[\s_\-(]*(\d+)\)?$/.exec(base);
    return { name: (hit && hit[1].trim()) || base, page: hit && hit[2] ? Number(hit[2]) : 0 };
  }

  var draftRun = 0;
  function rebuildDraft() {
    var run = ++draftRun, files = Array.prototype.slice.call($("#evalFiles").files || []);
    var pdfs = files.filter(isPdf);
    if (pdfs.length) msg($("#evalMsg"), "PDF 읽는 중…");
    return Promise.all(pdfs.map(readPdf)).then(function (read) {
      if (run !== draftRun) return; // a newer pick or paste is already being read
      evalDraft = {};
      var bad = [];
      files.filter(function (f) { return !isPdf(f); }).forEach(function (f) {
        var fn = fileName(f);
        draftFor(fn.name).files.push({ page: fn.page, make: function () { return shrink(f); } });
      });
      pdfs.forEach(function (f, k) {
        var pages = read[k];
        if (!pages) { bad.push(f.name); return; }
        var fn = fileName(f), whole = matchMember(fn.name).pick || state.members.some(function (m) { return plain(m.name) === plain(fn.name); });
        var cur = whole ? fn.name : "";
        pages.forEach(function (p, i) {
          if (!whole && p.name) cur = p.name;
          draftFor(cur || fn.name).files.push({ page: (fn.page || 0) * 100 + i + 1, make: function () { return pagePicture(p.page); } });
        });
      });
      if (pdfs.length) msg($("#evalMsg"), bad.length ? "읽지 못한 PDF: " + bad.join(", ") : "", bad.length ? "error" : "");
      finishDraft();
    });
  }

  function finishDraft() {
    parseScores($("#evalPaste").value).forEach(function (sc) { draftFor(sc.name).score = sc; });
    Object.keys(evalDraft).forEach(function (k) {
      var d = evalDraft[k];
      d.files.sort(function (a, b) { return a.page - b.page; });
      var mm = matchMember(d.name, d.score && d.score.teacher);
      d.member = mm.pick;
      d.many = mm.many;
    });
    renderDraft();
  }

  function renderDraft() {
    var box = $("#evalReview"), keys = Object.keys(evalDraft).sort(function (a, b) { return evalDraft[a].name < evalDraft[b].name ? -1 : 1; });
    box.textContent = "";
    var btn = $("#evalUpload");
    if (!keys.length) { btn.disabled = true; btn.textContent = "올리기"; return; }
    var wrap = el("div", "adm__tablewrap"), t = el("table", "adm__table adm__evaltable");
    var head = el("tr");
    ["학생", "수강 ID", "평가지", "총점", ""].forEach(function (h) { head.appendChild(el("th", null, h)); });
    t.appendChild(head);
    var sorted = state.members.slice().sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : (a.id < b.id ? -1 : 1); });
    keys.forEach(function (k) {
      var d = evalDraft[k], tr = el("tr");
      tr.appendChild(el("td", null, d.name));
      var td = el("td"), sel = el("select");
      sel.setAttribute("aria-label", d.name + " 수강 ID");
      var none = el("option", null, d.many ? "같은 이름이 여러 명 · 골라주세요" : "못 찾음 · 골라주세요");
      none.value = "";
      sel.appendChild(none);
      sorted.forEach(function (m) {
        var o = el("option", null, m.name + " (" + m.id + ")" + (m.memo ? " · " + m.memo : "") + (m.status === "종료" ? " · 종료" : ""));
        o.value = m.id;
        sel.appendChild(o);
      });
      sel.value = d.member;
      sel.addEventListener("change", function () { d.member = sel.value; tr.classList.toggle("is-miss", !sel.value); countDraft(); });
      tr.classList.toggle("is-miss", !d.member);
      td.appendChild(sel);
      tr.appendChild(td);
      tr.appendChild(el("td", null, d.files.length ? d.files.length + "장" : "–"));
      tr.appendChild(el("td", null, d.score ? String(d.score.total) + (d.score.stage ? " · " + d.score.stage : "") : "–"));
      var x = el("button", "sys-link", "빼기");
      x.type = "button";
      x.addEventListener("click", function () { delete evalDraft[k]; renderDraft(); });
      var tx = el("td");
      tx.appendChild(x);
      tr.appendChild(tx);
      t.appendChild(tr);
    });
    wrap.appendChild(t);
    box.appendChild(wrap);
    countDraft();
  }

  function countDraft() {
    var keys = Object.keys(evalDraft), ready = keys.filter(function (k) { return evalDraft[k].member; }).length;
    var btn = $("#evalUpload");
    btn.disabled = !ready || !evalMonth();
    btn.textContent = ready === keys.length ? ready + "명 올리기" : ready + "명 올리기 (" + (keys.length - ready) + "명은 수강 ID를 골라야 해요)";
  }

  /** Smaller pages for phones: at most 1400px wide, WebP (JPEG where the browser can't). */
  function shrink(file) {
    return new Promise(function (done) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var w = Math.min(1400, img.naturalWidth), h = Math.round(img.naturalHeight * w / img.naturalWidth);
        var c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) {
          if (b && b.type === "image/webp") return done(b);
          c.toBlob(function (j) { done(j || file); }, "image/jpeg", 0.85);
        }, "image/webp", 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(url); done(file); };
      img.src = url;
    });
  }

  function uploadOne(d, month, t) {
    var jobs = d.files.map(function (f, i) {
      return f.make().then(function (blob) { return LeeshAPI.storage.upload(d.member + "/" + month + "/" + (i + 1) + ".webp", blob, t); });
    });
    return Promise.all(jobs).then(function (oks) {
      if (oks.some(function (ok) { return !ok; })) return { ok: false, why: "사진 올리기 실패" };
      var body = { member_id: d.member, month: month + "-01", updated_at: new Date().toISOString() };
      if (d.files.length) body.pages = d.files.length;
      if (d.score) ["song", "teacher", "basic", "technique", "acting", "styling", "total", "stage"].forEach(function (k) { body[k] = d.score[k]; });
      return api("eval_reports?on_conflict=member_id,month", { method: "POST", upsert: true, body: body })
        .then(function (res) { return { ok: res.ok, why: res.ok ? "" : friendly(res, "저장 실패") }; });
    });
  }

  $("#evalFiles").addEventListener("change", function () { rebuildDraft(); });
  $("#evalPaste").addEventListener("input", function () { rebuildDraft(); });
  $("#evalMonth").addEventListener("change", function () { countDraft(); loadEvalList(); });

  $("#evalUpload").addEventListener("click", function () {
    var month = evalMonth(), btn = this;
    var list = Object.keys(evalDraft).map(function (k) { return evalDraft[k]; }).filter(function (d) { return d.member; });
    if (!month || !list.length) return;
    btn.disabled = true;
    var done = 0, failed = [];
    token().then(function (t) {
      // a few at a time so a phone on slow wifi doesn't choke
      var queue = list.slice();
      function next() {
        var d = queue.shift();
        if (!d) return Promise.resolve();
        return uploadOne(d, month, t).then(function (r) {
          done++;
          if (!r.ok) failed.push(d.name + " (" + r.why + ")");
          msg($("#evalMsg"), "올리는 중… " + done + " / " + list.length);
          return next();
        });
      }
      return Promise.all([next(), next(), next()]);
    }).then(function () {
      if (failed.length) msg($("#evalMsg"), (list.length - failed.length) + "명 올렸어요. 다시 해볼 학생: " + failed.join(", "), "error");
      else {
        msg($("#evalMsg"), list.length + "명 올렸어요. 학생 폴더에 바로 보여요.", "ok");
        showShare($("#evalShare"), "#evals", Number(month.slice(5, 7)) + "월 월말평가가 나왔어요.");
        $("#evalFiles").value = "";
        $("#evalPaste").value = "";
        rebuildDraft();
      }
      loadEvalList();
    });
  });

  function loadEvalList() {
    var ul = $("#evalList"), month = evalMonth();
    ul.textContent = "";
    if (!month) return;
    api("eval_reports?month=eq." + month + "-01&order=total.desc.nullslast").then(function (res) {
      if (!res.ok) { ul.appendChild(el("li", "sys-msg sys-msg--error", friendly(res, "불러오지 못했습니다."))); return; }
      if (!res.data.length) { ul.appendChild(el("li", "sys-empty", "아직 이 달에 올린 평가가 없어요.")); return; }
      var names = {};
      state.members.forEach(function (m) { names[m.id] = m.name; });
      res.data.forEach(function (r) {
        var li = el("li", "adm__card"), top = el("div", "adm__cardtop");
        top.appendChild(el("strong", null, (names[r.member_id] || r.member_id) + " (" + r.member_id + ")"));
        top.appendChild(el("span", null, r.total != null ? r.total + "점" + (r.stage ? " · " + r.stage : "") : "점수 없음"));
        top.appendChild(el("span", "sys-note", "평가지 " + (r.pages || 0) + "장"));
        var del = el("button", "sys-link adm__del", "삭제");
        del.type = "button";
        del.addEventListener("click", function () {
          if (del.getAttribute("data-armed") !== "1") { del.setAttribute("data-armed", "1"); del.textContent = "한 번 더 누르면 삭제"; return; }
          var paths = [];
          for (var n = 1; n <= 6; n++) paths.push(r.member_id + "/" + month + "/" + n + ".webp");
          token().then(function (t) { return LeeshAPI.storage.remove(paths, t); })
            .then(function () { return api("eval_reports?member_id=eq." + encodeURIComponent(r.member_id) + "&month=eq." + month + "-01", { method: "DELETE" }); })
            .then(loadEvalList);
        });
        top.appendChild(del);
        li.appendChild(top);
        if (r.song) li.appendChild(el("p", "sys-note", "♪ " + r.song));
        ul.appendChild(li);
      });
    });
  }

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
