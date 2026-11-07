// 레슨 사진 (원장님 2026-11-07 "사진 올리기 가능하게", 선생님 의견): 레슨 노트 · 곡·자료 시트 아래 사진 줄.
// 선생님 화면(js/teacher.js)은 올리기 · 지우기, 학생 내 폴더(js/mynotes.js)는 보기만.
// 사진은 이 기기에서 긴 쪽 1600px WebP(안 되면 JPEG)로 줄여서 비공개 보관함 lesson-photos/<수강 ID>/<이름>에 올려요.
//   LeeshPhotos.strip({ items, load(path) → Promise<url>, canEdit, onAdd(files), onDelete(item), note }) → { node, set(items), busy(text) }
//   LeeshPhotos.shrink(file) → Promise<{ blob, w, h, ext }>
(function () {
  var MAX = 1600, MAX_FILES = 30;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function decode(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: "from-image" }).catch(function () { return createImageBitmap(file); }).catch(function () { return viaImg(file); });
    }
    return viaImg(file);
  }
  function viaImg(file) {
    return new Promise(function (ok, bad) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { ok(img); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); };
      img.onerror = function () { URL.revokeObjectURL(url); bad(new Error("사진을 열 수 없어요.")); };
      img.src = url;
    });
  }
  function shrink(file) {
    return decode(file).then(function (img) {
      var w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
      var k = Math.min(1, MAX / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
      var c = document.createElement("canvas");
      c.width = cw; c.height = ch;
      var g = c.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, cw, ch);
      g.drawImage(img, 0, 0, cw, ch);
      if (img.close) img.close();
      function blobOf(type, q) { return new Promise(function (ok) { c.toBlob(ok, type, q); }); }
      return blobOf("image/webp", 0.82).then(function (b) {
        if (b && b.type === "image/webp" && b.size < 3000000) return { blob: b, w: cw, h: ch, ext: "webp" };
        return blobOf("image/jpeg", 0.82).then(function (j) {
          if (!j) throw new Error("사진을 줄이지 못했어요.");
          return { blob: j, w: cw, h: ch, ext: "jpg" };
        });
      });
    });
  }

  /** 크게 보기: 화면 가득 + 이전 · 다음 · 닫기 (+ 지우기) */
  function viewer(items, at, load, onDelete) {
    var box = el("div", "lp-view");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "사진 크게 보기");
    var img = el("img", "lp-view__img");
    img.alt = "레슨 사진";
    var bar = el("div", "lp-view__bar");
    var count = el("span", "lp-view__count");
    var prev = el("button", "lp-view__btn", "◀ 이전");
    var next = el("button", "lp-view__btn", "다음 ▶");
    var del = onDelete ? el("button", "lp-view__btn lp-view__del", "이 사진 지우기") : null;
    var close = el("button", "lp-view__btn", "닫기 ✕");
    [prev, next, close].concat(del ? [del] : []).forEach(function (b) { b.type = "button"; });
    bar.appendChild(prev); bar.appendChild(count); bar.appendChild(next);
    if (del) bar.appendChild(del);
    bar.appendChild(close);
    box.appendChild(img);
    box.appendChild(bar);
    function show() {
      var it = items[at];
      count.textContent = (at + 1) + " / " + items.length;
      prev.disabled = at === 0;
      next.disabled = at === items.length - 1;
      img.removeAttribute("src");
      load(it.path).then(function (u) { if (items[at] === it && u) img.src = u; });
    }
    function shut() { document.removeEventListener("keydown", key); box.remove(); }
    function key(e) {
      if (e.key === "Escape") shut();
      else if (e.key === "ArrowLeft" && at > 0) { at--; show(); }
      else if (e.key === "ArrowRight" && at < items.length - 1) { at++; show(); }
    }
    prev.addEventListener("click", function () { if (at > 0) { at--; show(); } });
    next.addEventListener("click", function () { if (at < items.length - 1) { at++; show(); } });
    close.addEventListener("click", shut);
    box.addEventListener("click", function (e) { if (e.target === box) shut(); });
    if (del) del.addEventListener("click", function () {
      if (!window.confirm("이 사진을 지울까요? 되돌릴 수 없어요.")) return;
      var it = items[at];
      shut();
      onDelete(it);
    });
    document.addEventListener("keydown", key);
    document.body.appendChild(box);
    show();
    close.focus();
  }

  function strip(o) {
    var wrap = el("section", "lp");
    var head = el("div", "lp__head");
    head.appendChild(el("span", "lp__title", "📷 사진"));
    var cnt = el("span", "lp__count");
    head.appendChild(cnt);
    var msg = el("span", "lp__msg");
    msg.setAttribute("role", "status");
    var input = null;
    if (o.canEdit) {
      var add = el("button", "sys-btn sys-btn--ghost lp__add", "사진 올리기");
      add.type = "button";
      input = el("input");
      input.type = "file";
      input.accept = "image/*";
      input.multiple = true;
      input.hidden = true;
      add.addEventListener("click", function () { input.click(); });
      input.addEventListener("change", function () {
        var files = Array.prototype.slice.call(input.files || []).filter(function (f) { return /^image\//.test(f.type) || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name); });
        input.value = "";
        if (files.length) o.onAdd(files);
      });
      head.appendChild(add);
      head.appendChild(input);
    }
    head.appendChild(msg);
    wrap.appendChild(head);
    var row = el("div", "lp__row");
    wrap.appendChild(row);
    if (o.note) wrap.appendChild(el("p", "lp__note", o.note));
    var items = [];
    function set(list) {
      items = list || [];
      row.textContent = "";
      cnt.textContent = items.length ? items.length + "장" : "";
      if (!items.length) { row.appendChild(el("span", "lp__empty", o.canEdit ? "악보 · 가사 · 자세 사진을 붙일 수 있어요 (휴대폰은 바로 찍기)" : "")); row.hidden = !o.canEdit; wrap.hidden = !o.canEdit; return; }
      row.hidden = false; wrap.hidden = false;
      items.forEach(function (it, i) {
        var b = el("button", "lp__thumb");
        b.type = "button";
        b.setAttribute("aria-label", "사진 " + (i + 1) + " 크게 보기");
        var im = el("img");
        im.alt = "";
        im.loading = "lazy";
        b.appendChild(im);
        o.load(it.path).then(function (u) { if (u) im.src = u; else b.classList.add("is-missing"); });
        b.addEventListener("click", function () { viewer(items, i, o.load, o.canEdit ? o.onDelete : null); });
        row.appendChild(b);
      });
    }
    set(o.items);
    return {
      node: wrap,
      set: set,
      busy: function (text, kind) { msg.textContent = text || ""; msg.className = "lp__msg" + (kind ? " is-" + kind : ""); },
      count: function () { return items.length; }
    };
  }

  window.LeeshPhotos = { strip: strip, shrink: shrink, MAX_FILES: MAX_FILES };
})();
