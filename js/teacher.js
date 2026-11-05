// teacher.html: 선생님 화면. 선생님은 관리자가 아니라 "선생님" 권한 (원장님 2026-10-28).
// 카카오로 로그인 → 처음이면 이름을 골라 연결 요청 → 원장님이 관리자 → 선생님 탭에서 승인 → 담당 학생(수강생 메모
// "담당 ○○○", 재원·휴원)만 보이고, 학생마다 레슨 일지를 씀 (js/config.js lessonFields). 학생은 내 폴더 → 레슨 노트에서
// 봐요 (일지는 선생님과 학생이 수업하면서 같이 씀). 서버(teacher_* 함수)가 담당 학생인지·내가 쓴 일지인지 다시 확인해요.
(function () {
  var app = document.getElementById("teacherApp");
  if (!app) return;
  var cfg = window.LEESH || {};
  var FIELDS = cfg.lessonFields || [];
  var WD = ["일", "월", "화", "수", "목", "금", "토"];
  var KAKAO_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3C6.5 3 2 6.6 2 11c0 2.8 1.9 5.3 4.7 6.7l-1 3.6c-.1.3.3.6.6.4l4.3-2.8c.5.1 1 .1 1.4.1 5.5 0 10-3.6 10-8S17.5 3 12 3z" fill="currentColor"/></svg>';
  var me = null, students = [];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function say(node, text, kind) { node.textContent = text || ""; node.className = "sys-msg" + (kind ? " sys-msg--" + kind : ""); }
  function todayKst() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
  function dayLabel(d) {
    var dt = new Date(d + "T00:00:00Z");
    return (dt.getUTCMonth() + 1) + "월 " + dt.getUTCDate() + "일 (" + WD[dt.getUTCDay()] + ")";
  }
  function short(d) { return Number(d.slice(5, 7)) + "/" + Number(d.slice(8)); }
  function button(text, cls) { var b = el("button", cls || "sys-btn", text); b.type = "button"; return b; }
  function clear() { app.textContent = ""; }

  if (!window.LeeshAPI || !LeeshAPI.enabled()) {
    app.appendChild(el("p", "sys-msg", "아직 준비 중이에요."));
    return;
  }

  /* ---------- 로그인 · 연결 ---------- */
  function signIn(note, kind) {
    clear();
    app.appendChild(el("h2", "sys-h", "선생님 로그인"));
    app.appendChild(el("p", "sys-note", "선생님 전용 화면이에요. 카카오로 로그인하면 담당 학생의 레슨 일지를 쓸 수 있어요."));
    var k = button("", "signin__kakao");
    k.innerHTML = KAKAO_ICON + "<span>카카오로 로그인</span>";
    k.addEventListener("click", function () { k.disabled = true; LeeshAPI.kakao.start(); });
    app.appendChild(k);
    app.appendChild(outButton()); // 다른 선생님이 이 기기로 들어갈 때
    var m = el("p", "sys-msg");
    app.appendChild(m);
    if (LeeshAPI.kakao.lastError()) say(m, "카카오 로그인을 마치지 못했어요. 다시 눌러주세요.", "error");
    else if (note) say(m, note, kind);
  }
  function signOut() { LeeshAPI.kakao.signOut(); me = null; signIn(); }
  function outButton() {
    var b = button("다른 카카오 계정으로 로그인", "sys-link signin__other");
    // 카카오 아이디 · 비밀번호를 다시 물어요 (그냥 로그아웃하면 이 기기의 카카오 계정으로 다시 바로 들어가요)
    b.addEventListener("click", function () { b.disabled = true; LeeshAPI.kakao.signOut(); me = null; LeeshAPI.kakao.start(true); });
    return b;
  }

  function requestForm(res) {
    clear();
    var r = res.request;
    if (r && r.status === "대기") {
      app.appendChild(el("h2", "sys-h", r.name + " 선생님, 확인을 기다리고 있어요"));
      app.appendChild(el("p", "sys-note", "원장님이 관리자 화면에서 확인하면 바로 담당 학생이 보여요."));
      var again = button("확인됐는지 다시 보기");
      again.addEventListener("click", function () { again.disabled = true; start(); });
      app.appendChild(again);
      var fix = button("이름 다시 고르기", "sys-link");
      fix.addEventListener("click", function () { requestForm({ names: res.names, request: null }); });
      app.appendChild(fix);
      app.appendChild(outButton());
      return;
    }
    app.appendChild(el("h2", "sys-h", "처음 오셨네요!"));
    app.appendChild(el("p", "sys-note", r && r.status === "거절"
      ? "연결이 안 됐어요. 이름을 다시 고르거나 원장님께 말씀해주세요."
      : "선생님 이름을 골라 연결 요청을 보내주세요. 원장님이 확인하면 이 카카오 계정으로 바로 쓸 수 있어요."));
    var f = el("form", "sys");
    var l = el("label", "sys-field");
    l.appendChild(el("span", null, "선생님 이름"));
    var sel = el("select");
    var o0 = el("option", null, "고르기");
    o0.value = "";
    sel.appendChild(o0);
    (res.names || []).forEach(function (n) { var o = el("option", null, n); o.value = n; sel.appendChild(o); });
    l.appendChild(sel);
    f.appendChild(l);
    var sb = el("button", "sys-btn", "연결 요청 보내기");
    sb.type = "submit";
    f.appendChild(sb);
    var m = el("p", "sys-msg");
    f.appendChild(m);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!sel.value) { say(m, "선생님 이름을 골라주세요.", "error"); return; }
      sb.disabled = true;
      LeeshAPI.rpc("teacher_request", { p_name: sel.value }).then(function (x) {
        sb.disabled = false;
        if (!x.ok) { say(m, x.error, "error"); return; }
        start();
      });
    });
    app.appendChild(f);
    app.appendChild(outButton());
  }

  function start() {
    if (!LeeshAPI.kakao.session()) { signIn(); return Promise.resolve(); }
    clear();
    app.appendChild(el("p", "sys-note", "확인 중…"));
    return LeeshAPI.rpc("teacher_me", {}).then(function (res) {
      if (!res.ok) {
        if (!LeeshAPI.kakao.session()) return signIn("카카오 로그인이 풀렸어요. 다시 눌러주세요.");
        return signIn(res.error, "error");
      }
      if (!res.linked) return requestForm(res);
      me = res.name;
      students = res.students || [];
      list();
    });
  }

  /* ---------- 담당 학생 ---------- */
  function header(sub) {
    var h = el("div", "tch__head");
    var t = el("div");
    t.appendChild(el("h2", "sys-h", me + " 선생님"));
    if (sub) t.appendChild(el("p", "sys-note", sub));
    h.appendChild(t);
    var out = button("로그아웃", "sys-link");
    out.addEventListener("click", signOut);
    h.appendChild(out);
    return h;
  }
  /* 학원 → 선생님 메시지 (원장님 2026-11-05, 관리자 화면에서 보냄). 새 것은 위에 펼쳐 보이고, 보이면 읽음. */
  var msgSeen = {};
  function msgTime(iso) {
    var k = new Date(new Date(iso).getTime() + 9 * 3600000);
    return (k.getUTCMonth() + 1) + "/" + k.getUTCDate() + " " + k.getUTCHours() + ":" + (k.getUTCMinutes() < 10 ? "0" : "") + k.getUTCMinutes();
  }
  function msgCard(m, fresh) {
    var c = el("article", "fold__card msg" + (fresh ? " msg--new" : ""));
    var h = el("p", "msg__head");
    h.appendChild(el("b", "msg__from", m.sender));
    h.appendChild(el("span", "msg__time", msgTime(m.at)));
    if (fresh) h.appendChild(el("span", "msg__new", "새 메시지"));
    c.appendChild(h);
    c.appendChild(el("p", "msg__body", m.body));
    return c;
  }
  // 받은 것 + 내가 보낸 것을 시간 순서로 (보낸 것은 오른쪽, 학원이 읽었는지), 맨 아래 "학원에 보내기"
  function sentCard(m) {
    var c = el("article", "fold__card msg msg--mine");
    var h = el("p", "msg__head");
    h.appendChild(el("b", "msg__from", "나 → 학원"));
    h.appendChild(el("span", "msg__time", msgTime(m.at)));
    h.appendChild(el("span", m.read ? "msg__read" : "msg__unread", m.read ? "읽음" : "아직 안 읽음"));
    c.appendChild(h);
    c.appendChild(el("p", "msg__body", m.body));
    return c;
  }
  function messages(holder, opened) {
    LeeshAPI.rpc("teacher_messages", {}).then(function (res) {
      if (!res.ok) return;
      holder.textContent = "";
      var items = (res.items || []).map(function (m) { return Object.assign({ dir: "in" }, m); });
      var sent = (res.sent || []).map(function (m) { return Object.assign({ dir: "out" }, m); });
      var fresh = items.filter(function (m) { return !m.read || msgSeen[m.id]; });
      var box = el("section", "tch__msgs");
      box.appendChild(el("h3", "tch__msgs-h", fresh.length ? "✉ 새 메시지 " + fresh.length + "개" : "✉ 학원 메시지"));
      // 새로 받은 것은 위에 펼쳐서
      fresh.forEach(function (m) { box.appendChild(msgCard(m, true)); });
      var rest = items.filter(function (m) { return fresh.indexOf(m) === -1; }).concat(sent)
        .sort(function (x, y) { return x.at < y.at ? 1 : -1; });
      if (rest.length) {
        var d = el("details", "tch__msgs-old");
        if (opened) d.open = true;
        d.appendChild(el("summary", null, "주고받은 메시지 " + rest.length + "개"));
        rest.forEach(function (m) { d.appendChild(m.dir === "out" ? sentCard(m) : msgCard(m, false)); });
        box.appendChild(d);
      }
      // 학원(원장님 · 실장님)에게 보내기
      var f = el("form", "tch__send");
      var ta = el("textarea");
      ta.rows = 3;
      ta.maxLength = 2000;
      ta.placeholder = "원장님 · 실장님께 보낼 말 (예: 다음 주 수요일 레슨 시간을 옮겨도 될까요?)";
      ta.setAttribute("aria-label", "학원에 보낼 메시지");
      var row = el("div", "tch__sendrow");
      var sb = el("button", "sys-btn", "학원에 보내기");
      sb.type = "submit";
      var m2 = el("span", "sys-msg");
      row.appendChild(sb);
      row.appendChild(m2);
      f.appendChild(ta);
      f.appendChild(row);
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!ta.value.trim()) { say(m2, "보낼 내용을 적어주세요.", "error"); return; }
        sb.disabled = true;
        LeeshAPI.rpc("teacher_send", { p_body: ta.value }).then(function (x) {
          sb.disabled = false;
          if (!x.ok) { say(m2, x.error, "error"); return; }
          messages(holder, true);
        });
      });
      box.appendChild(f);
      box.appendChild(el("p", "sys-note", "보낸 메시지는 원장님 · 실장님만 봐요. 급한 일은 전화로 연락해 주세요."));
      holder.appendChild(box);
      var ids = items.filter(function (m) { return !m.read; }).map(function (m) { msgSeen[m.id] = 1; return m.id; });
      if (ids.length) LeeshAPI.rpc("teacher_message_read", { p_ids: ids });
    });
  }

  function list() {
    clear();
    app.appendChild(header("담당 학생 " + students.length + "명 · 학생을 누르면 레슨 일지를 써요."));
    var msgHolder = el("div");
    app.appendChild(msgHolder);
    messages(msgHolder);
    if (!students.length) {
      app.appendChild(el("p", "book__empty", "담당 학생이 아직 없어요. 수강생 메모의 \"담당 " + me + "\"으로 나눠져요. 원장님께 말씀해주세요."));
      return;
    }
    var find = el("input", "tch__find");
    find.type = "search";
    find.placeholder = "이름으로 찾기";
    find.setAttribute("aria-label", "학생 이름으로 찾기");
    app.appendChild(find);
    var ul = el("ul", "tch__list");
    var today = todayKst();
    students.forEach(function (s) {
      var li = el("li");
      var b = button("", "tch__student");
      b.appendChild(el("b", null, s.name));
      if (s.status !== "재원") b.appendChild(el("span", "fold__tag", s.status));
      b.appendChild(el("span", "tch__last", s.last ? (s.last === today ? "오늘 씀" : "마지막 " + dayLabel(s.last)) : "아직 일지 없음"));
      b.addEventListener("click", function () { open(s.id); });
      li.appendChild(b);
      li.setAttribute("data-name", s.name);
      ul.appendChild(li);
    });
    find.addEventListener("input", function () {
      var q = find.value.trim();
      ul.querySelectorAll("li").forEach(function (li) { li.hidden = q && li.getAttribute("data-name").indexOf(q) === -1; });
    });
    app.appendChild(ul);
  }

  /* ---------- 학생 한 명: 저번 시간 내용 + 시트(일지 · 곡·자료 탭) + 지난 일지 + 연습 일지 · 레퍼토리 ---------- */
  // 선생님들 의견 (2026-11-04): 시트 탭 이름 바꾸기 · 앞뒤로 옮기기 · 신입생은 OT · 양식 탭과 같이 · 곡(가사) 탭도 아래 탭에서 · 저장이 끊겨도 안 날아가게
  function esc(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function cellOf(text, s) { var c = { t: esc(text) }; if (s) c.s = s; return c; }
  /** 신입생 OT 탭 (상담 · 등록 일지의 신상 칸 — 생년월일 · 사는 곳 · 학교 · 키 몸무게 — 은 빼고 수업에 필요한 칸만, 원장님 2026-11-04) */
  function otTemplate() {
    var d = { v: 1, n: 100, w: { 0: 190, 1: 520 }, h: {}, c: {} };
    d.c["0,0"] = cellOf("OT (첫 수업)", { b: 1, z: 18 });
    var rows = ["등록 경로", "보컬 레슨 경험", "댄스 레슨 경험", "악기", null, "희망 클래스", "좋아하는 가수", "좋아하는 노래 · 장르", null,
      "지망하는 기획사 · 학교", "가수 장르 · 포지션", "오디션 경험", "합격 경험", null, "레슨 목표 · 방향성", "특이사항"];
    var r = 2;
    rows.forEach(function (label) {
      if (label) d.c[r + ",0"] = cellOf(label, /목표|특이/.test(label) ? { b: 1, f: "#ff0000" } : { b: 1 });
      r++;
    });
    return d;
  }
  var DRAFT = "leesh_draft:";
  function draftGet(k) { try { return JSON.parse(localStorage.getItem(DRAFT + k) || "null"); } catch (e) { return null; } }
  function draftSet(k, v) { try { localStorage.setItem(DRAFT + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function draftDel(k) { try { localStorage.removeItem(DRAFT + k); } catch (e) { /* private mode */ } }
  function newDrafts(member) {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(DRAFT + member + ":new:") === 0) { var v = draftGet(k.slice(DRAFT.length)); if (v) out.push(v); }
      }
    } catch (e) { /* private mode */ }
    return out.sort(function (a, b) { return a.at - b.at; });
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  var savers = {}; // 고치는 중인 시트마다 저장기 하나 (같은 시트를 다시 열면 예전 것은 멈춤)

  /**
   * 저절로 저장 (2초) + 인터넷이 약할 때: 이 기기에 보관 → 5 · 10 · 20 · 30초마다, 다시 연결되면 바로 다시 보내요.
   * o = { key, msg, args() → 보낼 것 | null, call(a) → Promise(res), saved(res, a), check() → 오류 글 | null }
   */
  function saver(o) {
    if (savers[o.key]) savers[o.key].stop();
    var timer = null, retry = null, busy = null, dirty = false, wait = 0, stopped = false;
    function later() {
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(function () { push(false); }, 2000);
    }
    function push(loud) {
      clearTimeout(timer); timer = null;
      clearTimeout(retry); retry = null;
      if (stopped) return Promise.resolve(true);
      if (busy) { dirty = true; return busy; }
      var bad = o.check ? o.check() : null;
      if (bad) { say(o.msg, bad, "error"); return Promise.resolve(false); }
      var a = o.args();
      if (!a) { if (loud) say(o.msg, "한 칸 이상 적어주세요.", "error"); return Promise.resolve(null); }
      dirty = false;
      draftSet(o.key, { at: Date.now(), a: a, title: o.title ? o.title() : null });
      say(o.msg, "저장하는 중…");
      busy = o.call(a).then(function (res) {
        busy = null;
        if (stopped) return true;
        if (!res.ok) {
          dirty = true;
          if (res.offline || res.error === LeeshAPI.NETWORK_ERROR) {
            // 내용은 이 기기에 있어요. 조금 뒤 · 다시 연결되면 저절로
            wait = Math.min(30000, wait ? wait * 2 : 5000);
            say(o.msg, "인터넷이 약해서 아직 서버에 저장하지 못했어요. 쓴 내용은 이 기기에 보관해 두었고, 연결되면 저절로 저장돼요. (" + Math.round(wait / 1000) + "초 뒤 다시)", "warn");
            retry = setTimeout(function () { push(false); }, wait);
            return "kept";
          }
          say(o.msg, res.error, "error");
          return false;
        }
        wait = 0;
        o.saved(res, a);
        if (dirty) return push(loud);
        draftDel(o.key);
        if (o.rekey) { var nk = o.rekey(); if (nk && nk !== o.key) { delete savers[o.key]; o.key = nk; savers[nk] = api; } }
        var t = new Date();
        say(o.msg, "저장됨 " + String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0"), "ok");
        return true;
      });
      return busy;
    }
    function flush() { return dirty || timer || retry ? push(false) : busy || Promise.resolve(true); }
    function online() { if (dirty || retry) push(false); }
    window.addEventListener("online", online);
    // 다른 앱으로 넘어가거나 화면이 꺼질 때 바로 저장
    function hide() { if (document.hidden && dirty) push(false); }
    document.addEventListener("visibilitychange", hide);
    var api = {
      later: later, push: push, flush: flush,
      stop: function () {
        stopped = true; clearTimeout(timer); clearTimeout(retry);
        window.removeEventListener("online", online);
        document.removeEventListener("visibilitychange", hide);
        if (savers[o.key] === api) delete savers[o.key];
      },
      /** 탭을 바꿔도 될까: 저장됨 · 이 기기에 보관됨이면 괜찮아요 */
      leave: function () {
        return flush().then(function (ok) {
          if (ok === false) return false;
          if (ok === "kept") { savers[o.key] = api; return true; } // 뒤에서 계속 다시 보내요
          api.stop();
          return true;
        });
      }
    };
    savers[o.key] = api;
    return api;
  }

  function open(id, note, made) {
    clear();
    app.appendChild(el("p", "sys-note", "불러오는 중…"));
    return LeeshAPI.rpc("teacher_student", { p_member: id }, undefined, { retry: 2 }).then(function (res) {
      if (!res.ok) { list(); var m = el("p", "sys-msg sys-msg--error", res.error); app.insertBefore(m, app.children[1] || null); return; }
      // 신입생 (일지 · 곡·자료가 하나도 없음): 첫 수업에 OT · 양식 탭을 같이 만들어요
      if (!made && !res.notes.length && !res.sheets.length) {
        return LeeshAPI.rpc("teacher_starter", { p_member: id, p_ot: otTemplate(), p_form: LeeshGrid.template(FIELDS) }).then(function (st) {
          return open(id, st.ok && st.made ? "신입생이라 OT · 양식 탭을 같이 만들었어요. 아래 탭에서 골라 쓰세요." : note, true);
        });
      }
      var formSheet = res.sheets.filter(function (x) { return x.title.trim() === "양식"; })[0];
      if (formSheet && !formSheet.data) {
        // 새 일지는 이 학생의 "양식" 탭 모양으로 시작
        return LeeshAPI.rpc("teacher_lesson_sheet", { p_id: formSheet.id }, undefined, { retry: 1 }).then(function (x) {
          if (x.ok) formSheet.data = x.sheet;
          return show(res, note, formSheet);
        });
      }
      return show(res, note, null);
    });
  }

  function show(res, note, formSheet) {
    clear();
    var s = res.student;
    var book = { s: s, notes: res.notes, sheets: res.sheets, form: formSheet, cur: null, page: null };
    app.appendChild(header());
    var back = button("← 담당 학생", "sys-link tch__back");
    // 쓰던 일지는 저장하고 나가요 (인터넷이 약하면 이 기기에 보관한 채로)
    back.addEventListener("click", function () { (book.page ? book.page.leave() : Promise.resolve(true)).then(function (ok) { if (ok !== false) start(); }); });
    app.appendChild(back);
    app.appendChild(el("h3", "tch__name", s.name + (s.status !== "재원" ? " (" + s.status + ")" : "")));
    // 맨 위 한눈에 보기: 저번 시간 수업 내용 + 최근 연습 일지 + 레퍼토리 (원장님 2026-10-29: 수업하면서 한 화면에)
    app.appendChild(glance(res));
    var slot = el("div", "tch__slot");
    app.appendChild(slot);

    book.go = function (target) {
      var leaving = book.page ? book.page.leave() : Promise.resolve(true);
      return leaving.then(function (ok) {
        if (ok === false) return; // 저장이 안 됐으면 (너무 긴 칸 등) 그대로 둬요
        var p = target && target.kind === "s" ? sheetForm(book, target.obj) : noteForm(book, target ? target.obj : null, target && target.draft);
        slot.textContent = "";
        slot.appendChild(p.node);
        book.page = p;
        // 위쪽 "저번 시간"도 지금 쓰는 일지의 바로 전 수업으로 (같은 일지가 위아래로 두 번 보이지 않게)
        var old = app.querySelector(".tch__prev");
        if (old) old.replaceWith(lastTime(book.notes, target && target.kind === "n" ? target.obj : null));
        return p;
      });
    };
    // 저장 안 된 새 일지가 이 기기에 있으면 그것부터 (인터넷이 끊겼던 수업)
    var pend = newDrafts(s.id)[0];
    book.go(pend ? { kind: "new", draft: pend } : null).then(function (p) {
      if (pend && p) say(p.msg, "인터넷이 끊겨서 저장하지 못했던 일지를 이 기기에서 불러왔어요. 지금 다시 저장해요.", "warn");
      else if (note && p) say(p.msg, note, "ok");
    });

    var tabs = el("div", "sys-chips tch__tabs");
    var pages = {};
    var sheets = res.sheets || [];
    [["notes", "지난 일지 " + res.notes.length], ["sheets", "곡·자료 " + sheets.length], ["logs", "연습 일지"], ["songs", "레퍼토리"]].forEach(function (t, i) {
      var b = button(t[1], "sys-chip");
      b.setAttribute("aria-pressed", i ? "false" : "true");
      b.addEventListener("click", function () {
        tabs.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        Object.keys(pages).forEach(function (k) { pages[k].hidden = k !== t[0]; });
      });
      tabs.appendChild(b);
      pages[t[0]] = el("section", "tch__page");
      pages[t[0]].hidden = !!i;
    });
    app.appendChild(tabs);

    if (!res.notes.length) pages.notes.appendChild(el("p", "book__empty", "아직 쓴 일지가 없어요."));
    res.notes.slice(0, 60).forEach(function (n) { pages.notes.appendChild(noteCard(s, n, book)); });

    sheetPage(pages.sheets, sheets, book);

    if (!res.logs.length) pages.logs.appendChild(el("p", "book__empty", "학생이 쓴 연습 일지가 없어요."));
    res.logs.forEach(function (l) {
      var c = el("article", "fold__card");
      c.appendChild(el("p", "fold__date", dayLabel(l.day) + (l.minutes ? " · " + l.minutes + "분" : "")));
      if (l.song) c.appendChild(el("p", "fold__main", l.song));
      if (l.did) c.appendChild(el("p", "fold__body", l.did));
      pages.logs.appendChild(c);
    });

    if (!res.repertoire.length) pages.songs.appendChild(el("p", "book__empty", "학생이 적은 레퍼토리가 없어요."));
    res.repertoire.forEach(function (r) {
      var c = el("article", "fold__card");
      var top = el("p", "fold__main");
      top.appendChild(el("span", "fold__tag" + (r.status === "완성" ? " is-done" : ""), r.status));
      top.appendChild(el("b", null, " " + r.title));
      if (r.artist) top.appendChild(document.createTextNode(" · " + r.artist));
      c.appendChild(top);
      if (r.purpose) c.appendChild(el("p", "fold__date", r.purpose));
      pages.songs.appendChild(c);
    });
    Object.keys(pages).forEach(function (k) { app.appendChild(pages[k]); });
  }

  /* ---------- 아래쪽 시트 탭: 내 일지 + 곡·자료 (구글시트처럼 이름 바꾸기 · 옮기기) ---------- */
  function noteLabel(n) { return n.title || n.srcTitle || short(n.date); }
  /** 탭 순서: 옮긴 적 있는 탭(tabPos) 먼저 그 순서로, 나머지는 곡·자료(구글시트 순서) → 일지(오래된 날 → 최근) */
  function entries(book) {
    var list = book.notes.filter(function (n) { return n.mine && n.id; }).map(function (n) { return { kind: "n", id: n.id, obj: n }; })
      .concat(book.sheets.map(function (x) { return { kind: "s", id: x.id, obj: x }; }));
    return list.sort(function (a, b) {
      var pa = a.obj.tabPos, pb = b.obj.tabPos;
      if (pa != null && pb != null) return pa - pb || (a.kind < b.kind ? -1 : 1);
      if (pa != null) return -1;
      if (pb != null) return 1;
      if (a.kind !== b.kind) return a.kind === "s" ? -1 : 1;
      if (a.kind === "s") return (a.obj.pos || 0) - (b.obj.pos || 0) || a.id - b.id;
      return a.obj.date < b.obj.date ? -1 : a.obj.date > b.obj.date ? 1 : a.id - b.id;
    });
  }
  /** cur = { kind: "n" | "s", id } 또는 { kind: "new", label } */
  function tabsFor(book, cur) {
    var list = entries(book);
    var items = list.map(function (e) {
      var isN = e.kind === "n";
      return {
        kind: e.kind, label: isN ? noteLabel(e.obj) : e.obj.title, name: isN ? (e.obj.title || "") : e.obj.title,
        title: isN ? dayLabel(e.obj.date) + " 일지" + (e.obj.title || e.obj.srcTitle ? " · " + noteLabel(e.obj) : "") : "곡·자료 · " + e.obj.title,
        active: cur.kind === e.kind && cur.id === e.id, entry: e, max: isN ? 60 : 100
      };
    });
    if (cur.kind === "new") items.push({ kind: "n", label: cur.label, name: cur.name || "", title: "오늘의 수업 내용", active: true, entry: null, max: 60 });
    function sendOrder() {
      var ids = items.filter(function (x) { return x.entry; }).map(function (x) { return x.entry.kind + x.entry.id; });
      items.forEach(function (x, i) { if (x.entry) x.entry.obj.tabPos = i; });
      LeeshAPI.rpc("teacher_tab_order", { p_member: book.s.id, p_order: ids }, undefined, { retry: 2 }).then(function (r) {
        if (!r.ok && book.page) say(book.page.msg, "탭 순서를 저장하지 못했어요. " + r.error, "error");
      });
    }
    function move(from, to) {
      if (to < 0 || to >= items.length || from === to) return;
      var it = items.splice(from, 1)[0];
      items.splice(to, 0, it);
      sendOrder();
      if (book.page) book.page.redrawTabs();
    }
    return {
      items: items,
      pick: function (i) { var e = items[i].entry; if (e) book.go(e); },
      addTitle: "새 시트 · 새 일지",
      addMenu: [
        ["새 일지 (오늘 수업)", function () { book.go(null); }],
        ["새 빈 시트 (곡 · 가사 · 자료)", function () { newSheet(book); }]
      ],
      rename: function (i, v) {
        var it = items[i], e = it.entry;
        if (!e) { if (book.page && book.page.setName) book.page.setName(v); return; }
        if (e.kind === "n") {
          LeeshAPI.rpc("teacher_note_title", { p_note: e.id, p_title: v }, undefined, { retry: 2 }).then(function (r) {
            if (!r.ok) { if (book.page) say(book.page.msg, r.error, "error"); return; }
            e.obj.title = v || null;
            if (book.page) book.page.redrawTabs();
          });
        } else {
          if (!v) { if (book.page) say(book.page.msg, "곡·자료 탭은 이름이 있어야 해요.", "error"); return; }
          LeeshAPI.rpc("teacher_sheet_save", { p_member: book.s.id, p_id: e.id, p_title: v }, undefined, { retry: 2 }).then(function (r) {
            if (!r.ok) { if (book.page) say(book.page.msg, r.error, "error"); return; }
            e.obj.title = v;
            if (e.obj.src) e.obj.siteEdited = true;
            if (book.page) book.page.redrawTabs();
          });
        }
      },
      reorder: function (from, to) { move(from, to); },
      menu: function (i) {
        var it = items[i], e = it.entry, out = [];
        if (i > 0) out.push(["← 왼쪽으로 옮기기", function () { move(i, i - 1); }]);
        if (i < items.length - 1) out.push(["오른쪽으로 옮기기 →", function () { move(i, i + 1); }]);
        if (e && e.kind === "n" && e.obj.title) out.push(["이름을 날짜로 되돌리기", function () { tabsFor(book, cur).rename(i, ""); }]);
        if (e && e.kind === "s" && !e.obj.src) out.push(null, ["이 시트 지우기", function () { delSheet(book, e.obj); }, true]);
        if (e && e.kind === "n") out.push(null, ["이 일지 지우기", function () { delNote(book, e.obj); }, true]);
        return out;
      }
    };
  }
  function newSheet(book) {
    var names = {};
    book.sheets.forEach(function (x) { names[x.title] = 1; });
    var n = 1;
    while (names["시트" + n]) n++;
    var key = uid();
    LeeshAPI.rpc("teacher_sheet_save", { p_member: book.s.id, p_title: "시트" + n, p_sheet: { v: 1, n: 100, w: {}, h: {}, c: {} }, p_key: key }, undefined, { retry: 2 }).then(function (r) {
      if (!r.ok) { if (book.page) say(book.page.msg, r.error, "error"); return; }
      var x = { id: r.id, title: "시트" + n, src: false, siteEdited: true, pos: 0, tabPos: null, data: { v: 1, n: 100, w: {}, h: {}, c: {} } };
      book.sheets.push(x);
      book.go({ kind: "s", id: x.id, obj: x }).then(function (p) { if (p) say(p.msg, "새 시트를 만들었어요. 탭을 두 번 누르면 이름을 바꿔요.", "ok"); });
    });
  }
  function delSheet(book, x) {
    if (!window.confirm("\"" + x.title + "\" 시트를 지울까요? 되돌릴 수 없어요.")) return;
    LeeshAPI.rpc("teacher_sheet_delete", { p_id: x.id }).then(function (r) {
      if (!r.ok) { if (book.page) say(book.page.msg, r.error, "error"); return; }
      if (book.page && book.page.stop) book.page.stop();
      book.page = null;
      open(book.s.id, "\"" + x.title + "\" 시트를 지웠어요.");
    });
  }
  function delNote(book, n) {
    if (!window.confirm(noteLabel(n) + " 일지를 지울까요? 되돌릴 수 없어요.")) return;
    LeeshAPI.rpc("teacher_note_delete", { p_note: n.id }).then(function (r) {
      if (!r.ok) { if (book.page) say(book.page.msg, r.error, "error"); return; }
      if (book.page && book.page.stop) book.page.stop();
      book.page = null;
      open(book.s.id, "일지를 지웠어요.");
    });
  }

  /**
   * 일지 한 장. editing = 내가 쓴 일지 (없으면 새 일지). draft = 이 기기에 보관된 저장 안 된 새 일지.
   * 칸마다 꾸미기 (js/grid.js) + 쓰는 동안 저절로 저장 (원장님 2026-10-29: 수업하면서 같이 보며 씀).
   */
  function noteForm(book, editing, draft) {
    var s = book.s, notes = book.notes;
    var f = el("form", "sys tch__form");
    var head = el("h4", "rec__title", editing ? dayLabel(editing.date) + " 수업 내용 고치기" : "오늘의 수업 내용");
    f.appendChild(head);
    var dl = el("label", "sys-field");
    dl.appendChild(el("span", null, "수업 날짜"));
    var date = el("input");
    date.type = "date";
    date.required = true;
    date.value = draft && draft.a ? draft.a.p_date : editing ? editing.date : todayKst();
    dl.appendChild(date);
    f.appendChild(dl);
    if (editing && editing.src && !editing.siteEdited) {
      f.appendChild(el("p", "sys-note tch__src", "선생님 구글시트에서 가져온 일지예요. 여기서 고치면 그 뒤로는 시트 내용으로 바뀌지 않아요."));
    }
    f.appendChild(el("p", "sys-note tch__how", "구글시트처럼: 칸 누르고 바로 쓰기 · 두 번 누르면 고치기 · Enter 아래 칸 · Alt+Enter 줄바꿈 · 오른쪽 클릭 = 행 · 열 넣기 · 저절로 저장 · 아래 탭 = 일지 · 곡·자료 (탭 두 번 누르기 = 이름 바꾸기, ▾ = 옮기기)"));
    // 새 일지는 이 학생의 "양식" 탭 모양으로, 없으면 A열에 칸 이름만 띄엄띄엄 적힌 표로 시작
    var startSheet = book.form && book.form.data ? JSON.parse(JSON.stringify(book.form.data)) : LeeshGrid.template(FIELDS);
    var blank = JSON.stringify(startSheet.c || {});
    var noteId = editing ? editing.id : null;
    var key = draft && draft.a && draft.a.p_key ? draft.a.p_key : uid(); // 새 일지: 끊겨서 다시 보내도 한 장만
    var name = draft && draft.title != null ? draft.title : (editing ? null : "");
    var saved = editing ? draftGet(s.id + ":n:" + editing.id) : null; // 이 일지를 고치다가 못 보낸 것
    var data = draft && draft.a ? draft.a.p_sheet : saved && saved.a ? saved.a.p_sheet : editing ? LeeshGrid.fromNote(editing, FIELDS) : startSheet;
    if (saved && saved.a) date.value = saved.a.p_date;
    function cur() { return noteId ? { kind: "n", id: noteId } : { kind: "new", label: name || "새 일지 " + short(date.value || todayKst()), name: name }; }
    var grid = LeeshGrid.editor({ data: data, onInput: function () { sv.later(); }, tabs: tabsFor(book, cur()) });
    f.appendChild(grid.node);
    var row = el("div", "fold__actions");
    var save = el("button", "sys-btn", editing ? "고친 내용 저장" : "저장하고 닫기");
    save.type = "submit";
    row.appendChild(save);
    var last = notes.filter(function (n) { return n.mine; })[0] || notes[0];
    if (!editing && last) {
      // 지난번 일지를 불러와 고치기만 (선생님 일이 늘지 않게)
      var copy = button("지난 일지 불러오기", "sys-link");
      copy.addEventListener("click", function () {
        grid.set(LeeshGrid.fromNote(last, FIELDS));
        say(msg, dayLabel(last.date) + " 일지를 불러왔어요. 고칠 곳만 고치면 저절로 저장돼요.");
      });
      row.appendChild(copy);
    }
    f.appendChild(row);
    var msg = el("p", "sys-msg");
    msg.setAttribute("role", "status");
    f.appendChild(msg);
    f.appendChild(el("p", "sys-note", cfg.studentNotes === false
      ? "지금은 학생 내 폴더에 보이지 않아요 (원장님이 켜면 그때부터 학생 내 폴더 → 레슨 노트에 보여요)."
      : "저장하면 학생 내 폴더 → 레슨 노트에 바로 보여요."));

    var sv = saver({
      key: noteId ? s.id + ":n:" + noteId : s.id + ":new:" + key, msg: msg,
      check: function () { var long = grid.over(); return long ? long + " 칸이 너무 길어요 (한 칸에 5000자까지)." : (date.value ? null : "수업 날짜를 골라주세요."); },
      title: function () { return name; },
      args: function () {
        var sheet = grid.get();
        // 칸 이름만 있는 새 표는 아직 저장하지 않아요
        if (!LeeshGrid.text(sheet) || (!noteId && JSON.stringify(sheet.c) === blank)) return null;
        var a = { p_member: s.id, p_date: date.value, p_note: noteId, p_rich: true, p_sheet: sheet, p_key: noteId ? null : key };
        if (!noteId && name) a.p_title = name;
        return a;
      },
      call: function (a) { return LeeshAPI.rpc("teacher_note_save", a, undefined, { retry: 2 }); },
      saved: function (res, a) {
        var wasNew = !noteId;
        noteId = res.id;
        remember(a);
        students.forEach(function (x) { if (x.id === s.id && (!x.last || date.value > x.last)) x.last = date.value; });
        if (wasNew) {
          draftDel(s.id + ":new:" + key);
          grid.tabs(tabsFor(book, cur()));
          if (book.page && book.page.node !== f) book.page.redrawTabs(); // 뒤에서 늦게 저장된 일지도 지금 탭에
        }
      },
      rekey: function () { return noteId ? s.id + ":n:" + noteId : null; }
    });
    if ((draft && draft.a) || (saved && saved.a)) setTimeout(function () { sv.push(false); }, 300);
    // 저장한 일지를 이 화면의 목록에도 (시트 탭 · 지난 일지 불러오기가 최신 내용을 쓰게)
    function remember(a) {
      var n = notes.filter(function (x) { return x.id === noteId; })[0];
      if (!n) {
        n = { id: noteId, mine: true, teacher: me, title: a.p_title || null, tabPos: null };
        notes.push(n);
      }
      n.date = a.p_date;
      n.rich = true;
      n.sheet = a.p_sheet;
      FIELDS.forEach(function (fd) { n[fd[0]] = null; });
      notes.sort(function (x, y) { return x.date < y.date ? 1 : x.date > y.date ? -1 : (y.id || 0) - (x.id || 0); });
    }
    date.addEventListener("change", function () { if (noteId) sv.later(); grid.tabs(tabsFor(book, cur())); });

    f.addEventListener("submit", function (e) {
      e.preventDefault();
      save.disabled = true;
      sv.push(true).then(function (ok) {
        save.disabled = false;
        if (ok === "kept") return;
        if (!ok) return;
        sv.stop();
        book.page = null;
        open(s.id, editing ? "고쳤어요." : "저장했어요.");
      });
    });
    return {
      node: f, msg: msg, leave: sv.leave, stop: sv.stop,
      redrawTabs: function () { grid.tabs(tabsFor(book, cur())); },
      setName: function (v) { name = v; grid.tabs(tabsFor(book, cur())); if (noteId) LeeshAPI.rpc("teacher_note_title", { p_note: noteId, p_title: v }); }
    };
  }

  /** 곡·자료 한 장 (노래 가사 · 발성 · OT · 양식 …): 아래 탭에서 열고 고쳐요. 구글시트에서 온 탭을 고치면 그 뒤로 시트가 덮지 않아요. */
  function sheetForm(book, x) {
    var s = book.s;
    var f = el("div", "sys tch__form");
    f.appendChild(el("h4", "rec__title", "곡·자료 · " + x.title));
    var msg = el("p", "sys-msg");
    msg.setAttribute("role", "status");
    var box = el("div");
    f.appendChild(box);
    f.appendChild(msg);
    var grid = null, sv = null, dead = false;
    var page = {
      node: f, msg: msg,
      leave: function () { return sv ? sv.leave() : Promise.resolve(true); },
      stop: function () { dead = true; if (sv) sv.stop(); },
      redrawTabs: function () { if (grid) grid.tabs(tabsFor(book, { kind: "s", id: x.id })); f.firstChild.textContent = "곡·자료 · " + x.title; }
    };
    box.appendChild(el("p", "sys-note", "불러오는 중…"));
    (x.data ? Promise.resolve({ ok: true, sheet: x.data, src: x.src, siteEdited: x.siteEdited }) : LeeshAPI.rpc("teacher_lesson_sheet", { p_id: x.id }, undefined, { retry: 2 })).then(function (res) {
      if (dead) return;
      box.textContent = "";
      if (!res.ok) { box.appendChild(el("p", "sys-msg sys-msg--error", res.error)); return; }
      x.data = res.sheet;
      if (res.src && !res.siteEdited) box.appendChild(el("p", "sys-note tch__src", "선생님 구글시트에서 가져온 탭이에요. 여기서 고치면 그 뒤로는 구글시트 내용으로 바뀌지 않아요."));
      var kept = draftGet(s.id + ":s:" + x.id);
      grid = LeeshGrid.editor({ data: kept && kept.a ? kept.a.p_sheet : res.sheet, onInput: function () { sv.later(); }, tabs: tabsFor(book, { kind: "s", id: x.id }) });
      box.appendChild(grid.node);
      sv = saver({
        key: s.id + ":s:" + x.id, msg: msg,
        check: function () { var long = grid.over(); return long ? long + " 칸이 너무 길어요 (한 칸에 5000자까지)." : null; },
        args: function () { return { p_member: s.id, p_id: x.id, p_sheet: grid.get() }; },
        call: function (a) { return LeeshAPI.rpc("teacher_sheet_save", a, undefined, { retry: 2 }); },
        saved: function (r, a) { x.data = a.p_sheet; if (x.src) x.siteEdited = true; }
      });
      if (kept && kept.a) setTimeout(function () { sv.push(false); }, 300);
    });
    return page;
  }

  /** 한눈에 보기: 왼쪽 저번 시간 수업 내용, 오른쪽 최근 연습 일지 3개 + 레퍼토리 (준비 중인 곡 먼저). */
  function glance(res) {
    var wrap = el("div", "tch__glance");
    wrap.appendChild(lastTime(res.notes, null));
    var side = el("div", "tch__side");
    var logs = el("section", "tch__mini");
    logs.appendChild(el("h4", "tch__minihead", "최근 연습 일지"));
    if (!res.logs.length) logs.appendChild(el("p", "book__empty", "학생이 쓴 연습 일지가 없어요."));
    res.logs.slice(0, 3).forEach(function (l) {
      var c = el("div", "tch__miniitem");
      c.appendChild(el("p", "fold__date", dayLabel(l.day) + (l.minutes ? " · " + l.minutes + "분" : "")));
      if (l.song) c.appendChild(el("p", "fold__main", l.song));
      if (l.did) c.appendChild(el("p", "fold__body", l.did));
      logs.appendChild(c);
    });
    side.appendChild(logs);
    var songs = el("section", "tch__mini");
    songs.appendChild(el("h4", "tch__minihead", "레퍼토리"));
    var list = res.repertoire.slice().sort(function (a, b) { return (a.status === "완성") - (b.status === "완성"); });
    if (!list.length) songs.appendChild(el("p", "book__empty", "학생이 적은 레퍼토리가 없어요."));
    var ul = el("ul", "tch__songs");
    list.slice(0, 6).forEach(function (r) {
      var li = el("li");
      li.appendChild(el("span", "fold__tag" + (r.status === "완성" ? " is-done" : ""), r.status));
      li.appendChild(el("b", null, " " + r.title));
      if (r.artist) li.appendChild(document.createTextNode(" · " + r.artist));
      if (r.purpose) li.appendChild(el("small", null, " (" + r.purpose + ")"));
      ul.appendChild(li);
    });
    if (list.length) songs.appendChild(ul);
    if (list.length > 6) songs.appendChild(el("p", "sys-note", "외 " + (list.length - 6) + "곡 · 아래 레퍼토리 탭에서 전부 보여요."));
    side.appendChild(songs);
    wrap.appendChild(side);
    return wrap;
  }

  /** 저번 시간 수업 내용: 오늘보다 앞선 가장 최근 일지 하나를 시트 모양 그대로 (보기만). */
  // editing = 지금 고치는 일지 (없으면 오늘 새 일지): 그보다 앞선 가장 최근 일지
  function lastTime(notes, editing) {
    var base = editing ? editing.date : todayKst();
    var n = notes.filter(function (x) { return x.date < base && (!editing || x.id !== editing.id); })[0];
    if (!n) {
      var none = el("section", "tch__prev");
      none.appendChild(el("p", "tch__prevhead", "저번 시간 수업 내용"));
      none.appendChild(el("p", "book__empty", editing ? "이 일지보다 앞선 일지가 없어요." : "아직 지난 일지가 없어요. 오늘이 첫 기록이에요."));
      return none;
    }
    var box = el("details", "tch__prev");
    box.open = true;
    var sum = el("summary", "tch__prevhead");
    sum.appendChild(el("b", null, "저번 시간 수업 내용"));
    sum.appendChild(el("span", null, " · " + dayLabel(n.date) + (n.teacher ? " · " + n.teacher + " 선생님" : "")));
    box.appendChild(sum);
    box.appendChild(LeeshGrid.summary(n, FIELDS));
    return box;
  }

  /** 곡·자료: 선생님 구글시트의 날짜 아닌 탭 (곡 가사 · 곡별 피드백 · OT · 발성 · 알림장). 보기만, 누르면 열려요. */
  function sheetPage(page, sheets, book) {
    if (!sheets.length) {
      page.appendChild(el("p", "book__empty", "아직 없어요. 선생님 구글시트의 곡 · OT · 발성 탭이 여기에 저절로 들어와요."));
      return;
    }
    page.appendChild(el("p", "sys-note", "선생님 구글시트에서 1시간마다 저절로 가져와요. 위쪽 시트 아래 탭에서 열면 바로 고칠 수 있어요 (고친 탭은 그 뒤로 구글시트가 덮지 않아요)."));
    var chips = el("div", "sys-chips tch__sheetchips"), box = el("div", "tch__sheetview"), cache = {};
    sheets.forEach(function (x) {
      var b = button(x.title, "sys-chip");
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", function () {
        chips.querySelectorAll("button").forEach(function (y) { y.setAttribute("aria-pressed", y === b ? "true" : "false"); });
        box.textContent = "";
        box.appendChild(el("p", "sys-note", "불러오는 중…"));
        (cache[x.id] ? Promise.resolve(cache[x.id]) : LeeshAPI.rpc("teacher_lesson_sheet", { p_id: x.id })).then(function (res) {
          box.textContent = "";
          if (!res.ok) { box.appendChild(el("p", "sys-msg sys-msg--error", res.error)); return; }
          cache[x.id] = res;
          box.appendChild(el("h4", "tch__minihead", res.title));
          box.appendChild(LeeshGrid.view(res.sheet));
          var go = button("이 시트 열어서 고치기", "sys-link");
          go.addEventListener("click", function () {
            var obj = book.sheets.filter(function (y) { return y.id === x.id; })[0] || x;
            book.go({ kind: "s", id: x.id, obj: obj }).then(function (p) { if (p) p.node.scrollIntoView({ behavior: "smooth", block: "start" }); });
          });
          box.appendChild(go);
        });
      });
      chips.appendChild(b);
    });
    page.appendChild(chips);
    page.appendChild(box);
  }

  function noteCard(s, n, book) {
    var c = el("article", "lnote");
    var head = el("p", "lnote__date", dayLabel(n.date));
    if (n.teacher) head.appendChild(el("span", "lnote__teacher", n.teacher + " 선생님"));
    if (n.src) head.appendChild(el("span", "lnote__src", n.siteEdited ? "구글시트 → 홈페이지에서 고침" : "구글시트에서"));
    c.appendChild(head);
    c.appendChild(LeeshGrid.summary(n, FIELDS));
    if (n.mine) {
      var row = el("p", "fold__actions");
      var edit = button("고치기", "sys-link");
      edit.addEventListener("click", function () {
        book.go({ kind: "n", id: n.id, obj: n }).then(function (p) { if (p) p.node.scrollIntoView({ behavior: "smooth", block: "start" }); });
      });
      var del = button("지우기", "sys-link adm__del");
      var m = el("span", "sys-msg");
      del.addEventListener("click", function () {
        if (del.getAttribute("data-armed") !== "1") { del.setAttribute("data-armed", "1"); del.textContent = "한 번 더 누르면 지워요"; return; }
        del.disabled = true;
        LeeshAPI.rpc("teacher_note_delete", { p_note: n.id }).then(function (res) {
          if (!res.ok) { del.disabled = false; say(m, res.error, "error"); return; }
          open(s.id, "일지를 지웠어요.");
        });
      });
      row.appendChild(edit);
      row.appendChild(del);
      row.appendChild(m);
      c.appendChild(row);
    }
    return c;
  }

  start();
})();
