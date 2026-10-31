// 카톡·검색 미리보기 그림과 아이콘 만들기 (2026-10-31)
//   node tools/share_images.js  → assets/img/share.jpg (1200×630), assets/img/icon-180.png, assets/img/icon-512.png, /tmp png 32·48 (favicon.ico용)
// 글씨는 저장소의 G마켓 산스, 사진은 학원 간판(assets/img/blog/sign.webp).
const { chromium } = require('playwright');
const path = require('path');
const R = path.resolve(__dirname, '..');
const u = p => 'file://' + path.join(R, p);
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1200, height: 630 } });
  const tmp = path.join(require('os').tmpdir(), 'leesh-share.html');
  require('fs').writeFileSync(tmp, `<!doctype html><meta charset="utf-8"><style>
    @font-face{font-family:G;src:url('${u('assets/fonts/GmarketSansMedium.woff')}')}
    *{margin:0;box-sizing:border-box}
    body{width:1200px;height:630px;display:flex;background:#1D4948;font-family:G,sans-serif;color:#fff}
    .pic{width:560px;height:630px;background:url('${u('assets/img/blog/sign.webp')}') 38% center/cover}
    .txt{flex:1;padding:78px 64px;display:flex;flex-direction:column;justify-content:center}
    .tag{display:inline-block;align-self:flex-start;background:#F5C518;color:#1D4948;font-size:26px;padding:10px 18px;border-radius:8px;margin-bottom:34px}
    h1{font-size:68px;letter-spacing:-1px;line-height:1.1;margin-bottom:24px}
    p{font-size:30px;line-height:1.5;color:#dce8e7}
    .url{margin-top:44px;font-size:24px;color:#F5C518;letter-spacing:.5px}
  </style><div class="pic"></div><div class="txt">
    <span class="tag">강남 선릉역 1:1 보컬학원</span>
    <h1>이송희보컬레슨</h1>
    <p>오디션 · 입시 · 전문 · 취미반<br>24시간 개인 연습실</p>
    <div class="url">leeshlesson.com</div></div>`);
  await pg.goto('file://' + tmp);  // file:// 사진·글씨는 파일로 열어야 읽힘
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: path.join(R, 'assets/img/share.jpg'), type: 'jpeg', quality: 86 });
  const svg = require('fs').readFileSync(path.join(R, 'favicon.svg'), 'utf8');
  for (const [s, out] of [[180, 'assets/img/icon-180.png'], [512, 'assets/img/icon-512.png'], [32, '/tmp/leesh-ico-32.png'], [48, '/tmp/leesh-ico-48.png']]) {
    await pg.setViewportSize({ width: s, height: s });
    // 아이폰 홈 화면 아이콘은 둥근 모서리를 기기가 깎으므로 네모 그대로
    const body = s >= 180 ? svg.replace('rx="14"', 'rx="0"') : svg;
    await pg.setContent(`<style>*{margin:0}svg{display:block;width:${s}px;height:${s}px}</style>${body}`);
    await pg.screenshot({ path: out.startsWith('/') ? out : path.join(R, out), omitBackground: true });
  }
  await b.close();
})();
