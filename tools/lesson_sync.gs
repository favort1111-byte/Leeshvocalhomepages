/**
 * 선생님 레슨 시트(구글 드라이브 "○○ 레슨시트" 폴더, 학생 한 명 = 파일 하나) → 홈페이지 레슨 노트.
 * (원장님 2026-11-03: 날짜 탭은 레슨 노트로, 다른 탭(곡 · OT · 발성 · 알림장)은 "곡·자료" 칸으로, 2026년부터, 당분간 계속 맞추기)
 *
 * ▶ script.google.com에서 원장님 구글 계정(favort1111@gmail.com, 선생님들이 폴더를 공유한 계정)으로 "새 프로젝트"를 만들어요.
 * ▶ 시트는 "읽기만" 해요 (appsscript.json: drive.readonly · spreadsheets.readonly). 선생님 시트는 한 글자도 안 바꿔요.
 * ▶ 1시간마다 돌고, 바뀐 파일만 가져와요. 한 번에 5분 안에서 끊고 다음 번에 이어서 해요.
 * ▶ 홈페이지에서 고친 일지는 시트가 덮지 않고, 홈페이지에서 지운 일지는 다시 안 들어와요 (서버가 지켜요).
 *
 * 처음 한 번:
 *   1) 관리자 화면 → 선생님 → "레슨 시트 연결 열기" (30분 동안 열림)
 *   2) 이 편집기에서 함수 "처음_한번_설정" 실행 → 권한 허용
 * 찾는 폴더: 이름에 "레슨시트"나 "레슨 시트"가 들어간 폴더 (이수빈 레슨시트 · 유정T 레슨시트 · 이윤지T 학생 레슨 시트지 · 이하섬 레슨시트 …).
 * 새 선생님이 폴더를 공유하면 저절로 찾아요. 폴더 이름의 선생님과 홈페이지 명단 "담당 ○○○"가 같아야 학생이 정해져요.
 */

var API = "https://lsdmokkecmymtxpmiwbm.supabase.co/rest/v1/rpc/";
var PUBLIC_KEY = "sb_publishable_e65wHiIp1Psl4bNVaeU-cA_Df2VmJ-9"; // 홈페이지에 공개된 키 (비밀 아님)
var VER = 1;                    // 바꾸는 방식이 달라지면 올림 → 모든 파일을 다시 가져옴
var FROM = "2026-01-01";        // 이 날짜부터의 수업만 (원장님 2026-11-03 "2026년부터")
var TIME_LIMIT_MS = 4.5 * 60 * 1000;
var SKIP_TAB = /결제|연락처|수강료|입금|학부모|전화번호|계좌/; // 수업과 상관없는 탭은 안 가져옴
var COLS = 26, MAX_ROWS = 1000, CW = 100, RH = 21, BASE_PX = 13, MAX_JSON = 380000, MAX_CELL = 5000;

/** 처음 한 번만: 홈페이지에 이 스크립트를 등록하고, 1시간마다 저절로 돌게 해요. */
function 처음_한번_설정() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty("LESSON_KEY") || (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
  var r = call_("lesson_register", { p_key: key });
  if (!r.ok) throw new Error(r.error);
  props.setProperty("LESSON_KEY", key);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "자동_가져오기") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("자동_가져오기").timeBased().everyHours(1).create();
  Logger.log("연결 끝! 1시간마다 저절로 가져와요. 지금 한 번 가져올게요.");
  Logger.log(JSON.stringify(run_()));
}

/** 1시간마다 (트리거) */
function 자동_가져오기() { run_(); }

/** 지금 바로 가져오기 (편집기에서 실행). 처음엔 파일이 많아서 몇 번 눌러야 끝까지 가져와요. */
function 지금_가져오기() { Logger.log(JSON.stringify(run_())); }

