/**
 * 홈페이지 데이터 백업 → 원장님 구글 드라이브 "홈페이지백업파일" 폴더 (원장님 2026-11-04).
 *
 * ▶ script.google.com에서 원장님 구글 계정(favort1111@gmail.com)으로 "새 프로젝트"를 만들어요 (레슨 시트 가져오기와 따로).
 * ▶ 하루 한 번 새벽 3시에 홈페이지 데이터를 표마다 받아서 zip 파일 하나로 저장해요 (예: 홈페이지백업_2026-11-05.zip).
 * ▶ 백업 파일은 지우지 않고 계속 쌓아요 (원장님 2026-11-04 "굳이 휴지통에 보낼 필요가 있어?" · 자동 삭제는 켜지 않는 학원 방침).
 *   하루 2MB쯤이라 1년에 1GB 안쪽이에요. 오래된 것은 원장님이 필요할 때 직접 지워요.
 * ▶ 담기는 것: 수강생 명단 · 레슨 노트 · 곡·자료 · 연습 일지 · 레퍼토리 · 예약 · 상담 · 신청서 · 월말평가 점수 · 공지 · 건의함(암호화된 그대로) …
 *   담기지 않는 것: 노래 녹음 · 평가지 사진 같은 파일, 비밀번호 · 열쇠 · 토큰.
 * ▶ 개인정보가 들어 있으니 "홈페이지백업파일" 폴더는 다른 사람과 공유하지 마세요.
 *
 * 처음 한 번:
 *   1) 관리자 화면 → 설정 → "백업 연결 열기" (30분 동안 열림)
 *   2) 이 편집기에서 함수 "처음_한번_설정" 실행 → 권한 허용 → 첫 백업 파일이 폴더에 생겨요
 */

var API = "https://lsdmokkecmymtxpmiwbm.supabase.co/rest/v1/rpc/";
var PUBLIC_KEY = "sb_publishable_e65wHiIp1Psl4bNVaeU-cA_Df2VmJ-9"; // 홈페이지에 공개된 키 (비밀 아님)
var FOLDER_NAME = "홈페이지백업파일";
var FILE_PREFIX = "홈페이지백업_";
var PAGE = 200;

/** 처음 한 번만: 홈페이지에 이 스크립트를 등록하고, 매일 새벽 3시에 저절로 돌게 해요. */
function 처음_한번_설정() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty("BACKUP_KEY") || (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
  var r = call_("backup_register", { p_key: key });
  if (!r.ok) throw new Error(r.error);
  props.setProperty("BACKUP_KEY", key);
  folder_(); // 폴더가 있는지 먼저 확인
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "자동_백업") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("자동_백업").timeBased().everyDays(1).atHour(3).create();
  Logger.log("연결 끝! 매일 새벽 3시에 저절로 백업해요. 지금 한 번 백업할게요.");
  Logger.log(JSON.stringify(run_()));
}

/** 매일 (트리거) */
function 자동_백업() { run_(); }

/** 지금 바로 백업 (편집기에서 실행) */
function 지금_백업() { Logger.log(JSON.stringify(run_())); }

function run_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { ok: true, busy: true };
  var key = PropertiesService.getScriptProperties().getProperty("BACKUP_KEY");
  var result = { ok: true, tables: 0, rows: 0, bytes: 0, file: "", warnings: [] };
  try {
    if (!key) return { ok: false, error: "아직 연결 전이에요. 처음_한번_설정을 먼저 실행해주세요." };
    var folder = folder_();
    var list = call_("backup_tables", { p_key: key });
    if (!list.ok) throw new Error(list.error || "표 목록을 못 받았어요");
    var data = { site: "leeshlesson.com", made_at: list.at, tables: {} };
    list.tables.forEach(function (t) {
      var rows = [];
      for (var off = 0; ; off += PAGE) {
        var r = call_("backup_rows", { p_key: key, p_table: t.table, p_offset: off, p_limit: PAGE });
        if (!r.ok) throw new Error(t.table + ": " + (r.error || "받지 못했어요"));
        rows = rows.concat(r.rows);
        if (r.rows.length < PAGE) break;
      }
      if (rows.length !== t.rows) result.warnings.push(t.table + " 줄 수가 받는 동안 바뀜 (" + t.rows + " → " + rows.length + ")");
      data.tables[t.table] = rows;
      result.tables++;
      result.rows += rows.length;
    });
    var day = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd_HHmm");
    var json = Utilities.newBlob(JSON.stringify(data), "application/json", "homepage-backup-" + day + ".json");
    var zip = Utilities.zip([json], FILE_PREFIX + day + ".zip");
    var file = folder.createFile(zip);
    result.file = file.getName();
    result.bytes = file.getSize();
  } catch (e) {
    result.ok = false;
    result.error = String(e.message || e).slice(0, 300);
  } finally {
    try { if (key) call_("backup_done", { p_key: key, p_result: result }); } catch (e2) { /* 기록 실패는 넘어감 */ }
    lock.releaseLock();
  }
  if (!result.ok) throw new Error(result.error); // 실패하면 구글이 원장님 메일로 알려줘요
  return result;
}

function folder_() {
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  if (!it.hasNext()) throw new Error('드라이브에 "' + FOLDER_NAME + '" 폴더가 없어요.');
  return it.next();
}

function call_(fn, args) {
  for (var tries = 0; tries < 3; tries++) {
    var res = UrlFetchApp.fetch(API + fn, {
      method: "post", contentType: "application/json", headers: { apikey: PUBLIC_KEY },
      payload: JSON.stringify(args), muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code >= 500 || code === 429) { Utilities.sleep(2000 * (tries + 1)); continue; }
    try { return JSON.parse(res.getContentText()); } catch (e) { return { ok: false, error: "HTTP " + code }; }
  }
  return { ok: false, error: "홈페이지 서버가 바빠요. 다음에 다시 해요." };
}
