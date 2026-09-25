// Thin client for the Apps Script web app. Every call resolves to
// { ok: true, ... } or { ok: false, error: '사용자에게 보여줄 문장' } — never throws.
(function () {
  var cfg = window.LEESH || {};
  var NETWORK_ERROR = "연결이 원활하지 않습니다. 잠시 후 다시 시도하거나 카카오톡으로 문의해주세요.";

  function enabled() {
    return !!cfg.api;
  }

  function request(url, init) {
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 20000) : null;
    if (controller) init.signal = controller.signal;
    return fetch(url, init)
      .then(function (r) { return r.json(); })
      .then(function (data) { return data && typeof data === "object" ? data : { ok: false, error: NETWORK_ERROR }; })
      .catch(function () { return { ok: false, error: NETWORK_ERROR }; })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  function get(action, params) {
    if (!enabled()) return Promise.resolve({ ok: false, error: "disabled" });
    var q = "?action=" + encodeURIComponent(action);
    Object.keys(params || {}).forEach(function (k) {
      q += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    });
    return request(cfg.api + q, { method: "GET" });
  }

  // Sent as text/plain (fetch's default for a string body) so the browser
  // makes a "simple" request and Apps Script doesn't need to answer a preflight.
  function post(action, body) {
    if (!enabled()) return Promise.resolve({ ok: false, error: "disabled" });
    var payload = Object.assign({ action: action }, body || {});
    return request(cfg.api, { method: "POST", body: JSON.stringify(payload) });
  }

  window.LeeshAPI = { enabled: enabled, get: get, post: post };
})();
