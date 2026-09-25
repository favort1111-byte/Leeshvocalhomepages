// Practice-room booking for members with a 수강 ID (booking.html).
(function () {
  var app = document.getElementById("bookingApp");
  if (!app) return;
  var cfg = window.LEESH || {};
  var WD = ["일", "월", "화", "수", "목", "금", "토"];

  var whoForm = app.querySelector("#whoForm");
  var area = app.querySelector("#bookArea");
  var off = app.querySelector("#bookingOff");
  var state = { who: null, date: null, rooms: null, room: null, pick: null };

  if (!LeeshAPI.enabled()) {
    whoForm.hidden = true;
    app.querySelector("#boardWrap").hidden = true;
    off.hidden = false;
    return;
  }

  function $(sel) { return app.querySelector(sel); }
  // form.name is the form's own name attribute, so look inputs up explicitly
  function field(f, n) { return f.querySelector("[name=" + n + "]"); }
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
  function busy(btn, on) { btn.disabled = on; btn.setAttribute("aria-busy", on ? "true" : "false"); }

  function saveWho(w) { try { sessionStorage.setItem("leesh_who", JSON.stringify(w)); } catch (e) {} }
  function loadWho() { try { return JSON.parse(sessionStorage.getItem("leesh_who") || "null"); } catch (e) { return null; } }
  function clearWho() { try { sessionStorage.removeItem("leesh_who"); } catch (e) {} }

  /* ---------- identity ---------- */
  whoForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var who = { id: field(whoForm, "memberId").value.trim(), pin: field(whoForm, "pin").value.trim() };
    signIn(who, whoForm.querySelector("button"));
  });

  function signIn(who, btn) {
    if (btn) busy(btn, true);
    msg($("#whoMsg"), "확인 중…");
    LeeshAPI.rpc("member_login", { p_id: who.id, p_pin: who.pin }).then(function (res) {
      if (btn) busy(btn, false);
      if (!res.ok) { msg($("#whoMsg"), res.error, "error"); clearWho(); return; }
      msg($("#whoMsg"), "");
      state.who = { id: res.id, pin: who.pin };
      saveWho(state.who);
      whoForm.hidden = true;
      area.hidden = false;
      $("#hello").textContent = res.name + "님, 안녕하세요.";
      renderMine(res.bookings);
      if (state.rooms) { renderRooms(state.rooms); updatePick(); } else loadDay(state.date);
    });
  }

  $("#switchUser").addEventListener("click", function () {
    clearWho();
    state.who = null;
    area.hidden = true;
    whoForm.hidden = false;
    whoForm.reset();
    field(whoForm, "memberId").focus();
  });

  /* ---------- my bookings ---------- */
  function creds() { return { p_id: state.who.id, p_pin: state.who.pin }; }

  function refreshMine() {
    LeeshAPI.rpc("member_login", creds()).then(function (res) { if (res.ok) renderMine(res.bookings); });
  }

  function renderMine(list) {
    var ul = $("#myList");
    ul.textContent = "";
    if (!list.length) { ul.appendChild(el("li", "sys-empty", "예약된 연습실이 없습니다.")); return; }
    list.forEach(function (b) {
      var li = el("li", "sys-item");
      li.appendChild(el("span", "sys-item__main", dayLabel(b.date) + " " + b.start + "~" + b.end + " · " + b.room));
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
      renderDays(res.days, res.date);
      renderBoard(res);
      renderRooms(res);
      $("#rules").textContent = "한 번에 최대 " + res.maxHours + "시간 · 하루 최대 " + res.dailyMaxHours + "시간 · " +
        res.unit + "분 단위";
    });
  }

  function renderDays(days, current) {
    var wrap = $("#days");
    wrap.textContent = "";
    days.forEach(function (d) {
      var b = el("button", "sys-chip", dayLabel(d));
      b.type = "button";
      b.setAttribute("aria-pressed", d === current ? "true" : "false");
      b.addEventListener("click", function () { loadDay(d); });
      wrap.appendChild(b);
    });
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
    var nowCut = res.now == null ? -1 : Math.floor(res.now / unit) * unit;
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
        if (free.indexOf(t) !== -1) {
          var cell = el("button", "sys-board__cell is-free");
          cell.type = "button";
          cell.title = label + " 빈 시간";
          cell.setAttribute("aria-label", label + " 예약 가능");
          if (state.pick && state.pick.room === room.name && state.pick.start === hhmm(t)) cell.className += " is-picked";
          cell.addEventListener("click", pickFromBoard.bind(null, room, hhmm(t)));
          grid.appendChild(cell);
        } else {
          var past = t < nowCut;
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
      msg($("#whoMsg"), room.name + " " + t + " 선택했어요. 로그인하면 바로 예약할 수 있어요.");
      field(whoForm, "memberId").focus({ preventScroll: true });
      whoForm.scrollIntoView({ block: "nearest", behavior: "smooth" });
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

    var room = res.rooms[names.indexOf(state.room)];
    var slots = el("div", "sys-slots");
    if (!room.free.length) slots.appendChild(el("span", "sys-note", "이날은 남은 시간이 없습니다. 다른 방이나 날짜를 골라주세요."));
    room.free.forEach(function (t) {
      var b = el("button", "sys-slot", t);
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
    if (!state.pick || !state.rooms) {
      sel.disabled = true;
      btn.disabled = true;
      $("#pickLabel").textContent = "연습실과 시작 시간을 골라주세요.";
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
    $("#pickLabel").textContent = dayLabel(state.date) + " " + state.pick.start + " · " + state.pick.room;
  }

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
      msg($("#bookMsg"), "예약했습니다 · " + dayLabel(b.date) + " " + b.start + "~" + b.end + " " + b.room, "ok");
      refreshMine();
      loadDay(state.date);
    });
  });

  loadDay(null);
  var saved = loadWho();
  if (saved && saved.id && saved.pin) signIn(saved, null);
})();
