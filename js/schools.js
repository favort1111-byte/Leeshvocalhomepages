// 입시 학교 찾기 (schools.html, 원장님 2026-11-04): 모집구분(4년제 · 전문대 · 고등학교)과 지역(권역 7개)을 고르면
// 보컬 실기가 있는 학과만 학교별로 보여줘요. 자료는 data/schools.json (tools/import_schools.py가 구글시트에서 만듦).
// 다 늘어놓지 않고, 고른 것만 보여줘요. 고른 값은 주소 끝(#univ/seoul)에 남아서 링크로 보내도 같은 화면이 열려요.
// 원장님 2026-11-04 (입시 정보 사이트 캡처 참고): 학교 · 학과 · 지역 검색 + 학과마다 일정 칸(원서접수 · 실기 · 합격 발표,
// 오늘과 견줘 종료 · 접수 중 · D-n) + 다가오는 일정순 정렬.
(function () {
  var app = document.getElementById("schoolApp");
  if (!app) return;
  var data = null, pick = { cat: "", region: "", kind: "" }, query = "", sortBy = "rec", body = null;
  var DAY = 864e5, WEEK = "일월화수목금토";
  var KINDS = ["실용음악·보컬", "K-POP", "뮤지컬", "공연예술", "교회실용음악"];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function chip(label, on, fn, count) {
    var b = el("button", "sch-chip", label);
    b.type = "button";
    b.setAttribute("aria-pressed", on ? "true" : "false");
    if (count != null) b.appendChild(el("span", "sch-chip__n", String(count)));
    if (count === 0) b.classList.add("is-empty");
    b.addEventListener("click", fn);
    return b;
  }
  function schoolsOf(items) {
    var seen = {};
    items.forEach(function (x) { seen[x.school] = 1; });
    return Object.keys(seen).length;
  }
  function inCat(x) { return x.cat === pick.cat; }
  function inRegion(x) { return !pick.region || x.region === pick.region; }
  function inKind(x) { return !pick.kind || (pick.kind === "기타" ? KINDS.indexOf(x.kind) === -1 : x.kind === pick.kind); }

  function today() { var d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); }
  function utc(s) { var p = s.split("-"); return Date.UTC(+p[0], p[1] - 1, +p[2]); }
  function md(s) { var t = new Date(utc(s)), p = s.split("-"); return p[1] + "." + p[2] + "(" + WEEK[t.getUTCDay()] + ")"; }
  // 기간(a~b) 또는 하루(a)의 상태: 종료 · 접수 중 · 오늘 · D-n
  function badge(a, b) {
    var t = today(), s = utc(a), e = utc(b || a);
    if (t > e) return { text: "종료", cls: "is-done" };
    if (t >= s) return b && b !== a ? { text: "접수 중", cls: "is-now" } : { text: "오늘", cls: "is-now" };
    return { text: "D-" + Math.round((s - t) / DAY), cls: "is-soon" };
  }
  // 학교의 다음 일정 (아직 안 끝난 것 중 가장 가까운 날, 없으면 아주 큰 수)
  function nextOf(majors) {
    var t = today(), best = Infinity;
    majors.forEach(function (x) {
      (x.rounds || []).forEach(function (r) { if (utc(r.b) >= t) best = Math.min(best, Math.max(t, utc(r.a))); });
      [x.exam, x.result].forEach(function (d) { if (d && utc(d) >= t) best = Math.min(best, utc(d)); });
    });
    return best;
  }
  function norm(v) { return String(v || "").replace(/\s+/g, "").toLowerCase(); }
  // 줄임말 (원장님 2026-11-04 "서울예대로 검색하면 안 나와요"): 첫 글자가 같고 나머지 글자가 학교 이름에 차례대로 들어 있으면
  // 서울예대 → 서울예술대학교, 한예종 → 한국예술종합학교, 동아방송대 → 동아방송예술대학교, 한림예고 → 한림연예예술고등학교
  function short(name, q) {
    if (q.length < 2 || name.charAt(0) !== q.charAt(0)) return false;
    for (var i = 1, j = 1; i < q.length; i++) {
      j = name.indexOf(q.charAt(i), j);
      if (j === -1) return false;
      j++;
    }
    return true;
  }
  function inQuery(x) {
    if (!query) return true;
    var q = norm(query);
    return [x.school, x.college, x.major, x.kind, x.sido, x.sigungu, x.sub].some(function (v) { return norm(v).indexOf(q) !== -1; })
      || short(norm(x.school), q);
  }

  function save() {
    var h = [pick.cat, pick.region, pick.kind].filter(Boolean).length ? "#" + [pick.cat, pick.region || "all", pick.kind ? encodeURIComponent(pick.kind) : ""].join("/").replace(/\/$/, "") : "";
    try { history.replaceState(null, "", location.pathname + location.search + h); } catch (e) { /* file:// */ }
  }
  function load() {
    var p = (location.hash || "").slice(1).split("/");
    if (data.cats.some(function (c) { return c.key === p[0]; })) pick.cat = p[0];
    if (data.regions.some(function (r) { return r.key === p[1]; })) pick.region = p[1];
    if (p[2]) pick.kind = decodeURIComponent(p[2]);
  }

  function shell() {
    app.textContent = "";
    var box = el("div", "sch-search");
    var input = el("input", "sch-search__input");
    input.type = "search";
    input.placeholder = "학교 · 학과 · 지역 검색 (줄임말도 돼요: 서울예대, 동아방송대)";
    input.setAttribute("aria-label", "학교 · 학과 · 지역 검색");
    input.addEventListener("input", function () { query = input.value.trim(); render(); });
    box.appendChild(input);
    app.appendChild(box);
    body = el("div");
    app.appendChild(body);
  }

  function render() {
    var app = body;
    app.textContent = "";
    // 1) 모집구분
    var s1 = el("section", "sch-step");
    s1.appendChild(el("h2", "sch-step__q", "1. 어디에 지원하나요?"));
    var row1 = el("div", "sch-chips");
    data.cats.forEach(function (c) {
      var n = data.items.filter(function (x) { return x.cat === c.key; });
      row1.appendChild(chip(c.name, pick.cat === c.key, function () {
        pick.cat = pick.cat === c.key ? "" : c.key;
        pick.kind = "";
        save(); render();
      }, schoolsOf(n)));
    });
    s1.appendChild(row1);
    app.appendChild(s1);
    if (!pick.cat) {
      if (query) { results(app, data.items.filter(inQuery), "전체"); return; }
      app.appendChild(el("p", "sch-hint", "모집구분을 고르면 지역을 고를 수 있습니다. 보컬 실기가 있는 학과만 모았습니다."));
      return;
    }
    // 2) 지역 (권역)
    var catItems = data.items.filter(inCat);
    var s2 = el("section", "sch-step");
    s2.appendChild(el("h2", "sch-step__q", "2. 어느 지역인가요?"));
    var row2 = el("div", "sch-chips");
    row2.appendChild(chip("전체", !pick.region, function () { pick.region = ""; save(); render(); }, schoolsOf(catItems)));
    data.regions.forEach(function (r) {
      var n = catItems.filter(function (x) { return x.region === r.key; });
      var b = chip(r.name, pick.region === r.key, function () { pick.region = pick.region === r.key ? "" : r.key; save(); render(); }, schoolsOf(n));
      b.title = r.sido.join(" · ");
      row2.appendChild(b);
    });
    s2.appendChild(row2);
    app.appendChild(s2);

    var list = catItems.filter(inRegion);
    // 3) 학과 종류 (있는 것만)
    var kinds = [];
    list.forEach(function (x) { var k = KINDS.indexOf(x.kind) === -1 ? "기타" : x.kind; if (kinds.indexOf(k) === -1) kinds.push(k); });
    kinds.sort(function (a, b) { return (KINDS.indexOf(a) === -1 ? 99 : KINDS.indexOf(a)) - (KINDS.indexOf(b) === -1 ? 99 : KINDS.indexOf(b)); });
    if (pick.kind && kinds.indexOf(pick.kind) === -1) pick.kind = "";
    if (kinds.length > 1) {
      var s3 = el("section", "sch-step sch-step--small");
      s3.appendChild(el("h2", "sch-step__q", "학과 종류"));
      var row3 = el("div", "sch-chips");
      row3.appendChild(chip("전체", !pick.kind, function () { pick.kind = ""; save(); render(); }));
      kinds.forEach(function (k) {
        row3.appendChild(chip(k, pick.kind === k, function () { pick.kind = pick.kind === k ? "" : k; save(); render(); }));
      });
      s3.appendChild(row3);
      app.appendChild(s3);
    }
    list = list.filter(inKind).filter(inQuery);

    var catName = data.cats.filter(function (c) { return c.key === pick.cat; })[0].name;
    var regName = pick.region ? data.regions.filter(function (r) { return r.key === pick.region; })[0].name : "전체 지역";
    results(app, list, regName + " · " + catName + (pick.kind ? " · " + pick.kind : ""));
  }

  // 결과: 학교별 카드 (학과 여러 개면 한 카드 안에)
  function results(app, list, title) {
    // 모집구분 없이 검색하면 학점은행제(4년제 · 전문대학 두 칸)가 두 번 나오지 않게
    var seen = {};
    list = list.filter(function (x) { var k = x.school + "|" + x.college + "|" + x.major; if (seen[k]) return false; seen[k] = 1; return true; });
    var res = el("section", "sch-result");
    var head = el("div", "sch-result__head");
    head.appendChild(el("p", "sch-count", title + (query ? " · '" + query + "'" : "") + " — 학교 " + schoolsOf(list) + "곳 · 학과 " + list.length + "개"));
    var sort = el("div", "sch-sort");
    [["rec", "추천순"], ["date", "다가오는 일정순"]].forEach(function (o) {
      var b = el("button", "sch-sort__btn", o[1]);
      b.type = "button";
      b.setAttribute("aria-pressed", sortBy === o[0] ? "true" : "false");
      b.addEventListener("click", function () { sortBy = o[0]; render(); });
      sort.appendChild(b);
    });
    if (list.length > 1) head.appendChild(sort);
    res.appendChild(head);
    if (!list.length) {
      res.appendChild(el("p", "sch-hint", query ? "찾는 학교가 없습니다. 다른 이름이나 지역으로 검색해 보세요." : "이 지역에는 보컬 실기가 확인된 학과가 아직 없습니다. 다른 지역이나 '전체'를 골라 보세요."));
    }
    var by = {}, order = [];
    list.forEach(function (x) { if (!by[x.school]) { by[x.school] = []; order.push(x.school); } by[x.school].push(x); });
    var next = {};
    order.forEach(function (n) { next[n] = nextOf(by[n]); });
    // 추천순: 학원 합격 이력이 있는 학교 먼저, 그다음 지역 · 이름 순 / 다가오는 일정순: 아직 안 끝난 가장 가까운 일정
    order.sort(function (a, b) {
      if (sortBy === "date" && next[a] !== next[b]) return next[a] < next[b] ? -1 : 1;
      var pa = by[a].some(function (x) { return x.pass; }), pb = by[b].some(function (x) { return x.pass; });
      if (pa !== pb) return pa ? -1 : 1;
      var ra = by[a][0].sido + by[a][0].sigungu, rb = by[b][0].sido + by[b][0].sigungu;
      return ra < rb ? -1 : ra > rb ? 1 : a < b ? -1 : 1;
    });
    var ul = el("ul", "sch-list");
    order.forEach(function (name) { ul.appendChild(card(name, by[name])); });
    res.appendChild(ul);
    app.appendChild(res);
  }

  function card(name, majors) {
    // 같은 학교의 여러 줄 중 비어 있지 않은 값 (시트에 시군구 · 설립이 한 줄에만 적힌 학교가 있어서)
    function any(k) { for (var i = 0; i < majors.length; i++) if (majors[i][k]) return majors[i][k]; return ""; }
    var first = { found: any("found"), sub: any("sub"), sido: any("sido"), sigungu: any("sigungu") }, li = el("li", "sch-card");
    var top = el("div", "sch-card__top");
    top.appendChild(el("h3", "sch-card__name", name));
    if (first.found) top.appendChild(el("span", "sch-tag", first.found));
    if (first.sub) top.appendChild(el("span", "sch-tag sch-tag--sub", first.sub));
    else if (!pick.cat) top.appendChild(el("span", "sch-tag sch-tag--sub", data.cats.filter(function (c) { return c.key === majors[0].cat; })[0].name));
    li.appendChild(top);
    li.appendChild(el("p", "sch-card__where", [first.sido, first.sigungu].filter(Boolean).join(" ")));
    var pass = majors.filter(function (x) { return x.pass; });
    if (pass.length) {
      var p = el("p", "sch-pass");
      p.appendChild(el("b", null, "이송희보컬레슨 합격 "));
      p.appendChild(document.createTextNode(pass.map(function (x) { return x.pass; }).join(" · ")));
      li.appendChild(p);
    }
    majors.forEach(function (x) {
      var m = el("div", "sch-major");
      var h = el("p", "sch-major__name");
      h.appendChild(el("b", null, (x.college ? x.college + " " : "") + x.major));
      h.appendChild(el("span", "sch-kind", x.kind));
      m.appendChild(h);
      // 2027 입시요강 (원장님 2026-11-04 "카드에 바로 입시요강"): 모집인원 · 전형 · 반영 비율 · 일정 · 실기 내용
      var box = el("div", "sch-guide");
      box.appendChild(el("p", "sch-guide__h", "2027 입시요강"));
      if (x.seats) box.appendChild(line("모집", x.seats));
      if (x.track) box.appendChild(line("전형", x.track));
      if (x.ratio) box.appendChild(line("반영", x.ratio));
      var sched = schedule(x);
      if (sched) box.appendChild(sched);
      else if (x.apply) box.appendChild(line("원서", x.apply));
      if (x.audition) box.appendChild(line("실기", x.audition));
      if (box.childNodes.length === 1) box.appendChild(el("p", "sch-guide__none", "요약은 준비 중입니다. 아래 모집요강 · 입학처에서 바로 확인할 수 있습니다."));
      if (x.check) box.appendChild(el("p", "sch-note", "2027 모집 여부는 학교 입학처에서 꼭 확인하세요."));
      if (x.checked) box.appendChild(el("p", "sch-guide__src", x.checked + " 모집요강 기준"));
      m.appendChild(box);
      if (x.home) m.appendChild(link("sch-link", "학과 홈페이지 ↗", x.home));
      li.appendChild(m);
    });
    // 학교 공식 모집요강 · 입학처로 바로 (학교마다 하나)
    var btns = el("div", "sch-btns");
    var guide = any("guide"), admit = any("admit");
    if (guide) btns.appendChild(link("sch-btn sch-btn--main", "2027 모집요강 보기 ↗", guide));
    if (admit && admit !== guide) btns.appendChild(link("sch-btn", guide ? "입학처 공지 ↗" : "입학처 · 모집요강 ↗", admit));
    if (btns.childNodes.length) li.appendChild(btns);
    return li;
  }
  function link(cls, text, href) {
    var a = el("a", cls, text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    return a;
  }
  // 일정 칸: 원서접수(전형마다 한 줄) · 실기 · 합격 발표 — 날짜가 하나라도 적힌 학과만
  function schedule(x) {
    var rs = x.rounds || [];
    if (!rs.length && !x.exam && !x.result) return null;
    var g = el("div", "sch-sched");
    function box(title, rows) {
      var b = el("div", "sch-sched__box");
      b.appendChild(el("p", "sch-sched__k", title));
      rows.forEach(function (r) {
        var p = el("p", "sch-sched__row");
        if (r.label) p.appendChild(el("span", "sch-sched__t", r.label));
        p.appendChild(el("span", "sch-sched__d", r.text));
        if (r.badge) p.appendChild(el("span", "sch-badge " + r.badge.cls, r.badge.text));
        b.appendChild(p);
        if (r.note) b.appendChild(el("p", "sch-sched__n", r.note));
      });
      g.appendChild(b);
    }
    var none = [{ text: "학교 모집요강 확인" }];
    box("원서접수", rs.length ? rs.map(function (r) {
      return { label: r.t, text: md(r.a) + " ~ " + md(r.b), badge: badge(r.a, r.b), note: r.n };
    }) : none);
    box("실기", x.exam ? [{ text: md(x.exam), badge: badge(x.exam) }] : none);
    if (x.result) box("합격 발표", [{ text: md(x.result), badge: badge(x.result) }]);
    return g;
  }
  function line(label, text) {
    var p = el("p", "sch-line");
    p.appendChild(el("span", "sch-line__k", label));
    p.appendChild(document.createTextNode(text));
    return p;
  }

  app.appendChild(el("p", "sch-hint", "불러오는 중…"));
  fetch("data/schools.json", { cache: "no-cache" }).then(function (r) { return r.json(); }).then(function (d) {
    data = d;
    var note = document.getElementById("schoolUpdated");
    if (note) note.textContent = d.year + " 입시 · " + d.updated.replace(/-/g, ".") + " 기준";
    load();
    shell();
    render();
  }).catch(function () {
    app.textContent = "";
    app.appendChild(el("p", "sch-hint", "학교 목록을 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요."));
  });
})();
