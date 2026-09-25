// Local preview: serves the site and runs the real Apps Script backend on an
// in-memory fake sheet, so booking/consult work without deploying anything.
//   node tools/dev-server.js        → http://localhost:8020
// Demo students: 김시우 / 5678, 이하늘 / 9999. Data resets on restart.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { fakeGoogle } = require('../backend/test/fake-google.js');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 8020;
const g = fakeGoogle({ now: 'real' });
g.ctx.setupSheets();
g.tab('수강생').push(['김시우', '010-1234-5678', '재원', ''], ['이하늘', '010-2222-9999', '재원', '']);
g.sent.length = 0;

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api') {
    const send = (out) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(out.body); };
    if (req.method === 'GET') return send(g.ctx.doGet({ parameter: Object.fromEntries(url.searchParams) }));
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      send(g.ctx.doPost({ postData: { contents: body } }));
      g.sent.splice(0).forEach((m) => console.log('[텔레그램 알림]\n' + m + '\n'));
    });
    return;
  }
  if (url.pathname === '/js/config.js') {
    const src = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8').replace(/api:\s*"[^"]*"/, 'api: "/api"');
    res.writeHead(200, { 'content-type': TYPES['.js'] });
    return res.end(src);
  }
  const file = path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`http://localhost:${PORT}  (연습실 예약 체험: 김시우 / 5678)`));
