// 첫 화면 팝업 (원장님 2026-11-04): "합격자 인터뷰 보러가기" — 올라간 인터뷰(public.interviews)가 있을 때만.
// 닫기 = 이번 방문 동안 안 뜸, 다시 보지 않기 = 이 기기에서 계속 안 뜸. 화면이 켜지는 첫 애니메이션이 끝난 뒤에 떠요.
(function () {
  var KEY = "leesh_popup_interview", SKEY = "leesh_popup_closed";
  function get(store, k) { try { return window[store].getItem(k); } catch (e) { return null; } }
  function set(store, k, v) { try { window[store].setItem(k, v); } catch (e) { /* 사생활 보호 창 */ } }
  if (get("localStorage", KEY) || get("sessionStorage", SKEY) || location.hash) return;
  if (!window.LeeshAPI || !LeeshAPI.enabled()) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  // 위쪽 그림 = 대형 기획사 4곳 (원장님 2026-11-04 "YG, HYBE, SM, JYP 로고"). 로고 파일(img)을 받으면 assets/img/logos/에 넣고
  // img에 주소를 적으면 그림으로, 비어 있으면 이름 글자 칸으로 보여요.
  var LOGOS = [
    { name: "YG", img: "" },
    { name: "HYBE", img: "" },
    { name: "SM", img: "" },
    { name: "JYP", img: "" }
  ];

  function show() {
    var back = el("div", "pop");
    var box = el("div", "pop__box");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-labelledby", "popTitle");
    var pics = el("div", "pop__pics");
    pics.setAttribute("aria-label", LOGOS.map(function (l) { return l.name; }).join(" · "));
    LOGOS.forEach(function (l, i) {
      var tile = el("span", "pop__logo pop__logo--" + i);
      if (l.img) {
        var img = el("img");
        img.src = l.img;
        img.alt = l.name;
        tile.appendChild(img);
      } else tile.textContent = l.name;
      pics.appendChild(tile);
    });
    box.appendChild(pics);
    var h = el("h2", "pop__title", "📣 합격자 인터뷰 보러가기!");
    h.id = "popTitle";
    box.appendChild(h);
    var p = el("p", "pop__text");
    ["대형 · 유명 기획사", "합격생의 선곡, 꿀팁, 스타일링을", "바로 보러가요!! 🌈"].forEach(function (line, i) {
      if (i) p.appendChild(document.createElement("br"));
      p.appendChild(document.createTextNode(line));
    });
    box.appendChild(p);
    var row = el("div", "pop__btns");
    var close = el("button", "pop__btn", "닫기");
    close.type = "button";
    var go = el("a", "pop__btn pop__btn--go", "인터뷰 보러 가기");
    go.href = "interview.html";
    row.appendChild(close);
    row.appendChild(go);
    box.appendChild(row);
    var never = el("button", "pop__never", "다시 보지 않기");
    never.type = "button";
    box.appendChild(never);
    back.appendChild(box);

    function done(forever) {
      set(forever ? "localStorage" : "sessionStorage", forever ? KEY : SKEY, "1");
      document.removeEventListener("keydown", key);
      if (back.parentNode) back.parentNode.removeChild(back);
    }
    function key(e) { if (e.key === "Escape") done(false); }
    close.addEventListener("click", function () { done(false); });
    never.addEventListener("click", function () { done(true); });
    go.addEventListener("click", function () { set("sessionStorage", SKEY, "1"); });
    back.addEventListener("click", function (e) { if (e.target === back) done(false); });
    document.addEventListener("keydown", key);
    document.body.appendChild(back);
    go.focus();
  }

  // 화면이 켜지는 애니메이션(#boot, 첫 방문)이 끝난 뒤에
  function whenReady(fn) {
    var tries = 0;
    (function wait() {
      var boot = document.getElementById("boot");
      if (!boot || getComputedStyle(boot).visibility === "hidden" || ++tries > 40) setTimeout(fn, 500);
      else setTimeout(wait, 250);
    })();
  }

  LeeshAPI.request("/rest/v1/interviews?select=id&published=eq.true&limit=1", { headers: LeeshAPI.headers() }).then(function (res) {
    if (res.ok && Array.isArray(res.data) && res.data.length) whenReady(show);
  });
})();
