// Photo scenes (home). An icon with data-scene="scene-x" grows its photo from
// the icon's spot to the whole screen, then the notes write themselves on it.
// Leaving shrinks the photo back into the icon. Tap while writing to finish.
// A link straight into a scene (for 카카오톡): index.html#notes, #evals, #me, or #scene-<name>.
(function () {
  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var current = null;

  function holeAt(el) {
    var r = el.getBoundingClientRect(), w = window.innerWidth, h = window.innerHeight;
    if (!r.width) return "inset(50% 50% 50% 50%)"; // icon not on screen: grow from the middle
    return "inset(" + Math.max(0, r.top) + "px " + Math.max(0, w - r.right) + "px " +
      Math.max(0, h - r.bottom) + "px " + Math.max(0, r.left) + "px round 2px)";
  }

  function enter(scene, icon, detail) {
    var photo = scene.querySelector(".scene__photo");
    var from = icon.querySelector(".icon__img") || icon;
    current = { scene: scene, icon: icon, from: from };
    scene.hidden = false;
    scene.classList.remove("is-done", "is-leaving");
    // restart the handwriting each time the scene opens
    scene.classList.remove("is-open");
    void scene.offsetWidth;
    scene.classList.add("is-open");
    if (!still && photo.animate) {
      photo.animate(
        [{ clipPath: holeAt(from), transform: "scale(1.18)" }, { clipPath: "inset(0px 0px 0px 0px round 0px)", transform: "scale(1)" }],
        { duration: 750, easing: "cubic-bezier(.7,0,.2,1)" });
    }
    scene.querySelector("[data-leave]").focus({ preventScroll: true });
    scene.dispatchEvent(new CustomEvent("scene:open", { detail: detail || {} }));
  }

  function leave() {
    if (!current) return;
    var c = current;
    current = null;
    var done = function () { c.scene.hidden = true; c.scene.classList.remove("is-open", "is-leaving"); c.icon.focus({ preventScroll: true }); };
    var photo = c.scene.querySelector(".scene__photo");
    if (still || !photo.animate) return done();
    c.scene.classList.add("is-leaving");
    photo.animate(
      [{ clipPath: "inset(0px 0px 0px 0px round 0px)", transform: "scale(1)" }, { clipPath: holeAt(c.from), transform: "scale(1.18)" }],
      { duration: 550, easing: "cubic-bezier(.5,0,.3,1)" }).onfinish = done;
  }

  document.addEventListener("click", function (e) {
    var icon = e.target.closest("[data-scene]");
    if (icon) {
      var scene = document.getElementById(icon.getAttribute("data-scene"));
      if (scene) { e.preventDefault(); enter(scene, icon); }
      return;
    }
    if (e.target.closest("[data-leave]")) { leave(); return; }
    var inScene = e.target.closest(".scene");
    if (inScene && !e.target.closest("a")) inScene.classList.add("is-done");
  });

  document.addEventListener("keydown", function (e) { if (e.key === "Escape") leave(); });

  // Deep links. Runs after every page script has hooked up its scene:open listener.
  var LINKS = { me: ["scene-me"], notes: ["scene-me", "notes"], evals: ["scene-me", "evals"] };
  function openFromLink() {
    var h = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (!h) return;
    var to = LINKS[h] || [h.indexOf("scene-") === 0 ? h : "scene-" + h];
    var scene = document.getElementById(to[0]);
    var icon = document.querySelector('[data-scene="' + to[0] + '"]');
    if (!scene || !icon || !scene.classList.contains("scene")) return;
    // drop the hash so closing the folder and refreshing lands on the desktop
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* sandboxed viewer */ }
    enter(scene, icon, { tab: to[1] });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", openFromLink); else setTimeout(openFromLink, 0);
})();
