// 체험 모드 — preview builds only (tools/build_preview.py), loaded right after api.js. Answers the same
// requests as Supabase from a fake database kept in this browser, so every
// page can be clicked through before the real database exists. Mirrors the
// rules in supabase/schema.sql; the real ones live there.
(function () {
  var cfg = window.LEESH = window.LEESH || {};
  cfg.supabaseKey = "demo";
  cfg.local = true;
  cfg.demoImages = true; // 내 폴더 shows the sample report pages even without a (fake) Kakao sign-in
  var KEY = "leesh_demo_db";
  var VERSION = 20; // bump when the demo defaults change
  var demoTg = { bot: null, chats: 0, bookings: false }; // 텔레그램 알림 (체험 모드, 새로고침하면 처음으로)
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
  function before(m) { return m % 60 === 0 ? m / 60 + "시간" : m + "분"; }
  function fail(msg) { return { ok: false, error: msg }; }

  function seed() {
    var t = nowKst().today;
    var db = {
      version: VERSION,
      next: 600,
      settings: { id: 1, open_min: 0, close_min: 1440, unit_min: 60, max_minutes: 120, daily_max_minutes: 1440, max_days: 1, cancel_minutes: 60 },
      rooms: [["B1", "연습실"], ["B2", "연습실"], ["B3", "연습실"], ["B4", "연습실"], ["B5", "연습실"], ["C hall", "춤연습실"]]
        .map(function (r, i) { return { id: i + 1, name: r[0], kind: r[1], sort: i + 1, active: true }; }),
      members: [
        { id: "S001", name: "김시우", phone: "010-1234-5678", pin: "5678", status: "재원", expires_on: null, memo: "담당 원장님", must_change_pin: false, kakao_user: "kakao-sample" },
        { id: "S002", name: "이하늘", phone: "010-2222-9999", pin: "9999", status: "재원", expires_on: null, memo: "입시반 · 담당 안유정", must_change_pin: false, kakao_user: "kakao-hanul" },
        { id: "S003", name: "박새봄", phone: "010-5555-7777", pin: "7777", status: "휴원", expires_on: null, memo: "10월 복귀 예정", must_change_pin: false, kakao_user: null },
        { id: "S004", name: "정다온", phone: null, pin: "0000", status: "재원", expires_on: null, memo: "담당 안유정", must_change_pin: true, kakao_user: null },
        { id: "S005", name: "한지우", phone: null, pin: "0000", status: "재원", expires_on: null, memo: "담당 오은지", must_change_pin: true, kakao_user: null },
        { id: "G001", name: "외부 대관", phone: null, pin: "1234", status: "외부", expires_on: addDays(t, 14), memo: "댄스팀", must_change_pin: false, kakao_user: null }
      ],
      // 카카오 연결 요청 (the director approves these in 관리자 → 수강 ID)
      link_requests: [
        { id: 31, user_id: "kakao-wait", kakao_name: "다온🎤", name: "정다온", teacher: "이수빈", status: "대기", member_id: null, created_at: new Date(Date.now() - 5400000).toISOString(), decided_at: null }
      ],
      bookings: [
        { id: 1, room_id: 1, member_id: "S002", day: t, start_min: 1200, end_min: 1320, status: "확정", memo: null },
        { id: 2, room_id: 6, member_id: "G001", day: t, start_min: 1140, end_min: 1260, status: "확정", memo: null },
        { id: 3, room_id: 3, member_id: null, day: t, start_min: 600, end_min: 660, status: "확정", memo: "청소" },
        { id: 4, room_id: 2, member_id: "S001", day: t, start_min: 1320, end_min: 1440, status: "확정", memo: null }
      ],
      lesson_notes: [
        { id: 11, member_id: "S001", lesson_date: addDays(t, -2), teacher: "원장님", teacher_id: 504, did: "후렴 고음에서 턱에 힘 빼기.\n호흡을 먼저 채우고 소리를 얹는 연습.",
          songs: "밤편지 - 후렴 첫 음이 낮게 들어가요. 2절은 말하듯이 힘 빼고.", practice: "립트릴 5분 → 후렴 두 줄만 천천히 3번", audition: "다음 달 체험 엔터 내방 오디션 (보컬)",
          recommend: "볼빨간사춘기 - 우주를 줄게 (밝은 곡 연습용)", memo: "고음 욕심이 많아 목이 쉽게 피곤해함 (체험 모드 예시)", created_at: new Date().toISOString() },
        { id: 12, member_id: "S001", lesson_date: addDays(t, -9), teacher: "원장님", teacher_id: 504, did: "첫 소절 시작 음정 잡기. 반주 없이 첫 음 듣고 들어가기.", practice: "피아노로 첫 음 치고 따라 부르기 10번", created_at: new Date().toISOString() },
        { id: 13, member_id: "S001", lesson_date: addDays(t, -16), teacher: "원장님", teacher_id: 504, did: "노래 진단. 중음은 안정적, 고음에서 목이 조임.", practice: "하품하듯 입 벌리고 '아' 길게 5번", created_at: new Date().toISOString() },
        { id: 14, member_id: "S002", lesson_date: addDays(t, -3), teacher: "안유정", teacher_id: 501, did: "입시곡 2절 감정선 정리", songs: "입시곡 - 2절 브릿지 호흡 위치 바꾸기", practice: "2절 녹음해서 들어보기",
          audition: "12월 입시 실기", memo: "부모님이 진도 문의하심 (체험 모드 예시)", created_at: new Date().toISOString() }
      ],
      // 선생님 (teacher.html): 안유정 선생님이 체험용 카카오로 연결된 상태 + 기다리는 요청 하나
      teachers: ["안유정", "양유경", "오은지", "원장님", "이수빈", "이윤지", "이하섬", "최홍주"].map(function (n, i) {
        return { id: 501 + i, name: n, kakao_user: n === "안유정" ? "kakao-teacher" : null, active: true, created_at: new Date().toISOString() };
      }),
      teacher_requests: [
        { id: 521, user_id: "kakao-wait-t", kakao_name: "은지쌤", name: "오은지", status: "대기", teacher_id: null, created_at: new Date(Date.now() - 1800000).toISOString(), decided_at: null }
      ],
      monthly_evals: [
        { id: 21, member_id: "S001", month: t.slice(0, 7) + "-01", pitch: 4, rhythm: 3, breath: 4, expression: 4, stage: 3, comment: "고음에서 힘이 많이 빠졌어요! 박자만 조금 더 안정되면 좋겠어요.", goal: "메트로놈 켜고 연습하기", teacher: "이송희", created_at: new Date().toISOString() },
        { id: 22, member_id: "S001", month: addDays(t.slice(0, 7) + "-01", -1).slice(0, 7) + "-01", pitch: 3, rhythm: 3, breath: 3, expression: 3, stage: 2, comment: "첫 평가 수고했어요. 음정은 좋은 편이에요.", goal: "고음 호흡 연결", teacher: "이송희", created_at: new Date().toISOString() }
      ],
      // 월말평가 리포트 (분기): the pages are sample pictures made below, not real reports
      eval_reports: [
        { member_id: "S001", month: "2026-09-01", pages: 2, song: "태연(TAEYEON) - Rain", teacher: "이송희", basic: 7, technique: 7.5, acting: 6.5, styling: 7, total: 28, stage: "본사 오디션 도전", updated_at: new Date().toISOString() },
        { member_id: "S001", month: "2026-06-01", pages: 2, song: "아이유 - 너의 의미", teacher: "이송희", basic: 6, technique: 6, acting: 5.5, styling: 6.5, total: 24, stage: "1차 합격 가능성", updated_at: new Date().toISOString() },
        { member_id: "S002", month: "2026-09-01", pages: 0, song: "Ariana Grande - Honeymoon Avenue", teacher: "안유정", basic: 7.5, technique: 7, acting: 7, styling: 7.5, total: 29, stage: "본사 오디션 도전", updated_at: new Date().toISOString() }
      ],
      // 오디션 소식 (audition.html): sample posts, as if written in the admin page
      audition_news: [
        { id: 41, kind: "내방", company: "체험 엔터테인먼트", title: "다음 달 학원 내방 오디션", event_date: addDays(t, 18), deadline: addDays(t, 12),
          body: "일시 : 다음 달 금요일 오후 6시30분\n장소 : 이송희보컬레슨 C홀\n지원자격 : 남녀 04~15년생\n지원분야 : 보컬, 랩, 댄스, 라이브퍼포먼스, 연기 중 택 1\n\n체험 모드 예시 글이에요.", link: null, image: null, published: true,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 42, kind: "합격", company: "체험 엔터테인먼트", title: "1차 합격 (김OO)", event_date: addDays(t, -3), deadline: null,
          pass_type: "기획사", pass_stage: "1차 합격", initials: "김OO",
          body: "축하해요! 체험 모드 예시 글이에요.", link: null, image: null, published: true,
          created_at: new Date(Date.now() - 3 * 86400000).toISOString(), updated_at: new Date().toISOString() },
        { id: 43, kind: "합격", company: "SM 엔터테인먼트", title: "2차 합격 (이OO)", event_date: addDays(t, -10), deadline: null,
          pass_type: "기획사", pass_stage: "2차 합격", initials: "이OO", body: "체험 모드 예시 글이에요.", link: null, image: null, published: true,
          created_at: new Date(Date.now() - 10 * 86400000).toISOString(), updated_at: new Date().toISOString() },
        { id: 44, kind: "합격", company: "서울예술대학교", title: "수시 합격 (박OO)", event_date: addDays(t, -20), deadline: null,
          pass_type: "입시", pass_stage: "합격", initials: "박OO", body: "체험 모드 예시 글이에요.", link: null, image: null, published: true,
          created_at: new Date(Date.now() - 20 * 86400000).toISOString(), updated_at: new Date().toISOString() }
      ],
      // more 합격 소식 for the about board: one for a company already on it, one 입시
      // (added below with the same shape as the admin page writes)
      // 내 폴더: 공지 (원장님), 레퍼토리 · 연습 일지 (학생이 직접)
      notices: [
        { id: 51, title: "12월 월말평가 안내", body: "12월 셋째 주에 월말평가가 있어요. 곡은 담당 선생님과 정해주세요.\n체험 모드 예시 공지예요.", start_date: addDays(t, 40), end_date: addDays(t, 45), pinned: true, published: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 53, title: "휴원 안내", body: "이 날은 학원이 쉬어요. 연습실 예약도 닫혀요.\n체험 모드 예시 공지예요.", start_date: addDays(t, 9), end_date: addDays(t, 9), pinned: false, published: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 52, title: "연습실 청소 시간", body: "매주 월요일 오전 10~11시는 연습실 청소 시간이에요.", start_date: null, end_date: null, pinned: false, published: true, created_at: new Date(Date.now() - 86400000 * 5).toISOString(), updated_at: new Date().toISOString() }
      ],
      repertoire: [
        { id: 61, member_id: "S001", title: "Rain", artist: "태연", purpose: "오디션", status: "준비 중", memo: "2절 후렴 고음", created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 62, member_id: "S001", title: "너의 의미", artist: "아이유", purpose: "연습", status: "완성", memo: null, created_at: new Date().toISOString(), updated_at: new Date(Date.now() - 86400000 * 30).toISOString() }
      ],
      practice_logs: [
        { id: 71, member_id: "S001", day: addDays(t, -1), minutes: 60, song: "Rain", did: "후렴 고음 10번, 립트릴 5분. 호흡이 모자랐음", created_at: new Date().toISOString() },
        { id: 72, member_id: "S001", day: addDays(t, -3), minutes: 40, song: "Rain", did: "1절 감정선 녹음해서 들어봄", created_at: new Date().toISOString() }
      ],
      // 노래 추천: a made-up analysis in the same shape as the director's sheet
      song_recs: [
        { id: 81, member_id: "S001", made_on: addDays(t, -10), published: true, note: "맑은 중음이 제일 예뻐요. 1번 곡부터 같이 해봐요! (체험 모드 예시)",
          summary: [["분석한 곡", "태연 – Rain / 아이유 – 너의 의미"], ["낸 음역", "솔(G3) ~ 높은 레(D5)"], ["편한 음역", "도 ~ 라 (C4~A4) — 후렴의 높은 음도 편하게 씀"],
            ["음정", "두 곡 내내 안정적"], ["음색", "맑고 가벼운 소리, 밝은 편"], ["잘 맞는 분위기", "잔잔한 발라드와 어쿠스틱 팝"], ["어울리는 곡", "중음 위주에 후렴에서 한 번 올라가는 곡"]],
          songs: [
            { tag: "국내", artist: "아이유", title: "밤편지", why: "중음에서 조용히 이야기하듯 부르는 곡이라 맑은 음색이 잘 들려요.", melon: null, spotify: null, key: null },
            { tag: "국내", artist: "볼빨간사춘기", title: "우주를 줄게", why: "밝고 가벼운 소리와 잘 맞고, 오디션에서 표정과 함께 보여주기 좋아요.", melon: null, spotify: null, key: null },
            { tag: "팝", artist: "Taylor Swift", title: "Love Story", why: "멜로디가 쉽고 후렴이 귀에 남아요. 편한 음역 안에서 움직여요.", melon: null, spotify: null, key: null }
          ], created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      ],
      song_requests: [
        { id: 85, member_id: "S002", likes: "Ariana Grande, 태연", goal: "입시", memo: "고음이 많은 곡도 도전해보고 싶어요. (체험 모드 예시)", status: "접수", created_at: new Date(Date.now() - 7200000).toISOString(),
          files: [{ path: "S002/demo-1.wav", name: "녹음 1", type: "audio/wav", size: 88244, sec: 1 }] }
      ],
      // 내방 오디션 신청서 (apply.html): one sample application for the audition above
      visit_applications: [
        { id: 91, news_id: 41, audition: "체험 엔터테인먼트 다음 달 학원 내방 오디션", member_id: "S002", name: "이하늘", gender: "여", birth: "09년/18살",
          body_size: "163/47", field: "보컬", music: null, note: "학교가 늦게 끝나서 뒷순서로 부탁드려요 (체험 모드 예시)",
          created_at: new Date(Date.now() - 3600000).toISOString(), updated_at: new Date(Date.now() - 3600000).toISOString() }
      ],
      // 제휴 업체 (종류만, 업체 이름은 원장님이 관리자에서 적음) + 예시 신청 하나
      partners: ["헤어 메이크업", "붙임머리", "스타일링 컨설팅", "경락", "헬스장", "피부과", "성형외과", "치과", "촬영 스튜디오", "심리상담센터"]
        .map(function (c, i) { return { id: 301 + i, category: c, name: null, info: c === "촬영 스튜디오" ? "프로필 사진 촬영 · 학원생 할인 (체험 모드 예시)" : null, sort: i * 10, active: true }; }),
      partner_requests: [
        { id: 351, partner_id: 301, partner: "헤어 메이크업", member_id: "S002", wish: "다음 주 토요일 오전", memo: "오디션 프로필 촬영용이에요 (체험 모드 예시)", status: "접수", reply: null,
          created_at: new Date(Date.now() - 5400000).toISOString(), updated_at: new Date(Date.now() - 5400000).toISOString() }
      ],
      // 인스타그램에서 가져온 글 (made up): the admin page's 인스타그램 연결 starts as connected
      ig_connected: true,
      ig_posts: [
        { id: "demo_ig1", posted_at: new Date(Date.now() - 86400000).toISOString(), media_type: "IMAGE", kind: "내방", kind_fixed: false, hidden: false,
          caption: "[이송희보컬레슨 내방오디션 일정] 체험 엔터테인먼트\n" + addDays(t, 9) + " 18시 30분\n\n모집대상: 2007년생 이후 출생자\n보컬: 무반주 1분 이내 / 댄스: 음원 준비 1분 이내\n\n체험 모드 예시 글이에요.\n#내방오디션 #이송희보컬레슨",
          permalink: "https://www.instagram.com/leeshvocal_auditionn/", images: ["assets/img/blog/audition-board.webp"] },
        { id: "demo_ig2", posted_at: new Date(Date.now() - 2 * 86400000).toISOString(), media_type: "IMAGE", kind: "소식", kind_fixed: false, hidden: false,
          caption: "11월 다이어트 단톡방 운영 방식 변경 안내\n주 1회 인증 + 식단 피드백으로 바뀌어요.\n\n체험 모드 예시 글이에요.",
          permalink: "https://www.instagram.com/leeshvocal_auditionn/", images: ["assets/img/blog/seminar.webp"] },
        { id: "demo_ig3", posted_at: new Date(Date.now() - 5 * 86400000).toISOString(), media_type: "IMAGE", kind: "합격", kind_fixed: false, hidden: false,
          caption: "체험 엔터테인먼트 1차 합격을 축하합니다! 김OO\n\n체험 모드 예시 글이에요.",
          permalink: "https://www.instagram.com/leeshvocal_auditionn/", images: [] }
      ],
      tokens: [], // "로그인 유지" keys: { key, member_id }
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
    if (!db || db.version !== VERSION) { db = seed(); save(); } // new defaults replace old demo data
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* memory only */ } }
  load();

  /* ---------------- database functions ---------------- */

  function checkMember(id, pin, uid) {
    id = String(id || "").trim().toUpperCase();
    var raw = String(pin || "").trim(), via = raw.length >= 32 ? "token" : raw === "" && uid ? "kakao" : "pin", m;
    if (via === "kakao") {
      m = db.members.filter(function (x) { return x.kakao_user === uid; })[0];
      if (!m) return { ok: false, code: "not_linked", error: "아직 학원 승인 전이에요. 승인되면 바로 쓸 수 있어요." };
    } else {
      return fail("카카오로 로그인해주세요."); // 수강 ID 로그인은 없앰 (supabase/schema.sql settings.pin_login)
    }
    if (m.status !== "재원" && m.status !== "외부") return fail("현재 이용 중인 수강 ID가 아닙니다. 학원에 문의해주세요.");
    if (m.expires_on && m.expires_on < nowKst().today) return fail("사용 기한이 지난 ID입니다. 학원에 문의해주세요.");
    return { ok: true, id: m.id, name: m.name, via: via, mustChange: via !== "kakao" && !!m.must_change_pin };
  }
  // 예약 · 취소 · 내 폴더: a temporary 0000 PIN has to be changed first (private.check_ready)
  function checkReady(id, pin, uid) {
    var who = checkMember(id, pin, uid);
    if (who.ok && who.mustChange) return { ok: false, code: "must_change", error: "처음 비밀번호를 새로 정해주세요." };
    return who;
  }
  function newKey() {
    var key = "";
    for (var i = 0; i < 48; i++) key += "0123456789abcdef"[Math.floor(Math.random() * 16)];
    return key;
  }
  // signing in with the PIN hands back a new "stay signed in" key, like private.with_token
  function withToken(who, body) {
    if (who.via !== "pin") return body;
    var key = newKey();
    db.tokens.push({ key: key, member_id: who.id });
    save();
    body.token = key;
    return body;
  }
  function live() { return db.bookings.filter(function (b) { return b.status === "확정"; }); }
  function room(id) { return db.rooms.filter(function (r) { return r.id === id; })[0]; }

  var fns = {
    rooms_day: function (a, uid) {
      if (!checkReady("", "", uid).ok) return { ok: false, code: "members_only", error: "수강생만 볼 수 있어요. 카카오로 로그인해주세요." };
      var s = db.settings, n = nowKst(), d = a.p_date || n.today;
      var ahead = diffDays(n.today, d);
      if (isNaN(ahead) || ahead < 0 || ahead > s.max_days) return fail("예약할 수 없는 날짜입니다.");
      var days = [];
      for (var i = 0; i <= s.max_days; i++) days.push(addDays(n.today, i));
      return {
        ok: true, date: d, now: ahead === 0 ? n.min : null, days: days, unit: s.unit_min, open: hhmm(s.open_min), close: hhmm(s.close_min),
        maxHours: s.max_minutes / 60, dailyMaxHours: s.daily_max_minutes / 60, cancelBefore: before(s.cancel_minutes),
        rooms: db.rooms.filter(function (r) { return r.active; })
          .sort(function (x, y) { return x.sort - y.sort || x.id - y.id; })
          .map(function (r) {
            var free = [];
            for (var g = s.open_min; g + s.unit_min <= s.close_min; g += s.unit_min) {
              if (ahead === 0 && g <= n.min) continue; // started already
              var taken = live().some(function (b) { return b.room_id === r.id && b.day === d && b.start_min < g + s.unit_min && g < b.end_min; });
              if (!taken) free.push(hhmm(g));
            }
            return { name: r.name, type: r.kind, free: free };
          })
      };
    },
    member_login: function (a, uid) {
      var who = checkMember(a.p_id, a.p_pin, uid);
      if (!who.ok) return who;
      var n = nowKst(), s = db.settings;
      var mine = live().filter(function (b) {
        return b.member_id === who.id && (b.day > n.today || (b.day === n.today && b.end_min > n.min));
      }).sort(function (x, y) { return x.day === y.day ? x.start_min - y.start_min : (x.day < y.day ? -1 : 1); });
      return withToken(who, {
        ok: true, id: who.id, name: who.name, mustChange: who.mustChange,
        bookings: mine.map(function (b) {
          return {
            id: b.id, room: room(b.room_id).name, date: b.day, start: hhmm(b.start_min), end: hhmm(b.end_min),
            cancellable: diffDays(n.today, b.day) * 1440 + b.start_min - n.min >= s.cancel_minutes
          };
        })
      });
    },
    booking_create: function (a, uid) {
      var who = checkReady(a.p_id, a.p_pin, uid);
      if (!who.ok) return who;
      var s = db.settings, n = nowKst(), d = a.p_date, ahead = diffDays(n.today, d);
      if (isNaN(ahead)) return fail("날짜 형식이 올바르지 않습니다.");
      if (ahead < 0) return fail("지난 날짜는 예약할 수 없습니다.");
      if (ahead > s.max_days) return fail(s.max_days === 0 ? "예약은 당일만 할 수 있어요. 매일 밤 12시에 그날 예약이 열려요." : s.max_days === 1 ? "예약은 오늘과 내일만 할 수 있어요. 매일 밤 12시에 다음 날 예약이 열려요." : "예약은 오늘부터 " + s.max_days + "일 뒤까지만 가능합니다.");
      var r = db.rooms.filter(function (x) { return x.name === a.p_room && x.active; })[0];
      if (!r) return fail("선택한 연습실을 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.");
      var st = toMin(a.p_start), h = Number(a.p_hours);
      if (st == null) return fail("시작 시간이 올바르지 않습니다.");
      if (!(h >= 1)) return fail("이용 시간을 선택해주세요.");
      if (h * 60 > s.max_minutes) return fail("한 번에 최대 " + s.max_minutes / 60 + "시간까지 예약할 수 있습니다.");
      var en = st + h * 60;
      if (st < s.open_min || en > s.close_min) return fail("운영 시간(" + hhmm(s.open_min) + "~" + hhmm(s.close_min) + ") 안에서만 예약할 수 있습니다.");
      if (ahead === 0 && st <= n.min) return fail("이미 시작한 시간이에요. 다음 시간부터 예약할 수 있어요.");
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
    booking_cancel: function (a, uid) {
      var who = checkReady(a.p_id, a.p_pin, uid);
      if (!who.ok) return who;
      var n = nowKst(), s = db.settings;
      var b = live().filter(function (x) { return x.id === a.p_booking && x.member_id === who.id; })[0];
      if (!b) return fail("취소할 예약을 찾을 수 없습니다.");
      if (diffDays(n.today, b.day) * 1440 + b.start_min - n.min < s.cancel_minutes) {
        return fail("시작 " + before(s.cancel_minutes) + " 전이 지나 직접 취소할 수 없습니다. 학원에 연락해주세요.");
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
      if (!m) { m = { id: id, kakao_user: null }; db.members.push(m); }
      var created = !m.name;
      m.name = String(a.p_name).trim();
      m.phone = String(a.p_phone || "").trim() || null;
      m.status = a.p_status || "재원";
      m.expires_on = a.p_expires_on || null;
      m.memo = String(a.p_memo || "").trim() || null;
      if (pin) {
        m.pin = pin;
        m.must_change_pin = pin === "0000";
        db.tokens = db.tokens.filter(function (x) { return x.member_id !== id; }); // signs out every device
      }
      save();
      return { ok: true, id: id, created: created };
    },
    member_notebook: function (a, uid) {
      var who = checkReady(a.p_id, a.p_pin, uid);
      if (!who.ok) return who;
      return withToken(who, {
        ok: true, id: who.id, name: who.name,
        notes: db.lesson_notes.filter(function (n) { return n.member_id === who.id; })
          .sort(function (x, y) { return x.lesson_date < y.lesson_date ? 1 : x.lesson_date > y.lesson_date ? -1 : y.id - x.id; })
          .slice(0, 30)
          .map(function (n) { return { date: n.lesson_date, teacher: n.teacher, did: n.did, practice: n.practice, songs: n.songs, audition: n.audition, recommend: n.recommend }; }),
        bookings: live().filter(function (b) { return b.member_id === who.id && b.day >= nowKst().today; })
          .sort(function (x, y) { return x.day === y.day ? x.start_min - y.start_min : (x.day < y.day ? -1 : 1); })
          .map(function (b) { return { room: room(b.room_id).name, date: b.day, start: hhmm(b.start_min), end: hhmm(b.end_min) }; }),
        month: (function () {
          var n = nowKst(), mine = live().filter(function (b) { return b.member_id === who.id && b.day.slice(0, 7) === n.today.slice(0, 7) && b.day <= n.today; });
          return { count: mine.length, minutes: mine.reduce(function (s, b) { return s + b.end_min - b.start_min; }, 0) };
        })(),
        notices: db.notices.filter(function (x) { return x.published && (!x.end_date || x.end_date >= nowKst().today); })
          .sort(function (x, y) { return (y.pinned - x.pinned) || (x.created_at < y.created_at ? 1 : -1); })
          .map(function (x) { return { id: x.id, title: x.title, body: x.body, start: x.start_date, end: x.end_date, pinned: x.pinned, at: x.created_at }; }),
        visits: db.audition_news.filter(function (a) { return a.published && a.kind === "내방" && a.event_date && a.event_date >= nowKst().today; })
          .map(function (a) { return { title: a.title, company: a.company, date: a.event_date, deadline: a.deadline }; }),
        repertoire: db.repertoire.filter(function (r) { return r.member_id === who.id; }).map(function (r) {
          return Object.assign({}, r, { minutes: db.practice_logs.filter(function (l) { return l.member_id === who.id && l.song === r.title; })
            .reduce(function (s, l) { return s + (l.minutes || 0); }, 0) });
        }),
        logs: db.practice_logs.filter(function (l) { return l.member_id === who.id; })
          .sort(function (x, y) { return x.day === y.day ? y.id - x.id : (x.day < y.day ? 1 : -1); }),
        recs: db.song_recs.filter(function (r) { return r.member_id === who.id && r.published; })
          .sort(function (x, y) { return x.made_on === y.made_on ? y.id - x.id : (x.made_on < y.made_on ? 1 : -1); })
          .map(function (r) { return { id: r.id, date: r.made_on, summary: r.summary, songs: r.songs, note: r.note }; }),
        request: db.song_requests.filter(function (q) { return q.member_id === who.id && q.status === "접수"; })
          .map(function (q) { return { at: q.created_at, likes: q.likes, goal: q.goal, memo: q.memo, files: q.files || [] }; })[0] || null,
        reports: db.eval_reports.filter(function (r) { return r.member_id === who.id; })
          .sort(function (x, y) { return x.month < y.month ? 1 : -1; })
          .map(function (r) {
            return { month: r.month.slice(0, 7), pages: r.pages, song: r.song, teacher: r.teacher, basic: r.basic, technique: r.technique,
              acting: r.acting, styling: r.styling, total: r.total, stage: r.stage };
          }),
        evals: db.monthly_evals.filter(function (e) { return e.member_id === who.id; })
          .sort(function (x, y) { return x.month < y.month ? 1 : -1; })
          .slice(0, 12)
          .map(function (e) {
            return { month: e.month.slice(0, 7), teacher: e.teacher, comment: e.comment, goal: e.goal,
              scores: { pitch: e.pitch, rhythm: e.rhythm, breath: e.breath, expression: e.expression, stage: e.stage } };
          })
      });
    },
    member_logout: function (a) {
      var id = String(a.p_id || "").trim().toUpperCase();
      db.tokens = db.tokens.filter(function (x) { return !(x.key === a.p_token && x.member_id === id); });
      save();
      return { ok: true };
    },
    member_change_pin: function (a) {
      var who = checkMember(a.p_id, a.p_pin), pin = String(a.p_new || "");
      if (!who.ok) return who;
      if (!/^\d{4}$/.test(pin)) return fail("새 비밀번호는 숫자 4자리로 정해주세요.");
      if (pin === "0000") return fail("0000은 쓸 수 없어요. 다른 4자리로 정해주세요.");
      if (/^(.)\1{3}$/.test(pin) || pin === "1234" || pin === "4321") return fail("너무 쉬운 번호예요. 다른 4자리로 정해주세요.");
      var m = db.members.filter(function (x) { return x.id === who.id; })[0];
      m.pin = pin;
      m.must_change_pin = false;
      db.tokens = db.tokens.filter(function (x) { return x.member_id !== m.id; });
      var key = newKey();
      db.tokens.push({ key: key, member_id: m.id });
      save();
      return { ok: true, id: m.id, name: m.name, token: key };
    },
    kakao_status: function (a, uid) {
      if (!uid) return fail("카카오 로그인이 필요해요.");
      var m = db.members.filter(function (x) { return x.kakao_user === uid; })[0];
      if (m) return { ok: true, linked: true, name: m.name, active: m.status === "재원" || m.status === "외부" };
      var r = db.link_requests.filter(function (x) { return x.user_id === uid; })[0];
      return { ok: true, linked: false, request: r ? { status: r.status, name: r.name, teacher: r.teacher } : null };
    },
    kakao_link_request: function (a, uid) {
      if (!uid) return fail("카카오 로그인이 필요해요.");
      if (db.members.some(function (x) { return x.kakao_user === uid; })) return fail("이미 연결된 계정이에요.");
      var name = String(a.p_name || "").trim();
      if (!name || name.length > 30) return fail("이름을 정확히 적어주세요.");
      var r = db.link_requests.filter(function (x) { return x.user_id === uid; })[0];
      if (!r) { r = { id: ++db.next, user_id: uid, kakao_name: "체험 카카오" }; db.link_requests.push(r); }
      Object.assign(r, { name: name, teacher: String(a.p_teacher || "").trim() || null, status: "대기", member_id: null, created_at: new Date().toISOString(), decided_at: null });
      save();
      return { ok: true };
    },
    admin_kakao_decide: function (a) {
      var r = db.link_requests.filter(function (x) { return x.id === a.p_request; })[0];
      if (!r) return fail("요청을 찾을 수 없어요.");
      r.decided_at = new Date().toISOString();
      if (!a.p_approve) { r.status = "거절"; r.member_id = null; save(); return { ok: true, status: "거절" }; }
      var mid = String(a.p_member || "").trim().toUpperCase();
      var m = db.members.filter(function (x) { return x.id === mid; })[0];
      if (!m) return fail("수강 ID를 골라주세요.");
      var other = db.members.filter(function (x) { return x.kakao_user === r.user_id && x.id !== mid; })[0];
      if (other) return fail("이 카카오 계정은 이미 " + other.id + "에 연결돼 있어요.");
      m.kakao_user = r.user_id;
      r.status = "승인";
      r.member_id = mid;
      save();
      return { ok: true, status: "승인", member: mid };
    },
    admin_kakao_unlink: function (a) {
      var m = db.members.filter(function (x) { return x.id === String(a.p_member || "").toUpperCase(); })[0];
      if (m && m.kakao_user) {
        db.link_requests.forEach(function (r) { if (r.user_id === m.kakao_user) r.status = "거절"; });
        m.kakao_user = null;
        save();
      }
      return { ok: true };
    },
    member_repertoire_save: function (a, uid) {
      var who = checkReady(a.p_id, a.p_pin, uid);
      if (!who.ok) return who;
      var title = String(a.p_title || "").trim();
      if (!title) return fail("곡 제목을 적어주세요.");
      var row = a.p_song ? db.repertoire.filter(function (r) { return r.id === a.p_song && r.member_id === who.id; })[0] : null;
      if (a.p_song && !row) return fail("곡을 찾을 수 없어요.");
      if (!row) { row = { id: ++db.next, member_id: who.id, created_at: new Date().toISOString() }; db.repertoire.push(row); }
      Object.assign(row, { title: title, artist: a.p_artist || null, purpose: a.p_purpose || null, status: a.p_status || "준비 중", memo: a.p_memo || null, updated_at: new Date().toISOString() });
      save();
      return { ok: true, id: row.id };
    },
    member_repertoire_delete: function (a, uid) {
      var who = checkReady(a.p_id, a.p_pin, uid);
      if (!who.ok) return who;
      db.repertoire = db.repertoire.filter(function (r) { return !(r.id === a.p_song && r.member_id === who.id); });
      save();
      return { ok: true };
    },
    member_log_save: function (a, uid) {
      var who = checkReady(a.p_id, a.p_pin, uid);
      if (!who.ok) return who;
      var n = nowKst(), ago = diffDays(a.p_day, n.today);
      if (isNaN(ago) || ago < 0 || ago > 60) return fail("오늘부터 60일 전까지의 날짜로 써주세요.");
      if (!a.p_did && a.p_minutes == null) return fail("연습한 내용이나 시간을 적어주세요.");
      var row = { id: ++db.next, member_id: who.id, day: a.p_day, minutes: a.p_minutes, song: a.p_song || null, did: a.p_did || null, created_at: new Date().toISOString() };
      db.practice_logs.push(row);
      save();
      return { ok: true, id: row.id };
    },
    member_log_delete: function (a, uid) {
      var who = checkReady(a.p_id, a.p_pin, uid);
      if (!who.ok) return who;
      db.practice_logs = db.practice_logs.filter(function (l) { return !(l.id === a.p_log && l.member_id === who.id); });
      save();
      return { ok: true };
    },
    member_song_request: function (a, uid) {
      var who = checkReady(a.p_id, a.p_pin, uid);
      if (!who.ok) return who;
      var row = db.song_requests.filter(function (q) { return q.member_id === who.id && q.status === "접수"; })[0];
      if (!row) { row = { id: ++db.next, member_id: who.id, status: "접수", created_at: new Date().toISOString() }; db.song_requests.push(row); }
      Object.assign(row, { likes: a.p_likes || null, goal: a.p_goal || null, memo: a.p_memo || null });
      if (a.p_files) row.files = a.p_files; else if (!row.files) row.files = [];
      save();
      return { ok: true, id: row.id };
    },
    member_visit_open: function (a, uid) {
      var who = checkReady(a.p_id, a.p_pin, uid);
      if (!who.ok) return who;
      var today = nowKst().today;
      return { ok: true, name: who.name, auditions: db.audition_news.filter(function (n) {
        return n.kind === "내방" && n.published && (n.deadline || n.event_date || today) >= today;
      }).map(function (n) {
        var mine = db.visit_applications.filter(function (x) { return x.news_id === n.id && x.member_id === who.id; })[0] || null;
        return { id: n.id, company: n.company, title: n.title, date: n.event_date, deadline: n.deadline, body: n.body, image: n.image, mine: mine };
      }) };
    },
    member_visit_apply: function (a, uid) {
      var who = checkReady(a.p_id, a.p_pin, uid);
      if (!who.ok) return who;
      var n = db.audition_news.filter(function (x) { return x.id === a.p_news && x.kind === "내방"; })[0];
      if (!n) return fail("신청할 오디션을 찾을 수 없어요.");
      if (!a.p_field) return fail("지원분야를 하나 골라주세요.");
      var row = db.visit_applications.filter(function (x) { return x.news_id === n.id && x.member_id === who.id; })[0];
      if (!row) { row = { id: ++db.next, news_id: n.id, member_id: who.id, created_at: new Date().toISOString() }; db.visit_applications.push(row); }
      Object.assign(row, { audition: (n.company ? n.company + " " : "") + n.title, name: a.p_name, gender: a.p_gender, birth: a.p_birth,
        body_size: a.p_size, field: a.p_field, music: a.p_music || row.music || null, note: a.p_note, updated_at: new Date().toISOString() });
      save();
      return { ok: true, id: row.id };
    },
    member_partners: function (a, uid) {
      var who = checkReady(a.p_id, a.p_pin, uid);
      if (!who.ok) return who;
      return { ok: true,
        partners: db.partners.filter(function (p) { return p.active; }).sort(function (x, y) { return x.sort - y.sort || x.id - y.id; })
          .map(function (p) { return { id: p.id, category: p.category, name: p.name, info: p.info }; }),
        requests: db.partner_requests.filter(function (r) { return r.member_id === who.id; }).sort(function (x, y) { return x.created_at < y.created_at ? 1 : -1; }).slice(0, 10)
          .map(function (r) { return { id: r.id, partner: r.partner, wish: r.wish, memo: r.memo, status: r.status, reply: r.reply, at: r.created_at }; }) };
    },
    member_partner_request: function (a, uid) {
      var who = checkReady(a.p_id, a.p_pin, uid);
      if (!who.ok) return who;
      var p = db.partners.filter(function (x) { return x.id === a.p_partner && x.active; })[0];
      if (!p) return fail("업체를 골라주세요.");
      if (!String(a.p_wish || "").trim()) return fail("원하는 날짜·시간을 적어주세요.");
      if (db.partner_requests.filter(function (r) { return r.member_id === who.id && r.status === "접수"; }).length >= 3) {
        return fail("아직 처리 중인 신청이 3개 있어요. 예약이 끝나면 다시 신청해주세요.");
      }
      var now = new Date().toISOString();
      db.partner_requests.push({ id: ++db.next, partner_id: p.id, partner: p.category + (p.name ? " · " + p.name : ""), member_id: who.id,
        wish: a.p_wish.trim(), memo: a.p_memo || null, status: "접수", reply: null, created_at: now, updated_at: now });
      save();
      return { ok: true };
    },
    member_partner_cancel: function (a, uid) {
      var who = checkReady(a.p_id, a.p_pin, uid);
      if (!who.ok) return who;
      var r = db.partner_requests.filter(function (x) { return x.id === a.p_req && x.member_id === who.id && x.status === "접수"; })[0];
      if (!r) return fail("이미 예약된 신청은 학원에 연락해서 취소해주세요.");
      r.status = "취소";
      save();
      return { ok: true };
    },
    // 구글시트 연결 (관리자 → 수강 ID): 체험 모드는 연결된 척
    admin_sheet_status: function () {
      return { ok: true, connected: true, lastAt: new Date(Date.now() - 3600000).toISOString(), webUrl: null,
        last: { added: 1, changed: 2, same: 160, newTeachers: [] } };
    },
    admin_sheet_open: function () { return { ok: true }; },
    // 텔레그램 알림 (관리자 → 설정): 체험 모드는 실제로 보내지 않고 연결된 척만
    admin_telegram_status: function () { return { ok: true, hasBot: !!demoTg.bot, bot: demoTg.bot, chats: demoTg.chats, groups: demoTg.chats ? 1 : 0, bookings: demoTg.bookings }; },
    admin_telegram_set: function (a) {
      if (!/^[0-9]{5,15}:[A-Za-z0-9_-]{30,50}$/.test(String(a.p_token || "").trim())) return fail("토큰 모양이 달라요. BotFather가 준 \"숫자:글자\" 전체를 붙여넣어 주세요.");
      demoTg.bot = "leesh_alarm_bot"; demoTg.chats = 0;
      return { ok: true, bot: demoTg.bot };
    },
    admin_telegram_link: function () { demoTg.chats = 1; return { ok: true, chats: 1, groups: 1 }; },
    admin_telegram_options: function (a) { demoTg.bookings = !!a.p_bookings; return { ok: true }; },
    admin_telegram_off: function () { demoTg.bot = null; demoTg.chats = 0; return { ok: true }; },
    // 선생님 화면 (teacher.html)
    teacher_me: function (a, uid) {
      if (!uid) return fail("카카오 로그인이 필요해요.");
      var t = myTeacher(uid);
      if (!t) {
        var r = db.teacher_requests.filter(function (x) { return x.user_id === uid; })[0];
        return { ok: true, linked: false, request: r ? { name: r.name, status: r.status } : null,
          names: db.teachers.filter(function (x) { return x.active; }).map(function (x) { return x.name; }).sort() };
      }
      return { ok: true, linked: true, name: t.name, students: db.members.filter(function (m) { return teaches(t, m.id); })
        .map(function (m) {
          var last = db.lesson_notes.filter(function (n) { return n.member_id === m.id; }).map(function (n) { return n.lesson_date; }).sort().pop() || null;
          return { id: m.id, name: m.name, status: m.status, last: last };
        }).sort(function (x, y) { return x.name < y.name ? -1 : 1; }) };
    },
    teacher_request: function (a, uid) {
      if (!uid) return fail("카카오 로그인이 필요해요.");
      if (!db.teachers.some(function (x) { return x.name === a.p_name && x.active; })) return fail("선생님 이름을 골라주세요.");
      var r = db.teacher_requests.filter(function (x) { return x.user_id === uid; })[0];
      if (!r) { r = { id: ++db.next, user_id: uid, kakao_name: "체험 카카오" }; db.teacher_requests.push(r); }
      Object.assign(r, { name: a.p_name, status: "대기", teacher_id: null, created_at: new Date().toISOString(), decided_at: null });
      save();
      return { ok: true };
    },
    teacher_student: function (a, uid) {
      var t = myTeacher(uid);
      if (!t) return fail("선생님으로 연결된 계정만 볼 수 있어요.");
      if (!teaches(t, a.p_member)) return fail("담당 학생만 볼 수 있어요.");
      var m = db.members.filter(function (x) { return x.id === a.p_member; })[0];
      return { ok: true, student: { id: m.id, name: m.name, status: m.status },
        notes: db.lesson_notes.filter(function (n) { return n.member_id === m.id; })
          .sort(function (x, y) { return x.lesson_date < y.lesson_date ? 1 : x.lesson_date > y.lesson_date ? -1 : y.id - x.id; })
          .map(function (n) { return { id: n.id, date: n.lesson_date, teacher: n.teacher, did: n.did, songs: n.songs, practice: n.practice,
            audition: n.audition, recommend: n.recommend, memo: n.memo, mine: n.teacher_id === t.id }; }),
        logs: db.practice_logs.filter(function (l) { return l.member_id === m.id; }).map(function (l) { return { day: l.day, minutes: l.minutes, song: l.song, did: l.did }; }),
        repertoire: db.repertoire.filter(function (r) { return r.member_id === m.id; }).map(function (r) { return { title: r.title, artist: r.artist, status: r.status, purpose: r.purpose }; }) };
    },
    teacher_note_save: function (a, uid) {
      var t = myTeacher(uid);
      if (!t) return fail("선생님으로 연결된 계정만 쓸 수 있어요.");
      if (!teaches(t, a.p_member)) return fail("담당 학생만 쓸 수 있어요.");
      var keys = ["did", "songs", "practice", "audition", "recommend", "memo"], v = {};
      keys.forEach(function (k) { v[k] = String(a["p_" + k] || "").trim() || null; });
      if (!keys.some(function (k) { return v[k]; })) return fail("한 칸 이상 적어주세요.");
      var n;
      if (a.p_note) {
        n = db.lesson_notes.filter(function (x) { return x.id === a.p_note && x.teacher_id === t.id; })[0];
        if (!n) return fail("내가 쓴 일지만 고칠 수 있어요.");
      } else {
        n = { id: ++db.next, member_id: a.p_member, teacher: t.name, teacher_id: t.id, created_at: new Date().toISOString() };
        db.lesson_notes.push(n);
      }
      Object.assign(n, v, { lesson_date: a.p_date });
      save();
      return { ok: true, id: n.id };
    },
    teacher_note_delete: function (a, uid) {
      var t = myTeacher(uid);
      var n = t && db.lesson_notes.filter(function (x) { return x.id === a.p_note && x.teacher_id === t.id; })[0];
      if (!n) return fail("내가 쓴 일지만 지울 수 있어요.");
      db.lesson_notes = db.lesson_notes.filter(function (x) { return x !== n; });
      save();
      return { ok: true };
    },
    admin_teacher_decide: function (a) {
      var r = db.teacher_requests.filter(function (x) { return x.id === a.p_request; })[0];
      if (!r) return fail("요청을 찾을 수 없어요.");
      if (!a.p_approve) { r.status = "거절"; save(); return { ok: true, status: "거절" }; }
      var t = db.teachers.filter(function (x) { return x.id === a.p_teacher; })[0];
      if (!t) return fail("선생님을 골라주세요.");
      t.kakao_user = r.user_id;
      r.status = "승인";
      r.teacher_id = t.id;
      save();
      return { ok: true, status: "승인" };
    },
    admin_instagram_status: function () {
      return { ok: true, connected: !!db.ig_connected, count: db.ig_posts.length, lastSync: new Date().toISOString(), error: null };
    },
    admin_instagram_connect: function (a) {
      if (String(a.p_token || "").trim().length < 40) return fail("토큰을 다시 복사해서 붙여넣어 주세요.");
      db.ig_connected = true;
      save();
      return { ok: true, count: db.ig_posts.length };
    },
    admin_instagram_sync: function () { return { ok: true, count: db.ig_posts.length }; },
    is_admin: function () { return true; }
  };

  function myTeacher(uid) { return uid ? db.teachers.filter(function (x) { return x.kakao_user === uid && x.active; })[0] || null : null; }
  function teaches(t, mid) {
    var m = db.members.filter(function (x) { return x.id === mid; })[0];
    var d = m && /담당\s*([^\s·,]+)/.exec(m.memo || "");
    return !!(m && (m.status === "재원" || m.status === "휴원") && d && d[1] === t.name);
  }

  /* ---------------- 카카오로 로그인 (pretend) ----------------
     No real Kakao here: the button makes up a new Kakao account for this browser and comes back
     signed in, so the first-time flow (이름 알려주기 → 원장님 승인) can be clicked through. */
  var FAKE = "kakao:";
  function kakaoUid(init) {
    var h = (init && init.headers && init.headers.Authorization) || "";
    return h.indexOf("Bearer " + FAKE) === 0 ? h.slice(7 + FAKE.length) : null;
  }
  function fakeKakao() {
    var k = window.LeeshAPI && window.LeeshAPI.kakao;
    if (!k) return;
    k.available = function () { return true; };
    k.start = function () {
      k.save({ access: FAKE + "demo-" + Date.now().toString(36), refresh: "demo", expires: Math.floor(Date.now() / 1000) + 3650 * 86400 });
      location.reload();
    };
  }

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
      // gt./gte. (dates as ISO text) and is.false: the admin page's "new since" badges
      if (/^gte?\./.test(v)) {
        var eq = v.charAt(2) === "e", d = v.slice(eq ? 4 : 3);
        rows = rows.filter(function (r) { return r[k] != null && (eq ? String(r[k]) >= d : String(r[k]) > d); });
        return;
      }
      if (v.indexOf("is.") === 0) { var want = v.slice(3); rows = rows.filter(function (r) { return String(!!r[k]) === want; }); return; }
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
    if (method === "DELETE") {
      var gone = select(list, p.params);
      db[p.table] = rows.filter(function (r) { return gone.indexOf(r) === -1; });
      save();
      return { status: 200, data: gone };
    }
    if (method === "POST" && p.params.on_conflict) {
      var keys = p.params.on_conflict.split(",");
      var same = rows.filter(function (r) { return keys.every(function (k) { return String(r[k]) === String(body[k]); }); })[0];
      if (same) { Object.assign(same, body); save(); return { status: 200, data: [same] }; }
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
      var row = Object.assign({ id: ++db.next }, p.table === "audition_news" || p.table === "notices" || p.table === "song_recs" ? { created_at: new Date().toISOString(), published: true } : {}, body);
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
      if (path.indexOf("/auth/v1/") === 0) return respond({ status: 204, data: null });
      var rest = path.replace(/^\/rest\/v1\//, "");
      if (rest.indexOf("rpc/") === 0) {
        var fn = fns[rest.slice(4)];
        return respond(fn ? { status: 200, data: fn(body, kakaoUid(init)) } : { status: 404, data: null });
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
      ".demo-bar[data-min] span,.demo-bar[data-min] a,.demo-bar[data-min] .demo-reset,.demo-bar[data-min] .demo-student,.demo-bar[data-min] .demo-teacher,.demo-bar[data-min] .demo-intro{display:none;}" +
      "body{padding-bottom:84px;}" +
      "body:has(.scene:not([hidden])) .demo-bar{display:none;}";
    document.head.appendChild(css);
    var bar = document.createElement("div");
    bar.className = "demo-bar";
    bar.innerHTML = "<span><b>체험 모드</b> · 가짜 데이터라 실제로 저장되지 않아요. 카카오 버튼은 새 가짜 계정 (처음 연결 요청 체험) · 관리자는 아무 이메일</span>" +
      "<button type=\"button\" class=\"demo-student\">학생(김시우)으로 보기</button><button type=\"button\" class=\"demo-teacher\">선생님(안유정)으로 보기</button><a href=\"admin.html\">관리자 화면</a><button type=\"button\" class=\"demo-intro\">인트로 다시 보기</button><button type=\"button\" class=\"demo-reset\">데이터 초기화</button>" +
      "<button type=\"button\" class=\"demo-min\" aria-label=\"안내 접기\">접기</button>";
    bar.querySelector(".demo-intro").addEventListener("click", function () {
      try { localStorage.removeItem("leesh_intro"); } catch (e) { /* ignore */ }
      location.href = "index.html";
    });
    bar.querySelector(".demo-student").addEventListener("click", function () {
      window.LeeshAPI.kakao.save({ access: FAKE + "kakao-sample", refresh: "demo", expires: Math.floor(Date.now() / 1000) + 3650 * 86400 });
      // open 내 폴더 on the desktop (js/scene.js reads #me when the page loads)
      if (/\/(index\.html)?$/.test(location.pathname)) { location.hash = "me"; location.reload(); } else location.href = "index.html#me";
    });
    bar.querySelector(".demo-teacher").addEventListener("click", function () {
      window.LeeshAPI.kakao.save({ access: FAKE + "kakao-teacher", refresh: "demo", expires: Math.floor(Date.now() / 1000) + 3650 * 86400 });
      if (/teacher\.html$/.test(location.pathname)) location.reload(); else location.href = "teacher.html";
    });
    bar.querySelector(".demo-reset").addEventListener("click", function () {
      db = seed();
      save();
      try { sessionStorage.clear(); localStorage.removeItem("leesh_who"); localStorage.removeItem("leesh_kakao"); } catch (e) { /* ignore */ }
      location.reload();
    });
    bar.querySelector(".demo-min").addEventListener("click", function () {
      var min = !bar.hasAttribute("data-min");
      if (min) bar.setAttribute("data-min", ""); else bar.removeAttribute("data-min");
      this.textContent = min ? "체험 모드" : "접기";
    });
    document.body.appendChild(bar);
  }

  /* 평가지 사진: uploads stay in this tab only; seeded reports get a sample page */
  var pictures = {};
  function samplePage(path) {
    var n = /\/(\d+)\.webp$/.exec(path), page = n ? n[1] : "1";
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="620" height="877" viewBox="0 0 620 877">' +
      '<rect width="620" height="877" fill="#FFFDF8"/><rect x="30" y="30" width="560" height="817" fill="none" stroke="#C9B49A" stroke-width="2"/>' +
      '<text x="310" y="120" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#6E3B28">MONTHLY EVALUATION</text>' +
      '<text x="310" y="170" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#2B2522">월말평가 리포트 ' + page + '쪽</text>' +
      '<text x="310" y="440" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#8A7564">체험용 예시 그림이에요</text>' +
      '<text x="310" y="476" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#8A7564">실제로는 원장님이 올린 평가지가 보여요</text></svg>';
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }
  function fakeStorage() {
    var st = window.LeeshAPI && window.LeeshAPI.storage;
    if (!st) return;
    st.upload = function (path, blob) { pictures[path] = URL.createObjectURL(blob); return Promise.resolve(true); };
    st.image = function (path) {
      if (pictures[path]) return Promise.resolve(pictures[path]);
      var p = path.split("/"), r = db.eval_reports.filter(function (x) { return x.member_id === p[0] && x.month.slice(0, 7) === p[1]; })[0];
      return Promise.resolve(r && Number(p[2].replace(/\D/g, "")) <= r.pages ? samplePage(path) : null);
    };
    st.uploadNews = function (path, blob) { pictures["news/" + path] = URL.createObjectURL(blob); return Promise.resolve(true); };
    var realUrl = st.newsUrl;
    st.newsUrl = function (path) { return pictures["news/" + path] || realUrl(path); };
    st.remove = function (paths) { paths.forEach(function (x) { delete pictures[x]; }); return Promise.resolve(true); };
    // 노래 녹음: kept in this tab; the seeded one is a second of silence
    st.uploadSong = function (path, blob) { pictures["song/" + path] = URL.createObjectURL(blob); return Promise.resolve(true); };
    st.song = function (path) { return Promise.resolve(pictures["song/" + path] || silence()); };
    st.removeSongs = function (paths) { paths.forEach(function (x) { delete pictures["song/" + x]; }); return Promise.resolve(true); };
    st.uploadVisit = function (path, blob) { pictures["visit/" + path] = URL.createObjectURL(blob); return Promise.resolve(true); };
    st.visitMusic = function (path) { return Promise.resolve(pictures["visit/" + path] || silence()); };
    st.removeVisit = function (paths) { paths.forEach(function (x) { delete pictures["visit/" + x]; }); return Promise.resolve(true); };
  }
  function silence() {
    var rate = 8000, n = rate, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
    function str(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    str(0, "RIFF"); v.setUint32(4, 36 + n, true); str(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    str(36, "data"); v.setUint32(40, n, true);
    for (var i = 0; i < n; i++) v.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  }

  install(); // demo.js loads right after api.js, before the page scripts
  fakeStorage();
  fakeKakao();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", banner); else banner();
})();
