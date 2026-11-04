// 합격자 인터뷰 (interview.html, 원장님 2026-11-04): 관리자 → 오디션 소식 → 합격자 인터뷰에서 올린 글 (public.interviews).
// 카드마다 회사 · 단계 · 이니셜, 선곡 · 꿀팁 · 스타일링, 영상(유튜브는 화면 안에서, 인스타는 링크). 주소 끝 #iv-<번호>면 그 카드로.
(function () {
  var box = document.getElementById("interviewList");
  if (!box) return;
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function youtube(url) {
    var m = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/.exec(url || "");
    return m ? m[1] : "";
  }
  function part(card, label, text) {
    if (!text) return;
    var s = el("section", "iv-part");
    s.appendChild(el("h3", "iv-part__k", label));
    s.appendChild(el("p", "iv-part__v", text));
    card.appendChild(s);
  }
  // 합격생 인터뷰 영상 (원장님 2026-11-04, 드라이브 "인터뷰영상모음" → assets/interviews/, data/interview_videos.json):
  // 제목 없이 표지만 늘어놓고, 누르면 크게 재생. 영상이 있으면 아래 글 목록이 비어도 "곧 올라옵니다"를 안 씀.
  var base = (window.LEESH && window.LEESH.blogBase) || "", hasVideos = false, listEmpty = false;
  function videos(list) {
    var sec = document.getElementById("ivVideos");
    if (!sec || !list.length) return;
    hasVideos = true;
    if (listEmpty) box.hidden = true;
    sec.hidden = false;
    sec.appendChild(el("h2", "ivv__h", "합격생 인터뷰 영상"));
    sec.appendChild(el("p", "ivv__note", "보고 싶은 영상을 눌러 주세요."));
    var grid = el("div", "ivv__grid");
    list.forEach(function (v, i) {
      var b = el("button", "ivv__tile");
      b.type = "button";
      b.setAttribute("aria-label", "인터뷰 영상 " + (i + 1) + " 보기");
      if (v.poster) {
        var img = el("img");
        img.src = base + v.poster;
        img.alt = "";
        img.loading = "lazy";
        b.appendChild(img);
      }
      b.appendChild(el("span", "ivv__play", "▶"));
      if (v.sec) b.appendChild(el("span", "ivv__time", Math.floor(v.sec / 60) + ":" + ("0" + (v.sec % 60)).slice(-2)));
      b.addEventListener("click", function () { play(list, i); });
      grid.appendChild(b);
    });
    sec.appendChild(grid);
  }
  function play(list, i) {
    var back = el("div", "ivv-pop"), boxv = el("div", "ivv-pop__box");
    boxv.setAttribute("role", "dialog");
    boxv.setAttribute("aria-modal", "true");
    boxv.setAttribute("aria-label", "인터뷰 영상");
    var vid = el("video", "ivv-pop__video");
    vid.controls = true;
    vid.playsInline = true;
    vid.setAttribute("playsinline", "");
    vid.setAttribute("controlsList", "nodownload");
    var bar = el("div", "ivv-pop__bar");
    var prev = el("button", "ivv-pop__btn", "‹ 이전"), next = el("button", "ivv-pop__btn", "다음 ›"), close = el("button", "ivv-pop__btn ivv-pop__btn--x", "닫기 ✕");
    [prev, next, close].forEach(function (x) { x.type = "button"; });
    var count = el("span", "ivv-pop__n");
    bar.appendChild(prev); bar.appendChild(count); bar.appendChild(next); bar.appendChild(close);
    function load(k) {
      i = (k + list.length) % list.length;
      var v = list[i];
      vid.poster = v.poster ? base + v.poster : "";
      vid.src = base + v.file;
      boxv.classList.toggle("is-tall", v.h > v.w);
      count.textContent = (i + 1) + " / " + list.length;
      var p = vid.play();
      if (p && p.catch) p.catch(function () { /* 소리 자동 재생이 막히면 ▶를 눌러서 */ });
    }
    function done() {
      vid.pause();
      vid.removeAttribute("src");
      document.removeEventListener("keydown", key);
      document.body.classList.remove("ivv-open");
      if (back.parentNode) back.parentNode.removeChild(back);
    }
    function key(e) {
      if (e.key === "Escape") done();
      else if (e.key === "ArrowLeft") load(i - 1);
      else if (e.key === "ArrowRight") load(i + 1);
    }
    prev.addEventListener("click", function () { load(i - 1); });
    next.addEventListener("click", function () { load(i + 1); });
    close.addEventListener("click", done);
    vid.addEventListener("ended", function () { if (i < list.length - 1) load(i + 1); });
    back.addEventListener("click", function (e) { if (e.target === back) done(); });
    document.addEventListener("keydown", key);
    boxv.appendChild(vid);
    boxv.appendChild(bar);
    if (list.length < 2) { prev.hidden = true; next.hidden = true; }
    back.appendChild(boxv);
    document.body.appendChild(back);
    document.body.classList.add("ivv-open");
    close.focus();
    load(i);
  }
  fetch(base + "data/interview_videos.json", { cache: "no-cache" }).then(function (r) { return r.json(); }).then(function (d) {
    videos((d.videos || []).filter(function (v) { return v.file; }));
  }).catch(function () { /* 영상 목록이 없으면 글만 */ });
  function empty(text) {
    listEmpty = true;
    box.textContent = "";
    box.appendChild(el("li", "news__empty", text));
    if (hasVideos) box.hidden = true;
  }
  if (!window.LeeshAPI || !LeeshAPI.enabled()) { empty("곧 올라옵니다."); return; }
  LeeshAPI.request("/rest/v1/interviews?select=*&published=eq.true&order=posted_on.desc,id.desc&limit=100", {
    headers: LeeshAPI.headers()
  }).then(function (res) {
    if (!res.ok || !Array.isArray(res.data)) { empty("불러오지 못했습니다. 잠시 뒤 새로고침해 주세요."); return; }
    if (!res.data.length) { empty("곧 올라옵니다."); return; }
    box.textContent = "";
    res.data.forEach(function (p) {
      var li = el("li", "iv-card");
      li.id = "iv-" + p.id;
      if (p.image) {
        var img = el("img", "iv-card__img");
        img.src = LeeshAPI.storage.newsUrl(p.image);
        img.alt = "";
        img.loading = "lazy";
        li.appendChild(img);
      }
      var top = el("p", "iv-card__tags");
      top.appendChild(el("span", "iv-tag iv-tag--co", p.company));
      if (p.stage) top.appendChild(el("span", "iv-tag", p.stage));
      if (p.initials) top.appendChild(el("span", "iv-tag", p.initials));
      li.appendChild(top);
      li.appendChild(el("h2", "iv-card__title", p.title));
      li.appendChild(el("time", "iv-card__date", String(p.posted_on || "").replace(/-/g, ".")));
      part(li, "선곡", p.songs);
      part(li, "오디션 꿀팁", p.tips);
      part(li, "스타일링", p.styling);
      if (p.body) li.appendChild(el("p", "iv-card__body", p.body));
      var yt = youtube(p.video);
      if (yt) {
        var f = el("iframe", "iv-card__video");
        f.src = "https://www.youtube-nocookie.com/embed/" + yt;
        f.title = p.title;
        f.loading = "lazy";
        f.allow = "accelerometer; encrypted-media; gyroscope; picture-in-picture";
        f.setAttribute("allowfullscreen", "");
        li.appendChild(f);
      } else if (p.video) {
        var a = el("a", "pill-btn iv-card__link", /instagram\.com/.test(p.video) ? "인스타그램에서 영상 보기 ↗" : "영상 보기 ↗");
        a.href = p.video;
        a.target = "_blank";
        a.rel = "noopener";
        li.appendChild(a);
      }
      box.appendChild(li);
    });
    if (/^#iv-\d+$/.test(location.hash)) {
      var t = document.getElementById(location.hash.slice(1));
      if (t) t.scrollIntoView({ block: "start" });
    }
  });
})();
