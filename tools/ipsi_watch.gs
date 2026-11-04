/**
 * 입시 요강 자동 확인 (구글 시트 "입시반 음악 관련 학과 학교 목록"에 붙이는 Apps Script)
 *
 * 하는 일 (하루 한 번):
 *  1. '자동 확인' 탭의 학교마다 입학처 공지·모집요강 페이지를 열어 본다.
 *  2. 링크 제목에 모집요강·시행계획·수시·정시 같은 말이 있는 것 중 처음 보는 것을 찾는다.
 *  3. 찾은 것은 '새 소식' 탭에 한 줄씩 적고, PDF면 드라이브 폴더에 저장한다.
 *  4. 새 소식이 있으면 시트 주인에게 이메일을 보낸다.
 *
 * 처음 한 번 학교를 볼 때는 지금 있는 링크를 "이미 본 것"으로만 기억한다 (알림 폭탄 방지).
 * 4분이 넘으면 멈추고, 남은 학교는 다음 실행 때 이어서 본다 (Apps Script 한 번 실행 한도 6분).
 *
 * 설치: 시트 → 확장 프로그램 → Apps Script → 이 코드 붙여넣기 → 저장
 *       → 위 메뉴에서 setup 실행(권한 허용) → 시트를 새로 고치면 "입시 요강" 메뉴가 생김.
 */

var CFG = {
  WATCH_TAB: '자동 확인',
  NEWS_TAB: '새 소식',
  SEEN_TAB: '_본 링크',
  FOLDER_NAME: '입시 모집요강 자동 수집',
  HOUR: 4,                 // 매일 새벽 4시쯤 (한국 시간)
  TIME_LIMIT_MS: 4 * 60 * 1000,   // 한 번 실행 한도 6분보다 여유 있게
  BATCH: 15,               // 한꺼번에 여는 페이지 수
  MAX_PDF_MB: 30,
  // 링크 제목에 이 말 중 하나가 있으면 입시 소식으로 본다
  KEYWORDS: ['모집요강', '모집 요강', '입시요강', '입시 요강', '시행계획', '시행 계획',
             '신입생 모집', '신입생모집', '수시', '정시', '실기고사', '실기 고사',
             '전형 안내', '전형안내', '입학전형', '입학 전형', '원서접수', '원서 접수'],
  // 이런 말만 있는 링크는 뺀다 (편입·대학원·외국인 등)
  EXCLUDE: ['대학원', '편입', '외국인', '재외국민', '교직원', '채용', '장학', '기숙사', '수강신청', '졸업',
            '합격자', '추가합격', '충원', '등록금', '예치금', '등록 안내', '고사장', '수험표']
};

var TZ = 'Asia/Seoul';

/* ---------------- 메뉴 ---------------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('입시 요강')
    .addItem('지금 확인하기', 'dailyCheck')
    .addItem('매일 자동 확인 켜기', 'setup')
    .addItem('매일 자동 확인 끄기', 'stopTrigger')
    .addToUi();
}

/** 처음 한 번: 탭 만들기 + 매일 트리거 1개 켜기 (같은 트리거가 있으면 지우고 다시 만듦) */
function setup() {
  ensureTabs_();
  stopTrigger();
  ScriptApp.newTrigger('dailyCheck').timeBased().everyDays(1).atHour(CFG.HOUR).inTimezone(TZ).create();
  toast_('매일 새벽 ' + CFG.HOUR + '시쯤 자동 확인을 켰습니다.');
}

function stopTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyCheck') ScriptApp.deleteTrigger(t);
  });
}

/* ---------------- 본 작업 ---------------- */

function dailyCheck() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;           // 이미 돌고 있으면 그만
  try { run_(); } finally { lock.releaseLock(); }
}

