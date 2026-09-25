/**
 * Web app entry points. The homepage calls:
 *   GET  ?action=content                 → texts + lists for the pages
 *   GET  ?action=rooms&date=YYYY-MM-DD   → practice-room availability
 *   GET  ?action=consultSlots            → open visit/trial consult times
 *   POST {action:'booking.mine',   name, phone4}
 *   POST {action:'booking.create', name, phone4, room, date, start, hours}
 *   POST {action:'booking.cancel', name, phone4, id}
 *   POST {action:'consult.create', name, phone, track, method, date, start, message, website}
 * POST bodies are JSON sent as text/plain so the browser skips the CORS preflight.
 */
function doGet(e) {
  return handle_(function () {
    var p = (e && e.parameter) || {};
    switch (p.action) {
      case 'content': return getContent_();
      case 'rooms': return getRooms_(p.date);
      case 'consultSlots': return getConsultSlots_();
      case 'ping': return { ok: true, time: now_().stamp };
      default: throw userError_('알 수 없는 요청입니다.');
    }
  });
}

function doPost(e) {
  return handle_(function () {
    var body;
    try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
    catch (err) { throw userError_('요청 형식이 올바르지 않습니다.'); }
    switch (body.action) {
      case 'booking.mine': return bookingMine_(body);
      case 'booking.create': return bookingCreate_(body);
      case 'booking.cancel': return bookingCancel_(body);
      case 'consult.create': return consultCreate_(body);
      default: throw userError_('알 수 없는 요청입니다.');
    }
  });
}

