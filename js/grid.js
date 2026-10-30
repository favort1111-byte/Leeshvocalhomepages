// 레슨 일지 표 (원장님 2026-10-30 "진짜 스프레드시트처럼: A B C D E F G … 열, 1 2 3 … 좁은 줄").
// 구글시트처럼: 칸을 누르면 파란 테두리(고르기) → 글자를 치면 바로 써지고, 두 번 누르거나 Enter면 고치기.
// 방향키 · Tab · Enter로 옮기기, 끌어서 여러 칸 고르기, Delete로 지우기, 구글시트에서 복사한 칸 붙여넣기(색 · 굵게 · 크기 그대로),
// 열 · 줄 경계 끌어서 크기, 오른쪽 클릭으로 행 · 열 넣기/지우기, 확대/축소, 아래쪽 시트 탭.
//   LeeshGrid.editor({ data, onInput, tabs }) → { node, get(), set(data), text(), over(), focus() }
//   LeeshGrid.view(data)                      → 보기만 (쓴 곳까지만)
//   LeeshGrid.template(fields) / fromNote(note, fields) → 새 일지 / 예전 일지(칸 5개)를 표로
// 저장 모양 (lesson_notes.sheet, 서버 private.sheet_ok가 다시 확인):
//   { v:1, n:행 수, w:{열:너비}, h:{행:높이}, c:{ "행,열": { t:"꾸민 글", s:{ b,i,u,x(취소선), z:글씨px, f:글자색, g:채우기색 } } } }
(function () {
  var R = window.LeeshRich;
  if (!R) return;
  var COLS = 26, ROWS = 100, MAX_ROWS = 1000, CW = 100, RH = 21, MAXLEN = 5000, BASE = 13;
  var LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  var ZOOMS = [75, 90, 100, 110, 125, 150, 200];
  var ZOOM_KEY = "leesh_grid_zoom";
  var SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36];
  var TEXT_COLORS = R.colors.text, FILL_COLORS = R.colors.fill;

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
  function key(r, c) { return r + "," + c; }
  function name(r, c) { return LETTERS[c] + (r + 1); }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  /** Plain text of a cell (줄바꿈은 \n). */
  function textOf(html) {
    var s = String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/div>\s*<div[^>]*>/gi, "\n").replace(/<[^>]*>/g, "");
    var t = document.createElement("textarea");
    t.innerHTML = s;
    return t.value.replace(/ /g, " ");
  }
  function okColor(v) {
    v = String(v || "").trim().toLowerCase();
    return /^#[0-9a-f]{3,8}$/.test(v) || /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+\s*)?\)$/.test(v) ? v : null;
  }
  function isWhite(v) { return /^(#fff|#ffffff|rgb\(255,\s*255,\s*255\)|rgba\(0,\s*0,\s*0,\s*0\)|transparent)$/i.test(String(v || "").trim()); }
  function pxOf(v) {
    var m = /^(\d+(?:\.\d+)?)(px|pt)$/.exec(String(v || "").trim());
    if (!m) return null;
    var px = Math.round(m[2] === "pt" ? Number(m[1]) * 4 / 3 : Number(m[1]));
    return px >= 8 && px <= 48 ? px : null;
  }
  function empty() { return { v: 1, n: ROWS, w: {}, h: {}, c: {} }; }
  function norm(d) {
    d = d && typeof d === "object" ? copy(d) : empty();
    d.v = 1;
    d.w = d.w || {};
    d.h = d.h || {};
    d.c = d.c || {};
    var top = 0;
    Object.keys(d.c).forEach(function (k) { top = Math.max(top, Number(k.split(",")[0]) + 1); });
    d.n = Math.min(MAX_ROWS, Math.max(Number(d.n) || 0, ROWS, top + 20));
    return d;
  }
  function used(d) {
    var r = -1, c = -1;
    Object.keys(d.c || {}).forEach(function (k) {
      var x = d.c[k];
      if (!x || (!textOf(x.t).trim() && !(x.s && x.s.g))) return;
      var p = k.split(",");
      r = Math.max(r, Number(p[0]));
      c = Math.max(c, Number(p[1]));
    });
    return { r: r, c: c };
  }
  function cellCss(s) {
    s = s || {};
    var css = [];
    if (s.b) css.push("font-weight:bold");
    if (s.i) css.push("font-style:italic");
    var deco = (s.u ? "underline " : "") + (s.x ? "line-through" : "");
    if (deco) css.push("text-decoration:" + deco.trim());
    if (s.z) css.push("font-size:" + s.z + "px");
    if (s.f) css.push("color:" + s.f);
    if (s.g) css.push("background-color:" + s.g);
    return css.join(";");
  }
  function fill(div, html) {
    div.textContent = "";
    var box = document.createElement("div");
    box.innerHTML = R.clean(html || "");
    while (box.firstChild) div.appendChild(box.firstChild);
  }

  /* ---------- 새 일지 · 예전 일지 ---------- */
  var HEAD = { b: 1, g: "#f3f3f3" };
  // 칸 이름은 A열에 띄엄띄엄 (A1 오늘 수업 · A5 준비곡 · A10 연습 포인트 · A15 오디션 일정 · A20 노래 추천),
  // 그 사이 줄(B열 · 아래 줄)에 쓰면 돼요 (원장님 2026-10-30: 붙어 있으면 행을 잘라 붙여 내려야 해서 불편)
  function headRow(i) { return i ? i * 5 - 1 : 0; }
  function template(fields) {
    var d = empty();
    d.w = { 0: 150, 1: 360 };
    (fields || []).forEach(function (fd, i) { d.c[key(headRow(i), 0)] = { t: R.textToHtml(fd[1]), s: copy(HEAD) }; });
    return d;
  }
  function fromNote(n, fields) {
    if (n && n.sheet) return norm(n.sheet);
    var d = template(fields);
    (fields || []).forEach(function (fd, i) {
      var v = n && n[fd[0]];
      if (v) d.c[key(headRow(i), 1)] = { t: n.rich ? R.clean(v) : R.textToHtml(v) };
    });
    return d;
  }

  /* ---------- 표 그리기 (편집 · 보기 같이) ---------- */
  function table(d, rows, cols, opts) {
    var t = el("table", "xs-table");
    var cg = el("colgroup");
    var c0 = el("col");
    c0.style.width = "46px";
    cg.appendChild(c0);
    var total = 46;
    for (var c = 0; c < cols; c++) {
      var col = el("col"), w = Number(d.w[c]) || CW;
      col.style.width = w + "px";
      total += w;
      cg.appendChild(col);
    }
    t.appendChild(cg);
    t.style.width = total + "px";
    var hd = el("thead"), hr = el("tr");
    var corner = el("th", "xs-corner");
    hr.appendChild(corner);
    for (c = 0; c < cols; c++) {
      var th = el("th", "xs-ch", LETTERS[c]);
      th.setAttribute("data-c", c);
      if (opts.edit) { var g = el("span", "xs-cgrip"); g.title = "끌어서 열 너비 바꾸기"; th.appendChild(g); }
      hr.appendChild(th);
    }
    hd.appendChild(hr);
    t.appendChild(hd);
    var bd = el("tbody");
    for (var r = 0; r < rows; r++) {
      var tr = el("tr");
      tr.setAttribute("data-r", r);
      if (d.h[r]) tr.style.height = d.h[r] + "px";
      var rh = el("th", "xs-rh", String(r + 1));
      if (opts.edit) { var rg = el("span", "xs-rgrip"); rg.title = "끌어서 줄 높이 바꾸기"; rh.appendChild(rg); }
      tr.appendChild(rh);
      for (c = 0; c < cols; c++) {
        var td = el("td", "xs-c");
        var v = el("div", "xs-v");
        var x = d.c[key(r, c)];
        if (x) { td.style.cssText = cellCss(x.s); fill(v, x.t); }
        td.appendChild(v);
        tr.appendChild(td);
      }
      bd.appendChild(tr);
    }
    t.appendChild(bd);
    return t;
  }

  /** 보기만: 쓴 곳까지만 (열 머리 · 줄 번호는 그대로). */
  function view(data) {
    var d = norm(data), u = used(d);
    var wrap = el("div", "xs xs--view");
    if (u.r < 0) { wrap.appendChild(el("p", "sys-note", "비어 있어요.")); return wrap; }
    var sc = el("div", "xs-scroll");
    sc.appendChild(table(d, u.r + 1, Math.max(u.c + 1, 2), {}));
    wrap.appendChild(sc);
    return wrap;
  }

  /* ---------- 편집기 ---------- */
  function editor(opts) {
    opts = opts || {};
    var d = norm(opts.data || empty());
    var touch = false;
    var act = { r: 0, c: 0 }, rng = { r1: 0, c1: 0, r2: 0, c2: 0 };
    var mode = "sel", editSnap = null, dragging = false;
    var undos = [], redos = [];

    var wrap = el("div", "xs");
    var bar = el("div", "rt-bar rt-bar--sheet xs-bar");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "표 꾸미기");
    wrap.appendChild(bar);
    var fx = el("div", "rs-fx");
    var nameBox = el("span", "rs-fx__name", "A1");
    var fxText = el("span", "rs-fx__text");
    fx.appendChild(nameBox);
    fx.appendChild(el("span", "rs-fx__sign", "fx"));
    fx.appendChild(fxText);
    wrap.appendChild(fx);
    var sc = el("div", "xs-scroll");
    sc.tabIndex = -1;
    wrap.appendChild(sc);
    var foot = el("div", "rs-tabs xs-foot");
    wrap.appendChild(foot);
    var menuBox = el("div", "rt-menu xs-menu");
    menuBox.hidden = true;
    wrap.appendChild(menuBox);
    var tbl = null;

    function changed() { if (opts.onInput) opts.onInput(); }
    function snap() { return JSON.stringify(d); }
    function remember(before) {
      undos.push(before || snap());
      if (undos.length > 100) undos.shift();
      redos = [];
    }
    function zoom() {
      var z = 100;
      try { z = Number(localStorage.getItem(ZOOM_KEY)) || 100; } catch (e) { /* private mode */ }
      return z;
    }

    /* --- 그리기 --- */
    function td(r, c) { var tr = tbl && tbl.tBodies[0].rows[r]; return tr ? tr.cells[c + 1] : null; }
    function cellDiv(r, c) { var x = td(r, c); return x ? x.firstChild : null; }
    function render() {
      var t = table(d, d.n, COLS, { edit: true });
      t.style.zoom = zoom() / 100;
      if (tbl) tbl.replaceWith(t); else sc.appendChild(t);
      tbl = t;
      paintSel();
      drawFoot();
    }
    function renderCell(r, c) {
      var x = d.c[key(r, c)], cell = td(r, c);
      if (!cell) return;
      cell.style.cssText = x ? cellCss(x.s) : "";
      fill(cell.firstChild, x && x.t);
    }
    function paintSel() {
      if (!tbl) return;
      tbl.querySelectorAll(".is-cur, .is-in, .is-on, .is-edit").forEach(function (n) { n.classList.remove("is-cur", "is-in", "is-on", "is-edit"); });
      tbl.querySelectorAll('[contenteditable="true"]').forEach(function (n) { n.removeAttribute("contenteditable"); });
      var multi = rng.r1 !== rng.r2 || rng.c1 !== rng.c2;
      for (var r = rng.r1; r <= rng.r2; r++) {
        tbl.tBodies[0].rows[r].cells[0].classList.add("is-on");
        if (multi) for (var c = rng.c1; c <= rng.c2; c++) td(r, c).classList.add("is-in");
      }
      for (c = rng.c1; c <= rng.c2; c++) tbl.tHead.rows[0].cells[c + 1].classList.add("is-on");
      var cur = td(act.r, act.c);
      cur.classList.add("is-cur");
      if (mode === "edit") cur.classList.add("is-edit");
      var v = cur.firstChild;
      v.contentEditable = "true";
      nameBox.textContent = multi ? name(rng.r1, rng.c1) + ":" + name(rng.r2, rng.c2) : name(act.r, act.c);
      showFx();
      showSize();
    }
    function showFx() {
      var x = d.c[key(act.r, act.c)];
      var t = x ? textOf(x.t).replace(/\n/g, " ") : "";
      fxText.textContent = t.length > 200 ? t.slice(0, 200) + "…" : t;
    }
    function focusCur(where, stay) {
      var v = cellDiv(act.r, act.c);
      if (!v) return;
      v.focus({ preventScroll: true });
      if (where) {
        var s = window.getSelection(), r = document.createRange();
        r.selectNodeContents(v);
        if (where === "end") r.collapse(false);
        s.removeAllRanges();
        s.addRange(r);
      }
      if (!stay) seen(td(act.r, act.c));
    }
    // 고른 칸이 보이게 (표 안에서만 스크롤)
    function seen(cell) {
      if (!cell) return;
      var cr = cell.getBoundingClientRect(), sr = sc.getBoundingClientRect();
      var headH = tbl.tHead.getBoundingClientRect().height, headW = tbl.tHead.rows[0].cells[0].getBoundingClientRect().width;
      if (cr.top < sr.top + headH) sc.scrollTop -= sr.top + headH - cr.top;
      else if (cr.bottom > sr.top + sc.clientHeight) sc.scrollTop += Math.min(cr.bottom - (sr.top + sc.clientHeight), cr.top - sr.top - headH);
      if (cr.left < sr.left + headW) sc.scrollLeft -= sr.left + headW - cr.left;
      else if (cr.right > sr.left + sc.clientWidth) sc.scrollLeft += Math.min(cr.right - (sr.left + sc.clientWidth), cr.left - sr.left - headW);
    }

    /* --- 고르기 · 옮기기 --- */
    function pick(r, c, extend) {
      r = Math.max(0, Math.min(d.n - 1, r));
      c = Math.max(0, Math.min(COLS - 1, c));
      if (extend) {
        rng = { r1: Math.min(act.r, r), c1: Math.min(act.c, c), r2: Math.max(act.r, r), c2: Math.max(act.c, c) };
      } else {
        act = { r: r, c: c };
        rng = { r1: r, c1: c, r2: r, c2: c };
      }
      paintSel();
    }
    var ext = null; // shift+방향키로 넓히는 끝
    function move(dr, dc, extend) {
      if (mode === "edit") commit();
      if (extend) {
        ext = ext || { r: act.r, c: act.c };
        ext = { r: Math.max(0, Math.min(d.n - 1, ext.r + dr)), c: Math.max(0, Math.min(COLS - 1, ext.c + dc)) };
        pick(ext.r, ext.c, true);
        seen(td(ext.r, ext.c));
      } else {
        ext = null;
        pick(act.r + dr, act.c + dc);
      }
      focusCur();
    }

    /* --- 쓰기 --- */
    function sync() {
      var v = cellDiv(act.r, act.c), k = key(act.r, act.c);
      if (!v) return;
      var html = R.clean(v.innerHTML), x = d.c[k] || {};
      if (textOf(html).trim()) x.t = html; else delete x.t;
      if (x.t || (x.s && Object.keys(x.s).length)) d.c[k] = x; else delete d.c[k];
      showFx();
      changed();
    }
    function beginEdit(where) {
      if (mode === "edit") return;
      editSnap = snap();
      mode = "edit";
      paintSel();
      focusCur(where || "end");
    }
    // 고른 칸에서 글자를 치면: 원래 글을 지우고 새로 (구글시트처럼). 한글 입력도 같은 방법.
    function beginType() {
      editSnap = snap();
      mode = "edit";
      paintSel();
      focusCur("all");
    }
    function commit() {
      if (mode !== "edit") return;
      sync();
      mode = "sel";
      if (editSnap && editSnap !== snap()) remember(editSnap);
      editSnap = null;
      renderCell(act.r, act.c);
      paintSel();
    }
    function cancel() {
      if (mode !== "edit") return;
      if (editSnap) d = JSON.parse(editSnap);
      editSnap = null;
      mode = "sel";
      renderCell(act.r, act.c);
      paintSel();
      focusCur();
      changed();
    }
    function each(fn) {
      for (var r = rng.r1; r <= rng.r2; r++) for (var c = rng.c1; c <= rng.c2; c++) fn(r, c, key(r, c));
    }
    function clearRange() {
      var before = snap();
      each(function (r, c, k) {
        var x = d.c[k];
        if (!x) return;
        delete x.t;
        if (!x.s || !Object.keys(x.s).length) delete d.c[k];
        renderCell(r, c);
      });
      if (before !== snap()) { remember(before); changed(); }
      showFx();
    }

    /* --- 칸 서식 (고른 칸 전체) --- */
    function setStyle(fn) {
      var before = snap();
      each(function (r, c, k) {
        var x = d.c[k] || {};
        x.s = x.s || {};
        fn(x.s, r, c);
        Object.keys(x.s).forEach(function (n) { if (x.s[n] == null || x.s[n] === "" || x.s[n] === 0) delete x.s[n]; });
        if (!Object.keys(x.s).length) delete x.s;
        if (x.t || x.s) d.c[k] = x; else delete d.c[k];
        renderCell(r, c);
      });
      if (before !== snap()) { remember(before); changed(); }
      paintSel();
    }
    function toggle(flag) {
      var all = true;
      each(function (r, c, k) { var x = d.c[k]; if (!(x && x.s && x.s[flag])) all = false; });
      setStyle(function (s) { s[flag] = all ? null : 1; });
    }
    function inlineSel() {
      if (mode !== "edit") return false;
      var s = window.getSelection(), v = cellDiv(act.r, act.c);
      return !!(s.rangeCount && !s.isCollapsed && v && v.contains(s.anchorNode));
    }
    function curStyle() { var x = d.c[key(act.r, act.c)]; return (x && x.s) || {}; }

    /* --- 붙여넣기 · 복사 --- */
    function styleOf(n) {
      var st = n.style || {}, s = {};
      if (/^(bold|bolder|[6-9]00)$/.test(String(st.fontWeight || ""))) s.b = 1;
      if (String(st.fontStyle || "") === "italic") s.i = 1;
      var deco = String(st.textDecorationLine || st.textDecoration || "");
      if (/underline/.test(deco)) s.u = 1;
      if (/line-through/.test(deco)) s.x = 1;
      var z = pxOf(st.fontSize);
      if (z && z !== BASE) s.z = z;
      var f = okColor(st.color);
      if (f && !/^(#000|#000000|rgb\(0,\s*0,\s*0\))$/i.test(f)) s.f = f;
      var g = okColor(st.backgroundColor);
      if (g && !isWhite(g)) s.g = g;
      return s;
    }
    function parseClip(cd) {
      var html = cd.getData("text/html");
      if (html && /<table/i.test(html)) {
        var doc = new DOMParser().parseFromString(html, "text/html");
        var rows = [];
        doc.querySelectorAll("table tr").forEach(function (tr) {
          var row = [];
          Array.prototype.forEach.call(tr.cells, function (c) {
            var t = R.clean(c.innerHTML);
            row.push({ t: textOf(t).trim() ? t : "", s: styleOf(c) });
            for (var i = 1; i < (Number(c.colSpan) || 1); i++) row.push(null);
          });
          rows.push(row);
        });
        if (rows.length) return rows;
      }
      var text = (cd.getData("text/plain") || "").replace(/\r/g, "");
      if (!text) return null;
      if (/\n$/.test(text)) text = text.slice(0, -1);
      return text.split("\n").map(function (line) {
        return line.split("\t").map(function (t) { return { t: R.textToHtml(t), s: {} }; });
      });
    }
    function pasteGrid(rows) {
      var before = snap();
      var r0 = rng.r1, c0 = rng.c1, rMax = r0, cMax = c0;
      rows.forEach(function (row, i) {
        var r = r0 + i;
        if (r >= MAX_ROWS) return;
        if (r >= d.n) d.n = Math.min(MAX_ROWS, r + 20);
        row.forEach(function (cell, j) {
          var c = c0 + j;
          if (!cell || c >= COLS) return;
          var x = {};
          if (cell.t && textOf(cell.t).trim()) x.t = cell.t;
          if (cell.s && Object.keys(cell.s).length) x.s = cell.s;
          if (x.t || x.s) d.c[key(r, c)] = x; else delete d.c[key(r, c)];
          rMax = Math.max(rMax, r);
          cMax = Math.max(cMax, c);
        });
      });
      remember(before);
      render();
      act = { r: r0, c: c0 };
      rng = { r1: r0, c1: c0, r2: rMax, c2: cMax };
      paintSel();
      focusCur();
      changed();
    }
    function onPaste(e) {
      var cd = e.clipboardData;
      if (!cd) return;
      var rows = parseClip(cd);
      e.preventDefault();
      if (!rows) return;
      var many = rows.length > 1 || rows[0].length > 1;
      if (mode === "edit" && !many) {
        var h = cd.getData("text/html");
        exec("insertHTML", h ? R.clean(h) : R.textToHtml(cd.getData("text/plain")));
        sync();
        return;
      }
      if (mode === "edit") commit();
      pasteGrid(rows);
    }
    function onCopy(e, cut) {
      if (mode === "edit" || !e.clipboardData) return;
      e.preventDefault();
      var tsv = [], html = ["<table>"];
      for (var r = rng.r1; r <= rng.r2; r++) {
        var line = [];
        html.push("<tr>");
        for (var c = rng.c1; c <= rng.c2; c++) {
          var x = d.c[key(r, c)] || {}, t = textOf(x.t);
          line.push(/[\t\n"]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t);
          html.push('<td style="' + cellCss(x.s) + '">' + (x.t ? R.clean(x.t) : "") + "</td>");
        }
        tsv.push(line.join("\t"));
        html.push("</tr>");
      }
      html.push("</table>");
      e.clipboardData.setData("text/plain", tsv.join("\n"));
      e.clipboardData.setData("text/html", html.join(""));
      if (cut) clearRange();
    }

    /* --- 행 · 열 넣기 · 지우기 --- */
    function shift(axis, at, by) {
      var nc = {};
      Object.keys(d.c).forEach(function (k) {
        var p = k.split(","), r = Number(p[0]), c = Number(p[1]);
        var v = axis === "r" ? r : c;
        if (by < 0 && v >= at && v < at - by) return; // 지운 줄
        if (v >= at) v += by;
        if (axis === "r") r = v; else c = v;
        nc[key(r, c)] = d.c[k];
      });
      d.c = nc;
      var size = axis === "r" ? d.h : d.w, ns = {};
      Object.keys(size).forEach(function (k) {
        var v = Number(k);
        if (by < 0 && v >= at && v < at - by) return;
        ns[v >= at ? v + by : v] = size[k];
      });
      if (axis === "r") d.h = ns; else d.w = ns;
    }
    function rowsAt(at, count) {
      if (d.n + count > MAX_ROWS) { alert("행은 " + MAX_ROWS + "개까지예요."); return; }
      remember();
      shift("r", at, count);
      d.n += count;
      render();
      changed();
    }
    function colsAt(at) {
      var full = Object.keys(d.c).some(function (k) { return Number(k.split(",")[1]) === COLS - 1; });
      if (full) { alert("Z열이 비어 있어야 열을 넣을 수 있어요."); return; }
      remember();
      shift("c", at, 1);
      render();
      changed();
    }
    function delRows() {
      var n = rng.r2 - rng.r1 + 1;
      remember();
      shift("r", rng.r1, -n);
      d.n = Math.max(ROWS, d.n - n);
      act = { r: rng.r1, c: act.c };
      rng = { r1: act.r, c1: act.c, r2: act.r, c2: act.c };
      render();
      changed();
    }
    function delCols() {
      var n = rng.c2 - rng.c1 + 1;
      remember();
      shift("c", rng.c1, -n);
      act = { r: act.r, c: rng.c1 };
      rng = { r1: act.r, c1: act.c, r2: act.r, c2: act.c };
      render();
      changed();
    }
    function undo() {
      if (mode === "edit") { exec("undo"); sync(); return; }
      if (!undos.length) return;
      redos.push(snap());
      d = JSON.parse(undos.pop());
      render();
      changed();
      focusCur();
    }
    function redo() {
      if (mode === "edit") { exec("redo"); sync(); return; }
      if (!redos.length) return;
      undos.push(snap());
      d = JSON.parse(redos.pop());
      render();
      changed();
      focusCur();
    }

    /* --- 오른쪽 클릭 메뉴 --- */
    function showMenu(x, y) {
      menuBox.textContent = "";
      var rows = rng.r2 - rng.r1 + 1, cols = rng.c2 - rng.c1 + 1;
      [["위에 행 " + rows + "개 넣기", function () { rowsAt(rng.r1, rows); }],
       ["아래에 행 " + rows + "개 넣기", function () { rowsAt(rng.r2 + 1, rows); }],
       ["행 " + (rng.r1 + 1) + (rows > 1 ? "~" + (rng.r2 + 1) : "") + " 지우기", delRows],
       null,
       ["왼쪽에 열 넣기", function () { colsAt(rng.c1); }],
       ["오른쪽에 열 넣기", function () { colsAt(rng.c2 + 1); }],
       ["열 " + LETTERS[rng.c1] + (cols > 1 ? "~" + LETTERS[rng.c2] : "") + " 지우기", delCols],
       null,
       ["내용 지우기 (Delete)", clearRange],
       ["서식 지우기", function () { clearFormat(); }]
      ].forEach(function (it) {
        if (!it) { menuBox.appendChild(el("hr")); return; }
        var b = el("button", "xs-menu__item", it[0]);
        b.type = "button";
        b.addEventListener("click", function () { closeMenus(); it[1](); focusCur(null, true); });
        menuBox.appendChild(b);
      });
      var box = wrap.getBoundingClientRect();
      menuBox.hidden = false;
      menuBox.style.left = Math.min(x - box.left, wrap.clientWidth - menuBox.offsetWidth - 4) + "px";
      menuBox.style.top = (y - box.top) + "px";
    }

    /* --- 도구 줄 --- */
    var ICON = R.icons;
    function btn(cls, html, title, fn, menuBtn) {
      var b = el("button", "rt-btn " + cls);
      b.type = "button";
      b.innerHTML = html;
      b.title = title;
      b.setAttribute("aria-label", title);
      b.addEventListener("mousedown", function (e) { e.preventDefault(); }); // 칸에서 고른 글자가 풀리지 않게
      b.addEventListener("click", function () { if (!menuBtn) closeMenus(); fn(); if (!menuBtn) focusCur(null, true); });
      bar.appendChild(b);
      return b;
    }
    function sep() { bar.appendChild(el("span", "rt-sep")); }
    function inline(fn) { fn(); sync(); }
    btn("rt-btn--undo", ICON.undo, "실행 취소 (Ctrl+Z)", undo);
    btn("rt-btn--redo", ICON.redo, "다시 실행 (Ctrl+Y)", redo);
    sep();
    var zoomSel = el("select", "xs-zoom");
    zoomSel.title = "확대 · 축소";
    zoomSel.setAttribute("aria-label", "확대 · 축소");
    ZOOMS.forEach(function (z) { var o = el("option", null, z + "%"); o.value = z; zoomSel.appendChild(o); });
    zoomSel.value = String(zoom());
    zoomSel.addEventListener("change", function () {
      try { localStorage.setItem(ZOOM_KEY, zoomSel.value); } catch (e) { /* private mode */ }
      if (tbl) tbl.style.zoom = Number(zoomSel.value) / 100;
      focusCur(null, true);
    });
    bar.appendChild(zoomSel);
    sep();
    function curSize() {
      if (mode === "edit") {
        var s = window.getSelection(), v = cellDiv(act.r, act.c);
        var n = s.rangeCount && v && v.contains(s.anchorNode) ? s.anchorNode : null;
        if (n && n.nodeType === 3) n = n.parentNode;
        if (n) return Math.round(parseFloat(getComputedStyle(n).fontSize)) || BASE;
      }
      return curStyle().z || BASE;
    }
    function setSize(px) {
      if (inlineSel()) {
        inline(function () {
          var v = cellDiv(act.r, act.c);
          exec("fontSize", "7", true);
          v.querySelectorAll('font[size="7"], span[style*="xxx-large"]').forEach(function (n) {
            var sp = n;
            if (n.tagName === "FONT") { sp = el("span"); while (n.firstChild) sp.appendChild(n.firstChild); n.replaceWith(sp); }
            sp.style.fontSize = px + "px";
            sp.querySelectorAll("[style]").forEach(function (k) { k.style.fontSize = ""; if (!k.getAttribute("style")) k.removeAttribute("style"); });
            var r = document.createRange(); r.selectNodeContents(sp);
            var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
          });
        });
      } else setStyle(function (s) { s.z = px === BASE ? null : px; });
      showSize();
    }
    function step(dir) {
      var now = curSize(), i;
      if (dir > 0) { for (i = 0; i < SIZES.length && SIZES[i] <= now; i++); setSize(SIZES[Math.min(i, SIZES.length - 1)]); }
      else { for (i = SIZES.length - 1; i >= 0 && SIZES[i] >= now; i--); setSize(SIZES[Math.max(i, 0)]); }
    }
    btn("rt-btn--minus", "−", "글씨 작게", function () { step(-1); });
    var sizeBtn = btn("rt-btn--size", String(BASE), "글씨 크기 고르기", function () { open(sizeMenu, sizeBtn); }, true);
    btn("rt-btn--plus", "+", "글씨 크게", function () { step(1); });
    function showSize() { sizeBtn.textContent = String(curSize()); }
    sep();
    function flag(f, cmd) { return function () { if (inlineSel()) inline(function () { exec(cmd); }); else toggle(f); }; }
    btn("rt-btn--bold", "<b>B</b>", "굵게 (Ctrl+B)", flag("b", "bold"));
    btn("rt-btn--italic", "<i>I</i>", "기울임 (Ctrl+I)", flag("i", "italic"));
    btn("rt-btn--under", "<u>U</u>", "밑줄 (Ctrl+U)", flag("u", "underline"));
    btn("rt-btn--strike", "<s>S</s>", "취소선", flag("x", "strikeThrough"));
    sep();
    var lastText = "#D62828", lastFill = "#FFE45C";
    var colorBtn = btn("rt-btn--color", 'A<i class="rt-swatch" style="background:' + lastText + '"></i>', "글자 색", function () { open(textMenu, colorBtn); }, true);
    var fillBtn = btn("rt-btn--fill", ICON.fill + '<i class="rt-swatch" style="background:' + lastFill + '"></i>', "채우기 색", function () { open(fillMenu, fillBtn); }, true);
    sep();
    function clearFormat() {
      if (inlineSel()) {
        inline(function () {
          exec("removeFormat");
          var s = window.getSelection(), v = cellDiv(act.r, act.c);
          v.querySelectorAll("span[style], b, i, u, s, font").forEach(function (n) {
            if (s.rangeCount && s.getRangeAt(0).intersectsNode(n)) { while (n.firstChild) n.parentNode.insertBefore(n.firstChild, n); n.remove(); }
          });
        });
        return;
      }
      if (mode === "edit") commit();
      var before = snap();
      each(function (r, c, k) {
        var x = d.c[k];
        if (!x) return;
        delete x.s;
        if (x.t) x.t = R.textToHtml(textOf(x.t)); else delete d.c[k];
        renderCell(r, c);
      });
      if (before !== snap()) { remember(before); changed(); }
      paintSel();
    }
    btn("rt-btn--clear", ICON.clear, "서식 지우기 (글자는 그대로)", clearFormat);

    function menu(cls) {
      var m = el("div", "rt-menu " + cls);
      m.hidden = true;
      m.addEventListener("mousedown", function (e) { e.preventDefault(); });
      bar.appendChild(m);
      return m;
    }
    var sizeMenu = menu("rt-menu--size");
    SIZES.forEach(function (px) {
      var b = el("button", "rt-menu__size", String(px));
      b.type = "button";
      b.addEventListener("click", function () { setSize(px); closeMenus(true); });
      sizeMenu.appendChild(b);
    });
    function palette(m, list, apply) {
      list.forEach(function (c) {
        var b = el("button", "rt-chip" + (c ? "" : " rt-chip--none"));
        b.type = "button";
        b.style.background = c || "#fff";
        b.title = c || "없음";
        b.setAttribute("aria-label", c ? "색 " + c : "색 없음");
        b.addEventListener("click", function () { apply(c); closeMenus(true); });
        m.appendChild(b);
      });
    }
    var textMenu = menu("rt-menu--color"), fillMenu = menu("rt-menu--color");
    palette(textMenu, ["#000000"].concat(TEXT_COLORS.filter(function (c) { return c !== "#000000"; })), function (c) {
      lastText = c;
      colorBtn.querySelector(".rt-swatch").style.background = c;
      if (inlineSel()) inline(function () { exec("foreColor", c, true); });
      else setStyle(function (s) { s.f = /^#0{3,6}$/.test(c) ? null : c; });
    });
    palette(fillMenu, FILL_COLORS, function (c) {
      if (c) { lastFill = c; fillBtn.querySelector(".rt-swatch").style.background = c; }
      if (mode === "edit") commit();
      setStyle(function (s) { s.g = c || null; }); // 채우기는 시트처럼 칸 전체
    });
    var opened = null;
    function closeMenus(keepFocus) {
      if (opened) { opened.hidden = true; opened = null; }
      menuBox.hidden = true;
      if (keepFocus) focusCur(null, true);
    }
    function open(m, from) {
      if (opened === m) { closeMenus(); return; }
      closeMenus();
      m.hidden = false;
      m.style.left = from.offsetLeft + "px";
      m.style.top = (from.offsetTop + from.offsetHeight + 4) + "px";
      opened = m;
    }
    document.addEventListener("mousedown", function (e) {
      if (opened && !bar.contains(e.target)) closeMenus();
      if (!menuBox.hidden && !menuBox.contains(e.target)) menuBox.hidden = true;
    });

    /* --- 아래쪽: 행 더하기 + 시트 탭 --- */
    function drawFoot() {
      foot.textContent = "";
      var t = opts.tabs;
      if (t && t.add) {
        var plus = el("button", "rs-tabs__add", "+");
        plus.type = "button";
        plus.title = t.addTitle || "새 시트";
        plus.setAttribute("aria-label", plus.title);
        plus.addEventListener("click", t.add);
        foot.appendChild(plus);
      }
      if (t && t.items && t.items.length) {
        var tl = el("div", "rs-tabs__list");
        t.items.forEach(function (it, i) {
          var b = el("button", "rs-tab" + (it.active ? " is-active" : ""), it.label);
          b.type = "button";
          if (it.title) b.title = it.title;
          if (it.active) b.setAttribute("aria-current", "true");
          b.addEventListener("click", function () { if (!it.active) { commit(); t.pick(i); } });
          tl.appendChild(b);
        });
        foot.appendChild(tl);
        setTimeout(function () { var a = tl.querySelector(".is-active"); if (a) tl.scrollLeft = a.offsetLeft - tl.clientWidth / 2; }, 0);
      }
      if (d.n < MAX_ROWS) {
        var more = el("button", "xs-more", "+ 행 100개 더");
        more.type = "button";
        more.addEventListener("click", function () { d.n = Math.min(MAX_ROWS, d.n + 100); render(); changed(); });
        foot.appendChild(more);
      }
    }

    /* --- 마우스 · 손가락 --- */
    function hit(e) {
      var cell = e.target.closest ? e.target.closest("td.xs-c, th.xs-ch, th.xs-rh, th.xs-corner") : null;
      if (!cell || !tbl || !tbl.contains(cell)) return null;
      if (cell.classList.contains("xs-corner")) return { all: true };
      if (cell.classList.contains("xs-ch")) return { col: Number(cell.getAttribute("data-c")) };
      var r = Number(cell.parentNode.getAttribute("data-r"));
      if (cell.classList.contains("xs-rh")) return { row: r };
      return { r: r, c: cell.cellIndex - 1 };
    }
    sc.addEventListener("pointerdown", function (e) { touch = e.pointerType === "touch" || e.pointerType === "pen"; }, true);
    sc.addEventListener("mousedown", function (e) {
      if (e.button !== 0 || /grip/.test(e.target.className)) return;
      var h = hit(e);
      if (!h) return;
      if (h.r != null && mode === "edit" && h.r === act.r && h.c === act.c) return; // 고치는 중: 글자 사이에 커서
      e.preventDefault();
      if (mode === "edit") commit();
      closeMenus();
      ext = null;
      if (h.all) { act = { r: 0, c: 0 }; rng = { r1: 0, c1: 0, r2: d.n - 1, c2: COLS - 1 }; paintSel(); focusCur(null, true); return; }
      if (h.col != null) { act = { r: 0, c: h.col }; rng = { r1: 0, c1: h.col, r2: d.n - 1, c2: h.col }; paintSel(); focusCur(null, true); return; }
      if (h.row != null) { act = { r: h.row, c: 0 }; rng = { r1: h.row, c1: 0, r2: h.row, c2: COLS - 1 }; paintSel(); focusCur(null, true); return; }
      if (e.shiftKey) { pick(h.r, h.c, true); focusCur(); return; }
      pick(h.r, h.c);
      if (touch) { beginEdit("end"); return; } // 휴대폰: 누르면 바로 쓰기 (키보드가 뜨게)
      focusCur();
      dragging = true;
    });
    sc.addEventListener("mouseover", function (e) {
      if (!dragging || !(e.buttons & 1)) return;
      var h = hit(e);
      if (h && h.r != null) pick(h.r, h.c, true);
    });
    document.addEventListener("mouseup", function () { dragging = false; });
    sc.addEventListener("dblclick", function (e) {
      var h = hit(e);
      if (!h || h.r == null) return;
      if (mode !== "edit") {
        pick(h.r, h.c);
        beginEdit("end");
        // 누른 곳에 커서
        var r = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
        var v = cellDiv(act.r, act.c);
        if (r && v.contains(r.startContainer)) { var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
      }
    });
    sc.addEventListener("contextmenu", function (e) {
      var h = hit(e);
      if (!h) return;
      e.preventDefault();
      if (mode === "edit") commit();
      if (h.r != null && !(h.r >= rng.r1 && h.r <= rng.r2 && h.c >= rng.c1 && h.c <= rng.c2)) pick(h.r, h.c);
      if (h.row != null && !(h.row >= rng.r1 && h.row <= rng.r2)) { act = { r: h.row, c: 0 }; rng = { r1: h.row, c1: 0, r2: h.row, c2: COLS - 1 }; paintSel(); }
      if (h.col != null && !(h.col >= rng.c1 && h.col <= rng.c2)) { act = { r: 0, c: h.col }; rng = { r1: 0, c1: h.col, r2: d.n - 1, c2: h.col }; paintSel(); }
      focusCur(null, true);
      showMenu(e.clientX, e.clientY);
    });

    // 열 너비 · 줄 높이 끌기
    sc.addEventListener("pointerdown", function (e) {
      var g = e.target;
      if (!/xs-[cr]grip/.test(g.className)) return;
      e.preventDefault();
      e.stopPropagation();
      var z = zoom() / 100, isCol = g.className === "xs-cgrip";
      var th = g.parentNode, start = isCol ? e.clientX : e.clientY;
      var idx = isCol ? Number(th.getAttribute("data-c")) : Number(th.parentNode.getAttribute("data-r"));
      var size0 = (isCol ? th.getBoundingClientRect().width : th.parentNode.getBoundingClientRect().height) / z;
      var before = snap();
      g.setPointerCapture(e.pointerId);
      g.classList.add("is-drag");
      function mv(ev) {
        var v = Math.round(size0 + ((isCol ? ev.clientX : ev.clientY) - start) / z);
        if (isCol) {
          v = Math.max(24, Math.min(1500, v));
          d.w[idx] = v;
          tbl.querySelector("colgroup").children[idx + 1].style.width = v + "px";
          var total = 46;
          for (var c = 0; c < COLS; c++) total += Number(d.w[c]) || CW;
          tbl.style.width = total + "px";
        } else {
          v = Math.max(RH, Math.min(1500, v));
          d.h[idx] = v;
          th.parentNode.style.height = v + "px";
        }
      }
      function up() {
        g.classList.remove("is-drag");
        g.removeEventListener("pointermove", mv);
        g.removeEventListener("pointerup", up);
        g.removeEventListener("pointercancel", up);
        if (before !== snap()) { remember(before); changed(); }
      }
      g.addEventListener("pointermove", mv);
      g.addEventListener("pointerup", up);
      g.addEventListener("pointercancel", up);
    });

    /* --- 글쇠 --- */
    sc.addEventListener("keydown", function (e) {
      var k = e.key, mod = e.ctrlKey || e.metaKey;
      if (e.isComposing || e.keyCode === 229) { if (mode === "sel") beginType(); return; }
      if (mode === "edit") {
        if (k === "Escape") { e.preventDefault(); cancel(); return; }
        if (k === "Enter" && (e.altKey || (mod && !e.shiftKey))) { e.preventDefault(); if (!exec("insertLineBreak")) exec("insertHTML", "<br>"); sync(); return; }
        if (k === "Enter" && !e.shiftKey && !touch) { e.preventDefault(); commit(); move(1, 0); return; }
        if (k === "Tab") { e.preventDefault(); commit(); move(0, e.shiftKey ? -1 : 1); return; }
        return;
      }
      if (mod && /^[zZ]$/.test(k)) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && /^[yY]$/.test(k)) { e.preventDefault(); redo(); return; }
      if (mod && /^[biuBIU]$/.test(k)) { e.preventDefault(); toggle(k.toLowerCase()); return; }
      if (mod && /^[aA]$/.test(k)) { e.preventDefault(); act = { r: 0, c: 0 }; rng = { r1: 0, c1: 0, r2: d.n - 1, c2: COLS - 1 }; paintSel(); focusCur(); return; }
      if (mod || e.altKey) return; // 복사 · 붙여넣기는 아래에서
      switch (k) {
        case "ArrowUp": move(-1, 0, e.shiftKey); break;
        case "ArrowDown": move(1, 0, e.shiftKey); break;
        case "ArrowLeft": move(0, -1, e.shiftKey); break;
        case "ArrowRight": move(0, 1, e.shiftKey); break;
        case "Tab": move(0, e.shiftKey ? -1 : 1); break;
        case "Enter": if (e.shiftKey) move(-1, 0); else beginEdit("end"); break;
        case "F2": beginEdit("end"); break;
        case "Delete": case "Backspace": clearRange(); break;
        case "PageDown": move(20, 0); break;
        case "PageUp": move(-20, 0); break;
        case "Home": move(0, -act.c); break;
        case "Escape": break;
        default:
          if (k.length === 1) beginType(); // 글자는 그대로 칸에 들어가요
          return;
      }
      e.preventDefault();
    });
    sc.addEventListener("input", function () { if (mode === "sel") { editSnap = editSnap || snap(); mode = "edit"; paintSel(); } sync(); });
    sc.addEventListener("paste", onPaste);
    sc.addEventListener("copy", function (e) { onCopy(e, false); });
    sc.addEventListener("cut", function (e) { onCopy(e, true); });
    document.addEventListener("selectionchange", function () { if (mode === "edit" && wrap.isConnected) showSize(); });
    // 표 밖을 누르면 고치던 칸을 마쳐요
    document.addEventListener("mousedown", function (e) { if (mode === "edit" && !wrap.contains(e.target)) commit(); });

    render();

    return {
      node: wrap,
      /** 저장할 표 (빈 칸 빼고). */
      get: function () {
        if (mode === "edit") sync();
        var out = { v: 1, n: d.n, w: {}, h: {}, c: {} };
        Object.keys(d.w).forEach(function (k) { if (Number(d.w[k]) !== CW) out.w[k] = Math.round(d.w[k]); });
        Object.keys(d.h).forEach(function (k) { if (Number(d.h[k]) > RH) out.h[k] = Math.round(d.h[k]); });
        Object.keys(d.c).forEach(function (k) {
          var x = d.c[k], y = {};
          if (x.t && textOf(x.t).trim()) y.t = x.t;
          if (x.s && Object.keys(x.s).length) y.s = x.s;
          if (y.t || y.s) out.c[k] = y;
        });
        return out;
      },
      set: function (data) { remember(); d = norm(data); mode = "sel"; render(); },
      text: function () { return Object.keys(d.c).map(function (k) { return textOf(d.c[k].t); }).join(" ").trim(); },
      /** 너무 긴 칸 이름 (한 칸 5000자) 또는 null. */
      over: function () {
        var bad = null;
        Object.keys(d.c).forEach(function (k) {
          if (!bad && textOf(d.c[k].t).length > MAXLEN) { var p = k.split(","); bad = name(Number(p[0]), Number(p[1])); }
        });
        return bad;
      },
      focus: function () { focusCur(); }
    };
  }

  window.LeeshGrid = { editor: editor, view: view, template: template, fromNote: fromNote, text: function (d) {
    return Object.keys((d && d.c) || {}).map(function (k) { return textOf(d.c[k].t); }).join(" ").trim();
  } };
})();