function run_() {
  var start = Date.now();
  var ss = SpreadsheetApp.getActive();
  ensureTabs_();
  var watch = ss.getSheetByName(CFG.WATCH_TAB);
  var last = watch.getLastRow();
  if (last < 4) return;

  // 자동 확인 탭: 4행부터. A 학교명 · B 구분 · C 확인할 주소 · D 더 찾을 말 · E 마지막 확인 · F 결과 · G 마지막 새 소식
  var rows = watch.getRange(4, 1, last - 3, 7).getValues();
  var props = PropertiesService.getScriptProperties();
  var cursor = Number(props.getProperty('cursor') || 0);
  if (cursor >= rows.length) cursor = 0;

  var seen = loadSeen_();
  var allNews = [];
  var folder = null;
  var now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');

  var i = cursor;
  while (i < rows.length && Date.now() - start < CFG.TIME_LIMIT_MS) {
    var batch = [], j;
    for (j = i; j < rows.length && batch.length < CFG.BATCH; j++) {
      var url = String(rows[j][2] || '').trim();
      if (!/^https?:\/\//i.test(url)) { rows[j][4] = now; rows[j][5] = '주소 없음'; continue; }
      batch.push({ idx: j, url: url });
    }
    var resps = fetchMany_(batch.map(function (b) { return b.url; }));
    var newsOut = [], seenOut = [];

    batch.forEach(function (b, k) {
      var row = rows[b.idx];
      var school = String(row[0]);
      row[4] = now;
      var res = resps[k];
      if (!res || res.getResponseCode() >= 400) {
        row[5] = '열기 실패' + (res ? ' (' + res.getResponseCode() + ')' : '');
        return;
      }
      var html = decode_(res);
      var links = extractLinks_(html, b.url, String(row[3] || ''));
      var first = !seen.schools[school];        // 처음 보는 학교면 지금 링크는 기억만
      if (first) { seen.schools[school] = true; seenOut.push([school, '(처음 확인)', now]); }
      var found = 0;
      links.forEach(function (l) {
        var key = school + '|' + l.title;
        if (seen.keys[key]) return;
        seen.keys[key] = true;
        seenOut.push([school, l.title, now]);
        if (first) return;
        found++;
        if (!folder) folder = getFolder_();
        var pdf = findPdf_(l, b.url, school, folder);
        newsOut.push([now, school, row[1], l.title, l.href, pdf, '새 것', '']);
      });
      if (!links.length) row[5] = html.length < 3000 ? '내용 없음 (스크립트 화면일 수 있음)' : '정상 (입시 링크 없음)';
      else row[5] = first ? '정상 (처음 확인, 기억만 함)' : '정상';
      if (found) row[6] = now + ' · ' + found + '건';
    });

    // 묶음마다 바로 적기 (중간에 멈춰도 한 묶음만 잃음)
    watch.getRange(4 + i, 1, j - i, 7).setValues(rows.slice(i, j));
    if (seenOut.length) {
      var st = ss.getSheetByName(CFG.SEEN_TAB);
      st.getRange(st.getLastRow() + 1, 1, seenOut.length, 3).setValues(seenOut);
    }
    if (newsOut.length) {
      var nt = ss.getSheetByName(CFG.NEWS_TAB);
      nt.insertRowsAfter(3, newsOut.length);
      nt.getRange(4, 1, newsOut.length, 8).setValues(newsOut);   // 최신이 위로
      allNews = allNews.concat(newsOut);
    }
    i = j;
    props.setProperty('cursor', String(i >= rows.length ? 0 : i));
    SpreadsheetApp.flush();
  }
  if (allNews.length) mail_(allNews, ss);
  props.setProperty('lastRun', now + ' · ' + Math.round((Date.now() - start) / 1000) + '초');
}

/* ---------------- 도우미 ---------------- */

function decode_(res) {
  var blob = res.getBlob();
  var ct = String(res.getHeaders()['Content-Type'] || res.getHeaders()['content-type'] || '');
  var cs = (ct.match(/charset=([\w-]+)/i) || [])[1];
  if (!cs) {
    var head = blob.getDataAsString('ISO-8859-1').slice(0, 3000);
    cs = (head.match(/charset=["']?([\w-]+)/i) || [])[1];
  }
  cs = (cs || 'UTF-8').toUpperCase();
  if (/^(KS_C_5601|KSC5601|X-WINDOWS-949|CP949|MS949)/.test(cs)) cs = 'EUC-KR';
  try { return blob.getDataAsString(cs); } catch (e) { return blob.getDataAsString('UTF-8'); }
}

function extractLinks_(html, base, extra) {
  var words = CFG.KEYWORDS.concat(extra ? extra.split(/[,·\/]/).map(function (s) { return s.trim(); }).filter(String) : []);
  var out = [], done = {};
  var re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(html))) {
    var attrs = m[1];
    var title = m[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
                    .replace(/\s+/g, ' ').trim();
    if (!title) { var t = attrs.match(/title=["']([^"']+)["']/i); title = t ? t[1].trim() : ''; }
    if (title.length < 4 || title.length > 200) continue;
    if (!words.some(function (w) { return title.indexOf(w) >= 0; })) continue;
    if (CFG.EXCLUDE.some(function (w) { return title.indexOf(w) >= 0; })) continue;
    if (done[title]) continue;
    done[title] = true;
    var hrefM = attrs.match(/href\s*=\s*["']([^"']*)["']/i);
    var href = hrefM ? hrefM[1].replace(/&amp;/g, '&') : '';
    if (!href || /^(javascript:|#)/i.test(href)) href = base;      // 누르면 스크립트로 여는 링크 → 페이지 주소로
    href = absUrl_(href, base);
    var maybeFile = /\.pdf(\?|$)/i.test(href) || /(download|filedown|fileDown|atchFile|attach|file_down|getFile)/i.test(href);
    out.push({ title: title, href: href, maybeFile: maybeFile });
  }
  return out;
}

function fetchMany_(urls) {
  var opt = { muteHttpExceptions: true, followRedirects: true, validateHttpsCertificates: false,
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
                         'Accept-Language': 'ko-KR,ko;q=0.9' } };
  if (!urls.length) return [];
  try {
    return UrlFetchApp.fetchAll(urls.map(function (u) { var o = JSON.parse(JSON.stringify(opt)); o.url = u; return o; }));
  } catch (e) {   // 한 곳이라도 주소를 못 찾으면 묶음 전체가 실패 → 하나씩
    return urls.map(function (u) { try { return UrlFetchApp.fetch(u, opt); } catch (e2) { return null; } });
  }
}

/** 새 공지에서 PDF 찾기: 링크가 바로 파일이면 저장, 공지 글이면 글을 열어 첨부 PDF를 저장 (최대 2개) */
function findPdf_(l, base, school, folder) {
  if (l.maybeFile) return savePdf_(l.href, school, l.title, folder);
  if (l.href === base) return '';
  var res = fetchMany_([l.href])[0];
  if (!res || res.getResponseCode() >= 400) return '';
  var html = decode_(res), re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi, m, saved = [];
  while ((m = re.exec(html)) && saved.length < 2) {
    var h = (m[1].match(/href\s*=\s*["']([^"']*)["']/i) || [])[1];
    var txt = m[2].replace(/<[^>]+>/g, ' ');
    if (!h || /^(javascript:|#)/i.test(h)) continue;
    if (!(/\.pdf(\?|$)/i.test(h) || /\.pdf/i.test(txt) || /(download|filedown|atchFile|attach|file_down|getFile)/i.test(h))) continue;
    if (/\.(hwp|hwpx|xlsx?|docx?|zip|jpg|png)\b/i.test(txt)) continue;
    var u = savePdf_(absUrl_(h.replace(/&amp;/g, '&'), l.href), school, l.title + (saved.length ? ' ' + (saved.length + 1) : ''), folder);
    if (u && u.indexOf('http') === 0) saved.push(u);
  }
  return saved.join('\n');
}

function absUrl_(href, base) {
  if (/^https?:\/\//i.test(href)) return href;
  var origin = base.match(/^(https?:\/\/[^\/]+)/i)[1];
  if (href.indexOf('//') === 0) return base.split(':')[0] + ':' + href;
  if (href.charAt(0) === '/') return origin + href;
  var dir = base.split('?')[0].replace(/[^\/]*$/, '');
  return dir + href;
}

function savePdf_(url, school, title, folder) {
  try {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, validateHttpsCertificates: false });
    if (res.getResponseCode() >= 400) return '';
    var blob = res.getBlob();
    var bytes = blob.getBytes();
    if (bytes.length > CFG.MAX_PDF_MB * 1024 * 1024) return '너무 큼';
    if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) return '';   // %PDF 아님
    var name = (school + '_' + title).replace(/[\\\/:*?"<>|]/g, ' ').slice(0, 120) + '.pdf';
    var file = folder.createFile(blob.setName(name).setContentType('application/pdf'));
    return file.getUrl();
  } catch (e) { return ''; }
}

function getFolder_() {
  var it = DriveApp.getFoldersByName(CFG.FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CFG.FOLDER_NAME);
}

function loadSeen_() {
  var st = SpreadsheetApp.getActive().getSheetByName(CFG.SEEN_TAB);
  var n = st.getLastRow();
  var keys = {}, schools = {};
  if (n >= 2) {
    st.getRange(2, 1, n - 1, 2).getValues().forEach(function (r) {
      keys[r[0] + '|' + r[1]] = true; schools[r[0]] = true;
    });
  }
  return { keys: keys, schools: schools };
}

function mail_(news, ss) {
  var to = Session.getEffectiveUser().getEmail();
  if (!to) return;
  var body = '입시 요강 새 소식 ' + news.length + '건\n\n' +
    news.map(function (r) { return '· ' + r[1] + ' — ' + r[3] + '\n  ' + r[4] + (r[5] && r[5].indexOf('http') === 0 ? '\n  PDF: ' + r[5] : ''); }).join('\n') +
    '\n\n시트: ' + ss.getUrl() + '#gid=' + ss.getSheetByName(CFG.NEWS_TAB).getSheetId();
  MailApp.sendEmail(to, '[입시 요강] 새 소식 ' + news.length + '건', body);
}

function ensureTabs_() {
  var ss = SpreadsheetApp.getActive();
  if (!ss.getSheetByName(CFG.NEWS_TAB)) {
    var nt = ss.insertSheet(CFG.NEWS_TAB);
    nt.getRange(1, 1).setValue('새 소식 (자동 확인이 찾은 입시 공지, 최신이 위)').setFontWeight('bold').setFontSize(14);
    nt.getRange(2, 1).setValue("'처리' 칸: 새 것 → Claude 입력함 / 확인함 / 관계없음. 자동으로 찾은 것이라 관계없는 공지도 섞일 수 있습니다.").setFontStyle('italic');
    nt.getRange(3, 1, 1, 8).setValues([['찾은 날', '학교명', '구분', '공지 제목', '링크', 'PDF (드라이브)', '처리', '메모']])
      .setFontWeight('bold').setBackground('#1D4948').setFontColor('#FFFFFF');
    nt.setFrozenRows(3);
  }
  if (!ss.getSheetByName(CFG.SEEN_TAB)) {
    var st = ss.insertSheet(CFG.SEEN_TAB);
    st.getRange(1, 1, 1, 3).setValues([['학교명', '링크 제목', '처음 본 때']]).setFontWeight('bold');
    st.hideSheet();
  }
}

function toast_(msg) {
  try { SpreadsheetApp.getActive().toast(msg, '입시 요강', 8); } catch (e) {}
}
