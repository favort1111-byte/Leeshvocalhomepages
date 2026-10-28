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
  // the folder icon shows the student's name once signed in; null puts back "my folder (내 폴더)"
  var plain = Array.prototype.map.call(labels, function (l) { return l.innerHTML; });
  function setLabel(text) { labels.forEach(function (l, i) { if (text == null) l.innerHTML = plain[i]; else l.textContent = text; }); }

  var sign = LeeshSignIn.mount(box, {
    title: "내 폴더", titleClass: "book__title",
    lede: "수강생은 월말평가, 내 예약, 공지, 레퍼토리, 연습 일지를 여기서 봐요.", ledeClass: "book__lede",
    onSignedIn: function (res, w) { who = w; load(); }
  });

  function showLogin(note) {
    who = null;
    box.hidden = false;
    open.hidden = true;
    setLabel(null);
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
      renderBookings(res);
      renderNotices(res);
      renderSongs(res.repertoire || [], res.logs || []);
      renderLogs(res.logs || [], res.repertoire || []);
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
      if (i === 0) box.appendChild(recommend(r));
    });
  }

  /* 나를 위한 연습 영상: the lowest item of the latest evaluation → 원포인트 레슨 videos about it (tips.html) */
  var BASE = (window.LEESH || {}).blogBase || "";
  var TOPIC = {
    basic: /호흡|발성|숨|목관리|자세|복식|목소리가 너무 작|비음/,
    technique: /고음|믹스|가성|진성|밴딩|보컬프라이|디테일|완성도|느낌|무미건조/,
    acting: /오디션|질문|영상|표정|무대|노래만큼 중요/,
    styling: /스타일링|의상|메이크업|헤어|다이어트/
  };
  var tipsList = null;
  function tips() {
    if (!tipsList) tipsList = fetch(BASE + "data/blog/index.json").then(function (r) { return r.json(); }).then(function (all) {
      var seen = {};
      return all.filter(function (p) { if (p.kind !== "tips" || !p.yt || seen[p.yt]) return false; seen[p.yt] = 1; return true; });
    }).catch(function () { return []; });
    return tipsList;
  }
  function recommend(r) {
    var wrap = el("section", "rec");
    var low = ITEMS.filter(function (it) { return num(r[it[0]]) != null; })
      .sort(function (a, b) { return num(r[a[0]]) - num(r[b[0]]); })[0];
    wrap.appendChild(el("h3", "rec__title", low ? "나를 위한 연습 영상 · " + low[1] : "나를 위한 연습 영상"));
    wrap.appendChild(el("p", "sys-note", low ? "이번 평가에서 " + low[1] + " 점수가 제일 낮았어요. 원장님 영상으로 연습해 보세요." : "원장님의 원포인트 레슨 영상이에요."));
    var ul = el("ul", "rec__list");
    wrap.appendChild(ul);
    tips().then(function (list) {
      // about this item only first (오디션 videos can be about 의상 too), then anything about it, then the newest
      var only = function (p) { return Object.keys(TOPIC).every(function (k) { return k === low[0] || !TOPIC[k].test(p.title); }); };
      var about = low ? list.filter(function (p) { return TOPIC[low[0]].test(p.title); }) : [];
      var pick = about.filter(only).concat(about.filter(function (p) { return !only(p); }));
      if (pick.length < 3) pick = pick.concat(list.filter(function (p) { return pick.indexOf(p) === -1; })).slice(0, 3);
      pick.slice(0, 3).forEach(function (p) {
        var li = el("li"), a = el("a", "rec__item");
        a.href = "post.html?id=" + p.id;
        var img = el("img");
        img.src = "https://i.ytimg.com/vi/" + p.yt + "/mqdefault.jpg";
        img.alt = "";
        img.loading = "lazy";
        a.appendChild(img);
        a.appendChild(el("span", null, p.title.replace(/^\[[^\]]*\]\s*/, "").replace(/[\u2600-\u27bf\ufe0f\u200d]|[\ud83c-\udbff][\udc00-\udfff]/g, "").trim()));
        li.appendChild(a);
        ul.appendChild(li);
      });
      if (!pick.length) wrap.remove();
    });
    var more = el("a", "rec__more", "원포인트 레슨 전체 보기 →");
    more.href = "tips.html";
    wrap.appendChild(more);
    return wrap;
  }

  /* 내 예약: from today on, and how much the practice rooms were used this month */
  function hours(min) {
    var h = Math.floor(min / 60), m = Math.round(min % 60);
    return (h ? h + "시간" : "") + (h && m ? " " : "") + (m || !h ? m + "분" : "");
  }
  function renderBookings(res) {
    var box = scene.querySelector("#myBookings");
    box.textContent = "";
    var m = res.month || { count: 0, minutes: 0 };
    var logged = (res.logs || []).filter(function (l) { return l.day.slice(0, 7) === todayKst().slice(0, 7); })
      .reduce(function (t, l) { return t + (l.minutes || 0); }, 0);
    var sum = el("div", "fold__sum");
    sum.appendChild(el("p", null, "이번 달 연습실 " + m.count + "번 · " + hours(m.minutes)));
    if (logged) sum.appendChild(el("p", "sys-note", "연습 일지에 적은 연습 " + hours(logged)));
    box.appendChild(sum);
    var list = res.bookings || [];
    if (!list.length) box.appendChild(el("p", "book__empty", "앞으로 잡힌 연습실 예약이 없어요."));
    list.forEach(function (b) {
      var c = el("article", "fold__card");
      c.appendChild(el("p", "fold__date", dayLabel(b.date) + (b.date === todayKst() ? " · 오늘" : "")));
      c.appendChild(el("p", "fold__main", b.room + " · " + b.start + "~" + b.end));
      box.appendChild(c);
    });
    var go = el("a", "sys-btn fold__go", "연습실 예약하러 가기 →");
    go.href = "booking.html";
    box.appendChild(go);
  }

  /* 공지: the academy's notices + the 학원 내방 오디션 coming up */
  function dday(d) { var n = Math.round((new Date(d + "T00:00:00Z") - new Date(todayKst() + "T00:00:00Z")) / 86400000); return n === 0 ? "오늘" : "D-" + n; }
  function renderNotices(res) {
    var box = scene.querySelector("#myNotices");
    box.textContent = "";
    var visits = res.visits || [], notes = res.notices || [];
    if (visits.length) {
      var v = el("section", "fold__visits");
      v.appendChild(el("h3", "rec__title", "다가오는 학원 내방 오디션"));
      visits.forEach(function (a) {
        var row = el("p", "fold__visit");
        row.appendChild(el("b", "news__badge", dday(a.date)));
        row.appendChild(document.createTextNode(" " + dayLabel(a.date) + " · " + (a.company ? a.company + " " : "") + a.title));
        v.appendChild(row);
      });
      var more = el("a", "rec__more", "오디션 소식 자세히 →");
      more.href = "audition.html";
      v.appendChild(more);
      box.appendChild(v);
    }
    if (!notes.length && !visits.length) box.appendChild(el("p", "book__empty", "새 공지가 없어요."));
    notes.forEach(function (n) {
      var d = el("details", "fold__notice");
      if (n.pinned) d.open = true;
      var s = el("summary");
      if (n.pinned) s.appendChild(el("b", "news__badge", "중요"));
      s.appendChild(document.createTextNode(" " + n.title));
      if (n.start) s.appendChild(el("span", "sys-note", " · " + dayLabel(n.start) + (n.end && n.end !== n.start ? " ~ " + dayLabel(n.end) : "")));
      d.appendChild(s);
      if (n.body) d.appendChild(el("p", "fold__body", n.body));
      box.appendChild(d);
    });
  }

  /* 내 레퍼토리 (학생이 직접): the songs I'm preparing; 연습 일지 adds up the minutes per song */
  var PURPOSES = ["오디션", "입시", "연습", "공연"], STATES = ["준비 중", "완성", "쉬는 중"];
  function selectOf(name, values, value, blank) {
    var s = el("select");
    s.name = name;
    if (blank) { var o0 = el("option", null, blank); o0.value = ""; s.appendChild(o0); }
    values.forEach(function (v) { var o = el("option", null, v); o.value = v; s.appendChild(o); });
    s.value = value || "";
    return s;
  }
  function field2(label, input) { var l = el("label", "sys-field"); l.appendChild(el("span", null, label)); l.appendChild(input); return l; }
  function call(fn, args, note) {
    args.p_id = who.id;
    args.p_pin = who.key;
    return LeeshAPI.rpc(fn, args).then(function (res) {
      if (!res.ok) { note.textContent = res.error; note.className = "sys-msg sys-msg--error"; return false; }
      return load().then(function () { return true; });
    });
  }
  function songForm(song, after) {
    var f = el("form", "fold__form sys");
    var t = el("input"); t.name = "title"; t.maxLength = 80; t.required = true; t.placeholder = "예) Rain"; t.value = song ? song.title : "";
    var a = el("input"); a.name = "artist"; a.maxLength = 60; a.placeholder = "예) 태연"; a.value = song && song.artist || "";
    var row = el("div", "sys-row");
    row.appendChild(field2("곡 제목", t));
    row.appendChild(field2("가수", a));
    f.appendChild(row);
    var row2 = el("div", "sys-row");
    row2.appendChild(field2("용도", selectOf("purpose", PURPOSES, song && song.purpose, "고르기")));
    row2.appendChild(field2("상태", selectOf("status", STATES, song ? song.status : "준비 중")));
    f.appendChild(row2);
    var m = el("input"); m.name = "memo"; m.maxLength = 300; m.placeholder = "예) 2절 후렴 고음 연습 중"; m.value = song && song.memo || "";
    f.appendChild(field2("메모 (선택)", m));
    var btn = el("button", "sys-btn", song ? "고친 내용 저장" : "곡 추가");
    btn.type = "submit";
    f.appendChild(btn);
    var note = el("p", "sys-msg");
    f.appendChild(note);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      btn.disabled = true;
      call("member_repertoire_save", { p_song: song ? song.id : null, p_title: t.value, p_artist: a.value || null,
        p_purpose: f.querySelector("[name=purpose]").value || null, p_status: f.querySelector("[name=status]").value, p_memo: m.value || null }, note)
        .then(function (ok) { btn.disabled = false; if (ok) showTab("songs"); if (ok && after) after(); });
    });
    return f;
  }
  function renderSongs(songs) {
    var box = scene.querySelector("#mySongs");
    box.textContent = "";
    box.appendChild(el("p", "sys-note", "내가 준비하는 곡을 적어두세요. 연습 일지에서 곡을 고르면 곡마다 연습한 시간이 쌓여요."));
    var add = el("details", "fold__add");
    add.appendChild(el("summary", null, "＋ 곡 추가"));
    add.appendChild(songForm(null));
    box.appendChild(add);
    if (!songs.length) box.appendChild(el("p", "book__empty", "아직 적은 곡이 없어요."));
    songs.forEach(function (s) {
      var c = el("article", "fold__card");
      var top = el("p", "fold__main");
      top.appendChild(el("b", null, s.title));
      if (s.artist) top.appendChild(document.createTextNode(" · " + s.artist));
      c.appendChild(top);
      var meta = el("p", "fold__meta");
      [s.purpose, s.status].forEach(function (x) { if (x) meta.appendChild(el("span", "fold__tag" + (x === "완성" ? " is-done" : ""), x)); });
      if (s.minutes) meta.appendChild(el("span", "sys-note", "연습 " + hours(s.minutes)));
      c.appendChild(meta);
      if (s.memo) c.appendChild(el("p", "fold__body", s.memo));
      var row = el("div", "fold__actions");
      var ed = el("button", "sys-link", "고치기");
      ed.type = "button";
      ed.addEventListener("click", function () { c.textContent = ""; c.appendChild(songForm(s)); });
      var del = el("button", "sys-link", "지우기");
      del.type = "button";
      var note = el("p", "sys-msg");
      del.addEventListener("click", function () {
        if (del.getAttribute("data-armed") !== "1") { del.setAttribute("data-armed", "1"); del.textContent = "한 번 더 누르면 지워요"; return; }
        call("member_repertoire_delete", { p_song: s.id }, note).then(function () { showTab("songs"); });
      });
      row.appendChild(ed);
      row.appendChild(del);
      c.appendChild(row);
      c.appendChild(note);
      box.appendChild(c);
    });
  }

  /* 연습 일지 (학생이 직접): date, minutes, song from the repertoire, what I practised */
  function todayKst() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
  function addDays(d, n) { var t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
  function renderLogs(logs, songs) {
    var box = scene.querySelector("#myLogs");
    box.textContent = "";
    var today = todayKst(), week = {};
    logs.forEach(function (l) { if (l.day > addDays(today, -7)) week[l.day] = 1; });
    var sum = el("div", "fold__sum");
    sum.appendChild(el("p", null, "최근 7일 중 " + Object.keys(week).length + "일 연습했어요"));
    var dots = el("p", "fold__week");
    for (var k = 6; k >= 0; k--) {
      var d = addDays(today, -k);
      var dot = el("span", week[d] ? "is-on" : null, WD[new Date(d + "T00:00:00Z").getUTCDay()]);
      dots.appendChild(dot);
    }
    sum.appendChild(dots);
    box.appendChild(sum);

    var f = el("form", "fold__form fold__form--log sys");
    var day = el("input"); day.type = "date"; day.name = "day"; day.value = today; day.max = today; day.min = addDays(today, -60);
    var mins = selectOf("minutes", ["10", "20", "30", "40", "50", "60", "90", "120", "150", "180"], "30", "시간 안 적기");
    Array.prototype.forEach.call(mins.options, function (o) { if (o.value) o.textContent = hours(Number(o.value)); });
    var row = el("div", "sys-row");
    row.appendChild(field2("날짜", day));
    row.appendChild(field2("연습 시간", mins));
    f.appendChild(row);
    var song = selectOf("song", songs.map(function (s) { return s.title; }), "", songs.length ? "곡 고르기 (선택)" : "레퍼토리에 곡을 넣으면 고를 수 있어요");
    f.appendChild(field2("곡", song));
    var did = el("textarea"); did.name = "did"; did.rows = 3; did.maxLength = 1000; did.placeholder = "예) 후렴 고음 10번, 립트릴 5분. 호흡이 모자랐음";
    f.appendChild(field2("오늘 연습한 것", did));
    var btn = el("button", "sys-btn", "일지 쓰기");
    btn.type = "submit";
    f.appendChild(btn);
    var note = el("p", "sys-msg");
    f.appendChild(note);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      btn.disabled = true;
      call("member_log_save", { p_log: null, p_day: day.value, p_minutes: mins.value ? Number(mins.value) : null, p_song: song.value || null, p_did: did.value || null }, note)
        .then(function (ok) { btn.disabled = false; if (ok) showTab("logs"); });
    });
    box.appendChild(f);

    if (!logs.length) box.appendChild(el("p", "book__empty", "아직 쓴 일지가 없어요. 오늘 연습한 것부터 적어보세요."));
    logs.forEach(function (l) {
      var c = el("article", "lnote");
      var head = el("p", "lnote__date", dayLabel(l.day));
      if (l.minutes) head.appendChild(el("span", "lnote__teacher", hours(l.minutes)));
      if (l.song) head.appendChild(el("span", "lnote__teacher", "♪ " + l.song));
      c.appendChild(head);
      if (l.did) c.appendChild(el("p", "lnote__did", l.did));
      var del = el("button", "sys-link fold__del", "지우기");
      del.type = "button";
      var n2 = el("p", "sys-msg");
      del.addEventListener("click", function () {
        if (del.getAttribute("data-armed") !== "1") { del.setAttribute("data-armed", "1"); del.textContent = "한 번 더 누르면 지워요"; return; }
        call("member_log_delete", { p_log: l.id }, n2).then(function () { showTab("logs"); });
      });
      c.appendChild(del);
      c.appendChild(n2);
      box.appendChild(c);
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
    if (e.detail && e.detail.tab) showTab(NOTES || e.detail.tab !== "notes" ? e.detail.tab : "evals");
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
