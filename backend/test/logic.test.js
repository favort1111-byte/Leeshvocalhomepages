// Run: node --test backend/test
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../Logic.gs');

const baseCtx = () => ({
  today: '2026-09-25',
  nowMin: 10 * 60 + 20,
  maxDays: 7,
  unit: 60,
  open: 0,
  close: 1440,
  maxMinutes: 120,
  dailyMaxMinutes: 180,
  rooms: [{ name: '연습실 1' }, { name: '연습실 2' }],
  existing: [],
});
const req = (o) => Object.assign({ name: '김 시우', phone4: '1234', room: '연습실 1', date: '2026-09-26', start: '14:00', hours: 1 }, o);

test('time helpers', () => {
  assert.equal(L.toMin('09:30'), 570);
  assert.equal(L.toMin('24:00'), 1440);
  assert.ok(Number.isNaN(L.toMin('24:30')));
  assert.ok(Number.isNaN(L.toMin('9시')));
  assert.equal(L.fromMin(570), '09:30');
  assert.equal(L.last4('010-4458-5448'), '5448');
  assert.equal(L.normName(' 김 시우 '), '김시우');
  assert.ok(L.isDate('2026-02-28'));
  assert.ok(!L.isDate('2026-02-30'));
  assert.equal(L.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(L.weekday('2026-09-25'), 5); // Friday
  assert.equal(L.parseWeekday('월요일'), 1);
});

test('overlap is half-open', () => {
  assert.ok(L.overlaps(60, 120, 90, 150));
  assert.ok(!L.overlaps(60, 120, 120, 180));
});

test('free slots skip busy and past hours', () => {
  const s = L.freeSlots({ open: 540, close: 780, unit: 60, busy: [{ start: 600, end: 720 }], nowMin: 545 });
  assert.deepEqual(s, [540, 720]); // 09:00 (current hour) and 12:00
});

test('valid booking passes', () => {
  const r = L.validateBooking(req(), baseCtx());
  assert.deepEqual(r, { ok: true, start: 840, end: 900 });
});

test('rejects bad dates and range', () => {
  assert.equal(L.validateBooking(req({ date: '2026-09-24' }), baseCtx()).ok, false);
  assert.equal(L.validateBooking(req({ date: '2026-10-03' }), baseCtx()).ok, false);
  assert.equal(L.validateBooking(req({ date: '2026-10-02' }), baseCtx()).ok, true);
  assert.equal(L.validateBooking(req({ date: '26-9-26' }), baseCtx()).ok, false);
});

test('rejects unknown room, off-grid, too long, past closing', () => {
  assert.equal(L.validateBooking(req({ room: '연습실 9' }), baseCtx()).ok, false);
  assert.equal(L.validateBooking(req({ start: '14:30' }), baseCtx()).ok, false);
  assert.equal(L.validateBooking(req({ hours: 3 }), baseCtx()).ok, false);
  assert.equal(L.validateBooking(req({ hours: 1.5 }), baseCtx()).ok, false);
  assert.equal(L.validateBooking(req({ start: '23:00', hours: 2 }), baseCtx()).ok, false);
  assert.equal(L.validateBooking(req({ start: '23:00', hours: 1 }), baseCtx()).ok, true);
});

test('today: current hour ok, earlier hours rejected', () => {
  assert.equal(L.validateBooking(req({ date: '2026-09-25', start: '10:00' }), baseCtx()).ok, true);
  assert.equal(L.validateBooking(req({ date: '2026-09-25', start: '09:00' }), baseCtx()).ok, false);
});

test('rejects room clash but allows back-to-back', () => {
  const ctx = baseCtx();
  ctx.existing = [{ room: '연습실 1', date: '2026-09-26', start: 780, end: 900, name: '다른사람', phone4: '9999' }];
  assert.equal(L.validateBooking(req(), ctx).ok, false);
  assert.equal(L.validateBooking(req({ start: '15:00' }), ctx).ok, true);
  assert.equal(L.validateBooking(req({ room: '연습실 2' }), ctx).ok, true);
});

test('same student cannot hold two rooms at once or exceed daily cap', () => {
  const ctx = baseCtx();
  ctx.existing = [{ room: '연습실 2', date: '2026-09-26', start: 840, end: 960, name: '김시우', phone4: '1234' }];
  assert.match(L.validateBooking(req(), ctx).error, /같은 시간/);
  assert.equal(L.validateBooking(req({ start: '16:00', hours: 1 }), ctx).ok, true); // 2h + 1h = 3h cap
  assert.match(L.validateBooking(req({ start: '16:00', hours: 2 }), ctx).error, /하루 최대/);
  // a different student with the same name but other phone is a different person
  assert.equal(L.validateBooking(req({ phone4: '0000' }), ctx).ok, true);
});

test('cancel deadline', () => {
  const b = { date: '2026-09-25', start: 12 * 60 };
  assert.equal(L.canCancel(b, '2026-09-25', 10 * 60 + 59, 60), true);
  assert.equal(L.canCancel(b, '2026-09-25', 11 * 60 + 1, 60), false);
  assert.equal(L.canCancel({ date: '2026-09-26', start: 30 }, '2026-09-25', 23 * 60, 60), true);
});

test('consult slots follow weekly rules, closures, bookings and lead time', () => {
  const slots = L.consultSlots({
    today: '2026-09-25', // Friday
    nowMin: 13 * 60,
    leadMin: 3 * 60,
    days: 7,
    unit: 60,
    rules: [
      { weekday: 5, start: 14 * 60, end: 18 * 60 }, // Fri 14-18
      { weekday: 1, start: 11 * 60, end: 13 * 60 }, // Mon 11-13
    ],
    closed: ['2026-10-02'],
    taken: [{ date: '2026-09-28', start: 11 * 60, end: 12 * 60 }],
  });
  assert.deepEqual(slots, [
    { date: '2026-09-25', weekday: '금', times: ['16:00', '17:00'] }, // 14,15 inside lead time
    { date: '2026-09-28', weekday: '월', times: ['12:00'] },
  ]);
});
