// 수강생 전용 화면 (원장님 2026-10-29: 보컬 오락실은 회원만). #membersGate에 카카오 로그인(js/signin.js),
// 승인된 학생이 로그인하면 [data-members] 안의 내용이 보여요. 게임은 학생 정보가 없는 화면이라 화면에서만 가려요.
(function () {
  var gate = document.getElementById("membersGate"), body = document.querySelector("[data-members]");
  if (!gate || !body || !window.LeeshAPI || !window.LeeshSignIn) return;
  if (!LeeshAPI.enabled()) return; // 홈페이지 서버가 꺼져 있으면 그냥 보여줘요
  body.hidden = true;
  var who = document.getElementById("membersWho");
  var sign = LeeshSignIn.mount(gate, {
    title: "수강생 전용",
    lede: "보컬 오락실은 이송희보컬레슨 수강생만 할 수 있어요. 카카오로 로그인해주세요.",
    onSignedIn: function (res) {
      gate.hidden = true;
      body.hidden = false;
      if (who) {
        who.textContent = "";
        who.appendChild(document.createTextNode(res.name + "님, 반가워요 · "));
        var out = document.createElement("button");
        out.type = "button";
        out.className = "sys-link";
        out.textContent = "로그아웃";
        out.addEventListener("click", function () { sign.signOut(); body.hidden = true; gate.hidden = false; who.textContent = ""; });
        who.appendChild(out);
      }
    }
  });
  sign.start();
})();