function run_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { ok: true, busy: true };
  var started = Date.now(), result = { ok: true, files: 0, fetched: 0, notes: 0, sheets: 0, kept: 0, bad: 0, errors: [], left: 0 };
  try {
    var key = PropertiesService.getScriptProperties().getProperty("LESSON_KEY");
    if (!key) return { ok: false, error: "아직 연결 전이에요. 처음_한번_설정을 먼저 실행해주세요." };
    var files = listFiles_();
    result.files = files.length;
    var plan = call_("lesson_sync_plan", { p_key: key, p_files: files, p_ver: VER });
    if (!plan.ok) throw new Error(plan.error);
    var byId = {};
    files.forEach(function (f) { byId[f.id] = f; });
    var todo = plan.fetch || [];
    for (var i = 0; i < todo.length; i++) {
      if (Date.now() - started > TIME_LIMIT_MS) { result.left = todo.length - i; break; }
      try {
        var r = syncFile_(key, byId[todo[i]]);
        result.fetched++;
        result.notes += r.added + r.updated;
        result.sheets += r.sheets;
        result.kept += r.kept;
        result.bad += r.bad;
      } catch (e) {
        result.errors.push((byId[todo[i]] || {}).title + ": " + String(e.message || e).slice(0, 200));
      }
    }
    result.pending = plan.pending;
  } catch (e) {
    result.ok = false;
    result.error = String(e.message || e).slice(0, 300);
  } finally {
    try {
      var k = PropertiesService.getScriptProperties().getProperty("LESSON_KEY");
      if (k) call_("lesson_sync_done", { p_key: k, p_result: result });
    } catch (e2) { /* 기록 실패는 넘어감 */ }
    lock.releaseLock();
  }
  return result;
}

/* ---------------- 구글 드라이브: "레슨시트" 폴더 안의 학생 시트 ---------------- */

function drive_(path, params) {
  var q = Object.keys(params || {}).map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&");
  return google_("https://www.googleapis.com/drive/v3/" + path + (q ? "?" + q : ""));
}

function listFiles_() {
  var folders = [], seen = {}, out = [], token = null;
  do {
    var res = drive_("files", {
      q: "mimeType='application/vnd.google-apps.folder' and trashed=false and (name contains '레슨시트' or name contains '레슨 시트')",
      fields: "nextPageToken,files(id,name)", pageSize: 100, supportsAllDrives: true, includeItemsFromAllDrives: true,
      pageToken: token || ""
    });
    (res.files || []).forEach(function (f) { folders.push({ id: f.id, name: f.name, top: f.name }); });
    token = res.nextPageToken;
  } while (token);
  for (var i = 0; i < folders.length; i++) {
    var fo = folders[i];
    token = null;
    do {
      var r = drive_("files", {
        q: "'" + fo.id + "' in parents and trashed=false",
        fields: "nextPageToken,files(id,name,mimeType,modifiedTime,shortcutDetails)", pageSize: 200,
        supportsAllDrives: true, includeItemsFromAllDrives: true, pageToken: token || ""
      });
      (r.files || []).forEach(function (f) {
        if (f.mimeType === "application/vnd.google-apps.folder") {
          if (folders.length < 60) folders.push({ id: f.id, name: f.name, top: fo.top }); // 폴더 안 폴더도 (같은 선생님)
          return;
        }
        var id = f.id, name = f.name, mod = f.modifiedTime, type = f.mimeType;
        if (type === "application/vnd.google-apps.shortcut" && f.shortcutDetails) {
          if (f.shortcutDetails.targetMimeType !== "application/vnd.google-apps.spreadsheet") return;
          try {
            // Drive API의 이름은 targetId (2026-11-04: targetFileId로 잘못 써서 바로가기만 있는 이수빈 레슨시트가 통째로 빠졌음)
            var t = drive_("files/" + (f.shortcutDetails.targetId || f.shortcutDetails.targetFileId), { fields: "id,name,modifiedTime,trashed", supportsAllDrives: true });
            if (t.trashed) return;
            id = t.id; name = t.name; mod = t.modifiedTime; type = "application/vnd.google-apps.spreadsheet";
          } catch (e) { return; }
        }
        if (type !== "application/vnd.google-apps.spreadsheet" || seen[id]) return;
        seen[id] = true;
        out.push({ id: id, title: name, folder: fo.top, modified: mod });
      });
      token = r.nextPageToken;
    } while (token);
  }
  return out;
}

/* ---------------- 시트 하나 가져와서 보내기 ---------------- */

function sheets_(id, params) {
  var q = [];
  Object.keys(params).forEach(function (k) {
    [].concat(params[k]).forEach(function (v) { q.push(k + "=" + encodeURIComponent(v)); });
  });
  return google_("https://sheets.googleapis.com/v4/spreadsheets/" + id + (params._path || "") + "?" + q.filter(function (x) { return x.indexOf("_path=") !== 0; }).join("&"));
}

