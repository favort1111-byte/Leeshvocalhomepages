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

  /** Call a database function. Functions answer { ok, ... } themselves. */
  function rpc(fn, args, token) {
    if (!enabled()) return Promise.resolve({ ok: false, error: "disabled" });
    return request("/rest/v1/rpc/" + fn, {
      method: "POST", headers: headers(token), body: JSON.stringify(args || {})
    }).then(function (res) {
      if (res.ok && res.data && typeof res.data === "object") return res.data;
      return { ok: false, error: NETWORK_ERROR };
    });
  }

  window.LeeshAPI = { enabled: enabled, rpc: rpc, request: request, headers: headers, NETWORK_ERROR: NETWORK_ERROR };
})();
