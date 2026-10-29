/**
 * 구글시트 "학생관리 통합 관리자 → 수강ID 관리" → 홈페이지(leeshlesson.com) 수강생 명단 보내기.
 * (원장님 2026-10-29: 시트가 원본, 3시간마다 + 급할 땐 버튼)
 *
 * ▶ 시트 파일에 붙이는 게 아니라 script.google.com에서 "새 프로젝트"로 따로 만들어요.
 *   시트에 이미 붙어 있는 자동화(회차·결제·DB 연계)와 섞이지 않게 하려고요.
 * ▶ 시트는 "읽기만" 해요 (appsscript.json의 spreadsheets.readonly 권한). 학생 내용은 한 글자도 안 바꿔요.
 * ▶ 시트가 안 바뀌었으면 홈페이지로 안 보내고 바로 끝나요 (한 번에 몇 초, 하루 8번).
 *
 * 처음 한 번:
 *   1) 배포 → 새 배포 → 유형 "웹 앱" → 실행: 나 / 액세스: 모든 사용자 → 배포 (= 관리자 화면 "지금 시트에서 가져오기" 버튼)
 *   2) 관리자 화면 → 수강 ID → "시트 연결 열기" (30분 동안 열림)
 *   3) 이 편집기에서 함수 "처음_한번_설정" 실행 → 권한 허용
 */

var SHEET_ID = "1Hr4dXcpq1xkxV8PHRXQyKTym2FlXY9YwW6s_nxwQPbo"; // 학생관리 통합 관리자
var TAB = "수강ID 관리";
var FIRST_ROW = 5;                                              // 1~4줄은 제목·설명·머리줄
var API = "https://lsdmokkecmymtxpmiwbm.supabase.co/rest/v1/rpc/";
var PUBLIC_KEY = "sb_publishable_e65wHiIp1Psl4bNVaeU-cA_Df2VmJ-9"; // 홈페이지에 공개된 키 (비밀 아님)

/** 처음 한 번만: 홈페이지에 이 스크립트를 등록하고, 3시간마다 자동으로 보내게 해요. */
function 처음_한번_설정() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty("SYNC_KEY") || (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
  var url = null;
  try { url = ScriptApp.getService().getUrl(); } catch (e) { /* 웹 앱 배포 전이면 버튼 없이 */ }
  var r = call_("sheet_register", { p_key: key, p_url: url && /\/exec$/.test(url) ? url : null });
  if (!r.ok) throw new Error(r.error);
  props.setProperty("SYNC_KEY", key);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "자동_보내기") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("자동_보내기").timeBased().everyHours(3).create();
  var res = send_(true);
  Logger.log("연결 끝! 3시간마다 자동으로 보내요. 지금 결과: " + JSON.stringify(res));
}

/** 3시간마다 (트리거): 시트가 바뀌었을 때만 보내요. */
function 자동_보내기() { send_(false); }

/** 지금 바로 보내기 (편집기에서 실행하거나, 관리자 화면 버튼 = 웹 앱). */
function 지금_보내기() { return send_(true); }

function doGet() {
  var r = send_(true);
  var msg = r.ok
    ? "홈페이지에 반영했어요. 새 학생 " + (r.added || 0) + "명 · 바뀐 학생 " + (r.changed || 0) + "명"
    : "반영하지 못했어요: " + r.error;
  return HtmlService.createHtmlOutput('<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<p style="font:16px sans-serif;padding:24px">' + msg + '</p><p style="font:14px sans-serif;padding:0 24px">이 창은 닫아도 돼요.</p>');
}

function send_(force) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty("SYNC_KEY");
  if (!key) return { ok: false, error: "아직 연결 전이에요. 처음_한번_설정을 먼저 실행해주세요." };
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB);
  if (!sheet) return { ok: false, error: "'" + TAB + "' 탭을 찾을 수 없어요." };
  var last = sheet.getLastRow();
  if (last < FIRST_ROW) return { ok: false, error: "명단이 비어 있어요." };
  // A 수강ID · B 학생명 · C 현재 담당교사 · D 관리 상태 · E 휴원·종료 보관 상태
  var rows = sheet.getRange(FIRST_ROW, 1, last - FIRST_ROW + 1, 5).getValues()
    .filter(function (v) { return /^E\d+$/.test(String(v[0]).trim()) && String(v[1]).trim(); })
    .map(function (v) { return { id: String(v[0]).trim(), name: String(v[1]).trim(), teacher: String(v[2]).trim(), archive: String(v[4]).trim() }; });
  if (!rows.length) return { ok: false, error: "수강ID가 있는 줄이 없어요." };
  var body = JSON.stringify(rows);
  var hash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, body));
  if (!force && props.getProperty("LAST_HASH") === hash) return { ok: true, skippedSame: true };
  var r = call_("sheet_sync_members", { p_key: key, p_rows: rows });
  if (r.ok) props.setProperty("LAST_HASH", hash);
  else Logger.log("홈페이지 반영 실패: " + r.error);
  return r;
}

function call_(fn, args) {
  var res = UrlFetchApp.fetch(API + fn, {
    method: "post",
    contentType: "application/json",
    headers: { apikey: PUBLIC_KEY },
    payload: JSON.stringify(args),
    muteHttpExceptions: true
  });
  try { return JSON.parse(res.getContentText()); } catch (e) { return { ok: false, error: "HTTP " + res.getResponseCode() }; }
}
