// A local stand-in for the Supabase project: plain Postgres + PostgREST (the
// same REST server Supabase runs), with schema.sql loaded on top of a small
// shim. Used by the tests and by tools/dev-server.js.
//
// Needs: psql + a local Postgres, and the postgrest binary (POSTGREST env or on PATH).
//   LEESH_DB   admin connection string   (default postgresql://postgres:postgres@localhost:5432/leesh)
const { execFileSync, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const net = require('node:net');

const DIR = __dirname;
const DB = process.env.LEESH_DB || 'postgresql://postgres:postgres@localhost:5432/leesh';
const JWT_SECRET = 'local-only-secret-local-only-secret-0123';

function psql(sqlText, db = DB) {
  return execFileSync('psql', [db, '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sqlText], { encoding: 'utf8' }).trim();
}

function psqlFile(file, db = DB) {
  execFileSync('psql', [db, '-q', '-v', 'ON_ERROR_STOP=1', '-f', file], { stdio: ['ignore', 'ignore', 'pipe'] });
}

/** Drop and recreate the local database with the shim + schema.sql. */
function resetDb() {
  const url = new URL(DB);
  const name = url.pathname.slice(1);
  url.pathname = '/postgres';
  psql(`drop database if exists ${name} with (force)`, url.toString());
  psql(`create database ${name}`, url.toString());
  psqlFile(path.join(DIR, 'local-shim.sql'));
  psqlFile(path.join(DIR, '..', 'schema.sql'));
}

/** Pin the database clock (Korean local time, 'YYYY-MM-DD HH:MM'), or null for the real time. */
function setClock(kst) {
  psql(kst ? `update private.clock set fixed_kst = '${kst}'` : 'update private.clock set fixed_kst = null');
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** A Supabase-style access token for a signed-in user. */
function signJwt(claims) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(Object.assign({ role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }, claims)));
  const sig = b64url(crypto.createHmac('sha256', JWT_SECRET).update(head + '.' + body).digest());
  return head + '.' + body + '.' + sig;
}

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, () => { const p = srv.address().port; srv.close(() => resolve(p)); });
  });
}

/** Start PostgREST against the local DB. Resolves to { url, stop }. */
async function startPostgrest() {
  const port = await freePort();
  const db = new URL(DB);
  db.username = 'authenticator';
  db.password = 'local';
  const child = spawn(process.env.POSTGREST || 'postgrest', [], {
    env: Object.assign({}, process.env, {
      PGRST_DB_URI: db.toString(),
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: JWT_SECRET,
      PGRST_SERVER_PORT: String(port),
      PGRST_DB_POOL: '10',
      PGRST_LOG_LEVEL: 'crit',
    }),
    stdio: 'ignore',
  });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url + '/')).ok) return { url, stop: () => child.kill() }; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error('PostgREST did not start');
}

module.exports = { psql, resetDb, setClock, signJwt, startPostgrest, JWT_SECRET };
