/* 레슨실 예약 (원장님 2026-11-24): 레슨실 A1~A4는 선생님 · 관리자만. 시트 "레슨실 예약" · "수업방관리"를 홈페이지로.
   정규 = 매주 같은 요일 · 시간 · 방 (퇴원 전까지) · 보강 = 그날 한 번. 10분 단위, 24시간.
   LeeshLessonRoom.render(box, call) — call(fn, args)는 서버 결과({ ok, ... })를 돌려주는 Promise.
   선생님 화면(teacher.html "🎹 레슨실")과 관리자 화면(레슨실 탭)이 같이 씀. 서버 lesson_room_view · book · cancel · move. */
(function () {
  var WD = ["일", "월", "화", "수", "목", "금", "토"];
  var ROW = 14; // 10분 한 칸의 높이(px)

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function btn(text, cls) { var b = el("button", cls || "sys-btn", text); b.type = "button"; return b; }
  function addDays(d, n) { var t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
  function todayKst() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
  function wdOf(d) { return new Date(d + "T00:00:00Z").getUTCDay(); }
  function monday(d) { return addDays(d, -((wdOf(d) + 6) % 7)); }
  function md(d) { return Number(d.slice(5, 7)) + "/" + Number(d.slice(8, 10)) + "(" + WD[wdOf(d)] + ")"; }
  function hhmm(m) { return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); }
  function say(node, text, kind) { node.textContent = text || ""; node.className = "sys-msg" + (kind ? " sys-msg--" + kind : ""); }
  // 두 번 눌러야 하는 버튼 (취소 · 빼기)
  function arm(b, warn, fn) {
    var text = b.textContent, armed = false, timer = null;
    b.addEventListener("click", function () {
      if (!armed) { armed = true; b.textContent = warn; timer = setTimeout(function () { armed = false; b.textContent = text; }, 4000); return; }
      clearTimeout(timer); armed = false; b.textContent = text; fn();
    });
  }
  function field(label, input, hint) {
    var f = el("label", "sys-field lr__field");
    f.appendChild(el("span", null, label));
    f.appendChild(input);
    if (hint) f.appendChild(hint);
    return f;
  }
  function select(options, value) {
    var s = el("select");
    options.forEach(function (o) { var x = el("option", null, o[1]); x.value = o[0]; s.appendChild(x); });
    if (value != null) s.value = String(value);
    return s;
  }
  function timeSelects(min) {
    var h = select(Array.from({ length: 24 }, function (_, i) { return [i, String(i).padStart(2, "0") + "시"]; }), Math.floor((min || 600) / 60));
    var m = select([0, 10, 20, 30, 40, 50].map(function (i) { return [i, String(i).padStart(2, "0") + "분"]; }), (min || 600) % 60);
    var wrap = el("span", "lr__time");
    wrap.appendChild(h); wrap.appendChild(m);
    return { node: wrap, value: function () { return hhmm(Number(h.value) * 60 + Number(m.value)); } };
  }
  function minutesSelect(v) {
    var o = [];
    for (var i = 10; i <= 240; i += 10) o.push([i, i % 60 === 0 ? i / 60 + "시간" : i > 60 ? Math.floor(i / 60) + "시간 " + (i % 60) + "분" : i + "분"]);
    return select(o, v || 50);
  }

  function render(box, call) {
    var st = { from: monday(todayKst()), day: todayKst(), mode: "day", data: null };
    box.textContent = "";
    box.classList.add("lr");
    var note = el("p", "lr__sim");
    note.hidden = true;
    var nav = el("div", "lr__nav");
    var prev = btn("◀ 지난주", "sys-btn sys-btn--ghost lr__step");
    var week = el("b", "lr__week-label");
    var next = btn("다음 주 ▶", "sys-btn sys-btn--ghost lr__step");
    var today = btn("오늘", "sys-btn sys-btn--ghost lr__step");
    var pick = el("input", "lr__pick");
    pick.type = "date";
    pick.setAttribute("aria-label", "날짜로 가기");
    var modes = el("div", "lr__modes");
    var mDay = btn("하루 보기", "lr__mode"), mWeek = btn("주간 표", "lr__mode");
    modes.appendChild(mDay); modes.appendChild(mWeek);
    var add = btn("+ 새 예약", "sys-btn lr__add");
    [prev, week, next, today, pick, modes, add].forEach(function (n) { nav.appendChild(n); });
    var days = el("div", "lr__days");
    var panel = el("div", "lr__panel");
    panel.hidden = true;
    var body = el("div", "lr__body");
    var toast = el("p", "sys-msg lr__toast");
    [note, nav, days, toast, panel, body].forEach(function (n) { box.appendChild(n); });

    function load() {
      body.textContent = "";
      body.appendChild(el("p", "sys-note", "불러오는 중…"));
      return call("lesson_room_view", { p_from: st.from, p_days: 7 }).then(function (d) {
        body.textContent = "";
        if (!d || !d.ok) { body.appendChild(el("p", "sys-msg sys-msg--error", (d && d.error) || "불러오지 못했어요.")); return; }
        st.data = d;
        if (st.day < st.from || st.day > addDays(st.from, 6)) st.day = st.from;
        note.hidden = !!d.open;
        note.textContent = "🧪 시뮬레이션 중 · 선생님들 화면에는 아직 안 보여요 (관리자 · 원장님만). 실제 수업과 상관없이 마음껏 넣고 지워 보세요.";
        week.textContent = md(st.from) + " ~ " + md(addDays(st.from, 6));
        pick.value = st.day;
        mDay.classList.toggle("is-on", st.mode === "day");
        mWeek.classList.toggle("is-on", st.mode === "week");
        drawDays();
        if (st.mode === "day") drawDay(); else drawWeek();
      });
    }
    function itemsOn(d) { return (st.data.items || []).filter(function (i) { return i.date === d; }); }
    function drawDays() {
      days.textContent = "";
      days.hidden = st.mode !== "day";
      for (var i = 0; i < 7; i++) {
        (function (d) {
          var c = btn("", "lr__day" + (d === st.day ? " is-on" : "") + (d === st.data.today ? " is-today" : ""));
          c.appendChild(el("b", null, WD[wdOf(d)] + " " + Number(d.slice(8, 10))));
          c.appendChild(el("span", null, itemsOn(d).length + "건"));
          c.addEventListener("click", function () { st.day = d; drawDays(); drawDay(); });
          days.appendChild(c);
        })(addDays(st.from, i));
      }
    }
    function who(it) { return it.name || (it.teacher ? it.teacher + " 선생님" : "예약"); }
    function drawDay() {
      body.textContent = "";
      var rooms = st.data.rooms || [], list = itemsOn(st.day);
      body.appendChild(el("p", "lr__hint", md(st.day) + " · 빈 곳을 누르면 그 방 · 그 시간으로 예약 칸이 열려요. 예약을 누르면 빼기 · 옮기기 · 취소."));
      var grid = el("div", "lr__grid");
      grid.style.setProperty("--cols", rooms.length);
      var head = el("div", "lr__ghead");
      head.appendChild(el("span"));
      rooms.forEach(function (r) { head.appendChild(el("b", null, r.name)); });
      grid.appendChild(head);
      var scroll = el("div", "lr__scroll");
      var cols = el("div", "lr__cols");
      cols.style.height = 144 * ROW + "px";
      var tcol = el("div", "lr__tcol");
      for (var h = 0; h < 24; h++) { var lab = el("span", null, String(h).padStart(2, "0") + ":00"); lab.style.top = h * 6 * ROW + "px"; tcol.appendChild(lab); }
      cols.appendChild(tcol);
      var first = null; // 처음 보이는 곳: 그날 첫 수업 30분 전 (없으면 오전 10시)
      rooms.forEach(function (r) {
        var col = el("div", "lr__col");
        col.setAttribute("aria-label", r.name + " 시간표");
        col.addEventListener("click", function (e) {
          if (e.target !== col) return;
          var rect = col.getBoundingClientRect(), min = Math.max(0, Math.min(1430, Math.floor((e.clientY - rect.top) / ROW) * 10));
          openForm({ room: r.name, date: st.day, start: min });
        });
        list.filter(function (i) { return i.room === r.name; }).forEach(function (it) {
          first = first == null ? it.st : Math.min(first, it.st);
          var b = btn("", "lr__blk lr__blk--" + (it.kind === "정규" ? "reg" : "once") + (it.edit ? " is-mine" : " is-other"));
          b.style.top = it.st / 10 * ROW + "px";
          b.style.height = Math.max(ROW, (it.en - it.st) / 10 * ROW) - 2 + "px";
          b.appendChild(el("b", null, it.start + "~" + it.end));
          b.appendChild(el("span", null, who(it)));
          b.appendChild(el("i", null, it.kind + (it.name && it.teacher && st.data.director ? " · " + it.teacher : "")));
          b.title = r.name + " · " + it.start + "~" + it.end + " · " + who(it) + " · " + it.kind;
          b.addEventListener("click", function () { openDetail(it); });
          col.appendChild(b);
        });
        if (st.day === st.data.today) {
          var k = new Date(Date.now() + 9 * 3600000), now = el("span", "lr__now");
          now.style.top = (k.getUTCHours() * 60 + k.getUTCMinutes()) / 10 * ROW + "px";
          col.appendChild(now);
        }
        cols.appendChild(col);
      });
      scroll.appendChild(cols);
      grid.appendChild(scroll);
      body.appendChild(grid);
      scroll.scrollTop = Math.max(0, ((first == null ? 600 : first - 30)) / 10 * ROW);
    }
    function drawWeek() {
      body.textContent = "";
      var rooms = st.data.rooms || [];
      body.appendChild(el("p", "lr__hint", "시트 \"수업방관리\"와 같은 표예요. 날짜를 누르면 그날 시간표로, 예약을 누르면 자세히."));
      var wrap = el("div", "lr__wkwrap");
      var t = el("table", "lr__wk");
      var tr = el("tr");
      tr.appendChild(el("th", null, "방"));
      for (var i = 0; i < 7; i++) {
        (function (d) {
          var th = el("th");
          var b = btn(WD[wdOf(d)] + " " + Number(d.slice(5, 7)) + "/" + Number(d.slice(8, 10)), "lr__wkday" + (d === st.data.today ? " is-today" : ""));
          b.addEventListener("click", function () { st.day = d; st.mode = "day"; load(); });
          th.appendChild(b);
          tr.appendChild(th);
        })(addDays(st.from, i));
      }
      var thead = el("thead");
      thead.appendChild(tr);
      t.appendChild(thead);
      var tb = el("tbody");
      rooms.forEach(function (r) {
        var row = el("tr");
        row.appendChild(el("th", null, r.name));
        for (var i = 0; i < 7; i++) {
          var d = addDays(st.from, i), td = el("td"), list = itemsOn(d).filter(function (x) { return x.room === r.name; });
          if (!list.length) td.appendChild(el("span", "lr__empty", "공석"));
          list.forEach(function (it) {
            var b = btn(it.start + "~" + it.end + " · " + who(it) + (it.kind === "보강" ? " (보강)" : ""), "lr__wkitem" + (it.edit ? " is-mine" : "") + (it.kind === "보강" ? " is-once" : ""));
            b.addEventListener("click", function () { openDetail(it); });
            td.appendChild(b);
          });
          row.appendChild(td);
        }
        tb.appendChild(row);
      });
      t.appendChild(tb);
      wrap.appendChild(t);
      body.appendChild(wrap);
    }

    function closePanel() { panel.hidden = true; panel.textContent = ""; }
    function show(title) {
      panel.textContent = "";
      panel.hidden = false;
      var h = el("div", "lr__phead");
      h.appendChild(el("b", null, title));
      var x = btn("닫기", "sys-link");
      x.addEventListener("click", closePanel);
      h.appendChild(x);
      panel.appendChild(h);
      setTimeout(function () { panel.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, 0);
    }
    function done(text) {
      closePanel();
      toast.textContent = text; toast.className = "sys-msg sys-msg--ok lr__toast";
      setTimeout(function () { if (toast.textContent === text) toast.textContent = ""; }, 6000);
      load();
    }
    function studentSelect(value) {
      var s = el("select");
      var list = (st.data.students || []).slice();
      if (!list.length) { s.appendChild(el("option", null, "예약할 수 있는 학생이 없어요")); s.disabled = true; return s; }
      s.appendChild(el("option", null, "학생 고르기"));
      s.options[0].value = "";
      if (st.data.admin || st.data.director) {
        var groups = {};
        list.forEach(function (m) { var k = m.teacher || "담당 없음"; (groups[k] = groups[k] || []).push(m); });
        Object.keys(groups).sort(function (a, b) { return a === "담당 없음" ? 1 : b === "담당 없음" ? -1 : a < b ? -1 : 1; }).forEach(function (k) {
          var g = el("optgroup");
          g.label = k === "담당 없음" ? k : "담당 " + k;
          groups[k].forEach(function (m) { var o = el("option", null, m.name); o.value = m.id; g.appendChild(o); });
          s.appendChild(g);
        });
      } else {
        list.forEach(function (m) { var o = el("option", null, m.name); o.value = m.id; s.appendChild(o); });
      }
      if (value) s.value = value;
      return s;
    }
    function roomSelect(v) { return select((st.data.rooms || []).map(function (r) { return [r.name, r.name + "번방"]; }), v); }

    // 새 예약
    function openForm(pre) {
      pre = pre || {};
      show("새 예약");
      var kind = "정규";
      var kinds = el("div", "lr__kinds");
      var kReg = btn("정규 수업 (매주)", "lr__kind is-on"), kOnce = btn("보강 수업 (한 번)", "lr__kind");
      kinds.appendChild(kReg); kinds.appendChild(kOnce);
      panel.appendChild(kinds);
      var stu = studentSelect(pre.member);
      var date = el("input"); date.type = "date"; date.value = pre.date || st.day;
      var dHint = el("small", "lr__dhint");
      var time = timeSelects(pre.start != null ? pre.start : 600);
      var mins = minutesSelect(pre.minutes || 50);
      var room = roomSelect(pre.room || ((st.data.rooms || [])[0] || {}).name);
      var until = el("input"); until.type = "date";
      var memo = el("input"); memo.maxLength = 200; memo.placeholder = "예) 입시반 · 다음 달부터 화요일로";
      var grid = el("div", "lr__fgrid");
      grid.appendChild(field("학생", stu));
      grid.appendChild(field("레슨실", room));
      var dField = field("첫 수업 날짜", date, dHint);
      grid.appendChild(dField);
      grid.appendChild(field("시작 시간", time.node));
      grid.appendChild(field("수업 시간", mins));
      var uField = field("마지막 날 (선택)", until, el("small", "lr__dhint", "비우면 퇴원 · 휴원할 때까지 매주"));
      grid.appendChild(uField);
      grid.appendChild(field("메모 (선택)", memo));
      panel.appendChild(grid);
      function hint() {
        dField.querySelector("span").textContent = kind === "정규" ? "첫 수업 날짜" : "보강 날짜";
        dHint.textContent = date.value ? (kind === "정규" ? "매주 " + WD[wdOf(date.value)] + "요일 · " + md(date.value) + "부터" : md(date.value) + " 한 번") : "";
        uField.hidden = kind !== "정규";
      }
      date.addEventListener("change", hint);
      [[kReg, "정규"], [kOnce, "보강"]].forEach(function (p) {
        p[0].addEventListener("click", function () { kind = p[1]; kReg.classList.toggle("is-on", kind === "정규"); kOnce.classList.toggle("is-on", kind === "보강"); hint(); });
      });
      hint();
      var go = btn("예약하기");
      var m = el("p", "sys-msg");
      go.addEventListener("click", function () {
        if (!stu.value) { say(m, "학생을 골라주세요.", "error"); return; }
        if (!date.value) { say(m, "날짜를 골라주세요.", "error"); return; }
        go.disabled = true;
        say(m, "예약하는 중…");
        call("lesson_room_book", { p_room: room.value, p_member: stu.value, p_kind: kind, p_date: date.value, p_start: time.value(),
          p_minutes: Number(mins.value), p_until: kind === "정규" && until.value ? until.value : null, p_memo: memo.value.trim() || null }).then(function (r) {
          go.disabled = false;
          if (!r || !r.ok) { say(m, (r && r.error) || "예약하지 못했어요.", "error"); return; }
          if (date.value < st.from || date.value > addDays(st.from, 6)) st.from = monday(date.value);
          st.day = date.value;
          done("예약했어요 · " + (stu.selectedOptions[0] || {}).textContent + " · " + room.value + " · " + (kind === "정규" ? "매주 " + WD[wdOf(date.value)] + " " : md(date.value) + " ") + time.value());
        });
      });
      panel.appendChild(go);
      panel.appendChild(m);
    }

    // 예약 자세히 + 빼기 · 옮기기 · 취소
    function openDetail(it) {
      show((it.kind === "정규" ? "정규 수업" : "보강 수업") + " · " + who(it));
      var info = el("div", "lr__info");
      info.appendChild(el("p", null, it.room + "번방 · " + (it.kind === "정규" ? "매주 " + WD[wdOf(it.first)] + " " : md(it.date) + " ") + it.start + "~" + it.end));
      if (it.kind === "정규") info.appendChild(el("p", "sys-note", md(it.first) + "부터 · " + (it.last ? md(it.last) + "까지" : "퇴원 · 휴원할 때까지") + " · 지금 고른 날 " + md(it.date)));
      if (it.teacher) info.appendChild(el("p", "sys-note", "담당 " + it.teacher + " 선생님"));
      if (it.memo) info.appendChild(el("p", "sys-note", "메모 · " + it.memo));
      if (it.source && it.source !== "site") info.appendChild(el("p", "sys-note", it.source === "sheet" ? "시트에서 옮겨 온 예약" : "시뮬레이션 예약"));
      panel.appendChild(info);
      if (!it.edit) { panel.appendChild(el("p", "sys-note", "다른 선생님 수업이에요 (보기만).")); return; }
      var acts = el("div", "lr__acts");
      var m = el("p", "sys-msg");
      function run(fn, args, ok) {
        say(m, "처리하는 중…");
        call(fn, args).then(function (r) { if (!r || !r.ok) { say(m, (r && r.error) || "하지 못했어요.", "error"); return; } done(ok); });
      }
      if (it.kind === "정규") {
        var skip = btn(md(it.date) + " 한 번만 빼기", "sys-btn sys-btn--ghost");
        arm(skip, "한 번 더 누르면 " + md(it.date) + " 수업만 빠져요", function () { run("lesson_room_cancel", { p_id: it.id, p_mode: "once", p_on: it.date }, md(it.date) + " 수업을 뺐어요. 그 시간은 다른 예약에 열려요."); });
        var once = btn(md(it.date) + " 한 번만 다른 시간으로 (보강)", "sys-btn sys-btn--ghost");
        once.addEventListener("click", function () { moveForm(it, "once"); });
        var from = btn("이날부터 시간 바꾸기 (정규 변경)", "sys-btn sys-btn--ghost");
        from.addEventListener("click", function () { moveForm(it, "from"); });
        var end = btn(md(it.date) + "부터 끝내기", "sys-link lr__danger");
        arm(end, "한 번 더 누르면 " + md(it.date) + "부터 안 열려요", function () { run("lesson_room_cancel", { p_id: it.id, p_mode: "from", p_on: it.date }, md(it.date) + "부터 정규 수업을 끝냈어요."); });
        var all = btn("전부 취소 (잘못 넣었을 때)", "sys-link lr__danger");
        arm(all, "한 번 더 누르면 이 정규 수업이 전부 없어져요", function () { run("lesson_room_cancel", { p_id: it.id, p_mode: "all" }, "정규 수업을 취소했어요."); });
        [skip, once, from, end, all].forEach(function (b) { acts.appendChild(b); });
      } else {
        var mv = btn("날짜 · 시간 바꾸기", "sys-btn sys-btn--ghost");
        mv.addEventListener("click", function () { moveForm(it, "once"); });
        var cx = btn("보강 취소", "sys-link lr__danger");
        arm(cx, "한 번 더 누르면 취소돼요", function () { run("lesson_room_cancel", { p_id: it.id, p_mode: "all" }, "보강 수업을 취소했어요."); });
        acts.appendChild(mv); acts.appendChild(cx);
      }
      panel.appendChild(acts);
      panel.appendChild(m);
    }
    function moveForm(it, mode) {
      var title = it.kind === "보강" ? "보강 옮기기" : mode === "once" ? md(it.date) + " 한 번만 다른 시간으로" : "정규 변경 (이날부터 새 시간)";
      show(title + " · " + who(it));
      panel.appendChild(el("p", "sys-note", it.kind === "보강" ? "새 날짜 · 시간 · 방을 고르세요."
        : mode === "once" ? md(it.date) + " 정규 수업은 빠지고, 고른 날짜에 보강으로 들어가요."
        : "고른 날짜부터 새 요일 · 시간 · 방으로 매주 열려요. 그 전 수업은 그대로예요."));
      var date = el("input"); date.type = "date"; date.value = it.date;
      var dHint = el("small", "lr__dhint");
      var time = timeSelects(it.st);
      var mins = minutesSelect(it.en - it.st);
      var room = roomSelect(it.room);
      var grid = el("div", "lr__fgrid");
      grid.appendChild(field(mode === "from" && it.kind === "정규" ? "새 시간 첫 수업 날짜" : "새 날짜", date, dHint));
      grid.appendChild(field("시작 시간", time.node));
      grid.appendChild(field("수업 시간", mins));
      grid.appendChild(field("레슨실", room));
      panel.appendChild(grid);
      function hint() { dHint.textContent = date.value ? (mode === "from" && it.kind === "정규" ? "매주 " + WD[wdOf(date.value)] + "요일 · " + md(date.value) + "부터" : md(date.value)) : ""; }
      date.addEventListener("change", hint);
      hint();
      var go = btn("옮기기");
      var m = el("p", "sys-msg");
      go.addEventListener("click", function () {
        if (!date.value) { say(m, "날짜를 골라주세요.", "error"); return; }
        go.disabled = true;
        say(m, "옮기는 중…");
        call("lesson_room_move", { p_id: it.id, p_mode: mode, p_on: it.date, p_date: date.value, p_room: room.value, p_start: time.value(), p_minutes: Number(mins.value) }).then(function (r) {
          go.disabled = false;
          if (!r || !r.ok) { say(m, (r && r.error) || "옮기지 못했어요.", "error"); return; }
          if (date.value < st.from || date.value > addDays(st.from, 6)) st.from = monday(date.value);
          st.day = date.value;
          done("옮겼어요 · " + room.value + " · " + md(date.value) + " " + time.value());
        });
      });
      panel.appendChild(go);
      panel.appendChild(m);
    }

    prev.addEventListener("click", function () { st.from = addDays(st.from, -7); st.day = addDays(st.day, -7); load(); });
    next.addEventListener("click", function () { st.from = addDays(st.from, 7); st.day = addDays(st.day, 7); load(); });
    today.addEventListener("click", function () { st.day = todayKst(); st.from = monday(st.day); load(); });
    pick.addEventListener("change", function () { if (!pick.value) return; st.day = pick.value; st.from = monday(pick.value); load(); });
    mDay.addEventListener("click", function () { st.mode = "day"; load(); });
    mWeek.addEventListener("click", function () { st.mode = "week"; load(); });
    add.addEventListener("click", function () { if (st.data) openForm({ date: st.day }); });
    load();
  }

  window.LeeshLessonRoom = { render: render };
})();
