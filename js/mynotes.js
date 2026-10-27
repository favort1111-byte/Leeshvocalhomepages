// "내 폴더" on the desktop: a signed-in student (js/signin.js — 카카오 or 수강 ID, the same sign-in
// as 연습실 예약) reads their lesson notes and monthly evaluations. Once signed in, the folder on
// the desktop carries the student's name, and the sign-in stays on this device so a link from
// 카카오톡 (index.html#notes) opens straight in.
(function () {
  var scene = document.getElementById("scene-me");
  if (!scene || !window.LeeshAPI || !window.LeeshSignIn) return;
  var WD = ["일", "월", "화", "수", "목", "금", "토"];
  var SCORES = [["pitch", "음정"], ["rhythm", "박자 · 리듬"], ["breath", "호흡 · 발성"], ["expression", "표현 · 감정"], ["stage", "무대 · 태도"]];
  var box = scene.querySelector("#myLogin");
  var open = scene.querySelector("#myOpen");
  var labels = document.querySelectorAll('[data-scene="scene-me"] .icon__label');
  var who = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function dayLabel(d) {
    var dt = new Date(d + "T00:00:00Z");
    return (dt.getUTCMonth() + 1) + "월 " + dt.getUTCDate() + "일 (" + WD[dt.getUTCDay()] + ")";
  }
  function monthLabel(m) { return Number(m.slice(5, 7)) + "월 평가"; }
  function setLabel(text) { labels.forEach(function (l) { l.textContent = text; }); }

  var sign = LeeshSignIn.mount(box, {
    title: "내 폴더", titleClass: "book__title",
    lede: "수강생은 레슨 노트와 월말평가를 여기서 봐요.", ledeClass: "book__lede",
    onSignedIn: function (res, w) { who = w; load(); }
  });

  function showLogin(note) {
    who = null;
    box.hidden = false;
    open.hidden = true;
    setLabel("내 폴더");
    if (note) sign.note(note);
  }

  function showTab(name) {
    scene.querySelectorAll("[data-book-tab]").forEach(function (t) { t.setAttribute("aria-selected", t.getAttribute("data-book-tab") === name ? "true" : "false"); });
    scene.querySelectorAll("[data-book-page]").forEach(function (p) { p.hidden = p.getAttribute("data-book-page") !== name; });
  }

  function load() {
    if (!who) return Promise.resolve();
    return LeeshAPI.rpc("member_notebook", { p_id: who.id, p_pin: who.key }).then(function (res) {
      if (!res.ok) {
        // signed out elsewhere, PIN changed, link removed: ask again
        showLogin();
        sign.show(res.error, "error");
        return;
      }
      setLabel(res.name);
      scene.querySelector("#myTitle").textContent = res.name + "의 폴더";
      renderNotes(res.notes);
      renderEvals(res.evals);
      box.hidden = true;
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

  scene.querySelector("#myLogout").addEventListener("click", function () {
    sign.signOut();
    showLogin();
  });

  scene.querySelectorAll("[data-book-tab]").forEach(function (tab) {
    tab.addEventListener("click", function () { showTab(tab.getAttribute("data-book-tab")); });
  });

  // Refresh each time the folder opens, so a note written a minute ago shows up.
  // A link like index.html#evals opens the folder on that tab (js/scene.js passes it on).
  scene.addEventListener("scene:open", function (e) {
    if (e.detail && e.detail.tab) showTab(e.detail.tab);
    if (who) load();
  });

  if (!LeeshAPI.enabled()) {
    box.appendChild(el("p", "sys-msg", "아직 준비 중이에요. 곧 열려요."));
    return;
  }
  var known = LeeshAPI.who.get() || (LeeshAPI.kakao && LeeshAPI.kakao.session());
  if (known) {
    // signed in on this device before: open straight to the notes, no sign-in flash
    box.hidden = true;
    open.hidden = false;
    scene.querySelector("#myTitle").textContent = "여는 중…";
  }
  sign.start().then(function () { if (!who) showLogin(); });
})();
