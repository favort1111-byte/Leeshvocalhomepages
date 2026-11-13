// 보컬오락실 이벤트 (원장님 2026-11-10): 계이름 맞히기 · 멜로디 따라치기 · 목소리로 날아라(목소리로 한 판만)
// 기간 안에 로그인한 학생이 게임을 끝내면 점수를 서버에 보내고(member_game_score, 학생마다 게임별 최고 점수만 남음),
// 오락실 맨 위와 게임 카드에 게임별 1등(이름은 "이*희"처럼 가림) · 내 최고 점수 · 내 순위를 보여줘요(member_game_board).
// 기간 · 게임은 서버(private.game_event)가 정하고, 서버도 기간 · 점수를 다시 확인해요.
(function () {
  var GAMES = {
    // 이벤트 점수는 단계(맞힌 개수 · 음 수 · 기둥 수)가 아니라 빠르기 · 정확도를 더한 점수 하나로만 보여요 (원장님 2026-11-10 "동점 안 나오게")
    solfa: { name: "계이름 맞히기", group: "👂 귀 게임" },
    simon: { name: "멜로디 따라치기", group: "👂 귀 게임" },
    fly: { name: "목소리로 날아라", group: "🎤 목소리 게임" }
  };
  var PRIZE = "게임별로 기간 안에 가장 높은 점수를 받은 1등 친구 (총 3명)에게 올리브영 기프티콘을 드려요 🎁";
  var WD = ["일", "월", "화", "수", "목", "금", "토"];
  var who = null, ev = null, board = {}, loading = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  // 한국 시간으로 "11월 15일(일)"
  function day(iso) {
    var d = new Date(new Date(iso).getTime() + 9 * 3600000);
    return (d.getUTCMonth() + 1) + "월 " + d.getUTCDate() + "일(" + WD[d.getUTCDay()] + ")";
  }
  function score(g, v) { return Number(v || 0).toLocaleString("ko-KR") + "점"; }

  function load() {
    if (!who || !window.LeeshAPI) return Promise.resolve();
    if (loading) return loading;
    loading = LeeshAPI.rpc("member_game_board", { p_id: who.id, p_pin: who.key }).then(function (res) {
      loading = null;
      if (!res.ok || !res.event) { ev = null; board = {}; draw(); return; }
      ev = res.event;
      board = res.board || {};
      draw();
    }, function () { loading = null; });
    return loading;
  }

  function draw() {
    var box = document.getElementById("arcadeEvent");
    document.querySelectorAll("[data-top]").forEach(function (t) { t.hidden = true; t.textContent = ""; });
    if (!box) return;
    box.textContent = "";
    if (!ev) { box.hidden = true; return; }
    // preview = 체험 미리보기에서만 (기간 전이어도 진행 중인 모습으로)
    var now = Date.now(), before = !ev.preview && now < new Date(ev.starts).getTime(), after = !ev.preview && now > new Date(ev.ends).getTime();
    box.appendChild(el("h2", "arcade__evtitle", "🎮 " + (ev.title || "보컬오락실 이벤트") + " 💚"));
    box.appendChild(el("p", "arcade__evwhen", "📅 " + day(ev.starts) + " 0시 ~ " + day(ev.ends) + " 밤 11시 59분"
      + (before ? " · 곧 시작해요!" : after ? " · 끝났어요" : "")));
    box.appendChild(el("p", "arcade__evtext", after ? "이벤트가 끝났어요. 1등 친구에게는 학원에서 따로 연락드려요. 도전해 줘서 고마워요 💚"
      : "🏆 " + PRIZE));
    if (!after) box.appendChild(el("p", "arcade__evtext", "🔁 기간 동안 몇 번이든 계속 도전할 수 있어요! 최고 점수에 도전해 보세요 🔥"));
    var ul = el("ul", "arcade__evlist");
    (ev.games || []).forEach(function (g) {
      var info = GAMES[g], b = board[g] || {};
      if (!info) return;
      var li = el("li", "arcade__evrow");
      var name = el("button", "arcade__evgame", info.group + " – " + info.name);
      name.type = "button";
      name.addEventListener("click", function () { location.hash = g; var c = document.querySelector('[data-game="' + g + '"]'); if (c) c.click(); });
      li.appendChild(name);
      li.appendChild(el("span", "arcade__evtop", b.top ? "🏆 1등 " + b.top.name + " " + score(g, b.top.score)
        : before ? "🏆 1등 · 아직 없음" : "🏆 1등 · 아직 없음, 첫 1등이 되어 보세요!"));
      li.appendChild(el("span", "arcade__evmine", b.mine != null ? "내 최고 " + score(g, b.mine) + " · " + b.rank + "위 / " + b.players + "명"
        : before ? "" : "내 기록 · 아직 없음"));
      ul.appendChild(li);
      var t = document.querySelector('[data-top="' + g + '"]');
      if (t) {
        t.textContent = "🏆 이벤트 " + (b.top ? "1등 " + b.top.name + " " + score(g, b.top.score) : before ? day(ev.starts) + " 시작" : "1등 · 아직 없음");
        t.hidden = false;
      }
    });
    box.appendChild(ul);
    if (ev.games && ev.games.indexOf("fly") >= 0 && !after) {
      box.appendChild(el("p", "arcade__evnote", "목소리로 날아라는 🎤 목소리로 한 판만 이벤트 점수에 들어가요 (화면 터치로 한 판은 안 들어가요)."));
    }
    box.hidden = false;
  }

  function note(panel, text, cls) {
    var r = panel && panel.querySelector(".game__result");
    if (!r) return;
    var old = r.querySelector(".game__event");
    if (old) old.remove();
    if (!text) return;
    var p = el("p", "game__event" + (cls ? " " + cls : ""), text);
    var btn = r.querySelector("button");
    if (btn) r.insertBefore(p, btn); else r.appendChild(p);
  }

  // 게임이 끝날 때 (js/games.js · js/games2.js): game, 점수, 그 게임 창, 터치로 했는지
  function submit(game, value, panel, touch) {
    if (!who || !ev || !GAMES[game] || (ev.games || []).indexOf(game) < 0) return;
    var now = Date.now();
    if (now < new Date(ev.starts).getTime() || now > new Date(ev.ends).getTime()) return;
    if (touch) { note(panel, "🎮 이벤트: 터치로 한 판은 점수에 안 들어가요. 🎤 목소리로 도전해 보세요!", "is-off"); return; }
    if (!(value > 0)) return; // 0점은 보내지 않아요
    note(panel, "🎮 이벤트 점수 보내는 중…");
    LeeshAPI.rpc("member_game_score", { p_id: who.id, p_pin: who.key, p_game: game, p_score: value }).then(function (res) {
      if (!res.ok) { note(panel, "🎮 이벤트 점수를 못 보냈어요. " + (res.error || "") , "is-off"); return; }
      if (res.staff) { note(panel, "🎮 선생님 · 원장님 계정은 이벤트 점수에 안 들어가요.", "is-off"); return; }
      if (!res.event) { note(panel, ""); return; }
      load().then(function () {
        var b = board[game] || {};
        note(panel, "🎮 이벤트 점수 " + score(game, value) + (res.best ? " · 새 최고 점수!" : " · 내 최고 " + score(game, b.mine != null ? b.mine : value))
          + (b.rank ? " · 지금 " + b.rank + "위" : "") + (b.rank === 1 ? " 🏆" : ""), res.best ? "is-best" : "");
      });
    });
  }

  document.addEventListener("leesh:member", function (e) { who = e.detail; load(); });
  // gate.js가 이 파일보다 먼저 로그인을 끝냈을 수도 있어요
  if (window.LeeshMember) { who = window.LeeshMember; load(); }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
  setInterval(function () { if (!document.hidden) load(); }, 120000);
  window.LeeshGameEvent = { submit: submit, reload: load };
})();
