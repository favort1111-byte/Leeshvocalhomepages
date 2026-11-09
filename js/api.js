// Thin client for the Supabase database functions (supabase/schema.sql).
// Every call resolves to { ok: true, ... } or { ok: false, error: '사용자에게 보여줄 문장' } — never throws.
(function () {
  var cfg = window.LEESH || {};
  var NETWORK_ERROR = "연결이 원활하지 않습니다. 잠시 후 다시 시도하거나 카카오톡으로 문의해주세요.";
  var base = String(cfg.supabaseUrl || "").replace(/\/+$/, "");

  function enabled() {
    // cfg.local: tools/dev-server.js serves the API from the same origin
    return !!cfg.supabaseKey && (!!cfg.supabaseUrl || !!cfg.local);
  }

  /** Headers for a request; token is a signed-in user's access token (admin page only). */
  function headers(token) {
    var h = { "Content-Type": "application/json", apikey: cfg.supabaseKey };
    // Legacy anon keys are JWTs and go in Authorization too; new publishable keys only go in apikey.
    var bearer = token || (/^eyJ/.test(cfg.supabaseKey) ? cfg.supabaseKey : "");
    if (bearer) h.Authorization = "Bearer " + bearer;
    return h;
  }

  function request(path, init) {
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 20000) : null;
    if (controller) init.signal = controller.signal;
    return fetch(base + path, init)
      .then(function (r) {
        return r.text().then(function (text) {
          var data = null;
          try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
          return { status: r.status, ok: r.ok, data: data };
        });
      })
      .catch(function () { return { status: 0, ok: false, data: null }; })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  /**
   * Call a database function. Functions answer { ok, ... } themselves.
   * token: the admin page passes its own; otherwise a student's Kakao session is used when there is one.
   */
  function rpc(fn, args, token, opts) {
    if (!enabled()) return Promise.resolve({ ok: false, error: "disabled" });
    opts = opts || {};
    var tries = 0, refreshed = false;
    function once(force) {
      var auth = token !== undefined ? Promise.resolve(token) : kakao.token(force);
      return auth.then(function (t) {
        // Through the exported object so the preview's demo backend (js/demo.js) can stand in.
        return window.LeeshAPI.request("/rest/v1/rpc/" + fn, {
          method: "POST", headers: headers(t), body: JSON.stringify(args || {})
        });
      });
    }
    function go(force) {
      return once(force).then(function (res) {
        if (res.ok && res.data && (typeof res.data === "object" || typeof res.data === "boolean")) return res.data;
        // 로그인 시간이 지났음 (기기 시계가 틀려도): 새로 받아서 한 번 더. 서버는 아무것도 안 했으니 다시 보내도 돼요.
        if (res.status === 401 && token === undefined && !refreshed) { refreshed = true; return go(true); }
        // 연결이 끊김 · 서버가 바쁨: opts.retry번까지 조금 쉬었다가 다시 (같은 걸 두 번 보내도 괜찮은 함수만)
        if ((res.status === 0 || res.status === 408 || res.status === 429 || res.status >= 500) && tries < (opts.retry || 0)) {
          tries++;
          return new Promise(function (ok) { setTimeout(ok, tries * 1500); }).then(function () { return go(false); });
        }
        return { ok: false, error: NETWORK_ERROR, offline: res.status === 0 || res.status >= 500 || res.status === 408 || res.status === 429, status: res.status };
      });
    }
    return go(false);
  }

  /*
    카카오로 로그인 (students). Supabase Auth sends the visitor to Kakao and back to this page with
    the session in the URL hash; it is kept in localStorage and refreshed before it runs out. Which
    student the Kakao account is gets decided by the director (link_requests → admin_kakao_decide).
  */
  var KAKAO = "leesh_kakao", AFTER = "leesh_after_kakao", KAKAO_ERR = "leesh_kakao_error";
  /*
    공용 컴퓨터 (원장님 2026-11-09 "공용 컴퓨터면 다른 사람이 로그인하면 그 친구가 뜨는 거 아냐?"):
    이 기기에 표시해 두면 (localStorage leesh_public) — 로그인할 때마다 카카오가 아이디 · 비밀번호를 다시 묻고
    (prompt=login), 로그인은 이 창에만 (sessionStorage, 브라우저를 닫으면 끝), 30분 동안 아무것도 안 하면 저절로 로그아웃.
    표시는 그 컴퓨터에 남아서 다음 사람도 공용으로 시작해요.
  */
  var PUB = "leesh_public", PUB_IDLE = "leesh_public_active", IDLE_MIN = 30;
  /*
    처음 상태 (원장님 2026-11-09 "컴퓨터는 모두 자동 공용, 핸드폰 · 아이패드는 원래대로"):
    마우스로 쓰는 기기(PC · 노트북, 터치 화면 노트북 포함) = 공용, 휴대폰 · 태블릿 = 개인.
    아이패드는 자기를 맥이라고 알려줄 때가 있어서 터치 점 수로 거름. 체크칸으로 바꾸면 그 기기에 "1" / "0"으로 기억.
  */
  function isComputer() {
    try {
      var ua = navigator.userAgent || "";
      if (/Android|iPhone|iPad|iPod|Mobi|Tablet|Silk|Kindle/i.test(ua)) return false;
      if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return false; // 아이패드 (데스크톱 모드)
      return !window.matchMedia || window.matchMedia("(any-pointer: fine)").matches;
    } catch (e) { return false; }
  }
  function isPublic() {
    var v = null;
    try { v = localStorage.getItem(PUB); } catch (e) { /* ignore */ }
    if (v === "1") return true;
    if (v === "0") return false;
    return isComputer();
  }
  function kstore() { return isPublic() ? sessionStorage : localStorage; }
  // 컴퓨터가 공용이 되기 전부터 로그인해 있던 사람은 갑자기 로그아웃시키지 않음: 이 창으로 옮겨서 창을 닫을 때까지만
  try {
    if (isPublic() && !sessionStorage.getItem(KAKAO) && localStorage.getItem(KAKAO)) {
      sessionStorage.setItem(KAKAO, localStorage.getItem(KAKAO));
      localStorage.removeItem(KAKAO);
    }
  } catch (e) { /* ignore */ }
  var refreshing = null;
  var kakao = {
    available: function () { return enabled() && !!base; },
    session: function () { try { return JSON.parse(kstore().getItem(KAKAO) || "null"); } catch (e) { return null; } },
    save: function (s) {
      try {
        var st = kstore(), other = st === localStorage ? sessionStorage : localStorage;
        other.removeItem(KAKAO);
        if (s) st.setItem(KAKAO, JSON.stringify(s)); else st.removeItem(KAKAO);
      } catch (e) { /* private mode */ }
    },
    isPublic: isPublic,
    /** 공용 컴퓨터 표시 켜기 · 끄기. 켜면 이 기기에 남아 있던 로그인은 지워요. */
    setPublic: function (on) {
      try {
        if (on) { localStorage.setItem(PUB, "1"); localStorage.removeItem(KAKAO); localStorage.removeItem(WHO); }
        else { localStorage.setItem(PUB, "0"); sessionStorage.removeItem(PUB_IDLE); }
      } catch (e) { /* ignore */ }
    },
    /** 로그인 화면에 넣는 "공용 컴퓨터예요" 칸 (학생 · 선생님 · 학부모 로그인 모두) */
    publicBox: function () {
      var l = document.createElement("label");
      l.className = "sys-keep signin__public";
      var c = document.createElement("input");
      c.type = "checkbox";
      c.checked = isPublic();
      var t = document.createElement("span");
      function text() {
        t.textContent = c.checked
          ? "🖥 공용 컴퓨터예요 — 로그인할 때마다 카카오 아이디 · 비밀번호를 물어요. 창을 닫거나 30분 동안 아무것도 안 하면 저절로 로그아웃돼요. 브라우저가 비밀번호를 저장할지 물으면 \u201C안 함\u201D을 눌러주세요. 혼자 쓰는 내 컴퓨터라면 체크를 빼세요."
          : "🖥 공용 컴퓨터예요 (학원 · 학교 · PC방 컴퓨터처럼 여러 사람이 쓰면 체크)";
      }
      text();
      c.addEventListener("change", function () { kakao.setPublic(c.checked); text(); });
      l.appendChild(c);
      l.appendChild(t);
      return l;
    },
    /**
     * again = true: "다른 카카오 계정으로 로그인" — 카카오가 아이디 · 비밀번호를 다시 물어요 (prompt=login).
     * 보통은 이 기기의 카카오 로그인을 그대로 써서 한 번에 들어가요 (원장님 2026-11-04 "지금처럼 + 다른 사람용 칸").
     */
    start: function (again) {
      try { sessionStorage.setItem(AFTER, location.hash); } catch (e) { /* ignore */ }
      location.href = base + "/auth/v1/authorize?provider=kakao" + (again || isPublic() ? "&prompt=login" : "") + "&redirect_to=" +
        encodeURIComponent(location.origin + location.pathname + location.search);
    },
    /** A fresh access token for the Kakao session, or null when signed out. */
    token: function (force) {
      var s = kakao.session();
      if (!s) return Promise.resolve(null);
      if (!force && s.expires - 60 > Date.now() / 1000) return Promise.resolve(s.access);
      if (refreshing) return refreshing; // 여러 저장이 한꺼번에 새로 받지 않게 (한 번만)
      refreshing = window.LeeshAPI.request("/auth/v1/token?grant_type=refresh_token", {
        method: "POST", headers: headers(), body: JSON.stringify({ refresh_token: s.refresh })
      }).then(function (res) {
        refreshing = null;
        var d = res.data;
        if (!res.ok || !d || !d.access_token) {
          // 인터넷이 잠깐 끊긴 것(0 · 5xx)이면 로그인은 그대로 두고 예전 열쇠로 (서버가 거절하면 그때 다시)
          if (res.status === 0 || res.status >= 500) return s.access;
          if (res.status) kakao.save(null);
          return null;
        }
        kakao.save({ access: d.access_token, refresh: d.refresh_token, expires: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600) });
        return d.access_token;
      });
      return refreshing;
    },
    signOut: function () {
      var s = kakao.session();
      kakao.save(null);
      if (s) window.LeeshAPI.request("/auth/v1/logout", { method: "POST", headers: headers(s.access) });
    },
    /** The error Kakao/Supabase sent back last time, once. */
    lastError: function () {
      var e = null;
      try { e = sessionStorage.getItem(KAKAO_ERR); sessionStorage.removeItem(KAKAO_ERR); } catch (x) { /* ignore */ }
      return e;
    }
  };
  // Back from Kakao: take the session out of the address bar before anything else reads the hash.
  (function () {
    var h = location.hash;
    if (!/(^#|&)(access_token|error_description)=/.test(h)) return;
    var p = {};
    h.slice(1).split("&").forEach(function (kv) { var i = kv.indexOf("="); if (i > 0) p[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, " ")); });
    // an admin's 초대 / 비밀번호 메일 link (type=invite|recovery): js/admin.js takes it, not Kakao
    if (/^(invite|recovery|magiclink|signup)$/.test(p.type || "")) return;
    if (p.access_token) {
      kakao.save({ access: p.access_token, refresh: p.refresh_token, expires: Number(p.expires_at) || Math.floor(Date.now() / 1000) + (Number(p.expires_in) || 3600) });
    } else {
      try { sessionStorage.setItem(KAKAO_ERR, p.error_description || "카카오 로그인을 마치지 못했어요."); } catch (e) { /* ignore */ }
    }
    var back = "";
    try { back = sessionStorage.getItem(AFTER) || ""; sessionStorage.removeItem(AFTER); } catch (e) { /* ignore */ }
    try { history.replaceState(null, "", location.pathname + location.search + back); } catch (e) { location.hash = back; }
  })();

  /*
    The signed-in student, shared by 연습실 예약 and 내 폴더: { id, key }.
    key is the "stay signed in" token from member_login / member_notebook, sent in place of the PIN.
    "이 기기에서 로그인 유지" keeps it in localStorage; otherwise only until the browser closes.
  */
  var WHO = "leesh_who";
  var who = {
    get: function () {
      var w = null;
      try { w = JSON.parse(localStorage.getItem(WHO) || sessionStorage.getItem(WHO) || "null"); } catch (e) { w = null; }
      return w && w.id && w.key ? w : null;
    },
    set: function (w, keep) {
      try {
        localStorage.removeItem(WHO);
        sessionStorage.removeItem(WHO);
        (keep && !isPublic() ? localStorage : sessionStorage).setItem(WHO, JSON.stringify({ id: w.id, key: w.key }));
      } catch (e) { /* private mode: signed in for this page only */ }
    },
    kept: function () { try { return !!localStorage.getItem(WHO); } catch (e) { return false; } },
    clear: function () {
      var w = who.get();
      try { localStorage.removeItem(WHO); sessionStorage.removeItem(WHO); } catch (e) { /* ignore */ }
      if (w) rpc("member_logout", { p_id: w.id, p_token: w.key }); // forget this device on the server too
    }
  };

  /*
    월말평가 평가지 사진 (Storage, private bucket "eval-reports"). The director uploads with the admin
    token; a student sees their own pages with their Kakao token (storage policy eval_reports_own).
  */
  function put(bucket, path, blob, token) {
    var h = headers(token);
    h["Content-Type"] = blob.type || "image/webp";
    h["x-upsert"] = "true";
    return fetch(base + "/storage/v1/object/" + bucket + "/" + path, { method: "POST", headers: h, body: blob })
      .then(function (r) { return r.ok; }, function () { return false; });
  }
  var storage = {
    upload: function (path, blob, token) { return put("eval-reports", path, blob, token); },
    /* 오디션 소식 포스터: public bucket "audition-news" */
    uploadNews: function (path, blob, token) { return put("audition-news", path, blob, token); },
    newsUrl: function (path) {
      if (!path) return "";
      return /^(https?:|assets\/|data:|blob:)/.test(path) ? path : base + "/storage/v1/object/public/audition-news/" + path;
    },
    /** An object URL for <img>, or null (no access, not there, offline). */
    image: function (path, token) {
      var h = headers(token);
      delete h["Content-Type"];
      return fetch(base + "/storage/v1/object/authenticated/eval-reports/" + path, { headers: h })
        .then(function (r) { return r.ok ? r.blob().then(function (b) { return URL.createObjectURL(b); }) : null; }, function () { return null; });
    },
    remove: function (paths, token) {
      return fetch(base + "/storage/v1/object/eval-reports", { method: "DELETE", headers: headers(token), body: JSON.stringify({ prefixes: paths }) })
        .then(function (r) { return r.ok; }, function () { return false; });
    },
    /* 노래 녹음: private bucket "song-recordings", <수강 ID>/<file> — the student (Kakao) and the admin page */
    uploadSong: function (path, blob, token) {
      // "audio/webm;codecs=opus" → "audio/webm": the bucket lists plain types
      return put("song-recordings", path, blob.slice(0, blob.size, String(blob.type).split(";")[0]), token);
    },
    song: function (path, token) {
      var h = headers(token);
      delete h["Content-Type"];
      return fetch(base + "/storage/v1/object/authenticated/song-recordings/" + path, { headers: h })
        .then(function (r) { return r.ok ? r.blob().then(function (b) { return URL.createObjectURL(b); }) : null; }, function () { return null; });
    },
    removeSongs: function (paths, token) {
      return fetch(base + "/storage/v1/object/song-recordings", { method: "DELETE", headers: headers(token), body: JSON.stringify({ prefixes: paths }) })
        .then(function (r) { return r.ok; }, function () { return false; });
    },
    /* 내방 오디션 댄스 음원: private bucket "visit-music", <수강 ID>/<file> */
    uploadVisit: function (path, blob, token) {
      return put("visit-music", path, blob.slice(0, blob.size, String(blob.type).split(";")[0] || "audio/mpeg"), token);
    },
    visitMusic: function (path, token) {
      var h = headers(token);
      delete h["Content-Type"];
      return fetch(base + "/storage/v1/object/authenticated/visit-music/" + path, { headers: h })
        .then(function (r) { return r.ok ? r.blob().then(function (b) { return URL.createObjectURL(b); }) : null; }, function () { return null; });
    },
    removeVisit: function (paths, token) {
      return fetch(base + "/storage/v1/object/visit-music", { method: "DELETE", headers: headers(token), body: JSON.stringify({ prefixes: paths }) })
        .then(function (r) { return r.ok; }, function () { return false; });
    },
    /* 레슨 사진: private bucket "lesson-photos", <수강 ID>/<file> — 담당 선생님이 올리고, 학생은 자기 레슨 노트 사진만 봐요 (2026-11-07) */
    uploadPhoto: function (path, blob, token) { return put("lesson-photos", path, blob, token); },
    photo: function (path, token) {
      var h = headers(token);
      delete h["Content-Type"];
      return fetch(base + "/storage/v1/object/authenticated/lesson-photos/" + path, { headers: h })
        .then(function (r) { return r.ok ? r.blob().then(function (b) { return URL.createObjectURL(b); }) : null; }, function () { return null; });
    },
    removePhotos: function (paths, token) {
      return fetch(base + "/storage/v1/object/lesson-photos", { method: "DELETE", headers: headers(token), body: JSON.stringify({ prefixes: paths }) })
        .then(function (r) { return r.ok; }, function () { return false; });
    }
  };

  /*
    공용 컴퓨터에서 로그인한 동안: 아래 작은 띠 "공용 컴퓨터 · 다 쓰면 로그아웃" + 30분 동안 아무것도 안 하면 로그아웃.
  */
  function publicGuard() {
    if (!isPublic()) return;
    function signedIn() { return !!kakao.session() || !!who.get(); }
    function outNow() {
      who.clear();
      kakao.signOut();
      try { sessionStorage.removeItem(PUB_IDLE); } catch (e) { /* ignore */ }
      location.reload();
    }
    function touch() { try { sessionStorage.setItem(PUB_IDLE, String(Date.now())); } catch (e) { /* ignore */ } }
    function idle() {
      var t = 0;
      try { t = Number(sessionStorage.getItem(PUB_IDLE)) || 0; } catch (e) { /* ignore */ }
      if (signedIn() && t && Date.now() - t > IDLE_MIN * 60000) outNow();
    }
    var last = 0;
    ["pointerdown", "keydown", "wheel", "touchstart", "input"].forEach(function (ev) {
      document.addEventListener(ev, function () { var n = Date.now(); if (n - last > 5000) { last = n; touch(); } }, true);
    });
    if (signedIn()) { idle(); touch(); }
    setInterval(idle, 30000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) idle(); });
    function bar() {
      var had = document.querySelector(".pub-bar");
      if (!signedIn()) { if (had) had.remove(); return; }
      if (had) return;
      var b = document.createElement("div");
      b.className = "pub-bar";
      b.setAttribute("role", "status");
      var s = document.createElement("span");
      s.textContent = "🖥 공용 컴퓨터 · 다 쓰면 꼭 로그아웃";
      var o = document.createElement("button");
      o.type = "button";
      o.textContent = "로그아웃";
      o.addEventListener("click", function () { o.disabled = true; outNow(); });
      b.appendChild(s);
      b.appendChild(o);
      document.body.appendChild(b);
    }
    if (document.body) bar(); else document.addEventListener("DOMContentLoaded", bar);
    setInterval(bar, 3000); // 로그인한 뒤에도 (카카오에서 돌아온 다음 · 체험 모드)
  }
  window.LeeshAPI = { enabled: enabled, rpc: rpc, request: request, headers: headers, who: who, kakao: kakao, storage: storage, NETWORK_ERROR: NETWORK_ERROR };
  try { publicGuard(); } catch (e) { /* never break the page */ }
})();
