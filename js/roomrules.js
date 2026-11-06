// 연습실 예약 및 이용 안내 (블로그 서로이웃 공지 "연습실 공지사항 (예약방법/WI-FI)" 2021.3.4, 원장님 2026-11-06 글 그대로).
// 내 폴더 → 일정·공지 → 공지 맨 아래 (접힘). 와이파이 비밀번호는 저장소가 공개라 여기 없음 → 펼칠 때 서버
// member_wifi(로그인한 수강생만)에서 받아 옴. window.LeeshRoomRules.box(loadWifi) — loadWifi()는 [{name, pass}] Promise.
(function () {
  var SOON = "📢 11월 16일 자정부터는 홈페이지에서 예약이 진행됩니다 !";
  var NAVER = "https://m.booking.naver.com/booking/10/bizes/435763";
  // [제목, [줄, …]] — 줄이 배열이면 [글, 작은 설명]
  var HOW = [
    ["1. 예약 가능 기간", [
      "연습실 예약은 이용 1일 전부터 당일까지 가능합니다.",
      "예시: 11월 11일 예약을 원할 경우, 11월 10일 0시부터 11월 11일 당일까지 예약 가능",
      "미리 예약 시 자동 취소되며, 3번 이상 위반 시 한 달간 연습 예약이 제한되니 유의해 주세요."]],
    ["2. 사전 예약 시간 제한", [
      "사전 예약은 최소 1시간부터 최대 4시간(C홀 포함)까지 가능합니다.",
      "당일 이용 중 추가 예약은 시간 제한 없이 가능하지만, 사전 예약은 최대 4시간까지이니 유의해 주세요.",
      "사전 예약 규정을 위반할 경우 자동 취소되며, 3번 이상 반복 시 한 달간 연습 예약이 제한됩니다."]]
  ];
  var PENALTY = [
    "이용 후 소등 및 시설, 장비 정리정돈이 미흡한 경우",
    "예약시간 20분이상 지각 또는 노쇼 (경고 3회 누적 시 패널티 부여 3개월 사용 불가)",
    "빈번한 예약 변경 및 취소",
    "오디션 연습, 보컬 연습 외 다른목적으로 개인사용 불가"
  ];
  var USE = [
    ["보컬 연습실 하루 최대 2시간 사용 후, 당일에는 추가 예약하여 사용 가능합니다!", "(ex. 미리 5시간 예약은 불가)"],
    ["연습실용 운동화 외 외부신발 및 워커, 힐 착용 금지", "(모든 연습실은 문 밖에 신발을 벗고 사용해야 하며, 외부에서 사용자 확인이 어려우므로 외부화를 연습실 안으로 가져가지 마세요.)"],
    ["보컬 연습실 사용 후, C Hall도 추가 예약하여 사용 가능합니다! (총 보컬룸 + C홀 4시간)", "(C Hall / 2시간 제한)"],
    ["오디션 연습, 보컬 연습 외 다른목적으로 개인사용은 불가합니다!", null],
    ["20분간 미사용 연습실 있을 경우 자유롭게 연습실 사용가능", null],
    ["1인 사용 제한", "※ 2인 이상 사용 시 학원 카카오톡 채널에 이용 사실을 알려주세요. (예: 카리나, 윈터 C홀 사용합니다!) ※ 두 분 모두 레슨생일 경우에만 최대 2인 사용이 가능합니다."],
    ["개인 소독 필수", null],
    ["이용 후 소등 및 시설, 장비 정리정돈 필수", null],
    ["퇴실 시 모든 창문, 모든 문 다 닫아주세요!", null],
    ["쓰레기통은 출입문에 있으니 퇴실할 때 각자 버려주세요", null]
  ];
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function list(tag, rows) {
    var ul = el(tag, "room__list");
    rows.forEach(function (r) {
      var li = el("li");
      if (Array.isArray(r)) { li.appendChild(document.createTextNode(r[0])); if (r[1]) li.appendChild(el("small", null, r[1])); }
      else li.textContent = r;
      ul.appendChild(li);
    });
    return ul;
  }
  function box(loadWifi) {
    var d = el("details", "apply__rules room__rules");
    var s = el("summary", "apply__rules-title", "📍 연습실 예약 및 이용 안내 (예약 방법 · WI-FI)");
    s.appendChild(el("span", "room__soon", SOON));
    d.appendChild(s);
    d.appendChild(el("p", "room__sub", "(연습실 B1~B5, C Hall)"));
    var p = el("p", "room__p");
    p.appendChild(document.createTextNode("▪️ 아래 링크 <네이버 예약>을 통해서 365일 24시간 예약 가능합니다! "));
    var a = el("a", null, "네이버 예약 열기");
    a.href = NAVER; a.target = "_blank"; a.rel = "noopener";
    p.appendChild(a);
    d.appendChild(p);
    d.appendChild(el("p", "room__soon room__soon--in", SOON));
    d.appendChild(el("p", "apply__rules-sub", "▪️ 예약 방법"));
    HOW.forEach(function (h) { d.appendChild(el("p", "room__h", h[0])); d.appendChild(list("ul", h[1])); });
    d.appendChild(el("p", "room__p", "📌 원활한 예약 운영과 공정한 이용을 위해 공지사항을 꼭 지켜주세요."));
    d.appendChild(el("p", "apply__rules-sub", "▪️ 패널티 제도 (3회 이상 적발 시 한 달간 연습실 예약 불가)"));
    var pen = list("ol", PENALTY); pen.classList.add("apply__red"); d.appendChild(pen);
    d.appendChild(el("p", "apply__rules-sub", "📍 연습실 이용 수칙"));
    d.appendChild(list("ul", USE));
    d.appendChild(el("p", "room__p", "연습실 내부의 기기 고장은 담임쌤께 개인 톡으로 바로 알려주세요! :) 다수의 연습실 사용은 기기 고장이 빈번합니다! 비용 청구하지 않으니 바로바로 알려주세요!"));
    d.appendChild(el("p", "room__p apply__red", "다만 고의적인 분실, 도난, 파손 시 배상 책임은 해당 사용자에게 있으니 유의하여 사용 부탁드립니다! (CCTV 확인)"));
    d.appendChild(el("p", "apply__rules-sub", "▫️ WIFI"));
    var w = el("div", "room__wifi");
    w.appendChild(el("p", "sys-note", "펼치면 불러와요."));
    d.appendChild(w);
    var done = false;
    d.addEventListener("toggle", function () {
      if (!d.open || done || !loadWifi) return;
      done = true;
      w.textContent = "";
      w.appendChild(el("p", "sys-note", "불러오는 중…"));
      loadWifi().then(function (rows) {
        w.textContent = "";
        if (!rows || !rows.length) { w.appendChild(el("p", "sys-note", "와이파이는 학원에 물어봐 주세요.")); return; }
        var t = el("table", "room__wifitable");
        rows.forEach(function (r) {
          var tr = el("tr");
          tr.appendChild(el("th", null, r.name));
          tr.appendChild(el("td", null, r.pass));
          t.appendChild(tr);
        });
        w.appendChild(t);
      }, function () { done = false; w.textContent = ""; w.appendChild(el("p", "sys-note", "불러오지 못했어요. 다시 접었다 펼쳐 주세요.")); });
    });
    return d;
  }
  window.LeeshRoomRules = { box: box };
})();
