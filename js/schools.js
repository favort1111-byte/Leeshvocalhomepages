// 입시 학교 찾기 (schools.html, 원장님 2026-11-04): 모집구분(4년제 · 전문대 · 고등학교)과 지역(권역 7개)을 고르면
// 보컬 실기가 있는 학과만 학교별로 보여줘요. 자료는 data/schools.json (tools/import_schools.py가 구글시트에서 만듦).
// 다 늘어놓지 않고, 고른 것만 보여줘요. 고른 값은 주소 끝(#univ/seoul)에 남아서 링크로 보내도 같은 화면이 열려요.
(function () {
  var app = document.getElementById("schoolApp");
  if (!app) return;
  var data = null, pick = { cat: "", region: "", kind: "" };
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

  function render() {
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
    list = list.filter(inKind);

    // 결과: 학교별 카드 (학과 여러 개면 한 카드 안에)
    var res = el("section", "sch-result");
    var catName = data.cats.filter(function (c) { return c.key === pick.cat; })[0].name;
    var regName = pick.region ? data.regions.filter(function (r) { return r.key === pick.region; })[0].name : "전체 지역";
    res.appendChild(el("p", "sch-count", regName + " · " + catName + (pick.kind ? " · " + pick.kind : "") + " — 학교 " + schoolsOf(list) + "곳 · 학과 " + list.length + "개"));
    if (!list.length) {
      res.appendChild(el("p", "sch-hint", "이 지역에는 보컬 실기가 확인된 학과가 아직 없습니다. 다른 지역이나 '전체'를 골라 보세요."));
    }
    var by = {}, order = [];
    list.forEach(function (x) { if (!by[x.school]) { by[x.school] = []; order.push(x.school); } by[x.school].push(x); });
    // 학원 합격 이력이 있는 학교 먼저, 그다음 지역 · 이름 순
    order.sort(function (a, b) {
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
      if (x.apply) m.appendChild(line("원서", x.apply));
      if (x.audition) m.appendChild(line("실기", x.audition));
      if (x.check) m.appendChild(el("p", "sch-note", "2027 모집 여부는 학교 입학처에서 꼭 확인하세요."));
      if (x.home) {
        var a = el("a", "sch-link", "학교 · 학과 홈페이지 ↗");
        a.href = x.home;
        a.target = "_blank";
        a.rel = "noopener";
        m.appendChild(a);
      }
      li.appendChild(m);
    });
    return li;
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
    render();
  }).catch(function () {
    app.textContent = "";
    app.appendChild(el("p", "sch-hint", "학교 목록을 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요."));
  });
})();
