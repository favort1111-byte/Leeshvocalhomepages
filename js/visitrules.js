// 내방 오디션 참여 방법 · 주요 공지 사항 (블로그 공지 [내방 오디션 참여 방법!] 2023.3.30, 원장님 2026-11-06).
// apply.html 신청서 위(펼침)와 내 폴더 일정·공지 맨 아래(접힘)에 같은 상자: window.LeeshVisitRules.box(open).
(function () {
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  // 접수는 담당쌤 카톡 대신 홈페이지 신청서로, 마감은 오디션 하루 전 (원장님 2026-11-06)
  var RULES = [
    ["접수 후 선곡 및 특이사항 변경 불가하니 신중하게 지원해 주세요!", "(부득이한 경우는 담당쌤께 말씀해 주세요!)"],
    ["특이사항 요청 시 지원할 때 말씀해 주세요!", "(ex. 학교 수업 때문에 7시 이후 순서로 잡아주세요 · ex. 지방이라 버스를 타야 해서 6시에 시작하게 해주세요 등)"],
    ["당일 지각 및 불참 시 누적 2회 이상 6개월 동안 오디션 및 월말평가에 참여 불가합니다.",
     "(미리 스케줄 체크하여 특이사항으로 요청해 주세요) (병가 시에는 오디션 당일 일자 처방전 첨부 시 추후 참여 가능)"],
    ["참여 의사만 밝히고 약속한 기간까지 신청서 미접수 시 오디션 참여 불가 (누적 1회)", null],
    ["시작 30분 전 학원 도착 후 대기해 주세요!", null]
  ];
  function box(open) {
    var box = el("details", "apply__rules");
    box.open = !!open;
    box.appendChild(el("summary", "apply__rules-title", "내방 오디션 참여 방법 · 주요 공지 사항"));
    var how = el("ul", "apply__how");
    var li = el("li");
    li.appendChild(document.createTextNode("접수 기간 : "));
    li.appendChild(el("b", "apply__red", "오디션 하루 전"));
    li.appendChild(document.createTextNode("까지 홈페이지 신청서로 보내기! (오디션 당일에는 신청서가 닫혀요)"));
    how.appendChild(li);
    li = el("li");
    li.appendChild(document.createTextNode("오디션 일정은 인스타 참고! :) 팔로우하여 일정 확인해주세요! "));
    var a = el("a", null, "인스타그램 보기");
    a.href = "https://www.instagram.com/leeshvocal_auditionn/";
    a.target = "_blank";
    a.rel = "noopener";
    li.appendChild(a);
    how.appendChild(li);
    how.appendChild(el("li", null, "댄스 지원자는 댄스 음원을 꼭 첨부해주세요! 댄스곡의 시작점은 본인이 편집하여 제출하기 (ex. 0:10초부터 틀어주세요 안됨 ❌)"));
    box.appendChild(how);
    box.appendChild(el("p", "apply__rules-sub", "📍 주요 공지 사항"));
    var ol = el("ol", "apply__rule-list");
    RULES.forEach(function (r) {
      var item = el("li");
      item.appendChild(el("span", "apply__red", r[0]));
      if (r[1]) item.appendChild(el("small", null, r[1]));
      ol.appendChild(item);
    });
    box.appendChild(ol);
    box.appendChild(el("p", "apply__rules-end", "🔥 정보 누락되지 않도록 마지막으로 보내기 전에 꼭! 꼭! 꼭!! 확인해 주세요! 🔥"));
    return box;
  }

  window.LeeshVisitRules = { box: box };
})();
