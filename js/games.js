// 보컬 오락실 (games.html): small games that train the ear and the voice. This file has the shared parts
// (sound, microphone + pitch, records, the launcher) and the first four games; js/games2.js adds the rest
// (원장님 2026-10-28: docs/menu-ideas.md "미니게임 아이디어" 1~14 전부) through window.LeeshArcade.
//   fly    목소리로 날아라 — the pitch you sing moves the bird through gaps (touch to play without a mic)
//   pitch  음정 퀴즈 — which of two tones is higher; the gap shrinks as you get it right
//   rhythm 리듬 탭 — tap on the beat; timing graded against the audio clock
//   breath 숨 참기 챌린지 — hold one steady "아~" as long as you can
// The microphone is only read in this browser; nothing is recorded or sent. Best scores stay in localStorage.
(function () {
  var root = document.getElementById("arcade");
  if (!root) return;
  var AC = window.AudioContext || window.webkitAudioContext;
  var NOTE = ["도", "도#", "레", "레#", "미", "파", "파#", "솔", "솔#", "라", "라#", "시"];
  var ctx = null;

  function $(sel, el) { return (el || root).querySelector(sel); }
  function audio() {
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  function best(k) { try { return Number(localStorage.getItem("leesh_game_" + k)) || 0; } catch (e) { return 0; } }
  function setBest(k, v) { try { localStorage.setItem("leesh_game_" + k, String(v)); } catch (e) { /* private mode */ } }
  function noteName(st) {
    var m = Math.round(st);
    return NOTE[((m % 12) + 12) % 12] + " (" + ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1) + ")";
  }
  function median(a) { var b = a.slice().sort(function (x, y) { return x - y; }); return b[b.length >> 1]; }

  /* ---------------- microphone + pitch ---------------- */
  var mic = null;
  function openMic() {
    if (mic) return Promise.resolve(mic);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error("no mic"));
    var a = audio();
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      .then(function (stream) {
        var an = a.createAnalyser();
        an.fftSize = 2048;
        a.createMediaStreamSource(stream).connect(an);
        mic = { stream: stream, an: an, buf: new Float32Array(an.fftSize), hist: [] };
        return mic;
      });
  }
  function closeMic() {
    if (!mic) return;
    mic.stream.getTracks().forEach(function (t) { t.stop(); });
    mic = null;
  }
  // YIN-style pitch detection on one analyser frame. Returns { st: MIDI semitone or null, rms }.
  function detect(buf, sr) {
    var n = buf.length, i, rms = 0;
    for (i = 0; i < n; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / n);
    if (rms < 0.012) return { st: null, rms: rms };
    var W = 1024, maxLag = Math.min(Math.floor(sr / 70), n - W - 1), minLag = Math.floor(sr / 1100);
    var d = new Float32Array(maxLag + 2), run = 0, lag, j, x;
    for (lag = 1; lag <= maxLag + 1; lag++) {
      var s = 0;
      for (j = 0; j < W; j++) { x = buf[j] - buf[j + lag]; s += x * x; }
      run += s;
      d[lag] = run ? s * lag / run : 1;
    }
    for (lag = minLag; lag <= maxLag; lag++) {
      if (d[lag] < 0.15) {
        while (lag < maxLag && d[lag + 1] < d[lag]) lag++;
        var a0 = d[lag - 1], a1 = d[lag], a2 = d[lag + 1], den = a0 - 2 * a1 + a2;
        var t = lag + (den ? (a0 - a2) / (2 * den) : 0);
        return { st: 69 + 12 * Math.log(sr / t / 440) / Math.LN2, rms: rms };
      }
    }
    return { st: null, rms: rms };
  }
  // Smoothed reading: median of the last few voiced frames, null when silent.
  function listen() {
    // the game window was just closed (mic off) but its last frame still asks: answer "quiet"
    if (!mic) return { st: null, rms: 0 };
    mic.an.getFloatTimeDomainData(mic.buf);
    var r = detect(mic.buf, ctx.sampleRate);
    if (r.st == null) { mic.hist.length = 0; return r; }
    mic.hist.push(r.st);
    if (mic.hist.length > 5) mic.hist.shift();
    r.st = median(mic.hist);
    return r;
  }

  /* ---------------- tones ---------------- */
  function tone(midi, at, dur, vol) {
    var a = audio(), f = 440 * Math.pow(2, (midi - 69) / 12);
    [[1, "triangle", 1], [2, "sine", 0.25], [3, "sine", 0.08]].forEach(function (h) {
      var o = a.createOscillator(), g = a.createGain();
      o.type = h[1];
      o.frequency.value = f * h[0];
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime((vol || 0.3) * h[2], at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
      o.connect(g).connect(a.destination);
      o.start(at);
      o.stop(at + dur + 0.05);
    });
  }
  function click(at, accent) {
    var a = audio(), o = a.createOscillator(), g = a.createGain();
    o.type = "square";
    o.frequency.value = accent ? 1760 : 1175;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(accent ? 0.35 : 0.22, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
    o.connect(g).connect(a.destination);
    o.start(at);
    o.stop(at + 0.08);
  }

  /* ---------------- sharing ---------------- */
  function share(text, btn) {
    var url = new URL("games.html", location.href).href;
    var msg = "[이송희보컬레슨 보컬 오락실] " + text;
    if (navigator.share) {
      navigator.share({ title: "보컬 오락실", text: msg, url: url }).catch(function () { /* closed */ });
      return;
    }
    var done = function (ok) {
      var was = btn.textContent;
      btn.textContent = ok ? "복사했어요! 카톡에 붙여넣기" : msg + " " + url;
      setTimeout(function () { btn.textContent = was; }, 2500);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(msg + "\n" + url).then(function () { done(true); }, function () { done(false); });
    else done(false);
  }
  function result(panel, lines, shareText) {
    var box = $(".game__result", panel);
    box.textContent = "";
    lines.forEach(function (l, i) {
      var p = document.createElement(i ? "p" : "strong");
      p.textContent = l;
      box.appendChild(p);
    });
    var b = document.createElement("button");
    b.type = "button";
    b.className = "game__btn game__btn--ghost";
    b.textContent = "카톡으로 자랑하기";
    b.addEventListener("click", function () { share(shareText, b); });
    box.appendChild(b);
    box.hidden = false;
  }

  /* ---------------- launcher ---------------- */
  var games = {}, current = null;
  function showBest() {
    root.querySelectorAll("[data-best]").forEach(function (el) {
      var k = el.getAttribute("data-best"), v = best(k), g = games[k];
      el.textContent = v ? "최고 기록 " + (g && g.bestText ? g.bestText(v) : k === "breath" ? v.toFixed(1) + "초" : k === "rhythm" ? v + "%" : v + (k === "pitch" ? "단계" : "점")) : "아직 기록 없음";
    });
  }
  function open(name) {
    if (current && games[current].stop) games[current].stop();
    root.querySelectorAll("[data-panel]").forEach(function (p) { p.hidden = p.getAttribute("data-panel") !== name; });
    root.querySelectorAll("[data-game]").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-game") === name ? "true" : "false"); });
    current = name;
    if (name && games[name].show) games[name].show();
    if (name) {
      var p = $('[data-panel="' + name + '"]');
      p.scrollIntoView({ block: "start", behavior: "smooth" });
      try { history.replaceState(null, "", "#" + name); } catch (e) { /* sandboxed */ }
    }
  }
  root.querySelectorAll("[data-game]").forEach(function (b) {
    b.addEventListener("click", function () { if (games[b.getAttribute("data-game")]) open(b.getAttribute("data-game")); });
  });
  root.querySelectorAll("[data-close]").forEach(function (b) {
    b.addEventListener("click", function () {
      if (current && games[current].stop) games[current].stop();
      closeMic();
      root.querySelectorAll("[data-panel]").forEach(function (p) { p.hidden = true; });
      root.querySelectorAll("[data-game]").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
      current = null;
      showBest();
      $(".arcade__menu").scrollIntoView({ block: "center", behavior: "smooth" });
    });
  });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && current && games[current].stop) games[current].stop(true);
  });

  /* ================================================================ 1. 목소리로 날아라 */
  games.fly = (function () {
    var panel = $('[data-panel="fly"]'), cv = $("canvas", panel), g2 = cv.getContext("2d");
    var over = $(".game__overlay", panel), msg = $(".game__msg", panel);
    var W = 0, H = 0, raf = 0, last = 0, s = null;
    var RANGE = 16, LOW = 7; // screen spans base-7 … base+9 semitones

    function size() {
      var w = cv.parentNode.clientWidth, h = Math.round(Math.min(440, Math.max(300, w * 0.62)));
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + "px";
      g2.setTransform(dpr, 0, 0, dpr, 0, 0);
      W = w; H = h;
    }
    function yOf(st) { return H * (1 - (st - (s.base - LOW)) / RANGE); }

    function draw() {
      var sky = g2.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#F3D9C9"); sky.addColorStop(1, "#E7B9A7");
      g2.fillStyle = sky; g2.fillRect(0, 0, W, H);
      // staff lines, like a music sheet
      g2.strokeStyle = "rgba(110,59,40,.13)"; g2.lineWidth = 1;
      for (var k = 1; k < RANGE; k += 2) { var y = H * k / RANGE; g2.beginPath(); g2.moveTo(0, y); g2.lineTo(W, y); g2.stroke(); }
      s.pipes.forEach(function (p) {
        g2.fillStyle = "#6E3B28";
        g2.fillRect(p.x, 0, p.w, p.top);
        g2.fillRect(p.x, p.bot, p.w, H - p.bot);
        g2.fillStyle = "#F6EBDD";
        g2.font = "bold 14px \'Gmarket Sans\', sans-serif"; g2.textAlign = "center";
        if (s.voice) g2.fillText(NOTE[((Math.round(p.st) % 12) + 12) % 12], p.x + p.w / 2, p.top - 8 > 14 ? p.top - 8 : p.bot + 18);
      });
      // the bird: a little round singer
      var bx = W * 0.25, by = s.y;
      g2.fillStyle = "#F2C14E"; g2.beginPath(); g2.arc(bx, by, 14, 0, 7); g2.fill();
      g2.fillStyle = "#2B2522"; g2.beginPath(); g2.arc(bx + 5, by - 4, 2.4, 0, 7); g2.fill();
      g2.fillStyle = "#E07A3F"; g2.beginPath();
      if (s.singing) { g2.ellipse(bx + 13, by + 3, 5, 4, 0, 0, 7); } else { g2.moveTo(bx + 11, by); g2.lineTo(bx + 20, by + 3); g2.lineTo(bx + 11, by + 6); }
      g2.fill();
      if (s.singing) { g2.fillStyle = "rgba(43,37,34,.6)"; g2.font = "16px \'Gmarket Sans\', sans-serif"; g2.fillText("♪", bx + 26, by - 12); }
      g2.fillStyle = "#2B2522"; g2.textAlign = "left"; g2.font = "bold 22px \'Gmarket Sans\', sans-serif";
      g2.fillText(String(s.score), 14, 32);
      if (s.voice) {
        g2.font = "13px \'Gmarket Sans\', sans-serif";
        g2.fillText(s.st != null ? "지금 음: " + noteName(s.st) : "소리를 내 보세요 ~", 14, H - 14);
      }
    }

    function step(t) {
      var dt = Math.min(0.05, (t - last) / 1000); last = t;
      if (s.voice) {
        var r = listen();
        s.st = r.st;
        s.singing = r.st != null;
        if (s.singing) {
          s.vy = 0;
          s.y += (Math.max(14, Math.min(H - 14, yOf(r.st))) - s.y) * Math.min(1, dt * 9);
        } else { // silence: drift down slowly
          s.vy = Math.min(s.vy + 260 * dt, 160);
          s.y += s.vy * dt;
        }
      } else {
        s.singing = s.hold;
        s.vy += (s.hold ? -620 : 520) * dt;
        s.vy = Math.max(-260, Math.min(300, s.vy));
        s.y += s.vy * dt;
      }
      s.y = Math.max(14, Math.min(H - 14, s.y));
      var speed = 120 + s.score * 4;
      s.t += dt;
      if (s.t >= s.next) {
        s.t = 0; s.next = Math.max(1.5, 2.3 - s.score * 0.03);
        var gapSt = 4.5 - Math.min(1.5, s.score * 0.08), st = s.base + Math.round(Math.random() * 10 - 4);
        var top = yOf(st + gapSt / 2), bot = yOf(st - gapSt / 2);
        if (top < 20) { bot += 20 - top; top = 20; }
        if (bot > H - 20) { top -= bot - (H - 20); bot = H - 20; }
        s.pipes.push({ x: W, w: 46, top: top, bot: bot, st: st, passed: false });
      }
      var bx = W * 0.25;
      for (var i = 0; i < s.pipes.length; i++) {
        var p = s.pipes[i];
        p.x -= speed * dt;
        if (!p.passed && p.x + p.w < bx - 14) { p.passed = true; s.score++; }
        if (bx + 12 > p.x && bx - 12 < p.x + p.w && (s.y - 12 < p.top || s.y + 12 > p.bot)) return end();
      }
      s.pipes = s.pipes.filter(function (p) { return p.x + p.w > 0; });
      draw();
      raf = requestAnimationFrame(step);
    }

    function play(base, voice) {
      over.hidden = true;
      $(".game__result", panel).hidden = true;
      s = { base: base, voice: voice, y: H / 2, vy: 0, pipes: [], t: 1.2, next: 2.2, score: 0, hold: false, st: null };
      last = performance.now();
      raf = requestAnimationFrame(step);
    }
    function end() {
      cancelAnimationFrame(raf); raf = 0;
      draw();
      var b = best("fly"), sc = s.score;
      if (sc > b) setBest("fly", sc);
      over.hidden = false;
      msg.textContent = sc > b ? "새 기록! " + sc + "점" : sc + "점 · 최고 기록 " + Math.max(b, sc) + "점";
      result(panel, [sc + "점" + (sc > b ? " · 새 기록!" : ""),
        s.voice ? "목소리 음높이로 날았어요. 기둥 위 글자가 지나갈 음이에요." : "다음엔 🎤 목소리로 도전해 보세요!"],
        "목소리로 날아라 " + sc + "점! 너도 해볼래?");
    }

    function calibrate() {
      msg.textContent = "편한 소리로 '아~' 해 보세요";
      var got = [], t0 = performance.now();
      (function tick() {
        if (current !== "fly" || !mic) return;
        var r = listen();
        if (r.st != null && r.st > 36 && r.st < 90) got.push(r.st);
        msg.textContent = got.length ? "좋아요! 그대로 '아~' … " + Math.min(100, Math.round(got.length / 45 * 100)) + "%" : "편한 소리로 '아~' 해 보세요";
        if (got.length >= 45) return play(median(got), true);
        if (performance.now() - t0 > 12000) { msg.textContent = "소리가 잘 안 들려요. 마이크 가까이에서 다시 해 보거나 터치로 해 보세요."; return; }
        raf = requestAnimationFrame(tick);
      })();
    }

    $("[data-start=voice]", panel).addEventListener("click", function () {
      audio();
      msg.textContent = "마이크를 켜는 중…";
      openMic().then(calibrate, function () {
        msg.textContent = "마이크를 쓸 수 없어요. 👆 터치로 해 볼까요? (실제 홈페이지에서는 마이크 허용을 눌러 주세요)";
      });
    });
    $("[data-start=tap]", panel).addEventListener("click", function () { closeMic(); play(60, false); });
    function hold(on) { if (s && !s.voice) s.hold = on; }
    cv.addEventListener("pointerdown", function (e) { e.preventDefault(); hold(true); });
    window.addEventListener("pointerup", function () { hold(false); });
    window.addEventListener("keydown", function (e) { if (current === "fly" && e.code === "Space") { e.preventDefault(); hold(true); } });
    window.addEventListener("keyup", function (e) { if (e.code === "Space") hold(false); });
    window.addEventListener("resize", function () { if (current === "fly") { size(); if (s) draw(); } });

    return {
      show: function () {
        size();
        s = { base: 60, voice: false, y: H / 2, vy: 0, pipes: [], score: 0 };
        draw();
        over.hidden = false;
        msg.textContent = "🎤 목소리로: 높은 소리 = 위로, 낮은 소리 = 아래로 · 👆 터치로: 누르고 있으면 위로";
      },
      stop: function () { cancelAnimationFrame(raf); raf = 0; if (s && s.pipes.length) { over.hidden = false; msg.textContent = "멈췄어요. 다시 시작해 볼까요?"; } closeMic(); }
    };
  })();

  /* ================================================================ 2. 음정 퀴즈 */
  games.pitch = (function () {
    var panel = $('[data-panel="pitch"]');
    var status = $(".pitch__status", panel), lives = $(".pitch__lives", panel), choices = panel.querySelectorAll("[data-answer]");
    var q = null, st = null;

    function render() {
      lives.textContent = "♥".repeat(st.lives) + "♡".repeat(3 - st.lives);
      $(".pitch__level", panel).textContent = st.level + "단계 · 차이 " + Math.round(st.diff * 100) + "센트";
    }
    function ask() {
      var base = 57 + Math.floor(Math.random() * 12), up = Math.random() < 0.5;
      q = { a: base, b: base + (up ? st.diff : -st.diff), answer: up ? 2 : 1, locked: true };
      choices.forEach(function (c) { c.disabled = true; c.className = "game__btn pitch__choice"; });
      status.textContent = "잘 들어 보세요…";
      play();
    }
    function play() {
      var a = audio(), t = a.currentTime + 0.15;
      tone(q.a, t, 0.7); tone(q.b, t + 0.95, 0.7);
      flash(0, 150); flash(1, 1100);
      setTimeout(function () {
        q.locked = false;
        choices.forEach(function (c) { c.disabled = false; });
        status.textContent = "어느 소리가 더 높았나요?";
      }, 1900);
    }
    function flash(i, ms) {
      setTimeout(function () { choices[i].classList.add("is-on"); setTimeout(function () { choices[i].classList.remove("is-on"); }, 650); }, ms);
    }
    function answer(n) {
      if (!q || q.locked) return;
      q.locked = true;
      choices.forEach(function (c) { c.disabled = true; });
      var ok = n === q.answer;
      choices[q.answer - 1].classList.add("is-right");
      if (!ok) choices[n - 1].classList.add("is-wrong");
      if (ok) {
        st.level++;
        st.smallest = Math.min(st.smallest, st.diff);
        st.diff = Math.max(0.05, st.diff * 0.72);
        status.textContent = "정답! " + (q.answer === 1 ? "첫 번째" : "두 번째") + " 소리가 더 높았어요.";
      } else {
        st.lives--;
        st.diff = Math.min(3, st.diff * 1.4);
        status.textContent = "아쉬워요. " + (q.answer === 1 ? "첫 번째" : "두 번째") + " 소리가 더 높았어요.";
      }
      render();
      if (st.lives <= 0) return setTimeout(end, 900);
      setTimeout(ask, 1300);
    }
    function end() {
      var lv = st.level - 1, b = best("pitch");
      if (lv > b) setBest("pitch", lv);
      var cents = Math.round(st.smallest * 100);
      status.textContent = "끝! " + lv + "단계까지 왔어요.";
      $("[data-start]", panel).hidden = false;
      result(panel, [lv + "단계" + (lv > b ? " · 새 기록!" : ""),
        st.smallest < 3 ? "가장 작은 차이 " + cents + "센트까지 구별했어요. (반음 = 100센트" + (cents <= 25 ? ", 반음의 1/4보다 작아요!" : "") + ")" : "처음엔 다 어려워요. 한 번 더!"],
        "음정 퀴즈 " + lv + "단계! " + (st.smallest < 3 ? cents + "센트 차이까지 들었어." : ""));
    }
    $("[data-start]", panel).addEventListener("click", function () {
      audio();
      this.hidden = true;
      $(".game__result", panel).hidden = true;
      st = { level: 1, diff: 2, lives: 3, smallest: 3 };
      render();
      ask();
    });
    $("[data-replay]", panel).addEventListener("click", function () { if (q && !q.locked) { q.locked = true; choices.forEach(function (c) { c.disabled = true; }); play(); } });
    choices.forEach(function (c) { c.addEventListener("click", function () { answer(Number(c.getAttribute("data-answer"))); }); });
    return {
      show: function () { if (!st) { status.textContent = "소리 두 개를 들려줄게요. 더 높은 쪽을 고르세요. 맞힐수록 차이가 작아져요."; lives.textContent = "♥♥♥"; } },
      stop: function () { if (q) q.locked = true; }
    };
  })();

  /* ================================================================ 3. 리듬 탭 */
  games.rhythm = (function () {
    var panel = $('[data-panel="rhythm"]'), pad = $(".rhythm__pad", panel), dots = $(".rhythm__dots", panel);
    var label = $(".rhythm__grade", panel), BEATS = 16, COUNT = 4;
    var run = null, timer = 0;

    function grade(ms) { var a = Math.abs(ms); return a <= 45 ? "Perfect" : a <= 95 ? "Great" : a <= 150 ? "Good" : "Miss"; }
    function buildDots() {
      dots.textContent = "";
      for (var i = 0; i < BEATS; i++) dots.appendChild(document.createElement("i"));
    }
    function start() {
      var a = audio(), bpm = Number($("[name=bpm]:checked", panel).value), quiet = $("[name=quiet]", panel).checked;
      var iv = 60 / bpm, t0 = a.currentTime + 0.4;
      buildDots();
      $(".game__result", panel).hidden = true;
      run = { iv: iv, start: t0 + COUNT * iv, hits: new Array(BEATS), lat: a.outputLatency || a.baseLatency || 0, quiet: quiet };
      for (var i = 0; i < COUNT + BEATS; i++) {
        var silent = quiet && i >= COUNT + 8;
        if (!silent) click(t0 + i * iv, i % 4 === 0);
      }
      // visual beat + count-in
      (function tick() {
        if (!run) return;
        var now = a.currentTime - run.lat, k = Math.floor((now - t0) / iv);
        if (k >= 0 && k !== run.k) {
          run.k = k;
          if (k < COUNT) { label.textContent = String(COUNT - k); label.className = "rhythm__grade is-count"; }
          else if (k === COUNT) { label.textContent = "시작!"; label.className = "rhythm__grade"; }
          var beat = k - COUNT;
          if (beat >= 0 && beat < BEATS) {
            dots.children[beat].classList.add("is-now");
            if (beat > 0) dots.children[beat - 1].classList.remove("is-now");
            if (!(quiet && beat >= 8)) { pad.classList.remove("is-beat"); void pad.offsetWidth; pad.classList.add("is-beat"); }
          }
        }
        if (now > run.start + BEATS * iv + 0.3) return finish();
        timer = requestAnimationFrame(tick);
      })();
      $("[data-start]", panel).disabled = true;
    }
    function tap() {
      if (!run) return;
      var now = ctx.currentTime - run.lat, rel = (now - run.start) / run.iv, idx = Math.round(rel);
      if (idx < 0 || idx >= BEATS || Math.abs(rel - idx) > 0.4 || run.hits[idx] != null) return;
      var ms = (rel - idx) * run.iv * 1000;
      run.hits[idx] = ms;
      var gd = grade(ms);
      label.textContent = gd + (gd !== "Perfect" && gd !== "Miss" ? (ms < 0 ? " · 빨라요" : " · 늦어요") : "");
      label.className = "rhythm__grade is-" + gd.toLowerCase();
      dots.children[idx].className = "is-" + gd.toLowerCase();
      pad.classList.remove("is-hit"); void pad.offsetWidth; pad.classList.add("is-hit");
    }
    function finish() {
      cancelAnimationFrame(timer);
      var counts = { Perfect: 0, Great: 0, Good: 0, Miss: 0 }, sum = 0, n = 0;
      run.hits.forEach(function (ms) { if (ms == null) return; counts[grade(ms)]++; if (grade(ms) !== "Miss") { sum += ms; n++; } });
      counts.Miss += BEATS - run.hits.filter(function (x) { return x != null; }).length;
      var acc = Math.round((counts.Perfect * 100 + counts.Great * 80 + counts.Good * 50) / BEATS);
      var avg = n ? Math.round(sum / n) : 0, b = best("rhythm"), quiet = run.quiet;
      if (acc > b) setBest("rhythm", acc);
      run = null;
      label.textContent = acc + "%";
      label.className = "rhythm__grade";
      $("[data-start]", panel).disabled = false;
      result(panel, ["정확도 " + acc + "%" + (acc > b ? " · 새 기록!" : ""),
        "Perfect " + counts.Perfect + " · Great " + counts.Great + " · Good " + counts.Good + " · Miss " + counts.Miss,
        n ? (Math.abs(avg) < 15 ? "박자 딱 맞아요! 평균 " + Math.abs(avg) + "ms 차이" : "평균 " + Math.abs(avg) + "ms " + (avg < 0 ? "빨라요. 조금 기다렸다 눌러 보세요." : "늦어요. 박을 미리 느껴 보세요.")) : "탭이 하나도 없었어요.",
        quiet ? "소리 없는 8박까지 도전했어요 👏" : "잘 되면 '후반 8박 소리 끄기'에 도전해 보세요."],
        "리듬 탭 정확도 " + acc + "%! 너도 박자 맞춰 볼래?");
    }
    $("[data-start]", panel).addEventListener("click", start);
    pad.addEventListener("pointerdown", function (e) { e.preventDefault(); tap(); });
    window.addEventListener("keydown", function (e) { if (current === "rhythm" && (e.code === "Space" || e.code === "Enter") && run) { e.preventDefault(); if (!e.repeat) tap(); } });
    return {
      show: function () { if (!run) { buildDots(); label.textContent = "준비"; label.className = "rhythm__grade"; } },
      stop: function () { if (run) { cancelAnimationFrame(timer); run = null; $("[data-start]", panel).disabled = false; label.textContent = "멈췄어요"; } }
    };
  })();

  /* ================================================================ 4. 숨 참기 챌린지 */
  games.breath = (function () {
    var panel = $('[data-panel="breath"]'), cv = $("canvas", panel), g2 = cv.getContext("2d");
    var secs = $(".breath__secs", panel), status = $(".breath__status", panel), medal = $(".breath__medal", panel);
    var raf = 0, s = null, W = 0, H = 0;
    var MEDALS = [[25, "👑", "왕관"], [20, "🥇", "금메달"], [15, "🥈", "은메달"], [10, "🥉", "동메달"]];

    function size() {
      var w = cv.parentNode.clientWidth, h = 120, dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + "px";
      g2.setTransform(dpr, 0, 0, dpr, 0, 0);
      W = w; H = h;
    }
    function medalOf(t) { for (var i = 0; i < MEDALS.length; i++) if (t >= MEDALS[i][0]) return MEDALS[i]; return null; }
    function drawLine() {
      g2.clearRect(0, 0, W, H);
      g2.strokeStyle = "rgba(110,59,40,.15)"; g2.beginPath(); g2.moveTo(0, H / 2); g2.lineTo(W, H / 2); g2.stroke();
      if (!s || !s.trace.length) return;
      var mid = s.center != null ? s.center : s.trace[s.trace.length - 1];
      g2.strokeStyle = "#6E3B28"; g2.lineWidth = 2.5; g2.beginPath();
      var n = s.trace.length, from = Math.max(0, n - W / 2);
      for (var i = from; i < n; i++) {
        var v = s.trace[i], x = (i - from) * 2, y = v == null ? null : H / 2 - (v - mid) * 22;
        if (y == null) continue;
        y = Math.max(4, Math.min(H - 4, y));
        if (i === from || s.trace[i - 1] == null) g2.moveTo(x, y); else g2.lineTo(x, y);
      }
      g2.stroke();
    }
    function tick() {
      var r = listen(), now = performance.now();
      if (r.st != null && r.st > 36 && r.st < 90) {
        if (!s.on) { s.on = now; status.textContent = "좋아요! 같은 음으로 계속 ~"; }
        s.lastVoice = now;
        s.pitches.push(r.st);
        if (s.pitches.length === 12) s.center = median(s.pitches);
      }
      s.trace.push(r.st);
      if (s.on) {
        var t = (s.lastVoice - s.on) / 1000;
        secs.textContent = t.toFixed(1);
        var m = medalOf(t);
        medal.textContent = m ? m[1] + " " + m[2] : "10초면 동메달";
        if (now - s.lastVoice > 600) return finish(t);
      } else if (now - s.t0 > 15000) {
        status.textContent = "소리가 잘 안 들려요. 마이크 가까이에서 다시 해 보세요.";
        return stop();
      }
      drawLine();
      raf = requestAnimationFrame(tick);
    }
    function wobble(list) {
      if (list.length < 10) return null;
      var c = median(list), sum = 0;
      list.forEach(function (v) { sum += (v - c) * (v - c); });
      return Math.sqrt(sum / list.length) * 100; // cents
    }
    function finish(t) {
      cancelAnimationFrame(raf); raf = 0;
      closeMic();
      $("[data-start]", panel).disabled = false;
      if (t < 1) { status.textContent = "너무 짧았어요. 숨을 크게 들이쉬고 다시!"; return; }
      var b = best("breath"), w = wobble(s.pitches), m = medalOf(t);
      if (t > b) setBest("breath", Math.round(t * 10) / 10);
      status.textContent = "끝! 수고했어요.";
      result(panel, [t.toFixed(1) + "초" + (m ? " " + m[1] : "") + (t > b ? " · 새 기록!" : ""),
        w == null ? "" : "음 흔들림 " + (w < 25 ? "적음 👍 아주 안정적이에요." : w < 60 ? "보통. 배에 힘을 주고 일정하게!" : "많음. 처음엔 작은 소리로 길게 해 보세요."),
        "팁: 숨을 배까지 채우고, 소리를 아끼듯 조금씩 내보내면 길어져요."].filter(Boolean),
        "숨 참기 챌린지 " + t.toFixed(1) + "초" + (m ? " " + m[1] : "") + "! 넌 몇 초?");
    }
    function stop() {
      cancelAnimationFrame(raf); raf = 0;
      closeMic();
      $("[data-start]", panel).disabled = false;
    }
    $("[data-start]", panel).addEventListener("click", function () {
      var btn = this;
      audio();
      btn.disabled = true;
      $(".game__result", panel).hidden = true;
      status.textContent = "마이크를 켜는 중…";
      openMic().then(function () {
        size();
        s = { t0: performance.now(), on: 0, lastVoice: 0, pitches: [], trace: [], center: null };
        secs.textContent = "0.0";
        medal.textContent = "10초면 동메달";
        status.textContent = "숨을 크게 들이쉬고, 편한 음으로 '아~' 길게!";
        raf = requestAnimationFrame(tick);
      }, function () {
        btn.disabled = false;
        status.textContent = "마이크를 쓸 수 없어요. 실제 홈페이지에서 '마이크 허용'을 누르면 할 수 있어요.";
      });
    });
    return {
      show: function () { size(); drawLine(); },
      stop: function () { if (raf) { stop(); status.textContent = "멈췄어요. 다시 해 볼까요?"; } }
    };
  })();

  // for js/games2.js
  window.LeeshArcade = {
    $: $, audio: audio, tone: tone, click: click, openMic: openMic, closeMic: closeMic, listen: listen, best: best, setBest: setBest,
    result: result, noteName: noteName, median: median, current: function () { return current; },
    register: function (name, g) { games[name] = g; }
  };
  // after every game file has registered (the scripts sit at the end of the page)
  function boot() {
    showBest();
    var first = location.hash.replace("#", "");
    if (games[first]) open(first);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else setTimeout(boot, 0);
})();
