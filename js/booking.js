// Practice-room booking for enrolled students (booking.html).
(function () {
  var app = document.getElementById("bookingApp");
  if (!app) return;
  var cfg = window.LEESH || {};
  var WD = ["일", "월", "화", "수", "목", "금", "토"];

  var whoForm = app.querySelector("#whoForm");
  var area = app.querySelector("#bookArea");
  var off = app.querySelector("#bookingOff");
  var state = { who: null, date: null, rooms: null, pick: null };

  if (!LeeshAPI.enabled()) {
    whoForm.hidden = true;
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
    var who = { name: field(whoForm, "name").value.trim(), phone4: field(whoForm, "phone4").value.trim() };
    signIn(who, whoForm.querySelector("button"));
  });

  function signIn(who, btn) {
    if (btn) busy(btn, true);
    msg($("#whoMsg"), "확인 중…");
    LeeshAPI.post("booking.mine", who).then(function (res) {
      if (btn) busy(btn, false);
      if (!res.ok) { msg($("#whoMsg"), res.error, "error"); clearWho(); return; }
      msg($("#whoMsg"), "");
      state.who = { name: res.name, phone4: who.phone4 };
      saveWho(state.who);
      whoForm.hidden = true;
      area.hidden = false;
      $("#hello").textContent = res.name + "님, 안녕하세요.";
      renderMine(res.bookings);
      loadDay(state.date);
    });
  }

  $("#switchUser").addEventListener("click", function () {
    clearWho();
    state.who = null;
    area.hidden = true;
    whoForm.hidden = false;
    whoForm.reset();
    field(whoForm, "name").focus();
  });

  /* ---------- my bookings ---------- */
  function refreshMine() {
    LeeshAPI.post("booking.mine", state.who).then(function (res) { if (res.ok) renderMine(res.bookings); });
  }

  function renderMine(list) {
    var ul = $("#myList");
    ul.textContent = "";
    if (!list.length) { ul.appendChild(el("li", "sys-empty", "예약된 연습실이 없습니다.")); return; }
    list.forEach(function (b) {
      var li = el("li", "sys-item");
      li.appendChild(el("span", "sys-item__main", dayLabel(b.date) + " " + b.start + "~" + b.end + " · " + b.room));
      if (b.cancellable) {
        var btn = el("button", "sys-link", "취소");
        btn.type = "button";
        btn.addEventListener("click", function () {
          if (!confirm(dayLabel(b.date) + " " + b.start + " " + b.room + " 예약을 취소할까요?")) return;
          busy(btn, true);
          LeeshAPI.post("booking.cancel", Object.assign({ id: b.id }, state.who)).then(function (res) {
            if (!res.ok) { busy(btn, false); alert(res.error); return; }
            refreshMine();
            loadDay(state.date);
          });
        });
        li.appendChild(btn);
      } else {
        li.appendChild(el("span", "sys-note", "취소 마감"));
      }
      ul.appendChild(li);
    });
  }

  /* ---------- availability ---------- */
  function loadDay(date) {
    var box = $("#rooms");
    box.textContent = "";
    box.appendChild(el("p", "sys-note", "빈 시간을 불러오는 중…"));
    state.pick = null;
    updatePick();
    LeeshAPI.get("rooms", date ? { date: date } : {}).then(function (res) {
      if (!res.ok) { box.textContent = ""; box.appendChild(el("p", "sys-msg sys-msg--error", res.error)); return; }
      state.date = res.date;
      state.rooms = res;
      renderDays(res.days, res.date);
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

  function renderRooms(res) {
    var box = $("#rooms");
    box.textContent = "";
    if (!res.rooms.length) { box.appendChild(el("p", "sys-note", "예약할 수 있는 연습실이 없습니다.")); return; }
    res.rooms.forEach(function (room) {
      var group = el("div", "sys-room");
      var title = el("p", "sys-room__name", room.name + (room.type ? " · " + room.type : ""));
      group.appendChild(title);
      var slots = el("div", "sys-slots");
      if (!room.free.length) slots.appendChild(el("span", "sys-note", "남은 시간이 없습니다."));
      room.free.forEach(function (t) {
        var b = el("button", "sys-slot", t);
        b.type = "button";
        b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", function () {
          app.querySelectorAll(".sys-slot[aria-pressed=true]").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
          b.setAttribute("aria-pressed", "true");
          state.pick = { room: room.name, start: t, free: room.free };
          updatePick();
        });
        slots.appendChild(b);
      });
      group.appendChild(slots);
      box.appendChild(group);
    });
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
    LeeshAPI.post("booking.create", Object.assign({
      room: state.pick.room, date: state.date, start: state.pick.start, hours: Number($("#hours").value)
    }, state.who)).then(function (res) {
      busy(btn, false);
      if (!res.ok) { msg($("#bookMsg"), res.error, "error"); loadDay(state.date); return; }
      var b = res.booking;
      msg($("#bookMsg"), "예약했습니다 · " + dayLabel(b.date) + " " + b.start + "~" + b.end + " " + b.room, "ok");
      refreshMine();
      loadDay(state.date);
    });
  });

  var saved = loadWho();
  if (saved && saved.name && saved.phone4) signIn(saved, null);
})();
