// teacher.html: 선생님 화면. 선생님은 관리자가 아니라 "선생님" 권한 (원장님 2026-10-28).
// 카카오로 로그인 → 처음이면 이름을 골라 연결 요청 → 원장님이 관리자 → 선생님 탭에서 승인 → 담당 학생(수강생 메모
// "담당 ○○○", 재원·휴원)만 보이고, 학생마다 레슨 일지를 씀 (js/config.js lessonFields). 학생은 내 폴더 → 레슨 노트에서
// 봐요. "선생님 메모"는 학생에게 안 보여요. 서버(teacher_* 함수)가 담당 학생인지·내가 쓴 일지인지 다시 확인해요.
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
    var m = el("p", "sys-msg");
    app.appendChild(m);
    if (LeeshAPI.kakao.lastError()) say(m, "카카오 로그인을 마치지 못했어요. 다시 눌러주세요.", "error");
    else if (note) say(m, note, kind);
  }
  function signOut() { LeeshAPI.kakao.signOut(); me = null; signIn(); }
  function outButton() {
    var b = button("다른 카카오 계정으로 로그인", "sys-link");
    b.addEventListener("click", signOut);
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
  function list() {
    clear();
    app.appendChild(header("담당 학생 " + students.length + "명 · 학생을 누르면 레슨 일지를 써요."));
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

  /* ---------- 학생 한 명: 일지 쓰기 + 지난 일지 + 연습 일지 · 레퍼토리 ---------- */
  function open(id, note) {
    clear();
    app.appendChild(el("p", "sys-note", "불러오는 중…"));
    return LeeshAPI.rpc("teacher_student", { p_member: id }).then(function (res) {
      if (!res.ok) { list(); var m = el("p", "sys-msg sys-msg--error", res.error); app.insertBefore(m, app.children[1] || null); return; }
      clear();
      var s = res.student;
      app.appendChild(header());
      var back = button("← 담당 학생", "sys-link tch__back");
      // 쓰던 일지는 저장하고 나가요
      back.addEventListener("click", function () { (form ? form.flush() : Promise.resolve()).then(function () { start(); }); });
      app.appendChild(back);
      app.appendChild(el("h3", "tch__name", s.name + (s.status !== "재원" ? " (" + s.status + ")" : "")));
      var form = noteForm(s, res.notes, null);
      app.appendChild(form.node);
      if (note) say(form.msg, note, "ok");

      var tabs = el("div", "sys-chips tch__tabs");
      var pages = {};
      [["notes", "지난 일지 " + res.notes.length], ["logs", "연습 일지"], ["songs", "레퍼토리"]].forEach(function (t, i) {
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
      res.notes.forEach(function (n) { pages.notes.appendChild(noteCard(s, n, res.notes, form)); });

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
    });
  }

  /**
   * The write / edit form. editing = a note of mine to change, or null for a new one.
   * 칸마다 꾸미기 버튼 (js/richtext.js) + 쓰는 동안 저절로 저장 (원장님 2026-10-29: 수업하면서 같이 보며 씀).
   */
  function noteForm(s, notes, editing) {
    var f = el("form", "sys tch__form");
    f.appendChild(el("h4", "rec__title", editing ? dayLabel(editing.date) + " 일지 고치기" : "오늘 일지 쓰기"));
    var dl = el("label", "sys-field");
    dl.appendChild(el("span", null, "수업 날짜"));
    var date = el("input");
    date.type = "date";
    date.required = true;
    date.value = editing ? editing.date : todayKst();
    dl.appendChild(date);
    f.appendChild(dl);
    f.appendChild(el("p", "sys-note tch__how", "구글시트처럼 글자를 고르고 위 버튼(크기 · 굵게 · 색 · 채우기)을 누르면 꾸며져요. 안 고르고 누르면 그 칸 전체가 바뀌어요. 쓰는 동안 저절로 저장돼요."));
    var sh = LeeshRich.sheet({ fields: FIELDS, values: editing || {}, onInput: later });
    f.appendChild(sh.node);
    var inputs = sh.eds;
    var row = el("div", "fold__actions");
    var save = el("button", "sys-btn", editing ? "고친 내용 저장" : "저장하고 닫기");
    save.type = "submit";
    row.appendChild(save);
    var last = notes.filter(function (n) { return n.mine; })[0] || notes[0];
    if (!editing && last) {
      // 지난번 일지를 불러와 고치기만 (선생님 일이 늘지 않게)
      var copy = button("지난 일지 불러오기", "sys-link");
      copy.addEventListener("click", function () {
        FIELDS.forEach(function (fd) { inputs[fd[0]].set(last[fd[0]] || "", last.rich); });
        say(msg, dayLabel(last.date) + " 일지를 불러왔어요. 고칠 곳만 고치면 저절로 저장돼요.");
      });
      row.appendChild(copy);
    }
    if (editing) {
      var cancel = button("고치기 그만", "sys-link");
      cancel.addEventListener("click", function () { flush().then(function () { open(s.id); }); });
      row.appendChild(cancel);
    }
    f.appendChild(row);
    var msg = el("p", "sys-msg");
    msg.setAttribute("role", "status");
    f.appendChild(msg);
    f.appendChild(el("p", "sys-note", cfg.studentNotes === false
      ? "지금은 학생에게 보이지 않아요 (원장님이 켜면 그때부터 학생 내 폴더 → 레슨 노트에 보여요). 🔒 선생님 메모는 언제나 학생에게 안 보여요."
      : "저장하면 학생 내 폴더 → 레슨 노트에 바로 보여요. 🔒 선생님 메모는 학생에게 안 보여요."));

    // 저절로 저장: 마지막으로 쓴 뒤 2초. 처음 저장하면 그 일지 번호로 계속 고쳐요.
    var noteId = editing ? editing.id : null, timer = null, busy = null, dirty = false;
    function args() {
      var a = { p_member: s.id, p_date: date.value, p_note: noteId, p_rich: true }, any = false;
      FIELDS.forEach(function (fd) { var v = inputs[fd[0]].get(); a["p_" + fd[0]] = v || null; if (v) any = true; });
      return any ? a : null;
    }
    function tooLong() { return FIELDS.filter(function (fd) { return inputs[fd[0]].over(); })[0]; }
    function later() {
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(function () { push(false); }, 2000);
    }
    function push(loud) {
      clearTimeout(timer);
      if (busy) { dirty = true; return busy; }
      var a = args(), long = tooLong();
      if (long) { say(msg, long[1] + " 칸이 너무 길어요 (" + long[3] + "자까지).", "error"); return Promise.resolve(false); }
      if (!a || !date.value) { if (loud) say(msg, "한 칸 이상 적어주세요.", "error"); return Promise.resolve(!a ? null : false); }
      dirty = false;
      say(msg, "저장하는 중…");
      busy = LeeshAPI.rpc("teacher_note_save", a).then(function (res) {
        busy = null;
        if (!res.ok) { dirty = true; say(msg, res.error, "error"); return false; }
        noteId = res.id;
        var t = new Date();
        say(msg, "저장됨 " + String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0"), "ok");
        students.forEach(function (x) { if (x.id === s.id && (!x.last || date.value > x.last)) x.last = date.value; });
        if (dirty) return push(loud);
        return true;
      });
      return busy;
    }
    function flush() { return dirty || timer ? push(false) : busy || Promise.resolve(true); }
    date.addEventListener("change", function () { if (noteId) later(); });
    // 다른 앱으로 넘어가거나 화면이 꺼질 때 바로 저장
    document.addEventListener("visibilitychange", function () { if (document.hidden && f.isConnected && dirty) push(false); });

    f.addEventListener("submit", function (e) {
      e.preventDefault();
      save.disabled = true;
      push(true).then(function (ok) {
        save.disabled = false;
        if (!ok) return;
        open(s.id, cfg.studentNotes === false ? (editing ? "고쳤어요." : "저장했어요.") : editing ? "고쳤어요. 학생 화면에도 바뀌어 보여요." : "저장했어요. 학생 내 폴더에 바로 보여요.");
      });
    });
    return { node: f, msg: msg, flush: flush };
  }

  function noteCard(s, n, notes, form) {
    var c = el("article", "lnote");
    var head = el("p", "lnote__date", dayLabel(n.date));
    if (n.teacher) head.appendChild(el("span", "lnote__teacher", n.teacher + " 선생님"));
    c.appendChild(head);
    FIELDS.forEach(function (fd) {
      if (!n[fd[0]]) return;
      c.appendChild(el("p", "lnote__label", fd[1] + (fd[0] === "memo" ? " 🔒 학생에게 안 보여요" : "")));
      c.appendChild(LeeshRich.view(n[fd[0]], n.rich, "lnote__did" + (fd[0] === "memo" ? " tch__memotext" : "")));
    });
    if (n.mine) {
      var row = el("p", "fold__actions");
      var edit = button("고치기", "sys-link");
      edit.addEventListener("click", function () {
        form.flush();
        var f2 = noteForm(s, notes, n);
        form.node.replaceWith(f2.node);
        form.node = f2.node;
        form.flush = f2.flush;
        f2.node.scrollIntoView({ behavior: "smooth", block: "start" });
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
