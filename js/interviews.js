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
  function empty(text) { box.textContent = ""; box.appendChild(el("li", "news__empty", text)); }
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
