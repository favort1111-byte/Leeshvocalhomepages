// Home desktop: when the academy has posted 오디션 소식 (admin page or Instagram) the visitor hasn't seen yet (last 14 days),
// the audition.jpg icon gets a red dot and a little wiggle — like an app with a notification.
// Opening audition.html marks it seen (js/auditions.js).
(function () {
  if (!window.LeeshAPI || !LeeshAPI.enabled()) return;
  var icon = document.querySelector('.icons a.icon[href="audition.html"]');
  if (!icon) return;
  var seen = 0;
  try { seen = Number(localStorage.getItem("leesh_news_seen")) || 0; } catch (e) { /* private mode */ }
  // the newest of the director's own posts and the academy Instagram's posts
  function newest(path, field) {
    return LeeshAPI.request(path, { headers: LeeshAPI.headers() }).then(function (res) {
      var p = res.ok && Array.isArray(res.data) && res.data[0];
      return p ? new Date(p[field]).getTime() : 0;
    });
  }
  Promise.all([
    newest("/rest/v1/audition_news?select=created_at&published=eq.true&order=created_at.desc&limit=1", "created_at"),
    newest("/rest/v1/ig_posts?select=posted_at&kind=in.(%EB%82%B4%EB%B0%A9,%EC%98%A4%EB%94%94%EC%85%98,%ED%95%A9%EA%B2%A9)&order=posted_at.desc&limit=1", "posted_at")
  ]).then(function (t) {
    var at = Math.max(t[0], t[1]);
    if (!at) return;
    if (at > seen && Date.now() - at < 14 * 86400000) {
      icon.classList.add("icon--new");
      icon.setAttribute("title", (icon.getAttribute("title") || "") + " · 새 소식");
    }
  });
})();
