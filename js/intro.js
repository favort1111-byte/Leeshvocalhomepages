// The screen switching on (index.html, first visit only). The whole animation is CSS (.boot in
// css/style.css) so it ends by itself even without JS; this only decides to skip it:
// seen before on this device, opened from a link (#notes…), "reduce motion", or a tap.
(function () {
  var boot = document.getElementById("boot");
  if (!boot) return;
  var KEY = "leesh_intro";
  var seen = false;
  try { seen = !!localStorage.getItem(KEY); localStorage.setItem(KEY, "1"); } catch (e) { /* private mode: play it */ }
  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  // removing it also drops the icons' pop-in (css: .boot ~ .icons), so the desktop is simply there
  function skip() { if (boot.parentNode) boot.parentNode.removeChild(boot); }
  if (seen || still || location.hash) { skip(); return; }
  boot.addEventListener("click", skip);
  document.addEventListener("keydown", function once(e) {
    document.removeEventListener("keydown", once);
    if (getComputedStyle(boot).visibility !== "hidden") skip();
  });
})();
