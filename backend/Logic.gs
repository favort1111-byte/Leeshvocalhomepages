/**
 * Pure booking rules — no Sheets/Utilities calls, so the same file runs in
 * Apps Script and under Node for tests (backend/test/logic.test.js).
 *
 * Conventions: dates are "YYYY-MM-DD" strings, times are minutes since
 * midnight (0..1440). Callers convert sheet values before calling in.
 */
var Logic = (function () {
  function toMin(t) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(t == null ? '' : t).trim());
    if (!m) return NaN;
    var h = Number(m[1]), mm = Number(m[2]);
    if (mm > 59 || h > 24 || (h === 24 && mm !== 0)) return NaN;
    return h * 60 + mm;
  }

  function fromMin(m) {
    var h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
  }

  function overlaps(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
  }

  function normName(s) {
    return String(s == null ? '' : s).replace(/\s+/g, '');
  }

  function digits(s) {
    return String(s == null ? '' : s).replace(/\D/g, '');
  }

  function last4(phone) {
    return digits(phone).slice(-4);
  }

  function isDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
    var d = new Date(s + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }

  function addDays(dateStr, n) {
    var d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function daysBetween(a, b) {
    return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
  }

  /** 0 = Sunday … 6 = Saturday */
  function weekday(dateStr) {
    return new Date(dateStr + 'T00:00:00Z').getUTCDay();
  }

  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  function parseWeekday(s) {
    var i = WEEKDAYS.indexOf(String(s == null ? '' : s).trim().charAt(0));
    return i;
  }

  /**
   * Start minutes of every free slot in [open, close) on a grid of `unit`,
   * skipping slots that intersect `busy` or that already ended (`nowMin`).
   */
  function freeSlots(opts) {
    var out = [];
    var earliest = opts.nowMin == null ? -Infinity : Math.floor(opts.nowMin / opts.unit) * opts.unit;
    for (var s = opts.open; s + opts.unit <= opts.close; s += opts.unit) {
      if (s < earliest) continue;
      var e = s + opts.unit;
      var taken = (opts.busy || []).some(function (b) { return overlaps(s, e, b.start, b.end); });
      if (!taken) out.push(s);
    }
    return out;
  }

  /**
   * Checks a practice-room request against the rules and the live bookings.
   * Returns { ok: true, start, end } or { ok: false, error: '사용자에게 보여줄 문장' }.
   */
  function validateBooking(req, ctx) {
    if (!isDate(req.date)) return fail('날짜 형식이 올바르지 않습니다.');
    var ahead = daysBetween(ctx.today, req.date);
    if (ahead < 0) return fail('지난 날짜는 예약할 수 없습니다.');
    if (ahead > ctx.maxDays) return fail('예약은 오늘부터 ' + ctx.maxDays + '일 뒤까지만 가능합니다.');

    var room = (ctx.rooms || []).filter(function (r) { return r.name === req.room; })[0];
    if (!room) return fail('선택한 연습실을 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.');

    var start = toMin(req.start);
    var hours = Number(req.hours);
    if (isNaN(start)) return fail('시작 시간이 올바르지 않습니다.');
    if (!(hours >= 1) || Math.floor(hours) !== hours) return fail('이용 시간을 선택해주세요.');
    if (hours * 60 > ctx.maxMinutes) return fail('한 번에 최대 ' + ctx.maxMinutes / 60 + '시간까지 예약할 수 있습니다.');
    var end = start + hours * 60;

    if ((start - ctx.open) % ctx.unit !== 0) return fail('예약은 ' + ctx.unit + '분 단위로만 가능합니다.');
    if (start < ctx.open || end > ctx.close) {
      return fail('운영 시간(' + fromMin(ctx.open) + '~' + fromMin(ctx.close) + ') 안에서만 예약할 수 있습니다.');
    }
    if (ahead === 0 && start < Math.floor(ctx.nowMin / ctx.unit) * ctx.unit) {
      return fail('이미 지난 시간입니다.');
    }

    var sameDay = (ctx.existing || []).filter(function (b) { return b.date === req.date; });
    var clash = sameDay.filter(function (b) {
      return b.room === req.room && overlaps(start, end, b.start, b.end);
    })[0];
    if (clash) return fail('방금 다른 예약이 들어왔습니다. 다른 시간을 골라주세요.');

    var who = normName(req.name);
    var mine = sameDay.filter(function (b) { return normName(b.name) === who && b.phone4 === req.phone4; });
    if (mine.some(function (b) { return overlaps(start, end, b.start, b.end); })) {
      return fail('같은 시간에 이미 다른 연습실을 예약하셨습니다.');
    }
    var used = mine.reduce(function (sum, b) { return sum + (b.end - b.start); }, 0);
    if (used + (end - start) > ctx.dailyMaxMinutes) {
      return fail('하루 최대 ' + ctx.dailyMaxMinutes / 60 + '시간까지 예약할 수 있습니다. (이날 이미 ' + used / 60 + '시간 예약)');
    }
    return { ok: true, start: start, end: end };
  }

  /** Can a confirmed booking still be cancelled by the student? */
  function canCancel(booking, today, nowMin, deadlineMin) {
    var ahead = daysBetween(today, booking.date);
    var minutesUntil = ahead * 1440 + booking.start - nowMin;
    return minutesUntil >= deadlineMin;
  }

  /**
   * Visit/trial consult slots for the next `days` days, generated from weekly
   * opening rules, minus closed dates, taken slots and the lead time.
   * rules: [{ weekday: 0-6, start, end }], closed: ['YYYY-MM-DD'], taken: [{ date, start, end }]
   */
  function consultSlots(opts) {
    var out = [];
    var nowAbs = opts.nowMin + opts.leadMin;
    for (var i = 0; i <= opts.days; i++) {
      var date = addDays(opts.today, i);
      if ((opts.closed || []).indexOf(date) !== -1) continue;
      var wd = weekday(date);
      var busy = (opts.taken || []).filter(function (t) { return t.date === date; });
      var times = [];
      (opts.rules || []).forEach(function (r) {
        if (r.weekday !== wd) return;
        for (var s = r.start; s + opts.unit <= r.end; s += opts.unit) {
          if (i * 1440 + s < nowAbs) continue;
          var e = s + opts.unit;
          if (busy.some(function (b) { return overlaps(s, e, b.start, b.end); })) continue;
          if (times.indexOf(s) === -1) times.push(s);
        }
      });
      times.sort(function (a, b) { return a - b; });
      if (times.length) out.push({ date: date, weekday: WEEKDAYS[wd], times: times.map(fromMin) });
    }
    return out;
  }

  function fail(msg) { return { ok: false, error: msg }; }

  return {
    toMin: toMin, fromMin: fromMin, overlaps: overlaps, normName: normName, digits: digits,
    last4: last4, isDate: isDate, addDays: addDays, daysBetween: daysBetween, weekday: weekday,
    parseWeekday: parseWeekday, WEEKDAYS: WEEKDAYS, freeSlots: freeSlots,
    validateBooking: validateBooking, canCancel: canCancel, consultSlots: consultSlots
  };
})();

if (typeof module !== 'undefined') module.exports = Logic;
