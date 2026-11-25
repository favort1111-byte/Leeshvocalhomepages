/*
  학생 화면 실제 조건 검사 (원장님 2026-11-17 "학생들 시스템은 문제가 없어야 해").

  예전 점검은 가짜 데이터 몇 장 · 빠른 컴퓨터 · 정상 인터넷으로만 봐서
  내 폴더 렉 · 밤 12시 예약 지연 같은 문제를 놓쳤어요. 이 검사는 학생이 실제로 쓰는 조건으로 봅니다.

    1. 느린 휴대폰(CPU 4배 느리게) + 큰 레슨 노트(30장, 장마다 표 칸 2,600개)로 내 폴더 열기 · 탭마다 멈춤 시간
    2. 작은 화면(320 · 360px) 가로 넘침
    3. 인터넷이 잠깐 끊겼을 때 (로그인이 풀린 것처럼 보이지 않는지 · 다시 시도)
    4. 밤 12시에 새 예약 날짜가 바로 열리는지
    5. 예약 화면에 오전 · 오후와 고른 내용 한 줄이 보이는지
    7. 제휴 업체 탭: 신청 칸 없이 업체 홈페이지 링크 + 실장님 카톡 안내
    6. 카카오톡 안에서 열었을 때 마이크 안내
    8. 오디션 후기 쓰기: 학원 내방 / 본사 / 공개 고르기 · 오디션 본 날짜 · 추가 곡 2칸
   10. 내방 오디션 신청서: 2개까지 고르는 오디션은 1개만 골라도 신청됨
   11. 연습실 예약: 밤 12시에 열릴 날(모레)을 미리 보기 — 막힌 칸만 보이고 예약은 안 됨, 12시가 되면 그날이 바로 열림
    9. 보컬 오락실: 소리 장치가 멈춘 뒤(다른 앱 · 마이크 · 아이폰 interrupted)에도 다음 게임에서 소리가 나는지

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
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

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
    const chips = () => page.$$eval('#days .sys-chip:not(.sys-chip--soon)', (a) => a.map((x) => x.textContent + (x.getAttribute('aria-pressed') === 'true' ? '*' : '')));
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

  // 7. 제휴 업체 탭: 신청 칸 없이 업체 홈페이지 링크 + 실장님 카톡 안내
  console.log('\n7. 제휴 업체 탭');
  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    const wait = (ms) => page.waitForTimeout(ms);
    await enter(page, base, wait); await passConsent(page, wait);
    await page.locator('[data-book-tab="partners"]').click(); await wait(600);
    const pt = await page.evaluate(() => {
      const box = document.querySelector('#myPartners');
      const links = [...box.querySelectorAll('a.pt__name')];
      return { cats: box.querySelectorAll('.pt__cat').length, links: links.length,
        bad: links.filter((a) => !/^https?:\/\//.test(a.href) || a.target !== '_blank').length,
        small: links.filter((a) => a.getBoundingClientRect().height < 40).length,
        form: box.querySelectorAll('form, textarea, input').length, ask: (box.querySelector('.pt__ask') || {}).textContent || '' };
    });
    check('종류별로 업체가 보임', pt.cats >= 5 && pt.links >= 5, pt.cats + '종류 · 업체 ' + pt.links + '곳');
    check('업체 이름이 새 창 링크 (누르기 쉬운 크기)', pt.links > 0 && !pt.bad && !pt.small, '잘못된 링크 ' + pt.bad + ' · 작은 링크 ' + pt.small);
    check('신청 칸이 없음', pt.form === 0, '입력칸 ' + pt.form + '개');
    check('"실장님로 카톡해주세요" 안내', /sjsh54\(실장님\)로 카톡해주세요/.test(pt.ask), pt.ask.slice(0, 40));
    check('자바스크립트 오류 없음', !errs.length, errs.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // 8. 오디션 후기: 내방 / 본사 고르기 + 오디션 본 날짜 (비어 있다가 골라야 함)
  console.log('\n8. 오디션 후기 쓰기');
  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    const wait = (ms) => page.waitForTimeout(ms);
    await enter(page, base, wait); await passConsent(page, wait);
    await page.locator('[data-book-tab="reviews"]').click(); await wait(600);
    const card = await page.locator('#myReviews article.rv').first().innerText().catch(() => '');
    check('내 후기 카드에 오디션 종류 · 본 날짜', /(내방|본사|공개) 오디션/.test(card) && /오디션 본 날/.test(card), card.split('\n').slice(0, 3).join(' | '));
    await page.locator('#myReviews .rv__newbtn').click(); await wait(300);
    const form = page.locator('#myReviews .rv__new form');
    const st = { kinds: await form.locator('[name=rvkind]').count(), date: await form.locator('input[type=date]').inputValue() };
    check('새 후기: 학원 내방 / 본사 / 공개 고르는 칸', st.kinds === 3, st.kinds + '개');
    const lbl = await form.innerText();
    check('새 후기: 추가 곡 보컬곡 · 댄스곡 칸', /추가 곡 · 보컬곡/.test(lbl) && /추가 곡 · 댄스곡/.test(lbl));
    check('새 후기: 오디션 본 날짜는 비어 있음 (직접 골라야)', st.date === '', JSON.stringify(st.date));
    check('안 고르면 보내지지 않음', !(await form.evaluate((f) => f.checkValidity())));
    check('자바스크립트 오류 없음', !errs.length, errs.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // 9. 보컬 오락실: 소리 장치가 멈춰도 (다른 앱 다녀옴 · 마이크 켜고 끔 · 아이폰 "interrupted") 다음 게임에서 소리가 나는지
  //    (2026-11-18 "계이름 맞히고 다음 게임으로 가면 소리가 바로 안 남"). intr = 깨우면 풀림 · dead = 깨워도 안 풀려서 새로 만들어야 함
  console.log('\n9. 보컬 오락실 소리');
  for (const mode of ['intr', 'dead']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, permissions: ['microphone'] });
    const page = await ctx.newPage();
    await page.addInitScript(`(() => {
      const Real = window.AudioContext;
      window.__acs = []; window.__silent = 0; window.__heard = 0;
      class Fake extends Real {
        constructor(o) { super(o); window.__acs.push(this); }
        get state() { return this.__bad ? 'interrupted' : super.state; }
        resume() { if (this.__bad === 'intr') this.__bad = ''; return super.resume(); }
        createOscillator() { const o = super.createOscillator(), st = o.start.bind(o), me = this; o.start = function (t) { if (me.state === 'running') window.__heard++; else window.__silent++; return st(t); }; return o; }
      }
      window.__break = function (m) { const a = window.__acs[window.__acs.length - 1]; a.__bad = m; window.__heard = 0; window.__silent = 0; if (a.onstatechange) a.onstatechange.call(a); };
      window.AudioContext = Fake; window.webkitAudioContext = Fake;
    })();`);
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    const wait = (ms) => page.waitForTimeout(ms);
    const tag = mode === 'intr' ? '(깨우면 풀림)' : '(새로 만들어야 풀림)';
    const stat = () => page.evaluate(() => ({ state: window.__acs[window.__acs.length - 1].state, heard: window.__heard, silent: window.__silent }));
    await enter(page, base, wait);
    await page.goto(base + 'games.html', { waitUntil: 'networkidle' }); await wait(1200);
    await page.tap('[data-game="solfa"]'); await wait(500);
    await page.locator('[data-panel="solfa"] button', { hasText: '시작' }).tap(); await wait(2300);
    let r = await stat();
    check('계이름 맞히기: 소리가 남 ' + tag, r.state === 'running' && r.heard >= 6 && !r.silent, JSON.stringify(r));
    await page.locator('[data-panel="solfa"] [data-close]').first().tap(); await wait(400);
    await page.evaluate((m) => window.__break(m), mode);
    await page.tap('[data-game="simon"]'); await wait(900);
    await page.locator('[data-panel="simon"] button', { hasText: '시작' }).tap(); await wait(2300);
    r = await stat();
    check('소리 장치가 멈춘 뒤 다음 게임: 첫 소리부터 남 ' + tag, r.state === 'running' && r.heard >= 3 && !r.silent, JSON.stringify(r));
    await page.locator('[data-panel="simon"] [data-close]').first().tap(); await wait(300);
    // 마이크 게임: 마이크가 켜지는 순간 소리 장치가 멈추는 것을 흉내
    await page.tap('[data-game="target"]'); await wait(900);
    await page.evaluate((m) => { const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = (c) => g(c).then((s) => { window.__break(m); return s; }); }, mode);
    await page.locator('[data-panel="target"] button', { hasText: '시작' }).tap();
    let rms = 0;
    for (let i = 0; i < 40; i++) { await wait(100); rms = Math.max(rms, await page.evaluate(() => window.LeeshArcade.listen().rms)); }
    r = await stat();
    check('마이크 게임: 마이크를 켠 뒤에도 소리 장치가 돌고 목소리가 들어옴 ' + tag, r.state === 'running' && !r.silent && rms > 0, JSON.stringify(r) + ' · 마이크 ' + rms.toFixed(3));
    await page.locator('[data-panel="target"] [data-close]').first().tap(); await wait(300);
    check('자바스크립트 오류 없음 ' + tag, !errs.length, errs.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // 10. 내방 오디션 신청서: "2개까지" 오디션은 1개만 골라도 신청됨 + 그 안내가 크게 보임 (2026-11-18 "꼭 2개를 골라야 된다고 함")
  console.log('\n10. 내방 오디션 신청서 (2개까지 고르는 오디션)');
  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    const wait = (ms) => page.waitForTimeout(ms);
    await enter(page, base, wait);
    await page.goto(base + 'apply.html?news=44', { waitUntil: 'networkidle' }); await wait(1200);
    const help = await page.locator('.apply__pick').first().textContent().catch(() => '');
    const size = await page.locator('.apply__pick').first().evaluate((n) => parseFloat(getComputedStyle(n).fontSize)).catch(() => 0);
    check('"1개만 골라도 신청돼요" 안내가 크게 보임', /1개만 골라도 신청돼요/.test(help) && size >= 14, help + ' · ' + size + 'px');
    await page.evaluate(() => {
      document.querySelectorAll('[name=field]').forEach((c) => { if (c.checked !== (c.value === '보컬')) c.click(); });
      const g = document.querySelector('[name=gender]'); if (g && !document.querySelector('[name=gender]:checked')) g.click();
      document.querySelectorAll('form input[type=checkbox]').forEach((c) => { const t = c.closest('label') ? c.closest('label').textContent : ''; if (c.name !== 'field' && t.indexOf('카톡') === -1 && !c.checked) c.click(); });
    });
    const picked = await page.locator('.apply__picked').first().textContent().catch(() => '');
    check('1개 고르면 "이대로 신청할 수 있어요"', /1개 골랐어요/.test(picked), picked);
    // 보컬 · 랩은 같이 못 고름 (vd, 원장님 2026-11-25): 랩을 누르면 보컬이 꺼지고, 다시 보컬만으로
    const swap = await page.evaluate(() => {
      const v = document.querySelector('[name=field][value="보컬"]'), r = document.querySelector('[name=field][value="랩"]');
      r.click(); const a = (v.checked ? 'V' : '') + (r.checked ? 'R' : '');
      v.click(); const b = (v.checked ? 'V' : '') + (r.checked ? 'R' : '');
      return a + '/' + b;
    });
    check('보컬 · 랩 같이 고르면 하나가 꺼짐 (레토피아 · 디네이션)', swap === 'R/V', swap);
    await page.locator('form button[type=submit]').first().click(); await wait(1200);
    const msg = await page.evaluate(() => Array.from(document.querySelectorAll('.sys-msg')).map((m) => m.textContent).filter(Boolean).join(' | '));
    check('1개만 골라도 신청 완료', /신청했어요/.test(msg) && !/골라주세요|2개/.test(msg), msg.slice(0, 50));
    check('자바스크립트 오류 없음', !errs.length, errs.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // 11. 다음에 열릴 날 미리 보기 (선생님 의견 2026-11-20 "선생님들이 미리 예약해서 막힌 칸이 미리 보였으면")
  console.log('\n11. 연습실 예약: 모레 미리 보기');
  {
    const page = await browser.newPage({ viewport: { width: 360, height: 900 } });
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    const run = (ms) => page.clock.runFor(ms);
    const kstDay = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    await page.clock.install({ time: new Date(kstDay + 'T23:59:20+09:00') });
    await enter(page, base, run);
    await page.goto(base + 'booking.html', { waitUntil: 'networkidle' }); await run(1500);
    const soon = page.locator('#days .sys-chip--soon');
    const label = await soon.textContent().catch(() => '');
    check('"모레 … 미리 보기" 버튼', /모레 .*미리 보기/.test(label), label);
    await soon.click().catch(() => {}); await run(800);
    const taken = await page.$$eval('#board .is-taken', (a) => a.length);
    const clickable = await page.$$eval('#board button.sys-board__cell', (a) => a.length);
    const slots = await page.$$eval('.sys-slot', (a) => a.length);
    const btnOff = await page.$eval('#bookBtn', (b) => b.disabled).catch(() => false);
    const note = await page.$eval('#days', (e) => e.textContent).catch(() => '');
    check('막힌 칸이 미리 보임', taken > 0, taken + '칸');
    check('미리 보기에선 예약 못 함 (누를 칸 · 시간 버튼 없음)', clickable === 0 && slots === 0 && btnOff, clickable + ' · ' + slots + ' · ' + btnOff);
    check('"밤 12시에 열려요" 안내', /밤 12시에 열려요/.test(note), note.slice(-60));
    await run(41000);   // 0시 0분 1초쯤
    const after = await page.$$eval('#days .sys-chip', (a) => a.map((x) => x.textContent + (x.getAttribute('aria-pressed') === 'true' ? '*' : '')));
    const open = await page.$$eval('.sys-slot', (a) => a.length);
    check('12시가 되면 미리 보던 날이 바로 열림', /^내일 .*\*$/.test(after[1] || '') && open > 0, after.join(' | ') + ' · 빈 시간 ' + open);
    check('자바스크립트 오류 없음', !errs.length, errs.slice(0, 3).join(' | '));
    await page.close();
  }

  await browser.close();
  srv.close();
  const bad = results.filter((r) => !r.ok);
  console.log('\n' + (bad.length ? '❌ 실패 ' + bad.length + '개: ' + bad.map((r) => r.name).join(' / ') : '✅ ' + results.length + '가지 모두 통과'));
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('검사 중 오류: ' + (e && e.message)); process.exit(2); });
