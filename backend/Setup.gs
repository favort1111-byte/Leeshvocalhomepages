/**
 * One-time setup + the 홈페이지 menu. setupSheets() only creates tabs that
 * don't exist yet, so re-running it never overwrites what the owner typed.
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('홈페이지')
    .addItem('초기 설정 (탭 만들기)', 'setupSheets')
    .addSeparator()
    .addItem('텔레그램 채팅 ID 찾기', 'findTelegramChatId')
    .addItem('텔레그램 알림 테스트', 'testTelegram')
    .addSeparator()
    .addItem('콘텐츠 즉시 반영', 'refreshContentNow')
    .addToUi();
}

/** Simple trigger: edits to the content tabs show up on the site right away. */
function onEdit(e) {
  var name = e && e.range && e.range.getSheet().getName();
  if ([TABS.content, TABS.results, TABS.pricing].indexOf(name) !== -1) clearContentCache();
}

function refreshContentNow() {
  clearContentCache();
  SpreadsheetApp.getUi().alert('콘텐츠 캐시를 비웠습니다. 홈페이지를 새로고침하면 바로 반영됩니다.');
}

/** Built lazily: Apps Script may load this file before Sheets.gs / Api.gs. */
function seed_() {
  return {
  settings: SETTING_DEFAULTS,
  content: [
    ['about.title', 'our vocal\nclasses', 'about 페이지 큰 제목 (줄바꿈: Alt+Enter)'],
    ['class1.name', 'Audition', '첫 번째 폴더 제목'],
    ['class1.desc', '대형 기획사 연습생 커리큘럼으로 준비하는 오디션·입시반. 월 내방·비공개 오디션까지.', '첫 번째 폴더 설명'],
    ['class2.name', 'Pro Class', '두 번째 폴더 제목'],
    ['class2.desc', '기본기부터 톤 메이킹까지, 4 STEP 담임제로 완성하는 전문반.', '두 번째 폴더 설명'],
    ['class3.name', 'Hobby', '세 번째 폴더 제목'],
    ['class3.desc', '노래방에서 바로 써먹는 발성. 고음·호흡·음정을 제대로 배우는 취미반.', '세 번째 폴더 설명'],
    ['contact.title', "let's connect", 'contact 페이지 제목'],
    ['contact.body', '노래는 늘 깔끔하게 완성된 채로 오지 않아요. 오디션 전날 밤의 연습, 무심코 흥얼거린 가사, 처음 잡아본 마이크에서 시작되죠. 지금 어디쯤인지부터 함께 확인해요. 선릉역 7번 출구 도보 2분 · 카카오톡 24시간 문의 · 010-4458-5448', 'contact 페이지 본문'],
    ['consult.title', 'Book a free consultation', '상담 신청 카드 제목'],
    ['consult.note', '번호는 상담 안내에만 사용돼요.', '상담 신청 버튼 아래 작은 글씨'],
    ['booking.title', 'practice room', '연습실 예약 페이지 제목'],
    ['booking.note', '수강생 전용 · 365일 24시간 연습실을 사전예약제로 운영합니다.', '연습실 예약 페이지 안내 문구']
  ],
  results: [
    ['기획사', "트리플에스(TripleS) '김유언' 데뷔", 'Y', 1],
    ['기획사', '모어비전(MORE VISION) 최종 합격', 'Y', 2],
    ['기획사', 'SM 엔터테인먼트 최종 합격', 'Y', 3],
    ['기획사', 'JYP 연습생 최종 합격', 'Y', 4],
    ['기획사', 'FNC 최종 합격', 'Y', 5],
    ['기획사', 'SM·YG 1차 동시 합격', 'Y', 6],
    ['기획사', 'CJ ENM 비공개 오디션 최종 합격', 'Y', 7],
    ['입시', '서울예술대학교 최종 합격 3명', 'Y', 20],
    ['입시', '한양대학교 수시 합격', 'Y', 21],
    ['입시', '경희대학교 정시 합격', 'Y', 22],
    ['입시', '서울예술고등학교 합격', 'Y', 23]
  ],
  pricing: [
    ['종합반', '오디션반 (1)', '20회', '500,000', '60분', 'Y', 1],
    ['종합반', '오디션반 (2)', '18회', '450,000', '60분', 'Y', 2],
    ['종합반', '오디션반 (3)', '16회', '400,000', '60분', 'Y', 3],
    ['종합반', '취미반 (1)', '18회', '350,000', '60분', 'Y', 4],
    ['종합반', '취미반 (2)', '15회', '300,000', '60분', 'Y', 5]
  ],
  rooms: [
    ['연습실 1', '보컬', '사용', '실제 방 이름으로 바꿔주세요'],
    ['연습실 2', '보컬', '사용', ''],
    ['댄스 연습실', '댄스', '사용', '1인 단독']
  ],
  students: [
    ['홍길동', '010-0000-0000', '예시', '예시 행입니다. 지우고 실제 수강생을 넣어주세요. 상태가 휴원·종료인 학생은 예약할 수 없어요.']
  ],
  consultHours: [
    ['월', '13:00', '21:00', ''],
    ['화', '13:00', '21:00', ''],
    ['수', '13:00', '21:00', ''],
    ['목', '13:00', '21:00', ''],
    ['금', '13:00', '21:00', ''],
    ['토', '11:00', '17:00', '']
  ],
  closed: [],
  bookings: [],
  consults: [],
  log: []
  };
}

function dropdowns_() {
  return {
  bookings: { '상태': ['확정', '취소'] },
  students: { '상태': ['재원', '휴원', '종료', '예시'] },
  consults: { '상태': ['접수', '연락완료', '예약확정', '상담완료', '등록', '취소'], '방식': METHODS },
  rooms: { '사용': ['사용', '사용안함'] },
  results: { '표시': ['Y', 'N'] },
  pricing: { '표시': ['Y', 'N'] }
  };
}

function setupSheets() {
  var ss = ss_();
  ss.setSpreadsheetTimeZone(TZ);
  var created = [];
  Object.keys(TABS).forEach(function (key) {
    if (ss.getSheetByName(TABS[key])) return;
    var sh = ss.insertSheet(TABS[key]);
    var headers = HEADERS[key];
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#F1E1B9');
    sh.setFrozenRows(1);

    (TEXT_COLUMNS[key] || []).forEach(function (h) {
      var col = headers.indexOf(h) + 1;
      if (col) sh.getRange(2, col, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    });
    var rows = seed_()[key] || [];
    if (rows.length) sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);

    var dd = dropdowns_()[key] || {};
    Object.keys(dd).forEach(function (h) {
      var col = headers.indexOf(h) + 1;
      if (!col) return;
      var rule = SpreadsheetApp.newDataValidation().requireValueInList(dd[h], true).setAllowInvalid(false).build();
      sh.getRange(2, col, sh.getMaxRows() - 1, 1).setDataValidation(rule);
    });
    sh.autoResizeColumns(1, headers.length);
    created.push(TABS[key]);
  });

  var first = ss.getSheets()[0];
  if (first.getName() === 'Sheet1' || first.getName() === '시트1') {
    if (first.getLastRow() === 0) ss.deleteSheet(first);
  }
  clearContentCache();
  SpreadsheetApp.getUi().alert(created.length
    ? '만든 탭: ' + created.join(', ') + '\n\n다음 단계: 수강생·연습실 탭을 실제 내용으로 채워주세요.'
    : '모든 탭이 이미 있습니다. 바꾼 것은 없습니다.');
}
