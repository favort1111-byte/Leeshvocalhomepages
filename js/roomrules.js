// 연습실 예약 및 이용 안내 (블로그 서로이웃 공지 "연습실 공지사항 (예약방법/WI-FI)" 2021.3.4, 원장님 2026-11-06 글 그대로).
// 내 폴더 → 일정·공지 → 공지 맨 아래 (접힘). 와이파이 비밀번호는 저장소가 공개라 여기 없음 → 펼칠 때 서버
// member_wifi(로그인한 수강생만)에서 받아 옴. window.LeeshRoomRules.box(loadWifi) — loadWifi()는 [{name, pass}] Promise.
(function () {
  var SOON = "📢 11월 16일 자정부터는 홈페이지에서만 예약이 진행됩니다! (네이버 플레이스 예약❌)";
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
  /* 보강 및 레슨 공지 · 수강료 환불 규정 (블로그 서로이웃 공지 2020.11.17, 원장님 2026-11-06 글 그대로). 수강생 내 폴더에만. */
  var MAKEUP = [
    "사전 알림 후 조율하에 보강 가능 (최소 7일 전 사전 알림만 보강 가능)",
    "당일 통보는 보강 불가능",
    ["월 4회 중 1회만 보강 가능 하며, 2회 이상은 결석처리. (병가, 개인 사유 등)", null],
    ["병결 보강 요청은 결석 당일에 해당하는 처방전이 있어야만 가능합니다.", "(형평성을 고려한 기준이니 양해 부탁드립니다.)"],
    "레슨시간 변경은 월 1회에 한함",
    ["보강수업은 바로 다음 주 진행으로 이루어져야 합니다.", "부득이한 경우는 담당쌤과 스케줄을 조율하여 한달 이내로만 사용 가능합니다."],
    ["보강 수업의 스케줄이 픽스 된 후 재보강 요청 및 스케줄 변동은 어렵습니다.", "부득이한 경우는 담당쌤과 스케줄을 조율하여 한달 이내로만 사용 가능합니다."]
  ];
  var LESSON = [
    ["레슨실 입장은 약속한 레슨 정각 시간에 맞춰서 입장 부탁드립니다!",
     "(매시간 레슨이 있어서 레슨 이전 휴식시간에는 각 학생들의 피드백 및 선생님들의 충분한 휴식이 있어야 더 집중력 있게 수업을 진행할 수 있습니다. 좋은 퀄리티의 수업을 위하여 시간에 맞춰서 와주시면 정말 감사하겠습니다!)"],
    "레슨 3회차 때 레슨 종료 고지를 하지 않으면 연속 수강으로 간주하여 레슨은 이어서 진행됩니다.",
    ["레슨 4회차 종료 후 1회차 레슨 시작일 5일 전에는 재수강 레슨비 수납(입금 및 결제)이 완료되어야 재 1회차 레슨이 확정됩니다.",
     "수납 완료(입금 및 결제)가 되지 않으면 레슨이 진행되지 않으니 재수강 공지에 맞춰 수납(입금 및 결제) 부탁드립니다."]
  ];
  var REFUND = [
    "강의시작 전 : 전액환불",
    "총 수업시간의 1/3 경과 전 : 납부한 수강료의 2/3 환불",
    "총 수업시간의 1/2 경과 전 : 납부한 수강료의 1/2 환불",
    "총 수업시간의 1/2 경과 후 : 환불 불가"
  ];
  function lesson() {
    var d = el("details", "apply__rules room__rules");
    d.appendChild(el("summary", "apply__rules-title", "📍 보강 및 레슨 공지 · 수강료 환불 규정"));
    d.appendChild(el("p", "apply__rules-sub", "📍 보강 공지"));
    d.appendChild(list("ul", MAKEUP));
    d.appendChild(el("p", "room__p", "📌 레슨을 등록하게 되면 각 학생당 한 달의 스케줄이 픽스되는지라 갑작스러운 변경은 모든 학생 스케줄의 영향을 끼치게 됩니다! 재수강 시, 사전에 스케줄을 확인해 주시고, 부득이한 일이 아니면 되도록 사용 자제를 부탁드립니다. 🙏🏻 꼭 꼭 부탁드립니다!🙏🏻🙏🏻"));
    d.appendChild(el("p", "room__p", "매주 수요일에 레슨 하는 고정 레슨을 보강 요청한다면 그다음 주에는 보강을 추가해서 정상 레슨과 함께 총 2회 레슨을 진행합니다."));
    d.appendChild(el("p", "room__sub", "EX) 18일 (수) 수업 보강 요청 → 19일 ~ 29일 안으로 보강 일정을 조율합니다. 예를 들어 보강 레슨을 27일로 조율하였다면 25일 정상 레슨과 27일 보강 레슨, 총 2회를 진행합니다."));
    d.appendChild(el("p", "apply__rules-sub", "📍 레슨 공지"));
    d.appendChild(list("ul", LESSON));
    d.appendChild(el("p", "apply__rules-sub", "📍 수강료 환불 규정"));
    d.appendChild(el("p", "room__p", "우리 학원의 수업은 월 4회 기준으로 합니다."));
    d.appendChild(list("ol", REFUND));
    d.appendChild(list("ul", [
      "*수강료 환불은 강의 기간 내에만 가능합니다.",
      "*총 수업시간은 수업기간 중의 총 수업기간(한달)을 말하며, 반환금액의 산정은 반환사유가 발생한 날까지 경과된 수업시간을 기준으로 합니다.",
      "*보강특강은 환불 적용이 제외됩니다."]));
    d.appendChild(el("p", "room__sub", "❖ 이송희보컬레슨학원의 수강료 환불 규정은 교육청의 「학원의 설립.운영 및 과외교습에 관한 법률」 제18조제2항 및 「학원의 설립.운영 및 과외교습에 관한 법률 시행령」 제18조제3항을 준수합니다."));
    return d;
  }
  window.LeeshRoomRules = { box: box, lesson: lesson };
})();
