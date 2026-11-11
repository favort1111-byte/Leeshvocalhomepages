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
    app.appendChild(LeeshAPI.kakao.publicBox()); // 레슨실 · 학원 공용 컴퓨터
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
    var side = el("div", "tch__links");
    // 보컬 오락실 (원장님 2026-11-10 "선생님 화면에서도 게임 보이게"): 같은 카카오 로그인으로 바로 들어가요
    var games = el("a", "sys-link", "🎮 보컬 오락실");
    games.href = "games.html";
    side.appendChild(games);
    var out = button("로그아웃", "sys-link");
    out.addEventListener("click", signOut);
    side.appendChild(out);
    h.appendChild(side);
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
    var rvHolder = el("div");
    app.appendChild(rvHolder);
    reviewsBox(rvHolder);
  }

  /* 학생 오디션 후기 (원장님 2026-11-09 "작성은 학생이, 보는 건 선생님들이랑 관리자만" · "선생님 모두"):
     담당이 아니어도 모든 학생 후기를 봐요 (기획사별로 무엇을 물어봤는지 같이 보려고). 보기만. 서버 teacher_reviews. */
  var RV_TEXT = [["asked", "질문 리스트"], ["tip", "나만의 꿀팁 · 나의 후기"], ["process", "진행 순서 · 상황 설명"], ["note", "특이사항"]];
  function reviewCard(r) {
    var c = el("article", "rv tch__rv");
    var h = el("p", "rv__head");
    h.appendChild(el("b", null, dayLabel(r.date) + " · " + r.company));
    h.appendChild(el("span", "rv__tag", r.name + (r.teacher ? " · 담당 " + r.teacher : "")));
    c.appendChild(h);
    var info = [r.gender, r.birth, r.height && "키 " + r.height, r.weight && "몸무게 " + r.weight].filter(Boolean).join(" · ");
    if (info) c.appendChild(el("p", "rv__info", info));
    if (r.songVocal || r.songDance) {
      c.appendChild(el("p", "rv__label", "준비한 곡"));
      if (r.songVocal) c.appendChild(el("p", "rv__text", "🎤 보컬곡 · " + r.songVocal));
      if (r.songDance) c.appendChild(el("p", "rv__text", "💃 댄스곡 · " + r.songDance));
    }
    RV_TEXT.forEach(function (f) {
      if (!r[f[0]]) return;
      c.appendChild(el("p", "rv__label", f[1]));
      c.appendChild(el("p", "rv__text", r[f[0]]));
    });
    return c;
  }
  function reviewsBox(holder) {
    LeeshAPI.rpc("teacher_reviews", {}).then(function (res) {
      if (!res.ok) return;
      var items = res.items || [];
      holder.textContent = "";
      var box = el("details", "tch__rvbox");
      box.appendChild(el("summary", "tch__rvsum", "📝 학생 오디션 후기 " + items.length + "개"));
      box.appendChild(el("p", "sys-note", "학생들이 내 폴더에서 쓴 오디션 후기예요. 선생님들과 학원만 보고, 다른 학생 · 학부모에게는 보이지 않아요."));
      if (!items.length) { box.appendChild(el("p", "book__empty", "아직 학생이 쓴 후기가 없어요.")); holder.appendChild(box); return; }
      var bar = el("div", "tch__rvbar");
      var q = el("input", "tch__find");
      q.type = "search";
      q.placeholder = "기획사 · 학생 이름 · 곡으로 찾기";
      q.setAttribute("aria-label", "오디션 후기 찾기");
      var mineL = el("label", "tch__rvmine");
      var mine = el("input");
      mine.type = "checkbox";
      mineL.appendChild(mine);
      mineL.appendChild(document.createTextNode(" 내 담당 학생만"));
      bar.appendChild(q);
      bar.appendChild(mineL);
      box.appendChild(bar);
      var listEl = el("div", "tch__rvlist");
      box.appendChild(listEl);
      var more = el("button", "sys-btn sys-btn--ghost", "더 보기");
      more.type = "button";
      box.appendChild(more);
      var shown = 10;
      function draw() {
        var w = q.value.trim();
        var hit = items.filter(function (r) {
          if (mine.checked && !r.mine) return false;
          if (!w) return true;
          return [r.company, r.name, r.songVocal, r.songDance].some(function (v) { return v && String(v).indexOf(w) !== -1; });
        });
        listEl.textContent = "";
        if (!hit.length) listEl.appendChild(el("p", "book__empty", "찾는 후기가 없어요."));
        hit.slice(0, shown).forEach(function (r) { listEl.appendChild(reviewCard(r)); });
        more.hidden = hit.length <= shown;
      }
      q.addEventListener("input", function () { shown = 10; draw(); });
      mine.addEventListener("change", function () { shown = 10; draw(); });
      more.addEventListener("click", function () { shown += 20; draw(); });
      draw();
      holder.appendChild(box);
    });
  }

  /* ---------- 학생 한 명: 저번 시간 내용 + 시트(일지 · 곡·자료 탭) + 지난 일지 + 연습 일지 · 레퍼토리 ---------- */
  // 선생님들 의견 (2026-11-04): 시트 탭 이름 바꾸기 · 앞뒤로 옮기기 · 신입생은 OT · 양식 탭과 같이 · 곡(가사) 탭도 아래 탭에서 · 저장이 끊겨도 안 날아가게
  function esc(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function cellOf(text, s) { var c = { t: esc(text) }; if (s) c.s = s; return c; }
  /** OT 탭 (원장님 2026-11-06 "원장님 · 공지윤 학생 OT 시트 그대로 기본 세팅"): 원장님이 홈페이지에서 만든 OT 시트와 같은 칸 ·
      글씨 크기 · 열 너비, 답은 비워 둠 (일자 = 오늘, 이름 = 학생). 신입생 처음 열 때 · 아래 탭 + → "OT"에서 씀. */
  var OT_ROWS = [[2, "일자"], [5, "이름"], [6, "생년월일 / 학교"], [7, "사는 곳"], [8, "등록경로"], [9, "댄스 레슨 유무"], [10, "레슨유무"],
    [11, "악기"], [12, "희망 클래스"], [13, "좋아하는 가수"], [14, "좋아하는 노래/장르"], [16, "오디션 유무"], [18, "특이사항"],
    [20, "지망하는 기획사"], [21, "가수 장르/포지션"], [23, "레슨목표"]];
  function otTemplate(name) {
    var d = { v: 1, n: 100, w: { 0: 150, 1: 329, 2: 503 }, h: {}, c: {} };
    for (var r = 0; r < 40; r++) d.c[r + ",2"] = { s: { z: 20 } }; // 답 칸 (C열) 글씨 20
    OT_ROWS.forEach(function (x) { d.c[x[0] + ",1"] = cellOf(x[1], { b: 1, z: x[1] === "일자" ? 24 : 27 }); });
    d.c["2,2"] = cellOf(todayKst(), { z: 20 });
    if (name) d.c["5,2"] = cellOf(name, { z: 20 });
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
  function studentName(id) { var x = students.filter(function (m) { return m.id === id; })[0]; return x ? x.name : ""; }
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
        return LeeshAPI.rpc("teacher_starter", { p_member: id, p_ot: otTemplate(studentName(id)), p_form: LeeshGrid.template(FIELDS) }).then(function (st) {
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
    app.appendChild(glance(res, book));
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
    var logCards = {};
    res.logs.forEach(function (l) {
      var c = el("article", "fold__card");
      c.appendChild(el("p", "fold__date", dayLabel(l.day) + (l.minutes ? " · " + l.minutes + "분" : "")));
      if (l.song) c.appendChild(el("p", "fold__main", l.song));
      if (l.did) c.appendChild(el("p", "fold__body", l.did));
      if (l.id) logCards[l.id] = c;
      pages.logs.appendChild(c);
    });
    logPhotos(book, logCards);

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
    if (cur.kind === "new") items.unshift({ kind: "n", label: cur.label, name: cur.name || "", title: "오늘의 수업 내용", active: true, entry: null, max: 60 });
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
        ["새 빈 시트 (곡 · 가사 · 자료)", function () { newSheet(book); }],
        ["OT (첫 수업 시트)", function () { newSheet(book, "OT", otTemplate(book.s.name)); }]
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
        if (e) out.push(["복사본 만들기", function () { dupTab(book, e, it.label); }]);
        if (e && e.kind === "s" && !e.obj.src) out.push(null, ["이 시트 지우기", function () { delSheet(book, e.obj); }, true]);
        if (e && e.kind === "n") out.push(null, ["이 일지 지우기", function () { delNote(book, e.obj); }, true]);
        return out;
      }
    };
  }
  /** 새 시트 (빈 시트 또는 OT): 맨 왼쪽 탭으로 (원장님 2026-11-06 "새로 만든 시트는 맨 오른쪽 말고 맨 왼쪽에") */
  function newSheet(book, base, data, dup) {
    base = base || "시트";
    data = data || { v: 1, n: 100, w: {}, h: {}, c: {} };
    var names = {};
    book.sheets.forEach(function (x) { names[x.title] = 1; });
    var title = base;
    if (base === "시트") { var n = 1; while (names["시트" + n]) n++; title = "시트" + n; }
    else { var k = 2; while (names[title]) title = base + " " + k++; }
    var key = uid();
    LeeshAPI.rpc("teacher_sheet_save", { p_member: book.s.id, p_title: title, p_sheet: data, p_key: key }, undefined, { retry: 2 }).then(function (r) {
      if (!r.ok) { if (book.page) say(book.page.msg, r.error, "error"); return; }
      var x = { id: r.id, title: title, src: false, siteEdited: true, pos: 0, tabPos: null, data: JSON.parse(JSON.stringify(data)) };
      book.sheets.push(x);
      toFront(book, "s", x.id);
      book.go({ kind: "s", id: x.id, obj: x }).then(function (p) { if (p) say(p.msg, (dup ? "복사본을" : base === "OT" ? "OT 시트를" : "새 시트를") + " 맨 왼쪽에 만들었어요. 탭을 두 번 누르면 이름을 바꿔요.", "ok"); });
    });
  }
  /** 시트 통째로 복사본 (선생님 의견 2026-11-07 "시트 자체 복사가 안 돼요", 구글시트의 "복사본 만들기"처럼).
   *  일지 → 오늘 날짜 새 일지 "○○ 사본" (수업 날짜 칸에서 바꾸기) · 곡·자료 → 새 시트 "○○ 사본". 둘 다 맨 왼쪽 탭. */
  function dupTab(book, e, label) {
    (book.page ? book.page.leave() : Promise.resolve(true)).then(function (ok) {
      if (ok === false) return; // 지금 시트가 저장이 안 됐으면 그대로
      if (e.kind === "s") {
        var x = e.obj;
        (x.data ? Promise.resolve({ ok: true, sheet: x.data }) : LeeshAPI.rpc("teacher_lesson_sheet", { p_id: x.id }, undefined, { retry: 2 })).then(function (r) {
          if (!r.ok) { if (book.page) say(book.page.msg, r.error, "error"); return; }
          newSheet(book, x.title + " 사본", JSON.parse(JSON.stringify(r.sheet)), true);
        });
        return;
      }
      var data = JSON.parse(JSON.stringify(LeeshGrid.fromNote(e.obj, FIELDS)));
      if (!LeeshGrid.text(data)) { if (book.page) say(book.page.msg, "빈 일지라 복사할 내용이 없어요.", "warn"); return; }
      var title = (label + " 사본").slice(0, 60);
      book.go({ kind: "new", draft: { a: { p_sheet: data, p_date: todayKst(), p_key: uid() }, title: title } }).then(function (p) {
        if (p) say(p.msg, "\"" + label + "\" 일지의 복사본을 오늘 날짜로 만들었어요. 수업 날짜 · 탭 이름은 바꿀 수 있어요.", "ok");
      });
    });
  }
  /** 이 탭을 맨 왼쪽으로: 지금 순서 그대로 두고 앞에 끼워 서버에 순서 저장 */
  function toFront(book, kind, id) {
    var list = entries(book).filter(function (e) { return !(e.kind === kind && e.id === id); });
    var ids = [kind + id].concat(list.map(function (e) { return e.kind + e.id; }));
    var all = (kind === "n" ? book.notes : book.sheets).filter(function (o) { return o.id === id; })[0];
    if (all) all.tabPos = 0;
    list.forEach(function (e, i) { e.obj.tabPos = i + 1; });
    LeeshAPI.rpc("teacher_tab_order", { p_member: book.s.id, p_order: ids }, undefined, { retry: 2 });
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
  /* ---------- 나란히 보기 (원장님 2026-11-07 "곡·자료는 수업에 꼭 필요한 자료라 레슨 노트랑 같이 보면서"):
     지금 쓰는 시트 옆(좁은 화면은 아래)에 곡·자료 한 장을 보기만으로 띄워 둬요. 학생 안에서 탭을 바꿔도 그대로, 고치려면 "이 시트 열기". ---------- */
  function sideBy(book, gridNode, curSheet) {
    var wrap = el("div", "tch__sidewrap");
    var bar = el("div", "tch__sidebar");
    var pick = el("select", "tch__sidepick");
    pick.setAttribute("aria-label", "옆에 같이 볼 곡·자료");
    var split = el("div", "tch__split");
    var main = el("div", "tch__splitmain");
    main.appendChild(gridNode);
    split.appendChild(main);
    var side = el("section", "tch__side2");
    side.hidden = true;
    var head = el("div", "tch__side2head");
    var title = el("b", "tch__side2title");
    var openIt = button("이 시트 열기", "sys-link");
    var close = button("닫기 ✕", "sys-link");
    head.appendChild(title); head.appendChild(openIt); head.appendChild(close);
    var body = el("div", "tch__side2body");
    side.appendChild(head); side.appendChild(body);
    split.appendChild(side);
    var list = (book.sheets || []).filter(function (x) { return x.id !== curSheet; })
      .sort(function (a, b) { return (a.tabPos != null ? a.tabPos : 9999) - (b.tabPos != null ? b.tabPos : 9999) || (a.pos || 0) - (b.pos || 0) || a.id - b.id; });
    var none = el("option", null, list.length ? "📄 곡·자료 옆에 같이 보기…" : "같이 볼 곡·자료가 없어요");
    none.value = "";
    pick.appendChild(none);
    list.forEach(function (x) { var o = el("option", null, x.title); o.value = String(x.id); pick.appendChild(o); });
    pick.disabled = !list.length;
    bar.appendChild(pick);
    wrap.appendChild(bar);
    wrap.appendChild(split);
    var showing = null;
    function show(id) {
      var x = list.filter(function (y) { return y.id === id; })[0];
      if (!x) { hide(); return; }
      showing = x;
      book.sideId = x.id;
      pick.value = String(x.id);
      title.textContent = x.title;
      side.hidden = false;
      split.classList.add("is-split");
      body.textContent = "";
      body.appendChild(el("p", "sys-note", "불러오는 중…"));
      (x.data ? Promise.resolve({ ok: true, sheet: x.data }) : LeeshAPI.rpc("teacher_lesson_sheet", { p_id: x.id }, undefined, { retry: 1 })).then(function (r) {
        if (showing !== x) return;
        body.textContent = "";
        if (!r.ok) { body.appendChild(el("p", "sys-msg sys-msg--error", r.error)); return; }
        x.data = r.sheet;
        body.appendChild(LeeshGrid.view(r.sheet));
      });
    }
    function hide() {
      showing = null;
      book.sideId = null;
      pick.value = "";
      side.hidden = true;
      split.classList.remove("is-split");
      body.textContent = "";
    }
    pick.addEventListener("change", function () { if (pick.value) show(Number(pick.value)); else hide(); });
    close.addEventListener("click", hide);
    openIt.addEventListener("click", function () { if (showing) book.go({ kind: "s", id: showing.id, obj: showing }); });
    if (book.sideId && book.sideId !== curSheet) show(book.sideId);
    return wrap;
  }

  /* ---------- 레슨 사진 (원장님 2026-11-07 "사진 올리기 가능하게"): 일지 · 곡·자료 아래 사진 줄 (js/photos.js) ---------- */
  var photoUrls = {};
  function photoUrl(path) {
    if (!photoUrls[path]) {
      photoUrls[path] = LeeshAPI.kakao.token().then(function (t) { return LeeshAPI.storage.photo(path, t); });
      photoUrls[path].then(function (u) { if (!u) delete photoUrls[path]; });
    }
    return photoUrls[path];
  }
  // 학생이 연습 일지에 붙인 사진 (원장님 2026-11-10): 보기만
  function logPhotos(book, cards) {
    if (!window.LeeshPhotos || !Object.keys(cards).length) return;
    if (!book.logPhotosP) book.logPhotosP = LeeshAPI.rpc("teacher_log_photos", { p_member: book.s.id }).then(function (r) { return r.ok ? r.items : []; }, function () { return []; });
    book.logPhotosP.then(function (items) {
      var by = {};
      items.forEach(function (p) { (by[p.log] = by[p.log] || []).push(p); });
      Object.keys(by).forEach(function (id) {
        if (cards[id]) cards[id].appendChild(LeeshPhotos.strip({ items: by[id], canEdit: false, load: photoUrl }).node);
      });
    });
  }
  function photoList(book) {
    if (!book.photosP) {
      book.photosP = LeeshAPI.rpc("teacher_photos", { p_member: book.s.id }, undefined, { retry: 1 }).then(function (r) {
        book.photos = r.ok ? r.items : [];
        return book.photos;
      });
    }
    return book.photosP;
  }
  /** ref() → { note } | { sheet } | null (아직 저장 안 된 새 일지) · saveFirst() → 새 일지를 먼저 저장 · student = 학생도 보는 사진(레슨 노트) */
  function photoBox(book, ref, saveFirst, student) {
    var box = window.LeeshPhotos ? LeeshPhotos.strip({
      items: [], canEdit: true, load: photoUrl, onAdd: add, onDelete: del,
      note: "사진은 담당 선생님 · 원장님" + (student ? " · 이 학생" : "") + "만 볼 수 있어요. 휴대폰은 사진 올리기를 누르면 바로 찍을 수도 있어요."
    }) : null;
    if (!box) return document.createElement("span");
    function mine() {
      var r = ref();
      if (!r) return [];
      return (book.photos || []).filter(function (p) { return r.note ? p.note === r.note : p.sheet === r.sheet; });
    }
    function redraw() { box.set(mine()); }
    photoList(book).then(redraw);
    function add(files) {
      var r0 = ref();
      (r0 ? Promise.resolve(r0) : (saveFirst ? saveFirst() : Promise.resolve()).then(function () { return ref(); })).then(function (r) {
        if (!r) { box.busy("먼저 일지에 내용을 조금 써 주세요. 저장되면 사진을 붙일 수 있어요.", "error"); return; }
        var left = LeeshPhotos.MAX_FILES - mine().length;
        if (left <= 0) { box.busy("한 시트에 사진은 " + LeeshPhotos.MAX_FILES + "장까지예요.", "error"); return; }
        var list = files.slice(0, left), done = 0, failed = 0, why = "";
        box.busy("사진 올리는 중… 0 / " + list.length);
        return list.reduce(function (chain, file) {
          return chain.then(function () {
            return LeeshPhotos.shrink(file).then(function (sm) {
              var path = book.s.id + "/" + uid().replace(/[^a-z0-9]/g, "") + "." + sm.ext;
              return LeeshAPI.kakao.token().then(function (t) { return LeeshAPI.storage.uploadPhoto(path, sm.blob, t); }).then(function (ok) {
                if (!ok) throw new Error("인터넷 연결을 확인해 주세요.");
                return LeeshAPI.rpc("teacher_photo_add", { p_member: book.s.id, p_note: r.note || null, p_sheet: r.sheet || null, p_path: path, p_w: sm.w, p_h: sm.h }, undefined, { retry: 2 });
              }).then(function (res) {
                if (!res.ok) throw new Error(res.error);
                photoUrls[path] = Promise.resolve(URL.createObjectURL(sm.blob));
                (book.photos = book.photos || []).push({ id: res.id, note: r.note || null, sheet: r.sheet || null, path: path, w: sm.w, h: sm.h });
                done++;
                redraw();
                box.busy("사진 올리는 중… " + done + " / " + list.length);
              });
            }).catch(function (e) { failed++; why = (e && e.message) || ""; });
          });
        }, Promise.resolve()).then(function () {
          var more = files.length > list.length ? " (한 시트에 " + LeeshPhotos.MAX_FILES + "장까지라 " + (files.length - list.length) + "장은 뺐어요)" : "";
          if (failed) box.busy(done + "장 올렸어요 · " + failed + "장은 못 올렸어요. " + why + more, "error");
          else box.busy(done + "장 올렸어요." + more, "ok");
        });
      });
    }
    function del(it) {
      LeeshAPI.rpc("teacher_photo_delete", { p_id: it.id }).then(function (res) {
        if (!res.ok) { box.busy(res.error, "error"); return; }
        book.photos = (book.photos || []).filter(function (p) { return p.id !== it.id; });
        redraw();
        box.busy("사진을 지웠어요.", "ok");
        LeeshAPI.kakao.token().then(function (t) { LeeshAPI.storage.removePhotos([it.path], t); });
      });
    }
    return box.node;
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
    f.appendChild(sideBy(book, grid.node, null));
    // 레슨 사진 (2026-11-07): 새 일지는 먼저 저장한 뒤에 붙여요
    f.appendChild(photoBox(book, function () { return noteId ? { note: noteId } : null; }, function () { return sv.push(true); }, true));
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
          toFront(book, "n", noteId); // 새 일지도 맨 왼쪽 탭으로
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
      box.appendChild(sideBy(book, grid.node, x.id));
      box.appendChild(photoBox(book, function () { return { sheet: x.id }; }, null, false));
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
  function glance(res, book) {
    var wrap = el("div", "tch__glance");
    wrap.appendChild(lastTime(res.notes, null));
    var side = el("div", "tch__side");
    var logs = el("section", "tch__mini");
    logs.appendChild(el("h4", "tch__minihead", "최근 연습 일지"));
    if (!res.logs.length) logs.appendChild(el("p", "book__empty", "학생이 쓴 연습 일지가 없어요."));
    var miniCards = {};
    res.logs.slice(0, 3).forEach(function (l) {
      var c = el("div", "tch__miniitem");
      c.appendChild(el("p", "fold__date", dayLabel(l.day) + (l.minutes ? " · " + l.minutes + "분" : "")));
      if (l.song) c.appendChild(el("p", "fold__main", l.song));
      if (l.did) c.appendChild(el("p", "fold__body", l.did));
      if (l.id) miniCards[l.id] = c;
      logs.appendChild(c);
    });
    logPhotos(book, miniCards);
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
    side.appendChild(visitMonth(book));
    wrap.appendChild(side);
    return wrap;
  }

  /** 이번 달 학원 내방 오디션 일정 + 이 학생이 신청했는지 (원장님 2026-11-11 "레슨할 때 좋게"). */
  function visitMonth(book) {
    var box = el("section", "tch__mini tch__visits");
    var m = Number(todayKst().slice(5, 7));
    box.appendChild(el("h4", "tch__minihead", "🏫 " + m + "월 학원 내방 오디션"));
    var body = el("p", "sys-note", "불러오는 중…");
    box.appendChild(body);
    LeeshAPI.rpc("teacher_visit_month", { p_member: book.s.id }).then(function (r) {
      box.removeChild(body);
      if (!r.ok) { box.appendChild(el("p", "sys-note", r.error || "불러오지 못했어요.")); return; }
      if (!r.items.length) { box.appendChild(el("p", "book__empty", "이번 달 내방 오디션 일정이 아직 없어요.")); return; }
      var today = todayKst();
      var ul = el("ul", "tch__songs");
      r.items.forEach(function (v) {
        var li = el("li", v.date < today ? "is-past" : null);
        var tag = v.applied ? "신청함" : v.date < today ? "지남" : v.deadline < today ? "마감" : "미신청";
        li.appendChild(el("span", "fold__tag" + (v.applied ? " is-done" : ""), tag));
        li.appendChild(el("b", null, " " + dayLabel(v.date) + " "));
        li.appendChild(document.createTextNode(v.company || "내방 오디션"));
        if (v.applied && v.field) li.appendChild(el("small", null, " (" + v.field + ")"));
        if (v.applied && v.note) li.appendChild(el("small", "tch__visitnote", v.note));
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }, function () { box.removeChild(body); box.appendChild(el("p", "sys-note", "불러오지 못했어요.")); });
    return box;
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
