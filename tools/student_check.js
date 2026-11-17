/*
  학생 화면 실제 조건 검사 (원장님 2026-11-17 "학생들 시스템은 문제가 없어야 해").

  예전 점검은 가짜 데이터 몇 장 · 빠른 컴퓨터 · 정상 인터넷으로만 봐서
  내 폴더 렉 · 밤 12시 예약 지연 같은 문제를 놓쳤어요. 이 검사는 학생이 실제로 쓰는 조건으로 봅니다.

    1. 느린 휴대폰(CPU 4배 느리게) + 큰 레슨 노트(30장, 장마다 표 칸 2,600개)로 내 폴더 열기 · 탭마다 멈춤 시간
    2. 작은 화면(320 · 360px) 가로 넘침
    3. 인터넷이 잠깐 끊겼을 때 (로그인이 풀린 것처럼 보이지 않는지 · 다시 시도)
    4. 밤 12시에 새 예약 날짜가 바로 열리는지
    5. 예약 화면에 오전 · 오후와 고른 내용 한 줄이 보이는지
    6. 카카오톡 안에서 열었을 때 마이크 안내

  쓰는 법 (학생 화면을 고칠 때마다, 올리기 전에):
    python3 tools/build_pages.py && python3 tools/build_preview.py <스크래치>/preview
    node tools/student_check.js <스크래치>/preview
  끝 코드 0 = 모두 통과, 1 = 실패한 것이 있음. 가짜 데이터만 씀 (실제 서버 · 학생 정보와 연결 안 됨).
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const ROOT = path.resolve(process.argv[2] || 'preview');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.mp4': 'video/mp4' };

// 멈춤 한도 (ms, CPU 4배 느리게 한 휴대폰 기준). 고치기 전 실제 학생 데이터는 합계 7,700 ~ 16,900 · 한 번에 7,600이었음.
const LIMIT = { openTotal: 2000, openMax: 1000, tabTotal: 1500, nodes: 8000 };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  — ' + detail : ''));
}

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// 실제 학생만큼 큰 레슨 노트: 30장, 장마다 A~Z × 100줄 전체에 서식 + 글 60칸 (선생님이 시트 전체에 서식을 준 경우와 같은 크기)
function heavyNotes() {
  const notes = [];
  for (let i = 0; i < 30; i++) {
    const c = {};
    for (let r = 0; r < 100; r++) for (let k = 0; k < 26; k++) c[r + ',' + k] = { s: { z: 11 } };
    for (let r = 0; r < 60; r++) c[r + ',' + (r % 3)] = { t: '연습 포인트 ' + r + ' · 호흡과 발성, 가사 전달을 천천히 확인해요', s: { z: 11, b: r % 5 === 0 ? 1 : undefined } };
    const d = new Date(Date.now() - i * 3 * 86400000).toISOString().slice(0, 10);
    notes.push({ id: 9000 + i, date: d, rich: true, teacher: '안유정', sheet: { v: 1, n: 100, c: c, h: {}, w: { 0: 150, 1: 320 } },
      songs: null, audition: null, practice: null, recommend: null, did: null });
  }
  return notes;
}

const LONG = ";window.__long=0;window.__longMax=0;try{new PerformanceObserver(function(l){l.getEntries().forEach(function(e){window.__long+=e.duration;window.__longMax=Math.max(window.__longMax,e.duration);});}).observe({entryTypes:['longtask']});}catch(e){}";

async function patchDemo(page, js) {
  await page.route('**/js/demo.js*', async (route) => {
    const r = await route.fetch();
    route.fulfill({ response: r, body: (await r.text()) + js });
  });
}

async function enter(page, base, wait) {
  await page.goto(base + 'index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.demo-student');
  await wait(2500);
}

