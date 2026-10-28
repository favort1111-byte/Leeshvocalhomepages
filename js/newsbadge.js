// Home desktop: when the academy has posted 오디션 소식 the visitor hasn't seen yet (last 14 days),
// the audition.jpg icon gets a red dot and a little wiggle — like an app with a notification.
// Opening audition.html marks it seen (js/auditions.js).
(function () {
  if (!window.LeeshAPI || !LeeshAPI.enabled()) return;
  var icon = document.querySelector('.icons a.icon[href="audition.html"]');
  if (!icon) return;
  var seen = 0;
  try { seen = Number(localStorage.getItem("leesh_news_seen")) || 0; } catch (e) { /* private mode */ }
  LeeshAPI.request("/rest/v1/audition_news?select=created_at&published=eq.true&order=created_at.desc&limit=1", {
    headers: LeeshAPI.headers()
  }).then(function (res) {
    var p = res.ok && Array.isArray(res.data) && res.data[0];
    if (!p) return;
    var at = new Date(p.created_at).getTime();
    if (at > seen && Date.now() - at < 14 * 86400000) {
      icon.classList.add("icon--new");
      icon.setAttribute("title", (icon.getAttribute("title") || "") + " · 새 소식");
    }
  });
})();
