// "내 폴더" on the desktop: a signed-in student (js/signin.js — 카카오 or 수강 ID, the same sign-in
// as 연습실 예약) reads their lesson notes and monthly evaluations. Once signed in, the folder on
// the desktop carries the student's name, and the sign-in stays on this device so a link from
// 카카오톡 (index.html#notes) opens straight in.
(function () {
  var scene = document.getElementById("scene-me");
  if (!scene || !window.LeeshAPI || !window.LeeshSignIn) return;
  var WD = ["일", "월", "화", "수", "목", "금", "토"];
  var box = scene.querySelector("#myLogin");
  var open = scene.querySelector("#myOpen");
  var labels = document.querySelectorAll('[data-scene="scene-me"] .icon__label');
  var who = null;
  // 레슨 노트 can be switched off in js/config.js; then the folder holds 월말평가 only
  var NOTES = (window.LEESH || {}).lessonNotes !== false;
  if (!NOTES) {
    scene.querySelectorAll('[data-book-tab="notes"], [data-book-page="notes"]').forEach(function (n) { n.remove(); });
    scene.querySelector('[data-book-page="evals"]').hidden = false;
    scene.querySelector('[data-book-tab="evals"]').setAttribute("aria-selected", "true");
  }

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
  function setLabel(text) { labels.forEach(function (l) { l.textContent = text; }); }

  var sign = LeeshSignIn.mount(box, {
    title: "내 폴더", titleClass: "book__title",
    lede: NOTES ? "수강생은 레슨 노트와 월말평가를 여기서 봐요." : "수강생은 월말평가를 여기서 봐요.", ledeClass: "book__lede",
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
      if (NOTES) renderNotes(res.notes);
      renderEvals(res.reports || []);
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

  /* 월말평가 리포트: 점수 4개 (각 10점) + 총점 단계, and the report pages the director uploaded. */
  var ITEMS = [["basic", "기본기"], ["technique", "보컬 테크닉"], ["acting", "액팅"], ["styling", "스타일링"]];
  var LEVELS = (window.LEESH || {}).evalLevels || [];
  function level(total) {
    for (var i = 0; i < LEVELS.length; i++) if (total >= LEVELS[i][0]) return { at: i, min: LEVELS[i][0], name: LEVELS[i][1], say: LEVELS[i][2], next: LEVELS[i - 1] };
    return null;
  }
  function num(v) { return v == null ? null : Number(v); }
  function fmt(v) { return String(Math.round(v * 10) / 10); }

  function renderEvals(reports) {
    var box = scene.querySelector("#myEvals");
    box.textContent = "";
    if (!reports.length) { box.appendChild(el("p", "book__empty", "아직 월말평가가 없어요. 평가가 끝나면 여기에 올라와요.")); return; }
    reports.forEach(function (r, i) {
      var prev = reports[i + 1];
      var card = el("article", "evalr");
      var head = el("p", "evalc__month", Number(r.month.slice(0, 4)) + "년 " + Number(r.month.slice(5, 7)) + "월 평가");
      if (r.teacher) head.appendChild(el("span", "lnote__teacher", /원장/.test(r.teacher) ? r.teacher : r.teacher + " 선생님"));
      card.appendChild(head);
      if (r.song) card.appendChild(el("p", "evalr__song", "♪ " + r.song));

      var total = num(r.total);
      if (total != null) {
        var lv = level(total);
        var sum = el("div", "evalr__total");
        var big = el("p", "evalr__score");
        big.appendChild(el("b", null, fmt(total)));
        big.appendChild(document.createTextNode(" / 40"));
        sum.appendChild(big);
        var stage = r.stage || (lv && lv.name);
        if (stage) sum.appendChild(el("p", "evalr__stage", stage));
        var bar = el("div", "evalr__track");
        bar.setAttribute("role", "img");
        bar.setAttribute("aria-label", "총점 40점 중 " + fmt(total) + "점");
        LEVELS.forEach(function (l) { if (l[0] > 0) { var t = el("i", "evalr__tick"); t.style.left = (l[0] / 40 * 100) + "%"; bar.appendChild(t); } });
        var fill = el("span", "evalr__fill");
        fill.style.width = Math.min(100, total / 40 * 100) + "%";
        bar.appendChild(fill);
        sum.appendChild(bar);
        if (lv && lv.next) sum.appendChild(el("p", "evalr__next", lv.next[1] + "까지 " + fmt(lv.next[0] - total) + "점 남았어요"));
        if (lv && lv.say) sum.appendChild(el("p", "evalr__say", lv.say));
        card.appendChild(sum);
      }

      var list = el("ul", "evalr__items");
      ITEMS.forEach(function (it) {
        var v = num(r[it[0]]);
        if (v == null) return;
        var li = el("li");
        li.appendChild(el("span", "evalc__name", it[1]));
        var b = el("span", "evalr__bar");
        var f = el("span");
        f.style.width = (v * 10) + "%";
        b.appendChild(f);
        li.appendChild(b);
        li.appendChild(el("span", "evalr__num", fmt(v)));
        var pv = prev && num(prev[it[0]]);
        if (pv != null) {
          var d = Math.round((v - pv) * 10) / 10;
          li.appendChild(el("span", "evalc__delta" + (d > 0 ? " is-up" : d < 0 ? " is-down" : ""), d > 0 ? "▲" + d : d < 0 ? "▼" + (-d) : "–"));
        }
        list.appendChild(li);
      });
      if (list.firstChild) card.appendChild(list);

      if (r.pages > 0) {
        var pages = el("div", "evalr__pages");
        card.appendChild(pages);
        if (!who || !(who.kakao || (window.LEESH || {}).demoImages)) {
          pages.appendChild(el("p", "sys-note", "평가지 " + r.pages + "장이 있어요. 카카오로 로그인하면 여기서 바로 볼 수 있어요."));
        } else {
          pages.appendChild(el("p", "sys-note", "평가지 불러오는 중…"));
          showPages(pages, r);
        }
      }
      card.appendChild(el("p", "evalr__secret", "평가지는 대외비예요. 캡처해서 다른 곳에 올리지 말아주세요."));
      box.appendChild(card);
    });
  }

  function showPages(holder, r) {
    LeeshAPI.kakao.token().then(function (t) {
      var jobs = [];
      for (var n = 1; n <= r.pages; n++) jobs.push(LeeshAPI.storage.image(who.id + "/" + r.month + "/" + n + ".webp", t));
      return Promise.all(jobs);
    }).then(function (urls) {
      holder.textContent = "";
      urls.forEach(function (u, k) {
        if (!u) return;
        var fig = el("button", "evalr__page");
        fig.type = "button";
        fig.setAttribute("aria-label", "평가지 " + (k + 1) + "쪽 크게 보기");
        var img = el("img");
        img.src = u;
        img.alt = "월말평가 평가지 " + (k + 1) + "쪽";
        fig.appendChild(img);
        fig.addEventListener("click", function () { zoom(u, img.alt); });
        holder.appendChild(fig);
      });
      if (!holder.firstChild) holder.appendChild(el("p", "sys-note", "평가지를 불러오지 못했어요. 잠시 뒤 다시 열어주세요."));
    });
  }

  // tap a page: full screen, pinch to zoom, tap ✕ to close
  function zoom(src, alt) {
    var ov = el("div", "evalr__zoom");
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-label", alt);
    var close = el("button", "evalr__close", "✕ 닫기");
    close.type = "button";
    var img = el("img");
    img.src = src;
    img.alt = alt;
    ov.appendChild(close);
    ov.appendChild(img);
    function shut() { ov.remove(); document.removeEventListener("keydown", esc); }
    function esc(e) { if (e.key === "Escape") shut(); }
    close.addEventListener("click", shut);
    document.addEventListener("keydown", esc);
    document.body.appendChild(ov);
    close.focus();
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
    if (e.detail && e.detail.tab) showTab(NOTES ? e.detail.tab : "evals");
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