async function passConsent(page, wait) {
  if (await page.locator('.cc__all').isVisible().catch(() => false)) {
    await page.click('.cc__all').catch(() => {});
    await page.click('.cc__submit').catch(() => {});
    await wait(1500);
  }
}

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'index.html'))) { console.error('미리보기 폴더가 없어요: ' + ROOT); process.exit(2); }
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();

  // 1. 느린 휴대폰 + 큰 레슨 노트
  console.log('\n1. 느린 휴대폰 + 큰 레슨 노트 (30장)');
  {
    const ctx = await browser.newContext({ ...devices['Galaxy S9+'] });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    const wait = (ms) => page.waitForTimeout(ms);
    const cdp = await ctx.newCDPSession(page);
    await patchDemo(page, ';(function(){var notes=' + JSON.stringify(heavyNotes()) +
      ';var orig=LeeshAPI.rpc;LeeshAPI.rpc=function(fn,a,o,x){return orig.call(LeeshAPI,fn,a,o,x).then(function(r){if(fn==="member_notebook"&&r&&r.ok){r.notes=notes;r.cctv_required=false;}return r;});};})();' + LONG);
    await page.goto(base + 'index.html', { waitUntil: 'networkidle' });
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await page.reload({ waitUntil: 'networkidle' });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.click('.demo-student');
    await page.waitForSelector('[data-book-tab="notes"]', { timeout: 60000, state: 'attached' }).catch(() => {});
    await wait(5000);
    const grab = () => page.evaluate(() => { const r = { total: Math.round(window.__long), max: Math.round(window.__longMax), nodes: document.getElementsByTagName('*').length, over: document.documentElement.scrollWidth - innerWidth }; window.__long = 0; window.__longMax = 0; return r; });
    const open = await grab();
    check('내 폴더 열 때 멈춤 합계 ' + LIMIT.openTotal + 'ms 아래', open.total < LIMIT.openTotal, open.total + 'ms');
    check('한 번에 멈추는 시간 ' + LIMIT.openMax + 'ms 아래', open.max < LIMIT.openMax, open.max + 'ms');
    check('화면 요소 ' + LIMIT.nodes + '개 아래', open.nodes < LIMIT.nodes, open.nodes + '개');
    const tabs = await page.$$eval('[data-book-tab]', (a) => a.filter((x) => !x.hidden).map((x) => x.getAttribute('data-book-tab')));
    check('내 폴더 탭이 보임', tabs.length >= 8, tabs.length + '개');
    const slow = [], wide = [];
    for (const t of tabs) {
      await page.locator('[data-book-tab="' + t + '"]').click({ timeout: 8000 }).catch(() => errs.push('탭 누르기 실패 ' + t));
      await wait(1500);
      const g = await grab();
      if (g.total >= LIMIT.tabTotal) slow.push(t + ' ' + g.total + 'ms');
      if (g.over > 1) wide.push(t + ' +' + g.over + 'px');
    }
    check('탭마다 멈춤 ' + LIMIT.tabTotal + 'ms 아래', !slow.length, slow.join(', '));
    check('탭 가로 넘침 없음', !wide.length, wide.join(', '));
    // 접힌 노트를 펼쳐도 멈추지 않는지
    await page.locator('[data-book-tab="notes"]').click().catch(() => {});
    await wait(800); await grab();
    const fold = page.locator('.lnote.is-folded .lnote__fold').first();
    if (await fold.count()) {
      await fold.click().catch(() => {}); await wait(2500);
      const g = await grab();
      check('접힌 노트 펼치기 멈춤 ' + LIMIT.tabTotal + 'ms 아래', g.total < LIMIT.tabTotal, g.total + 'ms');
    } else check('오래된 노트는 접혀 있음', false, '접힌 노트가 없어요');
    check('자바스크립트 오류 없음', !errs.length, errs.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // 2. 작은 화면 가로 넘침
  console.log('\n2. 작은 화면 (320 · 360px)');
  for (const w of [320, 360]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 740 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    const wait = (ms) => page.waitForTimeout(ms);
    await enter(page, base, wait); await passConsent(page, wait);
    const out = [];
    const tabs = await page.$$eval('[data-book-tab]', (a) => a.filter((x) => !x.hidden).map((x) => x.getAttribute('data-book-tab')));
    for (const t of tabs) {
      await page.locator('[data-book-tab="' + t + '"]').click().catch(() => {}); await wait(250);
      const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (o > 1) out.push('내 폴더/' + t + ' +' + o);
    }
    for (const pg of ['booking.html', 'games.html', 'apply.html', 'guide.html']) {
      await page.goto(base + pg, { waitUntil: 'networkidle' }); await wait(1200);
      const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (o > 1) out.push(pg + ' +' + o);
    }
    check(w + 'px 가로 넘침 없음', !out.length, out.join(', '));
    check(w + 'px 자바스크립트 오류 없음', !errs.length, errs.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // 3. 인터넷이 잠깐 끊겼을 때
  console.log('\n3. 인터넷이 잠깐 끊겼을 때');
  {
    const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    const wait = (ms) => page.waitForTimeout(ms);
    await patchDemo(page, ';(function(){var n=0,orig=LeeshAPI.rpc;LeeshAPI.rpc=function(fn,a,o,x){if(fn==="member_notebook"&&n++<1)return Promise.resolve({ok:false,error:LeeshAPI.NETWORK_ERROR,offline:true});return orig.call(LeeshAPI,fn,a,o,x);};})();');
    await enter(page, base, wait);
    const retry = page.locator('.signin__retry');
    check('"다시 시도" 버튼이 보임 (로그인 화면으로 안 돌아감)', (await retry.count()) > 0);
    if (await retry.count()) { await retry.first().click(); await wait(2500); }
    await passConsent(page, wait);
    const shown = await page.$$eval('[data-book-tab]', (a) => a.filter((x) => !x.hidden && x.offsetParent).length);
    check('다시 시도하면 내 폴더가 열림', shown >= 8, shown + '개 탭');
    check('자바스크립트 오류 없음', !errs.length, errs.slice(0, 3).join(' | '));
    await page.close();
  }

  // 4 · 5. 밤 12시 + 예약 화면
  console.log('\n4. 밤 12시에 새 날짜가 바로 열리는지');
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    const run = (ms) => page.clock.runFor(ms);
    const kstDay = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    await page.clock.install({ time: new Date(kstDay + 'T23:59:20+09:00') });
    await enter(page, base, run);
    await page.goto(base + 'booking.html', { waitUntil: 'networkidle' }); await run(1500);
    const chips = () => page.$$eval('#days .sys-chip', (a) => a.map((x) => x.textContent + (x.getAttribute('aria-pressed') === 'true' ? '*' : '')));
    const before = await chips();
    const day = (t) => ((t || '').match(/\d+\/\d+/) || [''])[0];   // "내일 11/18(수)" → "11/18"
    await page.locator('#days .sys-chip').nth(1).click(); await run(800);
    await run(40500);   // 0시 0분 1초쯤
    const after = await chips();
    check('0시가 지나면 1초 안에 날짜가 바뀜', before.length === 2 && after.length === 2 && day(after[0]) === day(before[1]), before.join(' | ') + '  →  ' + after.join(' | '));
    check('내일을 보던 학생은 새로 열린 날을 봄', /\*$/.test(after[1] || ''), after.join(' | '));
    const msg = await page.$eval('#bookMsg', (e) => e.textContent).catch(() => '');
    check('"예약이 열렸어요" 안내', /열렸어요/.test(msg), msg);
    const slots = await page.$$eval('.sys-slot', (a) => a.map((x) => x.textContent));
    check('새 날짜의 빈 시간이 보임', slots.length > 0, slots.length + '칸');

    console.log('\n5. 예약 화면 글씨');
    check('시간에 오전 · 오후가 붙어 있음', slots.length > 0 && slots.every((s) => /새벽|오전|낮|오후/.test(s)), slots.slice(0, 3).join(' · '));
    const free = page.locator('.sys-slot:not([disabled])').first();
    if (await free.count()) { await free.click().catch(() => {}); await run(500); }
    const pick = await page.$eval('#pickLabel', (e) => e.textContent).catch(() => '');
    check('고른 내용 한 줄 (날짜 · 방 · 시간)', /(오늘|내일).+(새벽|오전|낮|오후).+시간\)/.test(pick), pick);
    check('자바스크립트 오류 없음', !errs.length, errs.slice(0, 3).join(' | '));
    await page.close();
  }

  // 6. 카카오톡 안에서 마이크 안내
  console.log('\n6. 카카오톡 안에서 열었을 때');
  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 KAKAOTALK 10.4.5' });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(base + 'games.html', { waitUntil: 'networkidle' });
    const help = await page.evaluate(() => (window.LeeshArcade && LeeshArcade.micHelp && LeeshArcade.micHelp()) || '');
    check('마이크가 막히면 "다른 브라우저로 열기" 안내', /다른 브라우저/.test(help), help.slice(0, 50));
    check('자바스크립트 오류 없음', !errs.length, errs.slice(0, 3).join(' | '));
    await ctx.close();
  }

  await browser.close();
  srv.close();
  const bad = results.filter((r) => !r.ok);
  console.log('\n' + (bad.length ? '❌ 실패 ' + bad.length + '개: ' + bad.map((r) => r.name).join(' / ') : '✅ ' + results.length + '가지 모두 통과'));
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('검사 중 오류: ' + (e && e.message)); process.exit(2); });
