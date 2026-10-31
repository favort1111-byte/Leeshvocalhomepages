// 월말평가 리포트 카드 하나 (학생 내 폴더 js/mynotes.js 와 관리자 "학생에게 보이는 모양 보기" js/admin.js 가 같이 씀,
// 원장님 2026-10-31: 관리자에서도 학생 화면과 똑같이 다시 보기). 점수 4개 (각 10점) + 총점 단계 + 원장님이 올린 평가지 사진.
(function () {
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  var ITEMS = [["basic", "기본기"], ["technique", "보컬 테크닉"], ["acting", "액팅"], ["styling", "스타일링"]];
  var LEVELS = (window.LEESH || {}).evalLevels || [];
  function level(total) {
    for (var i = 0; i < LEVELS.length; i++) if (total >= LEVELS[i][0]) return { at: i, min: LEVELS[i][0], name: LEVELS[i][1], say: LEVELS[i][2], next: LEVELS[i - 1] };
    return null;
  }
  function num(v) { return v == null ? null : Number(v); }
  function fmt(v) { return String(Math.round(v * 10) / 10); }

  // r = eval_reports 한 줄, prev = 그 전 평가 (항목 옆 ▲▼), pages(holder) = 평가지 칸을 채우는 함수
  function card(r, prev, pages) {
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
      var holder = el("div", "evalr__pages");
      card.appendChild(holder);
      pages(holder);
    }
    card.appendChild(el("p", "evalr__secret", "평가지는 대외비예요. 캡처해서 다른 곳에 올리지 말아주세요."));
    return card;
  }

  // urls = Promise<[주소…]> (쪽 순서대로). 누르면 크게 보기
  function showPages(holder, urls) {
    holder.textContent = "";
    holder.appendChild(el("p", "sys-note", "평가지 불러오는 중…"));
    urls.then(function (list) {
      holder.textContent = "";
      list.forEach(function (u, k) {
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

  window.LeeshEvalCard = { card: card, pages: showPages, zoom: zoom, items: ITEMS, num: num, fmt: fmt };
})();
