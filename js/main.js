(function () {
  var hamburger = document.getElementById("hamburger");
  var nav = document.getElementById("nav");

  hamburger.addEventListener("click", function () {
    var isOpen = nav.classList.toggle("nav--open");
    hamburger.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });

  nav.querySelectorAll("a").forEach(function (link) {
    link.addEventListener("click", function () {
      nav.classList.remove("nav--open");
      hamburger.setAttribute("aria-expanded", "false");
    });
  });

  var form = document.getElementById("consultForm");
  form.addEventListener("submit", function (e) {
    e.preventDefault();

    var name = document.getElementById("name").value.trim();
    var phone = document.getElementById("phone").value.trim();
    var track = document.getElementById("track").value;
    var message = document.getElementById("message").value.trim();

    var summary =
      "[이송희보컬레슨 상담 신청]\n" +
      "이름: " + name + "\n" +
      "연락처: " + phone + "\n" +
      "관심 반: " + track +
      (message ? "\n문의 내용: " + message : "");

    if (navigator.clipboard) {
      navigator.clipboard.writeText(summary).catch(function () {});
    }

    alert("상담 신청 내용이 복사되었습니다.\n카카오톡 채널로 이동하면 붙여넣기로 바로 전달해주세요.");
    window.open("https://pf.kakao.com/_xgNYbK", "_blank", "noopener");
  });
})();
