// Consult request (consult.html). Saved to the database; without one, the
// form falls back to copying the request and opening KakaoTalk.
(function () {
  var form = document.getElementById("consultForm");
  if (!form) return;
  var cfg = window.LEESH || {};
  var msgEl = form.querySelector("#consultMsg");
  var region = form.querySelector("#consultRegion");

  function msg(text, kind) {
    msgEl.textContent = text || "";
    msgEl.className = "sys-msg" + (kind ? " sys-msg--" + kind : "");
  }
  // form.name is the form's own name attribute, so look inputs up explicitly
  function value(n) {
    var f = form.querySelector("[name=" + n + "]");
    return f ? f.value : "";
  }
  function picked(n, dflt) {
    var r = form.querySelector("input[name=" + n + "]:checked");
    return r ? r.value : dflt;
  }
  function days() {
    return Array.prototype.map.call(form.querySelectorAll("input[name=days]:checked"), function (c) { return c.value; }).join(",");
  }

  // 학원 카톡 양식 4가지 (원장님 2026-10-29). 온라인이면 거주 지역도.
  form.addEventListener("change", function (e) {
    if (e.target.name === "mode") region.hidden = picked("mode", "오프라인") !== "온라인";
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var data = {
      p_name: value("name").trim(),
      p_birth: value("birth").trim(),
      p_phone: value("phone").trim(),
      p_method: picked("method", "방문 상담"),
      p_track: value("track"),
      p_mode: picked("mode", "오프라인"),
      p_region: picked("mode", "오프라인") === "온라인" ? value("region").trim() : "",
      p_teacher: value("teacher").trim(),
      p_days: days(),
      p_times: value("times").trim(),
      p_message: value("message").trim(),
      p_website: value("website")
    };
    // 빠진 칸은 보내기 전에 바로 알려줘요 (서버도 다시 확인)
    var miss = !data.p_name ? "성함을 입력해주세요." : !/\d{2}/.test(data.p_birth) ? "생년월일을 입력해주세요. 예) 2008.03.15"
      : data.p_phone.replace(/\D/g, "").length < 9 ? "연락처를 정확히 입력해주세요."
      : data.p_mode === "온라인" && !data.p_region ? "온라인 레슨은 거주 지역도 적어주세요."
      : !data.p_days ? "희망하는 상담 요일을 골라주세요." : !data.p_times ? "희망하는 시간대를 적어주세요. 예) 2시~10시 사이" : "";
    if (miss) { msg(miss, "error"); return; }

    if (!LeeshAPI.enabled()) {
      var summary = "[이송희보컬레슨 상담 신청]\n1. " + data.p_name + " / " + data.p_birth + " / " + data.p_phone +
        "\n2. " + data.p_method + "\n3. " + (data.p_track || "반 미정") + " / " + data.p_mode + (data.p_region ? " (" + data.p_region + ")" : "") +
        (data.p_teacher ? " / " + data.p_teacher : "") + "\n4. " + data.p_days + " · " + data.p_times + (data.p_message ? "\n" + data.p_message : "");
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
      region.hidden = true;
      msg("접수되었습니다. 확인 후 상담 일정을 안내해 드리겠습니다. 감사합니다.", "ok");
    });
  });
})();
