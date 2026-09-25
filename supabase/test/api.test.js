// End-to-end tests: schema.sql on a local Postgres, called over HTTP through
// PostgREST exactly the way the website and admin page call Supabase.
//   node --test supabase/test/
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./local.js');

let pg;
const ADMIN = L.signJwt({ email: 'owner@example.com', sub: '00000000-0000-0000-0000-000000000001' });
const STRANGER = L.signJwt({ email: 'someone@example.com', sub: '00000000-0000-0000-0000-000000000002' });

async function call(path, { method = 'POST', body, token } = {}) {
  const headers = { 'content-type': 'application/json', prefer: 'return=representation' };
  if (token) headers.authorization = 'Bearer ' + token;
  const r = await fetch(pg.url + path, { method, headers, body: body == null ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, data: text ? JSON.parse(text) : null };
}
const rpc = async (fn, args, token) => (await call('/rpc/' + fn, { body: args || {}, token })).data;

const SIWOO = { p_id: 's001', p_pin: '5678' };
const book = (extra, who = SIWOO) =>
  rpc('booking_create', Object.assign({ p_room: '연습실 1', p_date: '2026-10-01', p_start: '14:00', p_hours: 1 }, who, extra));

test.before(async () => {
  L.resetDb();
  L.psql("insert into public.admins values ('owner@example.com')");
  pg = await L.startPostgrest();
});
test.after(() => pg && pg.stop());

test.beforeEach(async () => {
  L.psql('truncate public.bookings, public.consults, private.login_fails; delete from public.members');
  L.setClock('2026-10-01 10:20');
  for (const m of [
    { p_id: 'S001', p_name: '김시우', p_pin: '5678' },
    { p_id: 'S002', p_name: '이하늘', p_pin: '9999' },
    { p_id: 'S003', p_name: '휴원생', p_pin: '1111', p_status: '휴원' },
    { p_id: 'G001', p_name: '외부손님', p_pin: '2222', p_status: '외부', p_expires_on: '2026-09-30' },
  ]) {
    const r = await rpc('admin_save_member', m, ADMIN);
    assert.equal(r.ok, true, JSON.stringify(r));
  }
});

test('rooms_day lists six rooms and hides past hours today', async () => {
  const r = await rpc('rooms_day', {});
  assert.equal(r.ok, true);
  assert.equal(r.date, '2026-10-01');
  assert.equal(r.rooms.length, 6);
  assert.equal(r.rooms[5].name, '춤연습실');
  assert.equal(r.rooms[0].free[0], '10:00'); // the hour in progress is still bookable
  assert.equal(r.days.length, 8);
  const later = await rpc('rooms_day', { p_date: '2026-10-02' });
  assert.equal(later.rooms[0].free[0], '00:00');
  assert.equal(later.rooms[0].free.length, 24);
  assert.equal((await rpc('rooms_day', { p_date: '2026-10-20' })).ok, false);
  assert.equal((await rpc('rooms_day', { p_date: 'nope' })).ok, false);
});

test('login: ID is case-insensitive, wrong PIN / inactive / expired are refused', async () => {
  const ok = await rpc('member_login', SIWOO);
  assert.deepEqual(ok, { ok: true, id: 'S001', name: '김시우', bookings: [] });
  assert.match((await rpc('member_login', { p_id: 'S001', p_pin: '0000' })).error, /맞지 않습니다/);
  assert.match((await rpc('member_login', { p_id: 'NOPE', p_pin: '0000' })).error, /맞지 않습니다/);
  assert.match((await rpc('member_login', { p_id: 'S003', p_pin: '1111' })).error, /이용 중인/);
  assert.match((await rpc('member_login', { p_id: 'G001', p_pin: '2222' })).error, /기한/);
  assert.match((await rpc('member_login', { p_id: 'S001', p_pin: '12' })).error, /4자리/);
});

test('ten wrong PINs lock the ID for 15 minutes, and a PIN reset unlocks it', async () => {
  for (let i = 0; i < 10; i++) await rpc('member_login', { p_id: 'S001', p_pin: '0000' });
  assert.match((await rpc('member_login', SIWOO)).error, /여러 번/);
  await rpc('admin_save_member', { p_id: 'S001', p_name: '김시우', p_pin: '4321' }, ADMIN);
  assert.equal((await rpc('member_login', { p_id: 'S001', p_pin: '4321' })).ok, true);
});

test('booking: create, shows in my list, blocks the slot for everyone', async () => {
  const r = await book({ p_hours: 2 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual({ ...r.booking, id: 0 }, { id: 0, room: '연습실 1', date: '2026-10-01', start: '14:00', end: '16:00' });

  const mine = await rpc('member_login', SIWOO);
  assert.equal(mine.bookings.length, 1);
  assert.equal(mine.bookings[0].cancellable, true);

  const day = await rpc('rooms_day', {});
  assert.ok(!day.rooms[0].free.includes('14:00'));
  assert.ok(!day.rooms[0].free.includes('15:00'));
  assert.ok(day.rooms[0].free.includes('16:00'));
  assert.ok(day.rooms[1].free.includes('14:00'));

  const clash = await book({ p_start: '15:00' }, { p_id: 'S002', p_pin: '9999' });
  assert.match(clash.error, /다른 예약/);
});

test('booking rules: max length, daily max, same person two rooms, past, unit, range, room', async () => {
  assert.match((await book({ p_hours: 3 })).error, /최대 2시간/);
  assert.equal((await book({ p_start: '12:00', p_hours: 2 })).ok, true);
  assert.match((await book({ p_room: '연습실 2', p_start: '13:00' })).error, /다른 연습실/);
  assert.match((await book({ p_start: '18:00', p_hours: 2 })).error, /하루 최대 3시간.*이미 2시간/);
  assert.equal((await book({ p_start: '18:00', p_hours: 1 })).ok, true);
  assert.match((await book({ p_start: '09:00' }, { p_id: 'S002', p_pin: '9999' })).error, /지난 시간/);
  assert.match((await book({ p_start: '14:30' }, { p_id: 'S002', p_pin: '9999' })).error, /60분 단위/);
  assert.match((await book({ p_start: '23:00', p_hours: 2 }, { p_id: 'S002', p_pin: '9999' })).error, /운영 시간/);
  assert.match((await book({ p_date: '2026-10-09' }, { p_id: 'S002', p_pin: '9999' })).error, /7일 뒤까지/);
  assert.match((await book({ p_date: '2026-09-30' }, { p_id: 'S002', p_pin: '9999' })).error, /지난 날짜/);
  assert.match((await book({ p_room: '없는방' }, { p_id: 'S002', p_pin: '9999' })).error, /찾을 수 없습니다/);
  assert.match((await book({}, { p_id: 'S002', p_pin: '0000' })).error, /맞지 않습니다/);
  assert.equal((await book({ p_start: '23:00', p_hours: 1 }, { p_id: 'S002', p_pin: '9999' })).ok, true);
});

test('simultaneous requests for the same slot: exactly one wins', async () => {
  const ids = ['S001', 'S002'];
  L.psql("update public.members set pin_hash = (select pin_hash from public.members where id = 'S001')");
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
    book({ p_start: '20:00' }, { p_id: ids[i % 2], p_pin: '5678' })));
  assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
  assert.equal(L.psql("select count(*) from public.bookings where status = '확정'"), '1');
});

test('one person racing for 3 rooms cannot exceed the daily max', async () => {
  const results = await Promise.all(['연습실 1', '연습실 2', '연습실 3'].map((room, i) =>
    book({ p_room: room, p_start: ['12:00', '15:00', '18:00'][i], p_hours: 2 })));
  assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
});

test('cancel: allowed until 60 minutes before, only your own', async () => {
  const a = (await book({ p_start: '11:00' })).booking;
  const b = (await book({ p_start: '14:00' })).booking;
  const mine = await rpc('member_login', SIWOO);
  assert.deepEqual(mine.bookings.map((x) => x.cancellable), [false, true]);

  assert.match((await rpc('booking_cancel', { ...SIWOO, p_booking: a.id })).error, /60분 전/);
  assert.match((await rpc('booking_cancel', { p_id: 'S002', p_pin: '9999', p_booking: b.id })).error, /찾을 수 없습니다/);
  assert.equal((await rpc('booking_cancel', { ...SIWOO, p_booking: b.id })).ok, true);
  assert.match((await rpc('booking_cancel', { ...SIWOO, p_booking: b.id })).error, /찾을 수 없습니다/);
  assert.ok((await rpc('rooms_day', {})).rooms[0].free.includes('14:00'));
});

test('my list drops bookings that already ended', async () => {
  await book({ p_start: '10:00' });
  L.setClock('2026-10-01 11:05');
  assert.equal((await rpc('member_login', SIWOO)).bookings.length, 0);
});

test('guest ID works until its expiry date', async () => {
  await rpc('admin_save_member', { p_id: 'G001', p_name: '외부손님', p_status: '외부', p_expires_on: '2026-10-01' }, ADMIN);
  assert.equal((await book({}, { p_id: 'G001', p_pin: '2222' })).ok, true);
});

test('consult: validates, formats the phone, rate-limits, ignores bots', async () => {
  assert.match((await rpc('consult_create', { p_name: '', p_phone: '01012345678' })).error, /이름/);
  assert.match((await rpc('consult_create', { p_name: '홍길동', p_phone: '123' })).error, /연락처/);
  const r = await rpc('consult_create', { p_name: '홍길동', p_phone: '010 1234 5678', p_method: '방문 상담', p_wish: '토요일 오후', p_track: '취미반' });
  assert.deepEqual(r, { ok: true, method: '방문 상담' });
  assert.equal(L.psql('select phone || wish from public.consults'), '010-1234-5678토요일 오후');
  await rpc('consult_create', { p_name: '홍길동', p_phone: '01012345678' });
  await rpc('consult_create', { p_name: '홍길동', p_phone: '01012345678' });
  assert.match((await rpc('consult_create', { p_name: '홍길동', p_phone: '01012345678' })).error, /여러 번/);
  assert.equal((await rpc('consult_create', { p_name: 'bot', p_phone: '01099998888', p_website: 'x' })).ok, true);
  assert.equal(L.psql("select count(*) from public.consults where name = 'bot'"), '0');
});

test('tables are closed to visitors and to signed-in non-admins', async () => {
  for (const t of ['bookings', 'members', 'consults', 'rooms', 'settings']) {
    assert.equal((await call('/' + t, { method: 'GET' })).status, 401, t);
    const asStranger = await call('/' + t, { method: 'GET', token: STRANGER });
    assert.ok([401, 403].includes(asStranger.status) || (asStranger.status === 200 && asStranger.data.length === 0), t);
  }
  assert.match((await rpc('admin_save_member', { p_id: 'X1', p_name: 'x', p_pin: '1234' }, STRANGER)).error, /관리자/);
  assert.equal((await call('/rpc/admin_save_member', { body: { p_id: 'X1', p_name: 'x', p_pin: '1234' } })).status, 401);
});

test('admin: reads bookings with names, blocks a slot, cannot read PIN hashes', async () => {
  await book({});
  const list = await call('/bookings?select=id,day,start_min,rooms(name),members(name)&day=eq.2026-10-01', { method: 'GET', token: ADMIN });
  assert.equal(list.status, 200);
  assert.equal(list.data[0].members.name, '김시우');

  const block = await call('/bookings', { body: { room_id: 1, day: '2026-10-01', start_min: 1200, end_min: 1320, memo: '청소' }, token: ADMIN });
  assert.equal(block.status, 201);
  assert.ok(!(await rpc('rooms_day', {})).rooms[0].free.includes('20:00'));
  const overlap = await call('/bookings', { body: { room_id: 1, day: '2026-10-01', start_min: 840, end_min: 900 }, token: ADMIN });
  assert.ok(overlap.status >= 400, String(overlap.status));
  assert.match(overlap.data.message, /bookings_no_room_overlap/);

  assert.equal((await call('/members?select=id,name', { method: 'GET', token: ADMIN })).data.length, 4);
  assert.notEqual((await call('/members?select=pin_hash', { method: 'GET', token: ADMIN })).status, 200);

  const upd = await call('/settings?id=eq.1', { method: 'PATCH', body: { max_minutes: 180 }, token: ADMIN });
  assert.equal(upd.status, 200);
  assert.equal((await book({ p_room: '연습실 2', p_start: '17:00', p_hours: 2 }, { p_id: 'S002', p_pin: '9999' })).ok, true);
});