function rangeOf_(title, rows, cols) {
  return "'" + String(title).replace(/'/g, "''") + "'!A1:" + colName_(cols - 1) + rows;
}
function colName_(c) { return "ABCDEFGHIJKLMNOPQRSTUVWXYZ".charAt(Math.min(c, COLS - 1)); }

function syncFile_(key, file) {
  var today = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
  var meta = sheets_(file.id, { fields: "sheets.properties(sheetId,title,index,hidden,sheetType)" });
  var tabs = [], allTabs = [];
  (meta.sheets || []).forEach(function (s) {
    var p = s.properties;
    if (p.sheetType && p.sheetType !== "GRID") return;
    allTabs.push(p.sheetId);
    if (p.hidden || SKIP_TAB.test(p.title)) return;
    var d = tabDate_(p.title, today);
    if (d && d < FROM) return;
    tabs.push({ id: p.sheetId, title: p.title, index: p.index, date: d });
  });
  // 1) 글자만 먼저 읽어서 쓴 곳(마지막 줄 · 열)을 알고, 2) 그 안만 서식까지 읽어요 (빈 칸 서식까지 다 받으면 너무 커서)
  var sizes = {};
  for (var a = 0; a < tabs.length; a += 20) {
    var part = tabs.slice(a, a + 20);
    var vals = sheets_(file.id, { _path: "/values:batchGet", ranges: part.map(function (t) { return rangeOf_(t.title, MAX_ROWS, COLS); }), majorDimension: "ROWS" });
    (vals.valueRanges || []).forEach(function (vr, i) {
      var rows = vr.values || [], last = 0, wide = 0;
      rows.forEach(function (row, r) {
        var lastC = -1;
        row.forEach(function (v, c) { if (String(v).trim() !== "") lastC = c; });
        if (lastC >= 0) { last = r + 1; wide = Math.max(wide, lastC + 1); }
      });
      sizes[part[i].id] = { rows: last, cols: wide };
    });
  }
  var notes = [], others = [], total = { added: 0, updated: 0, kept: 0, sheets: 0, bad: 0 }, size = 0;
  function flush(done) {
    var r = call_("lesson_sync_push", { p_key: key, p_file: file.id, p_notes: notes, p_sheets: others, p_done: !!done,
      p_modified: file.modified, p_ver: VER, p_tabs: done ? allTabs : null });
    if (!r.ok) throw new Error(r.error || "보내기 실패");
    ["added", "updated", "kept", "sheets", "bad"].forEach(function (k) { total[k] += r[k] || 0; });
    notes = []; others = []; size = 0;
  }
  var want = tabs.filter(function (t) { return sizes[t.id] && sizes[t.id].rows > 0; });
  for (var b = 0; b < want.length; b += 8) {
    var chunk = want.slice(b, b + 8);
    var grid = sheets_(file.id, {
      ranges: chunk.map(function (t) { return rangeOf_(t.title, Math.min(MAX_ROWS, sizes[t.id].rows), Math.max(1, sizes[t.id].cols)); }),
      includeGridData: "true",
      fields: "sheets(properties(sheetId),data(rowData(values(formattedValue,textFormatRuns,effectiveFormat(textFormat,backgroundColor,backgroundColorStyle,wrapStrategy))),rowMetadata(pixelSize),columnMetadata(pixelSize)))"
    });
    (grid.sheets || []).forEach(function (gs) {
      var t = chunk.filter(function (x) { return x.id === gs.properties.sheetId; })[0];
      if (!t) return;
      var sheet = toSheet_((gs.data || [])[0] || {});
      if (!sheet) return;
      var item = { tab: t.id, title: t.title, sheet: sheet };
      var len = JSON.stringify(item).length;
      if (size + len > 2500000) flush(false);
      size += len;
      if (t.date) { item.date = t.date; notes.push(item); }
      else { item.pos = t.index; others.push(item); }
    });
  }
  flush(true);
  return total;
}

/* ---------------- 바꾸기 (node로도 시험: tools/test_lesson_sync.js) ---------------- */

/** 탭 이름 → "YYYY-MM-DD" (날짜 탭이 아니면 null). "2026-10-27(1회차)" · "2025-421 월" · "2025 6/2 월" · "2026-1- 5 월" · "10/27" … */
function tabDate_(title, today) {
  var s = String(title || "").replace(/[()\[\]{}]/g, " ");
  var m = /(20\d{2})\s*[-.\/년\s]\s*(\d{1,2})\s*[-.\/월\s]\s*(\d{1,2})(?!\d)/.exec(s), y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /(20\d{2})\s*[-.\/]\s*(\d{3,4})(?!\d)/.exec(s))) {
    y = +m[1]; mo = +m[2].slice(0, m[2].length - 2); d = +m[2].slice(-2);
  } else if ((m = /^\s*(\d{1,2})\s*[\/.월]\s*(\d{1,2})\s*일?(?!\d)/.exec(s))) {
    mo = +m[1]; d = +m[2];
    // 연도가 없으면 올해로 보고, 오늘보다 45일 넘게 뒤면 작년 (12/30을 11월에 보면 작년 12월)
    var ty = +String(today).slice(0, 4), now = Date.UTC(ty, +String(today).slice(5, 7) - 1, +String(today).slice(8, 10));
    y = Date.UTC(ty, mo - 1, d) - now > 45 * 86400000 ? ty - 1 : ty;
  } else return null;
  if (y < 2020 || y > 2035 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  var dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null;
  // 요일이 적혀 있는데 안 맞으면 앞뒤 해에서 맞는 해로 ("2027-7-21 화"는 2026-07-21 화요일의 연도 오타, 2026-11-04)
  var wd = /(?:^|[^가-힣])([일월화수목금토])(?:요일)?(?![가-힣])/.exec(s.slice(m.index + m[0].length));
  if (wd) {
    var want = "일월화수목금토".indexOf(wd[1]);
    if (dt.getUTCDay() !== want) {
      [-1, 1].some(function (k) {
        var t2 = new Date(Date.UTC(y + k, mo - 1, d));
        if (t2.getUTCMonth() === mo - 1 && t2.getUTCDay() === want) { y += k; return true; }
        return false;
      });
    }
  }
  return y + "-" + (mo < 10 ? "0" : "") + mo + "-" + (d < 10 ? "0" : "") + d;
}

