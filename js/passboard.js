// about → 합격 소식 board: the board built into the page (tools/blog_content.py, up to 2025) plus every 합격
// 소식 the director posts in the admin page (audition_news kind 합격 with 종류 · 단계 · 이니셜). A new 합격 adds
// its company to that year's chips, a line to the company's card (or a new card), and to the count of
// companies; 데뷔 also gets a card at the top. Student names are initials only (the database refuses full names).
(function () {
  if (!window.LeeshAPI || !LeeshAPI.enabled() || !document.getElementById("passYears")) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  // "SM 엔터테인먼트", "SM", "에스엠 Ent." → one key, so a new 합격 finds the card already on the board
  function key(name) {
    return String(name || "").toLowerCase().replace(/\([^)]*\)/g, "").replace(/엔터테인먼트|entertainment|ent\.?|주식회사|\(주\)/g, "").replace(/[\s·.]/g, "");
  }
  function cardsIn(ids) {
    var map = {};
    ids.forEach(function (id) {
      var ul = document.getElementById(id);
      if (ul) ul.querySelectorAll(".agency").forEach(function (li) { map[key(li.querySelector("h4").textContent)] = li; });
    });
    return map;
  }
  function addLine(card, text) {
    var ul = card.querySelector("ul") || card.appendChild(el("ul"));
    ul.insertBefore(el("li", "pass-new", text), ul.firstChild);
  }

  LeeshAPI.request("/rest/v1/audition_news?select=company,title,pass_type,pass_stage,initials,event_date,created_at" +
    "&kind=eq.%ED%95%A9%EA%B2%A9&published=eq.true&company=not.is.null&order=event_date.desc.nullslast,created_at.desc", {
    headers: LeeshAPI.headers()
  }).then(function (res) {
    if (!res.ok || !Array.isArray(res.data) || !res.data.length) return;
    var agencies = cardsIn(["passAgencies", "passAgenciesMore"]), shows = cardsIn(["passShows"]);
    var known = {};
    Object.keys(agencies).concat(Object.keys(shows)).forEach(function (k) { known[k] = 1; });
    var years = {}, added = {};

    // oldest first, so the newest line ends up on top of each card
    res.data.slice().reverse().forEach(function (p) {
      var year = String(p.event_date || p.created_at || "").slice(0, 4);
      var stage = p.pass_stage || "합격";
      var line = year + " " + stage;
      var type = p.pass_type || "기획사";
      (years[year] = years[year] || []).push(p.company);

      if (stage === "데뷔") {
        var d = el("li", "debut pass-new");
        d.appendChild(el("b", null, p.company));
        d.appendChild(el("small", null, p.title || "데뷔"));
        var top = document.getElementById("passDebuts");
        if (top) top.insertBefore(d, top.firstChild);
      }
      if (type === "입시") {
        var school = document.querySelector("#passSchools .card__cols");
        if (!school) return;
        var col = school.querySelector(".pass-col");
        if (!col) {
          col = el("div", "card__col pass-col");
          col.appendChild(el("h4", null, "새 합격"));
          col.appendChild(el("ul"));
          school.insertBefore(col, school.firstChild);
        }
        col.querySelector("ul").insertBefore(el("li", "pass-new", year + " " + p.company + " " + stage), col.querySelector("ul").firstChild);
        return;
      }
      var cards = type === "방송" ? shows : agencies;
      var k = key(p.company);
      if (!cards[k]) {
        // a company new to the board: its own card at the front
        var li = el("li", "agency pass-new");
        li.appendChild(el("h4", null, p.company));
        li.appendChild(el("ul"));
        var grid = document.getElementById(type === "방송" ? "passShows" : "passAgencies");
        grid.insertBefore(li, grid.firstChild);
        cards[k] = li;
        if (!known[k]) { known[k] = 1; added[k] = 1; }
      }
      addLine(cards[k], line);
    });

    // that year's chips: years after 2025 get their own row above (newest first); 2025 adds to the built one
    var box = document.getElementById("passYears");
    Object.keys(years).sort().forEach(function (y) {
      var block = box.querySelector('[data-year="' + y + '"]');
      if (!block) {
        block = el("div", "pass-year");
        block.setAttribute("data-year", y);
        block.appendChild(el("h3", "scrap__sub", y + " 합격 소식"));
        block.appendChild(el("ul", "card__chips card__chips--light"));
        box.insertBefore(block, box.firstChild);
      }
      var chips = block.querySelector("ul"), have = {};
      chips.querySelectorAll("li").forEach(function (c) { have[key(c.textContent)] = 1; });
      years[y].forEach(function (name) {
        if (have[key(name)]) return;
        have[key(name)] = 1;
        chips.insertBefore(el("li", "pass-new", name), chips.firstChild);
      });
    });

    var total = document.querySelector("[data-pass-total]");
    var more = Object.keys(added).length;
    if (total && more) total.textContent = (Number(total.getAttribute("data-pass-total")) + more) + "곳+";
  });
})();
