// Consult request (consult.html). 원장님 2026-11-11: 홈페이지에 저장하지 않고
// 학원 카카오톡 채널로 바로 — 적은 내용을 복사하고 채널 1:1 채팅을 열면, 손님이 붙여넣어 보냄.
(function () {
  var form = document.getElementById("consultForm");
  if (!form) return;
  var cfg = window.LEESH || {};
  var chat = (cfg.kakao || "https://pf.kakao.com/_xgNYbK").replace(/\/+$/, "") + "/chat";
  var msgEl = form.querySelector("#consultMsg");
  var region = form.querySelector("#consultRegion");
  var done = form.querySelector("#consultDone");
  var box = form.querySelector("#consultText");
  var copyBtn = form.querySelector("#consultCopy");
  var openBtn = form.querySelector("#consultOpen");
  if (openBtn) openBtn.href = chat;

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
    return Array.prototype.map.call(form.querySelectorAll("input[name=days]:checked"), function (c) { return c.value; }).join(", ");
  }

  // 클립보드에 넣기: 되면 true. 안 되면 글 상자를 골라 둬서 길게 눌러 복사할 수 있게.
  function copy(text) {
    var ok = false;
    try {
      box.value = text;
      box.removeAttribute("readonly");
      box.focus();
      box.select();
      box.setSelectionRange(0, text.length);
      ok = document.execCommand && document.execCommand("copy");
      box.setAttribute("readonly", "");
    } catch (e) {}
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {});
      ok = true;
    }
    return ok;
  }

  // 학원 카톡 양식 4가지 (원장님 2026-10-29). 온라인이면 거주 지역도.
  form.addEventListener("change", function (e) {
    if (e.target.name === "mode") region.hidden = picked("mode", "오프라인") !== "온라인";
  });

  if (copyBtn) copyBtn.addEventListener("click", function () {
    msg(copy(box.value) ? "다시 복사되었습니다. 카카오톡 채팅창에 붙여넣어 주세요." : "글 상자를 길게 눌러 복사해주세요.", "ok");
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (value("website")) return; // 자동 입력 프로그램
    var d = {
      name: value("name").trim(),
      birth: value("birth").trim(),
      phone: value("phone").trim(),
      method: picked("method", "방문 상담"),
      track: value("track"),
      mode: picked("mode", "오프라인"),
      region: picked("mode", "오프라인") === "온라인" ? value("region").trim() : "",
      teacher: value("teacher").trim(),
      days: days(),
      times: value("times").trim(),
      message: value("message").trim()
    };
    // 빠진 칸은 바로 알려줌
    var miss = !d.name ? "성함을 입력해주세요." : !/\d{2}/.test(d.birth) ? "생년월일을 입력해주세요. 예) 2008.03.15"
      : d.phone.replace(/\D/g, "").length < 9 ? "연락처를 정확히 입력해주세요."
      : d.mode === "온라인" && !d.region ? "온라인 레슨은 거주 지역도 적어주세요."
      : !d.days ? "희망하는 상담 요일을 골라주세요." : !d.times ? "희망하는 시간대를 적어주세요. 예) 2시~10시 사이" : "";
    if (miss) { msg(miss, "error"); done.hidden = true; return; }

    var text = "[이송희보컬레슨 상담 신청]\n" +
      "① 성함: " + d.name + "\n   생년월일: " + d.birth + "\n   연락처: " + d.phone + "\n" +
      "② 상담 유형: " + d.method + "\n" +
      "③ 클래스: " + (d.track || "아직 정하지 않음") + "\n   레슨 방식: " + d.mode + (d.region ? " (" + d.region + ")" : "") +
      (d.teacher ? "\n   희망 강사: " + d.teacher : "") + "\n" +
      "④ 희망 요일: " + d.days + "\n   시간대: " + d.times +
      (d.message ? "\n\n" + d.message : "");

    done.hidden = false; // 숨긴 글 상자는 고를 수 없어서 먼저 보이게
    var ok = copy(text);
    // 버튼을 누른 그 순간에 열어야 팝업 차단에 안 걸림
    window.open(chat, "_blank", "noopener");
    msg(ok ? "" : "자동 복사가 안 되는 브라우저입니다. 아래 글 상자를 길게 눌러 복사한 뒤 카카오톡 채팅창에 붙여넣어 주세요.", ok ? "" : "error");
    done.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
})();
