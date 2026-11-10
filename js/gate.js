// 수강생 전용 화면 (원장님 2026-10-29: 보컬 오락실은 회원만). #membersGate에 카카오 로그인(js/signin.js),
// 승인된 학생이 로그인하면 [data-members] 안의 내용이 보여요. 게임은 학생 정보가 없는 화면이라 화면에서만 가려요.
(function () {
  var gate = document.getElementById("membersGate"), body = document.querySelector("[data-members]");
  if (!gate || !body || !window.LeeshAPI || !window.LeeshSignIn) return;
  if (!LeeshAPI.enabled()) return; // 홈페이지 서버가 꺼져 있으면 그냥 보여줘요
  body.hidden = true;
  var who = document.getElementById("membersWho");
  var sign = LeeshSignIn.mount(gate, {
    title: "수강생 · 선생님 전용",
    lede: "보컬 오락실은 이송희보컬레슨 수강생과 선생님만 할 수 있어요. 카카오로 로그인해주세요.",
    allowTeacher: true, // 선생님 카카오도 들어와요 (원장님 2026-11-10). 선생님은 이벤트 점수에는 안 들어가요
    onSignedIn: function (res, me) {
      gate.hidden = true;
      // 보컬오락실 이벤트 (js/gameevent.js): 로그인한 학생으로 점수를 보내요
      window.LeeshMember = me;
      try { document.dispatchEvent(new CustomEvent("leesh:member", { detail: me })); } catch (e) { /* old browser */ }
      body.hidden = false;
      if (who) {
        who.textContent = "";
        who.appendChild(document.createTextNode(res.name + "님, 반가워요 · "));
        var out = document.createElement("button");
        out.type = "button";
        out.className = "sys-link";
        out.textContent = "로그아웃";
        out.addEventListener("click", function () { window.LeeshMember = null; try { document.dispatchEvent(new CustomEvent("leesh:member", { detail: null })); } catch (e) { /* old browser */ } sign.signOut(); body.hidden = true; gate.hidden = false; who.textContent = ""; });
        who.appendChild(out);
      }
    }
  });
  // 관리자 (원장님 2026-11-10 "관리자도 게임하게"): 관리자 화면에 이메일로 로그인해 있으면 그대로 들어와요.
  // 로그인 시간이 지났으면 새로 받지 않고(관리자 화면의 로그인이 풀릴 수 있어서) 관리자 화면 → "🎮 보컬 오락실"로 안내.
  function adminSession() { try { return JSON.parse(localStorage.getItem("leesh_admin") || "null"); } catch (e) { return null; } }
  var adm = adminSession();
  if (adm && adm.access && adm.expires - 30 > Date.now() / 1000) {
    LeeshAPI.request("/rest/v1/rpc/is_admin", { method: "POST", headers: LeeshAPI.headers(adm.access), body: "{}" }).then(function (r) {
      if (!r.ok || r.data !== true) return sign.start();
      gate.hidden = true;
      body.hidden = false;
      window.LeeshMember = null; // 관리자는 이벤트 점수에 안 들어가요
      if (who) {
        who.textContent = "관리자님, 반가워요 · ";
        var back = document.createElement("a");
        back.className = "sys-link";
        back.href = "admin.html";
        back.textContent = "관리자 화면";
        who.appendChild(back);
      }
    }, function () { sign.start(); });
  } else {
    var started = sign.start();
    if (adm && adm.access && started && started.then) started.then(function () {
      if (!gate.hidden) sign.note("관리자는 관리자 화면에서 \"🎮 보컬 오락실\"을 눌러 들어오세요.");
    });
  }
})();
