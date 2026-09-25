/**
 * Sheet access: tab names, headers, typed reads/writes and settings.
 * Every tab is a plain table: row 1 = headers, data from row 2.
 */
var TZ = 'Asia/Seoul';

var TABS = {
  settings: '설정',
  content: '콘텐츠',
  results: '합격실적',
  pricing: '수강료',
  rooms: '연습실',
  students: '수강생',
  bookings: '연습실예약',
  consultHours: '상담가능시간',
  closed: '휴무일',
  consults: '상담',
  log: '로그'
};

var HEADERS = {
  settings: ['항목', '값', '설명'],
  content: ['키', '값', '설명'],
  results: ['구분', '내용', '표시', '순서'],
  pricing: ['구분', '과정', '회차', '금액', '비고', '표시', '순서'],
  rooms: ['연습실', '종류', '사용', '메모'],
  students: ['이름', '전화번호', '상태', '메모'],
  bookings: ['예약번호', '상태', '연습실', '날짜', '시작', '종료', '이름', '전화뒷자리', '신청시각', '취소시각', '메모'],
  consultHours: ['요일', '시작', '종료', '메모'],
  closed: ['날짜', '사유'],
  consults: ['접수번호', '상태', '방식', '예약날짜', '예약시작', '예약종료', '이름', '연락처', '관심반', '내용', '접수시각', '메모'],
  log: ['시각', '종류', '내용']
};

/** Columns that must stay plain text so Sheets doesn't turn "09:00" into a time. */
var TEXT_COLUMNS = {
  bookings: ['날짜', '시작', '종료', '전화뒷자리'],
  consultHours: ['시작', '종료'],
  closed: ['날짜'],
  consults: ['예약날짜', '예약시작', '예약종료', '연락처'],
  students: ['전화번호'],
  settings: ['값']
};

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(key) {
  var sh = ss_().getSheetByName(TABS[key]);
  if (!sh) throw new Error('시트 탭 "' + TABS[key] + '"이 없습니다. 메뉴 홈페이지 > 초기 설정을 실행하세요.');
  return sh;
}

/** Sheet cell → string, turning Date cells back into "YYYY-MM-DD" / "HH:mm". */
function cellText_(v, header) {
  if (v instanceof Date) {
    var isTime = /시작|종료|시각/.test(header) && v.getFullYear() < 1901;
    if (isTime) return Utilities.formatDate(v, TZ, 'HH:mm');
    if (/시각/.test(header)) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm');
    return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  }
  return v == null ? '' : String(v).trim();
}

/** Rows as objects keyed by header; each carries its 1-based sheet row as _row. */
function readTable_(key) {
  var sh = sheet_(key);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(String);
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (row.every(function (c) { return c === '' || c == null; })) continue;
    var obj = { _row: r + 1 };
    headers.forEach(function (h, i) { obj[h] = cellText_(row[i], h); });
    out.push(obj);
  }
  return out;
}

function appendRow_(key, obj) {
  var sh = sheet_(key);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  sh.appendRow(headers.map(function (h) { return obj[h] == null ? '' : obj[h]; }));
}

function setCell_(key, rowNum, header, value) {
  var sh = sheet_(key);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var col = headers.indexOf(header) + 1;
  if (col > 0) sh.getRange(rowNum, col).setValue(value);
}

var SETTING_DEFAULTS = [
  ['연습실 예약단위(분)', '60', '연습실을 몇 분 단위로 예약받을지'],
  ['연습실 운영시작', '00:00', '연습실 예약을 받는 첫 시간'],
  ['연습실 운영종료', '24:00', '연습실 예약을 받는 마지막 시간 (24:00 = 자정)'],
  ['연습실 1회최대(시간)', '2', '한 번에 예약할 수 있는 최대 시간'],
  ['연습실 하루최대(시간)', '3', '학생 한 명이 하루에 예약할 수 있는 총 시간'],
  ['연습실 예약가능일수', '7', '오늘부터 며칠 뒤까지 예약을 받을지'],
  ['연습실 취소마감(분)', '60', '시작 몇 분 전까지 학생이 직접 취소할 수 있는지'],
  ['연습실 예약알림', '켜짐', '연습실 예약·취소 때 텔레그램 알림 (켜짐/꺼짐)'],
  ['상담 예약단위(분)', '60', '방문 상담·체험 레슨 한 건의 길이'],
  ['상담 예약가능일수', '14', '오늘부터 며칠 뒤까지 상담 예약을 받을지'],
  ['상담 최소사전(시간)', '3', '지금부터 몇 시간 뒤 시간부터 상담 예약을 받을지']
];

function settings_() {
  var map = {};
  SETTING_DEFAULTS.forEach(function (d) { map[d[0]] = d[1]; });
  readTable_('settings').forEach(function (r) { if (r['항목']) map[r['항목']] = r['값']; });
  function num(k) { var n = Number(map[k]); return isNaN(n) ? Number(SETTING_DEFAULTS.filter(function (d) { return d[0] === k; })[0][1]) : n; }
  function time(k) { var m = Logic.toMin(map[k]); return isNaN(m) ? Logic.toMin(SETTING_DEFAULTS.filter(function (d) { return d[0] === k; })[0][1]) : m; }
  return {
    roomUnit: num('연습실 예약단위(분)'),
    roomOpen: time('연습실 운영시작'),
    roomClose: time('연습실 운영종료'),
    roomMaxMinutes: num('연습실 1회최대(시간)') * 60,
    roomDailyMaxMinutes: num('연습실 하루최대(시간)') * 60,
    roomMaxDays: num('연습실 예약가능일수'),
    roomCancelMinutes: num('연습실 취소마감(분)'),
    roomNotify: String(map['연습실 예약알림']).indexOf('꺼') === -1,
    consultUnit: num('상담 예약단위(분)'),
    consultDays: num('상담 예약가능일수'),
    consultLeadMinutes: num('상담 최소사전(시간)') * 60
  };
}

/** "Now" in Seoul as { today: 'YYYY-MM-DD', nowMin, stamp } */
function now_() {
  var d = new Date();
  var hm = Utilities.formatDate(d, TZ, 'HH:mm');
  return {
    today: Utilities.formatDate(d, TZ, 'yyyy-MM-dd'),
    nowMin: Logic.toMin(hm),
    stamp: Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm:ss')
  };
}

function log_(kind, text) {
  try {
    appendRow_('log', { '시각': now_().stamp, '종류': kind, '내용': String(text).slice(0, 1000) });
  } catch (e) {
    console.error(kind, text, e);
  }
}
