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
      $("#adminWho").textContent = (session.email || "") + " · ";
      // 보컬 오락실 (원장님 2026-11-10 "관리자도 게임하게"): 로그인을 새로 받은 뒤 넘어가요 (js/gate.js가 관리자 로그인을 확인)
      var play = el("a", "sys-link", "🎮 보컬 오락실");
      play.href = "games.html";
      play.addEventListener("click", function (e) {
        e.preventDefault();
        token().then(function () { location.href = "games.html"; });
      });
      $("#adminWho").appendChild(play);
      loadBase().then(function () { showTab("bookings"); countAll(); });
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
    if (name === "news") { loadNews(); loadIg(); loadIv(); }
    if (name === "notices") loadNotices();
    if (name === "songrecs") loadRecs();
    if (name === "visits") loadVisits();
    if (name === "journal") loadJournal();
    if (name === "reviews") loadReviews();
    if (name === "director") loadDirector();
    if (name === "feedback") loadFeedback();
    if (name === "adminlog") loadLog();
    if (name === "gameevent") loadGameEvent();
    if (name === "kakao") loadKakao();
    if (name === "partners") loadPartners();
    if (name === "teachers") { loadTeachers(); loadLessonSync(); }
    if (name === "records") loadRecords();
    if (name === "settings") renderSettings();
    if (name === "suggest") loadSuggest();
    if (name === "messages") loadMessages();
    if (name === "parents") loadParents();
  }
  document.querySelectorAll("[data-tab]").forEach(function (b) {
    b.addEventListener("click", function () { var t = b.getAttribute("data-tab"); showTab(t); markSeen(t); });
  });

  /* 새 소식 표시: 메뉴를 누르지 않아도 새로 들어온 게 있으면 메뉴에 빨간 숫자.
     - 처리할 일 (처리하면 사라짐): 수강 ID 연결 요청 · 상담 신청 접수 · 노래 추천 접수 · 제휴 신청 접수
     - 새로 들어온 것 (그 메뉴를 누르면 사라짐, 이 컴퓨터 기준): 연습실 예약 · 내방 신청 · 연습 일지 · 인스타그램 새 글
     2분마다, 그리고 이 창으로 돌아올 때 다시 셉니다. 브라우저 탭 제목에도 합계가 보여요. */
  var SEEN_KEY = "leesh-admin-seen";
  var NEW_SINCE = {
    bookings: ["#bookBadge", "bookings?select=id&created_at=gt."],
    visits: ["#visitBadge", "visit_applications?select=id&created_at=gt."],
    journal: ["#journalBadge", "practice_logs?select=id&created_at=gt."],
    reviews: ["#reviewBadge", "audition_reviews?select=id&created_at=gt."],
    news: ["#newsBadge", "ig_posts?select=id&hidden=is.false&posted_at=gt."]
  };
  function seenAll() { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function seenAt(tab) { return seenAll()[tab] || new Date(Date.now() - 3 * 86400000).toISOString(); }  // first time: the last 3 days
  function markSeen(tab) {
    if (!NEW_SINCE[tab]) return;
    var s = seenAll();
    s[tab] = new Date().toISOString();
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch (e) { /* private window: counts from 3 days back */ }
    setBadge(NEW_SINCE[tab][0], 0);
  }
  function setBadge(sel, n) {
    var b = $(sel);
    if (!b) return;
    b.textContent = n ? String(n) : "";
    b.hidden = !n;
    var total = 0;
    document.querySelectorAll(".adm__tabs .adm__badge").forEach(function (x) { total += x.hidden ? 0 : Number(x.textContent) || 0; });
    document.title = (total ? "(" + total + ") " : "") + document.title.replace(/^\(\d+\) /, "");
  }
  function countNew() {
    Object.keys(NEW_SINCE).forEach(function (tab) {
      api(NEW_SINCE[tab][1] + encodeURIComponent(seenAt(tab)) + "&limit=99").then(function (res) { if (res.ok) setBadge(NEW_SINCE[tab][0], res.data.length); });
    });
  }
  function countConsults() {
    api("consults?select=id&status=eq." + encodeURIComponent("접수")).then(function (res) { if (res.ok) setBadge("#consultBadge", res.data.length); });
  }
  function countAll() {
    if ($("#app").hidden) return;
    countLinks();
    countRecs();
    countPartners();
    countConsults();
    countTeachers();
    countParents();
    countInbox();
    countSuggest();
    countNew();
  }
  setInterval(countAll, 120000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) countAll(); });

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

  /* 구글시트 연결 (tools/sheet_sync.gs → sheet_sync_members): 상태 · 지금 가져오기 · 연결 열기 */
  function loadSheet() {
    var st = $("#sheetState"), now = $("#sheetNow");
    api("rpc/admin_sheet_status", { method: "POST", body: {} }).then(function (res) {
      var d = res.data || {};
      if (!res.ok || !d.ok) { msg(st, d.error || friendly(res, "불러오지 못했습니다."), "error"); return; }
      now.hidden = !d.webUrl;
      if (d.webUrl) now.href = d.webUrl;
      if (!d.connected) {
        var open = d.openUntil && new Date(d.openUntil) > new Date();
        msg(st, open ? "연결을 기다리는 중이에요 (" + stamp(d.openUntil) + "까지). 스크립트에서 \"처음_한번_설정\"을 실행해주세요."
                     : "아직 연결 전이에요. \"시트 연결 열기\"를 누른 뒤 30분 안에 스크립트를 설정해주세요.", open ? "" : "error");
        return;
      }
      var l = d.last || {};
      msg(st, d.lastAt ? "연결됨 · 마지막 반영 " + stamp(d.lastAt) + " · 새 학생 " + (l.added || 0) + " · 바뀐 학생 " + (l.changed || 0) +
        ((l.newTeachers || []).length ? " · 새 선생님 " + l.newTeachers.join(", ") : "") : "연결됨 · 아직 반영 전이에요.", "ok");
    });
  }
  $("#sheetNow").addEventListener("click", function () {
    // the web app opens in a new tab and sends the sheet; read the result back a little later
    msg($("#sheetState"), "시트에서 가져오는 중… (새 창에 결과가 나와요)");
    setTimeout(function () { loadSheet(); state.members = []; loadMembers(); }, 8000);
  });
  $("#sheetOpen").addEventListener("click", function () {
    var b = this;
    if (b.getAttribute("data-armed") !== "1") { b.setAttribute("data-armed", "1"); b.textContent = "한 번 더 누르면 열어요 (지금 연결은 끊겨요)"; return; }
    b.removeAttribute("data-armed");
    b.textContent = "시트 연결 열기";
    api("rpc/admin_sheet_open", { method: "POST", body: {} }).then(loadSheet);
  });

  function loadMembers() {
    loadSheet();
    api("members?select=id,name,phone,status,expires_on,memo,must_change_pin,kakao_user&order=id").then(function (res) {
      if (!res.ok) { msg($("#memberMsg"), friendly(res, "불러오지 못했습니다."), "error"); return; }
      state.members = res.data;
      renderMembers();
      loadLinks();
    });
  }

  /* 카카오 연결 요청: a student signed in with Kakao and said who they are; pick the 수강 ID and approve. */
  var WAITING = "status=eq." + encodeURIComponent("대기");
  function badge(n) { setBadge("#linkBadge", n); }
  var stuckN = 0, waitN = 0;
  function countLinks() {
    api("link_requests?select=id&" + WAITING).then(function (res) { if (res.ok) { waitN = res.data.length; badge(waitN + stuckN); } });
    token().then(function (t) { return LeeshAPI.rpc("admin_kakao_stuck", {}, t); }).then(function (res) {
      if (res && res.ok) { stuckN = (res.items || []).length; badge(waitN + stuckN); }
    });
  }
  function loadLinks() {
    api("link_requests?select=*&" + WAITING + "&order=created_at").then(function (res) {
      if (!res.ok) return;
      waitN = res.data.length;
      badge(waitN + stuckN);
      renderLinks(res.data);
    });
    loadStuck();
  }
  /* 연결 요청을 못 끝낸 카카오 계정: 이름을 안 보냈거나, 이메일 인증 전이라 로그인이 안 끝남 (2026-11-10) */
  function memberOptions(sel, kname) {
    var none = el("option", null, "수강 ID 고르기");
    none.value = "";
    sel.appendChild(none);
    var key = String(kname || "").replace(/[^가-힣a-zA-Z]/g, "");
    state.members.filter(function (m) { return m.status !== "종료" && !m.kakao_user; }).map(function (m) {
      var nm = m.name.replace(/\s/g, "");
      return { m: m, score: key && (nm === key || (key.length >= 2 && key.indexOf(nm) !== -1)) ? 2 : 0 };
    }).sort(function (a, b) { return b.score - a.score || (a.m.id < b.m.id ? -1 : 1); }).forEach(function (c) {
      var o = el("option", null, (c.score ? "★ " : "") + c.m.name + " (" + c.m.id + ")" + (c.m.memo ? " · " + c.m.memo : ""));
      o.value = c.m.id;
      sel.appendChild(o);
      if (c.score && !sel.getAttribute("data-auto")) { sel.value = c.m.id; sel.setAttribute("data-auto", "1"); }
    });
  }
  function loadStuck() {
    token().then(function (t) { return LeeshAPI.rpc("admin_kakao_stuck", {}, t); }).then(function (res) {
      var box = $("#stuckBox"), ul = $("#stuckList");
      if (!res || !res.ok) { box.hidden = true; return; }
      var items = res.items || [];
      stuckN = items.length;
      badge(waitN + stuckN);
      box.hidden = !items.length;
      ul.textContent = "";
      items.forEach(function (r) {
        var li = el("li", "adm__card");
        var top = el("div", "adm__cardtop");
        top.appendChild(el("strong", null, "카카오 이름: " + r.kakao_name));
        top.appendChild(el("span", "fold__tag" + (r.kind === "email" ? " adm__tag--warn" : ""), r.kind === "email" ? "이메일 인증 전 (로그인이 안 끝남)" : "이름을 안 보냄"));
        top.appendChild(el("span", "sys-note", "처음 로그인 " + new Date(r.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })));
        li.appendChild(top);
        var row = el("div", "adm__cardrow");
        var sel = el("select");
        sel.setAttribute("aria-label", r.kakao_name + " 수강 ID 고르기");
        memberOptions(sel, r.kakao_name);
        var go = el("button", "sys-btn", "바로 연결");
        go.type = "button";
        row.appendChild(sel);
        row.appendChild(go);
        var free = null;
        if (r.kind === "email") { free = el("button", "sys-link", "로그인 풀어주기"); free.type = "button"; row.appendChild(free); }
        var drop = el("button", "sys-link", "목록에서 빼기");
        drop.type = "button";
        row.appendChild(drop);
        li.appendChild(row);
        var note = el("p", "sys-msg");
        li.appendChild(note);
        function run(fn, args, done) {
          [go, drop, free].forEach(function (b) { if (b) b.disabled = true; });
          token().then(function (t) { return LeeshAPI.rpc(fn, args, t); }).then(function (res) {
            [go, drop, free].forEach(function (b) { if (b) b.disabled = false; });
            if (!res.ok) { msg(note, res.error, "error"); return; }
            done(res);
          });
        }
        go.addEventListener("click", function () {
          if (!sel.value) { msg(note, "수강 ID를 골라주세요.", "error"); return; }
          run("admin_kakao_attach", { p_user: r.user, p_member: sel.value }, function () { loadMembers(); });
        });
        if (free) free.addEventListener("click", function () {
          run("admin_kakao_confirm", { p_user: r.user }, function () {
            msg(note, "풀었어요. 학생이 다시 카카오로 로그인하면 이름 보내는 화면이 나와요.", "ok");
            free.remove();
          });
        });
        drop.addEventListener("click", function () {
          if (drop.getAttribute("data-armed") !== "1") { drop.setAttribute("data-armed", "1"); drop.textContent = "한 번 더 누르면 빼기"; return; }
          run("admin_kakao_ignore", { p_user: r.user }, function () { loadStuck(); });
        });
        ul.appendChild(li);
      });
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
      if (r.guardian) top.appendChild(el("span", "fold__tag", "부모님 계정 (만 14세 미만)"));
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
      if (st === "!종료" ? m.status === "종료" : st && m.status !== st) return false; // 원장님 2026-11-10: 처음엔 종료 숨김
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
      tr.appendChild(el("td", m.kakao_user ? "adm__kakao" : "sys-note", m.kakao_user ? "카카오" : "카카오 연결 전"));
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
        ? res.id + " 발급했습니다. 학생이 카카오로 로그인해서 연결 요청을 보내면 승인해주세요."
        : res.id + " 저장했습니다.", "ok");
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

  // 레슨 일지 칸 (js/config.js lessonFields, 선생님 화면과 같은 칸)
  // 칸마다 꾸미기 버튼 (js/richtext.js, 선생님 화면과 같음)
  var LFIELDS = cfg.lessonFields || [];
  // 선생님 화면과 같은 표 (js/grid.js): 새 일지는 A열에 칸 이름만 띄엄띄엄 적힌 표로 시작
  var noteBlank = JSON.stringify(LeeshGrid.template(LFIELDS).c);
  var noteGrid = LeeshGrid.editor({ data: LeeshGrid.template(LFIELDS) });
  $("#noteFields").appendChild(noteGrid.node);

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
      // 종료 학생도 지난 기록 · 월말평가를 볼 수 있게 맨 아래에 (원장님 2026-10-30)
      var gone = res.data.filter(function (m) { return m.status === "종료"; });
      if (gone.length) {
        var og = el("optgroup");
        og.label = "종료 (지난 기록 보기)";
        gone.forEach(function (m) {
          var o = el("option", null, m.name + " (" + m.id + ") · 종료");
          o.value = m.id;
          o.setAttribute("data-name", m.name);
          og.appendChild(o);
        });
        sel.appendChild(og);
      }
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
    // 지난 일지 전부 (원장님 2026-11-04: 예전엔 최근 50개만 보여서 오래된 수업이 안 보였음), 처음엔 20개 + 더 보기
    api("lesson_notes?" + q + "&order=lesson_date.desc,id.desc&limit=1000").then(function (res) {
      if (!res.ok) { notes.appendChild(el("li", "sys-msg sys-msg--error", friendly(res, "불러오지 못했습니다."))); return; }
      if (!res.data.length) notes.appendChild(el("li", "sys-empty", "아직 노트가 없어요."));
      else notes.appendChild(el("li", "sys-note", "지난 일지 " + res.data.length + "개 (최근 수업부터)"));
      var more = null;
      res.data.forEach(function (n, i) {
        var li = el("li", "adm__card");
        var top = el("div", "adm__cardtop");
        top.appendChild(el("strong", null, n.lesson_date));
        if (n.teacher) top.appendChild(el("span", "sys-note", n.teacher));
        if (n.src_file) top.appendChild(el("span", "adm__badge adm__badge--sheet", n.site_edited ? "구글시트 → 홈페이지에서 고침" : "구글시트에서"));
        top.appendChild(deleteButton("lesson_notes", n.id, loadMemberRecords));
        li.appendChild(top);
        li.appendChild(LeeshGrid.summary(n, LFIELDS));
        if (n.sheet) {  // 구글시트처럼 표로도 보기 (선생님 화면과 같은 모양)
          var grid = null, tg = el("button", "sys-link", "표로 보기");
          tg.type = "button";
          tg.addEventListener("click", function () {
            if (!grid) { grid = el("div", "adm__gridwrap"); grid.appendChild(LeeshGrid.view(n.sheet)); li.appendChild(grid); tg.textContent = "표 닫기"; }
            else { grid.hidden = !grid.hidden; tg.textContent = grid.hidden ? "표로 보기" : "표 닫기"; }
          });
          top.insertBefore(tg, top.lastChild);
        }
        if (i >= 20) li.hidden = true;
        notes.appendChild(li);
        if (i === 20) {
          more = el("li");
          var mb = el("button", "sys-btn", "더 보기 (" + (res.data.length - 20) + "개)");
          mb.type = "button";
          mb.addEventListener("click", function () {
            notes.querySelectorAll("li.adm__card[hidden]").forEach(function (x) { x.hidden = false; });
            more.remove();
          });
          more.appendChild(mb);
        }
      });
      if (more) notes.appendChild(more);
    });
    loadLessonSheets(id);
  }

  /* 곡·자료: 선생님 구글시트의 날짜 아닌 탭 (lesson_sheets, 보기만) */
  function loadLessonSheets(id) {
    var box = $("#lessonSheets");
    box.textContent = "";
    if (!id) return;
    api("lesson_sheets?member_id=eq." + encodeURIComponent(id) + "&select=id,title,pos,src_file,synced_at&order=src_file,pos").then(function (res) {
      if (!res.ok) { box.appendChild(el("p", "sys-msg sys-msg--error", friendly(res, "불러오지 못했습니다."))); return; }
      if (!res.data.length) { box.appendChild(el("p", "sys-empty", "아직 없어요.")); return; }
      var chips = el("div", "sys-chips"), view = el("div", "adm__sheetview");
      res.data.forEach(function (x) {
        var b = el("button", "sys-chip", x.title);
        b.type = "button";
        b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", function () {
          chips.querySelectorAll("button").forEach(function (y) { y.setAttribute("aria-pressed", y === b ? "true" : "false"); });
          view.textContent = "";
          view.appendChild(el("p", "sys-note", "불러오는 중…"));
          api("lesson_sheets?id=eq." + x.id + "&select=title,sheet,synced_at").then(function (r2) {
            view.textContent = "";
            var row = r2.ok && r2.data[0];
            if (!row) { view.appendChild(el("p", "sys-msg sys-msg--error", friendly(r2, "불러오지 못했습니다."))); return; }
            view.appendChild(el("p", "sys-note", row.title + " · 가져온 때 " + stamp(row.synced_at)));
            view.appendChild(LeeshGrid.view(row.sheet));
          });
        });
        chips.appendChild(b);
      });
      box.appendChild(chips);
      box.appendChild(view);
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
  var LINKS = [["레슨 노트", "#notes"], ["내 예약", "#bookings"], ["일정", "#plans"], ["공지", "#notices"], ["월말평가", "#evals"], ["노래 추천", "#recs"], ["영상 추천", "#videos"], ["연습 일지", "#logs"], ["제휴 업체", "#partners"], ["연습실 예약", "booking.html"], ["홈페이지 사용법", "guide.html"], ["상담 신청", "consult.html"]]
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
  /** A ready-to-paste KakaoTalk line; name only when it goes to one student (레슨 노트). */
  function showShare(box, to, line, name) {
    var text = "[이송희보컬레슨] " + (name ? name + "님, " : "") + line + "\n👉 " + siteLink(to);
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
    var body = { member_id: recMember(), lesson_date: field(f, "date").value, teacher: field(f, "teacher").value.trim() || null, rich: true };
    var sheet = noteGrid.get();
    if (!LeeshGrid.text(sheet) || JSON.stringify(sheet.c) === noteBlank) { msg($("#noteMsg"), "한 칸 이상 적어주세요.", "error"); return; }
    var long = noteGrid.over();
    if (long) { msg($("#noteMsg"), long + " 칸이 너무 길어요 (한 칸에 5000자까지).", "error"); return; }
    body.sheet = sheet;
    api("lesson_notes", { method: "POST", body: body }).then(function (res) {
      if (!res.ok) { msg($("#noteMsg"), friendly(res), "error"); return; }
      msg($("#noteMsg"), "저장했어요. 학생 폴더에 바로 보여요.", "ok");
      var opt = $("#recMember").selectedOptions[0];
      showShare($("#noteShare"), "#notes", "오늘 레슨 노트가 올라왔어요.", opt ? opt.getAttribute("data-name") : "");
      noteGrid.set(LeeshGrid.template(LFIELDS));
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

  function plain(t) { return String(t || "").normalize("NFC").replace(/\s+/g, ""); }
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
    var base = f.name.normalize("NFC").replace(/^.*[\/]/, "").replace(/\.[^.]+$/, "");
    var hit = /^(.*?)[\s_\-(]*(\d+)\)?$/.exec(base);
    return { name: (hit && hit[1].trim()) || base, page: hit && hit[2] ? Number(hit[2]) : 0 };
  }

  /* ZIP: 구글 드라이브에서 폴더나 여러 파일을 "다운로드"하면 zip 하나로 받아져요 (드라이브 화면에서 바로 끌어오기는
     브라우저가 막음). zip은 여기 브라우저 안에서 풀어 사진 · PDF만 꺼내요 (js/vendor/fflate, MIT). */
  var zipLib = null;
  function loadZip() {
    if (zipLib) return zipLib;
    zipLib = new Promise(function (ok, fail) {
      var sc = document.createElement("script");
      sc.src = "js/vendor/fflate/fflate.min.js";
      sc.onload = function () { ok(window.fflate); };
      sc.onerror = function () { zipLib = null; fail(new Error("fflate")); };
      document.head.appendChild(sc);
    });
    return zipLib;
  }
  function isZip(f) { return /zip/.test(f.type) || /\.zip$/i.test(f.name); }
  var KINDS = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", pdf: "application/pdf" };
  var unzipped = new WeakMap(); // 점수표를 고칠 때마다 다시 풀지 않게
  function unzip(f) {
    if (unzipped.has(f)) return unzipped.get(f);
    var job = Promise.all([loadZip(), f.arrayBuffer()]).then(function (r) {
      var all = r[0].unzipSync(new Uint8Array(r[1]), {
        filter: function (e) { return !/(^|\/)(__MACOSX|\.)/.test(e.name) && /\.(jpe?g|png|webp|heic|pdf)$/i.test(e.name); }
      });
      return Object.keys(all).map(function (name) {
        var base = name.replace(/^.*\//, "").normalize("NFC");
        return new File([all[name]], base, { type: KINDS[base.split(".").pop().toLowerCase()] || "" });
      });
    });
    unzipped.set(f, job);
    job.catch(function () { unzipped.delete(f); });
    return job;
  }
  // 고른 파일 + 끌어다 놓은 파일 (zip은 풀어서)
  var pickedFiles = [];
  function expandFiles() {
    var files = pickedFiles.length ? pickedFiles : Array.prototype.slice.call($("#evalFiles").files || []);
    var zips = files.filter(isZip);
    if (!zips.length) return Promise.resolve(files);
    msg($("#evalMsg"), "압축 파일 푸는 중…");
    return Promise.all(zips.map(function (z) { return unzip(z).catch(function () { return null; }); })).then(function (lists) {
      var out = files.filter(function (f) { return !isZip(f); }), bad = [];
      lists.forEach(function (l, i) { if (l) out = out.concat(l); else bad.push(zips[i].name); });
      msg($("#evalMsg"), bad.length ? "풀지 못한 압축 파일: " + bad.join(", ") : "", bad.length ? "error" : "");
      return out;
    });
  }

  var draftRun = 0;
  function rebuildDraft() {
    var run = ++draftRun;
    return expandFiles().then(function (files) {
      if (run !== draftRun) return;
      return buildDraft(run, files);
    });
  }
  function buildDraft(run, files) {
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

  $("#evalFiles").addEventListener("change", function () { pickedFiles = []; rebuildDraft(); });
  // 끌어다 놓기: 평가 올리기 칸 어디에 놓아도 돼요. 드라이브 화면에서 끌어오면 파일이 아니라 링크만 와서 안내해요.
  (function () {
    var zone = $("#evalBox .adm__drawer");
    if (!zone) return;
    ["dragenter", "dragover"].forEach(function (t) {
      zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.add("is-drop"); });
    });
    ["dragleave", "drop"].forEach(function (t) {
      zone.addEventListener(t, function () { zone.classList.remove("is-drop"); });
    });
    zone.addEventListener("drop", function (e) {
      e.preventDefault();
      var dt = e.dataTransfer, files = Array.prototype.slice.call((dt && dt.files) || []);
      if (!files.length) {
        var link = dt && (dt.getData("text/uri-list") || dt.getData("text/plain"));
        msg($("#evalMsg"), /drive\.google|docs\.google/.test(link || "")
          ? "드라이브 화면에서 바로 끌어오기는 안 돼요. 드라이브에서 파일(또는 폴더)을 골라 \"다운로드\"한 뒤, 받은 파일(zip)을 여기에 끌어다 놓아 주세요."
          : "파일을 끌어다 놓아 주세요.", "error");
        return;
      }
      pickedFiles = files;
      $("#evalFiles").value = "";
      rebuildDraft();
    });
  })();
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
        pickedFiles = [];
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
        // 학생 내 폴더에 보이는 것 그대로 (점수 4개 · 총점 · 단계 · 평가지 사진) — 올린 뒤 확인용 (원장님 2026-10-30)
        var look = el("button", "sys-link", "학생에게 보이는 모양 보기");
        look.type = "button";
        var box = el("div", "adm__evalview");
        box.hidden = true;
        look.addEventListener("click", function () {
          box.hidden = !box.hidden;
          look.textContent = box.hidden ? "학생에게 보이는 모양 보기" : "닫기";
          if (box.hidden || box.childNodes.length) return;
          // 학생 내 폴더와 같은 카드 (js/evalcard.js), 항목 옆 ▲▼도 똑같이 그 전 평가와 비교
          box.appendChild(el("p", "sys-note", "불러오는 중…"));
          api("eval_reports?member_id=eq." + encodeURIComponent(r.member_id) + "&month=lt." + month + "-01&order=month.desc&limit=1").then(function (pr) {
            box.textContent = "";
            var shown = Object.assign({}, r, { month: month });
            box.appendChild(LeeshEvalCard.card(shown, pr.ok && pr.data[0] || null, function (holder) {
              LeeshEvalCard.pages(holder, token().then(function (t) {
                var jobs = [];
                for (var n = 1; n <= r.pages; n++) jobs.push(LeeshAPI.storage.image(r.member_id + "/" + month + "/" + n + ".webp", t));
                return Promise.all(jobs);
              }));
            }));
          });
        });
        li.appendChild(look);
        li.appendChild(box);
        ul.appendChild(li);
      });
    });
  }

  /* ---------------- 오디션 소식 (audition.html; js/auditions.js shows them) ---------------- */

  var NEWS_KIND = { "내방": "학원 내방 오디션", "오디션": "기획사 오디션", "합격": "합격 소식" };
  var newsEdit = null; // the row being edited

  function newsForm(p) {
    var f = $("#newsForm");
    newsEdit = p || null;
    f.reset();
    if (p) {
      f.querySelector('[name=kind][value="' + p.kind + '"]').checked = true;
      ["company", "title", "event_date", "deadline", "body", "link", "initials"].forEach(function (k) { field(f, k).value = p[k] || ""; });
      if (p.pass_type) field(f, "pass_type").value = p.pass_type;
      if (p.pass_stage) field(f, "pass_stage").value = p.pass_stage;
    }
    $("#newsHead").textContent = p ? "소식 고치기" : "새 소식 올리기";
    $("#newsSave").textContent = p ? "고친 내용 저장" : "올리기";
    $("#newsCancel").hidden = !p;
    var now = $("#newsPosterNow");
    now.hidden = !(p && p.image);
    now.textContent = p && p.image ? "지금 포스터가 있어요. 새 사진을 고르면 바뀌어요." : "";
    newsLabel();
    if (p) f.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  function newsLabel() {
    var k = $("#newsForm").querySelector("[name=kind]:checked").value;
    $("#newsDateLabel").textContent = k === "합격" ? "발표 날짜 (선택, 비우면 오늘)" : "오디션 날짜 (선택)";
    // 합격: 종류·단계·이니셜 → about 합격 실적판 (js/passboard.js); the title can be left for the form to make
    $("#passFields").hidden = k !== "합격";
    $("#newsCompanyLabel").textContent = k === "합격" ? "회사 · 방송 · 학교 이름" : "회사 이름 (선택)";
    $("#newsTitleLabel").textContent = k === "합격" ? "제목 (비우면 \"1차 합격 (김OO)\"처럼 저절로)" : "제목";
  }
  document.querySelectorAll("#newsForm [name=kind]").forEach(function (r) { r.addEventListener("change", newsLabel); });
  $("#newsCancel").addEventListener("click", function () { newsForm(null); msg($("#newsMsg"), ""); });

  $("#newsForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target, btn = $("#newsSave");
    var body = { kind: f.querySelector("[name=kind]:checked").value, updated_at: new Date().toISOString() };
    ["company", "title", "event_date", "deadline", "body", "link"].forEach(function (k) { body[k] = field(f, k).value.trim() || null; });
    var pass = body.kind === "합격";
    body.pass_type = pass ? field(f, "pass_type").value : null;
    body.pass_stage = pass ? field(f, "pass_stage").value : null;
    body.initials = pass ? field(f, "initials").value.trim() || null : null;
    if (pass) {
      if (!body.company) { msg($("#newsMsg"), "회사 · 방송 · 학교 이름을 써주세요. 합격 실적판에 들어가요.", "error"); return; }
      if (body.initials && /^[가-힣]{2,4}$/.test(body.initials)) { msg($("#newsMsg"), "학생 이름은 이니셜로 써주세요 (예: 김OO).", "error"); return; }
      if (!body.title) body.title = body.pass_stage + (body.initials ? " (" + body.initials + ")" : "");
      if (!body.event_date) body.event_date = todayKst();
    }
    if (!body.title) { msg($("#newsMsg"), "제목을 써주세요.", "error"); return; }
    if (!newsEdit) body.published = true;
    if (body.link && !/^https?:\/\//.test(body.link)) { msg($("#newsMsg"), "링크는 https:// 로 시작해야 해요.", "error"); return; }
    btn.disabled = true;
    msg($("#newsMsg"), "올리는 중…");
    var file = field(f, "poster").files[0];
    var poster = file ? token().then(function (t) {
      var path = todayKst().slice(0, 7) + "/" + Date.now().toString(36) + ".webp";
      return shrink(file).then(function (blob) { return LeeshAPI.storage.uploadNews(path, blob, t); })
        .then(function (ok) { if (!ok) throw new Error("poster"); body.image = path; });
    }) : Promise.resolve();
    poster.then(function () {
      return newsEdit
        ? api("audition_news?id=eq." + newsEdit.id, { method: "PATCH", body: body })
        : api("audition_news", { method: "POST", body: body });
    }).then(function (res) {
      btn.disabled = false;
      if (!res.ok) { msg($("#newsMsg"), friendly(res), "error"); return; }
      msg($("#newsMsg"), newsEdit ? "고쳤어요. 홈페이지에 바로 보여요." : "올렸어요. 홈페이지 오디션 소식에 바로 보여요.", "ok");
      newsForm(null);
      loadNews();
    }, function () {
      btn.disabled = false;
      msg($("#newsMsg"), "포스터 사진을 올리지 못했어요. 다시 해보거나 사진 없이 올려주세요.", "error");
    });
  });

  function loadNews() {
    var ul = $("#newsList");
    ul.textContent = "";
    api("audition_news?select=*&order=created_at.desc&limit=200").then(function (res) {
      if (!res.ok) { ul.appendChild(el("li", "sys-msg sys-msg--error", friendly(res, "불러오지 못했습니다."))); return; }
      if (!res.data.length) { ul.appendChild(el("li", "sys-empty", "아직 올린 소식이 없어요. 블로그에서 가져온 소식만 보이고 있어요.")); return; }
      res.data.forEach(function (p) {
        var li = el("li", "adm__card" + (p.published ? "" : " is-hidden")), top = el("div", "adm__cardtop");
        top.appendChild(el("span", "adm__badge adm__badge--kind", NEWS_KIND[p.kind]));
        top.appendChild(el("strong", null, (p.company ? p.company + " · " : "") + p.title));
        if (p.event_date) top.appendChild(el("span", "sys-note", p.event_date));
        if (!p.published) top.appendChild(el("span", "sys-note", "숨김"));
        li.appendChild(top);
        if (p.body) li.appendChild(el("p", "adm__quote", p.body.length > 120 ? p.body.slice(0, 120) + "…" : p.body));
        var row = el("div", "adm__cardrow");
        var ed = el("button", "sys-link", "고치기");
        ed.type = "button";
        ed.addEventListener("click", function () { newsForm(p); });
        var hide = el("button", "sys-link", p.published ? "숨기기" : "다시 보이기");
        hide.type = "button";
        hide.addEventListener("click", function () {
          api("audition_news?id=eq." + p.id, { method: "PATCH", body: { published: !p.published, updated_at: new Date().toISOString() } }).then(loadNews);
        });
        row.appendChild(ed);
        row.appendChild(hide);
        row.appendChild(deleteButton("audition_news", p.id, loadNews));
        li.appendChild(row);
        ul.appendChild(li);
      });
    });
  }

  /* ---------------- 합격자 인터뷰 (interview.html + 첫 화면 팝업, public.interviews) ---------------- */

  var ivEdit = null;
  var IV_TEXT = ["company", "stage", "initials", "title", "songs", "tips", "styling", "body", "video"];
  function ivForm(p) {
    var f = $("#ivForm");
    ivEdit = p || null;
    f.reset();
    IV_TEXT.forEach(function (k) { field(f, k).value = p ? p[k] || "" : ""; });
    field(f, "posted_on").value = p ? p.posted_on : todayKst();
    $("#ivHead").textContent = p ? "인터뷰 고치기" : "합격자 인터뷰 올리기";
    $("#ivSave").textContent = p ? "고친 내용 저장" : "올리기";
    $("#ivCancel").hidden = !p;
    var now = $("#ivPhotoNow");
    now.hidden = !(p && p.image);
    now.textContent = p && p.image ? "지금 사진이 있어요. 새 사진을 고르면 바뀌어요." : "";
    if (p) f.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  $("#ivCancel").addEventListener("click", function () { ivForm(null); msg($("#ivMsg"), ""); });
  $("#ivForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target, btn = $("#ivSave");
    var body = { updated_at: new Date().toISOString(), posted_on: field(f, "posted_on").value || todayKst() };
    IV_TEXT.forEach(function (k) { body[k] = field(f, k).value.trim() || null; });
    if (!body.company || !body.title) { msg($("#ivMsg"), "기획사 이름과 제목을 써주세요.", "error"); return; }
    if (body.initials && /^[가-힣]{2,4}$/.test(body.initials)) { msg($("#ivMsg"), "학생 이름은 이니셜로 써주세요 (예: 김OO).", "error"); return; }
    if (body.video && !/^https:\/\//.test(body.video)) { msg($("#ivMsg"), "영상 주소는 https:// 로 시작해야 해요.", "error"); return; }
    btn.disabled = true;
    msg($("#ivMsg"), "올리는 중…");
    var file = field(f, "photo").files[0];
    var photo = file ? token().then(function (t) {
      var path = "interviews/" + Date.now().toString(36) + ".webp";
      return shrink(file).then(function (blob) { return LeeshAPI.storage.uploadNews(path, blob, t); })
        .then(function (ok) { if (!ok) throw new Error("photo"); body.image = path; });
    }) : Promise.resolve();
    photo.then(function () {
      return ivEdit ? api("interviews?id=eq." + ivEdit.id, { method: "PATCH", body: body })
        : api("interviews", { method: "POST", body: body });
    }).then(function (res) {
      btn.disabled = false;
      if (!res.ok) { msg($("#ivMsg"), friendly(res), "error"); return; }
      msg($("#ivMsg"), ivEdit ? "고쳤어요. 홈페이지에 바로 보여요." : "올렸어요. interview 페이지와 첫 화면 팝업에 바로 보여요.", "ok");
      ivForm(null);
      loadIv();
    }, function () {
      btn.disabled = false;
      msg($("#ivMsg"), "사진을 올리지 못했어요. 다시 해보거나 사진 없이 올려주세요.", "error");
    });
  });
  function loadIv() {
    var ul = $("#ivList");
    ul.textContent = "";
    if (!$("#ivForm").querySelector("[name=posted_on]").value) field($("#ivForm"), "posted_on").value = todayKst();
    api("interviews?select=*&order=posted_on.desc,id.desc&limit=100").then(function (res) {
      if (!res.ok) { ul.appendChild(el("li", "sys-msg sys-msg--error", friendly(res, "불러오지 못했습니다."))); return; }
      if (!res.data.length) { ul.appendChild(el("li", "sys-empty", "아직 올린 인터뷰가 없어요. 하나 올리면 첫 화면 팝업이 떠요.")); return; }
      res.data.forEach(function (p) {
        var li = el("li", "adm__card" + (p.published ? "" : " is-hidden")), top = el("div", "adm__cardtop");
        top.appendChild(el("span", "adm__badge adm__badge--kind", "인터뷰"));
        top.appendChild(el("strong", null, p.company + " · " + p.title));
        top.appendChild(el("span", "sys-note", p.posted_on));
        if (!p.published) top.appendChild(el("span", "sys-note", "숨김"));
        li.appendChild(top);
        var t = [p.stage, p.initials].filter(Boolean).join(" · ");
        if (t) li.appendChild(el("p", "sys-note", t));
        var row = el("div", "adm__cardrow");
        var ed = el("button", "sys-link", "고치기");
        ed.type = "button";
        ed.addEventListener("click", function () { ivForm(p); });
        var hide = el("button", "sys-link", p.published ? "숨기기" : "다시 보이기");
        hide.type = "button";
        hide.addEventListener("click", function () {
          api("interviews?id=eq." + p.id, { method: "PATCH", body: { published: !p.published, updated_at: new Date().toISOString() } }).then(loadIv);
        });
        row.appendChild(ed);
        row.appendChild(hide);
        row.appendChild(deleteButton("interviews", p.id, loadIv));
        li.appendChild(row);
        ul.appendChild(li);
      });
    });
  }

  /* ---------------- 인스타그램 → 오디션 소식 (ig_posts) ---------------- */

  var IG_KIND = { "내방": "학원 내방 오디션", "오디션": "기획사 오디션", "합격": "합격 소식", "소식": "학원 소식" };
  function igRpc(fn, args) { return token().then(function (t) { return LeeshAPI.rpc(fn, args || {}, t); }); }
  function igTitle(c) {
    var line = String(c || "").split("\n").map(function (x) { return x.trim(); }).filter(Boolean)[0] || "(글 없음)";
    return line.length > 60 ? line.slice(0, 60) + "…" : line;
  }
  function loadIg() {
    igRpc("admin_instagram_status").then(function (st) {
      if (!st.ok) { $("#igStatus").textContent = st.error || "상태를 불러오지 못했어요."; return; }
      $("#igForm").hidden = st.connected;
      $("#igReconnect").hidden = !st.connected;
      $("#igSync").hidden = !st.connected;
      $("#igStatus").textContent = st.connected
        ? "연결됨 · 가져온 글 " + st.count + "개" + (st.lastSync ? " · 마지막으로 가져온 때 " + stamp(st.lastSync) : "") + (st.error ? " · 최근 오류가 있었어요 (토큰을 다시 넣어보세요)" : "")
        : "아직 연결 안 됨. 아래에 토큰을 붙여넣으면 오디션반 인스타 글이 오디션 소식에 들어가요.";
    });
    var ul = $("#igList");
    ul.textContent = "";
    api("ig_posts?select=id,posted_at,caption,kind,hidden,permalink&order=posted_at.desc&limit=80").then(function (res) {
      if (!res.ok) return;
      if (!res.data.length) { ul.appendChild(el("li", "sys-empty", "아직 가져온 글이 없어요.")); return; }
      res.data.forEach(function (p) {
        var li = el("li", "adm__card" + (p.hidden ? " is-hidden" : "")), top = el("div", "adm__cardtop");
        top.appendChild(el("span", "sys-note", stamp(p.posted_at)));
        top.appendChild(el("strong", null, igTitle(p.caption)));
        li.appendChild(top);
        var row = el("div", "adm__cardrow");
        var sel = el("select");
        sel.setAttribute("aria-label", "칸");
        Object.keys(IG_KIND).forEach(function (k) { var o = el("option", null, IG_KIND[k]); o.value = k; sel.appendChild(o); });
        sel.value = p.kind;
        sel.addEventListener("change", function () {
          api("ig_posts?id=eq." + p.id, { method: "PATCH", body: { kind: sel.value, kind_fixed: true } }).then(function (r) {
            msg($("#igMsg"), r.ok ? "칸을 옮겼어요." : friendly(r), r.ok ? "ok" : "error");
          });
        });
        row.appendChild(sel);
        var hide = el("button", "sys-link", p.hidden ? "다시 보이기" : "숨기기");
        hide.type = "button";
        hide.addEventListener("click", function () {
          api("ig_posts?id=eq." + p.id, { method: "PATCH", body: { hidden: !p.hidden } }).then(loadIg);
        });
        row.appendChild(hide);
        if (p.permalink) {
          var a = el("a", "sys-link", "인스타에서 보기 ↗");
          a.href = p.permalink;
          a.target = "_blank";
          a.rel = "noopener";
          row.appendChild(a);
        }
        li.appendChild(row);
        ul.appendChild(li);
      });
    });
  }
  $("#igForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target, btn = $("#igConnect");
    btn.disabled = true;
    msg($("#igMsg"), "연결하고 최근 글을 가져오는 중이에요. 1분쯤 걸릴 수 있어요…");
    igRpc("admin_instagram_connect", { p_token: field(f, "token").value }).then(function (r) {
      btn.disabled = false;
      if (!r.ok) { msg($("#igMsg"), r.error === LeeshAPI.NETWORK_ERROR ? r.error : (r.error || "연결하지 못했어요.") + " 토큰을 다시 만들어 붙여넣어 주세요.", "error"); loadIg(); return; }
      f.reset();
      msg($("#igMsg"), "연결했어요. 인스타 글 " + r.count + "개를 가져왔어요. 오디션 소식에 바로 보여요.", "ok");
      loadIg();
    });
  });
  $("#igSync").addEventListener("click", function () {
    var b = $("#igSync");
    b.disabled = true;
    igRpc("admin_instagram_sync").then(function (r) {
      b.disabled = false;
      msg($("#igMsg"), r.ok ? "새로 가져왔어요 (최근 " + r.count + "개 확인)." : (r.error || "가져오지 못했어요."), r.ok ? "ok" : "error");
      loadIg();
    });
  });
  $("#igReconnect").addEventListener("click", function () { $("#igForm").hidden = false; field($("#igForm"), "token").focus(); });

  /* ---------------- 공지 (학생 "내 폴더 → 공지"; js/mynotes.js) ---------------- */

  var noticeEdit = null;
  function noticeForm(p) {
    var f = $("#noticeForm");
    noticeEdit = p || null;
    f.reset();
    if (p) {
      ["title", "start_date", "end_date", "body"].forEach(function (k) { field(f, k).value = p[k] || ""; });
      field(f, "pinned").checked = !!p.pinned;
      f.scrollIntoView({ block: "start", behavior: "smooth" });
    }
    $("#noticeHead").textContent = p ? "공지 고치기" : "새 공지 쓰기";
    $("#noticeSave").textContent = p ? "고친 내용 저장" : "올리기";
    $("#noticeCancel").hidden = !p;
  }
  $("#noticeCancel").addEventListener("click", function () { noticeForm(null); msg($("#noticeMsg"), ""); });
  $("#noticeForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target, body = { updated_at: new Date().toISOString(), pinned: field(f, "pinned").checked };
    ["title", "start_date", "end_date", "body"].forEach(function (k) { body[k] = field(f, k).value.trim() || null; });
    if (!body.title) { msg($("#noticeMsg"), "제목을 써주세요.", "error"); return; }
    if (!noticeEdit) body.published = true;
    (noticeEdit ? api("notices?id=eq." + noticeEdit.id, { method: "PATCH", body: body }) : api("notices", { method: "POST", body: body }))
      .then(function (res) {
        if (!res.ok) { msg($("#noticeMsg"), friendly(res), "error"); return; }
        var wasNew = !noticeEdit;
        msg($("#noticeMsg"), wasNew ? "올렸어요. 학생 내 폴더 → 일정(날짜가 있으면) · 공지에 바로 보여요." : "고쳤어요.", "ok");
        noticeForm(null); // (reset first: the share box sits inside the form)
        if (wasNew) showShare($("#noticeShare"), "#notices", "새 공지가 올라왔어요: " + body.title);
        loadNotices();
      });
  });
  function loadNotices() {
    var ul = $("#noticeList");
    ul.textContent = "";
    api("notices?select=*&order=created_at.desc&limit=200").then(function (res) {
      if (!res.ok) { ul.appendChild(el("li", "sys-msg sys-msg--error", friendly(res, "불러오지 못했습니다."))); return; }
      if (!res.data.length) { ul.appendChild(el("li", "sys-empty", "아직 올린 공지가 없어요.")); return; }
      var today = todayKst();
      res.data.forEach(function (p) {
        var over = p.end_date && p.end_date < today;
        var li = el("li", "adm__card" + (p.published && !over ? "" : " is-hidden")), top = el("div", "adm__cardtop");
        if (p.pinned) top.appendChild(el("span", "adm__badge adm__badge--kind", "중요"));
        top.appendChild(el("strong", null, p.title));
        if (p.start_date) top.appendChild(el("span", "sys-note", p.start_date + (p.end_date ? " ~ " + p.end_date : "")));
        if (!p.published) top.appendChild(el("span", "sys-note", "숨김"));
        else if (over) top.appendChild(el("span", "sys-note", "기간 끝남"));
        li.appendChild(top);
        if (p.body) li.appendChild(el("p", "adm__quote", p.body.length > 120 ? p.body.slice(0, 120) + "…" : p.body));
        var row = el("div", "adm__cardrow");
        var ed = el("button", "sys-link", "고치기");
        ed.type = "button";
        ed.addEventListener("click", function () { noticeForm(p); });
        var hide = el("button", "sys-link", p.published ? "숨기기" : "다시 보이기");
        hide.type = "button";
        hide.addEventListener("click", function () {
          api("notices?id=eq." + p.id, { method: "PATCH", body: { published: !p.published, updated_at: new Date().toISOString() } }).then(loadNotices);
        });
        row.appendChild(ed);
        row.appendChild(hide);
        row.appendChild(deleteButton("notices", p.id, loadNotices));
        li.appendChild(row);
        ul.appendChild(li);
      });
    });
  }

  /* ---------------- 내방 오디션 신청서 (visit_applications; apply.html) ---------------- */

  var visitRows = [];
  function loadVisits() {
    var sel = $("#visitPick"), keep = sel.value;
    api("audition_news?select=id,company,title,event_date,deadline&kind=eq." + encodeURIComponent("내방") + "&order=event_date.desc.nullslast,id.desc&limit=60").then(function (res) {
      sel.textContent = "";
      if (!res.ok || !res.data.length) {
        $("#visitBox").textContent = "";
        $("#visitBox").appendChild(el("p", "sys-empty", "아직 올린 학원 내방 오디션이 없어요. 오디션 소식 탭에서 \"학원 내방 오디션\"을 올리면 신청서가 열려요."));
        return;
      }
      res.data.forEach(function (n) {
        var o = el("option", null, (n.event_date ? n.event_date + " · " : "") + (n.company ? n.company + " " : "") + n.title);
        o.value = n.id;
        sel.appendChild(o);
      });
      if (keep && res.data.some(function (n) { return String(n.id) === keep; })) sel.value = keep;
      else {  // the next audition coming up, else the latest
        var t = todayKst(), up = res.data.filter(function (n) { return (n.event_date || "9") >= t; }).pop();
        sel.value = (up || res.data[0]).id;
      }
      loadVisitList();
    });
  }
  function loadVisitList() {
    var box = $("#visitBox"), id = $("#visitPick").value;
    box.textContent = "";
    if (!id) return;
    api("visit_applications?select=*&news_id=eq." + id + "&order=created_at").then(function (res) {
      if (!res.ok) { box.appendChild(el("p", "sys-msg sys-msg--error", friendly(res, "불러오지 못했습니다."))); return; }
      visitRows = res.data;
      if (!res.data.length) { box.appendChild(el("p", "sys-empty", "아직 신청이 없어요.")); return; }
      var count = {};
      res.data.forEach(function (a) { count[a.field] = (count[a.field] || 0) + 1; });
      box.appendChild(el("p", "sys-note", "신청 " + res.data.length + "명 · " + Object.keys(count).map(function (k) { return k + " " + count[k]; }).join(" · ")));
      var ul = el("ul", "adm__cards");
      res.data.forEach(function (a, i) {
        // 원장님이 정한 순서 (2026-10-28): 이름 · 성별 · 출생년도/나이 · 키/몸무게 · 지원분야 · 특이사항 · 댄스음원 · 신청 시간
        var li = el("li", "adm__card"), top = el("div", "adm__cardtop");
        top.appendChild(el("strong", null, (i + 1) + "번"));
        li.appendChild(top);
        var dl = el("dl", "adm__visit");
        var row = el("div", "adm__cardrow");
        function line(label, value) {
          dl.appendChild(el("dt", null, label));
          var dd = el("dd", null, value == null || value === "" ? "-" : value);
          dl.appendChild(dd);
          return dd;
        }
        line("이름", a.name);
        line("성별", a.gender);
        line("출생년도/나이", a.birth);
        line("키/몸무게", a.body_size);
        line("지원분야", a.field);
        line("특이사항", a.note);
        var musicCell = line("댄스음원", a.music && a.music.path ? "" : /\[음원은 .*카톡으로 보냄\]/.test(a.note || "") ? "카톡으로 보냄" : "-");
        line("신청 시간", stamp(a.created_at) + (a.updated_at && a.updated_at.slice(0, 16) !== a.created_at.slice(0, 16) ? " (고침 " + stamp(a.updated_at) + ")" : ""));
        li.appendChild(dl);
        if (a.music && a.music.path) {
          var play = el("button", "sys-link", "▶ 댄스 음원 듣기 · 내려받기");
          play.type = "button";
          play.addEventListener("click", function () {
            play.disabled = true;
            token().then(function (t) { return LeeshAPI.storage.visitMusic(a.music.path, t); }).then(function (u) {
              if (!u) { play.textContent = "불러오지 못했어요"; return; }
              var au = el("audio", "adm__player");
              au.controls = true;
              au.src = u;
              var down = el("a", "sys-link", "내려받기");
              down.href = u;
              down.download = a.name + "-" + (a.music.name || "음원.mp3");
              play.replaceWith(au);
              musicCell.appendChild(document.createTextNode(" "));
              musicCell.appendChild(down);
            });
          });
          musicCell.textContent = (a.music.name || "음원 파일") + " ";
          musicCell.appendChild(play);
        }
        var del = el("button", "sys-link adm__del", "신청 지우기");
        del.type = "button";
        del.addEventListener("click", function () {
          if (del.getAttribute("data-armed") !== "1") { del.setAttribute("data-armed", "1"); del.textContent = "한 번 더 누르면 지워요 (음원도)"; return; }
          var gone = a.music && a.music.path ? token().then(function (t) { return LeeshAPI.storage.removeVisit([a.music.path], t); }) : Promise.resolve(true);
          gone.then(function () { return api("visit_applications?id=eq." + a.id, { method: "DELETE" }); }).then(function (r) {
            msg($("#visitMsg"), r.ok ? "지웠어요." : friendly(r, "지우지 못했습니다."), r.ok ? "ok" : "error");
            loadVisitList();
          });
        });
        row.appendChild(del);
        li.appendChild(row);
        ul.appendChild(li);
      });
      box.appendChild(ul);
    });
  }
  $("#visitPick").addEventListener("change", loadVisitList);
  $("#visitCopy").addEventListener("click", function () {
    if (!visitRows.length) { msg($("#visitMsg"), "복사할 신청이 없어요.", "error"); return; }
    var lines = [["순번", "이름", "성별", "출생년도/나이", "키/몸무게", "지원분야", "특이사항", "댄스음원", "신청 시각"].join("\t")];
    visitRows.forEach(function (a, i) {
      lines.push([i + 1, a.name, a.gender || "", a.birth || "", a.body_size || "", a.field || "",
        String(a.note || "").replace(/\s+/g, " "), a.music ? "있음" : "", stamp(a.created_at)].join("\t"));
    });
    copyText(lines.join("\n"), $("#visitCopy"));
  });

  /* ---------------- 노래 추천 (학생 "내 폴더 → 노래 추천"; js/mynotes.js) ---------------- */

  // What the student sees from the analysis sheet (label in the sheet → label in the folder); the rest
  // (자료, 높은 음 비율, 셈여림 폭, ② 곡별 음역, 참고) stays with the director.
  var REC_LABELS = { "부른 곡": "분석한 곡", "낸 음역": "낸 음역", "주로 머문 음": "편한 음역", "음정": "음정",
    "음색": "음색", "분위기": "잘 맞는 분위기", "어울리는 곡": "어울리는 곡" };
  function members() {
    return state.members.length ? Promise.resolve(state.members) : api("members?select=id,name,status,memo&order=id").then(function (res) {
      if (res.ok) state.members = res.data;
      return state.members;
    });
  }
  function memberName(id) { var m = state.members.filter(function (x) { return x.id === id; })[0]; return m ? m.name : id; }
  /** The sheet pasted as tab-separated rows → { member, summary: [[label, text]], songs: [...] } */
  function parseRec(text) {
    var out = { member: null, summary: [], songs: [] }, part = 1;
    text.split(/\r?\n/).forEach(function (line) {
      var c = line.split("\t").map(function (x) { return x.replace(/^\[merged\]\s*/, "").trim(); })
        .filter(function (x, i, a) { return x && x !== a[i - 1]; }); // merged cells copy as the same text again
      if (!c.length) return;
      var id = /\b([A-Z]\d{3})\b/.exec(c[0]);
      if (id && !out.member && /분석|추천/.test(c[0])) { out.member = id[1]; return; }
      if (/^②/.test(c[0])) { part = 2; return; }
      if (/^③/.test(c[0])) { part = 3; return; }
      if (/^참고$/.test(c[0])) { part = 4; return; }
      if (part === 1 && REC_LABELS[c[0]] && c[1]) {
        // 세 곡 내내 안정적 (길게 낸 음 112개, … 14센트 차이) → 세 곡 내내 안정적
        out.summary.push([REC_LABELS[c[0]], c[1].replace(/\s*\([^)]*(센트|dB|개)[^)]*\)/g, "").trim()]);
        return;
      }
      if (part === 3 || /^\[[^\]]+\]/.test(c[0])) {
        var m = /^(?:\[([^\]]+)\]\s*)?(.+?)\s+[–—-]\s+(.+)$/.exec(c[0]);
        if (!m || c[0] === "곡") return;
        var song = { tag: m[1] || null, artist: m[2], title: m[3], why: null, melon: null, spotify: null, key: null };
        c.slice(1).forEach(function (x) {
          if (/melon\.com/.test(x)) song.melon = x;
          else if (/spotify\.com/.test(x)) song.spotify = x;
          else if (/링크 없음/.test(x)) return;
          else if (!song.why) song.why = x;
          else song.key = x;
        });
        out.songs.push(song);
      }
    });
    return out;
  }
  var recDraft = null;
  function recPreview() {
    var f = $("#recForm"), box = $("#recPreview");
    box.textContent = "";
    var text = field(f, "paste").value;
    recDraft = text.trim() ? parseRec(text) : null;
    if (!recDraft) return;
    if (recDraft.member && state.members.some(function (m) { return m.id === recDraft.member; })) field(f, "member").value = recDraft.member;
    var card = el("div", "adm__card");
    card.appendChild(el("p", "sys-note", "학생에게 이렇게 보여요 · " + memberName(field(f, "member").value)));
    recDraft.summary.forEach(function (r) { card.appendChild(el("p", null, r[0] + ": " + r[1])); });
    recDraft.songs.forEach(function (s, i) {
      card.appendChild(el("p", null, "♪ " + (i + 1) + ". " + (s.tag ? "[" + s.tag + "] " : "") + s.title + " · " + s.artist + (s.melon ? " (멜론 링크 있음)" : "")));
    });
    if (!recDraft.songs.length) card.appendChild(el("p", "sys-msg sys-msg--error", "추천곡을 못 찾았어요. ③ 추천곡 칸까지 같이 복사해주세요."));
    box.appendChild(card);
  }
  $("#recForm [name=paste]").addEventListener("input", recPreview);
  $("#recForm [name=member]").addEventListener("change", recPreview);
  $("#recForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target, mid = field(f, "member").value, btn = $("#recSave");
    if (!recDraft || !recDraft.songs.length) { msg($("#recMsg"), "시트를 붙여넣어 주세요 (추천곡이 1곡 이상 있어야 해요).", "error"); return; }
    btn.disabled = true;
    api("song_recs", { method: "POST", body: { member_id: mid, made_on: field(f, "made_on").value, summary: recDraft.summary,
      songs: recDraft.songs, note: field(f, "note").value.trim() || null } }).then(function (res) {
      btn.disabled = false;
      if (!res.ok) { msg($("#recMsg"), friendly(res), "error"); return; }
      // the student's open request is answered now
      api("song_requests?member_id=eq." + encodeURIComponent(mid) + "&status=eq." + encodeURIComponent("접수"), { method: "PATCH", body: { status: "완료" } })
        .then(function () { loadRecs(); });
      msg($("#recMsg"), "올렸어요. 학생 내 폴더 → 노래 추천에 바로 보여요.", "ok");
      field(f, "paste").value = "";
      field(f, "note").value = "";
      recPreview();
      showShare($("#recShare"), "#recs", "노래 추천이 올라왔어요. 내 목소리에 맞는 곡을 확인해보세요!", memberName(mid));
    });
  });
  function loadRecs() {
    members().then(function (all) {
      var sel = field($("#recForm"), "member"), keep = sel.value;
      sel.textContent = "";
      all.filter(function (m) { return m.status === "재원" || m.status === "휴원"; }).forEach(function (m) {
        var o = el("option", null, m.name + " (" + m.id + ")");
        o.value = m.id;
        sel.appendChild(o);
      });
      if (keep) sel.value = keep;
      if (!field($("#recForm"), "made_on").value) field($("#recForm"), "made_on").value = todayKst();
      var req = $("#songReqList");
      req.textContent = "";
      // open requests, and finished ones whose recordings haven't been deleted yet
      api("song_requests?select=*&order=created_at&limit=300").then(function (res) {
        if (!res.ok) { req.appendChild(el("li", "sys-msg sys-msg--error", friendly(res, "불러오지 못했습니다."))); return; }
        var rows = res.data.filter(function (q) { return q.status === "접수" || (q.files || []).length; });
        countRecs(res.data.filter(function (q) { return q.status === "접수"; }).length);
        if (!rows.length) req.appendChild(el("li", "sys-empty", "새 신청이 없어요."));
        rows.forEach(function (q) {
          var li = el("li", "adm__card"), top = el("div", "adm__cardtop");
          top.appendChild(el("strong", null, memberName(q.member_id) + " (" + q.member_id + ")"));
          if (q.goal) top.appendChild(el("span", "adm__badge adm__badge--kind", q.goal));
          top.appendChild(el("span", "sys-note", stamp(q.created_at)));
          li.appendChild(top);
          if (q.status === "완료") top.appendChild(el("span", "sys-note", "추천 완료 · 녹음이 남아 있어요"));
          if (q.likes) li.appendChild(el("p", null, "좋아하는 가수·곡: " + q.likes));
          if (q.memo) li.appendChild(el("p", "adm__quote", q.memo));
          if ((q.files || []).length) li.appendChild(songFiles(q));
          var row = el("div", "adm__cardrow");
          var write = el("button", "sys-link", "이 학생 추천 쓰기");
          write.type = "button";
          write.addEventListener("click", function () { field($("#recForm"), "member").value = q.member_id; recPreview(); field($("#recForm"), "paste").focus(); });
          var done = el("button", "sys-link", "완료로 표시");
          done.type = "button";
          done.addEventListener("click", function () { api("song_requests?id=eq." + q.id, { method: "PATCH", body: { status: "완료" } }).then(loadRecs); });
          row.appendChild(write);
          if (q.status === "접수") row.appendChild(done);
          li.appendChild(row);
          req.appendChild(li);
        });
      });
      var ul = $("#recList");
      ul.textContent = "";
      api("song_recs?select=id,member_id,made_on,songs,published&order=made_on.desc,id.desc&limit=200").then(function (res) {
        if (!res.ok) { ul.appendChild(el("li", "sys-msg sys-msg--error", friendly(res, "불러오지 못했습니다."))); return; }
        if (!res.data.length) ul.appendChild(el("li", "sys-empty", "아직 올린 추천이 없어요."));
        res.data.forEach(function (r) {
          var li = el("li", "adm__card" + (r.published ? "" : " is-hidden")), top = el("div", "adm__cardtop");
          top.appendChild(el("strong", null, memberName(r.member_id)));
          top.appendChild(el("span", "sys-note", r.made_on));
          if (!r.published) top.appendChild(el("span", "sys-note", "숨김"));
          li.appendChild(top);
          li.appendChild(el("p", null, (r.songs || []).map(function (s) { return s.title; }).join(" · ")));
          var row = el("div", "adm__cardrow");
          var hide = el("button", "sys-link", r.published ? "숨기기" : "다시 보이기");
          hide.type = "button";
          hide.addEventListener("click", function () {
            api("song_recs?id=eq." + r.id, { method: "PATCH", body: { published: !r.published, updated_at: new Date().toISOString() } }).then(loadRecs);
          });
          row.appendChild(hide);
          row.appendChild(deleteButton("song_recs", r.id, loadRecs));
          li.appendChild(row);
          ul.appendChild(li);
        });
      });
    });
  }
  /** The student's recordings: listen, save to this computer, and 녹음 지우기 once the recommendation is up. */
  function songFiles(q) {
    var box = el("div", "adm__songs");
    q.files.forEach(function (fl, k) {
      var line = el("p", "adm__song");
      line.appendChild(el("span", null, "🎵 " + (fl.name || "녹음 " + (k + 1)) + (fl.sec ? " · " + Math.floor(fl.sec / 60) + ":" + String(fl.sec % 60).padStart(2, "0") : "")));
      var play = el("button", "sys-link", "▶ 듣기 · 내려받기");
      play.type = "button";
      play.addEventListener("click", function () {
        play.disabled = true;
        token().then(function (t) { return LeeshAPI.storage.song(fl.path, t); }).then(function (u) {
          if (!u) { play.textContent = "불러오지 못했어요"; return; }
          var a = el(/^video/.test(fl.type || "") ? "video" : "audio", "adm__player");
          a.controls = true;
          a.src = u;
          var dl = el("a", "sys-link", "내려받기");
          dl.href = u;
          dl.download = memberName(q.member_id) + "-" + (k + 1) + "." + String(fl.path).split(".").pop();
          play.replaceWith(a);
          line.appendChild(dl);
        });
      });
      line.appendChild(play);
      box.appendChild(line);
    });
    var wipe = el("button", "sys-link adm__del", "녹음 지우기");
    wipe.type = "button";
    wipe.addEventListener("click", function () {
      if (wipe.getAttribute("data-armed") !== "1") { wipe.setAttribute("data-armed", "1"); wipe.textContent = "한 번 더 누르면 녹음 " + q.files.length + "개를 지워요"; return; }
      wipe.disabled = true;
      token().then(function (t) { return LeeshAPI.storage.removeSongs(q.files.map(function (f) { return f.path; }), t); }).then(function (ok) {
        if (!ok) { wipe.disabled = false; wipe.textContent = "지우지 못했어요. 다시 눌러주세요"; return; }
        api("song_requests?id=eq." + q.id, { method: "PATCH", body: { files: [] } }).then(function () {
          msg($("#recMsg"), "녹음을 지웠어요.", "ok");
          loadRecs();
        });
      });
    });
    box.appendChild(wipe);
    return box;
  }

  function countRecs(n) {
    if (n != null) { setBadge("#recBadge", n); return; }
    api("song_requests?select=id&status=eq." + encodeURIComponent("접수")).then(function (res) { if (res.ok) setBadge("#recBadge", res.data.length); });
  }

  /* ---------------- 선생님 (teachers · teacher_requests; teacher.html) ---------------- */

  function loadTeachers() {
    members().then(function (all) {
      Promise.all([api("teachers?select=*&order=name"), api("teacher_requests?select=*&order=created_at.desc&limit=100")]).then(function (r) {
        var ts = r[0].ok ? r[0].data : [], reqs = r[1].ok ? r[1].data : [];
        var rl = $("#teacherReqList"), tl = $("#teacherList");
        rl.textContent = "";
        tl.textContent = "";
        if (!r[0].ok) { tl.appendChild(el("li", "sys-msg sys-msg--error", friendly(r[0], "불러오지 못했습니다."))); return; }
        var waiting = reqs.filter(function (q) { return q.status === "대기"; });
        setBadge("#teacherBadge", waiting.length);
        if (!waiting.length) rl.appendChild(el("li", "sys-empty", "새 연결 요청이 없어요."));
        waiting.forEach(function (q) {
          var li = el("li", "adm__card"), top = el("div", "adm__cardtop");
          top.appendChild(el("strong", null, q.name + " 선생님"));
          if (q.kakao_name) top.appendChild(el("span", "sys-note", "카카오 이름: " + q.kakao_name));
          top.appendChild(el("span", "sys-note", stamp(q.created_at)));
          li.appendChild(top);
          var row = el("div", "adm__cardrow");
          var sel = el("select");
          sel.setAttribute("aria-label", "연결할 선생님");
          ts.forEach(function (t) { var o = el("option", null, t.name + (t.kakao_user ? " (이미 연결됨)" : "")); o.value = t.id; if (t.name === q.name) o.selected = true; sel.appendChild(o); });
          var ok = el("button", "sys-btn", "승인");
          ok.type = "button";
          var no = el("button", "sys-link adm__del", "거절");
          no.type = "button";
          function decide(yes) {
            api("rpc/admin_teacher_decide", { method: "POST", body: { p_request: q.id, p_teacher: Number(sel.value), p_approve: yes } }).then(function (res) {
              var d = res.data || {};
              msg($("#teacherMsg"), res.ok && d.ok ? (yes ? "승인했어요. 이제 선생님 화면에 담당 학생이 보여요." : "거절했어요.") : d.error || friendly(res), res.ok && d.ok ? "ok" : "error");
              loadTeachers();
            });
          }
          ok.addEventListener("click", function () { decide(true); });
          no.addEventListener("click", function () { decide(false); });
          row.appendChild(sel);
          row.appendChild(ok);
          row.appendChild(no);
          li.appendChild(row);
          rl.appendChild(li);
        });
        ts.forEach(function (t) {
          var mine = all.filter(function (m) { return (m.status === "재원" || m.status === "휴원") && teacherOf(m) === t.name; }).length;
          var li = el("li", "adm__card" + (t.active ? "" : " is-hidden")), top = el("div", "adm__cardtop");
          top.appendChild(el("strong", null, t.name));
          top.appendChild(el("span", "adm__badge adm__badge--kind", t.kakao_user ? "카카오 연결됨" : "연결 전"));
          top.appendChild(el("span", "sys-note", "담당 학생 " + mine + "명" + (t.active ? "" : " · 숨김")));
          li.appendChild(top);
          var row = el("div", "adm__cardrow");
          if (t.kakao_user) {
            var cut = el("button", "sys-link adm__del", "연결 끊기");
            cut.type = "button";
            cut.addEventListener("click", function () {
              if (cut.getAttribute("data-armed") !== "1") { cut.setAttribute("data-armed", "1"); cut.textContent = "한 번 더 누르면 끊어요"; return; }
              api("teachers?id=eq." + t.id, { method: "PATCH", body: { kakao_user: null } }).then(function (res) {
                msg($("#teacherMsg"), res.ok ? t.name + " 선생님 연결을 끊었어요. 다시 쓰려면 연결 요청부터 해요." : friendly(res), res.ok ? "ok" : "error");
                loadTeachers();
              });
            });
            row.appendChild(cut);
          }
          var hide = el("button", "sys-link", t.active ? "숨기기 (그만둔 선생님)" : "다시 보이기");
          hide.type = "button";
          hide.addEventListener("click", function () { api("teachers?id=eq." + t.id, { method: "PATCH", body: { active: !t.active } }).then(loadTeachers); });
          row.appendChild(hide);
          li.appendChild(row);
          tl.appendChild(li);
        });
      });
    });
  }
  function countTeachers() {
    api("teacher_requests?select=id&status=eq." + encodeURIComponent("대기")).then(function (res) { if (res.ok) setBadge("#teacherBadge", res.data.length); });
  }
  $("#teacherAdd").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target, name = field(f, "name").value.trim();
    api("teachers", { method: "POST", body: { name: name } }).then(function (res) {
      msg($("#teacherMsg"), res.ok ? name + " 선생님을 더했어요." : friendly(res, "더하지 못했어요. 이미 있는 이름인지 확인해주세요."), res.ok ? "ok" : "error");
      if (res.ok) { f.reset(); loadTeachers(); }
    });
  });
  $("#teacherCopy").addEventListener("click", function () { copyText(new URL("teacher.html", location.href).href, $("#teacherCopy")); });

  /* ---------------- 선생님 구글시트 → 레슨 노트 (tools/lesson_sync.gs, 원장님 2026-11-03) ---------------- */
  function loadLessonSync() {
    var ul = $("#lessonSyncList"), st = $("#lessonSyncState");
    Promise.all([members(), api("rpc/admin_lesson_sync_status", { method: "POST", body: {} })]).then(function (r) {
      var all = r[0] || [], res = r[1], d = res.data || {};
      ul.textContent = "";
      if (!res.ok || !d.ok) { st.textContent = d.error || friendly(res, "불러오지 못했습니다."); return; }
      var srcs = d.sources || [], pend = srcs.filter(function (x) { return x.status === "pending"; });
      var okN = srcs.filter(function (x) { return x.status === "ok"; }).length;
      var last = d.last || {};
      st.textContent = !d.connected
        ? (d.openUntil && new Date(d.openUntil) > new Date() ? "연결을 기다리는 중 (" + stamp(d.openUntil) + "까지) — 스크립트에서 처음_한번_설정을 실행해주세요." : "아직 연결 전이에요.")
        : "연결됨 · 마지막으로 돈 때 " + (d.lastAt ? stamp(d.lastAt) : "아직") +
          (d.lastAt ? " (파일 " + (last.files || 0) + "개 중 " + (last.fetched || 0) + "개 가져옴" + (last.left ? " · " + last.left + "개는 다음에" : "") +
            (last.errors && last.errors.length ? " · 안 된 것 " + last.errors.length : "") + ")" : "") +
          " · 학생 확인됨 " + okN + " · 확인 필요 " + pend.length;
      setBadge("#lessonSyncBadge", pend.length);
      if (last.errors && last.errors.length) ul.appendChild(el("li", "sys-msg sys-msg--error", "가져오지 못한 파일: " + last.errors.join(" / ")));
      var live = all.filter(function (m) { return m.status === "재원" || m.status === "휴원"; })
        .sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
      function card(x) {
        var li = el("li", "adm__card" + (x.status === "ignore" ? " is-hidden" : "")), top = el("div", "adm__cardtop");
        top.appendChild(el("strong", null, x.title));
        top.appendChild(el("span", "sys-note", x.folder || "폴더 밖"));
        if (x.status === "ok") top.appendChild(el("span", "adm__badge adm__badge--sheet", x.name + " (" + x.member + ")" + (x.by === "admin" ? " · 직접 정함" : "")));
        li.appendChild(top);
        if (x.status === "ok") {
          li.appendChild(el("p", "sys-note", "레슨 노트 " + x.notes + " · 곡·자료 " + x.sheets + (x.kept ? " · 홈페이지에서 고친 것 " + x.kept : "") +
            (x.gone ? " · 시트에서 없어진 탭 " + x.gone + " (홈페이지엔 남겨둠)" : "") + " · " + (x.syncedAt ? "가져온 때 " + stamp(x.syncedAt) : "아직 안 가져옴")));
        } else if (x.why) li.appendChild(el("p", "sys-note", x.why));
        var row = el("div", "adm__cardrow");
        var sel = el("select");
        sel.setAttribute("aria-label", "학생 고르기");
        var nm = (/^\s*([가-힣]{2,4})/.exec(x.title) || [])[1];
        var o0 = el("option", null, "학생 고르기…");
        o0.value = "";
        sel.appendChild(o0);
        live.filter(function (m) { return !nm || m.name === nm; }).concat(nm ? [{ id: "", name: "──────" }] : []).concat(live.filter(function (m) { return nm && m.name !== nm; }))
          .forEach(function (m) {
            var o = el("option", null, m.id ? m.name + " (" + m.id + ") · " + (teacherOf(m) || "담당 없음") + (m.status === "휴원" ? " · 휴원" : "") : m.name);
            o.value = m.id;
            if (!m.id) o.disabled = true;
            if (m.id === x.member) o.selected = true;
            sel.appendChild(o);
          });
        var set = el("button", "sys-btn", x.status === "ok" ? "바꾸기" : "이 학생으로");
        set.type = "button";
        set.addEventListener("click", function () {
          if (!sel.value) { msg($("#lessonSyncMsg"), "학생을 골라주세요.", "error"); return; }
          src(x, { p_file: x.file, p_member: sel.value }, "정했어요. 다음 가져오기(1시간 안)에 들어와요.");
        });
        row.appendChild(sel);
        row.appendChild(set);
        if (x.status !== "ignore") {
          var skip = el("button", "sys-link adm__del", "가져오지 않기");
          skip.type = "button";
          skip.addEventListener("click", function () { src(x, { p_file: x.file, p_ignore: true }, "이 파일은 가져오지 않아요."); });
          row.appendChild(skip);
        }
        if (x.by === "admin") {
          var auto = el("button", "sys-link", "저절로 맞추기로 되돌리기");
          auto.type = "button";
          auto.addEventListener("click", function () { src(x, { p_file: x.file }, "되돌렸어요."); });
          row.appendChild(auto);
        }
        li.appendChild(row);
        return li;
      }
      if (!srcs.length) { ul.appendChild(el("li", "sys-empty", d.connected ? "아직 찾은 시트가 없어요." : "연결하면 여기에 선생님 시트 목록이 보여요.")); return; }
      if (pend.length) { ul.appendChild(el("li", "sys-h adm__subhead", "확인 필요 " + pend.length)); pend.forEach(function (x) { ul.appendChild(card(x)); }); }
      var rest = srcs.filter(function (x) { return x.status !== "pending"; });
      if (rest.length) {
        var det = el("details", "adm__fold"), sum = el("summary", null, "확인된 시트 " + okN + (rest.length > okN ? " · 가져오지 않기 " + (rest.length - okN) : ""));
        det.appendChild(sum);
        var inner = el("ul", "adm__cards");
        rest.forEach(function (x) { inner.appendChild(card(x)); });
        det.appendChild(inner);
        var li = el("li");
        li.appendChild(det);
        ul.appendChild(li);
      }
    });
  }
  function src(x, body, ok) {
    api("rpc/admin_lesson_source_set", { method: "POST", body: body }).then(function (res) {
      var d = res.data || {};
      msg($("#lessonSyncMsg"), res.ok && d.ok ? x.title + ": " + ok : d.error || friendly(res), res.ok && d.ok ? "ok" : "error");
      loadLessonSync();
    });
  }
  $("#lessonSyncOpen").addEventListener("click", function () {
    api("rpc/admin_lesson_sync_open", { method: "POST", body: {} }).then(function (res) {
      var d = res.data || {};
      msg($("#lessonSyncMsg"), res.ok && d.ok ? "30분 동안 열었어요. 이제 구글 스크립트에서 \"처음_한번_설정\"을 실행해주세요." : d.error || friendly(res), res.ok && d.ok ? "ok" : "error");
      loadLessonSync();
    });
  });
  $("#lessonSyncReload").addEventListener("click", loadLessonSync);

  /* ---------------- 제휴 업체 예약 신청 (partner_requests; 학생 내 폴더 → 제휴 업체) ---------------- */

  var PARTNER_STATES = ["접수", "예약 완료", "취소"];
  function loadPartners() {
    members().then(function () {
      var st = $("#partnerFilter").value, ul = $("#partnerReqList");
      ul.textContent = "";
      api("partner_requests?select=*&order=created_at.desc&limit=300" + (st ? "&status=eq." + encodeURIComponent(st) : "")).then(function (res) {
        if (!res.ok) { ul.appendChild(el("li", "sys-msg sys-msg--error", friendly(res, "불러오지 못했습니다."))); return; }
        if (!res.data.length) ul.appendChild(el("li", "sys-empty", st === "접수" ? "새 신청이 없어요." : "해당하는 신청이 없어요."));
        res.data.forEach(function (r) { ul.appendChild(partnerCard(r)); });
      });
      countPartners();
      loadPartnerList();
    });
  }
  function partnerCard(r) {
    var li = el("li", "adm__card"), top = el("div", "adm__cardtop");
    var m = state.members.filter(function (x) { return x.id === r.member_id; })[0];
    top.appendChild(el("strong", null, memberName(r.member_id) + (m && teacherOf(m) ? " · 담당 " + teacherOf(m) : "")));
    top.appendChild(el("span", "adm__badge adm__badge--kind", r.partner));
    top.appendChild(el("span", "sys-note", stamp(r.created_at)));
    li.appendChild(top);
    li.appendChild(el("p", null, "원하는 때: " + (r.wish || "-")));
    if (r.memo) li.appendChild(el("p", "adm__quote", r.memo));
    var row = el("div", "adm__cardrow");
    var sel = el("select");
    sel.setAttribute("aria-label", "상태");
    PARTNER_STATES.forEach(function (s) { var o = el("option", null, s); if (s === r.status) o.selected = true; sel.appendChild(o); });
    var reply = el("textarea");
    reply.rows = 2;
    reply.maxLength = 500;
    reply.placeholder = "학생에게 보낼 말 (예: 11월 3일 (월) 오후 2시 예약됐어요. 학원 이름 말하고 들어가면 돼요.)";
    reply.value = r.reply || "";
    reply.setAttribute("aria-label", "학생에게 보낼 말");
    var save = el("button", "sys-btn", "저장");
    save.type = "button";
    var note = el("span", "sys-msg");
    save.addEventListener("click", function () {
      api("partner_requests?id=eq." + r.id, { method: "PATCH", body: { status: sel.value, reply: reply.value.trim() || null, updated_at: new Date().toISOString() } }).then(function (res) {
        msg(note, res.ok ? "저장했어요. 학생 내 폴더에 보여요." : friendly(res), res.ok ? "ok" : "error");
        if (res.ok) countPartners();
      });
    });
    row.appendChild(sel);
    row.appendChild(save);
    row.appendChild(deleteButton("partner_requests", r.id, loadPartners));
    li.appendChild(reply);
    li.appendChild(row);
    li.appendChild(note);
    return li;
  }
  function loadPartnerList() {
    var ul = $("#partnerList");
    ul.textContent = "";
    api("partners?select=*&order=sort,id").then(function (res) {
      if (!res.ok) { ul.appendChild(el("li", "sys-msg sys-msg--error", friendly(res, "불러오지 못했습니다."))); return; }
      res.data.forEach(function (p) {
        var li = el("li", "adm__card" + (p.active ? "" : " is-hidden"));
        var f = el("form", "sys");
        var row = el("div", "sys-row");
        var cat = el("input"); cat.maxLength = 30; cat.required = true; cat.value = p.category; cat.setAttribute("aria-label", "종류");
        var nm = el("input"); nm.maxLength = 60; nm.value = p.name || ""; nm.placeholder = "업체 이름"; nm.setAttribute("aria-label", "업체 이름");
        row.appendChild(cat);
        row.appendChild(nm);
        f.appendChild(row);
        var info = el("textarea"); info.rows = 2; info.maxLength = 500; info.value = p.info || ""; info.placeholder = "학생에게 보이는 안내 (위치·혜택·준비물 등)"; info.setAttribute("aria-label", "안내");
        f.appendChild(info);
        var bar = el("div", "adm__cardrow");
        var save = el("button", "sys-btn", "저장");
        save.type = "submit";
        var hide = el("button", "sys-link", p.active ? "숨기기" : "다시 보이기");
        hide.type = "button";
        var note = el("span", "sys-msg");
        f.addEventListener("submit", function (e) {
          e.preventDefault();
          api("partners?id=eq." + p.id, { method: "PATCH", body: { category: cat.value.trim(), name: nm.value.trim() || null, info: info.value.trim() || null } }).then(function (res) {
            msg(note, res.ok ? "저장했어요." : friendly(res), res.ok ? "ok" : "error");
          });
        });
        hide.addEventListener("click", function () { api("partners?id=eq." + p.id, { method: "PATCH", body: { active: !p.active } }).then(loadPartnerList); });
        bar.appendChild(save);
        bar.appendChild(hide);
        bar.appendChild(note);
        f.appendChild(bar);
        li.appendChild(f);
        ul.appendChild(li);
      });
    });
  }
  $("#partnerFilter").addEventListener("change", loadPartners);
  $("#partnerAdd").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target;
    api("partners", { method: "POST", body: { category: field(f, "category").value.trim(), name: field(f, "name").value.trim() || null,
      info: field(f, "info").value.trim() || null, sort: 1000 } }).then(function (res) {
      msg($("#partnerMsg"), res.ok ? "업체를 더했어요." : friendly(res), res.ok ? "ok" : "error");
      if (res.ok) { f.reset(); loadPartnerList(); }
    });
  });
  function countPartners() {
    api("partner_requests?select=id&status=eq." + encodeURIComponent("접수")).then(function (res) {
      if (res.ok) setBadge("#partnerBadge", res.data.length);
    });
  }

  /* ---------------- 연습 일지 · 레퍼토리 (학생이 직접 쓴 것; 보기만) ---------------- */

  function teacherOf(m) { var t = /담당\s*([^\s·,]+)/.exec(m.memo || ""); return t ? t[1] : ""; }
  function mins(n) { var h = Math.floor(n / 60), r = n % 60; return (h ? h + "시간" : "") + (h && r ? " " : "") + (r || !h ? r + "분" : ""); }
  function loadJournal() {
    var box = $("#jrBox"), tsel = $("#jrTeacher"), msel = $("#jrMember");
    box.textContent = "";
    box.appendChild(el("p", "sys-note", "불러오는 중…"));
    var from = addDays(todayKst(), -60);
    Promise.all([members(), api("practice_logs?select=*&day=gte." + from + "&order=day.desc,id.desc&limit=3000"), api("repertoire?select=*&order=updated_at.desc&limit=3000")])
      .then(function (r) {
        var all = r[0].filter(function (m) { return m.status === "재원"; }), logs = r[1].ok ? r[1].data : [], songs = r[2].ok ? r[2].data : [];
        // the two pickers: teacher (from "담당 ○○○" in the memo), then the students of that teacher
        var tk = tsel.value, mk = msel.value, names = {};
        all.forEach(function (m) { var t = teacherOf(m); if (t) names[t] = 1; });
        tsel.length = 1;
        Object.keys(names).sort().forEach(function (t) { var o = el("option", null, t); o.value = t; tsel.appendChild(o); });
        tsel.value = names[tk] ? tk : "";
        var mine = all.filter(function (m) { return !tsel.value || teacherOf(m) === tsel.value; });
        msel.length = 1;
        mine.forEach(function (m) { var o = el("option", null, m.name + " (" + m.id + ")"); o.value = m.id; msel.appendChild(o); });
        msel.value = mine.some(function (m) { return m.id === mk; }) ? mk : "";
        box.textContent = "";
        if (!r[1].ok) { box.appendChild(el("p", "sys-msg sys-msg--error", friendly(r[1], "불러오지 못했습니다."))); return; }

        if (!msel.value) {
          // everyone: who practised in the last 2 weeks, most first
          var since = addDays(todayKst(), -13), rows = mine.map(function (m) {
            var l = logs.filter(function (x) { return x.member_id === m.id && x.day >= since; });
            var days = {};
            l.forEach(function (x) { days[x.day] = 1; });
            return { m: m, days: Object.keys(days).length, min: l.reduce(function (s, x) { return s + (x.minutes || 0); }, 0), last: l[0] && l[0].day,
              songs: songs.filter(function (s) { return s.member_id === m.id && s.status === "준비 중"; }).length };
          }).sort(function (a, b) { return b.days - a.days || b.min - a.min; });
          var used = rows.filter(function (x) { return x.days || x.songs; });
          box.appendChild(el("p", "sys-note", "최근 2주 동안 일지를 쓴 학생 " + rows.filter(function (x) { return x.days; }).length + "명 · 학생을 누르면 자세히 봐요."));
          if (!used.length) { box.appendChild(el("p", "sys-empty", "아직 연습 일지나 레퍼토리를 쓴 학생이 없어요.")); return; }
          var ul = el("ul", "adm__cards");
          used.forEach(function (x) {
            var li = el("li", "adm__card"), top = el("div", "adm__cardtop");
            var a = el("button", "sys-link", x.m.name + " (" + x.m.id + ")");
            a.type = "button";
            a.addEventListener("click", function () { msel.value = x.m.id; loadJournal(); });
            top.appendChild(a);
            if (teacherOf(x.m)) top.appendChild(el("span", "sys-note", teacherOf(x.m)));
            li.appendChild(top);
            li.appendChild(el("p", null, "2주 중 " + x.days + "일 연습" + (x.min ? " · " + mins(x.min) : "") + (x.last ? " · 마지막 " + dayLabel(x.last) : "") + " · 준비 중인 곡 " + x.songs + "곡"));
            ul.appendChild(li);
          });
          box.appendChild(ul);
          return;
        }

        var id = msel.value, cols = el("div", "adm__cols");
        var left = el("div");
        left.appendChild(el("h3", "sys-h", "연습 일지 (최근 60일)"));
        var lu = el("ul", "adm__cards");
        var my = logs.filter(function (x) { return x.member_id === id; });
        if (!my.length) lu.appendChild(el("li", "sys-empty", "최근 60일 동안 쓴 일지가 없어요."));
        var logLis = {};
        my.forEach(function (x) {
          var li = el("li", "adm__card"), top = el("div", "adm__cardtop");
          top.appendChild(el("strong", null, dayLabel(x.day)));
          if (x.minutes) top.appendChild(el("span", "sys-note", mins(x.minutes)));
          if (x.song) top.appendChild(el("span", "sys-note", "♪ " + x.song));
          li.appendChild(top);
          if (x.did) li.appendChild(el("p", "adm__quote", x.did));
          logLis[x.id] = li;
          lu.appendChild(li);
        });
        // 연습 일지 사진 (원장님 2026-11-10): 학생이 붙인 사진, 보기만
        if (window.LeeshPhotos && my.length) api("practice_photos?select=*&member_id=eq." + encodeURIComponent(id) + "&order=id").then(function (pr) {
          if (!pr.ok) return;
          var by = {};
          pr.data.forEach(function (p) { (by[p.log_id] = by[p.log_id] || []).push(p); });
          var load = function (path) { return token().then(function (t) { return LeeshAPI.storage.photo(path, t); }); };
          Object.keys(by).forEach(function (lid) { if (logLis[lid]) logLis[lid].appendChild(LeeshPhotos.strip({ items: by[lid], canEdit: false, load: load }).node); });
        });
        left.appendChild(lu);
        var right = el("div");
        right.appendChild(el("h3", "sys-h", "레퍼토리"));
        var su = el("ul", "adm__cards");
        var ms = songs.filter(function (s) { return s.member_id === id; });
        if (!ms.length) su.appendChild(el("li", "sys-empty", "적은 곡이 없어요."));
        ms.forEach(function (s) {
          var li = el("li", "adm__card"), top = el("div", "adm__cardtop");
          top.appendChild(el("strong", null, s.title + (s.artist ? " · " + s.artist : "")));
          [s.purpose, s.status].forEach(function (t) { if (t) top.appendChild(el("span", "adm__badge adm__badge--kind", t)); });
          li.appendChild(top);
          var total = logs.filter(function (x) { return x.member_id === id && x.song === s.title; }).reduce(function (t, x) { return t + (x.minutes || 0); }, 0);
          if (total) li.appendChild(el("p", "sys-note", "최근 60일 연습 " + mins(total)));
          if (s.memo) li.appendChild(el("p", "adm__quote", s.memo));
          su.appendChild(li);
        });
        right.appendChild(su);
        cols.appendChild(left);
        cols.appendChild(right);
        box.appendChild(cols);
      });
  }
  $("#jrTeacher").addEventListener("change", function () { $("#jrMember").value = ""; loadJournal(); });
  $("#jrMember").addEventListener("change", loadJournal);

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
    // 학원 카톡 양식 4가지 (2026-10-29부터). 예전 신청은 희망·반만 있어요.
    var info = el("dl", "adm__visit");
    [["생년월일", c.birth], ["상담 유형", c.method], ["클래스", [c.track || (c.birth ? "아직 모르겠어요" : ""), c.lesson_mode, c.teacher_pref].filter(Boolean).join(" / ")],
     ["거주 지역", c.region], ["희망 요일·시간", c.days ? c.days + " · " + (c.times || "") : c.wish]].forEach(function (r) {
      if (!r[1]) return;
      info.appendChild(el("dt", null, r[0]));
      info.appendChild(el("dd", null, r[1]));
    });
    li.appendChild(info);
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
        if (res.ok) countConsults();
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

  /* ---------------- 오디션 후기 (학생이 내 폴더에서 씀, 원장님 2026-11-09) ---------------- */
  var RV_TEXT = [["asked", "질문 리스트"], ["tip", "나만의 꿀팁 · 나의 후기"], ["process", "진행 순서 · 상황 설명"], ["note", "특이사항"]];
  var reviewItems = [];
  /* 원장 컨설팅 (원장님 2026-11-11 "관리자도 넣어줘" · "원장님은 드롭다운으로"): 선생님 화면과 같은 서버 함수
     (teacher_consults · teacher_consult, 관리자도 됨). 선생님별로 묶은 학생 드롭다운 하나, 그만둔 선생님은 맨 아래 "(퇴사)". */
  var dc = { items: [] };
  function loadDirector() {
    var sel = $("#dcPick");
    sel.length = 1;
    sel.options[0].textContent = "불러오는 중…";
    api("rpc/teacher_consults", { method: "POST", body: {} }).then(function (res) {
      var d = res.data || {};
      if (!res.ok || !d.ok) { sel.options[0].textContent = d.error || "불러오지 못했어요."; return; }
      dc.items = d.items || [];
      var base = $("#dcNote").getAttribute("data-base") || $("#dcNote").textContent;
      $("#dcNote").setAttribute("data-base", base);
      $("#dcNote").textContent = base + (d.synced ? " (마지막 " + stamp(d.synced) + ")" : "");
      $("#dcPickLab").textContent = "학생 고르기 (선생님별 · " + dc.items.length + "명)";
      sel.options[0].textContent = dc.items.length ? "학생을 고르세요" : "아직 컨설팅 기록이 없어요";
      var names = dc.items.map(function (x) { return x.teacher || "담당 없음"; }).filter(function (t, i, a) { return a.indexOf(t) === i; });
      var left = function (t) { return dc.items.some(function (x) { return (x.teacher || "담당 없음") === t && x.left; }); };
      names.sort(function (a, b) { return left(a) !== left(b) ? (left(a) ? 1 : -1) : a.localeCompare(b, "ko"); });
      names.forEach(function (t) {
        var mine = dc.items.filter(function (x) { return (x.teacher || "담당 없음") === t; });
        var g = el("optgroup");
        g.label = t + " 선생님" + (left(t) ? " (퇴사)" : "") + " · " + mine.length + "명";
        mine.forEach(function (x) { var o = el("option", null, x.name + " · " + (x.klass || x.section) + " · " + x.count + "회"); o.value = x.gid; g.appendChild(o); });
        sel.appendChild(g);
      });
    });
  }
  function openDirector(gid) {
    var box = $("#dcDetail");
    box.textContent = "";
    box.appendChild(el("p", "sys-empty", "불러오는 중…"));
    api("rpc/teacher_consult", { method: "POST", body: { p_gid: gid } }).then(function (res) {
      var r = res.data || {};
      box.textContent = "";
      if (!res.ok || !r.ok) { box.appendChild(el("p", "sys-msg sys-msg--error", r.error || friendly(res, "불러오지 못했어요."))); return; }
      box.appendChild(el("h4", "cs__who", r.name + (r.klass ? " · " + r.klass : "") + " · 컨설팅 " + (r.rows || []).length + "회"));
      (r.rows || []).forEach(function (row, i) {
        var c = el("article", "rv tch__rv cs__card");
        var h = el("p", "rv__head");
        h.appendChild(el("b", null, row[0] || "날짜 없음"));
        if (i === 0) h.appendChild(el("span", "rv__tag", "가장 최근"));
        c.appendChild(h);
        row.forEach(function (v, k) {
          if (!k || !v) return;
          c.appendChild(el("p", "rv__label", (r.head || [])[k] || "칸 " + (k + 1)));
          c.appendChild(el("p", "rv__text", v));
        });
        box.appendChild(c);
      });
      box.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  $("#dcPick").addEventListener("change", function () { if ($("#dcPick").value) openDirector($("#dcPick").value); else $("#dcDetail").textContent = ""; });
  /* 원장님 컨설팅 신청 (원장님 2026-11-11): 시간표 · 신청한 학생 · 취소, 시간 더하기 · 닫기 · 지우기, 심화반 명단 */
  function fbTwice(btn, label, run) {
    btn.addEventListener("click", function () {
      if (btn.getAttribute("data-armed") !== "1") { btn.setAttribute("data-armed", "1"); btn.textContent = label; return; }
      btn.disabled = true;
      run();
    });
  }
  function loadFeedback() {
    var list = $("#fbSlots"), mem = $("#fbMembers");
    list.textContent = "";
    list.appendChild(el("li", "sys-empty", "불러오는 중…"));
    api("rpc/admin_feedback", { method: "POST", body: {} }).then(function (res) {
      var d = res.data || {};
      list.textContent = "";
      mem.textContent = "";
      if (!res.ok || !d.ok) { list.appendChild(el("li", "sys-msg sys-msg--error", d.error || friendly(res, "불러오지 못했어요."))); return; }
      var now = Date.now(), slots = d.slots || [];
      if (!slots.length) list.appendChild(el("li", "sys-empty", "넣은 시간이 없어요."));
      slots.forEach(function (x) {
        var past = new Date(x.at).getTime() < now;
        var li = el("li", "adm__card" + (past ? " adm__card--past" : "")), top = el("div", "adm__cardtop");
        top.appendChild(el("strong", null, x.when));
        top.appendChild(el("span", "adm__badge adm__badge--kind", x.kinds === "보컬" ? "보컬만" : "보컬 · 댄스"));
        if (!x.open) top.appendChild(el("span", "adm__badge", "닫힘"));
        top.appendChild(el("span", x.booking ? "adm__badge" : "sys-note", x.booking ? "신청 " + x.name + " (" + x.member + ")" + (x.teacher ? " · 담당 " + x.teacher : "") + " · " + x.kind : "빈 시간"));
        li.appendChild(top);
        if (x.note) li.appendChild(el("p", "sys-note", "남긴 말: " + x.note));
        var acts = el("div", "adm__acts"), note = el("p", "sys-msg");
        if (x.booking) {
          var c = el("button", "sys-link", "신청 취소");
          c.type = "button";
          fbTwice(c, "한 번 더 누르면 취소해요", function () { api("rpc/admin_feedback_cancel", { method: "POST", body: { p_booking: x.booking } }).then(loadFeedback); });
          acts.appendChild(c);
        } else if (!past) {
          var t = el("button", "sys-link", x.open ? "이 시간 닫기" : "다시 열기");
          t.type = "button";
          t.addEventListener("click", function () { api("rpc/admin_feedback_slot", { method: "POST", body: { p_id: x.id, p_open: !x.open } }).then(loadFeedback); });
          acts.appendChild(t);
          var del = el("button", "sys-link", "지우기");
          del.type = "button";
          fbTwice(del, "한 번 더 누르면 지워요", function () {
            api("rpc/admin_feedback_slot", { method: "POST", body: { p_id: x.id, p_delete: true } }).then(function (r) {
              var dd = r.data || {};
              if (r.ok && dd.ok) loadFeedback(); else msg(note, dd.error || friendly(r, "지우지 못했어요."), "error");
            });
          });
          acts.appendChild(del);
        }
        li.appendChild(acts);
        li.appendChild(note);
        list.appendChild(li);
      });
      var ms = d.members || [];
      $("#fbCount").textContent = ms.length + "명";
      ms.forEach(function (m) {
        var li = el("li", "adm__card"), top = el("div", "adm__cardtop");
        top.appendChild(el("strong", null, m.name));
        top.appendChild(el("span", null, m.member + " · " + m.track + (m.slot ? " " + m.slot + "타임" : "") + (m.teacher ? " · 담당 " + m.teacher : "")));
        if (m.status !== "재원") top.appendChild(el("span", "adm__badge", m.status));
        if (!m.kakao) top.appendChild(el("span", "adm__badge", "카카오 연결 전"));
        var rm = el("button", "sys-link", "빼기");
        rm.type = "button";
        fbTwice(rm, "한 번 더 누르면 빼요", function () { api("rpc/admin_feedback_member", { method: "POST", body: { p_member: m.member, p_remove: true } }).then(loadFeedback); });
        top.appendChild(rm);
        li.appendChild(top);
        mem.appendChild(li);
      });
    });
  }
  $("#fbAdd").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target;
    api("rpc/admin_feedback_slot", { method: "POST", body: { p_id: null, p_at: field(f, "day").value + "T" + field(f, "time").value + ":00+09:00", p_kinds: field(f, "kinds").value } }).then(function (r) {
      var d = r.data || {};
      if (!r.ok || !d.ok) { msg($("#fbAddMsg"), d.error || friendly(r, "넣지 못했어요."), "error"); return; }
      msg($("#fbAddMsg"), "넣었어요.", "ok");
      loadFeedback();
    });
  });
  $("#fbMemberAdd").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target;
    api("rpc/admin_feedback_member", { method: "POST", body: { p_member: field(f, "member").value, p_track: field(f, "track").value, p_slot: field(f, "slot").value } }).then(function (r) {
      var d = r.data || {};
      if (!r.ok || !d.ok) { msg($("#fbMemberMsg"), d.error || friendly(r, "넣지 못했어요."), "error"); return; }
      msg($("#fbMemberMsg"), d.name + " 학생을 넣었어요.", "ok");
      f.reset();
      loadFeedback();
    });
  });
  function loadReviews() {
    var list = $("#reviewList");
    list.textContent = "";
    list.appendChild(el("li", "sys-empty", "불러오는 중…"));
    api("rpc/admin_reviews", { method: "POST", body: {} }).then(function (res) {
      if (!res.ok || !res.data || !res.data.ok) { list.textContent = ""; list.appendChild(el("li", "sys-empty", "불러오지 못했어요.")); return; }
      reviewItems = res.data.items || [];
      var sel = $("#reviewTeacher"), keep = sel.value;
      sel.length = 1;
      reviewItems.map(function (r) { return r.teacher; }).filter(function (t, i, a) { return t && a.indexOf(t) === i; }).sort()
        .forEach(function (t) { var o = el("option", null, t); o.value = t; sel.appendChild(o); });
      sel.value = keep;
      drawReviews();
    });
  }
  function drawReviews() {
    var list = $("#reviewList"), q = $("#reviewFind").value.trim(), t = $("#reviewTeacher").value;
    var hit = reviewItems.filter(function (r) {
      if (t && r.teacher !== t) return false;
      return !q || [r.company, r.name, r.songVocal, r.songDance, r.member].some(function (v) { return v && String(v).indexOf(q) !== -1; });
    });
    $("#reviewCount").textContent = "후기 " + reviewItems.length + "개" + (hit.length !== reviewItems.length ? " 중 " + hit.length + "개" : "");
    list.textContent = "";
    if (!hit.length) { list.appendChild(el("li", "sys-empty", reviewItems.length ? "찾는 후기가 없어요." : "아직 학생이 쓴 오디션 후기가 없어요.")); return; }
    hit.forEach(function (r) {
      var li = el("li", "adm__card rv");
      var h = el("p", "rv__head");
      h.appendChild(el("b", null, r.date + " · " + r.company));
      h.appendChild(el("span", "rv__tag", r.name + " (" + r.member + ")" + (r.teacher ? " · 담당 " + r.teacher : "")));
      li.appendChild(h);
      var info = [r.gender, r.birth, r.height && "키 " + r.height, r.weight && "몸무게 " + r.weight].filter(Boolean).join(" · ");
      if (info) li.appendChild(el("p", "rv__info", info));
      if (r.songVocal || r.songDance) {
        li.appendChild(el("p", "rv__label", "준비한 곡"));
        if (r.songVocal) li.appendChild(el("p", "rv__text", "🎤 보컬곡 · " + r.songVocal));
        if (r.songDance) li.appendChild(el("p", "rv__text", "💃 댄스곡 · " + r.songDance));
      }
      RV_TEXT.forEach(function (f) {
        if (!r[f[0]]) return;
        li.appendChild(el("p", "rv__label", f[1]));
        li.appendChild(el("p", "rv__text", r[f[0]]));
      });
      li.appendChild(el("p", "sys-note", "보낸 때 " + String(r.at).slice(0, 16).replace("T", " ") + (r.updated && r.updated.slice(0, 16) !== String(r.at).slice(0, 16) ? " · 고친 때 " + r.updated.slice(0, 16).replace("T", " ") : "")));
      list.appendChild(li);
    });
  }
  $("#reviewFind").addEventListener("input", drawReviews);
  $("#reviewTeacher").addEventListener("change", drawReviews);

  /* ---------------- 관리자 작업 기록 (원장님 2026-11-10, 서버 private.admin_log · rpc admin_log) ---------------- */
  var LOG_TBL = {
    members: "수강 ID", link_requests: "카카오 연결 요청", teachers: "선생님", teacher_requests: "선생님 연결 요청",
    parents: "학부모", parent_links: "학부모 · 자녀 연결", parent_requests: "학부모 연결 요청", admins: "관리자",
    bookings: "연습실 예약", rooms: "연습실", settings: "예약 · 운영 설정", notices: "일정 · 공지", messages: "메시지",
    admin_inbox: "선생님이 보낸 메시지", audition_news: "오디션 소식", ig_posts: "인스타그램 글", interviews: "합격자 인터뷰",
    visit_applications: "내방 신청", lesson_notes: "레슨 노트", lesson_sheets: "곡 · 자료", lesson_photos: "레슨 사진",
    lesson_sources: "레슨 시트 가져오기", eval_reports: "월말평가", monthly_evals: "월말평가 (예전)", song_requests: "노래 추천 신청",
    song_recs: "노래 추천", partners: "제휴 업체", partner_requests: "제휴 신청", consults: "상담 신청",
    practice_logs: "연습 일지", repertoire: "레퍼토리", audition_reviews: "오디션 후기"
  };
  var LOG_COL = {
    name: "이름", status: "상태", memo: "메모", phone: "전화번호", kakao_user: "카카오 연결", title: "제목", body: "내용",
    published: "공개", hidden: "숨기기", active: "사용", pinned: "고정", start_date: "시작일", end_date: "종료일", event_date: "일시",
    deadline: "마감", company: "회사", kind: "종류", image: "사진", link: "링크", member_id: "학생", teacher_id: "선생님",
    sheet: "시트 내용", lesson_date: "수업 날짜", booking_open: "연습실 예약 열기", student_notes: "학생 레슨 노트", song_recs: "학생 노래 추천",
    max_minutes: "한 번 최대 시간", daily_max_minutes: "하루 최대 시간", max_days: "예약 가능 날짜", cancel_minutes: "취소 가능 시간",
    expires_on: "만료일", reply: "학생에게 보낼 말", info: "안내", category: "종류", sort: "순서", read_at: "읽음", tab_pos: "탭 순서",
    pass_type: "합격 종류", pass_stage: "합격 단계", initials: "이니셜", kind_fixed: "칸 고정", pages: "평가지 쪽 수", total: "총점", stage: "단계"
  };
  var LOG_ACT = { insert: "추가", update: "고침", "delete": "지움" };
  var logState = { items: [], loaded: false };
  /* ---------------- 카톡 자동발송 (원장님 2026-11-10): 전날 오후 6시 솔라피 알림톡 리마인더 ---------------- */
  var KK_KINDS = ["상담", "컨설팅", "특강", "첫 레슨", "보강"];
  // 미리보기용 문구 (docs/alimtalk_templates.md와 같은 초안. 실제로 나가는 문구는 솔라피에서 승인된 템플릿)
  var KK_LEAD = { "상담": "내일 상담 예약을 안내드립니다.", "컨설팅": "내일 오디션 컨설팅 일정을 안내드립니다.", "특강": "내일 특강 일정을 안내드립니다.",
    "첫 레슨": "내일 첫 레슨 일정을 안내드립니다.", "보강": "내일 보강 레슨 일정을 안내드립니다." };
  var kk = { picked: {}, consults: [] };
  function kkWhen(day, time) {
    if (!day || !time) return "";
    var d = new Date(day + "T00:00:00Z"), h = Number(time.slice(0, 2)), m = time.slice(3, 5);
    return (d.getUTCMonth() + 1) + "월 " + d.getUTCDate() + "일(" + WD[d.getUTCDay()] + ") " + (h < 12 ? "오전 " : "오후 ") + (h % 12 || 12) + (m === "00" ? "시" : ":" + m);
  }
  function kkPreview() {
    var f = $("#kkForm"), kind = field(f, "kind").value, names = Object.keys(kk.picked).map(function (id) { return kk.picked[id]; });
    var who = f.querySelector("[name=who]:checked").value;
    var name = who === "direct" ? ($("#kkName").value.trim() || "○○○") : who === "consult" ? (($("#kkConsultSel").selectedOptions[0] || {}).dataset || {}).name || "○○○" : (names[0] || "○○○");
    var txt = (kk.texts && kk.texts[kind]) || (typeof KK_STYLES !== "undefined" && KK_STYLES ? KK_STYLES[0][1](kind) : "");
    var when = kkWhen(field(f, "day").value, field(f, "time").value), teacher = field(f, "teacher").value.trim();
    if (!teacher && who === "member") teacher = kkTeacher(Object.keys(kk.picked)[0]) || "";
    var vals = { "#{이름}": name, "#{일시}": when || "-", "#{시간}": when ? when.replace(/^.*\) /, "") : "-", "#{장소}": field(f, "place").value.trim() || "이송희보컬레슨",
      "#{안내}": field(f, "memo").value.trim() || (kind === "특강" ? "따로 챙기실 준비물은 없어요!" : "-"), "#{강사}": teacher || "○○○",
      "#{클래스}": field(f, "track").value, "#{특강}": field(f, "topic").value.trim() || "○○" };
    Object.keys(vals).forEach(function (k) { txt = txt.split(k).join(vals[k]); });
    $("#kkPreview").textContent = txt + (names.length > 1 ? "\n\n(" + names.length + "명에게 이름만 바꿔 한 통씩" + (kkText(kind).indexOf("#{강사}") >= 0 && !field(f, "teacher").value.trim() ? " · 강사는 학생마다 담당 선생님" : "") + ")" : "");
    kkFields(kind);
  }
  function kkPickList() {
    var q = $("#kkFind").value.trim().toLowerCase(), box = $("#kkPick");
    box.textContent = "";
    members().then(function (ms) {
      var list = ms.filter(function (m) { return m.status !== "종료" && (!q || m.name.toLowerCase().indexOf(q) >= 0 || m.id.toLowerCase().indexOf(q) >= 0); }).slice(0, q ? 30 : 0);
      list.forEach(function (m) {
        var b = el("button", "sys-chip" + (kk.picked[m.id] ? " is-on" : ""), m.name + " · " + m.id + (teacherOf(m) ? " · " + teacherOf(m) : ""));
        b.type = "button";
        b.addEventListener("click", function () { if (kk.picked[m.id]) delete kk.picked[m.id]; else kk.picked[m.id] = m.name; kkPickList(); kkChosen(); });
        box.appendChild(b);
      });
      if (q && !list.length) box.appendChild(el("span", "sys-note", "찾는 학생이 없어요."));
    });
  }
  function kkChosen() {
    var ids = Object.keys(kk.picked), p = $("#kkChosen");
    p.textContent = ids.length ? "고른 학생: " : "학생을 찾아서 눌러 고르세요.";
    ids.forEach(function (id) {
      var b = el("button", "sys-chip is-on", kk.picked[id] + " ✕");
      b.type = "button";
      b.addEventListener("click", function () { delete kk.picked[id]; kkPickList(); kkChosen(); });
      p.appendChild(b);
    });
    if (ids.length) api("rpc/admin_member_phones", { method: "POST", body: { p_ids: ids } }).then(function (r) {
      var have = (r.data && r.data.items) || {}, none = ids.filter(function (id) { return !have[id]; });
      if (none.length) p.appendChild(el("span", "sys-msg sys-msg--error", " · 번호 없음: " + none.map(function (id) { return kk.picked[id]; }).join(", ") + " (시트 P열 결제 연락처 확인)"));
    });
    kkPreview();
  }
  function kkWhoMode() {
    var v = $("#kkForm").querySelector("[name=who]:checked").value;
    $("#kkMembers").hidden = v !== "member"; $("#kkConsult").hidden = v !== "consult"; $("#kkDirect").hidden = v !== "direct";
    if (v === "consult" && !kk.consults.length) api("consults?select=id,name,status,created_at,method&order=created_at.desc&limit=60").then(function (r) {
      kk.consults = r.ok ? r.data : [];
      var sel = $("#kkConsultSel");
      sel.textContent = "";
      kk.consults.forEach(function (c) { var o = el("option", null, c.name + " · " + (c.method || "") + " · " + stamp(c.created_at) + " 신청 · " + c.status); o.value = c.id; o.dataset.name = c.name; sel.appendChild(o); });
      if (!kk.consults.length) sel.appendChild(el("option", null, "상담 신청이 없어요"));
      kkPreview();
    });
    kkPreview();
  }
  // 알림톡 문구 예시 (원장님 2026-11-10 "바꿀 수 있는 문구 여러 개") — 고른 뒤 고쳐서 저장 · 복사 → 솔라피 검수 신청
  var KK_WORD = { "상담": "상담 예약", "컨설팅": "오디션 컨설팅", "특강": "특강", "첫 레슨": "첫 레슨", "보강": "보강 레슨" };
  // 원장님 리마인더 문구 (2026-11-11 원장님이 준 4개 그대로, 상담은 같은 말투로 만든 초안)
  var KK_DIRECTOR = {
    "상담": "[이송희보컬레슨학원 상담 리마인더]\n안녕하세요 #{이름}님! 😻\n내일 #{시간}, 이송희보컬레슨학원\n상담이 예정되어 있습니다!\n궁금하신 점을 미리 정리해 오시면\n더 알찬 상담이 될 거예요.\n혹시 일정이 어려우시면\n꼭 미리 연락 주세요!\n내일 뵙겠습니다 💛\n이송희보컬레슨학원 드림",
    "첫 레슨": "[이송희보컬레슨학원 수업 리마인더]\n안녕하세요 #{이름}님! 😻\n내일 #{시간}, #{강사}T와 함께하는\n#{클래스} 1:1 보컬레슨이 시작됩니다!\n목표하시는 오디션을 향해\n저희가 함께 차근차근 준비하겠습니다.\n궁금한 점은 언제든 편하게 문의 주세요!\n내일 뵙겠습니다 💛\n이송희보컬레슨학원 드림",
    "컨설팅": "[이송희보컬레슨학원 컨설팅 리마인더]\n안녕하세요 #{이름}님! 😻\n내일 #{시간}, 이송희 원장님과 함께하는\n1:1 오디션 컨설팅이 진행됩니다!\n현재 실력과 방향을 점검하고\n꼭 필요한 부분을 짚어드릴게요.\n준비하고 계신 곡이나 궁금한 점을\n미리 정리해 오시면 더 알찬 시간이 될 거예요!\n내일 뵙겠습니다 💛\n이송희보컬레슨학원 드림",
    "특강": "[이송희보컬레슨학원 특강 리마인더]\n안녕하세요 #{이름}님! 😻\n내일 #{시간}, #{강사}과 함께하는\n#{특강} 특강이 열립니다!\n오디션 현장에서 바로 써먹을 수 있는\n실전 팁을 가득 담아 준비했어요.\n#{안내}\n늦지 않게 와주시면 감사하겠습니다.\n내일 뵙겠습니다 💛\n이송희보컬레슨학원 드림",
    "보강": "[이송희보컬레슨학원 보강 리마인더]\n안녕하세요 #{이름}님! 😻\n내일 #{시간}, #{강사}T와 함께하는\n보강 수업이 있어요!\n보강은 한 번 잡힌 일정으로 진행되어\n불참 시 추가 보강이 어려운 점\n너그러운 양해 부탁드려요. 🫶🏻\n혹시 일정이 어려우시면\n꼭 미리 연락 주세요!\n소중한 레슨 놓치지 않도록\n내일 꼭 뵐게요 💛\n이송희보컬레슨학원 드림"
  };
  // 원장님 메모 (보내기 전에 할 일)
  var KK_HINT = { "첫 레슨": "📌 첫 레슨 등록할 때 전화번호도 미리 등록해 두기 (시트 P열 결제 연락처, 없으면 '직접 적기')",
    "컨설팅": "📌 컨설팅 참여 학생들을 모아서, 시간이 같은 학생끼리 한 번에 넣기 (시간이 다르면 따로)",
    "특강": "📌 특강 참여 학생들을 모아서, 시간이 같은 학생끼리 한 번에 넣기 · 준비물은 아래 칸에",
    "보강": "📌 강사를 비우면 학생의 담당 선생님 이름으로 보내요", "상담": "" };
  var KK_STYLES = [
    ["원장님 리마인더형", function (k) { return KK_DIRECTOR[k]; }],
    ["기본형", function (k) { return "[이송희보컬레슨] " + k + " 안내\n\n안녕하세요, #{이름}님.\n" + KK_LEAD[k] + "\n\n▶ 일시: #{일시}\n▶ 장소: #{장소}\n▶ 안내: #{안내}\n\n일정 변경이 필요하시면 카카오톡 채널로 미리 말씀해 주세요.\n감사합니다."; }],
    ["짧은 형", function (k) { return "[이송희보컬레슨] #{이름}님, 내일 " + KK_WORD[k] + " 안내입니다.\n\n▶ #{일시}\n▶ #{장소}\n▶ #{안내}\n\n변경은 카카오톡 채널로 연락 주세요."; }],
    ["친절한 형", function (k) { return "안녕하세요, 이송희보컬레슨입니다.\n\n#{이름}님, 내일은 " + KK_WORD[k] + " 날이에요.\n\n▶ 일시: #{일시}\n▶ 장소: #{장소}\n▶ 안내: #{안내}\n\n편하게 오시면 됩니다. 혹시 일정이 어려우시면 카카오톡 채널로 미리 알려 주세요.\n내일 뵙겠습니다. 감사합니다."; }],
    ["준비 안내형", function (k) { return "[이송희보컬레슨] " + k + " 안내\n\n#{이름}님, 내일 " + KK_WORD[k] + " 일정을 안내드립니다.\n\n▶ 일시: #{일시}\n▶ 장소: #{장소}\n▶ 준비할 것 · 안내: #{안내}\n\n시작 10분 전까지 도착해 주세요.\n일정 변경은 카카오톡 채널로 미리 말씀해 주세요.\n감사합니다."; }]
  ];
  var KK_VARS = ["#{이름}", "#{시간}", "#{일시}", "#{강사}", "#{클래스}", "#{특강}", "#{장소}", "#{안내}"];
  function kkTeacher(id) {
    var m = id && (state.members || []).filter(function (x) { return x.id === id; })[0], t = m && teacherOf(m);
    return t === "원장님" ? "이송희" : t || "";
  }
  // 지금 문구에 있는 자리만 칸을 보여 줌
  function kkFields(kind) {
    var f = $("#kkForm"), txt = kkText(kind);
    f.querySelectorAll("[data-var]").forEach(function (lab) { lab.hidden = txt.indexOf(lab.getAttribute("data-var")) < 0; });
    $("#kkMemoLab").textContent = kind === "특강" ? "준비물 (선택)" : "안내 (선택)";
    field(f, "memo").placeholder = kind === "특강" ? "예) 헤어롤 · 거울 챙겨와 주세요!" : "예) 10분 전 도착 · 악보 지참";
    field(f, "teacher").placeholder = kind === "특강" ? "예) 메이크업 김○○ 원장님 (뒤에 '과')" : "비우면 학생의 담당 선생님 (뒤에 'T와')";
    $("#kkHint").textContent = KK_HINT[kind] || "";
    $("#kkHint").hidden = !KK_HINT[kind];
  }
  kk.texts = {};
  function kkText(k) { return kk.texts[k] || KK_STYLES[0][1](k); }
  function kkCheck(v) {
    var bad = (v.match(/#\{[^}]*\}/g) || []).filter(function (x) { return KK_VARS.indexOf(x) < 0; });
    var miss = (v.indexOf("#{시간}") < 0 && v.indexOf("#{일시}") < 0 ? ["#{시간} 또는 #{일시}"] : []);
    if (v.indexOf("#{이름}") < 0) miss.unshift("#{이름}");
    return (bad.length ? "쓸 수 없는 자리: " + bad.join(" ") + " (홈페이지가 채우지 못해요) · " : "") + (miss.length ? "빠진 자리: " + miss.join(" ") + " · " : "") + v.length + " / 1000자";
  }
  function kkDrawTexts() {
    var box = $("#kkTexts");
    box.textContent = "";
    KK_KINDS.forEach(function (k) {
      var card = el("div", "adm__kktext");
      var head = el("div", "adm__kktexthead");
      head.appendChild(el("strong", null, k));
      var pick = el("select");
      pick.setAttribute("aria-label", k + " 예시 문구");
      pick.appendChild(el("option", null, "예시 문구 고르기…"));
      KK_STYLES.forEach(function (st, i) { var o = el("option", null, st[0]); o.value = i; pick.appendChild(o); });
      head.appendChild(pick);
      var copy = el("button", "sys-btn sys-btn--ghost", "복사");
      copy.type = "button";
      head.appendChild(copy);
      card.appendChild(head);
      var ta = el("textarea");
      ta.rows = 14; ta.maxLength = 1000; ta.value = kkText(k); ta.setAttribute("data-kind", k);
      card.appendChild(ta);
      var info = el("p", "sys-note");
      card.appendChild(info);
      var upd = function () { info.textContent = kkCheck(ta.value); info.className = /쓸 수 없는|빠진/.test(info.textContent) ? "sys-msg sys-msg--error" : "sys-note"; };
      ta.addEventListener("input", function () { upd(); kk.texts[k] = ta.value; kkPreview(); });
      pick.addEventListener("change", function () {
        if (pick.value === "" || isNaN(Number(pick.value))) return;
        if (ta.value.trim() && !window.confirm("지금 문구를 '" + KK_STYLES[pick.value][0] + "' 예시로 바꿀까요? (저장 전이면 지금 고친 내용은 사라져요)")) { pick.selectedIndex = 0; return; }
        ta.value = KK_STYLES[pick.value][1](k); kk.texts[k] = ta.value; upd(); kkPreview(); pick.selectedIndex = 0;
      });
      copy.addEventListener("click", function () {
        var done = function (ok) { copy.textContent = ok ? "복사했어요" : "복사 안 됨 · 직접 고르세요"; setTimeout(function () { copy.textContent = "복사"; }, 2000); };
        if (navigator.clipboard) navigator.clipboard.writeText(ta.value).then(function () { done(true); }, function () { ta.select(); done(document.execCommand && document.execCommand("copy")); });
        else { ta.select(); done(document.execCommand && document.execCommand("copy")); }
      });
      upd();
      box.appendChild(card);
    });
  }
  $("#kkTextSave").addEventListener("click", function () {
    var t = {};
    $("#kkTexts").querySelectorAll("textarea").forEach(function (ta) { t[ta.getAttribute("data-kind")] = ta.value; });
    api("rpc/admin_solapi_texts", { method: "POST", body: { p_texts: t } }).then(function (r) {
      var d = r.data || {};
      if (!r.ok || !d.ok) { msg($("#kkTextMsg"), d.error || friendly(r, "저장하지 못했어요."), "error"); return; }
      kk.texts = d.texts || {};
      msg($("#kkTextMsg"), "저장했어요. 이제 '복사'로 솔라피에 붙여넣어 검수 신청하세요.", "ok");
    });
  });
  function loadKakao() {
    var f = $("#kkForm");
    if (!field(f, "day").value) field(f, "day").value = addDays(todayKst(), 1);
    api("rpc/admin_solapi_status", { method: "POST", body: {} }).then(function (r) {
      var d = r.data || {};
      if (!r.ok || !d.ok) { $("#kkState").textContent = d.error || "불러오지 못했어요."; return; }
      var tpl = d.templates || {}, missing = KK_KINDS.filter(function (k) { return !tpl[k]; });
      kk.texts = d.texts || {};
      kkDrawTexts();
      kkPreview();
      $("#kkState").textContent = (d.connected ? "✅ 솔라피 연결됨 (" + d.key_tail + (d.sender ? " · 발신 " + d.sender : " · 발신번호 없음") + (d.pf_id ? "" : " · 채널 pfId 없음") + ")" : "⚠️ 솔라피 연결 전 — 아래 설정에서 연결해 주세요")
        + " · " + (d.enabled ? "자동 발송 켜짐 (전날 " + d.send_hour + "시)" : "자동 발송 꺼짐") + (missing.length ? " · 템플릿 ID 없음: " + missing.join(", ") : "")
        + " · 시트에서 받은 번호 " + d.contacts + "명" + (d.last_note ? " · 마지막 발송 " + stamp(d.last_run_at) + " " + d.last_note : "");
      var rows = $("#kkTplRows");
      rows.textContent = "";
      KK_KINDS.forEach(function (k) {
        var lab = el("label", "sys-field"), inp = el("input");
        inp.name = k; inp.value = tpl[k] || ""; inp.placeholder = "KA01TP…"; inp.autocomplete = "off";
        lab.appendChild(el("span", null, k));
        lab.appendChild(inp);
        rows.appendChild(lab);
      });
      $("#kkOn").checked = !!d.enabled;
    });
    var list = $("#kkList");
    list.textContent = "";
    list.appendChild(el("li", "sys-empty", "불러오는 중…"));
    api("rpc/admin_reminders", { method: "POST", body: { p_from: addDays(todayKst(), -7) } }).then(function (r) {
      var d = r.data || {};
      list.textContent = "";
      if (!r.ok || !d.ok) { list.appendChild(el("li", "sys-msg sys-msg--error", d.error || friendly(r, "불러오지 못했어요."))); return; }
      if (!d.items.length) { list.appendChild(el("li", "sys-empty", "넣은 일정이 없어요.")); return; }
      d.items.forEach(function (x) {
        var li = el("li", "adm__card adm__kkrow adm__kkrow--" + ({ "예정": "wait", "보냄": "sent", "실패": "fail", "취소": "off" }[x.status] || "wait")), top = el("div", "adm__cardtop");
        top.appendChild(el("strong", null, x.when));
        top.appendChild(el("span", "adm__badge adm__badge--kind", x.kind));
        top.appendChild(el("span", null, x.name + (x.member ? " (" + x.member + ")" : "")));
        top.appendChild(el("span", "adm__badge", x.status));
        li.appendChild(top);
        li.appendChild(el("p", "sys-note", (x.phone ? "📱 " + x.phone : "⚠️ 번호 없음") + (x.teacher ? " · 강사 " + x.teacher : "") + (x.track ? " · " + x.track : "") + (x.topic ? " · " + x.topic + " 특강" : "")
          + (x.place ? " · " + x.place : "") + (x.memo ? " · " + x.memo : "")
          + (x.sent_at ? " · 보낸 시각 " + stamp(x.sent_at) : "") + (x.result && x.status !== "보냄" ? " · " + x.result : "")));
        var acts = el("div", "adm__acts"), note = el("p", "sys-msg");
        if (x.status !== "취소") {
          var send = el("button", "sys-btn sys-btn--ghost", x.status === "보냄" ? "한 번 더 보내기" : "지금 보내기");
          send.type = "button";
          send.addEventListener("click", function () {
            if (send.getAttribute("data-armed") !== "1") { send.setAttribute("data-armed", "1"); send.textContent = "한 번 더 누르면 보내요"; return; }
            send.disabled = true;
            api("rpc/admin_reminder_send", { method: "POST", body: { p_id: x.id } }).then(function (rr) {
              var dd = rr.data || {};
              if (rr.ok && dd.ok) loadKakao(); else { send.disabled = false; msg(note, dd.error || friendly(rr, "보내지 못했어요."), "error"); }
            });
          });
          acts.appendChild(send);
        }
        if (x.status === "예정" || x.status === "실패") {
          var cancel = el("button", "sys-link", "취소 (안 보내기)");
          cancel.type = "button";
          cancel.addEventListener("click", function () { api("rpc/admin_reminder_cancel", { method: "POST", body: { p_id: x.id } }).then(loadKakao); });
          acts.appendChild(cancel);
        }
        var del = el("button", "sys-link", "지우기");
        del.type = "button";
        del.addEventListener("click", function () {
          if (del.getAttribute("data-armed") !== "1") { del.setAttribute("data-armed", "1"); del.textContent = "한 번 더 누르면 지워요"; return; }
          api("rpc/admin_reminder_cancel", { method: "POST", body: { p_id: x.id, p_delete: true } }).then(loadKakao);
        });
        acts.appendChild(del);
        li.appendChild(acts);
        li.appendChild(note);
        list.appendChild(li);
      });
    });
  }
  (function () {
    var f = $("#kkForm");
    f.querySelectorAll("[name=who]").forEach(function (r) { r.addEventListener("change", kkWhoMode); });
    ["kind", "day", "time", "place", "memo", "teacher", "track", "topic"].forEach(function (n) { field(f, n).addEventListener("input", kkPreview); field(f, n).addEventListener("change", kkPreview); });
    $("#kkName").addEventListener("input", kkPreview);
    $("#kkConsultSel").addEventListener("change", kkPreview);
    var t = null;
    $("#kkFind").addEventListener("input", function () { clearTimeout(t); t = setTimeout(kkPickList, 200); });
    kkChosen();
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var who = f.querySelector("[name=who]:checked").value, day = field(f, "day").value, time = field(f, "time").value;
      var kind = field(f, "kind").value, txt = kkText(kind), has = function (v) { return txt.indexOf(v) >= 0; };
      var body = { p_id: null, p_kind: kind, p_at: day + "T" + time + ":00+09:00", p_place: has("#{장소}") ? field(f, "place").value : null, p_memo: has("#{안내}") ? field(f, "memo").value : null,
        p_teacher: has("#{강사}") ? field(f, "teacher").value : null, p_track: has("#{클래스}") ? field(f, "track").value : null, p_topic: has("#{특강}") ? field(f, "topic").value : null };
      if (who === "member") { body.p_members = Object.keys(kk.picked); if (!body.p_members.length) { msg($("#kkMsg"), "학생을 골라주세요.", "error"); return; } }
      if (has("#{특강}") && !String(body.p_topic || "").trim()) { msg($("#kkMsg"), "특강 주제를 적어주세요. (예: 헤어메이크업)", "error"); return; }
      if (has("#{강사}") && !String(body.p_teacher || "").trim()) {
        var noT = who === "member" ? body.p_members.filter(function (id) { return !kkTeacher(id); }) : [1];
        if (noT.length) { msg($("#kkMsg"), "강사 이름을 적어주세요." + (who === "member" ? " (담당 선생님이 없는 학생: " + noT.map(function (id) { return kk.picked[id]; }).join(", ") + ")" : ""), "error"); return; }
      }
      if (who === "consult") body.p_consult = Number($("#kkConsultSel").value) || null;
      if (who === "direct") { body.p_name = $("#kkName").value; body.p_phone = $("#kkPhone").value; }
      api("rpc/admin_reminder_save", { method: "POST", body: body }).then(function (r) {
        var d = r.data || {};
        if (!r.ok || !d.ok) { msg($("#kkMsg"), d.error || friendly(r, "넣지 못했어요."), "error"); return; }
        msg($("#kkMsg"), d.count + "건 넣었어요. 전날 오후 6시에 저절로 보내요.", "ok");
        kk.picked = {}; $("#kkFind").value = ""; kkPickList(); kkChosen(); field(f, "memo").value = ""; field(f, "teacher").value = ""; field(f, "topic").value = "";
        loadKakao();
      });
    });
    $("#kkConn").addEventListener("submit", function (e) {
      e.preventDefault();
      var c = e.target, m = $("#kkConnMsg");
      msg(m, "확인하는 중…");
      api("rpc/admin_solapi_set", { method: "POST", body: { p_key: field(c, "key").value, p_secret: field(c, "secret").value, p_sender: field(c, "sender").value, p_pf: field(c, "pf").value } }).then(function (r) {
        var d = r.data || {};
        if (!r.ok || !d.ok) { msg(m, d.error || friendly(r, "연결하지 못했어요."), "error"); return; }
        c.reset();
        msg(m, "연결됐어요." + (d.balance != null ? " 솔라피 잔액 " + Number(d.balance).toLocaleString("ko-KR") + "원" : ""), "ok");
        loadKakao();
      });
    });
    $("#kkOff").addEventListener("click", function () {
      if (!window.confirm("솔라피 연결을 끊을까요? 자동 발송도 꺼져요.")) return;
      api("rpc/admin_solapi_off", { method: "POST", body: {} }).then(loadKakao);
    });
    $("#kkTpl").addEventListener("submit", function (e) {
      e.preventDefault();
      var t2 = {};
      $("#kkTplRows").querySelectorAll("input").forEach(function (i) { t2[i.name] = i.value.trim(); });
      api("rpc/admin_solapi_options", { method: "POST", body: { p_templates: t2, p_enabled: $("#kkOn").checked } }).then(function (r) {
        var d = r.data || {};
        if (!r.ok || !d.ok) { msg($("#kkTplMsg"), d.error || friendly(r, "저장하지 못했어요."), "error"); return; }
        msg($("#kkTplMsg"), "저장했어요.", "ok");
        loadKakao();
      });
    });
  })();

  // 보컬오락실 이벤트 순위 (원장님 2026-11-10)
  var GAME_NAMES = { solfa: ["👂 계이름 맞히기", "점"], simon: ["👂 멜로디 따라치기", "점"], fly: ["🎤 목소리로 날아라", "점"] };
  function kstDay(iso) {
    var d = new Date(new Date(iso).getTime() + 9 * 3600000), wd = "일월화수목금토";
    return (d.getUTCMonth() + 1) + "/" + d.getUTCDate() + "(" + wd[d.getUTCDay()] + ")";
  }
  function loadGameEvent() {
    var box = $("#gameEventBoard");
    box.textContent = "";
    box.appendChild(el("p", "sys-empty", "불러오는 중…"));
    api("rpc/admin_game_board", { method: "POST", body: {} }).then(function (res) {
      var d = res.data || {};
      box.textContent = "";
      if (!res.ok || !d.ok) { box.appendChild(el("p", "sys-msg sys-msg--error", d.error || friendly(res, "불러오지 못했어요."))); return; }
      if (!d.event) { $("#gameEventWhen").textContent = "진행 중인 이벤트가 없어요."; return; }
      var ev = d.event, now = Date.now();
      $("#gameEventWhen").textContent = "기간 " + kstDay(ev.starts) + " 0시 ~ " + kstDay(ev.ends) + " 밤 11:59 · "
        + (ev.enabled === false ? "꺼져 있음 (학생 화면에 안 보이고 점수도 안 받아요)" : now < new Date(ev.starts).getTime() ? "시작 전" : now > new Date(ev.ends).getTime() ? "끝남" : "진행 중") + " · 참여 " + (ev.players || 0) + "명";
      (ev.games || []).forEach(function (g) {
        var info = GAME_NAMES[g] || [g, "점"], rows = (d.board || {})[g] || [];
        var col = el("div", "adm__gamecol");
        col.appendChild(el("h4", null, info[0]));
        if (!rows.length) { col.appendChild(el("p", "sys-empty", "아직 기록이 없어요.")); box.appendChild(col); return; }
        var ol = el("ol", "adm__gamerank");
        rows.forEach(function (r, i) {
          var li = el("li", i === 0 ? "is-first" : "");
          li.appendChild(el("b", null, (i === 0 ? "🏆 " : "") + Number(r.score).toLocaleString("ko-KR") + info[1]));
          li.appendChild(el("span", null, " " + r.name + " (" + r.id + ")" + (r.teacher ? " · 담당 " + r.teacher : "")));
          li.appendChild(el("small", null, " · " + logTime(r.at) + " · " + r.plays + "판"));
          ol.appendChild(li);
        });
        col.appendChild(ol);
        box.appendChild(col);
      });
    });
  }
  $("#gameEventReload").addEventListener("click", function () { loadGameEvent(); });

  function loadLog(more) {
    var list = $("#logList"), last = logState.items[logState.items.length - 1];
    if (!more) { list.textContent = ""; list.appendChild(el("li", "sys-empty", "불러오는 중…")); logState.items = []; }
    var body = { p_before: more && last ? last.id : null, p_actor: $("#logActor").value || null, p_tbl: $("#logTbl").value || null,
      p_find: $("#logFind").value.trim() || null, p_limit: 100 };
    api("rpc/admin_log", { method: "POST", body: body }).then(function (res) {
      var d = res.data || {};
      if (!res.ok || !d.ok) { list.textContent = ""; list.appendChild(el("li", "sys-msg sys-msg--error", d.error || friendly(res, "불러오지 못했어요."))); return; }
      var a = $("#logActor"), keepA = a.value;
      a.length = 1;
      (d.actors || []).sort().forEach(function (x) { var o = el("option", null, x); o.value = x; a.appendChild(o); });
      a.value = keepA;
      var t = $("#logTbl");
      if (t.length === 1) Object.keys(LOG_TBL).sort(function (x, y) { return LOG_TBL[x].localeCompare(LOG_TBL[y], "ko"); })
        .forEach(function (k) { var o = el("option", null, LOG_TBL[k]); o.value = k; t.appendChild(o); });
      logState.items = logState.items.concat(d.items || []);
      $("#logMore").hidden = (d.items || []).length < 100;
      drawLog();
    });
  }
  function logTime(iso) {
    var x = new Date(iso);
    return (x.getMonth() + 1) + "/" + x.getDate() + " " + String(x.getHours()).padStart(2, "0") + ":" + String(x.getMinutes()).padStart(2, "0");
  }
  function drawLog() {
    var list = $("#logList");
    list.textContent = "";
    if (!logState.items.length) { list.appendChild(el("li", "sys-empty", "아직 기록이 없어요.")); return; }
    logState.items.forEach(function (r) {
      var li = el("li", "adm__card adm__logrow adm__logrow--" + r.action);
      var h = el("p", "adm__loghead");
      h.appendChild(el("span", "adm__logtime", logTime(r.at)));
      h.appendChild(el("b", null, (LOG_TBL[r.tbl] || r.tbl) + " " + (LOG_ACT[r.action] || r.action) + (r.n > 1 ? " " + r.n + "건" : "")));
      h.appendChild(el("span", "adm__logwho", r.actor));
      li.appendChild(h);
      var labels = (r.labels && r.labels.length ? r.labels : [r.label]).filter(Boolean);
      if (labels.length) li.appendChild(el("p", "adm__logwhat", labels.join(", ") + (r.n > labels.length && r.n > 1 ? " 외" : "")));
      var ch = r.changes || {};
      var parts = Object.keys(ch).map(function (k) {
        var nm = LOG_COL[k] || k, v = ch[k];
        if (Array.isArray(v)) {
          var f = function (s) { return s == null || s === "" ? "(없음)" : s === "true" ? "켬" : s === "false" ? "끔" : s; };
          return nm + ": " + f(v[0]) + " → " + f(v[1]);
        }
        return nm + " 바뀜";
      });
      if (parts.length) li.appendChild(el("p", "adm__logch", parts.join(" · ")));
      if (r.n > 1 && r.first && r.first !== r.at) li.appendChild(el("p", "sys-note adm__logspan", logTime(r.first) + " ~ " + logTime(r.at)));
      list.appendChild(li);
    });
  }
  $("#logActor").addEventListener("change", function () { loadLog(); });
  $("#logTbl").addEventListener("change", function () { loadLog(); });
  var logFindTimer = null;
  $("#logFind").addEventListener("input", function () { clearTimeout(logFindTimer); logFindTimer = setTimeout(function () { loadLog(); }, 400); });
  $("#logMore").addEventListener("click", function () { loadLog(true); });

  /* ---------------- 건의함 (익명) ---------------- */
  function countSuggest() {
    api("rpc/admin_suggest_count", { method: "POST", body: {} }).then(function (res) { if (res.ok) setBadge("#suggestBadge", Number(res.data) || 0); });
  }
  function loadSuggest() {
    var list = $("#suggestList");
    list.textContent = "";
    api("rpc/admin_suggestions", { method: "POST", body: {} }).then(function (res) {
      var d = res.data || {};
      if (!res.ok || !d.ok) { list.appendChild(el("li", "sys-msg sys-msg--error", d.error || friendly(res, "불러오지 못했습니다."))); return; }
      var only = $("#suggestFilter").value === "new";
      var items = (d.items || []).filter(function (s) { return !only || !s.read; });
      if (!items.length) { list.appendChild(el("li", "sys-empty", only ? "안 읽은 건의가 없어요." : "아직 건의가 없어요.")); return; }
      items.forEach(function (s) {
        var li = el("li", "adm__card" + (s.read ? " is-hidden" : ""));
        var top = el("div", "adm__cardtop");
        top.appendChild(el("span", "adm__badge adm__badge--kind", s.topic));
        top.appendChild(el("strong", null, s.day));
        if (!s.read) top.appendChild(el("span", "adm__kakao", "새 건의"));
        li.appendChild(top);
        li.appendChild(el("p", "adm__quote", s.body));
        var row = el("div", "adm__cardrow");
        var mark = el("button", "sys-btn", s.read ? "안 읽음으로" : "읽음");
        mark.type = "button";
        mark.addEventListener("click", function () {
          api("rpc/admin_suggest_mark", { method: "POST", body: { p_id: s.id, p_read: !s.read } }).then(function () { loadSuggest(); countSuggest(); });
        });
        var del = el("button", "sys-link adm__del", "지우기");
        del.type = "button";
        del.addEventListener("click", function () {
          if (del.getAttribute("data-armed") !== "1") { del.setAttribute("data-armed", "1"); del.textContent = "한 번 더 누르면 지워요"; return; }
          api("rpc/admin_suggest_delete", { method: "POST", body: { p_id: s.id } }).then(function () { loadSuggest(); countSuggest(); });
        });
        row.appendChild(mark);
        row.appendChild(del);
        li.appendChild(row);
        list.appendChild(li);
      });
    });
  }
  $("#suggestFilter").addEventListener("change", loadSuggest);

  /* ---------------- 학부모 (원장님 2026-11-05) ----------------
     요청(parent_requests) → 자녀(수강 ID) 골라 승인(admin_parent_decide) → parents + parent_links.
     연결된 학부모: 자녀 더하기 · 빼기(parent_links), 연결 끊기(parents 삭제 → 그 학부모 메시지도 같이 지워짐). */
  function countParents() {
    api("parent_requests?select=id&status=eq." + encodeURIComponent("대기")).then(function (res) { if (res.ok) setBadge("#parentBadge", res.data.length); });
  }
  var parentMembers = [];
  function memberChooser(picked, onChange) {
    // 이름으로 찾아 고르기 (재원 · 휴원 · 외부)
    var wrap = el("div", "par-pick");
    var chips = el("div", "par-pick__chips");
    var find = el("input");
    find.type = "search";
    find.placeholder = "학생 이름으로 찾아 더하기";
    var hits = el("ul", "par-pick__hits");
    function draw() {
      chips.textContent = "";
      if (!picked.length) chips.appendChild(el("span", "sys-note", "고른 자녀가 없어요."));
      picked.forEach(function (id) {
        var m = parentMembers.filter(function (x) { return x.id === id; })[0];
        var c = el("span", "par-pick__chip", (m ? m.name : id) + (m && /담당\s*(\S+)/.test(m.memo || "") ? " · " + /담당\s*([^\s·,]+)/.exec(m.memo)[1] : ""));
        var x = el("button", "sys-link", "빼기");
        x.type = "button";
        x.addEventListener("click", function () { picked.splice(picked.indexOf(id), 1); draw(); onChange && onChange(); });
        c.appendChild(x);
        chips.appendChild(c);
      });
    }
    find.addEventListener("input", function () {
      hits.textContent = "";
      var q = find.value.trim();
      if (!q) return;
      parentMembers.filter(function (m) { return m.name.indexOf(q) !== -1 && picked.indexOf(m.id) === -1; }).slice(0, 8).forEach(function (m) {
        var li = el("li");
        var b = el("button", "sys-link", m.name + (m.memo ? " · " + m.memo : "") + (m.status !== "재원" ? " · " + m.status : ""));
        b.type = "button";
        b.addEventListener("click", function () { picked.push(m.id); find.value = ""; hits.textContent = ""; draw(); onChange && onChange(); });
        li.appendChild(b);
        hits.appendChild(li);
      });
    });
    wrap.appendChild(chips);
    wrap.appendChild(find);
    wrap.appendChild(hits);
    draw();
    return wrap;
  }
  function loadParents() {
    var reqs = $("#parentReqs"), list = $("#parentList");
    reqs.textContent = "";
    list.textContent = "";
    Promise.all([
      api("members?select=id,name,status,memo&status=neq." + encodeURIComponent("종료") + "&order=name"),
      api("parent_requests?select=*&status=eq." + encodeURIComponent("대기") + "&order=created_at"),
      api("parents?select=id,name,kakao_name,created_at,parent_links(member_id,members(name,status,memo))&order=name")
    ]).then(function (r) {
      parentMembers = r[0].ok ? r[0].data : [];
      var waiting = r[1].ok ? r[1].data : [];
      setBadge("#parentBadge", waiting.length);
      if (!waiting.length) reqs.appendChild(el("li", "sys-empty", "기다리는 요청이 없어요."));
      waiting.forEach(function (q) {
        var li = el("li", "adm__card");
        var top = el("div", "adm__cardtop");
        top.appendChild(el("strong", null, q.name));
        if (q.kakao_name) top.appendChild(el("span", "sys-note", "카카오 " + q.kakao_name));
        top.appendChild(el("span", "sys-note", msgWhen(q.created_at)));
        li.appendChild(top);
        li.appendChild(el("p", "adm__quote", "적은 자녀: " + q.children));
        // 적힌 이름과 글자까지 같은 학생을 먼저 골라 둠 (같은 이름이 둘이면 둘 다 → 원장님이 하나 빼기)
        var names = q.children.split(/[,，、·\/\s]+/).map(function (x) { return x.replace(/(학생|님)$/, "").trim(); }).filter(Boolean);
        var picked = parentMembers.filter(function (m) { return names.indexOf(m.name) !== -1; }).map(function (m) { return m.id; });
        var same = {};
        picked.forEach(function (id) { var n = parentMembers.filter(function (m) { return m.id === id; })[0].name; same[n] = (same[n] || 0) + 1; });
        li.appendChild(memberChooser(picked));
        if (Object.keys(same).some(function (n) { return same[n] > 1; })) li.appendChild(el("p", "sys-msg sys-msg--error", "같은 이름 학생이 둘 이상이에요. 담당 선생님을 보고 아닌 학생은 빼주세요."));
        var row = el("div", "adm__cardrow");
        var ok = el("button", "sys-btn", "승인");
        ok.type = "button";
        var no = el("button", "sys-link adm__del", "거절");
        no.type = "button";
        var note = el("span", "sys-msg");
        ok.addEventListener("click", function () {
          if (!picked.length) { msg(note, "자녀(학생)를 한 명 이상 골라주세요.", "error"); return; }
          ok.disabled = true;
          api("rpc/admin_parent_decide", { method: "POST", body: { p_req: q.id, p_members: picked, p_ok: true } }).then(function (res) {
            var d = res.data || {};
            if (!res.ok || !d.ok) { ok.disabled = false; msg(note, d.error || friendly(res, "승인하지 못했습니다."), "error"); return; }
            loadParents();
          });
        });
        no.addEventListener("click", function () {
          if (no.getAttribute("data-armed") !== "1") { no.setAttribute("data-armed", "1"); no.textContent = "한 번 더 누르면 거절"; return; }
          api("rpc/admin_parent_decide", { method: "POST", body: { p_req: q.id, p_members: [], p_ok: false } }).then(loadParents);
        });
        row.appendChild(ok);
        row.appendChild(no);
        row.appendChild(note);
        li.appendChild(row);
        reqs.appendChild(li);
      });
      var parents = r[2].ok ? r[2].data : [];
      if (!parents.length) list.appendChild(el("li", "sys-empty", "아직 연결된 학부모가 없어요."));
      parents.forEach(function (p) {
        var li = el("li", "adm__card");
        var top = el("div", "adm__cardtop");
        top.appendChild(el("strong", null, p.name));
        if (p.kakao_name) top.appendChild(el("span", "sys-note", "카카오 " + p.kakao_name));
        li.appendChild(top);
        var before = (p.parent_links || []).map(function (l) { return l.member_id; });
        var picked = before.slice();
        var save = el("button", "sys-btn", "자녀 바꾼 것 저장");
        save.type = "button";
        save.hidden = true;
        li.appendChild(memberChooser(picked, function () { save.hidden = false; }));
        var row = el("div", "adm__cardrow");
        var note = el("span", "sys-msg");
        save.addEventListener("click", function () {
          save.disabled = true;
          var add = picked.filter(function (id) { return before.indexOf(id) === -1; });
          var gone = before.filter(function (id) { return picked.indexOf(id) === -1; });
          var jobs = [];
          if (add.length) jobs.push(api("parent_links", { method: "POST", body: add.map(function (id) { return { parent_id: p.id, member_id: id }; }) }));
          gone.forEach(function (id) { jobs.push(api("parent_links?parent_id=eq." + p.id + "&member_id=eq." + encodeURIComponent(id), { method: "DELETE" })); });
          Promise.all(jobs).then(function (rs) {
            save.disabled = false;
            if (rs.some(function (x) { return !x.ok; })) { msg(note, "저장하지 못한 것이 있어요. 다시 해주세요.", "error"); return; }
            loadParents();
          });
        });
        var cut = el("button", "sys-link adm__del", "연결 끊기");
        cut.type = "button";
        cut.addEventListener("click", function () {
          if (cut.getAttribute("data-armed") !== "1") { cut.setAttribute("data-armed", "1"); cut.textContent = "한 번 더 누르면 끊어요 (이 학부모에게 보낸 메시지도 지워져요)"; return; }
          // 요청 기록을 먼저 지우고(다시 요청할 수 있게) 학부모 연결을 지워요
          api("parent_requests?parent_id=eq." + p.id, { method: "DELETE" }).then(function () {
            return api("parents?id=eq." + p.id, { method: "DELETE" });
          }).then(function (res) {
            if (!res.ok) { msg(note, friendly(res, "끊지 못했습니다."), "error"); return; }
            loadParents();
          });
        });
        row.appendChild(save);
        row.appendChild(cut);
        row.appendChild(note);
        li.appendChild(row);
        list.appendChild(li);
      });
    });
  }
  $("#parentCopy").addEventListener("click", function () {
    var url = location.origin + location.pathname.replace(/admin\.html$/, "") + "parent.html";
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () {
      msg($("#parentCopyMsg"), "복사했어요: " + url, "ok");
    }, function () { msg($("#parentCopyMsg"), url, "ok"); });
  });

  /* ---------------- 메시지 (학원 → 학생 · 선생님, 원장님 2026-11-05) ----------------
     한 사람에게 한 줄 (messages 표, RLS: 관리자만 쓰고 읽음). 같이 보낸 것은 목록에서 한 카드로 묶어요. */
  var msgState = { to: "member", people: { member: [], teacher: [], parent: [] }, picked: {} };
  function msgTeacherOf(m) { var t = /담당\s*([^\s·,]+)/.exec(m.memo || ""); return t ? t[1] : ""; }
  function msgKey(kind, id) { return kind + ":" + id; }
  /* 선생님 → 학원 (admin_inbox, 원장님 2026-11-05): 탭을 열면 읽음, 답장 = 그 선생님에게 보내기 */
  function countInbox() {
    api("admin_inbox?select=id&read_at=is.null").then(function (res) { if (res.ok) setBadge("#msgBadge", res.data.length); });
  }
  function loadInbox() {
    var ul = $("#msgInbox");
    ul.textContent = "";
    api("admin_inbox?select=id,teacher_id,body,created_at,read_at,teachers(name)&order=created_at.desc&limit=100").then(function (res) {
      if (!res.ok) { ul.appendChild(el("li", "sys-msg sys-msg--error", friendly(res, "불러오지 못했습니다."))); return; }
      if (!res.data.length) { ul.appendChild(el("li", "sys-empty", "아직 받은 메시지가 없어요.")); return; }
      var unread = [];
      var shown = 0;
      res.data.forEach(function (m) {
        var li = el("li", "adm__card" + (m.read_at ? "" : " msg-in--new"));
        if (m.read_at && shown >= 10) { li.hidden = true; li.classList.add("msg-in--more"); }
        shown++;
        var top = el("div", "adm__cardtop");
        top.appendChild(el("strong", null, ((m.teachers && m.teachers.name) || "") + " 선생님"));
        top.appendChild(el("span", "sys-note", msgWhen(m.created_at)));
        if (!m.read_at) { top.appendChild(el("span", "adm__kakao", "새 메시지")); unread.push(m.id); }
        li.appendChild(top);
        li.appendChild(el("p", "adm__quote msg-sent__body", m.body));
        var row = el("div", "adm__cardrow");
        var rep = el("button", "sys-btn", "답장");
        rep.type = "button";
        rep.addEventListener("click", function () {
          var r = document.querySelector('input[name="msgTo"][value="teacher"]');
          r.checked = true;
          msgState.to = "teacher";
          msgState.picked = {};
          msgState.picked[msgKey("teacher", m.teacher_id)] = true;
          $("#msgFind").value = "";
          renderMsgPick();
          $("#msgBody").focus();
          $("#msgBody").scrollIntoView({ behavior: "smooth", block: "center" });
        });
        row.appendChild(rep);
        row.appendChild(deleteButton("admin_inbox", m.id, loadInbox));
        li.appendChild(row);
        ul.appendChild(li);
      });
      if (ul.querySelector(".msg-in--more")) {
        var more = el("button", "sys-link", "지난 메시지 더 보기");
        more.type = "button";
        more.addEventListener("click", function () { ul.querySelectorAll(".msg-in--more").forEach(function (x) { x.hidden = false; }); more.remove(); });
        ul.appendChild(more);
      }
      if (unread.length) {
        api("admin_inbox?id=in.(" + unread.join(",") + ")", { method: "PATCH", body: { read_at: new Date().toISOString() } }).then(function () { setBadge("#msgBadge", 0); });
      }
    });
  }
  function loadMessages() {
    loadInbox();
    try { $("#msgSender").value = localStorage.getItem("leesh-admin-msg-sender") || "학원"; } catch (e) { /* private mode */ }
    Promise.all([
      api("members?select=id,name,status,memo,kakao_user&status=in.(" + encodeURIComponent("재원") + "," + encodeURIComponent("휴원") + ")&order=name"),
      api("teachers?select=id,name,active,kakao_user&active=is.true&order=name"),
      api("parents?select=id,name,kakao_user,parent_links(member_id,members(name,memo))&order=name")
    ]).then(function (r) {
      msgState.people.member = r[0].ok ? r[0].data : [];
      msgState.people.teacher = r[1].ok ? r[1].data : [];
      // 학부모: 이름 옆에 자녀 이름, 담당 거르기는 자녀의 담당으로
      msgState.people.parent = (r[2].ok ? r[2].data : []).map(function (p) {
        var kids = (p.parent_links || []).map(function (l) { return l.members || {}; });
        return { id: p.id, name: p.name, kakao_user: p.kakao_user, kids: kids.map(function (k) { return k.name; }).filter(Boolean),
          memo: kids.map(function (k) { return k.memo || ""; }).join(" · ") };
      });
      var sel = $("#msgTeacherFilter"), keep = sel.value;
      sel.textContent = "";
      sel.appendChild(el("option", null, "담당 전체")).value = "";
      var names = {};
      msgState.people.member.forEach(function (m) { var t = msgTeacherOf(m); if (t) names[t] = 1; });
      Object.keys(names).sort().forEach(function (t) { var o = el("option", null, "담당 " + t); o.value = t; sel.appendChild(o); });
      sel.value = keep;
      renderMsgPick();
    });
    loadSentMessages();
  }
  function msgVisible() {
    var q = $("#msgFind").value.trim(), t = $("#msgTeacherFilter").value;
    return msgState.people[msgState.to].filter(function (p) {
      if (q && p.name.indexOf(q) === -1 && !(p.kids || []).some(function (k) { return k.indexOf(q) !== -1; })) return false;
      if (msgState.to === "parent" && t && (p.memo || "").indexOf("담당 " + t) === -1) return false;
      if (msgState.to === "member" && t && msgTeacherOf(p) !== t) return false;
      return true;
    });
  }
  function msgPickedList() {
    return Object.keys(msgState.picked).filter(function (k) { return msgState.picked[k]; });
  }
  function msgUpdateCount() {
    var keys = msgPickedList();
    function cnt(pre) { return keys.filter(function (k) { return k.indexOf(pre + ":") === 0; }).length; }
    var st = cnt("member"), te = cnt("teacher"), pa = cnt("parent");
    $("#msgCount").textContent = keys.length ? "받는 사람 " + [st ? "학생 " + st + "명" : "", te ? "선생님 " + te + "명" : "", pa ? "학부모 " + pa + "명" : ""].filter(Boolean).join(" · ") : "받는 사람을 골라주세요.";
    var n = $("#msgBody").value.trim().length;
    $("#msgLen").textContent = $("#msgBody").value.length + " / 2000";
    $("#msgSend").disabled = !keys.length || !n;
  }
  function renderMsgPick() {
    var ul = $("#msgPick");
    ul.textContent = "";
    $("#msgTeacherFilter").hidden = msgState.to === "teacher";
    var list = msgVisible();
    if (!list.length) ul.appendChild(el("li", "sys-empty", msgState.to === "member" ? "맞는 학생이 없어요." : msgState.to === "parent" ? "연결된 학부모가 없어요. 학부모 탭에서 승인하면 여기에 보여요." : "맞는 선생님이 없어요."));
    list.forEach(function (p) {
      var key = msgKey(msgState.to, p.id);
      var li = el("li");
      var lab = el("label", "msg-pick__item");
      var cb = el("input");
      cb.type = "checkbox";
      cb.checked = !!msgState.picked[key];
      cb.addEventListener("change", function () { msgState.picked[key] = cb.checked; msgUpdateCount(); });
      lab.appendChild(cb);
      lab.appendChild(el("b", null, p.name));
      if (msgState.to === "member") {
        var t = msgTeacherOf(p);
        if (t) lab.appendChild(el("span", "msg-pick__sub", t));
        if (p.status !== "재원") lab.appendChild(el("span", "msg-pick__sub", p.status));
      }
      if (msgState.to === "parent" && p.kids.length) lab.appendChild(el("span", "msg-pick__sub", "자녀 " + p.kids.join(", ")));
      if (!p.kakao_user) lab.appendChild(el("span", "msg-pick__off", "아직 카카오 연결 전"));
      li.appendChild(lab);
      ul.appendChild(li);
    });
    msgUpdateCount();
  }
  document.querySelectorAll('input[name="msgTo"]').forEach(function (r) {
    r.addEventListener("change", function () { if (r.checked) { msgState.to = r.value; renderMsgPick(); } });
  });
  $("#msgTeacherFilter").addEventListener("change", renderMsgPick);
  $("#msgFind").addEventListener("input", renderMsgPick);
  $("#msgAll").addEventListener("click", function () { msgVisible().forEach(function (p) { msgState.picked[msgKey(msgState.to, p.id)] = true; }); renderMsgPick(); });
  $("#msgNone").addEventListener("click", function () { msgState.picked = {}; renderMsgPick(); });
  $("#msgBody").addEventListener("input", msgUpdateCount);
  $("#msgSender").addEventListener("change", function () { try { localStorage.setItem("leesh-admin-msg-sender", $("#msgSender").value); } catch (e) { /* private mode */ } });
  $("#msgSend").addEventListener("click", function () {
    var keys = msgPickedList(), body = $("#msgBody").value.trim(), sender = $("#msgSender").value;
    if (!keys.length || !body) return;
    var btn = $("#msgSend");
    if (btn.getAttribute("data-armed") !== "1") {
      btn.setAttribute("data-armed", "1");
      btn.textContent = keys.length + "명에게 보내기 (한 번 더 누르기)";
      setTimeout(function () { btn.removeAttribute("data-armed"); btn.textContent = "보내기"; }, 5000);
      return;
    }
    btn.removeAttribute("data-armed");
    btn.textContent = "보내는 중…";
    btn.disabled = true;
    var rows = keys.map(function (k) {
      var kind = k.split(":")[0], id = k.slice(kind.length + 1);
      return kind === "member" ? { to_member: id, sender: sender, body: body }
        : kind === "parent" ? { to_parent: Number(id), sender: sender, body: body } : { to_teacher: Number(id), sender: sender, body: body };
    });
    api("messages", { method: "POST", body: rows }).then(function (res) {
      btn.textContent = "보내기";
      if (!res.ok) { msg($("#msgSendMsg"), friendly(res, "보내지 못했습니다."), "error"); msgUpdateCount(); return; }
      msg($("#msgSendMsg"), rows.length + "명에게 보냈어요.", "ok");
      $("#msgBody").value = "";
      msgState.picked = {};
      renderMsgPick();
      loadSentMessages();
    });
  });
  function msgWhen(iso) {
    var k = new Date(new Date(iso).getTime() + 9 * 3600000);
    return (k.getUTCMonth() + 1) + "/" + k.getUTCDate() + " " + k.getUTCHours() + ":" + (k.getUTCMinutes() < 10 ? "0" : "") + k.getUTCMinutes();
  }
  function loadSentMessages() {
    var list = $("#msgSent");
    list.textContent = "";
    api("messages?select=id,to_member,to_teacher,to_parent,sender,body,created_at,read_at,member:members(name),teacher:teachers(name),parent:parents(name)&order=created_at.desc&limit=300").then(function (res) {
      if (!res.ok) { list.appendChild(el("li", "sys-msg sys-msg--error", friendly(res, "불러오지 못했습니다."))); return; }
      // 같이 보낸 것 (같은 시각 · 같은 내용) = 카드 하나
      var groups = [], byKey = {};
      res.data.forEach(function (m) {
        var k = m.created_at + "|" + m.sender + "|" + m.body;
        if (!byKey[k]) { byKey[k] = { at: m.created_at, sender: m.sender, body: m.body, rows: [] }; groups.push(byKey[k]); }
        byKey[k].rows.push(m);
      });
      if (!groups.length) { list.appendChild(el("li", "sys-empty", "아직 보낸 메시지가 없어요.")); return; }
      groups.forEach(function (g) {
        var li = el("li", "adm__card");
        var top = el("div", "adm__cardtop");
        top.appendChild(el("strong", null, msgWhen(g.at)));
        top.appendChild(el("span", "adm__badge adm__badge--kind", g.sender));
        var read = g.rows.filter(function (m) { return m.read_at; }).length;
        top.appendChild(el("span", "sys-note", g.rows.length + "명 · 읽음 " + read + " / " + g.rows.length));
        li.appendChild(top);
        li.appendChild(el("p", "adm__quote msg-sent__body", g.body));
        var d = el("details", "msg-sent__who");
        d.appendChild(el("summary", null, "받는 사람 보기"));
        var ul = el("ul");
        g.rows.forEach(function (m) {
          var row = el("li");
          var who = m.to_member ? ((m.member && m.member.name) || m.to_member)
            : m.to_parent ? ((m.parent && m.parent.name) || "") + " (학부모)" : ((m.teacher && m.teacher.name) || "") + " 선생님";
          row.appendChild(el("span", null, who));
          row.appendChild(el("span", m.read_at ? "msg-sent__read" : "msg-sent__unread", m.read_at ? "읽음 " + msgWhen(m.read_at) : "안 읽음"));
          var del = el("button", "sys-link adm__del", "지우기");
          del.type = "button";
          del.addEventListener("click", function () {
            if (del.getAttribute("data-armed") !== "1") { del.setAttribute("data-armed", "1"); del.textContent = "한 번 더 누르면 지워요"; return; }
            api("messages?id=eq." + m.id, { method: "DELETE" }).then(loadSentMessages);
          });
          row.appendChild(del);
          ul.appendChild(row);
        });
        d.appendChild(ul);
        li.appendChild(d);
        list.appendChild(li);
      });
    });
  }

  /* ---------------- 설정 ---------------- */

  /* 텔레그램 알림: BotFather 토큰 저장 → 봇에게 말 걸기 → 연결 확인 (보내는 일은 서버 private.notify) */
  function loadTelegram() {
    var st = $("#tgState");
    api("rpc/admin_telegram_status", { method: "POST", body: {} }).then(function (res) {
      var d = res.data || {};
      if (!res.ok || !d.ok) { msg(st, d.error || friendly(res, "불러오지 못했습니다."), "error"); return; }
      var on = d.hasBot && d.chats > 0;
      $("#tgSteps").hidden = on;
      $("#tgForm").hidden = d.hasBot;
      $("#tgLink").hidden = !d.hasBot;
      $("#tgLink").textContent = on ? "받는 사람 다시 확인" : "연결 확인";
      $("#tgOff").hidden = !d.hasBot;
      $("#tgBookWrap").hidden = !on;
      $("#tgBook").checked = !!d.bookings;
      if (on) msg(st, "켜짐 · @" + (d.bot || "봇") + " → " + (d.groups ? "그룹 대화방" + (d.groups > 1 ? " " + d.groups + "곳" : "") + "으로 보내요." :
        d.chats + "명에게 1:1로 보내요. 관리자와 같이 받으려면 그룹에 봇을 초대하고 /start 를 보낸 뒤 \"받는 사람 다시 확인\"을 눌러주세요."), "ok");
      else if (d.hasBot) msg(st, "봇 저장됨 (@" + (d.bot || "") + "). 1:1은 봇에서 \"시작\", 그룹은 봇을 초대하고 그룹에 /start 를 보낸 뒤 \"연결 확인\"을 눌러주세요.");
      else msg(st, "아직 꺼져 있어요. 아래 순서대로 한 번만 해주세요.");
    });
  }
  $("#tgForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var t = field(this, "token"), st = $("#tgState");
    msg(st, "확인 중…");
    api("rpc/admin_telegram_set", { method: "POST", body: { p_token: t.value } }).then(function (res) {
      var d = res.data || {};
      if (!res.ok || !d.ok) { msg(st, d.error || friendly(res, "저장하지 못했습니다."), "error"); return; }
      t.value = "";
      loadTelegram();
    });
  });
  $("#tgLink").addEventListener("click", function () {
    var st = $("#tgState");
    msg(st, "확인 중…");
    api("rpc/admin_telegram_link", { method: "POST", body: {} }).then(function (res) {
      var d = res.data || {};
      if (!res.ok || !d.ok) { msg(st, d.error || friendly(res, "연결하지 못했습니다."), "error"); return; }
      loadTelegram();
    });
  });
  $("#tgBook").addEventListener("change", function () {
    api("rpc/admin_telegram_options", { method: "POST", body: { p_bookings: this.checked } }).then(loadTelegram);
  });
  $("#tgOff").addEventListener("click", function () {
    var b = this;
    if (b.getAttribute("data-armed") !== "1") { b.setAttribute("data-armed", "1"); b.textContent = "한 번 더 누르면 꺼요"; return; }
    b.removeAttribute("data-armed");
    b.textContent = "알림 끄기";
    api("rpc/admin_telegram_off", { method: "POST", body: {} }).then(loadTelegram);
  });

  /* 홈페이지 백업: 원장님 구글 계정의 Apps Script(tools/backup.gs)가 매일 새벽 3시 드라이브에 zip으로 */
  var backupOn = false;
  function loadBackup() {
    var st = $("#backupState");
    api("rpc/admin_backup_status", { method: "POST", body: {} }).then(function (res) {
      var d = res.data || {};
      if (!res.ok || !d.ok) { msg(st, d.error || friendly(res, "불러오지 못했습니다."), "error"); return; }
      var when = function (t) { return t ? new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""; };
      var l = d.last || {};
      if (!d.connected) {
        msg(st, d.openUntil && new Date(d.openUntil) > new Date() ? "연결을 기다리는 중 (" + when(d.openUntil) + "까지). 구글 스크립트에서 \"처음_한번_설정\"을 실행해주세요." : "아직 연결 전이에요.", "");
      } else if (!d.lastAt) msg(st, "연결됨 · 아직 백업 전이에요.", "");
      else if (l.ok === false) msg(st, "마지막 백업 실패 (" + when(d.lastAt) + "): " + (l.error || ""), "error");
      else {
        var fl = l.files || {}, ftxt = fl.ok ? " · 파일 " + fl.total + "개 (이번에 " + fl.copied + "개 복사" + (fl.left ? ", 남은 " + fl.left + "개는 다음 날" : "") + (fl.failed ? ", 못 받은 " + fl.failed + "개" : "") + ")" : (fl.note ? " · 파일: " + fl.note : "");
        msg(st, "켜짐 · 마지막 백업 " + when(d.lastAt) + " · " + (l.file || "") + " · " + Math.round((l.bytes || 0) / 1024) + "KB" + ftxt + (l.warnings && l.warnings.length ? " · " + l.warnings.join(", ") : ""), fl.ok === false ? "" : "ok");
      }
      backupOn = !!d.connected;
      $("#backupOpen").textContent = d.connected ? "다시 연결하기 (30분)" : "백업 연결 열기 (30분)";
    });
  }
  $("#backupOpen").addEventListener("click", function () {
    if (backupOn && !confirm("새로 연결하면 지금 연결된 백업 스크립트는 멈춰요. 30분 안에 구글 스크립트에서 \"처음_한번_설정\"을 다시 실행해야 해요. 열까요?")) return;
    api("rpc/admin_backup_open", { method: "POST", body: {} }).then(function (res) {
      var d = res.data || {};
      msg($("#backupMsg"), res.ok && d.ok ? "30분 동안 열었어요. 이제 구글 스크립트에서 \"처음_한번_설정\"을 실행해주세요." : d.error || friendly(res), res.ok && d.ok ? "ok" : "error");
      loadBackup();
    });
  });
  $("#backupReload").addEventListener("click", loadBackup);

  function renderSettings() {
    loadTelegram();
    loadBackup();
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

  /* ---------------- 비밀번호 정하기 (초대 메일 · 비밀번호를 모를 때) ---------------- */

  // "처음이거나 비밀번호를 모르겠어요": Supabase mails a link that comes back to this page.
  $("#forgot").addEventListener("click", function () {
    var email = field($("#loginForm"), "email").value.trim(), b = $("#forgot");
    if (!email) { msg($("#loginMsg"), "위 칸에 이메일을 먼저 적고 눌러주세요.", "error"); field($("#loginForm"), "email").focus(); return; }
    b.disabled = true;
    var back = location.origin + location.pathname;
    LeeshAPI.request("/auth/v1/recover?redirect_to=" + encodeURIComponent(back), {
      method: "POST", headers: LeeshAPI.headers(), body: JSON.stringify({ email: email })
    }).then(function (res) {
      b.disabled = false;
      if (res.status === 429) { msg($("#loginMsg"), "메일을 너무 자주 보냈어요. 1시간쯤 뒤에 다시 눌러주세요.", "error"); return; }
      if (!res.ok) { msg($("#loginMsg"), "메일을 보내지 못했어요. 잠시 뒤 다시 해주세요.", "error"); return; }
      // the same answer whether or not the address is an account
      msg($("#loginMsg"), "관리자 이메일이면 메일을 보냈어요. 메일의 링크를 누르면 여기서 새 비밀번호를 정해요.", "ok");
    });
  });

  // Back from the email link: #access_token=…&type=invite|recovery (js/api.js leaves it for this page)
  var mailLink = (function () {
    var h = location.hash, p = {};
    if (!/(^#|&)access_token=/.test(h)) return null;
    h.slice(1).split("&").forEach(function (kv) { var i = kv.indexOf("="); if (i > 0) p[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, " ")); });
    if (!/^(invite|recovery|magiclink|signup)$/.test(p.type || "")) return null;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* ignore */ }
    return { access: p.access_token, refresh: p.refresh_token, expires: Number(p.expires_at) || Math.floor(Date.now() / 1000) + (Number(p.expires_in) || 3600) };
  })();
  $("#pwForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target, p1 = field(f, "p1").value, btn = f.querySelector("button");
    if (p1 !== field(f, "p2").value) { msg($("#pwMsg"), "두 칸의 비밀번호가 달라요.", "error"); return; }
    btn.disabled = true;
    LeeshAPI.request("/auth/v1/user", { method: "PUT", headers: LeeshAPI.headers(mailLink.access), body: JSON.stringify({ password: p1 }) })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) {
          var m = res.data && (res.data.msg || res.data.message || "") || "";
          msg($("#pwMsg"), /different from the old/.test(m) ? "예전과 다른 비밀번호로 정해주세요."
            : /weak|characters/i.test(m) ? "더 길거나 어려운 비밀번호로 정해주세요."
            : res.status === 401 || res.status === 403 ? "링크가 만료됐어요. 로그인 화면에서 '처음이거나 비밀번호를 모르겠어요'를 다시 눌러주세요." : "저장하지 못했어요. 다시 해주세요.", "error");
          return;
        }
        saveSession({ access: mailLink.access, refresh: mailLink.refresh, expires: mailLink.expires, email: res.data && res.data.email });
        f.reset();
        f.hidden = true;
        enter();
      });
  });

  /* ---------------- start ---------------- */

  if (!LeeshAPI.enabled()) { $("#adminOff").hidden = false; return; }
  if (mailLink) { saveSession(null); $("#pwForm").hidden = false; return; }
  session = loadSession();
  if (session) enter(); else $("#loginForm").hidden = false;
  // an email link that had run out comes back as #error=…; js/api.js keeps the message
  var linkErr = LeeshAPI.kakao.lastError();
  if (linkErr && !session) msg($("#loginMsg"), "메일 링크가 만료됐거나 이미 썼어요. 아래 '처음이거나 비밀번호를 모르겠어요'를 다시 눌러주세요.", "error");
})();
