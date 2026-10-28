// Two round buttons at the bottom right of the long pages: back to the desktop (home) and back to the top.
// They show once the page has been scrolled a little. The desktop itself (index.html) doesn't need them.
(function () {
  if (document.querySelector(".icons")) return;
  var box = document.createElement("div");
  box.className = "pagenav";
  box.innerHTML =
    '<a class="pagenav__btn" href="index.html" title="홈으로" aria-label="홈으로">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5M5.5 9.8V20h4.8v-5.5h3.4V20h4.8V9.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
    '<span>home</span></a>' +
    '<button class="pagenav__btn" type="button" title="맨 위로" aria-label="맨 위로">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
    '<span>top</span></button>';
  document.body.appendChild(box);
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  box.querySelector("button").addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  });
  function update() {
    box.classList.toggle("is-on", window.scrollY > 300);
    // the preview's 체험 모드 bar sits at the bottom too: stay above it
    var bar = document.querySelector(".demo-bar");
    box.style.bottom = bar ? (window.innerHeight - bar.getBoundingClientRect().top + 12) + "px" : "";
  }
  window.addEventListener("scroll", update, { passive: true });
  update();
})();
