// post.html?id=<글 번호>: one post moved over from the old Naver blog (tools/import_blog.py → data/blog/posts/<id>.json).
// post.html?ig=<인스타 글 번호>: one post of the academy Instagram (ig_posts in Supabase, pictures copied to assets/ig/).
(function () {
  var box = document.getElementById("post");
  if (!box) return;
  var id = (/[?&]id=(\d+)/.exec(location.search) || [])[1];
  var ig = (/[?&]ig=(\w+)/.exec(location.search) || [])[1];
  var KIND = {
    visit: ["학원 내방 오디션", "audition.html", "audition"], audition: ["기획사 오디션 정보", "audition.html", "audition"],
    results: ["합격자 현황", "results.html", "audition"], tips: ["원포인트 레슨", "tips.html", "about"],
    curriculum: ["커리큘럼", "tips.html#academy", "about"], academy: ["학원 이야기", "tips.html#academy", "about"],
    school: ["학원 소식", "audition.html#news-school", "audition"]
  };
  var IG_KIND = { "내방": "visit", "오디션": "audition", "합격": "results", "소식": "school" };
  var WD = ["일", "월", "화", "수", "목", "금", "토"];
  // the private preview can't hold 800 posts, so it reads them from the published copy (tools/build_preview.py)
  var BASE = (window.LEESH || {}).blogBase || "";

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  /** Text with its web addresses as links. */
  function linked(text) {
    var span = document.createDocumentFragment(), re = /(https?:\/\/[^\s)]+)/g, at = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > at) span.appendChild(document.createTextNode(text.slice(at, m.index)));
      var a = el("a", null, m[1].replace(/^https?:\/\//, "").slice(0, 60));
      a.href = m[1];
      a.target = "_blank";
      a.rel = "noopener";
      span.appendChild(a);
      at = m.index + m[1].length;
    }
    span.appendChild(document.createTextNode(text.slice(at)));
    return span;
  }
  function para(lines, tag) {
    // empty lines split paragraphs; the rest keep their line breaks
    var out = document.createDocumentFragment(), cur = null;
    lines.forEach(function (line) {
      if (!line) { cur = null; return; }
      if (!cur) { cur = el(tag || "p"); out.appendChild(cur); } else cur.appendChild(el("br"));
      cur.appendChild(linked(line));
    });
    return out;
  }
  function youtube(vid) {
    var b = el("button", "post__yt");
    b.type = "button";
    b.setAttribute("aria-label", "영상 재생");
    var img = el("img");
    img.src = "https://i.ytimg.com/vi/" + vid + "/hqdefault.jpg";
    img.alt = "";
    img.loading = "lazy";
    b.appendChild(img);
    b.appendChild(el("span", "post__play", "▶"));
    b.addEventListener("click", function () {
      var f = el("iframe", "post__ytframe");
      f.src = "https://www.youtube-nocookie.com/embed/" + vid + "?autoplay=1";
      f.title = "유튜브 영상";
      f.allow = "autoplay; encrypted-media; picture-in-picture";
      f.allowFullscreen = true;
      b.replaceWith(f);
    });
    return b;
  }
  function zoom(src, alt) {
    var ov = el("div", "evalr__zoom");
    var close = el("button", "evalr__close", "✕ 닫기");
    close.type = "button";
    var img = el("img");
    img.src = src;
    img.alt = alt;
    ov.appendChild(close);
    ov.appendChild(img);
    close.addEventListener("click", function () { ov.remove(); });
    document.body.appendChild(ov);
    close.focus();
  }

  function render(p) {
    var k = KIND[p.kind] || KIND.academy;
    document.title = p.title + " | 이송희보컬레슨";
    document.querySelectorAll(".nav a").forEach(function (a) {
      if (a.textContent.trim() === k[2]) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    box.textContent = "";
    var back = el("a", "post__back", "← " + k[0]);
    back.href = k[1];
    box.appendChild(back);
    var dt = new Date(p.date + "T00:00:00Z");
    box.appendChild(el("p", "post__date", p.date.replace(/-/g, ".") + " (" + WD[dt.getUTCDay()] + ") · " + k[0]));
    box.appendChild(el("h1", "post__title", p.title.replace(/^\[[^\]]*보컬\s*레슨\]\s*/, "")));
    if (p.kind === "results" && p.stages && p.stages.length) {
      var card = el("div", "post__pass");
      card.appendChild(el("p", "post__company", p.company));
      p.stages.forEach(function (s) {
        var row = el("p");
        row.appendChild(el("b", null, s.stage));
        if (s.names.length) row.appendChild(document.createTextNode(" " + s.names.join(", ")));
        card.appendChild(row);
      });
      box.appendChild(card);
    }
    var body = el("div", "post__body");
    p.blocks.forEach(function (b) {
      if (b.t === "p") body.appendChild(para(b.lines));
      else if (b.t === "quote") { var q = el("blockquote"); q.appendChild(para(b.lines)); body.appendChild(q); }
      else if (b.t === "img") {
        var fig = el("button", "post__img");
        fig.type = "button";
        var img = el("img");
        img.src = BASE + b.src;
        img.alt = p.title + " 사진";
        img.loading = "lazy";
        // an Instagram picture not copied yet: use Instagram's own link (b.alt) while it still works
        img.onerror = function () { if (b.alt && img.src !== b.alt) img.src = b.alt; else fig.remove(); };
        fig.appendChild(img);
        fig.addEventListener("click", function () { zoom(img.src, img.alt); });
        body.appendChild(fig);
      } else if (b.t === "yt") body.appendChild(youtube(b.id));
      else if (b.t === "link") {
        var a = el("a", "post__link", (b.title || b.url) + (/^post\.html/.test(b.url) ? " →" : " ↗"));
        a.href = b.url;
        if (!/^post\.html/.test(b.url)) { a.target = "_blank"; a.rel = "noopener"; }
        body.appendChild(a);
      } else if (b.t === "hr") body.appendChild(el("hr"));
      else if (b.t === "table") {
        var t = el("table", "post__table");
        b.rows.forEach(function (r) { var tr = el("tr"); r.forEach(function (c) { tr.appendChild(el("td", null, c)); }); t.appendChild(tr); });
        body.appendChild(t);
      }
    });
    box.appendChild(body);
    var foot = el("p", "news__foot");
    if (p.kind === "visit") {  // 학원 내방 오디션 글: the application form (apply.html)
      var apply = el("a", "pill-btn news__applybtn", "내방 오디션 신청하기");
      apply.href = "apply.html";
      foot.appendChild(apply);
    }
    var list = el("a", "pill-btn", "목록으로");
    list.href = k[1];
    var ask = el("a", "pill-btn", "상담 신청하기");
    ask.href = "consult.html";
    foot.appendChild(list);
    foot.appendChild(ask);
    box.appendChild(foot);
  }

  /* An Instagram post in the same shape as a blog post: first line = title, the rest = text, every picture.
     Pictures come from assets/ig/<id>/<n>.webp once copied (Instagram's own links run out after a while). */
  // The academy posts the same poster several times (3 in a row for the grid) and makes promo reels with the
  // same text: tools/ig_images.py fingerprints every copied picture, and a poster shows only once.
  function bitsApart(a, b) {
    var n = 0;
    for (var i = 0; i < a.length; i++) for (var x = parseInt(a[i], 16) ^ parseInt(b[i], 16); x; x >>= 1) n += x & 1;
    return n;
  }
  // group: the posts with the same text (a month's 내방 오디션 posters), newest first; fp: the fingerprints
  function fromInstagram(p, group, fp) {
    // body/title are cleaned by the database (private.ig_clean: no promo block, hashtags or divider lines)
    var lines = String(p.body != null ? p.body : p.caption || "").split("\n").map(function (x) { return x.replace(/#\S+/g, "").trim(); });
    var first = p.title || lines.filter(Boolean)[0] || "학원 소식";
    var at = lines.indexOf(first);
    var title = first.replace(/^(?:[\u2190-\u2bff\u2600-\u27bf\ufe0f\u200d\u20e3]|[\ud83c-\udbff][\udc00-\udfff]|\s)+|(?:[\u2190-\u2bff\u2600-\u27bf\ufe0f\u200d\u20e3]|[\ud83c-\udbff][\udc00-\udfff]|\s)+$/g, "") || first;
    var rest = at === -1 ? lines : lines.slice(at + 1);
    var blocks = [], seen = {}, shown = [];
    var list = group && group.length ? group : [p];
    // posters first: when the group has photo posts, the reels' cover frames stay out
    if (list.some(function (g) { return g.media_type && g.media_type !== "VIDEO"; })) list = list.filter(function (g) { return g.media_type !== "VIDEO"; });
    list.forEach(function (g) {
      (g.images || []).forEach(function (u, i) {
        var h = (fp || {})[g.id + "/" + (i + 1)];
        if (!u || seen[u] || (h && shown.some(function (s) { return bitsApart(s, h) <= 12; }))) return;
        seen[u] = 1;
        if (h) shown.push(h);
        blocks.push({ t: "img", src: "assets/ig/" + g.id + "/" + (i + 1) + ".webp", alt: u });
      });
    });
    blocks.push({ t: "p", lines: rest });
    if (p.permalink) blocks.push({ t: "link", url: p.permalink, title: p.media_type === "VIDEO" ? "▶ 인스타그램에서 영상 보기" : "인스타그램에서 보기" });
    var day = new Date(new Date(p.posted_at).getTime() + 9 * 3600000).toISOString().slice(0, 10);
    return { kind: IG_KIND[p.kind] || "school", title: title, date: day, blocks: blocks };
  }

  if (ig) {
    LeeshAPI.request("/rest/v1/ig_posts?select=*&id=eq." + encodeURIComponent(ig), { headers: LeeshAPI.headers() }).then(function (res) {
      var p = res.ok && res.data && res.data[0];
      if (p && p.title) {
        return Promise.all([
          LeeshAPI.request("/rest/v1/ig_posts?select=id,images,media_type&order=posted_at.desc&limit=40&title=eq." + encodeURIComponent(p.title), { headers: LeeshAPI.headers() }),
          fetch(BASE + "data/ig_hashes.json").then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
        ]).then(function (r) { render(fromInstagram(p, r[0].ok ? r[0].data : null, r[1])); });
      }
      if (p) return render(fromInstagram(p));
      box.textContent = "";
      box.appendChild(el("p", "news__empty", "글을 찾을 수 없습니다."));
    });
    return;
  }
  if (!id) { box.appendChild(el("p", "news__empty", "글을 찾을 수 없습니다.")); return; }
  fetch(BASE + "data/blog/posts/" + id + ".json").then(function (r) { if (!r.ok) throw r; return r.json(); })
    .then(render, function () {
      box.textContent = "";
      box.appendChild(el("p", "news__empty", "글을 찾을 수 없습니다."));
      var a = el("a", "pill-btn", "오디션 소식으로");
      a.href = "audition.html";
      box.appendChild(a);
    });
})();
