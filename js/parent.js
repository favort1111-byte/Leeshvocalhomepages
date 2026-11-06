// parent.html: 학부모 화면 (원장님 2026-11-05 "미성년자가 많다 보니 학부모가 보고 싶어함").
// 부모님 본인 카카오로 로그인 → 처음이면 보호자 성함 + 자녀 이름을 보내 연결 요청(parent_request) → 원장님 · 실장님이
// 관리자 → 학부모 탭에서 자녀(수강 ID)를 골라 승인 → 보기만: 월말평가 · 일정·공지 · 학원 메시지 (원장님이 고른 것).
// 예약 · 글쓰기 · 건의함 · 연습 일지 · 레퍼토리 · 레슨 노트는 없음. 학생 화면에는 부모님 연결을 표시하지 않음.
// 서버(parent_* 함수)가 내 자녀인지 다시 확인하고, 평가지 사진은 storage 정책 eval_reports_parent가 자녀 폴더만 열어줌.
(function () {
  var app = document.getElementById("parentApp");
  if (!app) return;
  var WD = ["일", "월", "화", "수", "목", "금", "토"];
  var KAKAO_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3C6.5 3 2 6.6 2 11c0 2.8 1.9 5.3 4.7 6.7l-1 3.6c-.1.3.3.6.6.4l4.3-2.8c.5.1 1 .1 1.4.1 5.5 0 10-3.6 10-8S17.5 3 12 3z" fill="currentColor"/></svg>';
  var me = null, child = null, tab = "evals";
  var EC = window.LeeshEvalCard;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function say(node, text, kind) { node.textContent = text || ""; node.className = "sys-msg" + (kind ? " sys-msg--" + kind : ""); }
  function button(text, cls) { var b = el("button", cls || "sys-btn", text); b.type = "button"; return b; }
  function clear() { app.textContent = ""; }
  function todayKst() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
  function dayLabel(d) {
    var dt = new Date(d + "T00:00:00Z");
    return (dt.getUTCMonth() + 1) + "월 " + dt.getUTCDate() + "일 (" + WD[dt.getUTCDay()] + ")";
  }
  function dday(d) { var n = Math.round((new Date(d + "T00:00:00Z") - new Date(todayKst() + "T00:00:00Z")) / 86400000); return n === 0 ? "오늘" : n < 0 ? "진행 중" : "D-" + n; }
  function msgTime(iso) {
    var k = new Date(new Date(iso).getTime() + 9 * 3600000);
    return (k.getUTCMonth() + 1) + "월 " + k.getUTCDate() + "일 " + k.getUTCHours() + ":" + (k.getUTCMinutes() < 10 ? "0" : "") + k.getUTCMinutes();
  }

  if (!window.LeeshAPI || !LeeshAPI.enabled()) {
    app.appendChild(el("p", "sys-msg", "아직 준비 중이에요."));
    return;
  }

  /* ---------- 로그인 · 연결 ---------- */
  function outButton() {
    var b = button("다른 카카오 계정으로 로그인", "sys-link signin__other");
    b.addEventListener("click", function () { b.disabled = true; LeeshAPI.kakao.signOut(); me = null; LeeshAPI.kakao.start(true); });
    return b;
  }
  function signIn(note, kind) {
    clear();
    app.appendChild(el("h2", "sys-h", "학부모 로그인"));
    app.appendChild(el("p", "sys-note", "부모님 본인의 카카오 계정으로 로그인해 주세요. 학원에서 확인하면 자녀의 월말평가 · 학원 일정 · 공지 · 학원 메시지를 볼 수 있어요."));
    var k = button("", "signin__kakao");
    k.innerHTML = KAKAO_ICON + "<span>카카오로 로그인</span>";
    k.addEventListener("click", function () { k.disabled = true; LeeshAPI.kakao.start(); });
    app.appendChild(k);
    app.appendChild(outButton());
    var m = el("p", "sys-msg");
    app.appendChild(m);
    if (LeeshAPI.kakao.lastError()) say(m, "카카오 로그인을 마치지 못했어요. 다시 눌러주세요.", "error");
    else if (note) say(m, note, kind);
    var stu = el("p", "sys-note par__student");
    stu.innerHTML = "학생 본인이라면 <a href=\"index.html#me\">내 폴더</a>로 로그인해 주세요.";
    app.appendChild(stu);
  }
  function signOut() { LeeshAPI.kakao.signOut(); me = null; child = null; signIn(); }

  function requestForm(r) {
    clear();
    if (r && r.status === "대기") {
      app.appendChild(el("h2", "sys-h", r.name + " 님, 학원 확인을 기다리고 있어요"));
      app.appendChild(el("p", "sys-note", "자녀: " + r.children + " · 실장님이 확인하면 바로 볼 수 있어요."));
      var again = button("확인됐는지 다시 보기");
      again.addEventListener("click", function () { again.disabled = true; start(); });
      app.appendChild(again);
      var fix = button("다시 적기", "sys-link");
      fix.addEventListener("click", function () { requestForm({ name: r.name, children: r.children, status: "고치기" }); });
      app.appendChild(fix);
      app.appendChild(outButton());
      return;
    }
    app.appendChild(el("h2", "sys-h", "처음 오셨네요!"));
    app.appendChild(el("p", "sys-note", r && r.status === "거절"
      ? "연결이 안 됐어요. 자녀 이름을 다시 확인하거나 학원에 문의해 주세요."
      : "보호자 성함과 자녀 이름을 보내주세요. 학원에서 확인한 뒤 연결해 드려요."));
    var f = el("form", "sys");
    function field(label, hint) {
      var l = el("label", "sys-field");
      l.appendChild(el("span", null, label));
      var i = el("input");
      i.placeholder = hint;
      i.maxLength = label === "자녀 이름" ? 200 : 30;
      l.appendChild(i);
      f.appendChild(l);
      return i;
    }
    var nm = field("보호자 성함", "예) 김민지 (어머니)");
    var kids = field("자녀 이름", "자녀가 여러 명이면 쉼표로 · 예) 이하늘, 이하람");
    if (r && r.name) { nm.value = r.name; kids.value = r.children || ""; }
    var sb = el("button", "sys-btn", "연결 요청 보내기");
    sb.type = "submit";
    f.appendChild(sb);
    var m = el("p", "sys-msg");
    f.appendChild(m);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!nm.value.trim()) { say(m, "보호자 성함을 적어주세요.", "error"); return; }
      if (!kids.value.trim()) { say(m, "자녀 이름을 적어주세요.", "error"); return; }
      sb.disabled = true;
      LeeshAPI.rpc("parent_request", { p_name: nm.value, p_children: kids.value }).then(function (x) {
        sb.disabled = false;
        if (!x.ok) { say(m, x.error, "error"); return; }
        start();
      });
    });
    app.appendChild(f);
    app.appendChild(el("p", "sys-note", "보내 주신 성함 · 자녀 이름은 연결 확인에만 씁니다. 자세한 내용은 개인정보처리방침을 확인해 주세요."));
    app.appendChild(outButton());
  }

  function start() {
    if (!LeeshAPI.kakao.session()) { signIn(); return Promise.resolve(); }
    clear();
    app.appendChild(el("p", "sys-note", "확인 중…"));
    return LeeshAPI.rpc("parent_me", {}).then(function (res) {
      if (!res.ok) {
        if (!LeeshAPI.kakao.session()) return signIn("카카오 로그인이 풀렸어요. 다시 눌러주세요.");
        return signIn(res.error, "error");
      }
      if (!res.linked) return requestForm(res.request);
      me = res;
      var kids = res.children || [];
      if (!child || !kids.some(function (k) { return k.id === child; })) child = kids.length ? kids[0].id : null;
      home();
    });
  }

  /* ---------- 연결된 뒤 ---------- */
  function home() {
    clear();
    var h = el("div", "tch__head");
    var t = el("div");
    t.appendChild(el("h2", "sys-h", me.name + " 님"));
    t.appendChild(el("p", "sys-note", "학부모 화면 · 보기만 할 수 있어요"));
    h.appendChild(t);
    var out = button("로그아웃", "sys-link");
    out.addEventListener("click", signOut);
    h.appendChild(out);
    app.appendChild(h);

    var msgHolder = el("div");
    app.appendChild(msgHolder);
    messages(msgHolder);

    var kids = me.children || [];
    if (!kids.length) {
      app.appendChild(el("p", "book__empty", "지금 볼 수 있는 자녀가 없어요. 학원에 문의해 주세요."));
      return;
    }
    if (kids.length > 1) {
      var row = el("div", "sys-chips par__kids");
      kids.forEach(function (k) {
        var b = button(k.name, "sys-chip");
        b.setAttribute("aria-pressed", k.id === child ? "true" : "false");
        b.addEventListener("click", function () { child = k.id; home(); });
        row.appendChild(b);
      });
      app.appendChild(row);
    }
    var tabs = el("div", "book__tabs par__tabs");
    tabs.setAttribute("role", "tablist");
    [["evals", "월말평가"], ["notices", "일정·공지"]].forEach(function (x) {
      var b = button(x[1], "");
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", tab === x[0] ? "true" : "false");
      b.addEventListener("click", function () { tab = x[0]; home(); });
      tabs.appendChild(b);
    });
    app.appendChild(tabs);
    var page = el("div", "par__page");
    page.appendChild(el("p", "sys-note", "불러오는 중…"));
    app.appendChild(page);
    LeeshAPI.rpc("parent_child", { p_member: child }).then(function (res) {
      page.textContent = "";
      if (!res.ok) { page.appendChild(el("p", "sys-msg sys-msg--error", res.error)); return; }
      if (kids.length === 1) page.appendChild(el("h3", "par__child", res.name));
      if (res.status === "휴원") page.appendChild(el("p", "sys-note", "지금은 휴원 중이에요."));
      if (tab === "evals") renderEvals(page, res);
      else renderNotices(page, res);
    });
  }

  function renderEvals(box, res) {
    var reports = res.reports || [];
    if (!reports.length) { box.appendChild(el("p", "book__empty", "아직 월말평가가 없어요. 평가가 끝나면 여기에 올라와요.")); return; }
    reports.forEach(function (r, i) {
      box.appendChild(EC.card(r, reports[i + 1], function (holder) {
        EC.pages(holder, LeeshAPI.kakao.token().then(function (t) {
          var jobs = [];
          for (var n = 1; n <= r.pages; n++) jobs.push(LeeshAPI.storage.image(res.id + "/" + r.month + "/" + n + ".webp", t));
          return Promise.all(jobs);
        }));
      }));
    });
  }

  function noticeCard(n) {
    var d = el("details", "fold__notice");
    if (n.pinned) d.open = true;
    var s = el("summary");
    if (n.pinned) s.appendChild(el("b", "news__badge", "중요"));
    s.appendChild(document.createTextNode(" " + n.title));
    d.appendChild(s);
    if (n.body) d.appendChild(el("p", "fold__body", n.body));
    return d;
  }
  function renderNotices(box, res) {
    var plans = (res.visits || []).map(function (a) {
      return { date: a.date, kind: "내방 오디션", title: (a.company ? a.company + " " : "") + a.title };
    }).concat((res.notices || []).filter(function (n) { return n.start; }).map(function (n) {
      return { date: n.start, end: n.end, kind: /월말\s*평가/.test(n.title) ? "월말평가" : /휴원|휴강|쉬는/.test(n.title) ? "휴원" : "학원 일정", notice: n };
    })).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var plain = (res.notices || []).filter(function (n) { return !n.start; });
    var rules = el("a", "rec__more", "보강 · 결석 규정 보기 (강의 규정 안내) →");
    rules.href = "about.html#rules";
    box.appendChild(rules);
    if (plans.length) {
      box.appendChild(el("h3", "rec__title", "다가오는 일정"));
      plans.forEach(function (p) {
        var row = el("div", "fold__plan");
        var head = el("p", "fold__visit");
        head.appendChild(el("b", "news__badge", dday(p.date)));
        head.appendChild(el("span", "fold__tag", p.kind));
        head.appendChild(document.createTextNode(" " + dayLabel(p.date) + (p.end && p.end !== p.date ? " ~ " + dayLabel(p.end) : "")));
        row.appendChild(head);
        if (p.notice) row.appendChild(noticeCard(p.notice));
        else row.appendChild(el("p", "fold__planlink", p.title));
        box.appendChild(row);
      });
    }
    var rules = window.LeeshRoomRules || window.LeeshVisitRules;
    if (plain.length || rules) box.appendChild(el("h3", "rec__title", "공지"));
    plain.forEach(function (n) { box.appendChild(noticeCard(n)); });
    // 학생 내 폴더와 같은 공지 상자 (원장님 2026-11-06 "공지사항은 모두 학부모도"): 보강 · 레슨 · 환불 규정, 연습실 안내(와이파이), 내방 오디션 참여 방법
    if (window.LeeshRoomRules) {
      box.appendChild(LeeshRoomRules.course());
      box.appendChild(LeeshRoomRules.lesson());
      box.appendChild(LeeshRoomRules.box(function () {
        return LeeshAPI.rpc("parent_wifi", {}).then(function (r) { if (!r.ok) throw new Error(r.error); return r.wifi; });
      }));
    }
    if (window.LeeshVisitRules) box.appendChild(LeeshVisitRules.box(false));
    if (!plans.length && !plain.length && !rules) box.appendChild(el("p", "book__empty", "새 일정이나 공지가 없어요."));
  }

  /* 학원 → 학부모 메시지 (관리자 → 메시지에서 받는 사람 "학부모"). 새 것은 펼쳐 보이고, 보이면 읽음. */
  var msgSeen = {};
  function msgCard(m, fresh) {
    var c = el("article", "fold__card msg" + (fresh ? " msg--new" : ""));
    var h = el("p", "msg__head");
    h.appendChild(el("b", "msg__from", m.sender));
    h.appendChild(el("span", "msg__time", msgTime(m.at)));
    if (fresh) h.appendChild(el("span", "msg__new", "새 메시지"));
    c.appendChild(h);
    c.appendChild(el("p", "msg__body", m.body));
    return c;
  }
  function messages(holder) {
    LeeshAPI.rpc("parent_messages", {}).then(function (res) {
      if (!res.ok || !(res.items || []).length) return;
      var items = res.items;
      var fresh = items.filter(function (m) { return !m.read || msgSeen[m.id]; });
      var old = items.filter(function (m) { return m.read && !msgSeen[m.id]; });
      var box = el("section", "tch__msgs");
      box.appendChild(el("h3", "tch__msgs-h", fresh.length ? "✉ 새 메시지 " + fresh.length + "개" : "✉ 학원 메시지"));
      fresh.forEach(function (m) { box.appendChild(msgCard(m, true)); });
      if (old.length) {
        var d = el("details", "tch__msgs-old");
        d.appendChild(el("summary", null, (fresh.length ? "지난 메시지 " : "받은 메시지 ") + old.length + "개"));
        old.forEach(function (m) { d.appendChild(msgCard(m, false)); });
        box.appendChild(d);
      }
      box.appendChild(el("p", "sys-note", "답장이나 문의는 카카오톡으로 보내주세요."));
      holder.appendChild(box);
      var ids = items.filter(function (m) { return !m.read; }).map(function (m) { msgSeen[m.id] = 1; return m.id; });
      if (ids.length) LeeshAPI.rpc("parent_message_read", { p_ids: ids });
    });
  }

  start();
})();
