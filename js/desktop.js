// Desktop icons that open in-page windows (home). An icon with
// data-window="win-x" opens <section id="win-x" class="win">; windows can be
// dragged by the title bar, stack in click order, and close with the box or Esc.
(function () {
  var z = 40;
  var opener = {};

  function front(win) { win.style.zIndex = String(++z); }

  function open(id, from) {
    var win = document.getElementById(id);
    if (!win) return;
    var first = win.hidden;
    win.hidden = false;
    front(win);
    if (first && !win.dataset.placed && window.innerWidth > 760) {
      // Cascade new windows a little so several can be open at once.
      var n = document.querySelectorAll(".win:not([hidden])").length - 1;
      win.style.left = Math.max(16, (window.innerWidth - win.offsetWidth) / 2 + n * 28) + "px";
      win.style.top = Math.max(96, window.innerHeight * 0.16 + n * 28) + "px";
      win.dataset.placed = "1";
    }
    opener[id] = from || null;
    var close = win.querySelector("[data-close]");
    if (close) close.focus({ preventScroll: true });
  }

  function close(win) {
    win.hidden = true;
    var from = opener[win.id];
    if (from) from.focus({ preventScroll: true });
    if (location.hash === "#" + win.id) history.replaceState(null, "", location.pathname);
  }

  document.addEventListener("click", function (e) {
    var icon = e.target.closest("[data-window]");
    if (icon) { e.preventDefault(); open(icon.getAttribute("data-window"), icon); return; }
    var box = e.target.closest("[data-close]");
    if (box) { close(box.closest(".win")); return; }
    var win = e.target.closest(".win");
    if (win) front(win);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var top = null;
    document.querySelectorAll(".win:not([hidden])").forEach(function (w) {
      if (!top || +w.style.zIndex > +top.style.zIndex) top = w;
    });
    if (top) close(top);
  });

  // Drag by the title bar (desktop sizes only; phones get a fixed sheet).
  document.querySelectorAll(".win [data-drag]").forEach(function (bar) {
    var win = bar.closest(".win");
    bar.addEventListener("pointerdown", function (e) {
      if (e.target.closest("[data-close]") || window.innerWidth <= 760) return;
      front(win);
      var sx = e.clientX - win.offsetLeft, sy = e.clientY - win.offsetTop;
      bar.setPointerCapture(e.pointerId);
      function move(ev) {
        var x = Math.min(Math.max(ev.clientX - sx, 8 - win.offsetWidth + 80), window.innerWidth - 80);
        var y = Math.min(Math.max(ev.clientY - sy, 8), window.innerHeight - 40);
        win.style.left = x + "px";
        win.style.top = y + "px";
      }
      function up() {
        bar.removeEventListener("pointermove", move);
        bar.removeEventListener("pointerup", up);
      }
      bar.addEventListener("pointermove", move);
      bar.addEventListener("pointerup", up);
    });
  });

  if (/^#win-/.test(location.hash)) open(location.hash.slice(1), null);
})();
