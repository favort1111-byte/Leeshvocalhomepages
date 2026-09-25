// Fills page text from the 콘텐츠 sheet. Any theme can opt in by marking elements:
//   <h1 data-content="contact.title">기본 문구</h1>       → replaced by the sheet value
//   <ul data-list="results" data-group="입시">             → one clone of the <template> per row
//     <template><li><span data-field="text"></span></li></template>
//   </ul>
// The text already in the HTML stays as the fallback when the sheet can't be reached.
(function () {
  if (!window.LeeshAPI || !LeeshAPI.enabled()) return;

  function setText(el, value) {
    el.textContent = "";
    String(value).split("\n").forEach(function (line, i) {
      if (i) el.appendChild(document.createElement("br"));
      el.appendChild(document.createTextNode(line));
    });
  }

  LeeshAPI.get("content").then(function (res) {
    if (!res.ok) return;
    var content = res.content || {};
    document.querySelectorAll("[data-content]").forEach(function (el) {
      var v = content[el.getAttribute("data-content")];
      if (v) setText(el, v);
    });

    var lists = res.lists || {};
    document.querySelectorAll("[data-list]").forEach(function (host) {
      var tpl = host.querySelector("template");
      var rows = lists[host.getAttribute("data-list")];
      if (!tpl || !Array.isArray(rows)) return;
      var group = host.getAttribute("data-group");
      Array.prototype.slice.call(host.children).forEach(function (c) { if (c !== tpl) host.removeChild(c); });
      rows.filter(function (r) { return !group || r.group === group; }).forEach(function (row) {
        var node = tpl.content.cloneNode(true);
        node.querySelectorAll("[data-field]").forEach(function (f) {
          var v = row[f.getAttribute("data-field")];
          setText(f, v == null ? "" : v);
        });
        host.appendChild(node);
      });
    });
  });
})();
