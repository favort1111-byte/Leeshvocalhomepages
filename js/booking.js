// Practice-room booking for students signed in with Kakao (booking.html). Sign-in is js/signin.js.
// 수강생 전용 (원장님 2026-10-29): the free-time board shows only after sign-in (the server's rooms_day refuses guests too).
(function () {
  var app = document.getElementById("bookingApp");
  if (!app) return;
  var cfg = window.LEESH || {};
  var WD = ["일", "월", "화", "수", "목", "금", "토"];

  var whoBox = app.querySelector("#whoBox");
  var area = app.querySelector("#bookArea");
  var off = app.querySelector("#bookingOff");
  var state = { who: null, date: null, rooms: null, room: null, pick: null };
  var boardWrap = app.querySelector("#boardWrap");
  boardWrap.hidden = true;
  // 잠깐 멈춤 (원장님 2026-11-05): 로그인 · 내 폴더 · 내 예약 보기는 그대로, 빈 시간 · 새 예약만 "준비 중"
  var paused = cfg.bookingOpen === false;
  if (paused) app.querySelector("#bookingSoon").hidden = false;
  // 여는 시각(config bookingOpenAt)까지 이 화면을 열어 둔 학생: 그 시각이 되면 새로 고쳐서 바로 예약 (원장님 2026-11-12)
  if (paused && cfg.bookingOpenAt) {
    var openIn = Date.parse(cfg.bookingOpenAt) - Date.now();
    if (openIn > 0 && openIn < 7 * 864e5) setTimeout(function () { location.reload(); }, openIn + 3000);
  }

  if (!LeeshAPI.enabled()) {
    whoBox.hidden = true;
    app.querySelector("#boardWrap").hidden = true;
    off.hidden = false;
    return;
  }

  function $(sel) { return app.querySelector(sel); }
  function msg(el, text, kind) {
    el.textContent = text || "";
    el.className = "sys-msg" + (kind ? " sys-msg--" + kind : "");
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function dayLabel(d) {
    var dt = new Date(d + "T00:00:00Z");
    return (dt.getUTCMonth() + 1) + "/" + dt.getUTCDate() + "(" + WD[dt.getUTCDay()] + ")";
  }
  function toMin(t) { var p = t.split(":"); return +p[0] * 60 + +p[1]; }
  // "19:00" → "오후 7시", "07:30" → "오전 7:30", 분으로도 (1140 → "오후 7시", 1440 → "밤 12시")
  function ampm(t) {
    var m = typeof t === "number" ? t : toMin(t), h = Math.floor(m / 60), mi = m % 60;
    if (h === 24 && !mi) return "밤 12시";
    var h12 = h % 12 || 12;
    // 0~5시 새벽 · 6~11시 오전 · 12시 낮 · 13~23시 오후 ("오전 12시"가 낮인지 밤인지 헷갈리지 않게)
    return (h < 6 ? "새벽 " : h < 12 ? "오전 " : h === 12 ? "낮 " : "오후 ") + h12 + (mi ? ":" + (mi < 10 ? "0" : "") + mi : "시");
  }
  function dayWord(d) {
    var days = (state.rooms && state.rooms.days) || [], i = days.indexOf(d);
    return (days.length === 2 && i >= 0 ? (i ? "내일 " : "오늘 ") : "") + dayLabel(d);
  }
  function busy(btn, on) { btn.disabled = on; btn.setAttribute("aria-busy", on ? "true" : "false"); }


  /* ---------- identity ---------- */
  var sign = LeeshSignIn.mount(whoBox, {
    title: "로그인하고 예약하기",
    lede: paused ? "카카오로 로그인하면 내 폴더(일정 · 공지 · 월말평가 …)를 볼 수 있어요." : "연습실 예약은 수강생 전용이에요. 카카오로 로그인하면 빈 시간을 보고 바로 예약할 수 있어요.",
    onSignedIn: function (res, who) {
      state.who = who;
      whoBox.hidden = true;
      area.hidden = false;
      $("#hello").textContent = res.name + "님, 안녕하세요.";
      renderMine(res.bookings);
      if (paused) { $("#newBook").hidden = true; return; }
      boardWrap.hidden = false;
      if (state.rooms) { renderRooms(state.rooms); updatePick(); } else loadDay(state.date);
    }
  });

  $("#switchUser").addEventListener("click", function () {
    state.who = null;
    state.rooms = null;
    area.hidden = true;
    boardWrap.hidden = true;
    whoBox.hidden = false;
    sign.signOut();
  });

  /* ---------- my bookings ---------- */
  function creds() { return { p_id: state.who.id, p_pin: state.who.key }; }

  function refreshMine() {
    LeeshAPI.rpc("member_login", creds()).then(function (res) { if (res.ok) renderMine(res.bookings); });
  }

  function renderMine(list) {
    var ul = $("#myList");
    ul.textContent = "";
    if (!list.length) { ul.appendChild(el("li", "sys-empty", "예약된 연습실이 없습니다.")); return; }
    list.forEach(function (b) {
      var li = el("li", "sys-item");
      li.appendChild(el("span", "sys-item__main", dayLabel(b.date) + " " + ampm(b.start) + " ~ " + ampm(b.end) + " · " + b.room));
      if (b.cancellable) {
        // Two taps instead of confirm(): dialogs are blocked in some embedded viewers.
        var btn = el("button", "sys-link", "취소");
        btn.type = "button";
        var note = el("span", "sys-item__err");
        btn.addEventListener("click", function () {
          if (btn.getAttribute("data-armed") !== "1") {
            btn.setAttribute("data-armed", "1");
            btn.textContent = "한 번 더 누르면 취소";
            setTimeout(function () { if (!btn.disabled) { btn.removeAttribute("data-armed"); btn.textContent = "취소"; } }, 4000);
            return;
          }
          busy(btn, true);
          LeeshAPI.rpc("booking_cancel", Object.assign({ p_booking: b.id }, creds())).then(function (res) {
            if (!res.ok) { busy(btn, false); note.textContent = res.error; return; }
            refreshMine();
            loadDay(state.date);
          });
        });
        li.appendChild(btn);
        li.appendChild(note);
      } else {
        li.appendChild(el("span", "sys-note", "취소 마감"));
      }
      ul.appendChild(li);
    });
  }

  /* ---------- availability ---------- */
  function loadDay(date) {
    var box = $("#rooms"), board = $("#board");
    box.textContent = "";
    if (!board.firstChild) board.appendChild(el("p", "sys-note", "빈 시간을 불러오는 중…"));
    state.pick = null;
    updatePick();
    LeeshAPI.rpc("rooms_day", date ? { p_date: date } : {}).then(function (res) {
      if (!res.ok) { board.textContent = ""; board.appendChild(el("p", "sys-msg sys-msg--error", res.error)); return; }
      state.date = res.date;
      state.rooms = res;
      renderDays(res);
      renderBoard(res);
      renderRooms(res);
      // 하루 합계 제한이 24시간이면 (원장님 2026-10-28: 한 번에 2시간, 횟수 제한 없음) "더 예약할 수 있어요"로
      $("#rules").textContent = "한 번에 최대 " + res.maxHours + "시간" + (Number(res.dailyMaxHours) >= 24 ? " · 끝나고 또 예약할 수 있어요" : " · 하루 최대 " + res.dailyMaxHours + "시간") + " · " +
        res.unit + "분 단위" + (res.cancelBefore ? " · 직접 취소는 시작 " + res.cancelBefore + " 전까지" : "");
    });
  }

  // Keep the board current while the page stays open: an hour that has started can't be booked any
  // more, and at midnight the new day opens. The student's pick and hours stay if still free.
  function refresh() {
    if (!state.who || !state.rooms || document.hidden) return;
    LeeshAPI.rpc("rooms_day", { p_date: state.date }).then(function (res) {
      if (!res.ok || res.days[0] !== state.rooms.days[0]) { loadDay(null); return; }
      state.rooms = res;
      if (state.pick) {
        var room = res.rooms.filter(function (r) { return r.name === state.pick.room; })[0];
        if (room && room.free.indexOf(state.pick.start) !== -1) state.pick.free = room.free; else state.pick = null;
      }
      var hours = $("#hours").value;
      renderBoard(res);
      renderRooms(res);
      updatePick();
      if ($("#hours").querySelector('option[value="' + hours + '"]')) $("#hours").value = hours;
      pickText();
    });
  }
  function keepFresh() { if (state.who && LeeshAPI.kakao && LeeshAPI.kakao.fresh) LeeshAPI.kakao.fresh(900); }
  setInterval(function () { refresh(); keepFresh(); }, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { refresh(); keepFresh(); } });

  /* 밤 12시 정각에 새 날짜 열기 (학생 의견 2026-11-17 "예약하기 누르면 로딩이 길어서 다른 학생에게 자리를 뺏겨요"):
     예전엔 1분마다만 새로 고쳐서 12시가 지나도 최대 1분 동안 새 날짜가 안 보였고, 그래서 새로고침하느라 늦었음 (11/17 0시 첫 예약이 8초 뒤).
     이제 12시가 되는 순간 바로 새 날짜를 불러오고, "내일"을 보고 있었으면 새로 열린 날을 바로 보여줘요. 기기 시계가 조금 빨라도 되게 몇 번 다시 물어봄. */
  var DAY = 86400000, KST = 9 * 3600000;
  function plusDay(d) { return new Date(Date.parse(d + "T00:00:00Z") + DAY).toISOString().slice(0, 10); }
  function openNewDay(tries, old) {
    if (!state.who || !state.rooms || paused) return;
    old = old || { days: state.rooms.days, last: state.date === state.rooms.days[state.rooms.days.length - 1], preview: !!state.rooms.preview, date: state.date };
    if (state.rooms.days[0] !== old.days[0]) return; // 이미 바뀜 (1분 새로 고침이 먼저 함)
    // 미리 보던 날(모레)은 12시가 되면 그날이 바로 열림 → 그날 그대로
    var want = old.preview ? old.date : old.last ? plusDay(old.days[old.days.length - 1]) : (old.days[1] || plusDay(old.days[0]));
    LeeshAPI.rpc("rooms_day", { p_date: want }).then(function (res) {
      if (!res.ok || res.days[0] === old.days[0] || res.preview) {
        // 기기 시계가 서버보다 빠를 수 있어서: 처음 6초는 0.5초마다, 그 뒤 1분까지 2초마다 다시 물어봄
        if (tries < 40) setTimeout(function () { openNewDay(tries + 1, old); }, tries < 12 ? 500 : 2000);
        return;
      }
      state.date = res.date;
      state.rooms = res;
      state.pick = null;
      renderDays(res);
      renderBoard(res);
      renderRooms(res);
      updatePick();
      msg($("#bookMsg"), "밤 12시가 지나서 " + dayLabel(res.days[res.days.length - 1]) + " 예약이 열렸어요.", "ok");
    });
  }
  function armMidnight() {
    var left = DAY - ((Date.now() + KST) % DAY);
    if (left > 50000) setTimeout(keepFresh, left - 45000);   // 12시 45초 전에 로그인 열쇠를 미리 새로
    setTimeout(function () { if (!document.hidden) openNewDay(0); armMidnight(); }, left + 120);
  }
  armMidnight();

  function renderDays(res) {
    var days = res.days, current = res.date, wrap = $("#days");
    wrap.textContent = "";
    if (days.length === 1) { // same-day only: nothing to pick, just say which day and when the next one opens
      wrap.appendChild(el("p", "sys-note", "오늘 " + dayLabel(days[0]) + " · 예약은 당일만 돼요. 매일 밤 12시에 그날 예약이 열려요."));
    } else {
      if (days.length === 2) wrap.appendChild(el("p", "sys-note", "오늘과 내일까지 예약할 수 있어요. 매일 밤 12시에 다음 날 예약이 열려요."));
      days.forEach(function (d, i) {
        var b = el("button", "sys-chip", (days.length === 2 ? (i ? "내일 " : "오늘 ") : "") + dayLabel(d));
        b.type = "button";
        b.setAttribute("aria-pressed", d === current ? "true" : "false");
        b.addEventListener("click", function () { loadDay(d); });
        wrap.appendChild(b);
      });
    }
    // 다음에 열릴 날 미리 보기 (선생님 의견 2026-11-20 "선생님들이 미리 예약해서 막힌 칸이 미리 보였으면 → 예약할 때 안 헤매게")
    if (res.next) {
      var p = el("button", "sys-chip sys-chip--soon", "🔒 " + (days.length === 2 ? "모레 " : "") + dayLabel(res.next) + " 미리 보기");
      p.type = "button";
      p.setAttribute("aria-pressed", res.next === current ? "true" : "false");
      p.addEventListener("click", function () { loadDay(res.next); });
      wrap.appendChild(p);
    }
    if (res.preview) wrap.appendChild(el("p", "sys-msg sys-msg--soon", "🔒 " + dayLabel(current) + " 예약은 밤 12시에 열려요. 지금은 미리 보기만 돼요 — 회색 칸은 선생님 수업 · 학원 일정으로 이미 막힌 시간이에요."));
  }

  /**
   * The whole day at a glance: one row per room, one cell per time unit.
   * Tapping a free cell picks that room and hour (after sign-in it is ready to book).
   */
  function renderBoard(res) {
    var board = $("#board");
    board.textContent = "";
    if (!res.rooms.length) { board.appendChild(el("p", "sys-note", "예약할 수 있는 연습실이 없습니다.")); return; }
    var open = toMin(res.open), close = toMin(res.close), unit = res.unit;
    var cols = (close - open) / unit;
    var now = res.now == null ? -1 : res.now; // an hour that has started is gone (18:05 → from 19:00)
    var grid = el("div", "sys-board__grid");
    grid.style.gridTemplateColumns = "var(--board-name) repeat(" + cols + ", minmax(0, 1fr))";

    grid.appendChild(el("span", "sys-board__corner"));
    for (var h = open; h < close; h += unit) {
      var tick = el("span", "sys-board__tick");
      if (h % 180 === 0) {
        tick.textContent = String(h / 60);
        if (h % 360 !== 0) tick.className += " is-minor";
      }
      grid.appendChild(tick);
    }

    res.rooms.forEach(function (room) {
      var name = el("button", "sys-board__name", room.name);
      name.type = "button";
      name.setAttribute("aria-pressed", room.name === state.room ? "true" : "false");
      name.addEventListener("click", function () { chooseRoom(room.name); });
      grid.appendChild(name);
      var free = room.free.map(toMin);
      for (var t = open; t < close; t += unit) {
        var label = room.name + " " + hhmm(t);
        if (free.indexOf(t) !== -1 && res.preview) {
          var soon = el("span", "sys-board__cell is-free is-soon"); // 미리 보기: 비어 있지만 밤 12시에 열림
          soon.title = label + " 빈 시간 (밤 12시에 열려요)";
          grid.appendChild(soon);
        } else if (free.indexOf(t) !== -1) {
          var cell = el("button", "sys-board__cell is-free");
          cell.type = "button";
          cell.title = label + " 빈 시간";
          cell.setAttribute("aria-label", label + " 예약 가능");
          if (state.pick && state.pick.room === room.name && state.pick.start === hhmm(t)) cell.className += " is-picked";
          cell.addEventListener("click", pickFromBoard.bind(null, room, hhmm(t)));
          grid.appendChild(cell);
        } else {
          var past = t <= now;
          var span = el("span", "sys-board__cell " + (past ? "is-past" : "is-taken"));
          span.title = label + (past ? " 지난 시간" : " 예약됨");
          grid.appendChild(span);
        }
      }
    });
    board.appendChild(grid);
  }

  function hhmm(m) { return (m < 600 ? "0" : "") + Math.floor(m / 60) + ":" + (m % 60 < 10 ? "0" : "") + m % 60; }

  function chooseRoom(name) {
    state.room = name;
    state.pick = null;
    updatePick();
    renderBoard(state.rooms);
    renderRooms(state.rooms);
  }

  function pickFromBoard(room, t) {
    state.room = room.name;
    state.pick = { room: room.name, start: t, free: room.free };
    renderBoard(state.rooms);
    renderRooms(state.rooms);
    updatePick();
    if (!state.who) {
      sign.note(room.name + " " + t + " 선택했어요. 로그인하면 바로 예약할 수 있어요.");
      whoBox.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } else {
      $("#bookBtn").scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  /** Room chips first, then only the chosen room's free hours — keeps the page short on phones. */
  function renderRooms(res) {
    var box = $("#rooms");
    box.textContent = "";
    if (!res.rooms.length) { box.appendChild(el("p", "sys-note", "예약할 수 있는 연습실이 없습니다.")); return; }
    var names = res.rooms.map(function (r) { return r.name; });
    if (names.indexOf(state.room) === -1) state.room = names[0];

    var chips = el("div", "sys-chips sys-rooms");
    res.rooms.forEach(function (room) {
      var b = el("button", "sys-chip");
      b.type = "button";
      b.appendChild(document.createTextNode(room.name + " "));
      b.appendChild(el("small", "sys-chip__count", room.free.length ? "빈 " + room.free.length : "마감"));
      b.setAttribute("aria-pressed", room.name === state.room ? "true" : "false");
      b.addEventListener("click", function () { chooseRoom(room.name); });
      chips.appendChild(b);
    });
    box.appendChild(chips);

    if (res.preview) { box.appendChild(el("p", "sys-note", "🔒 이날은 밤 12시부터 예약할 수 있어요. 위 표에서 막힌 시간을 미리 확인해 두세요.")); return; }
    var room = res.rooms[names.indexOf(state.room)];
    var slots = el("div", "sys-slots");
    if (!room.free.length) slots.appendChild(el("span", "sys-note", "이날은 남은 시간이 없습니다. 다른 방이나 날짜를 골라주세요."));
    room.free.forEach(function (t) {
      var b = el("button", "sys-slot", ampm(t));   // "오후 7시" (07:00과 19:00을 헷갈려 잘못 잡고 취소하는 일이 많았음)
      b.type = "button";
      b.setAttribute("aria-pressed", state.pick && state.pick.start === t ? "true" : "false");
      b.addEventListener("click", function () {
        app.querySelectorAll(".sys-slot[aria-pressed=true]").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
        b.setAttribute("aria-pressed", "true");
        state.pick = { room: room.name, start: t, free: room.free };
        updatePick();
        renderBoard(res);
      });
      slots.appendChild(b);
    });
    box.appendChild(slots);
  }

  /** Only offer lengths whose every unit is free, so the student can't pick a doomed request. */
  function updatePick() {
    var sel = $("#hours");
    var btn = $("#bookBtn");
    sel.textContent = "";
    if (!state.pick || !state.rooms || state.rooms.preview) {
      sel.disabled = true;
      btn.disabled = true;
      $("#pickLabel").textContent = state.rooms && state.rooms.preview ? "이날 예약은 밤 12시에 열려요." : "연습실과 시작 시간을 골라주세요.";
      return;
    }
    var unit = state.rooms.unit, start = toMin(state.pick.start);
    var free = state.pick.free.map(toMin);
    for (var h = 1; h <= state.rooms.maxHours; h++) {
      var ok = true;
      for (var m = start; m < start + h * 60; m += unit) if (free.indexOf(m) === -1) { ok = false; break; }
      if (!ok) break;
      var o = el("option", null, h + "시간");
      o.value = h;
      sel.appendChild(o);
    }
    sel.disabled = false;
    btn.disabled = false;
    pickText();
  }
  // 예약하기 전에 무엇을 잡는지 한 줄로 (정밀 점검 2026-11-17: 예약의 19%가 5분 안에 취소 = 날짜 · 오전/오후 · 시간 수를 잘못 잡음)
  function pickText() {
    if (!state.pick) return;
    var start = toMin(state.pick.start), h = Number($("#hours").value) || 1;
    $("#pickLabel").textContent = dayWord(state.date) + " · " + state.pick.room + " · " + ampm(start) + " ~ " + ampm(start + h * 60) + " (" + h + "시간)";
  }
  $("#hours").addEventListener("change", pickText);

  $("#bookBtn").addEventListener("click", function () {
    var btn = this;
    busy(btn, true);
    msg($("#bookMsg"), "예약하는 중…");
    LeeshAPI.rpc("booking_create", Object.assign({
      p_room: state.pick.room, p_date: state.date, p_start: state.pick.start, p_hours: Number($("#hours").value)
    }, creds())).then(function (res) {
      busy(btn, false);
      if (!res.ok) { msg($("#bookMsg"), res.error, "error"); loadDay(state.date); return; }
      var b = res.booking;
      msg($("#bookMsg"), "예약했습니다 · " + dayWord(b.date) + " " + ampm(b.start) + " ~ " + ampm(b.end) + " · " + b.room, "ok");
      refreshMine();
      loadDay(state.date);
    });
  });

  sign.start(); // signed in on this device before (saved key or Kakao session) → straight in
})();
