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
  function rpc(fn, args, token) {
    if (!enabled()) return Promise.resolve({ ok: false, error: "disabled" });
    var auth = token !== undefined ? Promise.resolve(token) : kakao.token();
    return auth.then(function (t) {
      // Through the exported object so the preview's demo backend (js/demo.js) can stand in.
      return window.LeeshAPI.request("/rest/v1/rpc/" + fn, {
        method: "POST", headers: headers(t), body: JSON.stringify(args || {})
      });
    }).then(function (res) {
      if (res.ok && res.data && (typeof res.data === "object" || typeof res.data === "boolean")) return res.data;
      return { ok: false, error: NETWORK_ERROR };
    });
  }

  /*
    카카오로 로그인 (students). Supabase Auth sends the visitor to Kakao and back to this page with
    the session in the URL hash; it is kept in localStorage and refreshed before it runs out. Which
    student the Kakao account is gets decided by the director (link_requests → admin_kakao_decide).
  */
  var KAKAO = "leesh_kakao", AFTER = "leesh_after_kakao", KAKAO_ERR = "leesh_kakao_error";
  var kakao = {
    available: function () { return enabled() && !!base; },
    session: function () { try { return JSON.parse(localStorage.getItem(KAKAO) || "null"); } catch (e) { return null; } },
    save: function (s) { try { if (s) localStorage.setItem(KAKAO, JSON.stringify(s)); else localStorage.removeItem(KAKAO); } catch (e) { /* private mode */ } },
    start: function () {
      try { sessionStorage.setItem(AFTER, location.hash); } catch (e) { /* ignore */ }
      location.href = base + "/auth/v1/authorize?provider=kakao&redirect_to=" +
        encodeURIComponent(location.origin + location.pathname + location.search);
    },
    /** A fresh access token for the Kakao session, or null when signed out. */
    token: function () {
      var s = kakao.session();
      if (!s) return Promise.resolve(null);
      if (s.expires - 60 > Date.now() / 1000) return Promise.resolve(s.access);
      return window.LeeshAPI.request("/auth/v1/token?grant_type=refresh_token", {
        method: "POST", headers: headers(), body: JSON.stringify({ refresh_token: s.refresh })
      }).then(function (res) {
        var d = res.data;
        if (!res.ok || !d || !d.access_token) { if (res.status) kakao.save(null); return null; }
        kakao.save({ access: d.access_token, refresh: d.refresh_token, expires: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600) });
        return d.access_token;
      });
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
        (keep ? localStorage : sessionStorage).setItem(WHO, JSON.stringify({ id: w.id, key: w.key }));
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
    }
  };

  window.LeeshAPI = { enabled: enabled, rpc: rpc, request: request, headers: headers, who: who, kakao: kakao, storage: storage, NETWORK_ERROR: NETWORK_ERROR };
})();
