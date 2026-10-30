// 레슨 일지 꾸미기 (원장님 2026-10-29): 선생님들이 구글시트에서 하던 그대로 — 글씨 크기 · 굵게 · 기울임 · 밑줄 · 취소선 ·
// 글자 색 · 채우기 색. 화면도 스프레드시트처럼 (원장님 2026-10-30 "최대한 엑셀이랑 비슷하게"): 도구 줄 · 칸 이름 상자(B2) ·
// A·B 열 글자 · 1·2·3 줄 번호 · 고른 칸 파란 테두리 · 열/줄 경계 끌어서 넓히기 · Tab으로 다음 칸 · 아래쪽 시트 탭(날짜).
//   LeeshRich.sheet({ fields, values, onInput, readOnly, tabs }) → { node, eds: { 칸: editor } }  (선생님 화면 · 관리자 수업 기록)
//   LeeshRich.view(html, rich, cls)                   → 저장된 칸 보여주기
// 꾸민 글은 굵게 · 기울임 · 밑줄 · 취소선 · 색 · 채우기 · 크기 · 줄바꿈만 남기고 모두 걸러요 (서버 private.rich_ok도 한 번 더 확인).
(function () {
  // 구글시트 색 고르기 판과 비슷하게
  var TEXT_COLORS = ["#000000", "#666666", "#999999", "#D62828", "#E8710A", "#C9A100", "#1E8A4C", "#0B8A8A", "#1E5BD8", "#7B3FC4", "#C2185B"];
  var FILL_COLORS = ["", "#F4CCCC", "#FCE5CD", "#FFF2CC", "#FFE45C", "#D9EAD3", "#D0E0E3", "#CFE2F3", "#D9D2E9", "#EAD1DC", "#FF9A9A"];
  var SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 28, 32, 36];
  var BASE = 16; // 칸 글씨 기본 크기 (css .rt-box)
  var WORDS = { "large": 1, "x-large": 1, "xx-large": 1 }; // 예전에 쓴 "크게"

  function okColor(v) {
    v = String(v || "").trim().toLowerCase();
    return /^#[0-9a-f]{3,6}$/.test(v) || /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+\s*)?\)$/.test(v) ? v : null;
  }
  function okSize(v) {
    v = String(v || "").trim().toLowerCase();
    if (WORDS[v]) return v;
    var m = /^(\d+(?:\.\d+)?)(px|pt)$/.exec(v);
    if (!m) return null;
    var px = Math.round(m[2] === "pt" ? Number(m[1]) * 4 / 3 : Number(m[1]));
    return px >= 8 && px <= 48 ? px + "px" : null;
  }

  /** Only b · i · u · s · br · div · span(color, background-color, font-size, font-weight, font-style, text-decoration) survive. */
  function clean(html) {
    var doc = new DOMParser().parseFromString("<body>" + (html || "") + "</body>", "text/html");
    var out = document.createElement("div");
    function walk(src, dst) {
      Array.prototype.forEach.call(src.childNodes, function (n) {
        if (n.nodeType === 3) { dst.appendChild(document.createTextNode(n.nodeValue)); return; }
        if (n.nodeType !== 1) return;
        var tag = n.tagName.toLowerCase();
        if (/^(script|style|iframe|object|embed|img|svg|video|audio|template|head|title|meta|link|colgroup|col)$/.test(tag)) return;
        if (tag === "br") { dst.appendChild(document.createElement("br")); return; }
        var keep = null;
        if (/^(b|strong)$/.test(tag)) keep = document.createElement("b");
        else if (/^(i|em)$/.test(tag)) keep = document.createElement("i");
        else if (tag === "u") keep = document.createElement("u");
        else if (/^(s|strike|del)$/.test(tag)) keep = document.createElement("s");
        else if (/^(div|p|li|tr|h[1-6])$/.test(tag)) keep = document.createElement("div");
        var st = n.style || {}, css = [];
        var c = okColor(st.color || (tag === "font" ? n.getAttribute("color") : ""));
        var bg = okColor(st.backgroundColor || (tag === "mark" ? "#FFE45C" : ""));
        var size = okSize(st.fontSize);
        if (tag === "font" && n.getAttribute("size")) size = { "1": "10px", "2": "13px", "3": "16px", "4": "18px", "5": "24px", "6": "32px", "7": "36px" }[n.getAttribute("size")] || null;
        var deco = String(st.textDecorationLine || st.textDecoration || "");
        if (c) css.push("color: " + c);
        if (bg && !/^rgba\(0, 0, 0, 0\)$/.test(bg)) css.push("background-color: " + bg);
        if (size) css.push("font-size: " + size);
        if (!keep && /^(bold|bolder|[6-9]00)$/.test(String(st.fontWeight || ""))) css.push("font-weight: bold");
        if (!keep && String(st.fontStyle || "") === "italic") css.push("font-style: italic");
        if (!keep && /underline|line-through/.test(deco)) css.push("text-decoration: " + (deco.match(/underline|line-through/g) || []).join(" "));
        var target = dst;
        if (keep) { dst.appendChild(keep); target = keep; }
        if (css.length) { var sp = document.createElement("span"); sp.setAttribute("style", css.join("; ")); target.appendChild(sp); target = sp; }
        walk(n, target);
      });
    }
    walk(doc.body, out);
    return out;
  }
  function cleanHtml(html) { return clean(html).innerHTML; }

  function textToHtml(t) {
    var d = document.createElement("div");
    String(t || "").split("\n").forEach(function (line, i) {
      if (i) d.appendChild(document.createElement("br"));
      d.appendChild(document.createTextNode(line));
    });
    return d.innerHTML;
  }

  /** Show a saved field: rich → cleaned formatting, plain → text with line breaks. */
  function view(value, rich, cls) {
    var box = document.createElement("div");
    box.className = "rt-view" + (rich ? " is-rich" : "") + (cls ? " " + cls : "");
    if (rich) { var c = clean(value); while (c.firstChild) box.appendChild(c.firstChild); }
    else box.textContent = value || "";
    if (!rich) box.style.whiteSpace = "pre-wrap";
    return box;
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function exec(name, arg, css) {
    try { document.execCommand("styleWithCSS", false, !!css); } catch (e) { /* old browsers */ }
    try { return document.execCommand(name, false, arg == null ? null : arg); } catch (e) { return false; }
  }

  /* ---------- one cell ---------- */
  function cell(opts) {
    var box = el("div", "rt-box");
    box.contentEditable = "true";
    box.setAttribute("role", "textbox");
    box.setAttribute("aria-multiline", "true");
    if (opts.label) box.setAttribute("aria-label", opts.label);
    if (opts.placeholder) box.setAttribute("data-placeholder", opts.placeholder);
    // 칸 높이: 수업 중에 넉넉히 쓰도록 줄 수의 두 배쯤 (원장님 2026-10-29 "입력칸 더 크게"). 줄 번호 아래 경계를 끌면 더 늘어나요.
    box.style.minHeight = (1.6 * Math.max(5, (opts.rows || 2) * 2) + 1) + "em";
    var count = el("span", "rt-count");
    function text() { return (box.innerText || box.textContent || "").replace(/ /g, " "); }
    function update() {
      var n = text().trim().length;
      box.classList.toggle("is-empty", !n);
      count.textContent = opts.max && n > opts.max * 0.8 ? n + " / " + opts.max : "";
      count.classList.toggle("is-over", !!opts.max && n > opts.max);
    }
    function changed() { update(); if (opts.onInput) opts.onInput(); }
    box.addEventListener("input", changed);
    // 구글시트에서 붙여넣으면 색 · 굵게 · 크기는 남기고 나머지는 버려요
    box.addEventListener("paste", function (e) {
      var cd = e.clipboardData;
      if (!cd) return;
      e.preventDefault();
      var html = cd.getData("text/html");
      exec("insertHTML", html ? cleanHtml(html) : textToHtml(cd.getData("text/plain")));
      changed();
    });
    function set(value, rich) {
      box.textContent = "";
      var c = clean(rich ? value : textToHtml(value || ""));
      while (c.firstChild) box.appendChild(c.firstChild);
      update();
    }
    set(opts.value, opts.rich);
    return {
      box: box, count: count, changed: changed,
      get: function () { return text().trim() ? cleanHtml(box.innerHTML) : ""; },
      text: text,
      over: function () { return !!opts.max && text().trim().length > opts.max; },
      set: set,
      focus: function () { box.focus(); }
    };
  }

  /* ---------- the toolbar (one for the whole sheet, works on the cell you were in) ---------- */
  var ICON = {
    undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z" fill="currentColor"/></svg>',
    redo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z" fill="currentColor"/></svg>',
    fill: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.6 8.9 8.7 1 7.3 2.4l2.4 2.4-5.2 5.2c-.6.6-.6 1.5 0 2.1l5.5 5.5c.3.3.7.4 1.1.4s.8-.1 1.1-.4l5.5-5.5c.5-.6.5-1.6-.1-2.2zM5.9 11 11 5.9l5.1 5.1H5.9zM19 12.5s-2 2.2-2 3.5c0 1.1.9 2 2 2s2-.9 2-2c0-1.3-2-3.5-2-3.5z" fill="currentColor"/></svg>',
    clear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.3 5 2 6.3 9 13.3 6.5 19h3l1.6-3.7 5.6 5.7 1.3-1.3L3.3 5zM6 5v.2L8.8 8h2.4l-.7 1.7 2.1 2.1L14.2 8H20V5H6z" fill="currentColor"/></svg>'
  };

  function toolbar() {
    var bar = el("div", "rt-bar rt-bar--sheet");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "글씨 꾸미기");
    var active = null, range = null, cells = [];

    function within(node) { return cells.filter(function (c) { return c.box.contains(node); })[0] || null; }
    document.addEventListener("selectionchange", function () {
      var s = window.getSelection();
      if (!s.rangeCount) return;
      var c = within(s.anchorNode);
      if (!c) return;
      active = c;
      range = s.getRangeAt(0).cloneRange();
      showSize();
    });
    // 버튼을 누르기 전 고른 글자로 돌아가요. 아무것도 안 골랐으면 시트처럼 그 칸 전체.
    function restore() {
      var c = active || cells[0];
      if (!c) return null;
      c.box.focus({ preventScroll: true });
      var s = window.getSelection();
      s.removeAllRanges();
      var r = range && c.box.contains(range.startContainer) ? range.cloneRange() : null;
      if (!r || r.collapsed) { r = document.createRange(); r.selectNodeContents(c.box); }
      s.addRange(r);
      return c;
    }
    function done(c) {
      if (!c) return;
      var s = window.getSelection();
      if (s.rangeCount) range = s.getRangeAt(0).cloneRange();
      c.changed();
      showSize();
    }
    function act(fn) { var c = restore(); if (c) { fn(c); done(c); } close(); }

    function btn(cls, html, title, fn) {
      var b = el("button", "rt-btn " + cls);
      b.type = "button";
      b.innerHTML = html;
      b.title = title;
      b.setAttribute("aria-label", title);
      b.addEventListener("mousedown", function (e) { e.preventDefault(); }); // 칸에서 고른 글자가 풀리지 않게
      b.addEventListener("click", fn);
      bar.appendChild(b);
      return b;
    }
    function sep() { bar.appendChild(el("span", "rt-sep")); }

    // 글씨 크기: − [15] +  (숫자를 누르면 목록)
    function curSize() {
      var c = active, s = window.getSelection();
      var n = s.rangeCount && c && c.box.contains(s.anchorNode) ? s.anchorNode : null;
      if (n && n.nodeType === 3) n = n.parentNode;
      return n ? Math.round(parseFloat(getComputedStyle(n).fontSize)) || BASE : BASE;
    }
    function setSize(px) {
      act(function (c) {
        exec("fontSize", "7", true);
        c.box.querySelectorAll('font[size="7"], span[style*="xxx-large"]').forEach(function (n) {
          var sp = n;
          if (n.tagName === "FONT") { sp = el("span"); while (n.firstChild) sp.appendChild(n.firstChild); n.replaceWith(sp); }
          sp.style.fontSize = px + "px";
          sp.querySelectorAll("[style]").forEach(function (k) { k.style.fontSize = ""; if (!k.getAttribute("style")) k.removeAttribute("style"); });
          // 고른 글자를 다시 고른 상태로
          var r = document.createRange(); r.selectNodeContents(sp);
          var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        });
      });
    }
    function step(d) {
      var now = curSize(), i;
      if (d > 0) { for (i = 0; i < SIZES.length && SIZES[i] <= now; i++); setSize(SIZES[Math.min(i, SIZES.length - 1)]); }
      else { for (i = SIZES.length - 1; i >= 0 && SIZES[i] >= now; i--); setSize(SIZES[Math.max(i, 0)]); }
    }
    function history(cmd) {
      var c = active || cells[0];
      if (!c) return;
      c.box.focus({ preventScroll: true });
      exec(cmd);
      c.changed();
    }
    btn("rt-btn--undo", ICON.undo, "실행 취소 (Ctrl+Z)", function () { history("undo"); });
    btn("rt-btn--redo", ICON.redo, "다시 실행 (Ctrl+Y)", function () { history("redo"); });
    sep();
    btn("rt-btn--minus", "−", "글씨 작게", function () { step(-1); });
    var sizeBtn = btn("rt-btn--size", String(BASE), "글씨 크기 고르기", function () { open(sizeMenu, sizeBtn); });
    btn("rt-btn--plus", "+", "글씨 크게", function () { step(1); });
    function showSize() { sizeBtn.textContent = String(curSize()); }
    sep();
    btn("rt-btn--bold", "<b>B</b>", "굵게", function () { act(function () { exec("bold"); }); });
    btn("rt-btn--italic", "<i>I</i>", "기울임", function () { act(function () { exec("italic"); }); });
    btn("rt-btn--under", "<u>U</u>", "밑줄", function () { act(function () { exec("underline"); }); });
    btn("rt-btn--strike", "<s>S</s>", "취소선", function () { act(function () { exec("strikeThrough"); }); });
    sep();
    var lastText = "#D62828", lastFill = "#FFE45C";
    var colorBtn = btn("rt-btn--color", 'A<i class="rt-swatch" style="background:' + lastText + '"></i>', "글자 색", function () { open(textMenu, colorBtn); });
    var fillBtn = btn("rt-btn--fill", ICON.fill + '<i class="rt-swatch" style="background:' + lastFill + '"></i>', "채우기 색 (형광펜)", function () { open(fillMenu, fillBtn); });
    sep();
    btn("rt-btn--clear", ICON.clear, "서식 지우기 (글자는 그대로)", function () {
      act(function (c) {
        exec("removeFormat");
        exec("hiliteColor", "transparent", true);
        // 크기·색이 남은 span도 풀어요
        var s = window.getSelection();
        c.box.querySelectorAll("span[style], b, i, u, s, font").forEach(function (n) {
          if (s.rangeCount && s.getRangeAt(0).intersectsNode(n)) { while (n.firstChild) n.parentNode.insertBefore(n.firstChild, n); n.remove(); }
        });
      });
    });

    // 펼치는 판 (크기 목록 · 색 판)
    function menu(cls) { var m = el("div", "rt-menu " + cls); m.hidden = true; m.addEventListener("mousedown", function (e) { e.preventDefault(); }); bar.appendChild(m); return m; }
    var sizeMenu = menu("rt-menu--size");
    SIZES.forEach(function (px) {
      var b = el("button", "rt-menu__size", String(px)); b.type = "button";
      b.addEventListener("click", function () { setSize(px); });
      sizeMenu.appendChild(b);
    });
    function palette(m, list, apply) {
      list.forEach(function (c) {
        var b = el("button", "rt-chip" + (c ? "" : " rt-chip--none")); b.type = "button";
        b.style.background = c || "#fff";
        b.title = c ? c : "없음";
        b.setAttribute("aria-label", c ? "색 " + c : "색 없음");
        b.addEventListener("click", function () { apply(c); });
        m.appendChild(b);
      });
    }
    var textMenu = menu("rt-menu--color"), fillMenu = menu("rt-menu--color");
    palette(textMenu, TEXT_COLORS, function (c) {
      lastText = c; colorBtn.querySelector(".rt-swatch").style.background = c;
      act(function () { exec("foreColor", c, true); });
    });
    palette(fillMenu, FILL_COLORS, function (c) {
      if (c) { lastFill = c; fillBtn.querySelector(".rt-swatch").style.background = c; }
      act(function () { if (!exec("hiliteColor", c || "transparent", true)) exec("backColor", c || "transparent", true); });
    });
    var opened = null;
    function close() { if (opened) { opened.hidden = true; opened = null; } }
    function open(m, from) {
      if (opened === m) { close(); return; }
      close();
      m.hidden = false;
      m.style.left = from.offsetLeft + "px";
      m.style.top = (from.offsetTop + from.offsetHeight + 4) + "px";
      opened = m;
    }
    document.addEventListener("mousedown", function (e) { if (opened && !bar.contains(e.target)) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

    return { node: bar, add: function (c) { cells.push(c); c.box.addEventListener("focus", function () { active = c; showSize(); }); } };
  }

  /* 끌어서 크기 바꾸기 (열 경계 · 줄 경계), 마우스 · 손가락 모두 */
  function drag(grip, from, move, done) {
    grip.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      var start = from(), x = e.clientX, y = e.clientY;
      grip.setPointerCapture(e.pointerId);
      grip.classList.add("is-drag");
      function mv(ev) { move(start, ev.clientX - x, ev.clientY - y); }
      function up() {
        grip.classList.remove("is-drag");
        grip.removeEventListener("pointermove", mv);
        grip.removeEventListener("pointerup", up);
        grip.removeEventListener("pointercancel", up);
        if (done) done();
      }
      grip.addEventListener("pointermove", mv);
      grip.addEventListener("pointerup", up);
      grip.addEventListener("pointercancel", up);
    });
  }
  var COL_KEY = "leesh_rs_a"; // A열 너비는 이 기기에 기억

  /**
   * 스프레드시트 모양 일지: fields = lessonFields ([칸, 이름, 안내, 최대 글자, 줄 수]), values = 저장된 일지 (rich = 꾸민 글).
   * readOnly = 보기만 (도구 줄 없이). tabs = { items: [{ label, title, active }], pick(i), add() } → 아래쪽 시트 탭.
   * Returns { node, eds: { 칸: { get(), set(v, rich), over(), text(), focus() } } }.
   */
  function sheet(opts) {
    opts = opts || {};
    var ro = !!opts.readOnly, fields = opts.fields || [], v = opts.values || {};
    var wrap = el("div", "rs" + (ro ? " rs--read" : ""));
    try { var w = Number(localStorage.getItem(COL_KEY)); if (w) wrap.style.setProperty("--rs-a", w + "px"); } catch (e) { /* private mode */ }
    var bar = ro ? null : toolbar(), nameBox = null, fxText = null;
    if (bar) {
      wrap.appendChild(bar.node);
      // 칸 이름 상자 (B2) + fx 줄
      var fx = el("div", "rs-fx");
      nameBox = el("span", "rs-fx__name", "B1");
      fx.appendChild(nameBox);
      fx.appendChild(el("span", "rs-fx__sign", "fx"));
      fxText = el("span", "rs-fx__text", fields[0] ? fields[0][1] : "");
      fx.appendChild(fxText);
      wrap.appendChild(fx);
    }
    var grid = el("div", "rs-grid");
    var cols = el("div", "rs-row rs-cols");
    cols.appendChild(el("div", "rs-corner"));
    var colA = el("div", "rs-col", "A"), colB = el("div", "rs-col", "B");
    var colGrip = el("span", "rs-colgrip");
    colGrip.title = "끌어서 A열 넓히기";
    colA.appendChild(colGrip);
    cols.appendChild(colA);
    cols.appendChild(colB);
    grid.appendChild(cols);
    drag(colGrip, function () { return colA.offsetWidth; }, function (w0, dx) {
      wrap.style.setProperty("--rs-a", Math.max(70, Math.min(420, w0 + dx)) + "px");
    }, function () {
      try { localStorage.setItem(COL_KEY, String(parseInt(wrap.style.getPropertyValue("--rs-a"), 10))); } catch (e) { /* private mode */ }
    });

    var eds = {}, rows = [], list = [];
    function activate(i) {
      rows.forEach(function (r, k) { r.classList.toggle("is-active", k === i); });
      colB.classList.add("is-active");
      if (nameBox) { nameBox.textContent = "B" + (i + 1); fxText.textContent = fields[i][1]; }
    }
    function caretEnd(box) {
      var r = document.createRange(); r.selectNodeContents(box); r.collapse(false);
      var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    }
    fields.forEach(function (fd, i) {
      var key = fd[0];
      var row = el("div", "rs-row");
      var num = el("div", "rs-num", String(i + 1));
      var grip = el("span", "rs-rowgrip");
      grip.title = "끌어서 칸 높이 바꾸기";
      num.appendChild(grip);
      var head = el("div", "rs-head");
      head.appendChild(el("span", null, fd[1]));
      var c, box;
      if (ro) {
        box = view(v[key], v.rich, "rt-box rs-read");
      } else {
        c = cell({ value: v[key] || "", rich: v.rich, placeholder: fd[2], rows: fd[4], max: fd[3], label: fd[1], onInput: opts.onInput });
        box = c.box;
        head.appendChild(c.count);
        head.addEventListener("click", function () { c.focus(); });
        num.addEventListener("click", function (e) { if (e.target === num) c.focus(); });
        box.addEventListener("focus", function () { activate(i); });
        // 시트처럼 Tab = 다음 칸, Shift+Tab = 앞 칸
        box.addEventListener("keydown", function (e) {
          if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey) return;
          var next = list[i + (e.shiftKey ? -1 : 1)];
          if (!next) return;
          e.preventDefault();
          next.focus();
          caretEnd(next.box);
        });
        bar.add(c);
        eds[key] = c;
        list.push(c);
      }
      drag(grip, function () { return box.offsetHeight; }, function (h0, dx, dy) {
        box.style.minHeight = Math.max(28, h0 + dy) + "px";
        box.style.height = "";
      });
      row.appendChild(num);
      row.appendChild(head);
      row.appendChild(box);
      grid.appendChild(row);
      rows.push(row);
    });
    wrap.appendChild(grid);

    // 아래쪽 시트 탭 (선생님 화면: 날짜마다 시트 하나, + = 새 시트)
    var t = opts.tabs;
    if (t && t.items && t.items.length) {
      var tb = el("div", "rs-tabs");
      if (t.add) {
        var plus = el("button", "rs-tabs__add", "+");
        plus.type = "button";
        plus.title = t.addTitle || "새 시트";
        plus.setAttribute("aria-label", plus.title);
        plus.addEventListener("click", t.add);
        tb.appendChild(plus);
      }
      var tl = el("div", "rs-tabs__list");
      t.items.forEach(function (it, i) {
        var b = el("button", "rs-tab" + (it.active ? " is-active" : ""), it.label);
        b.type = "button";
        if (it.title) b.title = it.title;
        if (it.active) b.setAttribute("aria-current", "true");
        b.addEventListener("click", function () { if (!it.active) t.pick(i); });
        tl.appendChild(b);
      });
      tb.appendChild(tl);
      wrap.appendChild(tb);
      setTimeout(function () { var a = tl.querySelector(".is-active"); if (a) tl.scrollLeft = a.offsetLeft - tl.clientWidth / 2; }, 0);
    }
    return { node: wrap, eds: eds };
  }

  /** 칸 하나만 (도구 줄 포함). */
  function editor(opts) {
    opts = opts || {};
    var s = sheet({ fields: [["v", opts.label || "", opts.placeholder, opts.max, opts.rows]], values: { v: opts.value, rich: opts.rich }, onInput: opts.onInput });
    s.node.classList.add("rs--single");
    var e = s.eds.v;
    e.node = s.node;
    return e;
  }

  window.LeeshRich = { sheet: sheet, editor: editor, view: view, clean: cleanHtml, textToHtml: textToHtml,
    colors: { text: TEXT_COLORS, fill: FILL_COLORS }, icons: ICON }; // js/grid.js도 같이 씀
})();
