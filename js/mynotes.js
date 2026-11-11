// "내 폴더" on the desktop: a signed-in student (js/signin.js — 카카오, the same sign-in
// as 연습실 예약) sees 레슨 노트 (선생님이 teacher.html에서 씀) · 내 예약 · 일정·공지 · 월말평가 · 노래 추천 · 영상 추천 · 레퍼토리 · 연습 일지 · 제휴 업체. Once signed in, the folder on
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
  // 레슨 노트 can be switched off in js/config.js (studentNotes: 원장님 2026-10-29 숨김); then the folder opens on 내 예약
  var NOTES = (window.LEESH || {}).lessonNotes !== false && (window.LEESH || {}).studentNotes !== false;
  var FIRST = NOTES ? "notes" : "bookings";
  // 노래 추천도 같은 식으로 숨겨요 (songRecs: 원장님 2026-10-29)
  var HIDDEN = [];
  if (!NOTES) HIDDEN.push("notes");
  if ((window.LEESH || {}).songRecs === false) HIDDEN.push("recs");
  HIDDEN.forEach(function (name) {
    scene.querySelectorAll('[data-book-tab="' + name + '"], [data-book-page="' + name + '"]').forEach(function (n) { n.remove(); });
  });
  if (!NOTES) {
    scene.querySelector('[data-book-page="bookings"]').hidden = false;
    scene.querySelector('[data-book-tab="bookings"]').setAttribute("aria-selected", "true");
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
    lede: "수강생은 내 예약, 학원 일정, 월말평가, " + ((window.LEESH || {}).songRecs === false ? "영상 추천" : "노래·영상 추천") + ", 레퍼토리, 연습 일지, 오디션 후기, 제휴 업체 신청을 여기서 해요.", ledeClass: "book__lede",
    onSignedIn: function (res, w) { who = w; load(); }
  });

  function showLogin(note) {
    who = null;
    box.hidden = false;
    open.hidden = true;
    setLabel(null);
    if (note) sign.note(note);
  }

  function foldAll() { scene.querySelectorAll("#myPlans details, #myNotices details").forEach(function (d) { d.open = false; }); }
  function showTab(name) {
    if (name === "plans" || name === "notices") foldAll(); // 다시 들어오면 접힌 채로
    scene.querySelectorAll("[data-book-tab]").forEach(function (t) { t.setAttribute("aria-selected", t.getAttribute("data-book-tab") === name ? "true" : "false"); });
    scene.querySelectorAll("[data-book-page]").forEach(function (p) { p.hidden = p.getAttribute("data-book-page") !== name; });
    // phones: the tab row scrolls sideways, so bring the chosen tab into view
    if (name === "msgs" && !scene.hidden) markMsgsRead();
    var t = scene.querySelector('[data-book-tab="' + name + '"]'), row = t && t.parentNode;
    if (row && row.scrollWidth > row.clientWidth) row.scrollLeft = t.offsetLeft - row.offsetLeft - 12;
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
      renderBookings(res);
      renderNotices(res);
      renderEvals(res.reports || []);
      if (HIDDEN.indexOf("recs") < 0) renderRecs(res);
      renderVideos((res.reports || [])[0]);
      renderSongs(res.repertoire || [], res.logs || []);
      renderLogs(res.logs || [], res.repertoire || []);
      box.hidden = true;
      open.hidden = false;
      renderSuggest();
      loadMsgs();
      loadReviews();
      loadFeedback();
      return LeeshAPI.rpc("member_partners", { p_id: who.id, p_pin: who.key }).then(function (p) { if (p.ok) renderPartners(p); });
    });
  }

  /* 메시지: 학원(원장님 · 실장님)이 관리자 화면에서 나에게 보낸 것 (원장님 2026-11-05). 답장은 카카오톡으로.
     새 메시지가 있으면 바탕화면 내 폴더에 ✉ 표시, 폴더를 열면 메시지 탭이 먼저 열리고, 탭을 보면 읽음. */
  var msgs = [], msgJumped = 0, msgSeen = {};
  var folderIcons = document.querySelectorAll('.icons a.icon[data-scene="scene-me"]');
  function msgTime(iso) {
    var d = new Date(iso), k = new Date(d.getTime() + 9 * 3600000);
    return (k.getUTCMonth() + 1) + "월 " + k.getUTCDate() + "일 (" + WD[k.getUTCDay()] + ") " + k.getUTCHours() + ":" + (k.getUTCMinutes() < 10 ? "0" : "") + k.getUTCMinutes();
  }
  function msgBadge() {
    var n = msgs.filter(function (m) { return !m.read; }).length;
    var b = scene.querySelector("#myMsgBadge");
    if (b) { b.hidden = !n; b.textContent = n || ""; }
    folderIcons.forEach(function (ic) { ic.classList.toggle("icon--new", n > 0); ic.classList.toggle("icon--msg", n > 0); });
    return n;
  }
  function loadMsgs() {
    return LeeshAPI.rpc("member_messages", { p_id: who.id, p_pin: who.key }).then(function (res) {
      if (!res.ok) return;
      msgs = res.items || [];
      // 방금 읽음으로 보낸 것은 서버 답이 늦어도 다시 "안 읽음"으로 안 보이게
      msgs.forEach(function (m) { if (msgSeen[m.id]) { m.read = true; m.fresh = true; } });
      renderMsgs();
      var n = msgBadge();
      var top = msgs.filter(function (m) { return !m.read; })[0];
      // 처음 보는 새 메시지가 있으면 한 번만 메시지 탭으로
      if (n && top.id !== msgJumped && !open.hidden) { msgJumped = top.id; showTab("msgs"); }
    });
  }
  function renderMsgs() {
    var box = scene.querySelector("#myMsgs");
    if (!box) return;
    box.textContent = "";
    var sum = el("div", "fold__sum");
    sum.appendChild(el("p", null, "학원에서 나에게 보낸 메시지예요. 답장이나 궁금한 점은 카카오톡으로 보내주세요."));
    box.appendChild(sum);
    if (!msgs.length) { box.appendChild(el("p", "book__empty", "아직 받은 메시지가 없어요.")); return; }
    msgs.forEach(function (m) {
      var c = el("article", "fold__card msg" + (m.read && !m.fresh ? "" : " msg--new"));
      var h = el("p", "msg__head");
      h.appendChild(el("b", "msg__from", m.sender));
      h.appendChild(el("span", "msg__time", msgTime(m.at)));
      if (!m.read || m.fresh) h.appendChild(el("span", "msg__new", "새 메시지"));
      c.appendChild(h);
      c.appendChild(el("p", "msg__body", m.body));
      box.appendChild(c);
    });
  }
  function markMsgsRead() {
    var ids = msgs.filter(function (m) { return !m.read; }).map(function (m) { return m.id; });
    if (!ids.length || !who) return;
    // 이번에 보는 동안은 "새 메시지" 표시를 남겨두고, 숫자만 지워요
    msgs.forEach(function (m) { if (!m.read) { m.read = true; m.fresh = true; msgSeen[m.id] = 1; } });
    msgBadge();
    LeeshAPI.rpc("member_message_read", { p_id: who.id, p_pin: who.key, p_ids: ids });
  }

  // 레슨 노트 보는 모양: "grid" 시트 그대로(기본) · "sum" 정리해서
  var noteView = null;
  function notesMode(v) {
    if (v) { noteView = v; try { localStorage.setItem("leesh_note_view", v); } catch (e) { /* 이 화면 동안만 */ } }
    if (!noteView) { try { noteView = localStorage.getItem("leesh_note_view"); } catch (e) { /* ignore */ } }
    return noteView || "grid";
  }

  /* 레슨 사진 (2026-11-07): 선생님이 레슨 노트에 붙인 사진을 그 일지 아래에 (보기만, js/photos.js) */
  var photoUrls = {};
  function photoUrl(path) {
    if (!photoUrls[path]) {
      photoUrls[path] = LeeshAPI.kakao.token().then(function (t) { return LeeshAPI.storage.photo(path, t); });
      photoUrls[path].then(function (u) { if (!u) delete photoUrls[path]; });
    }
    return photoUrls[path];
  }
  function notePhotos(cards) {
    if (!window.LeeshPhotos || !who || !Object.keys(cards).length) return;
    LeeshAPI.rpc("member_photos", { p_id: who.id, p_pin: who.key }).then(function (res) {
      if (!res.ok || !res.items || !res.items.length) return;
      var by = {};
      res.items.forEach(function (p) { (by[p.note] = by[p.note] || []).push(p); });
      Object.keys(by).forEach(function (id) {
        if (!cards[id]) return;
        cards[id].appendChild(LeeshPhotos.strip({ items: by[id], canEdit: false, load: photoUrl }).node);
      });
    });
  }

  /* 곡·자료 · 가사지 (원장님 2026-11-10 "이전 시트에서 진행했던 가사지가 안 보인다"): 선생님 시트의 날짜 탭이 아닌 탭(가사 · 곡 노트 · 오디션 일정 …)을
     보기만. OT · 양식처럼 개인정보가 든 시트는 서버(member_sheets)가 빼고 보내요. 이름만 먼저, 누르면 그 표를 불러와요. */
  function renderSheets(box) {
    var wrap = el("details", "lsheets");
    var sum = el("summary", null, "📄 곡·자료 · 가사지");
    wrap.appendChild(sum);
    var list = el("div", "lsheets__list");
    wrap.appendChild(list);
    box.insertBefore(wrap, box.firstChild);
    LeeshAPI.rpc("member_sheets", { p_id: who.id, p_pin: who.key }).then(function (res) {
      var items = (res.ok && res.items) || [];
      if (!items.length) { wrap.remove(); return; }
      sum.textContent = "📄 곡·자료 · 가사지 (" + items.length + ")";
      list.appendChild(el("p", "sys-note", "선생님 시트의 가사지 · 곡 노트예요. 눌러서 보세요 (보기만)."));
      items.forEach(function (it) {
        var row = el("div", "lsheets__item");
        var b = el("button", "lsheets__btn", it.title || "시트");
        b.type = "button";
        if (it.teacher) b.appendChild(el("span", "lnote__teacher", " " + it.teacher + " 선생님"));
        var slot = el("div", "lnote__sheet");
        slot.hidden = true;
        b.addEventListener("click", function () {
          if (!slot.hidden) { slot.hidden = true; b.classList.remove("is-open"); return; }
          slot.hidden = false;
          b.classList.add("is-open");
          if (slot.childNodes.length) return;
          slot.appendChild(el("p", "sys-note", "불러오는 중…"));
          LeeshAPI.rpc("member_sheet", { p_id: who.id, p_pin: who.key, p_sid: it.id }).then(function (r) {
            slot.textContent = "";
            if (!r.ok || !r.sheet) { slot.appendChild(el("p", "sys-msg sys-msg--error", r.error || "불러오지 못했어요.")); return; }
            slot.appendChild(LeeshGrid.view(r.sheet));
          });
        });
        row.appendChild(b);
        row.appendChild(slot);
        list.appendChild(row);
      });
    });
  }

  function renderNotes(notes) {
    var box = scene.querySelector("#myNotes");
    box.textContent = "";
    var cards = {};
    if (window.LeeshGrid && who) renderSheets(box);
    if (!notes.length) { box.appendChild(el("p", "book__empty", "아직 적힌 레슨 노트가 없어요. 수업이 끝나면 선생님이 적어줘요.")); return; }
    notes.forEach(function (n) {
      var card = el("article", "lnote");
      if (n.id) cards[n.id] = card;
      var head = el("p", "lnote__date", dayLabel(n.date));
      if (n.teacher) head.appendChild(el("span", "lnote__teacher", n.teacher + " 선생님"));
      card.appendChild(head);
      // 표로 쓴 일지 (js/grid.js, 2026-10-30~)
      // 학생에게는 선생님이 쓴 시트 모양 그대로 (선생님 의견 2026-11-07 "A·B·C 열로 쓴 게 다 붙어서 나와요") + "정리해서 보기"로 바꾸기 (이 기기에 기억)
      if (n.sheet && window.LeeshGrid) {
        var slot = el("div", "lnote__sheet");
        var tg = el("button", "sys-link lnote__toggle");
        tg.type = "button";
        var draw = function () {
          var sum = notesMode() === "sum";
          slot.textContent = "";
          slot.appendChild(sum ? LeeshGrid.summary(n, (window.LEESH || {}).lessonFields) : LeeshGrid.view(n.sheet));
          if (!sum) {
            // 휴대폰에서 오른쪽 칸이 가려지면 한 줄 안내
            var hint = el("p", "lnote__hint", "← 표를 옆으로 밀면 오른쪽 칸도 보여요 →");
            hint.hidden = true;
            slot.appendChild(hint);
            requestAnimationFrame(function () { var x = slot.querySelector(".xs-scroll"); if (x && x.scrollWidth > x.clientWidth + 8) hint.hidden = false; });
          }
          tg.textContent = sum ? "시트 모양으로 보기" : "정리해서 보기";
        };
        tg.addEventListener("click", function () {
          notesMode(notesMode() === "sum" ? "grid" : "sum");
          box.querySelectorAll(".lnote__toggle").forEach(function (b) { if (b._draw) b._draw(); });
        });
        tg._draw = draw;
        draw();
        head.appendChild(tg);
        card.appendChild(slot);
        box.appendChild(card);
        return;
      }
      // the teachers' sheet columns (js/config.js lessonFields); 선생님 메모 never comes to the student
      ((window.LEESH || {}).lessonFields || []).forEach(function (fd) {
        if (fd[0] === "memo" || !n[fd[0]]) return;
        card.appendChild(el("p", "lnote__label", fd[1]));
        card.appendChild(LeeshRich.view(n[fd[0]], n.rich, fd[0] === "practice" ? "lnote__practice" : "lnote__did"));
      });
      box.appendChild(card);
    });
    notePhotos(cards);
  }

  /* 월말평가 리포트: 카드 모양은 js/evalcard.js (관리자 화면과 같이 씀) */
  var EC = window.LeeshEvalCard;
  var ITEMS = EC.items, num = EC.num, fmt = EC.fmt;

  function renderEvals(reports) {
    var box = scene.querySelector("#myEvals");
    box.textContent = "";
    if (!reports.length) { box.appendChild(el("p", "book__empty", "아직 월말평가가 없어요. 평가가 끝나면 여기에 올라와요.")); return; }
    reports.forEach(function (r, i) {
      box.appendChild(EC.card(r, reports[i + 1], function (holder) {
        if (!who || !(who.kakao || (window.LEESH || {}).demoImages)) {
          holder.appendChild(el("p", "sys-note", "평가지 " + r.pages + "장이 있어요. 카카오로 로그인하면 여기서 바로 볼 수 있어요."));
        } else {
          EC.pages(holder, LeeshAPI.kakao.token().then(function (t) {
            var jobs = [];
            for (var n = 1; n <= r.pages; n++) jobs.push(LeeshAPI.storage.image(who.id + "/" + r.month + "/" + n + ".webp", t));
            return Promise.all(jobs);
          }));
        }
      }));
    });
  }

  /* 영상 추천: the lowest item of the latest evaluation → 원포인트 레슨 videos about it (tips.html) */
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
  function renderVideos(r) {
    var box = scene.querySelector("#myVideos");
    box.textContent = "";
    var low = r ? ITEMS.filter(function (it) { return num(r[it[0]]) != null; })
      .sort(function (a, b) { return num(r[a[0]]) - num(r[b[0]]); })[0] : null;
    var sum = el("div", "fold__sum");
    if (low) {
      sum.appendChild(el("p", null, "이번 평가에서 제일 낮은 항목: " + low[1] + " " + fmt(num(r[low[0]])) + "점"));
      sum.appendChild(el("p", "sys-note", "원장님의 원포인트 레슨 영상 중에서 " + low[1] + "에 도움이 되는 영상을 골랐어요."));
    } else {
      sum.appendChild(el("p", null, "원장님의 원포인트 레슨 영상"));
      sum.appendChild(el("p", "sys-note", "월말평가가 올라오면 내 점수가 제일 낮은 항목에 맞는 영상을 골라줘요."));
    }
    box.appendChild(sum);
    var ul = el("ul", "rec__list");
    box.appendChild(ul);
    tips().then(function (list) {
      // about this item only first (오디션 videos can be about 의상 too), then anything about it, then the newest
      var only = function (p) { return Object.keys(TOPIC).every(function (k) { return k === low[0] || !TOPIC[k].test(p.title); }); };
      var about = low ? list.filter(function (p) { return TOPIC[low[0]].test(p.title); }) : [];
      var pick = about.filter(only).concat(about.filter(function (p) { return !only(p); }));
      if (pick.length < 4) pick = pick.concat(list.filter(function (p) { return pick.indexOf(p) === -1; })).slice(0, 4);
      pick.slice(0, 4).forEach(function (p) {
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
      if (!pick.length) ul.appendChild(el("li", "book__empty", "영상을 불러오지 못했어요."));
    });
    var more = el("a", "rec__more", "원포인트 레슨 전체 보기 →");
    more.href = "tips.html";
    box.appendChild(more);
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
    sum.appendChild(el("p", null, "이번 달 연습실 사용 합계 " + hours(m.minutes) + " (" + m.count + "번)"));
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
    if ((window.LEESH || {}).bookingOpen === false) { box.appendChild(el("p", "book__empty", "연습실 예약은 준비 중이에요. 시작하면 학원에서 알려드릴게요.")); return; }
    var go = el("a", "sys-btn fold__go", "연습실 예약하러 가기 →");
    go.href = "booking.html";
    box.appendChild(go);
  }

  /* 일정·공지: dated things coming up (학원 내방 오디션, 월말평가 날, 휴원일 …) by date, then the other notices */
  function dday(d) { var n = Math.round((new Date(d + "T00:00:00Z") - new Date(todayKst() + "T00:00:00Z")) / 86400000); return n === 0 ? "오늘" : n < 0 ? "진행 중" : "D-" + n; }
  function noticeCard(n) {
    var d = el("details", "fold__notice"); // 늘 접힌 채로 (원장님 2026-11-10: 휴대폰에서 열린 채로 남아 한참 내려야 했음)
    var s = el("summary");
    if (n.pinned) s.appendChild(el("b", "news__badge", "중요"));
    s.appendChild(document.createTextNode(" " + n.title));
    d.appendChild(s);
    if (n.body) d.appendChild(el("p", "fold__body", n.body));
    return d;
  }
  function prevDay(d) { var t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); }
  function renderNotices(res) {
    // 일정 · 공지 탭 따로 (원장님 2026-11-10 "휴대폰에서 일정이랑 공지를 나눠줘"): 일정 = 이번 달 요약 · 신청 · 다가오는 일정, 공지 = 공지 글 · 규정 상자
    var box = scene.querySelector("#myPlans"), nbox = scene.querySelector("#myNotices");
    box.textContent = "";
    nbox.textContent = "";
    var today = todayKst(), month = today.slice(0, 7);
    var plans = (res.visits || []).map(function (a) {
      return { date: a.date, kind: "내방 오디션", title: (a.company ? a.company + " " : "") + a.title, href: "audition.html",
               closed: (a.deadline || prevDay(a.date)) < today };
    }).concat((res.notices || []).filter(function (n) { return n.start; }).map(function (n) {
      return { date: n.start, end: n.end, kind: /월말\s*평가/.test(n.title) ? "월말평가" : /휴원|휴강|쉬는/.test(n.title) ? "휴원" : "학원 일정", notice: n };
    })).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var plain = (res.notices || []).filter(function (n) { return !n.start; });

    var sum = el("div", "fold__sum");
    var thisMonth = plans.filter(function (p) { return p.date.slice(0, 7) === month || (p.end && p.date < today); }).length;
    var later = plans.length - thisMonth;
    sum.appendChild(el("p", null, Number(month.slice(5)) + "월 일정 " + (thisMonth ? thisMonth + "개" : "없음") + (later ? " · 다음 달부터 " + later + "개" : "")));
    box.appendChild(sum);
    // 학원 내방 오디션 신청서 (apply.html)
    var form = "apply.html";
    var apply = el("a", "sys-btn fold__go fold__apply", "내방 오디션 신청하기");
    apply.href = form;
    sum.appendChild(apply);
    // new schedules go up on the audition account's Instagram first (audition.html shows it)
    var insta = el("a", "rec__more", "새 소식은 인스타그램에 먼저 올라와요 · 최신 소식 보기 →");
    insta.href = "audition.html#news-insta";
    sum.appendChild(insta);
    // 강의 규정 (원장님 2026-11-05): 보강 · 결석 규칙은 about에 — 보강 신청 전에 확인
    var rules = el("a", "rec__more", "보강 · 결석 규정 보기 (강의 규정 안내) →");
    rules.href = "about.html#rules";
    sum.appendChild(rules);

    if (plans.length) {
      var v = el("section", "fold__visits");
      v.appendChild(el("h3", "rec__title", "다가오는 일정"));
      plans.forEach(function (p) {
        var row = el("div", "fold__plan");
        var head = el("p", "fold__visit");
        head.appendChild(el("b", "news__badge", dday(p.date)));
        head.appendChild(el("span", "fold__tag", p.kind));
        head.appendChild(document.createTextNode(" " + dayLabel(p.date) + (p.end && p.end !== p.date ? " ~ " + dayLabel(p.end) : "")));
        row.appendChild(head);
        if (p.notice) row.appendChild(noticeCard(p.notice));
        else {
          var a = el("a", "fold__planlink", p.title + " →");
          a.href = p.href;
          row.appendChild(a);
          if (form && p.kind === "내방 오디션") {
            var line = el("p", "fold__planapply");
            if (p.closed) line.appendChild(el("span", "sys-note", "신청 마감 (오디션 하루 전까지 받아요)"));
            else {
              var ap = el("a", "sys-link", "이 오디션 신청하기 →");
              ap.href = form;
              line.appendChild(ap);
            }
            row.appendChild(line);
          }
        }
        v.appendChild(row);
      });
      box.appendChild(v);
    } else box.appendChild(el("p", "book__empty", "다가오는 일정이 없어요."));
    box = nbox; // 여기부터 공지 탭
    if (plain.length) plain.forEach(function (n) { box.appendChild(noticeCard(n)); });
    else box.appendChild(el("p", "book__empty", "새 공지가 없어요."));
    box.appendChild(el("h3", "rec__title", "학원 규정 · 안내"));
    // 연습실 예약 및 이용 안내 + 와이파이 (원장님 2026-11-06) — js/roomrules.js, 와이파이는 펼칠 때 서버에서
    if (window.LeeshRoomRules) {
      var roomInfo = null; // member_wifi 한 번만 (와이파이). 연습실 비밀번호는 그냥 일정·공지 글 (원장님 2026-11-06)
      var getRoom = function () {
        if (!roomInfo) roomInfo = LeeshAPI.rpc("member_wifi", { p_id: who.id, p_pin: who.key }).then(function (r) {
          if (!r.ok) { roomInfo = null; throw new Error(r.error); }
          return r;
        });
        return roomInfo;
      };
      // 보강 및 레슨 공지 · 수강료 환불 규정 (원장님 2026-11-06, 블로그 공지 그대로)
      var cr = LeeshRoomRules.course(); // 강의 규정 안내 + 수강료 환불 규정 (원장님 2026-11-06)
      cr.classList.add("fold__visitrules");
      box.appendChild(cr);
      var lr = LeeshRoomRules.lesson();
      lr.classList.add("fold__visitrules");
      box.appendChild(lr);
      var rr = LeeshRoomRules.box(function () { return getRoom().then(function (r) { return r.wifi; }); });
      rr.classList.add("fold__visitrules");
      box.appendChild(rr);
    }
    // 내방 오디션 참여 방법 (원장님 2026-11-06: 공지 밑에) — js/visitrules.js, 신청서 위와 같은 상자
    if (window.LeeshVisitRules) {
      var vr = LeeshVisitRules.box(false);
      vr.classList.add("fold__visitrules");
      box.appendChild(vr);
    }
  }

  /* 제휴 업체: 학생이 업체와 원하는 날짜·시간을 적어 신청 → 관리자 화면 "제휴 신청"에 보이고, 학원이 업체에 전화로
     예약한 뒤 결과(날짜·시간·안내)를 적으면 여기에 보여요. 아직 접수 상태면 학생이 취소할 수 있어요. */
  var PSTATE = { "접수": "예약 준비 중", "예약 완료": "예약 완료", "취소": "취소" };
  /* 건의함 (원장님 2026-10-29): 이름 없이, 내용은 암호화해서 저장. 지금은 원장님(관리자)만 읽어요.
     서버 member_suggest는 로그인한 수강생인지만 보고, 누가 썼는지는 저장하지 않아요. */
  var TOPICS = ["수업", "선생님", "연습실", "시설", "홈페이지", "기타"];
  function renderSuggest() {
    var box = scene.querySelector("#mySuggest");
    if (!box || box.getAttribute("data-ready") === "1") return; // 쓰던 글이 새로고침으로 지워지지 않게 한 번만
    box.setAttribute("data-ready", "1");
    var sum = el("div", "fold__sum suggest__sum");
    sum.appendChild(el("p", "suggest__lock", "🔒 이름 없이 보내는 건의함"));
    var ul = el("ul", "suggest__promise");
    ["누가 썼는지 저장하지 않아요. 실장님도 보낸 사람을 알 수 없어요.",
     "보낸 시각도 남기지 않고 날짜만 남아요.",
     "내용은 암호화해서 저장되고, 관리자(실장님)만 읽을 수 있어요. 선생님 · 다른 학생은 볼 수 없어요.",
     "편하게 적어주세요. 수업 · 연습실 · 학원 생활 무엇이든 좋아요."].forEach(function (t) { ul.appendChild(el("li", null, t)); });
    sum.appendChild(ul);
    box.appendChild(sum);
    var f = el("form", "fold__form sys");
    var sel = el("select");
    TOPICS.forEach(function (t) { var o = el("option", null, t); o.value = t; sel.appendChild(o); });
    f.appendChild(field2("어떤 이야기예요?", sel));
    var ta = el("textarea");
    ta.rows = 6; ta.maxLength = 1000; ta.required = true;
    ta.placeholder = "하고 싶은 말 · 건의 사항을 적어주세요.";
    f.appendChild(field2("하고 싶은 말", ta));
    var btn = el("button", "sys-btn", "이름 없이 보내기");
    btn.type = "submit";
    f.appendChild(btn);
    var note = el("p", "sys-msg");
    note.setAttribute("role", "status");
    f.appendChild(note);
    f.appendChild(el("p", "sys-note", "이름이 없어서 보낸 글은 다시 볼 수 없어요. 답이 필요하면 카카오톡 채널로 물어봐 주세요. (하루 5번까지)"));
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      if (ta.value.trim().length < 2) { note.textContent = "하고 싶은 말을 적어주세요."; note.className = "sys-msg sys-msg--error"; return; }
      btn.disabled = true;
      LeeshAPI.rpc("member_suggest", { p_id: who.id, p_pin: who.key, p_topic: sel.value, p_body: ta.value }).then(function (res) {
        btn.disabled = false;
        if (!res.ok) { note.textContent = res.error; note.className = "sys-msg sys-msg--error"; return; }
        ta.value = "";
        note.textContent = "보냈어요. 소중한 이야기 고마워요! 🙏";
        note.className = "sys-msg sys-msg--ok";
      });
    });
    box.appendChild(f);
  }

  function renderPartners(res) {
    var box = scene.querySelector("#myPartners");
    box.textContent = "";
    var list = res.partners || [], mine = res.requests || [];
    var sum = el("div", "fold__sum");
    sum.appendChild(el("p", null, "실제 엔터 관계자가 추천한 제휴 업체예요."));
    sum.appendChild(el("p", "sys-note", "신청하면 학원이 업체에 직접 예약해드리고, 예약이 되면 여기에 날짜·시간이 올라와요."));
    box.appendChild(sum);

    if (mine.length) {
      box.appendChild(el("h3", "rec__title", "내 신청"));
      mine.forEach(function (r) {
        var c = el("article", "fold__card partner__req");
        var top = el("p", "fold__main");
        top.appendChild(el("span", "fold__tag partner__state partner__state--" + (r.status === "예약 완료" ? "ok" : r.status === "취소" ? "off" : "wait"), PSTATE[r.status] || r.status));
        top.appendChild(el("b", null, " " + r.partner));
        c.appendChild(top);
        c.appendChild(el("p", "fold__date", dayLabel(r.at.slice(0, 10)) + " 신청 · 원하는 때: " + (r.wish || "-")));
        if (r.memo) c.appendChild(el("p", "fold__body", r.memo));
        if (r.reply) c.appendChild(el("p", "evalr__say partner__reply", r.reply));
        if (r.status === "접수") {
          var row = el("p", "fold__actions"), cancel = el("button", "sys-link", "신청 취소"), note = el("p", "sys-msg");
          cancel.type = "button";
          cancel.addEventListener("click", function () {
            if (cancel.getAttribute("data-armed") !== "1") { cancel.setAttribute("data-armed", "1"); cancel.textContent = "한 번 더 누르면 취소해요"; return; }
            cancel.disabled = true;
            call("member_partner_cancel", { p_req: r.id }, note).then(function (ok) { if (ok) showTab("partners"); else cancel.disabled = false; });
          });
          row.appendChild(cancel);
          c.appendChild(row);
          c.appendChild(note);
        }
        box.appendChild(c);
      });
    }

    var ask = el("section", "fold__ask");
    ask.appendChild(el("h3", "rec__title", "예약 신청하기"));
    if (!list.length) { ask.appendChild(el("p", "book__empty", "지금 신청할 수 있는 제휴 업체가 없어요.")); box.appendChild(ask); return; }
    var f = el("form", "fold__form sys");
    var pick = el("fieldset", "apply__set");
    pick.appendChild(el("legend", null, "업체"));
    var chips = el("div", "sys-radios apply__radios");
    var info = el("p", "sys-note partner__info");
    list.forEach(function (p) {
      var l = el("label"), r = el("input");
      r.type = "radio";
      r.name = "partner";
      r.value = p.id;
      r.addEventListener("change", function () { info.textContent = p.info || ""; info.hidden = !p.info; });
      l.appendChild(r);
      l.appendChild(document.createTextNode(" " + p.category + (p.name ? " · " + p.name : "")));
      chips.appendChild(l);
    });
    info.hidden = true;
    pick.appendChild(chips);
    pick.appendChild(info);
    f.appendChild(pick);
    var wish = el("input"); wish.name = "wish"; wish.maxLength = 200; wish.required = true; wish.placeholder = "예) 11월 3일 (월) 오후 2시 이후 / 평일 저녁 아무 때나";
    f.appendChild(field2("원하는 날짜·시간", wish));
    var memo = el("textarea"); memo.name = "memo"; memo.rows = 2; memo.maxLength = 500; memo.placeholder = "예) 오디션 프로필 촬영용 메이크업이에요 / 처음 가봐요";
    f.appendChild(field2("받고 싶은 것·요청 사항 (선택)", memo));
    var agree = el("label", "sys-keep"), ag = el("input");
    ag.type = "checkbox";
    agree.appendChild(ag);
    agree.appendChild(document.createTextNode(" 예약을 위해 학원이 업체에 내 이름과 원하는 날짜·시간을 알려주는 데 동의해요."));
    f.appendChild(agree);
    var btn = el("button", "sys-btn", "신청하기");
    btn.type = "submit";
    f.appendChild(btn);
    var note = el("p", "sys-msg");
    f.appendChild(note);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var r = f.querySelector("[name=partner]:checked");
      function bad(t) { note.textContent = t; note.className = "sys-msg sys-msg--error"; }
      if (!r) return bad("업체를 골라주세요.");
      if (!wish.value.trim()) return bad("원하는 날짜·시간을 적어주세요.");
      if (!ag.checked) return bad("업체에 이름과 날짜·시간을 알려주는 데 동의해야 예약할 수 있어요.");
      btn.disabled = true;
      call("member_partner_request", { p_partner: Number(r.value), p_wish: wish.value, p_memo: memo.value || null }, note)
        .then(function (ok) { btn.disabled = false; if (ok) showTab("partners"); });
    });
    ask.appendChild(f);
    box.appendChild(ask);
  }

  /* 노래 추천: 원장님이 올린 목소리 분석 + 추천곡 (카카오톡으로 보낸 노래 영상을 분석). 학생은 여기서 신청해요. */
  var GOALS = ["오디션", "입시", "취미", "공연"];
  var KAKAO = (window.LEESH || {}).kakao || "";
  function songLinks(s) {
    var q = encodeURIComponent((s.artist ? s.artist + " " : "") + s.title);
    var row = el("p", "fold__actions");
    var m = el("a", "sys-link", "멜론");
    m.href = /^https:\/\/(www\.)?melon\.com\//.test(s.melon || "") ? s.melon : "https://www.melon.com/search/total/index.htm?q=" + q;
    var sp = el("a", "sys-link", "Spotify");
    sp.href = /^https:\/\/open\.spotify\.com\//.test(s.spotify || "") ? s.spotify : "https://open.spotify.com/search/" + q;
    var yt = el("a", "sys-link", "유튜브");
    yt.href = "https://www.youtube.com/results?search_query=" + q;
    [m, sp, yt].forEach(function (a) { a.target = "_blank"; a.rel = "noopener"; row.appendChild(a); });
    return row;
  }
  function recCard(r, have) {
    var card = el("article", "evalr songrec");
    card.appendChild(el("p", "evalc__month", dayLabel(r.date) + " 분석"));
    if ((r.summary || []).length) {
      card.appendChild(el("h3", "rec__title", "내 목소리"));
      var dl = el("dl", "songrec__voice");
      r.summary.forEach(function (row) {
        dl.appendChild(el("dt", null, row[0]));
        dl.appendChild(el("dd", null, row[1]));
      });
      card.appendChild(dl);
    }
    if (r.note) card.appendChild(el("p", "evalr__say", r.note));
    if ((r.songs || []).length) {
      card.appendChild(el("h3", "rec__title", "추천곡"));
      r.songs.forEach(function (s) {
        var c = el("div", "songrec__song");
        var top = el("p", "fold__main");
        if (s.tag) top.appendChild(el("span", "fold__tag", s.tag));
        top.appendChild(el("b", null, " " + s.title));
        if (s.artist) top.appendChild(document.createTextNode(" · " + s.artist));
        c.appendChild(top);
        if (s.why) c.appendChild(el("p", "fold__body", s.why));
        if (s.key) c.appendChild(el("p", "sys-note", "키: " + s.key));
        var links = songLinks(s);
        var add = el("button", "sys-link", have[s.title] ? "레퍼토리에 있어요" : "＋ 레퍼토리에 넣기");
        add.type = "button";
        add.disabled = !!have[s.title];
        var note = el("p", "sys-msg");
        add.addEventListener("click", function () {
          add.disabled = true;
          call("member_repertoire_save", { p_song: null, p_title: s.title, p_artist: s.artist || null, p_purpose: null, p_status: "준비 중", p_memo: "노래 추천" }, note)
            .then(function (ok) { if (ok) showTab("recs"); else add.disabled = false; });
        });
        links.appendChild(add);
        c.appendChild(links);
        c.appendChild(note);
        card.appendChild(c);
      });
      card.appendChild(el("p", "sys-note", "키(조)는 레슨 때 선생님과 같이 맞춰봐요."));
    }
    return card;
  }
  function renderRecs(res) {
    var box = scene.querySelector("#myRecs");
    box.textContent = "";
    var recs = res.recs || [], req = res.request, have = {};
    (res.repertoire || []).forEach(function (s) { have[s.title] = 1; });
    if (recs.length) box.appendChild(recCard(recs[0], have));
    else box.appendChild(el("p", "book__empty", "아직 받은 노래 추천이 없어요. 아래에서 신청해보세요."));
    if (recs.length > 1) {
      var old = el("details", "fold__add");
      old.appendChild(el("summary", null, "지난 추천 " + (recs.length - 1) + "개"));
      recs.slice(1).forEach(function (r) { old.appendChild(recCard(r, have)); });
      box.appendChild(old);
    }

    var ask = el("section", "fold__ask");
    ask.appendChild(el("h3", "rec__title", recs.length ? "다시 추천받기" : "노래 추천받기"));
    if (req) ask.appendChild(el("p", "sys-msg sys-msg--ok", dayLabel(req.at.slice(0, 10)) + "에 신청했어요. 선생님이 직접 듣고 분석해서 시간이 조금 걸릴 수 있어요. 끝나면 여기에 올라와요."));
    var steps = el("ol", "fold__steps");
    steps.appendChild(el("li", null, "반주 없이 부른 노래를 아래에서 녹음하거나 파일로 올려요 (3곡까지, 1곡 1~2분)."));
    steps.appendChild(el("li", null, "좋아하는 가수·곡과 목표를 적고 신청해요."));
    steps.appendChild(el("li", null, "음역과 음색을 분석해서 어울리는 곡을 골라 여기에 올려줘요."));
    ask.appendChild(steps);
    ask.appendChild(el("p", "fold__wait", "⏳ 한 명 한 명 노래를 듣고 분석하기 때문에 결과가 나오기까지 시간이 조금 걸릴 수 있어요. 조금만 기다려주세요!"));
    var f = el("form", "fold__form sys");
    var songs = songRecorder(req ? req.files || [] : []);
    f.appendChild(songs.node);
    var likes = el("input"); likes.name = "likes"; likes.maxLength = 300; likes.placeholder = "예) 태연, 아이유 / Bruno Mars - When I Was Your Man"; likes.value = req && req.likes || "";
    f.appendChild(field2("좋아하는 가수·곡", likes));
    f.appendChild(field2("목표", selectOf("goal", GOALS, req && req.goal, "고르기 (선택)")));
    var memo = el("textarea"); memo.name = "memo"; memo.rows = 2; memo.maxLength = 500; memo.placeholder = "예) 오디션용으로 밝은 곡이 필요해요 / 고음이 적은 곡이면 좋겠어요"; memo.value = req && req.memo || "";
    f.appendChild(field2("하고 싶은 말 (선택)", memo));
    var btn = el("button", "sys-btn", req ? "신청 내용 고치기" : "추천 신청하기");
    btn.type = "submit";
    f.appendChild(btn);
    var kk = el("p", "sys-note");
    kk.appendChild(document.createTextNode("녹음이 어려우면 영상을 "));
    var k = el("a", null, "카카오톡 채널");
    k.href = KAKAO;
    k.target = "_blank";
    k.rel = "noopener";
    kk.appendChild(k);
    kk.appendChild(document.createTextNode("로 보내도 돼요. 녹음은 관리자(실장님)만 듣고, 추천이 끝나면 지워요."));
    f.appendChild(kk);
    var note = el("p", "sys-msg");
    f.appendChild(note);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      if (songs.busy()) { note.textContent = "녹음을 먼저 멈춰주세요."; note.className = "sys-msg sys-msg--error"; return; }
      btn.disabled = true;
      note.textContent = songs.pending() ? "녹음을 올리는 중이에요…" : "";
      note.className = "sys-msg";
      songs.upload().then(function (files) {
        if (!files) { btn.disabled = false; note.textContent = "녹음을 올리지 못했어요. 다시 해보거나 카카오톡 채널로 보내주세요."; note.className = "sys-msg sys-msg--error"; return; }
        return call("member_song_request", { p_likes: likes.value || null, p_goal: f.querySelector("[name=goal]").value || null,
          p_memo: memo.value || null, p_files: files }, note)
          .then(function (ok) { btn.disabled = false; if (ok) showTab("recs"); });
      });
    });
    ask.appendChild(f);
    box.appendChild(ask);
  }

  /* 노래 녹음: record with the phone's microphone (like the mini game) or pick a file; 3 at most, 2 minutes each.
     They go to the private song-recordings bucket under the student's own folder when the request is sent. */
  var SONG_MAX = 3, SONG_SEC = 120, SONG_MB = 30;
  function songExt(type) {
    return /mp4|m4a|aac/.test(type) ? (type.indexOf("video") === 0 ? "mp4" : "m4a") : /mpeg|mp3/.test(type) ? "mp3"
      : /wav/.test(type) ? "wav" : /ogg/.test(type) ? "ogg" : /quicktime/.test(type) ? "mov" : "webm";
  }
  function songRecorder(saved) {
    var kept = saved.slice(), takes = [], rec = null, chunks = [], started = 0, timer = null;
    var node = el("div", "songrec__rec");
    node.appendChild(el("p", "songrec__label", "내 노래 녹음 (" + SONG_MAX + "곡까지)"));
    var list = el("ul", "songrec__takes");
    node.appendChild(list);
    var row = el("div", "fold__actions songrec__btns");
    var recBtn = el("button", "sys-btn songrec__recbtn", "🎤 녹음 시작");
    recBtn.type = "button";
    var pick = el("label", "sys-link songrec__pick", "파일 고르기");
    var file = el("input");
    file.type = "file";
    file.accept = "audio/*,video/*";
    file.hidden = true;
    pick.appendChild(file);
    var clock = el("span", "sys-note");
    row.appendChild(recBtn);
    row.appendChild(pick);
    row.appendChild(clock);
    node.appendChild(row);
    var msg = el("p", "sys-msg");
    node.appendChild(msg);
    var canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
    if (!canRecord) recBtn.hidden = true;

    function count() { return kept.length + takes.length; }
    function mmss(sec) { sec = Math.round(sec || 0); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); }
    function draw() {
      list.textContent = "";
      kept.forEach(function (fl, k) {
        var li = el("li");
        li.appendChild(el("span", null, "올린 녹음 " + (k + 1) + (fl.sec ? " · " + mmss(fl.sec) : "")));
        var play = el("button", "sys-link", "▶ 듣기");
        play.type = "button";
        play.addEventListener("click", function () {
          play.disabled = true;
          LeeshAPI.kakao.token().then(function (t) { return LeeshAPI.storage.song(fl.path, t); }).then(function (u) {
            if (!u) { play.textContent = "못 불러왔어요"; return; }
            var a = el("audio");
            a.controls = true;
            a.src = u;
            play.replaceWith(a);
            a.play();
          });
        });
        li.appendChild(play);
        var del = el("button", "sys-link", "지우기");
        del.type = "button";
        del.addEventListener("click", function () {
          if (del.getAttribute("data-armed") !== "1") { del.setAttribute("data-armed", "1"); del.textContent = "한 번 더 누르면 지워요"; return; }
          LeeshAPI.kakao.token().then(function (t) { return LeeshAPI.storage.removeSongs([fl.path], t); }).then(function () {
            kept.splice(kept.indexOf(fl), 1);
            msg.textContent = "지웠어요. 아래 \"신청 내용 고치기\"를 눌러야 저장돼요.";
            msg.className = "sys-msg";
            draw();
          });
        });
        li.appendChild(del);
        list.appendChild(li);
      });
      takes.forEach(function (tk, k) {
        var li = el("li");
        li.appendChild(el("span", null, "새 녹음 " + (k + 1) + (tk.sec ? " · " + mmss(tk.sec) : "")));
        var a = el("audio");
        a.controls = true;
        a.src = tk.url;
        li.appendChild(a);
        var out = el("button", "sys-link", "빼기");
        out.type = "button";
        out.addEventListener("click", function () { takes.splice(takes.indexOf(tk), 1); draw(); });
        li.appendChild(out);
        list.appendChild(li);
      });
      if (!count()) list.appendChild(el("li", "sys-note", canRecord ? "아직 녹음이 없어요." : "이 기기에서는 녹음이 안 돼서, 녹음 파일이나 영상을 골라주세요."));
      recBtn.disabled = !rec && count() >= SONG_MAX;
      pick.hidden = count() >= SONG_MAX;
    }
    function stop() {
      if (!rec) return;
      rec.stop();
    }
    recBtn.addEventListener("click", function () {
      if (rec) { stop(); return; }
      msg.textContent = "";
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).then(function (stream) {
        var type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].filter(function (t) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t); })[0];
        rec = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
        chunks = [];
        rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = function () {
          clearInterval(timer);
          stream.getTracks().forEach(function (t) { t.stop(); });
          var blob = new Blob(chunks, { type: rec.mimeType || type || "audio/webm" });
          var sec = (Date.now() - started) / 1000;
          rec = null;
          recBtn.textContent = "🎤 녹음 시작";
          recBtn.classList.remove("is-on");
          clock.textContent = "";
          if (sec >= 3 && blob.size) takes.push({ blob: blob, url: URL.createObjectURL(blob), sec: sec });
          else { msg.textContent = "너무 짧아요. 다시 녹음해주세요."; msg.className = "sys-msg sys-msg--error"; }
          draw();
        };
        rec.start(1000);
        started = Date.now();
        recBtn.textContent = "■ 멈추기";
        recBtn.classList.add("is-on");
        timer = setInterval(function () {
          var sec = (Date.now() - started) / 1000;
          clock.textContent = "녹음 중 " + mmss(sec) + " / " + mmss(SONG_SEC);
          if (sec >= SONG_SEC) stop();
        }, 250);
      }, function () {
        msg.textContent = "마이크를 쓸 수 없어요. 브라우저에서 마이크를 허용하거나 파일을 골라주세요.";
        msg.className = "sys-msg sys-msg--error";
      });
    });
    file.addEventListener("change", function () {
      var fl = file.files[0];
      file.value = "";
      if (!fl) return;
      if (!/^(audio|video)\//.test(fl.type)) { msg.textContent = "노래 녹음이나 영상 파일만 올릴 수 있어요."; msg.className = "sys-msg sys-msg--error"; return; }
      if (fl.size > SONG_MB * 1048576) { msg.textContent = SONG_MB + "MB보다 커요. 짧게 잘라서 올리거나 카카오톡 채널로 보내주세요."; msg.className = "sys-msg sys-msg--error"; return; }
      msg.textContent = "";
      takes.push({ blob: fl, url: URL.createObjectURL(fl), sec: 0 });
      draw();
    });
    draw();
    return {
      node: node,
      busy: function () { return !!rec; },
      pending: function () { return takes.length > 0; },
      /** Uploads the new takes; resolves to the full list for the request, or null if one failed. */
      upload: function () {
        if (!takes.length) return Promise.resolve(kept);
        return LeeshAPI.kakao.token().then(function (t) {
          var stamp = Date.now().toString(36);
          return Promise.all(takes.map(function (tk, k) {
            var type = String(tk.blob.type).split(";")[0];
            var path = who.id + "/" + stamp + "-" + (k + 1) + "." + songExt(type);
            return LeeshAPI.storage.uploadSong(path, tk.blob, t).then(function (ok) {
              return ok ? { path: path, name: "녹음 " + (kept.length + k + 1), type: type, size: tk.blob.size, sec: Math.round(tk.sec) || null } : null;
            });
          }));
        }).then(function (up) {
          if (up.some(function (x) { return !x; })) return null;
          kept = kept.concat(up);
          takes = [];
          return kept;
        });
      }
    };
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
    var cards = {};
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
    // 연습 사진 (원장님 2026-11-10): 고르면 일지를 저장한 뒤 그 일지에 붙어요
    var pics = el("input"); pics.type = "file"; pics.accept = "image/*"; pics.multiple = true;
    var picsNote = el("span", "sys-note");
    pics.addEventListener("change", function () { picsNote.textContent = pics.files && pics.files.length ? " " + pics.files.length + "장 골랐어요" : ""; });
    var picsField = field2("📷 사진 (선택 · 악보 · 가사 · 연습하는 모습)", pics);
    picsField.appendChild(picsNote);
    if (window.LeeshPhotos) f.appendChild(picsField);
    var btn = el("button", "sys-btn", "일지 쓰기");
    btn.type = "submit";
    f.appendChild(btn);
    var note = el("p", "sys-msg");
    f.appendChild(note);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      btn.disabled = true;
      var files = Array.prototype.slice.call(pics.files || []);
      LeeshAPI.rpc("member_log_save", { p_id: who.id, p_pin: who.key, p_log: null, p_day: day.value, p_minutes: mins.value ? Number(mins.value) : null, p_song: song.value || null, p_did: did.value || null })
        .then(function (res) {
          if (!res.ok) { note.textContent = res.error; note.className = "sys-msg sys-msg--error"; btn.disabled = false; return; }
          var up = files.length ? (note.textContent = "사진 올리는 중…", note.className = "sys-msg", logPhotoUpload(res.id, files.slice(0, 10))) : Promise.resolve("");
          return up.then(function (msg) {
            return load().then(function () { showTab("logs"); if (msg) { var n = scene.querySelector("#myLogs .sys-msg"); if (n) { n.textContent = msg; n.className = "sys-msg sys-msg--error"; } } });
          });
        });
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
      cards[l.id] = c;
      box.appendChild(c);
    });
    logPhotos(cards);
  }

  /* 연습 일지 사진 (원장님 2026-11-10): lesson-photos/<수강 ID>/log/<이름>, 본인 · 담당 선생님 · 관리자만 봐요 */
  function logPhotoUpload(logId, files) {
    var failed = 0, why = "";
    return files.reduce(function (chain, file) {
      return chain.then(function () {
        return LeeshPhotos.shrink(file).then(function (sm) {
          var path = who.id + "/log/" + (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).replace(/[^a-z0-9]/g, "") + "." + sm.ext;
          return LeeshAPI.kakao.token().then(function (t) { return LeeshAPI.storage.uploadPhoto(path, sm.blob, t); }).then(function (ok) {
            if (!ok) throw new Error("인터넷 연결을 확인해 주세요.");
            return LeeshAPI.rpc("member_log_photo_add", { p_id: who.id, p_pin: who.key, p_log: logId, p_path: path, p_w: sm.w, p_h: sm.h });
          }).then(function (res) {
            if (!res.ok) throw new Error(res.error);
            photoUrls[path] = Promise.resolve(URL.createObjectURL(sm.blob));
          });
        }).catch(function (e) { failed++; why = (e && e.message) || ""; });
      });
    }, Promise.resolve()).then(function () { return failed ? failed + "장은 못 올렸어요. " + why : ""; });
  }
  function logPhotos(cards) {
    if (!window.LeeshPhotos || !who || !Object.keys(cards).length) return;
    LeeshAPI.rpc("member_log_photos", { p_id: who.id, p_pin: who.key }).then(function (res) {
      var by = {};
      ((res.ok && res.items) || []).forEach(function (p) { (by[p.log] = by[p.log] || []).push(p); });
      Object.keys(cards).forEach(function (id) {
        var items = by[id] || [];
        var strip = LeeshPhotos.strip({
          items: items, canEdit: true, load: photoUrl,
          note: "사진은 나 · 담당 선생님 · 학원만 볼 수 있어요.",
          onAdd: function (files) {
            var left = 10 - strip.count();
            if (left <= 0) { strip.busy("일지 하나에 사진은 10장까지예요.", "error"); return; }
            strip.busy("사진 올리는 중…");
            logPhotoUpload(Number(id), files.slice(0, left)).then(function (msg) {
              return LeeshAPI.rpc("member_log_photos", { p_id: who.id, p_pin: who.key }).then(function (r2) {
                strip.set(((r2.ok && r2.items) || []).filter(function (p) { return String(p.log) === String(id); }));
                strip.busy(msg || "올렸어요.", msg ? "error" : "ok");
              });
            });
          },
          onDelete: function (it) {
            return LeeshAPI.rpc("member_log_photo_delete", { p_id: who.id, p_pin: who.key, p_photo: it.id }).then(function (r) {
              if (!r.ok) { strip.busy(r.error, "error"); return false; }
              LeeshAPI.kakao.token().then(function (t) { LeeshAPI.storage.removePhotos([r.path], t); });
              items = items.filter(function (x) { return x.id !== it.id; });
              strip.set(items);
              return true;
            });
          }
        });
        cards[id].appendChild(strip.node);
      });
    });
  }

  /* 원장님 컨설팅 신청 (원장님 2026-11-11, 처음 이름 "원장님 피드백" → "원장님 컨설팅"): 심화반 학생에게만 탭이 보여요. 정해 둔 시간 중 하나, 한 타임에 한 명(먼저 신청한 사람),
     한 사람은 남은 신청 하나만 (바꾸려면 취소 후 다시). 서버 member_feedback · member_feedback_book · member_feedback_cancel. */
  function loadFeedback() {
    var tab = scene.querySelector('[data-book-tab="feedback"]');
    return LeeshAPI.rpc("member_feedback", { p_id: who.id, p_pin: who.key }).then(function (res) {
      if (!tab) return;
      tab.hidden = !(res.ok && res.eligible);
      if (tab.hidden) return;
      renderFeedback(res);
    });
  }
  // 원장님 안내 문구 그대로 (2026-11-11, 첫 번째 문단). ["p", 글] = 문단, ["h", 제목], ["ul", [줄…]]
  // 첫 번째 안내 (원장님 2026-11-11 문구 그대로, 같은 날 "가독성 있게 나눠" → 소개 카드 · 주요 내용 카드 · 마무리 띠)
  // **…** = 강조(주황 굵게)
  var CONSULT_INTRO = {
    title: "📢 오디션 컨설팅 예약 안내",
    intro: [
      "오디션을 준비하다 보면 **현재 나의 실력과 가능성**은 어느 정도인지, **어떤 부분을 보완**해야 하는지, 앞으로 **어떤 방향으로 준비**해야 할지 고민되는 순간들이 있습니다.",
      "이번 컨설팅은 현재 자신의 위치를 객관적으로 점검하고, 보다 정확한 방향과 전략을 세워 **오디션 합격 가능성을 높이기 위해** 진행됩니다."
    ],
    items: [
      ["보컬 점검 및 피드백", ["오디션 곡 선정 및 적합성 점검", "보컬 기본기, 테크닉, 표현력 등 디테일한 피드백"]],
      ["기획사 분석 및 오디션 전략", ["주요 기획사별 특징 및 선호하는 인재상", "기획사별 신인 개발 방향 및 최근 캐스팅 동향", "현재 준비 중인 오디션에 맞춘 전략"]],
      ["개인별 맞춤 컨설팅", ["현재 실력과 가능성에 대한 객관적인 평가", "강점과 보완점 분석 및 앞으로의 방향성 제시", "합격 가능성을 높이기 위한 구체적인 준비 방법", "원장님의 개별 코멘트 및 질의응답"]]
    ],
    end: ["단순히 실력을 평가하는 시간이 아닌,", "앞으로 무엇을 어떻게 준비해야 할지", "함께 방향을 잡아가는 시간입니다. 🫶🏻"]
  };
  function hiText(node, text) {
    text.split("**").forEach(function (t, i) {
      if (!t) return;
      if (i % 2) node.appendChild(el("strong", "ci__hi", t));
      else node.appendChild(document.createTextNode(t));
    });
    return node;
  }
  function consultIntro1() {
    var d = CONSULT_INTRO, w = el("section", "ci");
    w.appendChild(el("h3", "ci__title", d.title));
    var c1 = el("div", "ci__card");
    c1.appendChild(el("span", "ci__pill", "컨설팅 소개"));
    d.intro.forEach(function (t) { c1.appendChild(hiText(el("p", "ci__p"), t)); });
    w.appendChild(c1);
    var c2 = el("div", "ci__card");
    c2.appendChild(el("span", "ci__pill", "🎤 컨설팅 주요 내용"));
    d.items.forEach(function (it, i) {
      var s = el("div", "ci__item");
      var h = el("p", "ci__h");
      h.appendChild(el("span", "ci__num", String(i + 1)));
      h.appendChild(document.createTextNode(it[0]));
      s.appendChild(h);
      var ul = el("ul", "ci__ul");
      it[1].forEach(function (t) { ul.appendChild(el("li", null, t)); });
      s.appendChild(ul);
      c2.appendChild(s);
    });
    w.appendChild(c2);
    var e = el("div", "ci__end");
    d.end.forEach(function (t, i) { e.appendChild(el("p", i === 1 ? "ci__endhi" : null, t)); });
    w.appendChild(e);
    return w;
  }
  // 두 번째 안내 (원장님 2026-11-11 문구 그대로, 같은 날 첫 안내처럼 카드로 나눔)
  // 예약 기간은 서버 feedback_slots.book_until(11/15 23:59)과 같게 — 다음 달엔 날짜 문구도 같이 고치기
  var CONSULT_INTRO2 = {
    title: "📅 컨설팅 예약 안내",
    date: "11월 11일(수) ~ 11월 15일(일)",
    when: [
      "예약 기간 내 원하시는 컨설팅 일정을 선택하여 예약해 주시기 바랍니다.",
      "기간 내 예약을 완료하셔야 컨설팅 일정이 **최종 확정**됩니다."
    ],
    warn: "⚠️ 예약 기간(11월 15일까지) 안에 신청하지 않으시면 이번 달 컨설팅은 진행되지 않고, 다음 달 컨설팅으로 넘어갑니다.",
    check: [
      "예약 확정 후에는 **일정 변경이 어려우므로**, 개인 일정을 충분히 확인하신 후 신중하게 선택해 주세요.",
      "원활한 컨설팅 진행을 위해 **예약 기간 이후에는 추가 예약 및 일정 변경이 어려운 점** 양해 부탁드립니다."
    ],
    end: ["감사합니다.", "여러분의 가능성을 함께 발견하고,", "목표에 한 걸음 더 가까워질 수 있도록 원장님도 최선을 다하겠습니다!", "함께 좋은 결과 만들어 봐요! 💪🏻✨"]
  };
  function consultIntro2() {
    var d = CONSULT_INTRO2, w = el("section", "ci");
    w.appendChild(el("h3", "ci__title", d.title));
    var c1 = el("div", "ci__card");
    c1.appendChild(el("span", "ci__pill", "🗓 예약 기간"));
    c1.appendChild(el("p", "ci__date", d.date));
    d.when.forEach(function (t) { c1.appendChild(hiText(el("p", "ci__p"), t)); });
    c1.appendChild(el("p", "ci__warn", d.warn));
    w.appendChild(c1);
    var c2 = el("div", "ci__card");
    c2.appendChild(el("span", "ci__pill", "📌 꼭 확인해 주세요"));
    var ul = el("ul", "ci__ul ci__ul--note");
    d.check.forEach(function (t) { ul.appendChild(hiText(el("li"), t)); });
    c2.appendChild(ul);
    w.appendChild(c2);
    var e = el("div", "ci__end");
    d.end.forEach(function (t, i) { e.appendChild(el("p", i === 0 ? "ci__endthanks" : (i === 2 ? "ci__endhi" : null), t)); });
    w.appendChild(e);
    return w;
  }
  function renderFeedback(res) {
    var box = scene.querySelector("#myFeedback");
    box.textContent = "";
    box.appendChild(consultIntro1());
    box.appendChild(consultIntro2());
    var slots = res.slots || [];
    var open = slots.filter(function (x) { return !x.closed; });
    var sum = el("div", "fold__sum");
    sum.appendChild(el("p", null, "아래 시간 중 하나를 골라 신청해요."));
    sum.appendChild(el("p", "sys-note", "한 타임에 한 명만 (먼저 신청한 사람) · 한 사람은 한 번만 신청할 수 있어요. 예약 기간 안에는 내 신청을 취소하고 다시 고를 수 있어요."));
    if (slots.length && !open.length) sum.appendChild(el("p", "sys-msg sys-msg--error", "예약 기간이 끝났어요. 이번 달에 신청하지 못했다면 다음 달 컨설팅으로 넘어가요. 일정 변경은 학원(실장님)에 연락해주세요."));
    box.appendChild(sum);
    var msgEl = el("p", "sys-msg");
    var mine = slots.filter(function (x) { return x.mine; })[0];
    if (mine) {
      var card = el("div", "fold__card fb__mine");
      card.appendChild(el("p", "fb__minehead", "✅ 내 신청"));
      card.appendChild(el("p", "fb__minewhen", mine.when + " · " + mine.kind + " 컨설팅"));
      if (mine.note) card.appendChild(el("p", "sys-note", mine.note));
      if (mine.cancel) {
        var c = el("button", "sys-link", "신청 취소");
        c.type = "button";
        c.addEventListener("click", function () {
          if (c.getAttribute("data-armed") !== "1") { c.setAttribute("data-armed", "1"); c.textContent = "한 번 더 누르면 취소돼요"; return; }
          c.disabled = true;
          LeeshAPI.rpc("member_feedback_cancel", { p_id: who.id, p_pin: who.key, p_booking: mine.booking }).then(function (r) {
            if (!r.ok) { c.disabled = false; msgEl.textContent = r.error; msgEl.className = "sys-msg sys-msg--error"; return; }
            loadFeedback();
          });
        });
        card.appendChild(c);
      } else card.appendChild(el("p", "sys-note", (mine.closed ? "예약 기간이 끝나서" : "시작 1시간 전이라") + " 바꾸려면 학원(실장님)에 연락해주세요."));
      box.appendChild(card);
    }
    if (!slots.length) { box.appendChild(el("p", "book__empty", "지금 신청할 수 있는 시간이 없어요.")); return; }
    var picked = null, form = el("div", "fold__card fb__form");
    form.hidden = true;
    [["보컬", "🎤 보컬 컨설팅"], ["보컬·댄스", "🎤💃 보컬 · 댄스 컨설팅"]].forEach(function (g) {
      var list = slots.filter(function (x) { return x.kinds === g[0]; });
      if (!list.length) return;
      var sec = el("section", "fb__group");
      sec.appendChild(el("h3", "fb__h", g[1]));
      var days = {};
      list.forEach(function (x) { var d = x.when.replace(/\) .*$/, ")"); (days[d] = days[d] || []).push(x); });
      Object.keys(days).forEach(function (d) {
        var row = el("div", "fb__day");
        row.appendChild(el("b", "fb__date", d));
        var times = el("div", "fb__times");
        days[d].forEach(function (x) {
          var label = x.when.replace(/^.*\) /, "");
          var b = el("button", "fb__time" + (x.mine ? " is-mine" : x.taken || x.closed ? " is-taken" : ""), x.mine ? label + " ✓" : x.taken ? label + " 마감" : label);
          b.type = "button";
          b.disabled = x.taken || x.closed || !!mine;
          b.addEventListener("click", function () {
            picked = x;
            box.querySelectorAll(".fb__time.is-on").forEach(function (n) { n.classList.remove("is-on"); });
            b.classList.add("is-on");
            drawForm();
          });
          times.appendChild(b);
        });
        row.appendChild(times);
        sec.appendChild(row);
      });
      box.appendChild(sec);
    });
    if (mine) box.appendChild(el("p", "sys-note", "이미 신청한 시간이 있어서 다른 시간은 고를 수 없어요."));
    box.appendChild(form);
    box.appendChild(msgEl);
    function drawForm() {
      form.hidden = false;
      form.textContent = "";
      form.appendChild(el("p", "fb__minewhen", picked.when));
      var kind = "보컬";
      if (picked.kinds === "보컬·댄스") {
        var kr = el("div", "fb__kinds");
        ["보컬", "댄스"].forEach(function (k, i) {
          var lab = el("label", "sys-check"), r = el("input");
          r.type = "radio"; r.name = "fbkind"; r.value = k; r.checked = !i;
          r.addEventListener("change", function () { kind = k; });
          lab.appendChild(r);
          lab.appendChild(document.createTextNode(" " + k + " 컨설팅"));
          kr.appendChild(lab);
        });
        form.appendChild(kr);
      } else form.appendChild(el("p", "sys-note", "이 시간은 보컬 컨설팅만 해요."));
      var ta = el("textarea");
      ta.rows = 2; ta.maxLength = 300;
      ta.placeholder = "원장님께 남길 말 (선택) · 예) 준비하는 곡, 궁금한 점";
      ta.setAttribute("aria-label", "원장님께 남길 말");
      form.appendChild(ta);
      var go = el("button", "sys-btn", "이 시간으로 신청하기");
      go.type = "button";
      go.addEventListener("click", function () {
        go.disabled = true;
        LeeshAPI.rpc("member_feedback_book", { p_id: who.id, p_pin: who.key, p_slot: picked.id, p_kind: kind, p_note: ta.value }).then(function (r) {
          if (!r.ok) { go.disabled = false; msgEl.textContent = r.error; msgEl.className = "sys-msg sys-msg--error"; if (/다른 학생/.test(r.error || "")) loadFeedback(); return; }
          loadFeedback().then(function () { var m = scene.querySelector("#myFeedback .sys-msg"); if (m) { m.textContent = "신청했어요. 원장님 컨설팅 시간에 맞춰 와주세요!"; m.className = "sys-msg sys-msg--ok"; } });
        });
      });
      form.appendChild(go);
    }
  }

  /* 오디션 후기 (원장님 2026-11-09 "작성은 학생이 하고 보는 건 선생님들이랑 관리자만"): 내가 쓴 것만 보이고 고치기 · 지우기.
     선생님 모두 · 관리자가 봐요. 다른 학생 후기 · 학부모 화면에는 안 보여요. 서버 member_reviews / member_review_save / member_review_delete. */
  // 원장님이 정한 양식 순서 (2026-11-09): 이름 · 성별 · 생년월일 · 담당쌤 · 기획사명 · 오디션 일자 · 준비한 곡(보컬곡 / 댄스곡) ·
  // 질문 리스트 · 나만의 꿀팁 / 나의 후기 · 진행 순서 / 상황 설명 · 특이사항. 이름 · 담당쌤은 명단에서 저절로.
  var RV_TEXT = [
    ["asked", "질문 리스트", "예) 자기소개 해보세요 / 다른 곡 한 소절 더 / 춤 출 수 있어요? / 연습생 경험 있어요?", 2000, 4],
    ["tip", "나만의 꿀팁 · 나의 후기", "예) 대기가 길어서 물 꼭 챙기기. 첫 음은 잘 잡았는데 긴장해서 후렴 호흡이 모자랐어요", 2000, 4],
    ["process", "진행 순서 · 상황 설명", "예) 번호표 → 5명씩 입장 → 자기소개 30초 → 노래 1분 → 춤. 심사위원 2명, 분위기 편했어요", 2000, 4],
    ["note", "특이사항", "예) 현장에서 영상 촬영함 / 다음 주에 2차 연락 준다고 함", 1000, 2]
  ];
  var rvMeta = {};
  var reviews = [];
  function loadReviews() {
    return LeeshAPI.rpc("member_reviews", { p_id: who.id, p_pin: who.key }).then(function (res) {
      if (!res.ok) return;
      reviews = res.items || [];
      rvMeta = { name: res.name || "", teacher: res.teacher || "" };
      renderReviews();
    });
  }
  function rvView(r) {
    var c = el("article", "lnote rv");
    var head = el("p", "lnote__date", dayLabel(r.date) + " · " + r.company);
    c.appendChild(head);
    var info = [r.gender, r.birth, r.height && "키 " + r.height, r.weight && "몸무게 " + r.weight].filter(Boolean).join(" · ");
    if (info) c.appendChild(el("p", "rv__info", info));
    if (r.songVocal || r.songDance) {
      c.appendChild(el("p", "rv__label", "준비한 곡"));
      if (r.songVocal) c.appendChild(el("p", "lnote__did", "🎤 보컬곡 · " + r.songVocal));
      if (r.songDance) c.appendChild(el("p", "lnote__did", "💃 댄스곡 · " + r.songDance));
    }
    RV_TEXT.forEach(function (f) {
      if (!r[f[0]]) return;
      c.appendChild(el("p", "rv__label", f[1]));
      c.appendChild(el("p", "lnote__did", r[f[0]]));
    });
    return c;
  }
  function rvForm(r, done) {
    var f = el("form", "fold__form sys rv__form");
    var today = todayKst(), last = reviews[0] || {};
    var fixed = el("div", "sys-row rv__fixed");
    var nm = el("input"); nm.value = rvMeta.name; nm.readOnly = true;
    var tc = el("input"); tc.value = rvMeta.teacher ? rvMeta.teacher + " 선생님" : "-"; tc.readOnly = true;
    fixed.appendChild(field2("이름", nm));
    fixed.appendChild(field2("담당쌤", tc));
    f.appendChild(fixed);
    var gender = selectOf("gender", ["여", "남"], r ? r.gender : last.gender, "골라주세요");
    gender.required = true;
    var birth = el("input"); birth.maxLength = 20; birth.required = true; birth.placeholder = "예) 2009.03.15"; birth.value = r ? (r.birth || "") : (last.birth || "");
    var row1 = el("div", "sys-row");
    row1.appendChild(field2("성별", gender));
    row1.appendChild(field2("생년월일", birth));
    f.appendChild(row1);
    // 키 · 몸무게 (원장님 2026-11-10, 선택 칸 · 지난 후기에서 미리 채움)
    var ht = el("input"); ht.maxLength = 20; ht.placeholder = "예) 165cm"; ht.value = r ? (r.height || "") : (last.height || "");
    var wt = el("input"); wt.maxLength = 20; wt.placeholder = "예) 48kg"; wt.value = r ? (r.weight || "") : (last.weight || "");
    var rowHw = el("div", "sys-row");
    rowHw.appendChild(field2("키", ht));
    rowHw.appendChild(field2("몸무게", wt));
    f.appendChild(rowHw);
    var co = el("input"); co.maxLength = 60; co.required = true; co.placeholder = "예) SM 엔터테인먼트"; co.value = r ? r.company : "";
    var day = el("input"); day.type = "date"; day.value = r ? r.date : today; day.max = today; day.min = addDays(today, -730); day.required = true;
    var row2 = el("div", "sys-row");
    row2.appendChild(field2("기획사명", co));
    row2.appendChild(field2("오디션 일자", day));
    f.appendChild(row2);
    var sv = el("input"); sv.maxLength = 300; sv.placeholder = "예) 아이유 - 밤편지 (1절 + 후렴)"; sv.value = r && r.songVocal || "";
    var sd = el("input"); sd.maxLength = 300; sd.placeholder = "예) 르세라핌 - ANTIFRAGILE (없으면 비워 두기)"; sd.value = r && r.songDance || "";
    var row3 = el("div", "sys-row");
    row3.appendChild(field2("준비한 곡 · 보컬곡", sv));
    row3.appendChild(field2("준비한 곡 · 댄스곡", sd));
    f.appendChild(row3);
    var boxes = {};
    RV_TEXT.forEach(function (x) {
      var ta = el("textarea"); ta.rows = x[4]; ta.maxLength = x[3]; ta.placeholder = x[2]; ta.value = r && r[x[0]] || "";
      boxes[x[0]] = ta;
      f.appendChild(field2(x[1], ta));
    });
    // 원장님 2026-11-10: 제출 버튼 바로 위에 잘 보이게
    var gift = el("p", "rv__gift");
    gift.appendChild(el("b", null, "📢 후기 작성 후 담당 선생님께 꼭 알려주세요!"));
    gift.appendChild(el("span", null, "확인 후 기프티콘을 보내드립니다. 🎁"));
    f.appendChild(gift);
    var btns = el("div", "sys-row rv__btns");
    var save = el("button", "sys-btn", r ? "고친 내용 저장" : "후기 보내기");
    save.type = "submit";
    btns.appendChild(save);
    if (done) {
      var cancel = el("button", "sys-btn sys-btn--ghost", "닫기");
      cancel.type = "button";
      cancel.addEventListener("click", function () { done(false); });
      btns.appendChild(cancel);
    }
    f.appendChild(btns);
    var note = el("p", "sys-msg");
    f.appendChild(note);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var data = { gender: gender.value, birth: birth.value, height: ht.value, weight: wt.value, company: co.value, date: day.value, songVocal: sv.value, songDance: sd.value };
      RV_TEXT.forEach(function (x) { data[x[0]] = boxes[x[0]].value; });
      save.disabled = true;
      note.textContent = "보내는 중…"; note.className = "sys-msg";
      LeeshAPI.rpc("member_review_save", { p_id: who.id, p_pin: who.key, p_review: r ? r.id : null, p_data: data }).then(function (res) {
        save.disabled = false;
        if (!res.ok) { note.textContent = res.error; note.className = "sys-msg sys-msg--error"; return; }
        loadReviews().then(function () {
          var m = scene.querySelector("#myReviews .rv__saved");
          if (m) m.textContent = r ? "고친 내용을 저장했어요." : "후기를 보냈어요. 고마워요!";
        });
      });
    });
    return f;
  }
  function renderReviews() {
    var box = scene.querySelector("#myReviews");
    if (!box) return;
    box.textContent = "";
    var sum = el("div", "fold__sum");
    sum.appendChild(el("p", null, "오디션을 보고 오면 기억이 생생할 때 적어주세요. 어떤 곡을 불렀는지, 무엇을 물어봤는지가 다음 수업과 다른 친구들 준비에 큰 도움이 돼요."));
    sum.appendChild(el("p", "sys-note", "🔒 남겨주신 후기는 모두에게 보이지 않고 담당 선생님만 볼 수 있어요! 😘 부담 없이 솔직하게 적어주세요~"));
    box.appendChild(sum);
    box.appendChild(el("p", "sys-msg sys-msg--ok rv__saved"));
    var newWrap = el("details", "rv__new");
    newWrap.open = !reviews.length;
    newWrap.appendChild(el("summary", "sys-btn rv__newbtn", "✏️ 새 오디션 후기 쓰기"));
    newWrap.appendChild(rvForm(null, null));
    box.appendChild(newWrap);
    if (!reviews.length) { box.appendChild(el("p", "book__empty", "아직 쓴 후기가 없어요.")); return; }
    box.appendChild(el("h3", "rv__h", "내가 쓴 후기 " + reviews.length + "개"));
    reviews.forEach(function (r) {
      var wrap = el("div", "rv__item");
      var card = rvView(r);
      var tools = el("p", "rv__tools");
      var edit = el("button", "sys-link", "고치기");
      edit.type = "button";
      var del = el("button", "sys-link fold__del", "지우기");
      del.type = "button";
      var n2 = el("p", "sys-msg");
      edit.addEventListener("click", function () {
        var f = rvForm(r, function () { f.replaceWith(card); tools.hidden = false; });
        card.replaceWith(f);
        tools.hidden = true;
      });
      del.addEventListener("click", function () {
        if (del.getAttribute("data-armed") !== "1") { del.setAttribute("data-armed", "1"); del.textContent = "한 번 더 누르면 지워요"; return; }
        LeeshAPI.rpc("member_review_delete", { p_id: who.id, p_pin: who.key, p_review: r.id }).then(function (res) {
          if (!res.ok) { n2.textContent = res.error; n2.className = "sys-msg sys-msg--error"; return; }
          loadReviews();
        });
      });
      tools.appendChild(edit);
      tools.appendChild(del);
      card.appendChild(tools);
      card.appendChild(n2);
      wrap.appendChild(card);
      box.appendChild(wrap);
    });
  }

  scene.querySelector("#myLogout").addEventListener("click", function () {
    msgs = []; msgSeen = {}; msgJumped = 0; msgBadge();
    sign.signOut();
    showLogin();
  });

  scene.querySelectorAll("[data-book-tab]").forEach(function (tab) {
    tab.addEventListener("click", function () { showTab(tab.getAttribute("data-book-tab")); });
  });

  // Refresh each time the folder opens, so a note written a minute ago shows up.
  // A link like index.html#evals opens the folder on that tab (js/scene.js passes it on).
  scene.addEventListener("scene:open", function (e) {
    if (e.detail && e.detail.tab) showTab(HIDDEN.indexOf(e.detail.tab) < 0 ? e.detail.tab : FIRST);
    else if (msgs.some(function (m) { return !m.read; })) showTab("msgs");
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
