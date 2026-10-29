// 레슨 일지 꾸미기 (원장님 2026-10-29): 선생님들이 구글시트에서 하던 것처럼 빨간 글씨 · 색 · 형광펜 · 굵게 · 크게.
// window.LeeshRich.editor(...) = 칸 하나 (버튼 줄 + 쓰는 곳), LeeshRich.view(html, rich) = 보여주기.
// 꾸민 글은 굵게·색·형광펜·크기·줄바꿈만 남기고 나머지는 모두 걸러요 (서버 private.rich_ok도 한 번 더 확인).
(function () {
  var COLORS = { red: "#D62828", blue: "#1E5BD8", green: "#1E8A4C" };
  var MARK = "#FFE45C";
  var SIZES = { "large": 1, "x-large": 1, "xx-large": 1 };

  function okColor(v) {
    v = String(v || "").trim().toLowerCase();
    return /^#[0-9a-f]{3,6}$/.test(v) || /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+\s*)?\)$/.test(v) ? v : null;
  }
  function hasText(el) { return /\S/.test(el.textContent || ""); }

  /** Only b · i · u · s · br · div · span(color, background-color, font-size, font-weight) survive. */
  function clean(html) {
    var doc = new DOMParser().parseFromString("<body>" + (html || "") + "</body>", "text/html");
    var out = document.createElement("div");
    function walk(src, dst) {
      Array.prototype.forEach.call(src.childNodes, function (n) {
        if (n.nodeType === 3) { dst.appendChild(document.createTextNode(n.nodeValue)); return; }
        if (n.nodeType !== 1) return;
        var tag = n.tagName.toLowerCase();
        if (/^(script|style|iframe|object|embed|img|svg|video|audio|template|head|title|meta|link)$/.test(tag)) return;
        if (tag === "br") { dst.appendChild(document.createElement("br")); return; }
        var keep = null;
        if (/^(b|strong)$/.test(tag)) keep = document.createElement("b");
        else if (/^(i|em)$/.test(tag)) keep = document.createElement("i");
        else if (tag === "u") keep = document.createElement("u");
        else if (/^(s|strike|del)$/.test(tag)) keep = document.createElement("s");
        else if (/^(div|p|li|tr|h[1-6])$/.test(tag)) keep = document.createElement("div");
        var st = n.style || {}, css = [];
        var c = okColor(st.color || (tag === "font" ? n.getAttribute("color") : ""));
        var bg = okColor(st.backgroundColor || (tag === "mark" ? MARK : ""));
        var size = String(st.fontSize || "").toLowerCase();
        if (tag === "font" && n.getAttribute("size")) size = { "4": "large", "5": "x-large", "6": "xx-large", "7": "xx-large" }[n.getAttribute("size")] || "";
        var bold = /^(bold|[6-9]00)$/.test(String(st.fontWeight || ""));
        if (c) css.push("color: " + c);
        if (bg && bg !== "rgba(0, 0, 0, 0)") css.push("background-color: " + bg);
        if (SIZES[size]) css.push("font-size: " + size);
        if (bold && !keep) css.push("font-weight: bold");
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

  var BUTTONS = [
    ["red", "빨강", "빨간 글씨", function () { color(COLORS.red); }],
    ["blue", "파랑", "파란 글씨", function () { color(COLORS.blue); }],
    ["green", "초록", "초록 글씨", function () { color(COLORS.green); }],
    ["mark", "형광펜", "노란 형광펜", function () { cmd("hiliteColor", MARK) || cmd("backColor", MARK); }],
    ["bold", "굵게", "굵게", function () { cmd("bold"); }],
    ["big", "크게", "글씨 크게", function () { cmd("fontSize", "5"); }],
    ["clear", "지우기", "꾸미기 지우기 (글자는 그대로)", function () { cmd("removeFormat"); cmd("hiliteColor", "transparent"); }]
  ];
  function cmd(name, arg) {
    try { document.execCommand("styleWithCSS", false, true); } catch (e) { /* old browsers */ }
    try { return document.execCommand(name, false, arg == null ? null : arg); } catch (e) { return false; }
  }
  function color(c) { cmd("foreColor", c); }

  /**
   * One field: toolbar + editable box. opts = { value, rich, placeholder, rows, max, onInput }.
   * Returns { node, get() → cleaned html or "" , text(), set(value, rich), focus() }.
   */
  function editor(opts) {
    opts = opts || {};
    var wrap = document.createElement("div");
    wrap.className = "rt";
    var bar = document.createElement("div");
    bar.className = "rt-bar";
    var box = document.createElement("div");
    box.className = "rt-box";
    box.contentEditable = "true";
    box.setAttribute("role", "textbox");
    box.setAttribute("aria-multiline", "true");
    if (opts.label) box.setAttribute("aria-label", opts.label);
    if (opts.placeholder) box.setAttribute("data-placeholder", opts.placeholder);
    box.style.minHeight = (1.6 * (opts.rows || 3) + 1.2) + "em";
    BUTTONS.forEach(function (b) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rt-btn rt-btn--" + b[0];
      btn.textContent = b[1];
      btn.title = b[2];
      btn.setAttribute("aria-label", b[2]);
      // keep the selection in the box: act on mousedown, not on click
      btn.addEventListener("mousedown", function (e) { e.preventDefault(); });
      btn.addEventListener("click", function () {
        if (document.activeElement !== box) box.focus();
        b[3]();
        changed();
      });
      bar.appendChild(btn);
    });
    var count = document.createElement("span");
    count.className = "rt-count";
    bar.appendChild(count);
    wrap.appendChild(bar);
    wrap.appendChild(box);

    function text() { return (box.innerText || box.textContent || "").replace(/ /g, " "); }
    function update() {
      var n = text().trim().length;
      box.classList.toggle("is-empty", !n);
      count.textContent = opts.max && n > opts.max * 0.8 ? n + " / " + opts.max : "";
      count.classList.toggle("is-over", !!opts.max && n > opts.max);
    }
    function changed() { update(); if (opts.onInput) opts.onInput(); }
    box.addEventListener("input", changed);
    // pasted text keeps its colours / bold from Google Sheets, but nothing else
    box.addEventListener("paste", function (e) {
      var cd = e.clipboardData;
      if (!cd) return;
      e.preventDefault();
      var html = cd.getData("text/html");
      cmd("insertHTML", html ? cleanHtml(html) : textToHtml(cd.getData("text/plain")));
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
      node: wrap,
      box: box,
      get: function () { return text().trim() ? cleanHtml(box.innerHTML) : ""; },
      text: text,
      over: function () { return !!opts.max && text().trim().length > opts.max; },
      set: set,
      focus: function () { box.focus(); }
    };
  }

  window.LeeshRich = { editor: editor, view: view, clean: cleanHtml, textToHtml: textToHtml };
})();
