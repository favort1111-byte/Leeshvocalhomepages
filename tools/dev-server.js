// Local preview of the whole site with a working database, no Supabase
// account needed: local Postgres + PostgREST behind the same URLs Supabase uses.
//   node tools/dev-server.js        → http://localhost:8020
// Needs psql/Postgres and the postgrest binary (see supabase/test/local.js).
// Demo: 수강 ID S001 / 5678 (김시우), admin.html → owner@example.com / admin1234.
// The database is rebuilt on every start.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../supabase/test/local.js');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 8020;
const ADMIN = { email: 'owner@example.com', password: 'admin1234' };
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};

function readBody(req) {
  return new Promise((resolve) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => resolve(b)); });
}

// Stand-in for Supabase Auth: one admin account, password grant + refresh.
async function auth(req, res) {
  let body = {};
  try { body = JSON.parse(await readBody(req)); } catch (e) { /* empty */ }
  const grant = new URL(req.url, 'http://x').searchParams.get('grant_type');
  const ok = grant === 'refresh_token' ? body.refresh_token === 'local-refresh'
    : body.email === ADMIN.email && body.password === ADMIN.password;
  res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' });
  if (!ok) return res.end(JSON.stringify({ error: 'invalid_grant' }));
  res.end(JSON.stringify({
    access_token: L.signJwt({ email: ADMIN.email, sub: '00000000-0000-0000-0000-000000000001' }),
    refresh_token: 'local-refresh', expires_in: 3600, user: { email: ADMIN.email },
  }));
}

function proxy(req, res, target) {
  const url = new URL(req.url.replace(/^\/rest\/v1/, ''), target);
  const headers = Object.assign({}, req.headers);
  delete headers.host;
  const up = http.request(url, { method: req.method, headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(up);
}

async function seed(rest) {
  const token = L.signJwt({ email: ADMIN.email });
  const rpc = (fn, body) => fetch(rest + '/rpc/' + fn, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify(body),
  });
  await rpc('admin_save_member', { p_id: 'S001', p_name: '김시우', p_phone: '010-1234-5678', p_pin: '5678' });
  await rpc('admin_save_member', { p_id: 'S002', p_name: '이하늘', p_phone: '010-2222-9999', p_pin: '9999' });
  await rpc('admin_save_member', { p_id: 'G001', p_name: '외부 대관', p_status: '외부', p_pin: '1234', p_memo: '댄스팀' });
}

(async () => {
  L.resetDb();
  L.psql(`insert into public.admins values ('${ADMIN.email}')`);
  const pg = await L.startPostgrest();
  await seed(pg.url);

  http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/rest/v1/')) return proxy(req, res, pg.url);
    if (url.pathname === '/auth/v1/token') return auth(req, res);
    if (url.pathname === '/js/config.js') {
      const src = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8')
        .replace(/supabaseKey:\s*"[^"]*"/, 'supabaseKey: "local", local: true');
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
  }).listen(PORT, () => {
    console.log(`http://localhost:${PORT}`);
    console.log('  연습실 예약: booking.html  →  S001 / 5678');
    console.log(`  관리자:     admin.html    →  ${ADMIN.email} / ${ADMIN.password}`);
  });
  process.on('SIGINT', () => { pg.stop(); process.exit(0); });
  process.on('SIGTERM', () => { pg.stop(); process.exit(0); });
})();
