(function () {
  var form = document.getElementById("consultForm");
  if (!form) return;

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var phone = document.getElementById("phone").value.trim();
    var summary = "[이송희보컬레슨 상담 신청]\n연락처: " + phone;

    if (navigator.clipboard) {
      navigator.clipboard.writeText(summary).catch(function () {});
    }
    alert("상담 신청 내용이 복사되었습니다.\n카카오톡 채널로 이동하면 붙여넣기로 바로 전달해주세요.");
    window.open("https://pf.kakao.com/_xgNYbK", "_blank", "noopener");
  });
})();