function hex_(c) {
  if (!c) return null;
  var rgb = c.rgbColor || (c.red != null || c.green != null || c.blue != null ? c : null);
  if (!rgb) return null;
  function h(v) { var n = Math.round(Math.max(0, Math.min(1, v || 0)) * 255); return (n < 16 ? "0" : "") + n.toString(16); }
  return "#" + h(rgb.red) + h(rgb.green) + h(rgb.blue);
}
function fgOf_(tf) { return tf ? hex_(tf.foregroundColorStyle) || hex_(tf.foregroundColor) : null; }
function bgOf_(ef) { return ef ? hex_(ef.backgroundColorStyle) || hex_(ef.backgroundColor) : null; }
function px_(pt) {
  if (!pt) return null;
  var px = Math.round(pt * 4 / 3);
  return Math.max(8, Math.min(48, px));
}
function esc_(t) {
  return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\r?\n/g, "<br>");
}

/** 셀 하나 → { t, s } (글자 · 칸 서식 · 글자 일부 서식). 비어 있으면 null */
function cell_(v) {
  if (!v) return null;
  var text = v.formattedValue == null ? "" : String(v.formattedValue);
  var ef = v.effectiveFormat || {}, tf = ef.textFormat || {};
  var s = {}, fg = fgOf_(tf), bg = bgOf_(ef), z = px_(tf.fontSize);
  if (tf.bold) s.b = 1;
  if (tf.italic) s.i = 1;
  if (tf.underline) s.u = 1;
  if (tf.strikethrough) s.x = 1;
  if (z && z !== BASE_PX) s.z = z;
  if (fg && fg !== "#000000") s.f = fg;
  if (bg && bg !== "#ffffff") s.g = bg;
  if (ef.wrapStrategy === "WRAP") s.wr = 1;   // 칸 안 줄바꿈 (나머지는 구글시트처럼 오른쪽으로 넘쳐 보임)
  if (!text.trim()) return s.g ? { s: { g: s.g } } : null;
  if (text.length > MAX_CELL) text = text.slice(0, MAX_CELL);
  var html = esc_(text), runs = v.textFormatRuns || [];
  if (runs.length > 1 || (runs.length === 1 && (runs[0].startIndex || 0) > 0)) {
    html = "";
    for (var i = 0; i < runs.length; i++) {
      var from = runs[i].startIndex || 0, to = i + 1 < runs.length ? runs[i + 1].startIndex : text.length;
      if (from >= text.length) break;
      var part = text.slice(from, Math.min(to, text.length)), f = runs[i].format || {}, css = [];
      var rf = fgOf_(f), rz = px_(f.fontSize);
      if (rf && rf !== (fg || "#000000")) css.push("color:" + rf);
      if (f.bold != null && !!f.bold !== !!tf.bold) css.push("font-weight:" + (f.bold ? "bold" : "normal"));
      if (f.italic != null && !!f.italic !== !!tf.italic) css.push("font-style:" + (f.italic ? "italic" : "normal"));
      if (rz && rz !== (z || BASE_PX)) css.push("font-size:" + rz + "px");
      var deco = [];
      if (f.underline || (f.underline == null && tf.underline)) deco.push("underline");
      if (f.strikethrough || (f.strikethrough == null && tf.strikethrough)) deco.push("line-through");
      if ((f.underline != null && !!f.underline !== !!tf.underline) || (f.strikethrough != null && !!f.strikethrough !== !!tf.strikethrough)) {
        css.push("text-decoration:" + (deco.length ? deco.join(" ") : "none"));
      }
      html += css.length ? '<span style="' + css.join(";") + '">' + esc_(part) + "</span>" : esc_(part);
    }
  }
  var out = { t: html };
  if (Object.keys(s).length) out.s = s;
  return out;
}

