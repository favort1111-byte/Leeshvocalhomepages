// Consult request (consult.html). Saved to the database; without one, the
// form falls back to copying the request and opening KakaoTalk.
(function () {
  var form = document.getElementById("consultForm");
  if (!form) return;
  var cfg = window.LEESH || {};
  var msgEl = form.querySelector("#consultMsg");
  var wish = form.querySelector("#consultWish");

  function msg(text, kind) {
    msgEl.textContent = text || "";
    msgEl.className = "sys-msg" + (kind ? " sys-msg--" + kind : "");
  }
  // form.name is the form's own name attribute, so look inputs up explicitly
  function value(n) {
    var f = form.querySelector("[name=" + n + "]");
    return f ? f.value : "";
  }
  function method() {
    var r = form.querySelector("input[name=method]:checked");
    return r ? r.value : "전화 상담";
  }

  // 방문 상담 · 체험 레슨 ask when the visitor would like to come.
  form.addEventListener("change", function (e) {
    if (e.target.name === "method") wish.hidden = method() === "전화 상담";
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var data = {
      p_name: value("name").trim(),
      p_phone: value("phone").trim(),
      p_track: value("track"),
      p_method: method(),
      p_wish: method() === "전화 상담" ? "" : value("wish").trim(),
      p_message: value("message").trim(),
      p_website: value("website")
    };

    if (!LeeshAPI.enabled()) {
      var summary = "[이송희보컬레슨 상담 신청]\n이름: " + data.p_name + "\n연락처: " + data.p_phone +
        "\n방식: " + data.p_method + (data.p_wish ? " (" + data.p_wish + ")" : "") +
        (data.p_track ? "\n관심 반: " + data.p_track : "") + (data.p_message ? "\n문의: " + data.p_message : "");
      if (navigator.clipboard) navigator.clipboard.writeText(summary).catch(function () {});
      alert("상담 신청 내용이 복사되었습니다.\n카카오톡 채널로 이동하면 붙여넣기로 바로 전달해주세요.");
      window.open(cfg.kakao, "_blank", "noopener");
      return;
    }

    var btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    msg("접수하는 중…");
    LeeshAPI.rpc("consult_create", data).then(function (res) {
      btn.disabled = false;
      if (!res.ok) { msg(res.error, "error"); return; }
      form.reset();
      wish.hidden = true;
      msg("접수했습니다. 곧 연락드릴게요.", "ok");
    });
  });
})();
