// Photo scenes (home). An icon with data-scene="scene-x" grows its photo from
// the icon's spot to the whole screen, then the notes write themselves on it.
// Leaving shrinks the photo back into the icon. Tap while writing to finish.
(function () {
  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var current = null;

  function holeAt(el) {
    var r = el.getBoundingClientRect(), w = window.innerWidth, h = window.innerHeight;
    return "inset(" + Math.max(0, r.top) + "px " + Math.max(0, w - r.right) + "px " +
      Math.max(0, h - r.bottom) + "px " + Math.max(0, r.left) + "px round 2px)";
  }

  function enter(scene, icon) {
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
})();