/** 탭 하나(GridData) → 홈페이지 표 { v, n, w, h, c } (비어 있으면 null) */
function toSheet_(data) {
  var rows = data.rowData || [], c = {}, w = {}, h = {}, last = -1;
  for (var r = 0; r < rows.length && r < MAX_ROWS; r++) {
    var vals = (rows[r] && rows[r].values) || [];
    for (var k = 0; k < vals.length && k < COLS; k++) {
      var x = cell_(vals[k]);
      if (!x) continue;
      c[r + "," + k] = x;
      last = Math.max(last, r);
    }
  }
  if (!Object.keys(c).some(function (k2) { return c[k2].t; })) return null;
  (data.columnMetadata || []).forEach(function (m, i) {
    if (i < COLS && m && m.pixelSize && m.pixelSize !== CW) w[i] = Math.max(20, Math.min(1500, m.pixelSize));
  });
  (data.rowMetadata || []).forEach(function (m, i) {
    if (i <= last && m && m.pixelSize && m.pixelSize !== RH) h[i] = Math.max(12, Math.min(1500, m.pixelSize));
  });
  var sheet = { v: 1, n: Math.min(MAX_ROWS, Math.max(100, last + 21)), w: w, h: h, c: c };
  if (JSON.stringify(sheet).length > MAX_JSON) {            // 너무 크면 글자 일부 서식을 빼고
    Object.keys(c).forEach(function (k3) { if (c[k3].t && /<span/.test(c[k3].t)) c[k3].t = c[k3].t.replace(/<span[^>]*>|<\/span>/g, ""); });
    while (JSON.stringify(sheet).length > MAX_JSON) {        // 그래도 크면 아래 줄부터 덜어냄
      var keys = Object.keys(c);
      if (!keys.length) return null;
      var top = Math.max.apply(null, keys.map(function (k4) { return +k4.split(",")[0]; }));
      keys.forEach(function (k5) { if (+k5.split(",")[0] === top) delete c[k5]; });
    }
  }
  return sheet;
}

/* ---------------- 통신 ---------------- */

function google_(url) {
  for (var tries = 0; tries < 4; tries++) {
    var res = UrlFetchApp.fetch(url, { headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    var code = res.getResponseCode();
    if (code === 200) return JSON.parse(res.getContentText());
    if (code === 429 || code >= 500) { Utilities.sleep(2000 * (tries + 1)); continue; }
    throw new Error("구글 " + code + ": " + res.getContentText().slice(0, 200));
  }
  throw new Error("구글이 바빠요. 다음에 다시 해요.");
}

function call_(fn, args) {
  var res = UrlFetchApp.fetch(API + fn, {
    method: "post", contentType: "application/json", headers: { apikey: PUBLIC_KEY },
    payload: JSON.stringify(args), muteHttpExceptions: true
  });
  try { return JSON.parse(res.getContentText()); } catch (e) { return { ok: false, error: "HTTP " + res.getResponseCode() }; }
}

if (typeof module !== "undefined") module.exports = { tabDate_: tabDate_, toSheet_: toSheet_, cell_: cell_ };
