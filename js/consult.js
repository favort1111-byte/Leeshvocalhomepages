// Consult request + visit/trial booking (consult.html).
(function () {
  var form = document.getElementById("consultForm");
  if (!form) return;
  var cfg = window.LEESH || {};
  var WD = ["일", "월", "화", "수", "목", "금", "토"];
  var picker = form.querySelector("#slotPicker");
  var msgEl = form.querySelector("#consultMsg");
  var chosen = null;
  var slotsLoaded = false;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function msg(text, kind) {
    msgEl.textContent = text || "";
    msgEl.className = "sys-msg" + (kind ? " sys-msg--" + kind : "");
  }
  function dayLabel(d) {
    var dt = new Date(d + "T00:00:00Z");
    return (dt.getUTCMonth() + 1) + "/" + dt.getUTCDate() + "(" + WD[dt.getUTCDay()] + ")";
  }
  // form.name is the form's own name attribute, so look inputs up explicitly
  function value(n) {
    var f = form.querySelector("[name=" + n + "]");
    return f ? f.value : "";
  }
  function method() {
    var r = form.querySelector("input[name=method]:checked");
    return r ? r.value : "전화 상담";
  }

  // Without a backend the form still works the old way: copy + open KakaoTalk.
  if (!LeeshAPI.enabled()) {
    form.querySelectorAll("[data-needs-api]").forEach(function (n) { n.hidden = true; });
  }

  form.addEventListener("change", function (e) {
    if (e.target.name !== "method") return;
    var needSlot = method() !== "전화 상담" && LeeshAPI.enabled();
    picker.hidden = !needSlot;
    if (needSlot && !slotsLoaded) loadSlots();
  });

  function loadSlots() {
    slotsLoaded = true;
    var days = picker.querySelector("#slotDays");
    var times = picker.querySelector("#slotTimes");
    days.textContent = "";
    times.textContent = "";
    days.appendChild(el("span", "sys-note", "가능한 시간을 불러오는 중…"));
    LeeshAPI.get("consultSlots").then(function (res) {
      days.textContent = "";
      if (!res.ok) { slotsLoaded = false; days.appendChild(el("span", "sys-msg sys-msg--error", res.error)); return; }
      if (!res.days.length) { days.appendChild(el("span", "sys-note", "지금은 예약 가능한 시간이 없습니다. 전화 상담으로 남겨주세요.")); return; }
      res.days.forEach(function (d, i) {
        var b = el("button", "sys-chip", dayLabel(d.date));
        b.type = "button";
        b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", function () {
          days.querySelectorAll(".sys-chip").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
          b.setAttribute("aria-pressed", "true");
          showTimes(d);
        });
        days.appendChild(b);
        if (i === 0) b.click();
      });
    });
  }

  function showTimes(day) {
    var times = picker.querySelector("#slotTimes");
    times.textContent = "";
    chosen = null;
    day.times.forEach(function (t) {
      var b = el("button", "sys-slot", t);
      b.type = "button";
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", function () {
        times.querySelectorAll(".sys-slot").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
        b.setAttribute("aria-pressed", "true");
        chosen = { date: day.date, start: t };
      });
      times.appendChild(b);
    });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var data = {
      name: value("name").trim(),
      phone: value("phone").trim(),
      track: value("track"),
      message: value("message").trim(),
      method: method(),
      website: value("website")
    };

    if (!LeeshAPI.enabled()) {
      var summary = "[이송희보컬레슨 상담 신청]\n이름: " + data.name + "\n연락처: " + data.phone +
        (data.track ? "\n관심 반: " + data.track : "") + (data.message ? "\n문의: " + data.message : "");
      if (navigator.clipboard) navigator.clipboard.writeText(summary).catch(function () {});
      alert("상담 신청 내용이 복사되었습니다.\n카카오톡 채널로 이동하면 붙여넣기로 바로 전달해주세요.");
      window.open(cfg.kakao, "_blank", "noopener");
      return;
    }

    if (data.method !== "전화 상담") {
      if (!chosen) { msg("상담 날짜와 시간을 골라주세요.", "error"); return; }
      data.date = chosen.date;
      data.start = chosen.start;
    }

    var btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    msg("접수하는 중…");
    LeeshAPI.post("consult.create", data).then(function (res) {
      btn.disabled = false;
      if (!res.ok) {
        msg(res.error, "error");
        if (data.method !== "전화 상담") { slotsLoaded = false; loadSlots(); }
        return;
      }
      form.reset();
      picker.hidden = true;
      slotsLoaded = false;
      chosen = null;
      msg(res.date
        ? res.method + " " + dayLabel(res.date) + " " + res.start + "로 접수했습니다. 확인 연락을 드릴게요."
        : "접수했습니다. 곧 연락드릴게요.", "ok");
    });
  });
})();
