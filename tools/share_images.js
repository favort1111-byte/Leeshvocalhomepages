// 카톡·검색 미리보기 그림과 아이콘 만들기 (2026-10-31)
//   node tools/share_images.js  → assets/img/share.jpg (1200×630), assets/img/icon-512.png
//   그다음 python으로 icon-512.png를 줄여 icon-180.png · icon-192.png · favicon.ico(16·32·48)를 만듦 (CLAUDE.md 참고)
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
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: path.join(R, 'assets/img/share.jpg'), type: 'jpeg', quality: 86 });
  // 탭 아이콘 (원장님 2026-10-31: 학원 이름이 보이게, 진초록 바탕 + 흰 글씨): 512로 그려 두고 작은 크기는 줄여서 씀
  const ico = path.join(require('os').tmpdir(), 'leesh-icon.html');
  require('fs').writeFileSync(ico, `<!doctype html><meta charset="utf-8"><style>
    @font-face{font-family:G;src:url('${u('assets/fonts/GmarketSansMedium.woff')}')}
    *{margin:0}body{width:512px;height:512px;background:#1D4948;color:#fff;font-family:G,sans-serif;
      display:flex;flex-direction:column;align-items:center;justify-content:center;letter-spacing:-6px}
    b{font-weight:normal;font-size:166px;line-height:1}i{font-style:normal;font-size:122px;line-height:1;margin-top:28px}
  </style><b>이송희</b><i>보컬레슨</i>`);
  await pg.setViewportSize({ width: 512, height: 512 });
  await pg.goto('file://' + ico);
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: path.join(R, 'assets/img/icon-512.png') });
  await b.close();
})();
