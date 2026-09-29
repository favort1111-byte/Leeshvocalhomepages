// "내 폴더" on the desktop: a student signs in with 수강 ID + PIN (the same
// sign-in as 연습실 예약) and reads their lesson notes and monthly evaluations.
// Once signed in, the folder on the desktop carries the student's name.
(function () {
  var scene = document.getElementById("scene-me");
  if (!scene || !window.LeeshAPI) return;
  var WD = ["일", "월", "화", "수", "목", "금", "토"];
  var SCORES = [["pitch", "음정"], ["rhythm", "박자 · 리듬"], ["breath", "호흡 · 발성"], ["expression", "표현 · 감정"], ["stage", "무대 · 태도"]];
  var form = scene.querySelector("#myLogin");
  var open = scene.querySelector("#myOpen");
  var labels = document.querySelectorAll('[data-scene="scene-me"] .icon__label');
  var who = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function field(n) { return form.querySelector("[name=" + n + "]"); }
  function msg(text, kind) {
    var m = scene.querySelector("#myLoginMsg");
    m.textContent = text || "";
    m.className = "sys-msg" + (kind ? " sys-msg--" + kind : "");
  }
  // shared with js/booking.js so signing in once works on both
  function saveWho(w) { try { if (w) sessionStorage.setItem("leesh_who", JSON.stringify(w)); else sessionStorage.removeItem("leesh_who"); } catch (e) {} }
  function loadWho() { try { return JSON.parse(sessionStorage.getItem("leesh_who") || "null"); } catch (e) { return null; } }
  function dayLabel(d) {
    var dt = new Date(d + "T00:00:00Z");
    return (dt.getUTCMonth() + 1) + "월 " + dt.getUTCDate() + "일 (" + WD[dt.getUTCDay()] + ")";
  }
  function monthLabel(m) { return Number(m.slice(5, 7)) + "월 평가"; }
  function setLabel(text) { labels.forEach(function (l) { l.textContent = text; }); }

  function showLogin() {
    who = null;
    form.hidden = false;
    open.hidden = true;
    setLabel("내 폴더");
  }

  function load(creds, fromForm) {
    if (fromForm) msg("여는 중…");
    return LeeshAPI.rpc("member_notebook", { p_id: creds.id, p_pin: creds.pin }).then(function (res) {
      if (!res.ok) {
        if (fromForm) msg(res.error, "error"); else { saveWho(null); showLogin(); }
        return;
      }
      msg("");
      who = { id: res.id, pin: creds.pin };
      saveWho(who);
      setLabel(res.name);
      scene.querySelector("#myTitle").textContent = res.name + "의 폴더";
      renderNotes(res.notes);
      renderEvals(res.evals);
      form.hidden = true;
      open.hidden = false;
    });
  }

  function renderNotes(notes) {
    var box = scene.querySelector("#myNotes");
    box.textContent = "";
    if (!notes.length) { box.appendChild(el("p", "book__empty", "아직 적힌 레슨 노트가 없어요. 수업이 끝나면 선생님이 적어줘요.")); return; }
    notes.forEach(function (n) {
      var card = el("article", "lnote");
      var head = el("p", "lnote__date", dayLabel(n.date));
      if (n.teacher) head.appendChild(el("span", "lnote__teacher", n.teacher + " 선생님"));
      card.appendChild(head);
      card.appendChild(el("p", "lnote__label", "오늘 한 것"));
      card.appendChild(el("p", "lnote__did", n.did));
      if (n.practice) {
        card.appendChild(el("p", "lnote__label", "다음 수업까지 연습"));
        card.appendChild(el("p", "lnote__practice", n.practice));
      }
      box.appendChild(card);
    });
  }

  function renderEvals(evals) {
    var box = scene.querySelector("#myEvals");
    box.textContent = "";
    if (!evals.length) { box.appendChild(el("p", "book__empty", "아직 월말평가가 없어요. 평가가 끝나면 여기에 올라와요.")); return; }
    evals.forEach(function (e, i) {
      var prev = evals[i + 1];
      var card = el("article", "evalc");
      var head = el("p", "evalc__month", monthLabel(e.month));
      if (e.teacher) head.appendChild(el("span", "lnote__teacher", e.teacher + " 선생님"));
      card.appendChild(head);
      var list = el("ul", "evalc__scores");
      SCORES.forEach(function (s) {
        var v = e.scores[s[0]];
        var li = el("li");
        li.appendChild(el("span", "evalc__name", s[1]));
        var dots = el("span", "evalc__dots");
        dots.setAttribute("role", "img");
        dots.setAttribute("aria-label", s[1] + " 5점 중 " + v + "점");
        for (var k = 1; k <= 5; k++) dots.appendChild(el("i", k <= v ? "is-on" : null));
        li.appendChild(dots);
        if (prev) {
          var d = v - prev.scores[s[0]];
          li.appendChild(el("span", "evalc__delta" + (d > 0 ? " is-up" : d < 0 ? " is-down" : ""), d > 0 ? "▲" + d : d < 0 ? "▼" + (-d) : "–"));
        }
        list.appendChild(li);
      });
      card.appendChild(list);
      if (e.comment) card.appendChild(el("p", "evalc__comment", e.comment));
      if (e.goal) {
        var g = el("p", "evalc__goal");
        g.appendChild(el("b", null, "다음 달 목표 "));
        g.appendChild(document.createTextNode(e.goal));
        card.appendChild(g);
      }
      box.appendChild(card);
    });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    load({ id: field("memberId").value.trim(), pin: field("pin").value.trim() }, true).then(function () {
      btn.disabled = false;
      form.reset();
    });
  });

  scene.querySelector("#myLogout").addEventListener("click", function () {
    saveWho(null);
    showLogin();
    field("memberId").focus();
  });

  scene.querySelectorAll("[data-book-tab]").forEach(function (tab) {
    tab.addEventListener("click", function () {
      var name = tab.getAttribute("data-book-tab");
      scene.querySelectorAll("[data-book-tab]").forEach(function (t) { t.setAttribute("aria-selected", t === tab ? "true" : "false"); });
      scene.querySelectorAll("[data-book-page]").forEach(function (p) { p.hidden = p.getAttribute("data-book-page") !== name; });
    });
  });

  // Refresh each time the folder opens, so a note written a minute ago shows up.
  scene.addEventListener("scene:open", function () {
    if (who) load(who, false); else setTimeout(function () { field("memberId").focus({ preventScroll: true }); }, 50);
  });

  if (!LeeshAPI.enabled()) {
    form.querySelector("button[type=submit]").disabled = true;
    msg("아직 준비 중이에요. 곧 열려요.");
    return;
  }
  var saved = loadWho();
  if (saved && saved.id && saved.pin) load(saved, false);
})();
