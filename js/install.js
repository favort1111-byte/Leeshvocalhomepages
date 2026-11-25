/* 홈 화면에 추가 (원장님 2026-11-25 "크롬에서 바로가기 만들기 말고 홈페이지에서 클릭으로"):
   - 안드로이드 크롬 · 삼성 인터넷 · PC 크롬 = 버튼 한 번 → 브라우저의 "앱 설치" 창 (beforeinstallprompt)
   - 아이폰 = 애플이 버튼으로 바로 추가하는 걸 막아 둠 → 공유 → 홈 화면에 추가 안내 창
   - 카카오톡 · 인스타 안 = 바로 추가가 안 됨 → 크롬 · 사파리로 열기 (카카오톡은 버튼으로 바로)
   버튼: [data-install] 아무 곳에나. 첫 화면은 휴대폰에서만 아래쪽 작은 띠 (✕ 누르면 이 기기에선 다시 안 뜸). */
(function () {
  var HIDE = "leesh_install_hide";
  var ua = navigator.userAgent || "";
  var ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var android = /Android/i.test(ua);
  var kakao = /KAKAOTALK/i.test(ua);
  var inapp = kakao || /Instagram|FBAN|FBAV|NAVER\(inapp|Line\/|DaumApps|everytimeApp|; wv\)/i.test(ua);
  var samsung = /SamsungBrowser/i.test(ua);
  var iosOther = ios && /CriOS|FxiOS|EdgiOS|Whale|NAVER/i.test(ua);
  var deferred = null;

  function standalone() {
    return (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  }
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  // 안드로이드가 앱 설치를 허락하려면 서비스 워커가 있어야 함. 실제 주소에서만 (미리보기 · 내 컴퓨터 파일 제외)
  if ("serviceWorker" in navigator && location.protocol === "https:" && /(^|\.)leeshlesson\.com$|\.github\.io$/.test(location.hostname)) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }

  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferred = e; });
  window.addEventListener("appinstalled", function () {
    deferred = null; set(HIDE, "1"); dropBar();
    toast("홈 화면에 추가했어요 · 이제 아이콘으로 바로 열려요");
  });

  function el(tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }
  function toast(t) {
    var n = el("div", "inst__toast", t); document.body.appendChild(n);
    setTimeout(function () { n.classList.add("is-out"); }, 3200);
    setTimeout(function () { n.remove(); }, 3800);
  }

  function steps() {
    if (standalone()) return { title: "이미 앱으로 열려 있어요", list: ["홈 화면의 <b>이송희보컬레슨</b> 아이콘으로 열린 상태예요."] };
    if (inapp) return {
      title: (kakao ? "카카오톡" : "이 앱") + " 안에서는 바로 추가가 안 돼요",
      lede: "먼저 " + (ios ? "사파리로" : "크롬으로") + " 열어 주세요. 열린 화면에서 이 버튼을 한 번 더 누르면 돼요.",
      list: kakao
        ? ["아래 <b>" + (ios ? "사파리로" : "크롬으로") + " 열기</b> 누르기", "(안 되면) 오른쪽 " + (ios ? "아래" : "위") + " <b>⋮</b> 또는 <b>공유</b> → <b>다른 브라우저로 열기</b>"]
        : ["오른쪽 위 <b>⋮</b> 또는 <b>⋯</b> → <b>다른 브라우저로 열기</b> (또는 <b>" + (ios ? "Safari" : "Chrome") + "로 열기</b>)"],
      open: kakao
    };
    if (ios) return {
      title: "아이폰은 이렇게 추가해요",
      lede: "애플이 버튼으로 바로 추가하는 걸 막아 둬서, 세 번만 눌러 주세요." + (iosOther ? " (안 보이면 <b>사파리</b>로 열어서)" : ""),
      list: ["화면 아래(또는 위)의 <b>공유 버튼 <span class=\"inst__ico\">□↑</span></b> 누르기 — 안 보이면 오른쪽 아래 <b>⋯</b>을 먼저",
        "목록을 아래로 내려 <b>홈 화면에 추가 <span class=\"inst__ico\">⊞</span></b> 누르기",
        "오른쪽 위 <b>추가</b> 누르기"]
    };
    if (samsung) return {
      title: "삼성 인터넷은 이렇게 추가해요",
      list: ["아래 <b>≡</b> (메뉴) 누르기", "<b>현재 페이지 추가</b> → <b>홈 화면</b>", "<b>추가</b> 누르기"]
    };
    if (android) return {
      title: "크롬은 이렇게 추가해요",
      lede: "이미 추가했다면 홈 화면에서 <b>이송희보컬레슨</b> 아이콘을 찾아 주세요.",
      list: ["오른쪽 위 <b>⋮</b> 누르기", "<b>홈 화면에 추가</b> (또는 <b>앱 설치</b>) 누르기", "<b>설치</b> 또는 <b>추가</b> 누르기"]
    };
    return {
      title: "휴대폰에서 열어 주세요",
      lede: "컴퓨터에서는 주소창 오른쪽의 <b>설치 ⊕</b> 아이콘으로 바탕화면에 추가할 수 있어요.",
      list: ["휴대폰으로 <b>leeshlesson.com</b> 열기", "첫 화면 아래 <b>📲 홈 화면에 추가</b> 또는 홈페이지 사용법 7번 버튼 누르기"]
    };
  }

  function sheet() {
    var s = steps();
    var box = el("div", "inst__wrap");
    var card = el("div", "inst__card");
    card.setAttribute("role", "dialog"); card.setAttribute("aria-label", s.title);
    card.innerHTML = '<img class="inst__app" src="assets/img/icon-192.png" alt="">'
      + "<h2>" + s.title + "</h2>" + (s.lede ? "<p>" + s.lede + "</p>" : "")
      + "<ol>" + s.list.map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ol>";
    if (s.open) {
      var o = el("a", "inst__go", (ios ? "사파리로" : "크롬으로") + " 열기");
      o.href = "kakaotalk://web/openExternal?url=" + encodeURIComponent(location.href);
      card.appendChild(o);
    }
    var x = el("button", "inst__close", "닫기"); x.type = "button";
    card.appendChild(x);
    box.appendChild(card); document.body.appendChild(box);
    function close() { box.remove(); document.removeEventListener("keydown", esc); }
    function esc(e) { if (e.key === "Escape") close(); }
    x.onclick = close;
    box.addEventListener("click", function (e) { if (e.target === box) close(); });
    document.addEventListener("keydown", esc);
    x.focus();
  }

  function go() {
    if (deferred && !standalone()) {
      var d = deferred; deferred = null;
      d.prompt();
      (d.userChoice || Promise.resolve({})).then(function (r) {
        if (r && r.outcome === "accepted") { set(HIDE, "1"); dropBar(); }
      });
      return;
    }
    sheet();
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-install]");
    if (!b) return;
    e.preventDefault(); go();
  });

  // 첫 화면 휴대폰 띠
  var bar = null;
  function dropBar() { if (bar) { bar.remove(); bar = null; } }
  function phone() { return (window.matchMedia && matchMedia("(pointer: coarse)").matches) || ios || android; }
  if (document.body && document.body.getAttribute("data-page") === "index" && phone() && !standalone() && !get(HIDE)) {
    var tries = 0;
    setTimeout(function show() {
      if (standalone() || get(HIDE)) return;
      // 인터뷰 팝업 · 다른 창이 떠 있으면 닫힐 때까지 기다림 (3초마다, 2분까지)
      if (document.querySelector('[aria-modal="true"]') && ++tries < 40) { setTimeout(show, 3000); return; }
      bar = el("div", "inst__bar");
      bar.innerHTML = '<img src="assets/img/icon-192.png" alt=""><span><b>홈 화면에 추가</b>하면 앱처럼 바로 열려요</span>'
        + '<button type="button" class="inst__add" data-install>추가하기</button>'
        + '<button type="button" class="inst__x" aria-label="닫기">✕</button>';
      bar.querySelector(".inst__x").onclick = function () { set(HIDE, "1"); dropBar(); };
      document.body.appendChild(bar);
    }, 4500);
  }

  window.LeeshInstall = { open: go, standalone: standalone };
})();
