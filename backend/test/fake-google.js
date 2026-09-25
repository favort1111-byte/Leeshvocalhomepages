// In-memory fake of the Google services the Apps Script files use, so the real
// backend code can run under Node (tests + tools/dev-server.js).
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const FILES = ['Setup.gs', 'Notify.gs', 'Api.gs', 'Sheets.gs', 'Logic.gs']; // deliberately "wrong" load order
const DEFAULT_NOW = Date.parse('2026-09-25T10:20:00+09:00'); // Fri 10:20 in Seoul

/** opts.now: fixed epoch ms, or 'real' to use the actual clock. */
function fakeGoogle(opts = {}) {
  const FIXED_NOW = opts.now === 'real' ? null : (opts.now || DEFAULT_NOW);
  const sheets = [];
  const cache = new Map();
  const sent = [];
  const props = { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1' };

  function makeSheet(name) {
    const data = [];
    const sh = {
      name, data,
      getName: () => name,
      getMaxRows: () => 1000,
      getLastColumn: () => Math.max(0, ...data.map((r) => r.length)),
      getLastRow: () => data.length,
      setFrozenRows() {}, autoResizeColumns() {},
      appendRow(row) { data.push(row.slice()); },
      getDataRange() { return { getValues: () => data.map((r) => r.slice()) }; },
      getRange(r, c, nr = 1, nc = 1) {
        const range = {
          setValues(vals) { vals.forEach((row, i) => row.forEach((v, j) => { while (data.length < r + i) data.push([]); data[r + i - 1][c + j - 1] = v; })); return range; },
          setValue(v) { return range.setValues([[v]]); },
          getValues() { return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (data[r + i - 1] || [])[c + j - 1] ?? '')); },
          setFontWeight: () => range, setBackground: () => range, setNumberFormat: () => range, setDataValidation: () => range,
        };
        return range;
      },
    };
    return sh;
  }
  const ss = {
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet: (n) => { const s = makeSheet(n); sheets.push(s); return s; },
    getSheets: () => sheets,
    deleteSheet: (s) => sheets.splice(sheets.indexOf(s), 1),
    setSpreadsheetTimeZone() {},
  };
  const chain = () => new Proxy({}, { get: (_, k) => (k === 'build' ? () => ({}) : () => chain()) });

  const pad = (n) => String(n).padStart(2, '0');
  const Utilities = {
    formatDate(d, tz, fmt) {
      const k = new Date(d.getTime() + 9 * 3600e3); // Asia/Seoul, no DST
      return fmt.replace('yyyy', k.getUTCFullYear()).replace('MM', pad(k.getUTCMonth() + 1)).replace('dd', pad(k.getUTCDate()))
        .replace('HH', pad(k.getUTCHours())).replace('mm', pad(k.getUTCMinutes())).replace('ss', pad(k.getUTCSeconds()));
    },
  };
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...a) { if (a.length || FIXED_NOW == null) super(...a); else super(FIXED_NOW); }
    static now() { return FIXED_NOW == null ? RealDate.now() : FIXED_NOW; }
  }
  const ctx = {
    console, JSON, Math, String, Number, Object, Array, Error, isNaN,
    Date: FixedDate,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss, flush() {},
      getUi: () => ({ alert() {}, createMenu: () => chain() }),
      newDataValidation: () => chain(),
    },
    Utilities,
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ body: s, setMimeType() { return this; } }) },
    UrlFetchApp: { fetch: (url, opt) => { sent.push(JSON.parse(opt.payload).text); return { getResponseCode: () => 200, getContentText: () => '{}' }; } },
  };
  vm.createContext(ctx);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });

  const get = (params) => JSON.parse(ctx.doGet({ parameter: params }).body);
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).body);
  const tab = (name) => ss.getSheetByName(name).data;
  return { ctx, get, post, tab, sent, cache };
}

module.exports = { fakeGoogle };
