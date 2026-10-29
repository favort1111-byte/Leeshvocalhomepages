// 보컬 오락실 2 (games.html): the rest of docs/menu-ideas.md "미니게임 아이디어" (원장님 2026-10-28 "게임을 다 넣어줘").
//   귀 게임:     simon 멜로디 따라치기 · solfa 계이름 맞히기 · mood 밝은 소리/슬픈 소리 · meter 몇 박자?
//   목소리 게임: target 음 맞추기 과녁 · stairs 음계 계단 오르기 · siren 사이렌 따라 그리기 · cresc 작게→크게
//   리듬 게임:   echo 리듬 메아리 · lanes 4줄 리듬 게임
//   퀴즈·이야기: ox 보컬 OX 퀴즈 · sim 오디션 시뮬레이터
// Sound, microphone, records and the launcher come from js/games.js (window.LeeshArcade). No songs at all
// (원장님 2026-10-29: 동요가 들어간 틀린 음 찾기 · 노래방 음정 레인은 뺌) — only single notes, chords and beats made here.
(function () {
  var A = window.LeeshArcade;
  if (!A) return;
  var NAMES = ["도", "도#", "레", "레#", "미", "파", "파#", "솔", "솔#", "라", "라#", "시"];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function btn(text, cls) { var b = el("button", "game__btn" + (cls ? " " + cls : ""), text); b.type = "button"; return b; }
  function row() { return el("div", "game__row"); }
  function name(m) { return NAMES[((Math.round(m) % 12) + 12) % 12]; }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function now() { return A.audio().currentTime; }
  // semitone distance folded into one octave (-6…6): a man singing a woman's note an octave down still counts
  function fold(d) { return ((d % 12) + 18) % 12 - 6; }
  function canvas(box, h) {
    var cv = el("canvas", "g2__cv");
    box.appendChild(cv);
    var g = cv.getContext("2d"), dims = { W: 0, H: 0 };
    dims.fit = function () {
      var w = box.clientWidth || 600, dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + "px";
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      dims.W = w; dims.H = h;
    };
    return { cv: cv, g: g, d: dims };
  }
  /** One game: its window's body gets a fresh area; returns { panel, box, status, start, again }. */
  function frame(id, intro) {
    var panel = A.$('[data-panel="' + id + '"]'), box = panel.querySelector("[data-g2]");
    var status = el("p", "g2__status", intro);
    status.setAttribute("role", "status");
    box.appendChild(status);
    return { panel: panel, box: box, status: status, hideResult: function () { panel.querySelector(".game__result").hidden = true; } };
  }
  function record(key, v, higherIsBetter) {
    var b = A.best(key), better = higherIsBetter === false ? (!b || v < b) : v > b;
    if (better) A.setBest(key, v);
    return better;
  }
  // The voice games start from the student's own comfortable note ("아~"), kept for this visit.
  var voiceBase = null;
  function calibrate(status, done, isOn) {
    A.audio();
    status.textContent = "마이크를 켜는 중…";
    A.openMic().then(function () {
      if (voiceBase != null) return done(voiceBase);
      var got = [], t0 = performance.now();
      (function tick() {
        if (!isOn()) return;
        var r = A.listen();
        if (r.st != null && r.st > 36 && r.st < 90) got.push(r.st);
        status.textContent = got.length ? "좋아요! 그대로 '아~' … " + Math.min(100, Math.round(got.length / 40 * 100)) + "%" : "먼저 편한 소리로 '아~' 해 보세요 (내 목소리 높이를 잡아요)";
        if (got.length >= 40) { voiceBase = Math.round(A.median(got)); return done(voiceBase); }
        if (performance.now() - t0 > 12000) { status.textContent = "소리가 잘 안 들려요. 마이크 가까이에서 다시 해 보세요."; A.closeMic(); return; }
        requestAnimationFrame(tick);
      })();
    }, function () {
      status.textContent = "마이크를 쓸 수 없어요. 실제 홈페이지에서 '마이크 허용'을 누르면 할 수 있어요.";
    });
  }
  function micNote() { return el("p", "game__note", "목소리는 이 기기 안에서만 쓰이고, 녹음되거나 어디로 보내지지 않아요. 이어폰을 끼면 더 잘 돼요."); }

  /* ================================================================ 1. 멜로디 따라치기 (사이먼) */
  A.register("simon", (function () {
    var f = frame("simon", "건반이 들려주는 멜로디를 순서대로 눌러요. 맞힐 때마다 한 음씩 길어져요.");
    var KEYS = [[60, "도"], [62, "레"], [64, "미"], [67, "솔"], [69, "라"]];
    var keys = el("div", "g2__keys"), seq = [], pos = 0, lock = true, timers = [];
    KEYS.forEach(function (k, i) {
      var b = el("button", "g2__key g2__key--" + i, k[1]);
      b.type = "button";
      b.disabled = true;
      b.addEventListener("pointerdown", function (e) { e.preventDefault(); press(i); });
      keys.appendChild(b);
    });
    f.box.appendChild(keys);
    var r = row(), go = btn("시작");
    r.appendChild(go);
    f.box.appendChild(r);
    function light(i, ms) { var b = keys.children[i]; b.classList.add("is-on"); timers.push(setTimeout(function () { b.classList.remove("is-on"); }, ms)); }
    function setLock(on) { lock = on; Array.prototype.forEach.call(keys.children, function (b) { b.disabled = on; }); }
    function round() {
      seq.push(Math.floor(Math.random() * KEYS.length));
      pos = 0;
      setLock(true);
      f.status.textContent = seq.length + "음 · 잘 들어 보세요";
      var gap = Math.max(0.32, 0.6 - seq.length * 0.02), t = now() + 0.5;
      seq.forEach(function (k, j) {
        A.tone(KEYS[k][0], t + j * gap, gap * 0.9);
        timers.push(setTimeout(function () { light(k, gap * 800); }, (0.5 + j * gap) * 1000));
      });
      timers.push(setTimeout(function () { setLock(false); f.status.textContent = "이제 따라 눌러 보세요!"; }, (0.5 + seq.length * gap) * 1000));
    }
    function press(i) {
      if (lock) return;
      A.tone(KEYS[i][0], now(), 0.35);
      light(i, 250);
      if (i !== seq[pos]) return end();
      pos++;
      if (pos === seq.length) { setLock(true); f.status.textContent = "정답!"; timers.push(setTimeout(round, 800)); }
    }
    function end() {
      setLock(true);
      var sc = seq.length - 1, nb = record("simon", sc);
      f.status.textContent = "틀렸어요! 정답은 " + seq.map(function (k) { return KEYS[k][1]; }).join(" ") + "였어요.";
      go.hidden = false;
      A.result(f.panel, [sc + "음까지 성공" + (nb && sc ? " · 새 기록!" : ""), sc >= 8 ? "기억력과 음감이 대단해요!" : "계이름을 속으로 따라 부르면 더 잘 외워져요."],
        "멜로디 따라치기 " + sc + "음 성공! 너도 해볼래?");
    }
    go.addEventListener("click", function () { A.audio(); go.hidden = true; f.hideResult(); seq = []; round(); });
    return {
      bestText: function (v) { return v + "음"; },
      stop: function () { timers.forEach(clearTimeout); timers = []; setLock(true); go.hidden = false; }
    };
  })());

  /* ================================================================ 2. 계이름 맞히기 */
  A.register("solfa", (function () {
    var f = frame("solfa", "먼저 '도'를 들려주고, 다음 소리가 무슨 음인지 맞혀요. 처음엔 도·미·솔 세 개로 시작해요.");
    var POOL = [[60, "도"], [64, "미"], [67, "솔"], [62, "레"], [65, "파"], [69, "라"], [71, "시"], [72, "높은 도"]];
    var choices = el("div", "game__row g2__choices"), r = row(), go = btn("시작"), again = btn("🔁 다시 듣기", "game__btn--ghost");
    f.box.appendChild(el("p", "g2__lives"));
    f.box.appendChild(choices);
    r.appendChild(go); r.appendChild(again);
    f.box.appendChild(r);
    var st = null, q = null, timers = [];
    function lives() { f.box.querySelector(".g2__lives").textContent = st ? "♥".repeat(st.lives) + "♡".repeat(3 - st.lives) + " · 맞힌 개수 " + st.score : ""; }
    function build() {
      choices.textContent = "";
      POOL.slice(0, st.n).slice().sort(function (a, b) { return a[0] - b[0]; }).forEach(function (p) {
        var b = btn(p[1], "game__btn--ghost g2__pick");
        b.disabled = true;
        b.setAttribute("data-m", p[0]);
        b.addEventListener("click", function () { answer(p[0], b); });
        choices.appendChild(b);
      });
    }
    function ask() {
      q = { m: POOL[Math.floor(Math.random() * st.n)][0], lock: true };
      play();
    }
    function play() {
      var t = now() + 0.15;
      A.tone(60, t, 0.7);
      A.tone(q.m, t + 1, 0.8);
      f.status.textContent = "기준 '도' … 그리고 이 소리는?";
      choices.querySelectorAll("button").forEach(function (b) { b.disabled = true; b.classList.remove("is-right", "is-wrong"); });
      timers.push(setTimeout(function () { q.lock = false; choices.querySelectorAll("button").forEach(function (b) { b.disabled = false; }); }, 1900));
    }
    function answer(m, b) {
      if (!q || q.lock) return;
      q.lock = true;
      var ok = m === q.m;
      choices.querySelectorAll("button").forEach(function (x) { x.disabled = true; if (Number(x.getAttribute("data-m")) === q.m) x.classList.add("is-right"); });
      if (!ok) b.classList.add("is-wrong");
      if (ok) { st.score++; st.streak++; } else { st.lives--; st.streak = 0; }
      f.status.textContent = ok ? "정답! " + name(q.m) + "였어요." : "아쉬워요. " + name(q.m) + "였어요.";
      if (ok && st.streak >= 3 && st.n < POOL.length) { st.n++; st.streak = 0; f.status.textContent += " 새 음 '" + POOL[st.n - 1][1] + "'이 늘었어요!"; build(); }
      lives();
      if (st.lives <= 0) return timers.push(setTimeout(end, 900));
      timers.push(setTimeout(ask, 1300));
    }
    function end() {
      var nb = record("solfa", st.score);
      go.hidden = false;
      f.status.textContent = "끝!";
      A.result(f.panel, [st.score + "개 맞힘" + (nb && st.score ? " · 새 기록!" : ""), "음 " + st.n + "개까지 왔어요. 도에서 몇 칸 떨어졌는지 느껴 보는 게 비결이에요."],
        "계이름 맞히기 " + st.score + "개! 너는 몇 개?");
    }
    go.addEventListener("click", function () { A.audio(); go.hidden = true; f.hideResult(); st = { n: 3, lives: 3, score: 0, streak: 0 }; build(); lives(); ask(); });
    again.addEventListener("click", function () { if (q && !q.lock) { q.lock = true; play(); } });
    return {
      bestText: function (v) { return v + "개"; },
      stop: function () { timers.forEach(clearTimeout); timers = []; if (q) q.lock = true; go.hidden = false; }
    };
  })());

  /* ================================================================ 3. 밝은 소리 / 슬픈 소리 (장조·단조) */
  A.register("mood", (function () {
    var f = frame("mood", "화음을 듣고 밝은 소리(장조)인지 슬픈 소리(단조)인지 골라요. 10문제!");
    var r1 = row(), bright = btn("☀️ 밝은 소리"), sad = btn("🌧 슬픈 소리"), r2 = row(), go = btn("시작"), again = btn("🔁 다시 듣기", "game__btn--ghost");
    r1.appendChild(bright); r1.appendChild(sad);
    r2.appendChild(go); r2.appendChild(again);
    f.box.appendChild(r1); f.box.appendChild(r2);
    bright.disabled = sad.disabled = true;
    var st = null, q = null, timers = [];
    function play() {
      var t = now() + 0.15, tri = [0, q.minor ? 3 : 4, 7];
      tri.forEach(function (d, i) { A.tone(q.root + d, t + i * 0.35, 0.6, 0.22); });
      tri.forEach(function (d) { A.tone(q.root + d, t + 1.2, 1.3, 0.16); });
      bright.disabled = sad.disabled = true;
      timers.push(setTimeout(function () { q.lock = false; bright.disabled = sad.disabled = false; }, 1500));
    }
    function ask() {
      st.n++;
      q = { root: 55 + Math.floor(Math.random() * 12), minor: Math.random() < 0.5, lock: true };
      f.status.textContent = st.n + " / 10 · 잘 들어 보세요";
      [bright, sad].forEach(function (b) { b.classList.remove("is-right", "is-wrong"); });
      play();
    }
    function answer(minor, b) {
      if (!q || q.lock) return;
      q.lock = true;
      bright.disabled = sad.disabled = true;
      var ok = minor === q.minor;
      (q.minor ? sad : bright).classList.add("is-right");
      if (!ok) b.classList.add("is-wrong");
      if (ok) st.score++;
      f.status.textContent = (ok ? "정답! " : "아쉬워요. ") + (q.minor ? "가운데 음이 반음 낮은 단조라 슬프게 들려요." : "가운데 음이 높은 장조라 밝게 들려요.");
      timers.push(setTimeout(st.n >= 10 ? end : ask, 1500));
    }
    function end() {
      var nb = record("mood", st.score);
      go.hidden = false;
      A.result(f.panel, ["10문제 중 " + st.score + "개" + (nb && st.score ? " · 새 기록!" : ""), "노래의 분위기를 느끼는 귀예요. 감정 표현의 시작이에요."],
        "밝은 소리·슬픈 소리 " + st.score + "/10! 너도 맞혀 볼래?");
    }
    bright.addEventListener("click", function () { answer(false, bright); });
    sad.addEventListener("click", function () { answer(true, sad); });
    go.addEventListener("click", function () { A.audio(); go.hidden = true; f.hideResult(); st = { n: 0, score: 0 }; ask(); });
    again.addEventListener("click", function () { if (q && !q.lock) { q.lock = true; play(); } });
    return {
      bestText: function (v) { return v + "/10"; },
      stop: function () { timers.forEach(clearTimeout); timers = []; if (q) q.lock = true; go.hidden = false; }
    };
  })());

  /* ================================================================ 5. 몇 박자? (3박 · 4박) */
  A.register("meter", (function () {
    var f = frame("meter", "반주를 듣고 3박(쿵짝짝 · 왈츠)인지 4박(쿵짝짝짝 · 행진곡)인지 맞혀요. 8문제!");
    var r1 = row(), three = btn("3박 쿵짝짝"), four = btn("4박 쿵짝짝짝"), r2 = row(), go = btn("시작"), again = btn("🔁 다시 듣기", "game__btn--ghost");
    r1.appendChild(three); r1.appendChild(four);
    r2.appendChild(go); r2.appendChild(again);
    f.box.appendChild(r1); f.box.appendChild(r2);
    three.disabled = four.disabled = true;
    var st = null, q = null, timers = [];
    function play() {
      var beat = 60 / q.bpm, t = now() + 0.2, n = q.m * 3;
      for (var i = 0; i < n; i++) {
        if (i % q.m === 0) A.tone(q.root - 12, t + i * beat, beat * 0.9, 0.4);
        else { A.tone(q.root + 4, t + i * beat, beat * 0.4, 0.12); A.tone(q.root + 7, t + i * beat, beat * 0.4, 0.12); }
      }
      three.disabled = four.disabled = true;
      timers.push(setTimeout(function () { q.lock = false; three.disabled = four.disabled = false; f.status.textContent = "몇 박자였나요? (쿵이 몇 번마다 오나 세어 보세요)"; }, (0.2 + beat * Math.min(n, 6)) * 1000));
    }
    function ask() {
      st.n++;
      q = { m: Math.random() < 0.5 ? 3 : 4, bpm: 96 + Math.floor(Math.random() * 40), root: 57 + Math.floor(Math.random() * 6), lock: true };
      [three, four].forEach(function (b) { b.classList.remove("is-right", "is-wrong"); });
      f.status.textContent = st.n + " / 8 · 잘 들어 보세요";
      play();
    }
    function answer(m, b) {
      if (!q || q.lock) return;
      q.lock = true;
      three.disabled = four.disabled = true;
      (q.m === 3 ? three : four).classList.add("is-right");
      if (m !== q.m) b.classList.add("is-wrong"); else st.score++;
      f.status.textContent = (m === q.m ? "정답! " : "아쉬워요. ") + q.m + "박이었어요.";
      timers.push(setTimeout(st.n >= 8 ? end : ask, 1300));
    }
    function end() {
      timers.forEach(clearTimeout);
      var nb = record("meter", st.score);
      go.hidden = false;
      A.result(f.panel, ["8문제 중 " + st.score + "개" + (nb && st.score ? " · 새 기록!" : ""), "박자를 느끼면 노래가 반주에 딱 붙어요."], "몇 박자? " + st.score + "/8!");
    }
    three.addEventListener("click", function () { answer(3, three); });
    four.addEventListener("click", function () { answer(4, four); });
    go.addEventListener("click", function () { A.audio(); go.hidden = true; f.hideResult(); st = { n: 0, score: 0 }; ask(); });
    again.addEventListener("click", function () { if (q && !q.lock) { q.lock = true; play(); } });
    return {
      bestText: function (v) { return v + "/8"; },
      stop: function () { timers.forEach(clearTimeout); timers = []; if (q) q.lock = true; go.hidden = false; }
    };
  })());

  /* ================================================================ 6. 음 맞추기 과녁 */
  A.register("target", (function () {
    var f = frame("target", "피아노가 음 하나를 치면 따라 불러서 과녁 가운데에 2초 머물러요. 5개 음, 가운데에 가까울수록 점수가 높아요.");
    var c = canvas(f.box, 240), r = row(), go = btn("🎤 시작"), again = btn("🔁 다시 듣기", "game__btn--ghost");
    r.appendChild(go); r.appendChild(again);
    f.box.appendChild(r);
    f.box.appendChild(micNote());
    var s = null, raf = 0, on = false;
    function draw(cents, hold) {
      var g = c.g, W = c.d.W, H = c.d.H, cx = W / 2, cy = H / 2;
      g.clearRect(0, 0, W, H);
      [100, 70, 40, 15].forEach(function (rr, i) {
        g.fillStyle = ["#F3D9C9", "#E7B9A7", "#D8957E", "#6E3B28"][i];
        g.beginPath(); g.arc(cx, cy, rr, 0, 7); g.fill();
      });
      g.fillStyle = "#2B2522"; g.font = "bold 15px sans-serif"; g.textAlign = "left";
      if (s && s.target != null) g.fillText((s.i + 1) + " / 5 · 목표 " + name(s.target), 12, 22);
      g.textAlign = "right"; g.fillText(s ? s.total + "점" : "", W - 12, 22);
      if (cents != null) {
        var y = cy + Math.max(-110, Math.min(110, -cents * 1.1));
        g.fillStyle = Math.abs(cents) < 35 ? "#2E6B45" : "#F2C14E";
        g.beginPath(); g.arc(cx, y, 11, 0, 7); g.fill();
        g.fillStyle = "#2B2522"; g.textAlign = "center"; g.font = "13px sans-serif";
        g.fillText(cents > 0 ? "조금 높아요 ↓" : cents < 0 ? "조금 낮아요 ↑" : "", cx, H - 10);
      }
      if (hold) { g.strokeStyle = "#2E6B45"; g.lineWidth = 6; g.beginPath(); g.arc(cx, cy, 108, -Math.PI / 2, -Math.PI / 2 + Math.min(1, hold / 2) * Math.PI * 2); g.stroke(); }
    }
    function playTarget() { var t = now() + 0.1; A.tone(s.target, t, 1.0, 0.3); s.listenFrom = performance.now() + 1200; }
    function next() {
      if (s.i >= 5) return end();
      s.target = s.base + pick([0, 2, 4, 5, 7, 9]);
      s.hold = 0; s.sum = 0; s.n = 0; s.t0 = performance.now(); s.out = 0; s.wait = false;
      f.status.textContent = "잘 듣고, 소리가 끝나면 따라 '아~'";
      playTarget();
    }
    function tick() {
      if (!on) return;
      var t = performance.now(), r = A.listen(), cents = null, dt = Math.min(0.1, (t - (s.last || t)) / 1000);
      s.last = t;
      if (t > s.listenFrom && r.st != null) {
        cents = Math.round(fold(r.st - s.target) * 100);
        if (Math.abs(cents) < 35) { s.hold += dt; s.sum += Math.abs(cents); s.n++; s.out = 0; }
        else { s.out += dt; if (s.out > 0.3) s.hold = Math.max(0, s.hold - dt * 2); }
      }
      draw(cents, s.hold);
      if (s.wait) { raf = requestAnimationFrame(tick); return; } // between notes: count each note once
      if (s.hold >= 2) {
        s.wait = true;
        var pts = Math.max(30, 100 - Math.round(s.sum / Math.max(1, s.n)));
        s.total += pts; s.i++;
        f.status.textContent = "명중! " + pts + "점";
        s.listenFrom = Infinity;
        setTimeout(function () { if (on) next(); }, 900);
      } else if (t - s.t0 > 11000) {
        s.wait = true;
        s.i++;
        f.status.textContent = "시간이 지났어요. 다음 음!";
        s.listenFrom = Infinity;
        setTimeout(function () { if (on) next(); }, 900);
      }
      raf = requestAnimationFrame(tick);
    }
    function end() {
      on = false; cancelAnimationFrame(raf); A.closeMic();
      var nb = record("target", s.total);
      go.hidden = false;
      draw(null, 0);
      A.result(f.panel, [s.total + "점 / 500" + (nb && s.total ? " · 새 기록!" : ""), s.total >= 400 ? "음정이 아주 정확해요! 🎯" : "음을 듣고 속으로 먼저 불러 본 뒤 소리를 내면 더 정확해져요."],
        "음 맞추기 과녁 " + s.total + "점! 🎯");
    }
    go.addEventListener("click", function () {
      go.hidden = true; f.hideResult(); on = true;
      calibrate(f.status, function (base) {
        s = { base: base - 2, i: 0, total: 0 };
        next();
        raf = requestAnimationFrame(tick);
      }, function () { return on; });
    });
    again.addEventListener("click", function () { if (s && on && s.target != null) playTarget(); });
    return {
      show: function () { c.d.fit(); draw(null, 0); },
      bestText: function (v) { return v + "점"; },
      stop: function () { on = false; cancelAnimationFrame(raf); A.closeMic(); go.hidden = false; }
    };
  })());

  /* ================================================================ 7. 음계 계단 오르기 (내 음역대) */
  A.register("stairs", (function () {
    var f = frame("stairs", "편한 음에서 시작해서 도레미파솔라시도로 한 칸씩 불러요. 어디까지 가는지가 내 음역대예요.");
    var steps = el("div", "g2__stairs"), r = row(), up = btn("⬆ 위로 오르기"), down = btn("⬇ 아래로 내려가기", "game__btn--ghost");
    f.box.appendChild(steps);
    r.appendChild(up); r.appendChild(down);
    f.box.appendChild(r);
    f.box.appendChild(micNote());
    var UP = [2, 2, 1, 2, 2, 2, 1], DOWN = [1, 2, 2, 2, 1, 2, 2], s = null, raf = 0, on = false, MAX = 15;
    function build(dir) {
      steps.textContent = "";
      for (var i = 0; i <= MAX; i++) {
        var b = el("span", "g2__step");
        b.style.height = (14 + (dir < 0 ? MAX - i : i) * 6) + "px";
        steps.appendChild(b);
      }
    }
    function mark() {
      Array.prototype.forEach.call(steps.children, function (b, i) {
        b.className = "g2__step" + (i < s.k ? " is-done" : i === s.k ? " is-now" : "");
        b.textContent = i === s.k ? "🙂" : i <= s.k ? name(s.notes[i]) : "";
      });
    }
    function target() { return s.notes[s.k]; }
    function playStep() { A.tone(target(), now() + 0.1, 0.9, 0.3); s.from = performance.now() + 1100; s.hold = 0; s.t0 = performance.now(); s.wait = false; }
    function tick() {
      if (!on) return;
      var r = A.listen(), t = performance.now(), cents = null, dt = Math.min(0.1, (t - (s.last || t)) / 1000);
      s.last = t;
      if (t > s.from && r.st != null) {
        cents = (r.st - target()) * 100;
        if (Math.abs(cents) < 60) s.hold += dt;
      }
      f.status.textContent = name(target()) + " 을(를) 불러요 · " + (cents == null ? "…" : Math.abs(cents) < 60 ? "좋아요!" : cents > 0 ? "조금 높아요" : "조금 낮아요");
      if (s.wait) { raf = requestAnimationFrame(tick); return; } // the next step's note is about to play
      if (s.hold >= 0.7) {
        if (s.k >= MAX) return end();
        s.k++;
        s.wait = true;
        mark();
        s.from = Infinity;
        setTimeout(function () { if (on) playStep(); }, 300);
      } else if (t - s.t0 > 7500) return end();
      raf = requestAnimationFrame(tick);
    }
    function start(dir) {
      up.hidden = down.hidden = true; f.hideResult(); on = true;
      calibrate(f.status, function (base) {
        s = { dir: dir, k: 0, notes: [base] };
        for (var i = 0; i < MAX; i++) s.notes.push(s.notes[i] + dir * (dir > 0 ? UP : DOWN)[i % 7]);
        build(dir); mark(); playStep();
        raf = requestAnimationFrame(tick);
      }, function () { return on; });
    }
    function end() {
      on = false; cancelAnimationFrame(raf); A.closeMic();
      up.hidden = down.hidden = false;
      var reached = s.notes[s.k > 0 && s.hold < 0.7 ? s.k - 1 : s.k], key = s.dir > 0 ? "stairs" : "stairsdown";
      var climbed = s.hold >= 0.7 ? s.k : Math.max(0, s.k - 1), nb = record(key, climbed);
      A.result(f.panel, [climbed + "칸 " + (s.dir > 0 ? "올라갔어요" : "내려갔어요") + (nb && climbed ? " · 새 기록!" : ""),
        "편한 음 " + A.noteName(s.notes[0]) + "에서 " + (s.dir > 0 ? "위로 " : "아래로 ") + A.noteName(reached) + "까지 깨끗하게 냈어요.",
        "억지로 밀어 올리지 말고, 편하게 나는 곳까지가 지금의 음역대예요. 레슨에서 넓혀 가요."],
        "음계 계단 " + climbed + "칸! 내 음역대는 " + A.noteName(reached) + "까지 🎵");
    }
    up.addEventListener("click", function () { start(1); });
    down.addEventListener("click", function () { start(-1); });
    return {
      show: function () { if (!s) build(1); },
      bestText: function (v) { return "위로 " + v + "칸"; },
      stop: function () { on = false; cancelAnimationFrame(raf); A.closeMic(); up.hidden = down.hidden = false; }
    };
  })());

  /* ================================================================ 8. 사이렌 따라 그리기 */
  A.register("siren", (function () {
    var f = frame("siren", "낮게→높게→낮게 그려진 선을 목소리로 따라 그려요. 레슨 워밍업 '사이렌' 연습이에요.");
    var c = canvas(f.box, 260), opts = el("div", "game__row g2__opts"), r = row(), go = btn("🎤 시작");
    opts.innerHTML = '<label><input type="radio" name="sirenh" value="7" checked> 5도 (쉬움)</label><label><input type="radio" name="sirenh" value="12"> 1옥타브</label><label><input type="radio" name="sirenh" value="15"> 1옥타브 반</label>';
    f.box.appendChild(opts);
    r.appendChild(go);
    f.box.appendChild(r);
    f.box.appendChild(micNote());
    var s = null, raf = 0, on = false, DUR = 8;
    function curve(t) { return s.low + s.h * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t / DUR))), 1.4); }
    function y(st) { return c.d.H - 20 - (st - (s.low - 2)) / (s.h + 4) * (c.d.H - 40); }
    function draw(t) {
      var g = c.g, W = c.d.W, H = c.d.H;
      g.clearRect(0, 0, W, H);
      g.fillStyle = "#FBF3E4"; g.fillRect(0, 0, W, H);
      if (!s) return;
      g.strokeStyle = "rgba(110,59,40,.25)"; g.lineWidth = 22; g.lineCap = "round"; g.beginPath();
      for (var x = 0; x <= W; x += 4) { var st = curve(x / W * DUR); if (x) g.lineTo(x, y(st)); else g.moveTo(x, y(st)); }
      g.stroke();
      g.strokeStyle = "#6E3B28"; g.lineWidth = 3; g.beginPath();
      var started = false;
      s.trace.forEach(function (p) { if (p.st == null) { started = false; return; } var px = p.t / DUR * W, py = y(p.st); if (started) g.lineTo(px, py); else { g.moveTo(px, py); started = true; } });
      g.stroke();
      if (t != null) { g.strokeStyle = "#F2C14E"; g.lineWidth = 2; g.beginPath(); g.moveTo(t / DUR * W, 0); g.lineTo(t / DUR * W, H); g.stroke(); }
      g.fillStyle = "#2B2522"; g.font = "bold 14px sans-serif"; g.textAlign = "left";
      g.fillText(s.count != null ? s.count : t != null ? Math.round(100 * s.hit / Math.max(1, s.n)) + "%" : "", 12, 22);
    }
    function tick() {
      if (!on) return;
      var t = (performance.now() - s.t0) / 1000;
      if (t < 0) { s.count = String(Math.ceil(-t)); draw(null); raf = requestAnimationFrame(tick); return; }
      s.count = null;
      var r = A.listen(), st = r.st == null ? null : curve(t) + fold(r.st - curve(t));
      s.trace.push({ t: t, st: st });
      s.n++;
      if (st != null && Math.abs(st - curve(t)) < 1.5) s.hit++;
      draw(t);
      if (t >= DUR) return end();
      raf = requestAnimationFrame(tick);
    }
    function end() {
      on = false; cancelAnimationFrame(raf); A.closeMic();
      go.hidden = false;
      var pct = Math.round(100 * s.hit / Math.max(1, s.n)), nb = record("siren", pct);
      A.result(f.panel, ["따라 그리기 " + pct + "%" + (nb && pct ? " · 새 기록!" : ""), pct >= 70 ? "부드럽게 잘 이어졌어요! 높이를 올려서 도전해 보세요." : "끊기지 않게, 미끄럼틀 타듯 '우~' 소리로 해 보세요."],
        "사이렌 따라 그리기 " + pct + "%!");
    }
    go.addEventListener("click", function () {
      go.hidden = true; f.hideResult(); on = true;
      calibrate(f.status, function (base) {
        c.d.fit();
        s = { low: base - 3, h: Number(f.box.querySelector("[name=sirenh]:checked").value), trace: [], n: 0, hit: 0, t0: performance.now() + 3000, count: "3" };
        A.tone(s.low, now() + 0.1, 1.2, 0.3);
        f.status.textContent = "첫 음 " + name(s.low) + "에서 시작! 노란 선을 따라 '우~'";
        raf = requestAnimationFrame(tick);
      }, function () { return on; });
    });
    return {
      show: function () { c.d.fit(); draw(null); },
      bestText: function (v) { return v + "%"; },
      stop: function () { on = false; cancelAnimationFrame(raf); A.closeMic(); go.hidden = false; }
    };
  })());

  /* ================================================================ 9. 작게→크게 (크레셴도) */
  A.register("cresc", (function () {
    var f = frame("cresc", "선을 따라 소리를 점점 크게, 다시 점점 작게 내요. 강약 조절 연습이에요.");
    var c = canvas(f.box, 220), r = row(), go = btn("🎤 시작");
    r.appendChild(go);
    f.box.appendChild(r);
    f.box.appendChild(micNote());
    var s = null, raf = 0, on = false, DUR = 8;
    function guide(t) { var x = t / DUR; return x < 0.5 ? 0.1 + 1.6 * x : 0.9 - 1.6 * (x - 0.5); }
    function level(rms) { var db = 20 * Math.log10(Math.max(1e-5, rms)); return Math.max(0, Math.min(1, (db - (s.top - 30)) / 30)); }
    function draw(t) {
      var g = c.g, W = c.d.W, H = c.d.H;
      g.fillStyle = "#FBF3E4"; g.fillRect(0, 0, W, H);
      g.fillStyle = "rgba(110,59,40,.18)"; g.beginPath(); g.moveTo(0, H);
      for (var x = 0; x <= W; x += 4) g.lineTo(x, H - guide(x / W * DUR) * (H - 20));
      g.lineTo(W, H); g.fill();
      if (!s) return;
      g.strokeStyle = "#6E3B28"; g.lineWidth = 3; g.beginPath();
      s.trace.forEach(function (p, i) { var px = p.t / DUR * W, py = H - p.v * (H - 20); if (i) g.lineTo(px, py); else g.moveTo(px, py); });
      g.stroke();
      g.fillStyle = "#2B2522"; g.font = "bold 14px sans-serif";
      g.fillText(s.phase === "max" ? "제일 큰 소리로 '아!'" : t != null ? (t < DUR / 2 ? "점점 크게 ↗" : "점점 작게 ↘") : "", 12, 22);
    }
    function tick() {
      if (!on) return;
      var r = A.listen(), t = (performance.now() - s.t0) / 1000;
      if (s.phase === "max") {
        if (r.rms > 0.02) s.peak = Math.max(s.peak, 20 * Math.log10(r.rms));
        if (t > 2) { s.top = s.peak > -60 ? s.peak : -15; s.phase = "go"; s.t0 = performance.now() + 1500; f.status.textContent = "좋아요! 이제 아주 작게 시작해서 선을 따라가요."; }
        draw(null);
      } else if (t >= 0) {
        s.v = s.v * 0.8 + level(r.rms) * 0.2;
        s.trace.push({ t: t, v: s.v });
        s.n++;
        if (Math.abs(s.v - guide(t)) < 0.15) s.hit++;
        draw(t);
        if (t >= DUR) return end();
      }
      raf = requestAnimationFrame(tick);
    }
    function end() {
      on = false; cancelAnimationFrame(raf); A.closeMic();
      go.hidden = false;
      var pct = Math.round(100 * s.hit / Math.max(1, s.n)), nb = record("cresc", pct);
      A.result(f.panel, ["강약 조절 " + pct + "%" + (nb && pct ? " · 새 기록!" : ""), "크게 할 때도 목이 아니라 호흡으로! 작게 할 때도 소리가 끊기지 않게."], "작게→크게 " + pct + "%!");
    }
    go.addEventListener("click", function () {
      go.hidden = true; f.hideResult(); on = true;
      A.audio();
      f.status.textContent = "마이크를 켜는 중…";
      A.openMic().then(function () {
        c.d.fit();
        s = { phase: "max", peak: -100, t0: performance.now(), trace: [], n: 0, hit: 0, v: 0 };
        f.status.textContent = "먼저 2초 동안 제일 큰 소리로 '아!' (크기를 맞춰요)";
        raf = requestAnimationFrame(tick);
      }, function () { go.hidden = false; f.status.textContent = "마이크를 쓸 수 없어요. 실제 홈페이지에서 '마이크 허용'을 누르면 할 수 있어요."; });
    });
    return {
      show: function () { c.d.fit(); draw(null); },
      bestText: function (v) { return v + "%"; },
      stop: function () { on = false; cancelAnimationFrame(raf); A.closeMic(); go.hidden = false; }
    };
  })());

  /* ================================================================ 11. 리듬 메아리 */
  A.register("echo", (function () {
    var f = frame("echo", "리듬을 한 마디 들려줘요. 다음 마디에 똑같이 두드려요. 맞힐수록 리듬이 복잡해져요.");
    var pad = el("button", "rhythm__pad g2__pad", "TAP"), r = row(), go = btn("시작");
    pad.type = "button";
    f.box.appendChild(el("p", "g2__lives"));
    f.box.appendChild(pad);
    r.appendChild(go);
    f.box.appendChild(r);
    f.box.appendChild(el("p", "game__note", "PC는 스페이스바로도 돼요."));
    var st = null, run = null, raf = 0, BPM = 90, Q = 60 / BPM, E = Q / 2;
    function lives() { f.box.querySelector(".g2__lives").textContent = st ? "♥".repeat(st.lives) + "♡".repeat(3 - st.lives) + " · " + st.level + "단계" : ""; }
    function pattern(level) {
      var hits = Math.min(7, 3 + Math.floor(level / 2)), slots = level < 3 ? [0, 2, 4, 6] : [0, 1, 2, 3, 4, 5, 6, 7];
      var p = [0], rest = shuffle(slots.filter(function (x) { return x; }));
      while (p.length < Math.min(hits, slots.length) && rest.length) p.push(rest.pop());
      return p.sort(function (a, b) { return a - b; });
    }
    function round() {
      var a = A.audio(), t0 = a.currentTime + 0.3, pat = pattern(st.level);
      for (var i = 0; i < 12; i++) A.click(t0 + i * Q, i % 4 === 0 && i < 4);
      pat.forEach(function (k) { A.tone(84, t0 + 4 * Q + k * E, 0.12, 0.35); });
      run = { pat: pat, t0: t0, user: t0 + 8 * Q, taps: [], lat: a.outputLatency || a.baseLatency || 0 };
      (function tick() {
        if (!run) return;
        var tt = A.audio().currentTime - run.lat;
        f.status.textContent = tt < run.t0 + 4 * Q ? "준비… " + (4 - Math.floor((tt - run.t0) / Q)) : tt < run.user ? "👂 들어요" : "👆 따라 해요!";
        if (tt > run.user + 8 * E + 0.25) return check();
        raf = requestAnimationFrame(tick);
      })();
    }
    function tap() {
      if (!run) return;
      var tt = A.audio().currentTime - run.lat;
      A.tone(84, A.audio().currentTime, 0.08, 0.2);
      pad.classList.remove("is-hit"); void pad.offsetWidth; pad.classList.add("is-hit");
      if (tt > run.user - 0.2) run.taps.push((tt - run.user) / E);
    }
    function check() {
      var pat = run.pat, taps = run.taps.slice(), ok = 0;
      pat.forEach(function (k) {
        var i = taps.findIndex(function (x) { return Math.abs(x - k) * E < 0.13; });
        if (i >= 0) { ok++; taps.splice(i, 1); }
      });
      run = null;
      var pass = ok === pat.length && !taps.length;
      if (pass) { st.level++; f.status.textContent = "완벽해요! 다음 단계"; }
      else { st.lives--; f.status.textContent = "아쉬워요. " + pat.length + "번 중 " + ok + "번 맞았어요" + (taps.length ? " (더 누른 것 " + taps.length + "번)" : ""); }
      lives();
      if (st.lives <= 0) return setTimeout(end, 900);
      setTimeout(function () { if (st) round(); }, 1400);
    }
    function end() {
      var lv = st.level - 1, nb = record("echo", lv);
      go.hidden = false;
      A.result(f.panel, [lv + "단계 통과" + (nb && lv ? " · 새 기록!" : ""), "리듬을 속으로 '쿵 따 쿵'처럼 소리 내어 외우면 쉬워져요."], "리듬 메아리 " + lv + "단계! 🥁");
      st = null;
    }
    go.addEventListener("click", function () { A.audio(); go.hidden = true; f.hideResult(); st = { level: 1, lives: 3 }; lives(); round(); });
    pad.addEventListener("pointerdown", function (e) { e.preventDefault(); tap(); });
    window.addEventListener("keydown", function (e) { if (A.current() === "echo" && e.code === "Space" && run) { e.preventDefault(); if (!e.repeat) tap(); } });
    return {
      bestText: function (v) { return v + "단계"; },
      stop: function () { cancelAnimationFrame(raf); run = null; st = null; go.hidden = false; }
    };
  })());

  /* ================================================================ 12. 4줄 리듬 게임 */
  A.register("lanes", (function () {
    var f = frame("lanes", "위에서 떨어지는 노트가 선에 닿을 때 눌러요. PC는 D · F · J · K, 휴대폰은 줄을 톡!");
    var c = canvas(f.box, 380), r = row(), go = btn("시작");
    r.appendChild(go);
    f.box.appendChild(r);
    var s = null, raf = 0, noiseBuf = null, BPM = 108, TRAVEL = 1.5, KEYS = ["KeyD", "KeyF", "KeyJ", "KeyK"];
    function noise() {
      if (noiseBuf) return noiseBuf;
      var a = A.audio(), b = a.createBuffer(1, a.sampleRate * 0.4, a.sampleRate), d = b.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return (noiseBuf = b);
    }
    function drum(kind, at) {
      var a = A.audio(), g = a.createGain();
      g.connect(a.destination);
      if (kind === "k") {
        var o = a.createOscillator();
        o.frequency.setValueAtTime(150, at); o.frequency.exponentialRampToValueAtTime(45, at + 0.15);
        g.gain.setValueAtTime(0.8, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.22);
        o.connect(g); o.start(at); o.stop(at + 0.25);
      } else {
        var src = a.createBufferSource(), fl = a.createBiquadFilter();
        src.buffer = noise();
        fl.type = kind === "h" ? "highpass" : "bandpass";
        fl.frequency.value = kind === "h" ? 7000 : 1800;
        g.gain.setValueAtTime(kind === "h" ? 0.18 : 0.5, at); g.gain.exponentialRampToValueAtTime(0.001, at + (kind === "h" ? 0.05 : 0.16));
        src.connect(fl).connect(g); src.start(at); src.stop(at + 0.2);
      }
    }
    function chart() {
      var notes = [], e = 60 / BPM / 2, bars = 16, seed = 7;
      function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
      for (var b = 0; b < bars; b++) {
        var dense = b < 4 ? 0.0 : b < 10 ? 0.25 : 0.45;
        for (var i = 0; i < 8; i++) {
          var on = i % 2 === 0 ? rnd() < 0.8 : rnd() < dense;
          if (on) notes.push({ t: (b * 8 + i) * e, lane: Math.floor(rnd() * 4), done: false });
        }
      }
      return notes;
    }
    function draw(t) {
      var g = c.g, W = c.d.W, H = c.d.H, lw = W / 4, hitY = H - 50;
      g.fillStyle = "#2E231F"; g.fillRect(0, 0, W, H);
      for (var l = 0; l < 4; l++) {
        g.fillStyle = s && s.flash[l] > t ? "rgba(232,194,122,.25)" : l % 2 ? "#33271F" : "#2A201B";
        g.fillRect(l * lw, 0, lw, H);
        g.fillStyle = "rgba(246,235,221,.5)"; g.font = "13px sans-serif"; g.textAlign = "center";
        g.fillText("DFJK"[l], l * lw + lw / 2, H - 16);
      }
      g.fillStyle = "#E8C27A"; g.fillRect(0, hitY - 2, W, 4);
      if (!s) return;
      s.notes.forEach(function (n) {
        if (n.done) return;
        var yy = hitY - (n.t - t) / TRAVEL * hitY;
        if (yy < -20 || yy > H) return;
        g.fillStyle = ["#E7B9A7", "#9CC5A1", "#9CC5A1", "#E7B9A7"][n.lane];
        g.fillRect(n.lane * lw + 8, yy - 9, lw - 16, 18);
      });
      g.fillStyle = "#F6EBDD"; g.textAlign = "left"; g.font = "bold 15px sans-serif";
      g.fillText(s.combo > 2 ? s.combo + " 콤보" : "", 10, 22);
      g.textAlign = "center"; g.font = "bold 20px sans-serif";
      if (s.label && s.labelT > t - 0.5) g.fillText(s.label, W / 2, H / 2);
    }
    function judge(lane) {
      if (!s) return;
      var t = A.audio().currentTime - s.lat - s.t0, best = null;
      s.flash[lane] = t + 0.08;
      s.notes.forEach(function (n) { if (!n.done && n.lane === lane && Math.abs(n.t - t) < 0.16 && (!best || Math.abs(n.t - t) < Math.abs(best.t - t))) best = n; });
      if (!best) return;
      best.done = true;
      var ms = Math.abs(best.t - t) * 1000, gr = ms <= 50 ? "Perfect" : ms <= 100 ? "Great" : "Good";
      s.count[gr]++; s.combo++; s.maxCombo = Math.max(s.maxCombo, s.combo);
      s.label = gr; s.labelT = t;
    }
    function tick() {
      if (!s) return;
      var t = A.audio().currentTime - s.lat - s.t0;
      s.notes.forEach(function (n) { if (!n.done && t - n.t > 0.16) { n.done = true; s.count.Miss++; s.combo = 0; s.label = "Miss"; s.labelT = t; } });
      draw(t);
      if (t > s.end) return end();
      raf = requestAnimationFrame(tick);
    }
    function end() {
      cancelAnimationFrame(raf);
      var n = s.notes.length, k = s.count, acc = Math.round((k.Perfect * 100 + k.Great * 80 + k.Good * 50) / n), nb = record("lanes", acc);
      go.hidden = false;
      A.result(f.panel, ["정확도 " + acc + "%" + (nb && acc ? " · 새 기록!" : ""), "Perfect " + k.Perfect + " · Great " + k.Great + " · Good " + k.Good + " · Miss " + k.Miss + " · 최대 " + s.maxCombo + " 콤보"],
        "4줄 리듬 게임 정확도 " + acc + "%! 🎮");
      s = null;
    }
    go.addEventListener("click", function () {
      var a = A.audio();
      go.hidden = true; f.hideResult(); c.d.fit();
      var e = 60 / BPM / 2, t0 = a.currentTime + TRAVEL + 0.5;
      s = { notes: chart(), t0: t0, lat: a.outputLatency || a.baseLatency || 0, count: { Perfect: 0, Great: 0, Good: 0, Miss: 0 }, combo: 0, maxCombo: 0, flash: [0, 0, 0, 0] };
      s.end = 16 * 8 * e + 0.5;
      for (var i = 0; i < 16 * 8; i++) {
        var at = t0 + i * e;
        if (i % 8 === 0 || i % 8 === 5) drum("k", at);
        if (i % 4 === 2) drum("s", at);
        drum("h", at);
      }
      raf = requestAnimationFrame(tick);
    });
    c.cv.addEventListener("pointerdown", function (e) { e.preventDefault(); var rc = c.cv.getBoundingClientRect(); judge(Math.min(3, Math.floor((e.clientX - rc.left) / rc.width * 4))); });
    window.addEventListener("keydown", function (e) { var l = KEYS.indexOf(e.code); if (A.current() === "lanes" && l >= 0 && s && !e.repeat) { e.preventDefault(); judge(l); } });
    return {
      show: function () { c.d.fit(); draw(0); },
      bestText: function (v) { return v + "%"; },
      stop: function () { cancelAnimationFrame(raf); s = null; go.hidden = false; }
    };
  })());

  /* ================================================================ 13. 보컬 OX 퀴즈 */
  var LESSON = function (id) { return "post.html?id=" + id; };
  var OX = [
    ["고음은 목에 힘을 꽉 줘야 올라간다.", false, "목에 힘을 주면 오히려 소리가 조여요. 호흡을 받치고 공명으로 올려요.", 223451491547, "고음이 안 됐던 이유"],
    ["노래할 때 숨은 배까지 깊게 채우는 게 좋다 (복식호흡).", true, "배까지 채운 숨이 소리를 오래, 안정적으로 받쳐줘요.", 223307654347, "노래에 바로 써먹는 복식호흡"],
    ["가성은 노래에서 쓰면 안 되는 소리다.", false, "진성과 가성을 자연스럽게 이으면 표현이 훨씬 넓어져요.", 223420864696, "진성에서 가성 연결하기"],
    ["연습은 큰 소리로, 오래 할수록 무조건 좋다.", false, "목이 지치면 역효과예요. 짧게 자주, 녹음해서 들어보며 연습해요.", 223451467840, "노래 연습 이렇게 하지 마세요"],
    ["목이 아플 땐 참고 계속 연습해야 실력이 는다.", false, "아프면 쉬는 게 먼저예요. 계속 아프면 레슨 때 선생님께 꼭 말해요.", 223451467840, "노래 연습 이렇게 하지 마세요"],
    ["오디션 곡은 요즘 제일 유행하는 어려운 곡이 무조건 유리하다.", false, "내 음역과 음색에 맞아서 제일 잘 부르는 곡이 유리해요.", 223552154653, "나에게 맞는 선곡 꿀팁"],
    ["노래할 때 표정과 시선도 오디션 심사에 들어간다.", true, "노래만큼 표정·시선·무대 매너도 봐요.", 223314503415, "오디션 잘 보는 법"],
    ["호흡이 딸리는 건 폐활량이 작아서만 그렇다.", false, "숨을 아껴 쓰는 법(호흡 조절)이 더 중요해요.", 223380536192, "호흡 딸리는 이유"],
    ["보컬 프라이(살짝 긁는 소리)를 쓰면 노래 디테일이 살아난다.", true, "살짝 쓰면 감성이 살아나요. 너무 많이 쓰면 목이 피곤해요.", 223367905734, "보컬프라이로 디테일 살리기"],
    ["영상 오디션은 휴대폰으로 찍어도 된다.", true, "밝은 곳에서, 소리가 깨끗하게 들리게 찍으면 휴대폰도 충분해요.", 223281073187, "영상 오디션 찍는 방법"],
    ["오디션 자기소개는 길고 자세할수록 좋다.", false, "짧고 또렷하게! 이름·나이·지원 분야부터요.", 223344382657, "오디션에서 받는 질문"],
    ["내 노래를 녹음해서 들어 보는 건 연습에 도움이 된다.", true, "부를 때와 들을 때는 달라요. 녹음해서 들으면 고칠 곳이 바로 보여요.", 223451467840, "노래 연습 이렇게 하지 마세요"],
    ["노래를 느낌 있게 부르려면 가사 뜻을 생각하며 불러야 한다.", true, "가사 속 이야기를 떠올리면 표현이 자연스러워져요.", 223451469104, "가수처럼 느낌 있게 부르기"],
    ["대형 기획사 오디션은 노래만 잘하면 붙는다.", false, "노래 실력에 더해 나만의 매력과 준비된 모습을 봐요.", 223376691449, "대형기획사 오디션 준비"]
  ];
  A.register("ox", (function () {
    var f = frame("ox", "보컬 상식 OX! 8문제, 답마다 원장님 원포인트 레슨으로 이어져요.");
    var qn = el("p", "g2__q"), r1 = row(), o = btn("⭕ O"), x = btn("❌ X"), why = el("div", "g2__why"), r2 = row(), go = btn("시작"), next = btn("다음 문제", "game__btn--ghost");
    r1.appendChild(o); r1.appendChild(x);
    r2.appendChild(go); r2.appendChild(next);
    [qn, r1, why, r2].forEach(function (n) { f.box.appendChild(n); });
    o.disabled = x.disabled = true; next.hidden = true;
    var st = null;
    function ask() {
      var q = st.qs[st.i];
      f.status.textContent = (st.i + 1) + " / 8";
      qn.textContent = q[0];
      why.textContent = "";
      o.disabled = x.disabled = false; next.hidden = true;
      [o, x].forEach(function (b) { b.classList.remove("is-right", "is-wrong"); });
    }
    function answer(v, b) {
      var q = st.qs[st.i], ok = v === q[1];
      o.disabled = x.disabled = true;
      (q[1] ? o : x).classList.add("is-right");
      if (!ok) b.classList.add("is-wrong"); else st.score++;
      why.textContent = "";
      why.appendChild(el("b", null, (ok ? "정답! " : "아쉬워요. ") + "답은 " + (q[1] ? "O" : "X")));
      why.appendChild(el("p", null, q[2]));
      var a = el("a", null, "▶ 원포인트 레슨: " + q[4]);
      a.href = LESSON(q[3]);
      a.target = "_blank";
      a.rel = "noopener";
      why.appendChild(a);
      st.i++;
      if (st.i >= 8) end(); else next.hidden = false;
    }
    function end() {
      var nb = record("ox", st.score);
      go.hidden = false;
      A.result(f.panel, ["8문제 중 " + st.score + "개" + (nb && st.score ? " · 새 기록!" : ""), st.score >= 7 ? "보컬 박사예요! 🎓" : "틀린 문제의 원포인트 레슨 영상을 꼭 봐요."], "보컬 OX 퀴즈 " + st.score + "/8! 너도 풀어 볼래?");
    }
    o.addEventListener("click", function () { answer(true, o); });
    x.addEventListener("click", function () { answer(false, x); });
    next.addEventListener("click", ask);
    go.addEventListener("click", function () { go.hidden = true; f.hideResult(); st = { qs: shuffle(OX).slice(0, 8), i: 0, score: 0 }; ask(); });
    return { bestText: function (v) { return v + "/8"; } };
  })());

  /* ================================================================ 14. 오디션 시뮬레이터 */
  var SIM = [
    ["🎵 오디션 곡을 골라요", [
      ["내 음역에 맞고 제일 잘 부르는 곡", 3, "곡이 목소리랑 잘 어울리네요. 편하게 들려요."],
      ["요즘 제일 유행하는 고음 많은 곡", 1, "도전은 좋아요. 그런데 고음에서 많이 흔들렸어요."],
      ["심사위원이 좋아한다는 옛날 명곡", 2, "곡은 좋은데, 본인 색깔이 더 보였으면 해요."]]],
    ["👕 오디션 옷을 골라요", [
      ["깔끔한 기본 옷 (흰 티 · 청바지)", 3, "몸선과 움직임이 잘 보여서 좋아요."],
      ["반짝이는 화려한 무대 의상", 1, "옷이 먼저 보여서 본인이 덜 보였어요."],
      ["편한 트레이닝복", 2, "편해 보이지만 준비가 조금 덜 된 느낌이에요."]]],
    ["🙋 자기소개를 해요", [
      ["이름 · 나이 · 지원 분야를 짧고 또렷하게", 3, "목소리도 또렷하고 자신감 있어요."],
      ["노래를 시작한 사연을 길게", 1, "이야기는 좋지만 조금 길었어요. 짧게 해볼까요?"],
      ["긴장해서 작은 목소리로", 1, "많이 떨었죠? 괜찮아요, 크게 한 번 더 해볼래요?"]]],
    ["😱 노래하다 가사를 잊었어요!", [
      ["웃으며 다음 소절부터 이어서 끝까지", 3, "실수를 잘 넘겼어요. 무대 매너 좋아요!"],
      ["멈추고 다시 해도 되는지 물어보기", 2, "다시 할 기회를 줄게요. 다음엔 이어서 해봐요."],
      ["그대로 멈춰 버리기", 0, "괜찮아요. 무대에선 멈추지 않는 연습이 필요해요."]]],
    ["🤔 마지막 질문: \"본인의 장점은 뭐예요?\"", [
      ["\"중음이 따뜻해요. 발라드에서 제일 잘 보여요\"처럼 구체적으로", 3, "자기를 잘 알고 있네요. 좋아요!"],
      ["\"잘 모르겠어요…\"", 0, "자기 장점은 미리 생각해 와야 해요."],
      ["\"다른 친구들보다 연습을 많이 해요\"", 2, "성실함 좋아요. 노래에서의 장점도 말해 줘요."]]]
  ];
  A.register("sim", (function () {
    var f = frame("sim", "기획사 오디션 날! 고르는 것마다 심사위원 반응이 나와요. 1차 합격에 도전해요.");
    var stage = el("div", "g2__sim"), r = row(), go = btn("오디션장 들어가기");
    f.box.appendChild(stage);
    r.appendChild(go);
    f.box.appendChild(r);
    var st = null;
    function step() {
      stage.textContent = "";
      if (st.i >= SIM.length) return end();
      var sc = SIM[st.i];
      f.status.textContent = (st.i + 1) + " / " + SIM.length;
      stage.appendChild(el("h3", "g2__q", sc[0]));
      var list = el("div", "g2__opts2");
      shuffle(sc[1]).forEach(function (op) {
        var b = btn(op[0], "game__btn--ghost g2__opt");
        b.addEventListener("click", function () {
          st.score += op[1];
          list.querySelectorAll("button").forEach(function (x) { x.disabled = true; });
          b.classList.add(op[1] >= 3 ? "is-right" : op[1] <= 1 ? "is-wrong" : "is-on");
          var say = el("p", "g2__judge", "🧑‍⚖️ 심사위원: \"" + op[2] + "\"");
          stage.appendChild(say);
          var n = btn(st.i + 1 < SIM.length ? "다음" : "결과 보기");
          n.addEventListener("click", function () { st.i++; step(); });
          var rr = row();
          rr.appendChild(n);
          stage.appendChild(rr);
        });
        list.appendChild(b);
      });
      stage.appendChild(list);
    }
    function end() {
      var max = SIM.length * 3, sc = st.score, nb = record("sim", sc);
      var verdict = sc >= 13 ? "🎉 1차 합격!" : sc >= 9 ? "🤔 보류 (다음에 한 번 더!)" : "😢 이번엔 아쉬워요";
      stage.appendChild(el("p", "g2__q", verdict));
      go.hidden = false;
      go.textContent = "다시 도전하기";
      A.result(f.panel, [verdict + " · " + sc + "/" + max + "점" + (nb ? " · 새 기록!" : ""),
        "진짜 오디션 준비 팁은 원포인트 레슨 '오디션 잘 보는 법'에 있어요.", "학원에서는 선곡 · 스타일링 · 자기소개 · 무대 매너까지 같이 준비해요."],
        "오디션 시뮬레이터 결과: " + verdict + " 너도 도전해 볼래?");
      var a = el("a", "game__btn game__btn--ghost", "오디션 잘 보는 법 보기");
      a.href = LESSON(223314503415);
      f.panel.querySelector(".game__result").appendChild(a);
    }
    go.addEventListener("click", function () { go.hidden = true; f.hideResult(); st = { i: 0, score: 0 }; step(); });
    return { bestText: function (v) { return v + "/15점"; } };
  })());
})();