function handle_(fn) {
  var out;
  try {
    out = fn();
    if (out.ok === undefined) out.ok = true;
  } catch (err) {
    if (err && err.userFacing) {
      out = { ok: false, error: err.message };
    } else {
      log_('오류', (err && err.stack) || err);
      out = { ok: false, error: '일시적인 오류가 생겼습니다. 잠시 후 다시 시도하거나 카카오톡으로 문의해주세요.' };
    }
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function userError_(msg) {
  var e = new Error(msg);
  e.userFacing = true;
  return e;
}

/* ---------------- content ---------------- */

var CONTENT_CACHE_KEY = 'content_v1';

function getContent_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(CONTENT_CACHE_KEY);
  if (hit) return JSON.parse(hit);

  var content = {};
  readTable_('content').forEach(function (r) { if (r['키']) content[r['키']] = r['값']; });

  function visible(rows) {
    return rows
      .filter(function (r) { return String(r['표시']).toUpperCase() !== 'N' && r['표시'] !== '숨김'; })
      .sort(function (a, b) { return (Number(a['순서']) || 999) - (Number(b['순서']) || 999); });
  }
  var out = {
    ok: true,
    content: content,
    lists: {
      results: visible(readTable_('results')).map(function (r) { return { group: r['구분'], text: r['내용'] }; }),
      pricing: visible(readTable_('pricing')).map(function (r) {
        return { group: r['구분'], name: r['과정'], sessions: r['회차'], price: r['금액'], note: r['비고'] };
      })
    }
  };
  cache.put(CONTENT_CACHE_KEY, JSON.stringify(out), 300);
  return out;
}

function clearContentCache() {
  CacheService.getScriptCache().remove(CONTENT_CACHE_KEY);
}

/* ---------------- practice rooms ---------------- */

function activeRooms_() {
  return readTable_('rooms')
    .filter(function (r) { return r['연습실'] && String(r['사용']).indexOf('아니') === -1 && String(r['사용']).toUpperCase() !== 'N'; })
    .map(function (r) { return { name: r['연습실'], type: r['종류'] }; });
}

/** Confirmed bookings from `fromDate` on, with times as minutes. */
function liveBookings_(fromDate) {
  return readTable_('bookings')
    .filter(function (b) { return b['상태'] === '확정' && b['날짜'] >= fromDate; })
    .map(function (b) {
      return {
        row: b._row, id: b['예약번호'], room: b['연습실'], date: b['날짜'],
        start: Logic.toMin(b['시작']), end: Logic.toMin(b['종료']),
        // Sheets can turn "0123" into 123 once rows outgrow the text-formatted range
        name: b['이름'], phone4: ('0000' + Logic.digits(b['전화뒷자리'])).slice(-4)
      };
    })
    .filter(function (b) { return !isNaN(b.start) && !isNaN(b.end); });
}

function getRooms_(date) {
  var s = settings_(), t = now_();
  var days = [];
  for (var i = 0; i <= s.roomMaxDays; i++) days.push(Logic.addDays(t.today, i));
  if (!date) date = t.today;
  if (days.indexOf(date) === -1) throw userError_('예약할 수 없는 날짜입니다.');

  var bookings = liveBookings_(date).filter(function (b) { return b.date === date; });
  var rooms = activeRooms_().map(function (r) {
    var free = Logic.freeSlots({
      open: s.roomOpen, close: s.roomClose, unit: s.roomUnit,
      busy: bookings.filter(function (b) { return b.room === r.name; }),
      nowMin: date === t.today ? t.nowMin : null
    });
    return { name: r.name, type: r.type, free: free.map(Logic.fromMin) };
  });
  return {
    date: date, days: days, unit: s.roomUnit,
    open: Logic.fromMin(s.roomOpen), close: Logic.fromMin(s.roomClose),
    maxHours: s.roomMaxMinutes / 60, dailyMaxHours: s.roomDailyMaxMinutes / 60,
    rooms: rooms
  };
}

/** Throws unless name + last 4 digits match a current student. Returns the student row. */
function verifyStudent_(name, phone4) {
  var who = Logic.normName(name);
  var p4 = Logic.digits(phone4);
  if (!who || p4.length !== 4) throw userError_('이름과 전화번호 뒤 4자리를 입력해주세요.');
  var hit = readTable_('students').filter(function (s) {
    return Logic.normName(s['이름']) === who && Logic.last4(s['전화번호']) === p4;
  })[0];
  if (!hit) throw userError_('수강생 명단에서 찾을 수 없습니다. 이름과 번호를 확인하거나 학원에 문의해주세요.');
  if (hit['상태'] && hit['상태'] !== '재원') throw userError_('현재 재원 중인 수강생만 연습실을 예약할 수 있습니다.');
  return { name: hit['이름'], phone4: p4 };
}

function publicBooking_(b, t, s) {
  return {
    id: b.id, room: b.room, date: b.date, start: Logic.fromMin(b.start), end: Logic.fromMin(b.end),
    cancellable: Logic.canCancel(b, t.today, t.nowMin, s.roomCancelMinutes)
  };
}

function bookingMine_(body) {
  var st = verifyStudent_(body.name, body.phone4);
  var s = settings_(), t = now_();
  var mine = liveBookings_(t.today)
    .filter(function (b) {
      return Logic.normName(b.name) === Logic.normName(st.name) && b.phone4 === st.phone4 &&
        (b.date > t.today || b.end > t.nowMin);
    })
    .sort(function (a, b) { return a.date === b.date ? a.start - b.start : (a.date < b.date ? -1 : 1); });
  return { name: st.name, bookings: mine.map(function (b) { return publicBooking_(b, t, s); }) };
}

function bookingCreate_(body) {
  var st = verifyStudent_(body.name, body.phone4);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw userError_('예약이 몰리고 있습니다. 잠시 후 다시 눌러주세요.');
  try {
    var s = settings_(), t = now_();
    var check = Logic.validateBooking(
      { name: st.name, phone4: st.phone4, room: body.room, date: body.date, start: body.start, hours: body.hours },
      {
        today: t.today, nowMin: t.nowMin, maxDays: s.roomMaxDays, unit: s.roomUnit,
        open: s.roomOpen, close: s.roomClose, maxMinutes: s.roomMaxMinutes,
        dailyMaxMinutes: s.roomDailyMaxMinutes, rooms: activeRooms_(), existing: liveBookings_(t.today)
      });
    if (!check.ok) throw userError_(check.error);

    var id = 'R' + body.date.replace(/-/g, '').slice(2) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    appendRow_('bookings', {
      '예약번호': id, '상태': '확정', '연습실': body.room, '날짜': body.date,
      '시작': Logic.fromMin(check.start), '종료': Logic.fromMin(check.end),
      '이름': st.name, '전화뒷자리': st.phone4, '신청시각': t.stamp
    });
    SpreadsheetApp.flush();
    if (s.roomNotify) {
      notify_('🎤 연습실 예약\n' + st.name + ' · ' + body.room + '\n' + body.date + ' ' +
        Logic.fromMin(check.start) + '~' + Logic.fromMin(check.end) + '\n(' + id + ')');
    }
    return { booking: { id: id, room: body.room, date: body.date, start: Logic.fromMin(check.start), end: Logic.fromMin(check.end) } };
  } finally {
    lock.releaseLock();
  }
}

function bookingCancel_(body) {
  var st = verifyStudent_(body.name, body.phone4);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw userError_('잠시 후 다시 눌러주세요.');
  try {
    var s = settings_(), t = now_();
    var b = liveBookings_(t.today).filter(function (x) { return x.id === body.id; })[0];
    if (!b || Logic.normName(b.name) !== Logic.normName(st.name) || b.phone4 !== st.phone4) {
      throw userError_('취소할 예약을 찾을 수 없습니다.');
    }
    if (!Logic.canCancel(b, t.today, t.nowMin, s.roomCancelMinutes)) {
      throw userError_('시작 ' + s.roomCancelMinutes + '분 전이 지나 직접 취소할 수 없습니다. 학원에 연락해주세요.');
    }
    setCell_('bookings', b.row, '상태', '취소');
    setCell_('bookings', b.row, '취소시각', t.stamp);
    setCell_('bookings', b.row, '메모', '학생 직접 취소');
    if (s.roomNotify) {
      notify_('↩️ 연습실 예약 취소\n' + st.name + ' · ' + b.room + '\n' + b.date + ' ' +
        Logic.fromMin(b.start) + '~' + Logic.fromMin(b.end) + '\n(' + b.id + ')');
    }
    return { cancelled: b.id };
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- consult ---------------- */

var METHODS = ['전화 상담', '방문 상담', '체험 레슨'];

function consultRules_() {
  var rules = [];
  readTable_('consultHours').forEach(function (r) {
    var wd = Logic.parseWeekday(r['요일']);
    var a = Logic.toMin(r['시작']), b = Logic.toMin(r['종료']);
    if (wd >= 0 && !isNaN(a) && !isNaN(b) && b > a) rules.push({ weekday: wd, start: a, end: b });
  });
  return rules;
}

function takenConsults_(fromDate) {
  return readTable_('consults')
    .filter(function (c) { return c['상태'] !== '취소' && c['예약날짜'] && c['예약날짜'] >= fromDate; })
    .map(function (c) { return { date: c['예약날짜'], start: Logic.toMin(c['예약시작']), end: Logic.toMin(c['예약종료']) }; })
    .filter(function (c) { return !isNaN(c.start) && !isNaN(c.end); });
}

function getConsultSlots_() {
  var s = settings_(), t = now_();
  return {
    unit: s.consultUnit,
    days: Logic.consultSlots({
      today: t.today, nowMin: t.nowMin, leadMin: s.consultLeadMinutes, days: s.consultDays,
      unit: s.consultUnit, rules: consultRules_(),
      closed: readTable_('closed').map(function (r) { return r['날짜']; }),
      taken: takenConsults_(t.today)
    })
  };
}

function consultCreate_(body) {
  if (body.website) return { received: true }; // honeypot: bots fill every field
  var name = String(body.name || '').trim().slice(0, 30);
  var phone = Logic.digits(body.phone);
  if (!name) throw userError_('이름을 입력해주세요.');
  if (phone.length < 9 || phone.length > 11) throw userError_('연락처를 정확히 입력해주세요.');
  var method = METHODS.indexOf(body.method) === -1 ? '전화 상담' : body.method;
  var message = String(body.message || '').slice(0, 1000);
  var track = String(body.track || '').slice(0, 30);

  var cache = CacheService.getScriptCache();
  var rateKey = 'consult_' + phone;
  var count = Number(cache.get(rateKey) || 0);
  if (count >= 3) throw userError_('이미 여러 번 접수되었습니다. 곧 연락드릴게요.');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw userError_('잠시 후 다시 눌러주세요.');
  try {
    var t = now_(), s = settings_();
    var slot = { date: '', start: '', end: '' };
    if (method !== '전화 상담') {
      var open = getConsultSlots_().days.filter(function (d) { return d.date === body.date; })[0];
      if (!open || open.times.indexOf(body.start) === -1) {
        throw userError_('선택한 시간이 방금 마감되었습니다. 다른 시간을 골라주세요.');
      }
      slot = { date: body.date, start: body.start, end: Logic.fromMin(Logic.toMin(body.start) + s.consultUnit) };
    }
    var id = 'C' + t.today.replace(/-/g, '').slice(2) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    appendRow_('consults', {
      '접수번호': id, '상태': '접수', '방식': method,
      '예약날짜': slot.date, '예약시작': slot.start, '예약종료': slot.end,
      '이름': name, '연락처': formatPhone_(phone), '관심반': track, '내용': message, '접수시각': t.stamp
    });
    SpreadsheetApp.flush();
    cache.put(rateKey, String(count + 1), 3600);

    notify_('📩 새 상담 신청 · ' + method + '\n' + name + ' · ' + formatPhone_(phone) +
      (track ? '\n관심: ' + track : '') +
      (slot.date ? '\n희망: ' + slot.date + ' ' + slot.start : '') +
      (message ? '\n\n' + message : '') + '\n(' + id + ')');
    return { id: id, method: method, date: slot.date, start: slot.start };
  } finally {
    lock.releaseLock();
  }
}

function formatPhone_(d) {
  if (d.length === 11) return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
  if (d.length === 10) return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
  return d;
}
