// 오디션 소식 (audition.html, results.html): posts the director writes in the admin page (or asks Claude to add)
// come from the audition_news table, the academy Instagram's posts from ig_posts; both go on top of each
// section, and the blog posts built into the page stay below.
(function () {
  if (!window.LeeshAPI || !LeeshAPI.enabled()) return;
  // the home icon stops wiggling once the news page has been opened (js/newsbadge.js)
  try { localStorage.setItem("leesh_news_seen", String(Date.now())); } catch (e) { /* private mode */ }
  var WD = ["일", "월", "화", "수", "목", "금", "토"];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function todayKst() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
  function days(from, to) { return Math.round((new Date(to + "T00:00:00Z") - new Date(from + "T00:00:00Z")) / 86400000); }
  function label(d) {
    var dt = new Date(d + "T00:00:00Z");
    return d.replace(/-/g, ".") + " (" + WD[dt.getUTCDay()] + ")";
  }

  function badge(p, today) {
    if (p.deadline && p.deadline >= today) {
      var n = days(today, p.deadline);
      return n === 0 ? "오늘 마감" : n > 30 ? Number(p.deadline.slice(5, 7)) + "/" + Number(p.deadline.slice(8)) + " 마감" : "마감 D-" + n;
    }
    if (p.kind !== "합격" && p.event_date && p.event_date >= today) {
      var m = days(today, p.event_date);
      return m === 0 ? "오늘" : "D-" + m;
    }
    if (p.created_at && days(p.created_at.slice(0, 10), today) <= 7) return "NEW";
    return "";
  }
  function isPast(p, today) {
    if (p.deadline) return p.deadline < today;
    return p.kind !== "합격" && !!p.event_date && p.event_date < today;
  }

  function card(p, today) {
    var li = el("li"), box = el("details", "news__card news__card--own");
    var sum = el("summary");
    sum.appendChild(el("time", null, label(p.event_date || String(p.created_at || today).slice(0, 10))));
    var what = el("span", "news__what");
    if (p.company) { what.appendChild(el("b", null, p.company)); what.appendChild(document.createTextNode(" ")); }
    what.appendChild(document.createTextNode(p.title));
    sum.appendChild(what);
    var b = badge(p, today);
    sum.appendChild(el("span", "news__badge" + (b ? "" : " is-empty"), b || "＋"));
    box.appendChild(sum);
    var body = el("div", "news__body");
    if (p.deadline) body.appendChild(el("p", "news__meta", "접수 마감 " + label(p.deadline)));
    if (p.body) body.appendChild(el("p", "news__text", p.body));
    if (p.image) {
      var img = el("img", "news__poster");
      img.src = LeeshAPI.storage.newsUrl(p.image);
      img.alt = (p.company ? p.company + " " : "") + p.title + " 포스터";
      img.loading = "lazy";
      body.appendChild(img);
    }
    if (p.link) {
      var a = el("a", "news__link", "자세히 보기 ↗");
      a.href = p.link;
      a.target = "_blank";
      a.rel = "noopener";
      body.appendChild(a);
    }
    box.appendChild(body);
    li.appendChild(box);
    return li;
  }

  /* 인스타그램에서 가져온 글 (ig_posts): each section's own kind, newest first, as post links like the blog posts.
     Once there are any, the embedded Instagram box steps aside and 학원 소식 shows. */
  var IG_SHOW = 6;
  function igTitle(c) {
    var line = String(c || "").split("\n").map(function (x) { return x.replace(/#\S+/g, "").trim(); }).filter(Boolean)[0] || "인스타그램 소식";
    return line.length > 70 ? line.slice(0, 70) + "…" : line;
  }
  function igCard(p) {
    var li = el("li"), a = el("a", "news__card");
    a.href = "post.html?ig=" + encodeURIComponent(p.id);
    var day = new Date(new Date(p.posted_at).getTime() + 9 * 3600000).toISOString().slice(0, 10);
    var t = el("time", null, day.replace(/-/g, "."));
    t.setAttribute("datetime", day);
    a.appendChild(t);
    var what = el("span", "news__what");
    what.appendChild(el("span", "news__src", "Instagram"));
    what.appendChild(document.createTextNode(" " + igTitle(p.caption)));
    a.appendChild(what);
    var go = el("span", "news__go", "→");
    go.setAttribute("aria-hidden", "true");
    a.appendChild(go);
    li.appendChild(a);
    return li;
  }
  LeeshAPI.request("/rest/v1/ig_posts?select=id,posted_at,caption,kind&order=posted_at.desc&limit=300", {
    headers: LeeshAPI.headers()
  }).then(function (res) {
    if (!res.ok || !Array.isArray(res.data) || !res.data.length) return;
    var box = document.querySelector(".news__insta");
    if (box) box.hidden = true;
    document.querySelectorAll("[data-news]").forEach(function (sec) {
      var kind = sec.getAttribute("data-news");
      var mine = res.data.filter(function (p) { return p.kind === kind; });
      if (!mine.length) return;
      sec.hidden = false;
      var empty = sec.querySelector(".news__empty");
      if (empty) empty.hidden = true;
      var ul = el("ul", "news__list news__list--ig");
      mine.slice(0, IG_SHOW).forEach(function (p) { ul.appendChild(igCard(p)); });
      var first = sec.querySelector(".news__list, .news__more, .news__empty");
      sec.insertBefore(ul, first);
      if (mine.length > IG_SHOW) {
        var more = el("details", "news__more");
        more.appendChild(el("summary", null, "인스타그램 소식 " + (mine.length - IG_SHOW) + "개 더 보기"));
        var rest = el("ul", "news__list");
        mine.slice(IG_SHOW).forEach(function (p) { rest.appendChild(igCard(p)); });
        more.appendChild(rest);
        sec.insertBefore(more, ul.nextSibling);
      }
    });
  });

  LeeshAPI.request("/rest/v1/audition_news?select=*&published=eq.true&order=event_date.desc.nullslast,created_at.desc", {
    headers: LeeshAPI.headers()
  }).then(function (res) {
    if (!res.ok || !Array.isArray(res.data) || !res.data.length) return;
    var today = todayKst();
    document.querySelectorAll("[data-news]").forEach(function (sec) {
      var kind = sec.getAttribute("data-news");
      var mine = res.data.filter(function (p) { return p.kind === kind; });
      if (!mine.length) return;
      var now = mine.filter(function (p) { return !isPast(p, today); });
      var past = mine.filter(function (p) { return isPast(p, today); });
      var anchor = sec.querySelector(".news__list, .news__empty");
      var empty = sec.querySelector(".news__empty");
      if (now.length) {
        // soonest first for what is still coming up
        now.sort(function (x, y) { return (x.deadline || x.event_date || "9") < (y.deadline || y.event_date || "9") ? -1 : 1; });
        if (kind === "합격") now.reverse();
        var ul = el("ul", "news__list news__list--own");
        now.forEach(function (p) { ul.appendChild(card(p, today)); });
        sec.insertBefore(ul, anchor);
      }
      if (past.length) {
        var more = sec.querySelector(".news__more");
        if (!more) {
          more = el("details", "news__more");
          more.appendChild(el("summary", null, "지난 소식 더 보기"));
          more.appendChild(el("ul", "news__list"));
          var after = sec.querySelector(".news__list:not(.news__list--own)") || anchor;
          sec.insertBefore(more, after ? after.nextSibling : null);
        }
        var list = more.querySelector(".news__list");
        past.forEach(function (p) { list.insertBefore(card(p, today), list.firstChild); });
      }
      if (empty && now.length) empty.hidden = true;
    });
  });
})();
