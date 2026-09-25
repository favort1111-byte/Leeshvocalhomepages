// End-to-end run of the Apps Script files against an in-memory fake of the
// Google services they use. Run: node --test backend/test/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeGoogle } = require('./fake-google.js');

function ready() {
  const g = fakeGoogle();
  g.ctx.setupSheets();
  const students = g.tab('수강생');
  students.push(['김시우', '010-1234-5678', '재원', '']);
  students.push(['이하늘', '010-2222-9999', '재원', '']);
  students.push(['박휴원', '010-3333-4444', '휴원', '']);
  return g;
}

test('setup creates every tab once and never overwrites', () => {
  const g = fakeGoogle();
  g.ctx.setupSheets();
  const names = ['설정', '콘텐츠', '합격실적', '수강료', '연습실', '수강생', '연습실예약', '상담가능시간', '휴무일', '상담', '로그'];
  names.forEach((n) => assert.ok(g.tab(n), n));
  g.tab('콘텐츠')[1][1] = '바꾼 제목';
  g.ctx.setupSheets();
  assert.equal(g.tab('콘텐츠')[1][1], '바꾼 제목');
});

test('content returns keys and visible lists, cached until an edit', () => {
  const g = ready();
  let r = g.get({ action: 'content' });
  assert.equal(r.ok, true);
  assert.equal(r.content['contact.title'], "let's connect");
  assert.ok(r.lists.results.length > 5);
  assert.equal(r.lists.pricing[0].name, '오디션반 (1)');

  g.tab('콘텐츠')[1][1] = 'new title';
  assert.notEqual(g.get({ action: 'content' }).content['about.title'], 'new title'); // still cached
  g.ctx.onEdit({ range: { getSheet: () => ({ getName: () => '콘텐츠' }) } });
  assert.equal(g.get({ action: 'content' }).content['about.title'], 'new title');
});

test('rooms: today starts at the current hour, window is 7 days', () => {
  const g = ready();
  const r = g.get({ action: 'rooms' });
  assert.equal(r.date, '2026-09-25');
  assert.equal(r.days.length, 8);
  assert.equal(r.rooms.length, 3);
  assert.equal(r.rooms[0].free[0], '10:00');
  assert.equal(g.get({ action: 'rooms', date: '2026-10-09' }).ok, false);
});

