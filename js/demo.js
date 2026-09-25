// 체험 모드 — preview builds only (tools/build_preview.py), loaded right after api.js. Answers the same
// requests as Supabase from a fake database kept in this browser, so every
// page can be clicked through before the real database exists. Mirrors the
// rules in supabase/schema.sql; the real ones live there.
(function () {
  var cfg = window.LEESH = window.LEESH || {};
  cfg.supabaseKey = "demo";
  cfg.local = true;
  var KEY = "leesh_demo_db";
  var VERSION = 2; // bump when the demo defaults change
  var WD = ["일", "월", "화", "수", "목", "금", "토"];

  function nowKst() {
    var d = new Date(Date.now() + 9 * 3600000);
    return { today: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
  }
  function addDays(d, n) {
    var dt = new Date(d + "T00:00:00Z");
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  }
  function diffDays(a, b) { return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000); }
  function hhmm(m) { return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); }
  function toMin(t) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(t || "");
    return m ? +m[1] * 60 + +m[2] : null;
  }
  function label(d) {
    var dt = new Date(d + "T00:00:00Z");
    return (dt.getUTCMonth() + 1) + "/" + dt.getUTCDate() + "(" + WD[dt.getUTCDay()] + ")";
  }
  function fail(msg) { return { ok: false, error: msg }; }

  function seed() {
    var t = nowKst().today;
    var db = {
      version: VERSION,
      next: 100,
      settings: { id: 1, open_min: 0, close_min: 1440, unit_min: 60, max_minutes: 180, daily_max_minutes: 180, max_days: 7, cancel_minutes: 60 },
      rooms: [["연습실 1", "연습실"], ["연습실 2", "연습실"], ["연습실 3", "연습실"], ["연습실 4", "연습실"], ["연습실 5", "연습실"], ["춤연습실", "춤연습실"]]
        .map(function (r, i) { return { id: i + 1, name: r[0], kind: r[1], sort: i + 1, active: true }; }),
      members: [
        { id: "S001", name: "김시우", phone: "010-1234-5678", pin: "5678", status: "재원", expires_on: null, memo: null },
        { id: "S002", name: "이하늘", phone: "010-2222-9999", pin: "9999", status: "재원", expires_on: null, memo: "입시반" },
        { id: "S003", name: "박새봄", phone: "010-5555-7777", pin: "7777", status: "휴원", expires_on: null, memo: "10월 복귀 예정" },
        { id: "G001", name: "외부 대관", phone: null, pin: "1234", status: "외부", expires_on: addDays(t, 14), memo: "댄스팀" }
      ],
      bookings: [
        { id: 1, room_id: 1, member_id: "S002", day: t, start_min: 1200, end_min: 1320, status: "확정", memo: null },
        { id: 2, room_id: 6, member_id: "G001", day: t, start_min: 1140, end_min: 1260, status: "확정", memo: null },
        { id: 3, room_id: 3, member_id: null, day: addDays(t, 1), start_min: 600, end_min: 660, status: "확정", memo: "청소" },
        { id: 4, room_id: 2, member_id: "S001", day: addDays(t, 1), start_min: 1080, end_min: 1200, status: "확정", memo: null }
      ],
      consults: [
        { id: 1, status: "접수", method: "체험 레슨", wish: "토요일 오후", name: "홍길동", phone: "010-1111-2222", track: "취미반", message: "고음이 잘 안 올라가요.", memo: null, created_at: new Date(Date.now() - 3600000).toISOString() },
        { id: 2, status: "연락완료", method: "전화 상담", wish: null, name: "최유나", phone: "010-3333-4444", track: "오디션·입시반", message: null, memo: "다음 주 방문 예정", created_at: new Date(Date.now() - 86400000 * 2).toISOString() }
      ]
    };
    return db;
  }

  var db;
  function load() {
    try { db = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { db = null; }
    if (!db || db.version !== VERSION) db = seed(); // new defaults replace old demo data
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* memory only */ } }
  load();

  /* ---------------- database functions ---------------- */

  function checkMember(id, pin) {
    id = String(id || "").trim().toUpperCase();
    pin = String(pin || "").replace(/\D/g, "");
    if (!id || pin.length !== 4) return fail("수강 ID와 비밀번호 4자리를 입력해주세요.");
    var m = db.members.filter(function (x) { return x.id === id; })[0];
    if (!m || m.pin !== pin) return fail("수강 ID 또는 비밀번호가 맞지 않습니다.");
    if (m.status !== "재원" && m.status !== "외부") return fail("현재 이용 중인 수강 ID가 아닙니다. 학원에 문의해주세요.");
    if (m.expires_on && m.expires_on < nowKst().today) return fail("사용 기한이 지난 ID입니다. 학원에 문의해주세요.");
    return { ok: true, id: m.id, name: m.name };
  }
  function live() { return db.bookings.filter(function (b) { return b.status === "확정"; }); }
  function room(id) { return db.rooms.filter(function (r) { return r.id === id; })[0]; }

  var fns = {
    rooms_day: function (a) {
      var s = db.settings, n = nowKst(), d = a.p_date || n.today;
      var ahead = diffDays(n.today, d);
      if (isNaN(ahead) || ahead < 0 || ahead > s.max_days) return fail("예약할 수 없는 날짜입니다.");
      var days = [];
      for (var i = 0; i <= s.max_days; i++) days.push(addDays(n.today, i));
      return {
        ok: true, date: d, days: days, unit: s.unit_min, open: hhmm(s.open_min), close: hhmm(s.close_min),
        maxHours: s.max_minutes / 60, dailyMaxHours: s.daily_max_minutes / 60,
        rooms: db.rooms.filter(function (r) { return r.active; })
          .sort(function (x, y) { return x.sort - y.sort || x.id - y.id; })
          .map(function (r) {
            var free = [];
            for (var g = s.open_min; g + s.unit_min <= s.close_min; g += s.unit_min) {
              if (ahead === 0 && g < Math.floor(n.min / s.unit_min) * s.unit_min) continue;
              var taken = live().some(function (b) { return b.room_id === r.id && b.day === d && b.start_min < g + s.unit_min && g < b.end_min; });
              if (!taken) free.push(hhmm(g));
            }
            return { name: r.name, type: r.kind, free: free };
          })
      };
    },
    member_login: function (a) {
      var who = checkMember(a.p_id, a.p_pin);
      if (!who.ok) return who;
      var n = nowKst(), s = db.settings;
      var mine = live().filter(function (b) {
        return b.member_id === who.id && (b.day > n.today || (b.day === n.today && b.end_min > n.min));
      }).sort(function (x, y) { return x.day === y.day ? x.start_min - y.start_min : (x.day < y.day ? -1 : 1); });
      return {
        ok: true, id: who.id, name: who.name,
        bookings: mine.map(function (b) {
          return {
            id: b.id, room: room(b.room_id).name, date: b.day, start: hhmm(b.start_min), end: hhmm(b.end_min),
            cancellable: diffDays(n.today, b.day) * 1440 + b.start_min - n.min >= s.cancel_minutes
          };
        })
      };
    },
    booking_create: function (a) {
      var who = checkMember(a.p_id, a.p_pin);
      if (!who.ok) return who;
      var s = db.settings, n = nowKst(), d = a.p_date, ahead = diffDays(n.today, d);
      if (isNaN(ahead)) return fail("날짜 형식이 올바르지 않습니다.");
      if (ahead < 0) return fail("지난 날짜는 예약할 수 없습니다.");
      if (ahead > s.max_days) return fail("예약은 오늘부터 " + s.max_days + "일 뒤까지만 가능합니다.");
      var r = db.rooms.filter(function (x) { return x.name === a.p_room && x.active; })[0];
      if (!r) return fail("선택한 연습실을 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.");
      var st = toMin(a.p_start), h = Number(a.p_hours);
      if (st == null) return fail("시작 시간이 올바르지 않습니다.");
      if (!(h >= 1)) return fail("이용 시간을 선택해주세요.");
      if (h * 60 > s.max_minutes) return fail("한 번에 최대 " + s.max_minutes / 60 + "시간까지 예약할 수 있습니다.");
      var en = st + h * 60;
      if (st < s.open_min || en > s.close_min) return fail("운영 시간(" + hhmm(s.open_min) + "~" + hhmm(s.close_min) + ") 안에서만 예약할 수 있습니다.");
      if (ahead === 0 && st < Math.floor(n.min / s.unit_min) * s.unit_min) return fail("이미 지난 시간입니다.");
      var sameDay = live().filter(function (b) { return b.day === d; });
      var used = sameDay.filter(function (b) { return b.member_id === who.id; })
        .reduce(function (t, b) { return t + b.end_min - b.start_min; }, 0);
      if (used + en - st > s.daily_max_minutes) {
        return fail("하루 최대 " + s.daily_max_minutes / 60 + "시간까지 예약할 수 있습니다. (이날 이미 " + used / 60 + "시간 예약)");
      }
      if (sameDay.some(function (b) { return b.member_id === who.id && b.start_min < en && st < b.end_min; })) {
        return fail("같은 시간에 이미 다른 연습실을 예약하셨습니다.");
      }
      if (sameDay.some(function (b) { return b.room_id === r.id && b.start_min < en && st < b.end_min; })) {
        return fail("방금 다른 예약이 들어왔습니다. 다른 시간을 골라주세요.");
      }
      var b = { id: ++db.next, room_id: r.id, member_id: who.id, day: d, start_min: st, end_min: en, status: "확정", memo: null };
      db.bookings.push(b);
      save();
      return { ok: true, booking: { id: b.id, room: r.name, date: d, start: hhmm(st), end: hhmm(en) } };
    },
    booking_cancel: function (a) {
      var who = checkMember(a.p_id, a.p_pin);
      if (!who.ok) return who;
      var n = nowKst(), s = db.settings;
      var b = live().filter(function (x) { return x.id === a.p_booking && x.member_id === who.id; })[0];
      if (!b) return fail("취소할 예약을 찾을 수 없습니다.");
      if (diffDays(n.today, b.day) * 1440 + b.start_min - n.min < s.cancel_minutes) {
        return fail("시작 " + s.cancel_minutes + "분 전이 지나 직접 취소할 수 없습니다. 학원에 연락해주세요.");
      }
      b.status = "취소";
      b.memo = (b.memo ? b.memo + " / " : "") + "본인 취소";
      save();
      return { ok: true, cancelled: b.id };
    },
    consult_create: function (a) {
      if (a.p_website) return { ok: true };
      var name = String(a.p_name || "").trim(), digits = String(a.p_phone || "").replace(/\D/g, "");
      if (!name) return fail("이름을 입력해주세요.");
      if (digits.length < 9 || digits.length > 11) return fail("연락처를 정확히 입력해주세요.");
      var phone = digits.length === 11 ? digits.replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3") : digits.replace(/(\d{3})(\d{3})(\d+)/, "$1-$2-$3");
      var method = ["전화 상담", "방문 상담", "체험 레슨"].indexOf(a.p_method) === -1 ? "전화 상담" : a.p_method;
      db.consults.unshift({
        id: ++db.next, status: "접수", method: method, wish: a.p_wish || null, name: name, phone: phone,
        track: a.p_track || null, message: a.p_message || null, memo: null, created_at: new Date().toISOString()
      });
      save();
      return { ok: true, method: method };
    },
    admin_save_member: function (a) {
      var id = String(a.p_id || "").trim().toUpperCase(), pin = String(a.p_pin || "").replace(/\D/g, "");
      if (!/^[A-Z0-9_-]{2,20}$/.test(id)) return fail("수강 ID는 영문·숫자 2~20자로 정해주세요.");
      if (!String(a.p_name || "").trim()) return fail("이름을 입력해주세요.");
      if (pin && pin.length !== 4) return fail("비밀번호는 숫자 4자리입니다.");
      var m = db.members.filter(function (x) { return x.id === id; })[0];
      if (!m && !pin) return fail("새 수강 ID에는 비밀번호 4자리가 필요합니다.");
      if (!m) { m = { id: id }; db.members.push(m); }
      var created = !m.name;
      m.name = String(a.p_name).trim();
      m.phone = String(a.p_phone || "").trim() || null;
      m.status = a.p_status || "재원";
      m.expires_on = a.p_expires_on || null;
      m.memo = String(a.p_memo || "").trim() || null;
      if (pin) m.pin = pin;
      save();
      return { ok: true, id: id, created: created };
    },
    is_admin: function () { return true; }
  };

  /* ---------------- table requests from the admin page ---------------- */

  function parse(path) {
    var q = path.split("?"), params = {};
    (q[1] || "").split("&").forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf("=");
      params[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
    });
    return { table: q[0], params: params };
  }

  function select(rows, params) {
    Object.keys(params).forEach(function (k) {
      var v = params[k];
      if (v.indexOf("eq.") !== 0) return;
      v = v.slice(3);
      rows = rows.filter(function (r) { return String(r[k]) === v; });
    });
    if (params.order) {
      var keys = params.order.split(",");
      rows = rows.slice().sort(function (x, y) {
        for (var i = 0; i < keys.length; i++) {
          var p = keys[i].split("."), f = p[0], desc = p[1] === "desc";
          if (x[f] < y[f]) return desc ? 1 : -1;
          if (x[f] > y[f]) return desc ? -1 : 1;
        }
        return 0;
      });
    }
    if (params.limit) rows = rows.slice(0, Number(params.limit));
    return rows;
  }

  function table(method, path, body) {
    var p = parse(path), rows = db[p.table];
    if (!rows) return { status: 404, data: { message: "not found" } };
    var list = Array.isArray(rows) ? rows : [rows];
    if (method === "GET") {
      var out = select(list, p.params).map(function (r) {
        var c = Object.assign({}, r);
        delete c.pin;
        if (p.table === "bookings") {
          var m = db.members.filter(function (x) { return x.id === r.member_id; })[0];
          c.members = m ? { name: m.name, phone: m.phone } : null;
        }
        return c;
      });
      return { status: 200, data: out };
    }
    if (method === "PATCH") {
      var hit = select(list, p.params);
      hit.forEach(function (r) { Object.assign(r, body); });
      save();
      return { status: 200, data: hit };
    }
    if (method === "POST") {
      if (p.table === "bookings") {
        var clash = live().some(function (b) {
          return b.room_id === body.room_id && b.day === body.day && b.start_min < body.end_min && body.start_min < b.end_min;
        });
        if (clash) return { status: 409, data: { message: "bookings_no_room_overlap" } };
        if (body.member_id && !db.members.some(function (m) { return m.id === body.member_id; })) {
          return { status: 409, data: { message: "bookings_member_id_fkey" } };
        }
        body = Object.assign({ status: "확정", memo: null }, body);
      }
      if (p.table === "rooms" && db.rooms.some(function (r) { return r.name === body.name; })) {
        return { status: 409, data: { message: "duplicate key" } };
      }
      var row = Object.assign({ id: ++db.next }, body);
      rows.push(row);
      save();
      return { status: 201, data: [row] };
    }
    return { status: 405, data: null };
  }

  function respond(res) {
    return Promise.resolve({ status: res.status, ok: res.status < 300, data: res.data });
  }

  function install() {
    if (!window.LeeshAPI) return;
    window.LeeshAPI.request = function (path, init) {
      var body = init && init.body ? JSON.parse(init.body) : {};
      if (path.indexOf("/auth/v1/token") === 0) {
        return respond({ status: 200, data: { access_token: "demo", refresh_token: "demo", expires_in: 86400, user: { email: body.email || "demo@leesh" } } });
      }
      var rest = path.replace(/^\/rest\/v1\//, "");
      if (rest.indexOf("rpc/") === 0) {
        var fn = fns[rest.slice(4)];
        return respond(fn ? { status: 200, data: fn(body) } : { status: 404, data: null });
      }
      return respond(table((init && init.method) || "GET", rest, body));
    };
  }

  /* ---------------- banner ---------------- */

  function banner() {
    var css = document.createElement("style");
    css.textContent =
      ".demo-bar{position:fixed;z-index:999;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom, 0px));" +
      "display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;max-width:760px;margin:0 auto;padding:10px 14px;" +
      "border-radius:12px;background:#2B2522;color:#F6EBDD;font:13px/1.45 'Jost','Noto Sans KR',sans-serif;" +
      "box-shadow:0 6px 20px rgba(0,0,0,.25);}" +
      ".demo-bar b{color:#E6CF9E;font-weight:500;}.demo-bar span{flex:1 1 220px;}" +
      ".demo-bar a,.demo-bar button{color:#F6EBDD;background:none;border:1px solid rgba(246,235,221,.5);border-radius:999px;" +
      "padding:5px 12px;font:inherit;text-decoration:none;cursor:pointer;white-space:nowrap;}" +
      ".demo-bar a:hover,.demo-bar button:hover{background:rgba(246,235,221,.12);}" +
      ".demo-bar[data-min] span,.demo-bar[data-min] a,.demo-bar[data-min] .demo-reset{display:none;}" +
      "body{padding-bottom:84px;}";
    document.head.appendChild(css);
    var bar = document.createElement("div");
    bar.className = "demo-bar";
    bar.innerHTML = "<span><b>체험 모드</b> · 가짜 데이터라 실제로 저장되지 않아요. 예약 로그인 S001 / 5678 · 관리자는 아무 이메일·비밀번호</span>" +
      "<a href=\"admin.html\">관리자 화면</a><button type=\"button\" class=\"demo-reset\">데이터 초기화</button>" +
      "<button type=\"button\" class=\"demo-min\" aria-label=\"안내 접기\">접기</button>";
    bar.querySelector(".demo-reset").addEventListener("click", function () {
      db = seed();
      save();
      try { sessionStorage.clear(); } catch (e) { /* ignore */ }
      location.reload();
    });
    bar.querySelector(".demo-min").addEventListener("click", function () {
      var min = !bar.hasAttribute("data-min");
      if (min) bar.setAttribute("data-min", ""); else bar.removeAttribute("data-min");
      this.textContent = min ? "체험 모드" : "접기";
    });
    document.body.appendChild(bar);
  }

  install(); // demo.js loads right after api.js, before the page scripts
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", banner); else banner();
})();