test('identity check: unknown, wrong digits, not enrolled, example row', () => {
  const g = ready();
  assert.match(g.post({ action: 'booking.mine', name: '없는사람', phone4: '1234' }).error, /찾을 수 없습니다/);
  assert.match(g.post({ action: 'booking.mine', name: '김시우', phone4: '0000' }).error, /찾을 수 없습니다/);
  assert.match(g.post({ action: 'booking.mine', name: '박휴원', phone4: '4444' }).error, /재원/);
  assert.match(g.post({ action: 'booking.mine', name: '홍길동', phone4: '0000' }).error, /재원/);
  const ok = g.post({ action: 'booking.mine', name: '김 시우', phone4: '5678' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.bookings, []);
});

test('book, block double booking, cancel, slot frees up', () => {
  const g = ready();
  const a = g.post({ action: 'booking.create', name: '김시우', phone4: '5678', room: '연습실 1', date: '2026-09-26', start: '14:00', hours: 2 });
  assert.equal(a.ok, true, a.error);
  assert.equal(a.booking.end, '16:00');
  assert.equal(g.sent.length, 1);
  assert.match(g.sent[0], /연습실 예약/);

  const clash = g.post({ action: 'booking.create', name: '이하늘', phone4: '9999', room: '연습실 1', date: '2026-09-26', start: '15:00', hours: 1 });
  assert.equal(clash.ok, false);

  const free = g.get({ action: 'rooms', date: '2026-09-26' }).rooms[0].free;
  assert.ok(!free.includes('14:00') && !free.includes('15:00') && free.includes('16:00'));

  const mine = g.post({ action: 'booking.mine', name: '김시우', phone4: '5678' });
  assert.equal(mine.bookings.length, 1);
  assert.equal(mine.bookings[0].cancellable, true);

  // another student can't cancel it
  assert.equal(g.post({ action: 'booking.cancel', name: '이하늘', phone4: '9999', id: a.booking.id }).ok, false);
  const c = g.post({ action: 'booking.cancel', name: '김시우', phone4: '5678', id: a.booking.id });
  assert.equal(c.ok, true, c.error);
  assert.equal(g.tab('연습실예약')[1][1], '취소');
  assert.ok(g.get({ action: 'rooms', date: '2026-09-26' }).rooms[0].free.includes('14:00'));
  assert.equal(g.post({ action: 'booking.create', name: '이하늘', phone4: '9999', room: '연습실 1', date: '2026-09-26', start: '15:00', hours: 1 }).ok, true);
});

test('owner cancelling in the sheet frees the slot; notifications can be turned off', () => {
  const g = ready();
  g.tab('설정').find((r) => r[0] === '연습실 예약알림')[1] = '꺼짐';
  const a = g.post({ action: 'booking.create', name: '김시우', phone4: '5678', room: '댄스 연습실', date: '2026-09-25', start: '11:00', hours: 1 });
  assert.equal(a.ok, true, a.error);
  assert.equal(g.sent.length, 0);
  g.tab('연습실예약')[1][1] = '취소';
  assert.ok(g.get({ action: 'rooms' }).rooms[2].free.includes('11:00'));
});

test('consult: phone request, visit booking, taken slot, honeypot, rate limit', () => {
  const g = ready();
  const phone = g.post({ action: 'consult.create', name: '보호자', phone: '010 5555 6666', track: '입시반', method: '전화 상담', message: '고2 입시 문의' });
  assert.equal(phone.ok, true, phone.error);
  assert.equal(g.tab('상담')[1][7], '010-5555-6666');
  assert.match(g.sent.at(-1), /새 상담 신청/);

  const slots = g.get({ action: 'consultSlots' });
  assert.equal(slots.days[0].date, '2026-09-25');
  assert.equal(slots.days[0].times[0], '14:00'); // 13:00 is inside the 3h lead time from 10:20
  const visit = g.post({ action: 'consult.create', name: '학생', phone: '01077778888', method: '체험 레슨', date: '2026-09-25', start: '14:00' });
  assert.equal(visit.ok, true, visit.error);
  assert.ok(!g.get({ action: 'consultSlots' }).days[0].times.includes('14:00'));
  assert.equal(g.post({ action: 'consult.create', name: '다른', phone: '01011112222', method: '방문 상담', date: '2026-09-25', start: '14:00' }).ok, false);

  const before = g.tab('상담').length;
  assert.equal(g.post({ action: 'consult.create', name: 'bot', phone: '01000000000', website: 'spam' }).ok, true);
  assert.equal(g.tab('상담').length, before);

  for (let i = 0; i < 2; i++) g.post({ action: 'consult.create', name: '반복', phone: '01099990000' });
  g.post({ action: 'consult.create', name: '반복', phone: '01099990000' });
  assert.match(g.post({ action: 'consult.create', name: '반복', phone: '01099990000' }).error, /여러 번/);
});

test('phone digits starting with 0 survive Sheets turning them into numbers', () => {
  const g = ready();
  g.tab('수강생').push(['최영', '010-5555-0123', '재원', '']);
  const a = g.post({ action: 'booking.create', name: '최영', phone4: '0123', room: '연습실 2', date: '2026-09-27', start: '10:00', hours: 1 });
  assert.equal(a.ok, true, a.error);
  g.tab('연습실예약')[1][7] = 123; // what Sheets does to an unformatted "0123"
  const mine = g.post({ action: 'booking.mine', name: '최영', phone4: '0123' });
  assert.equal(mine.bookings.length, 1);
});

test('bad input never leaks internals', () => {
  const g = ready();
  assert.match(g.post('not json').error, /형식/);
  assert.match(g.get({ action: 'nope' }).error, /알 수 없는/);
  assert.match(g.post({ action: 'consult.create', name: '', phone: '010' }).error, /이름/);
});
