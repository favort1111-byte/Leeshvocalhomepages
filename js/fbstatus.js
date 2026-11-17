/* 원장님 컨설팅 신청 현황 (원장님 2026-11-16 "전체 인원 대비 누가 신청했고 누가 미신청했는지, 원장님 선생님 화면 · 관리자 둘 다")
   심화반 명단 한 명 한 명이 그 달 컨설팅 시간에 신청했는지 보여줘요. 서버 director_feedback (관리자 · 선생님 "원장님"만).
   LeeshFbStatus.render(box, load, month, call) — load(month) 는 서버 결과({ ok, month, months, members, ... })를 돌려주는 Promise.
   call(fn, args) 를 주면 신청한 학생마다 "결과 쓰기 / 결과 고치기" (js/consultnote.js, 2026-11-16). */
(function () {
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function monthName(m) { var p = String(m || "").split("-"); return p.length === 2 ? Number(p[1]) + "월" : m; }
  function stamp(iso) {
    var k = new Date(new Date(iso).getTime() + 9 * 3600000), h = k.getUTCHours(), mi = k.getUTCMinutes();
    return (k.getUTCMonth() + 1) + "월 " + k.getUTCDate() + "일 " + (h < 12 ? "오전 " : "오후 ") + (h % 12 || 12) + "시" + (mi ? " " + mi + "분" : "");
  }
  function klass(m) { return [m.track, m.slot ? m.slot + "타임" : ""].filter(Boolean).join(" "); }
  function copyText(text, btn) {
    function done(ok) { var t = btn.textContent; btn.textContent = ok ? "복사했어요 ✓" : "복사가 안 됐어요"; setTimeout(function () { btn.textContent = t; }, 1600); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    else {
      var ta = el("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      ta.remove();
      done(ok);
    }
  }

  function render(box, load, month, call) {
    box.textContent = "";
    box.classList.add("fbs");
    box.appendChild(el("p", "sys-note", "불러오는 중…"));
    load(month || null).then(function (d) {
      box.textContent = "";
      if (!d || !d.ok) { box.appendChild(el("p", "sys-msg sys-msg--error", (d && d.error) || "불러오지 못했어요.")); return; }
      var ms = d.members || [], yes = ms.filter(function (m) { return (m.bookings || []).length; }), no = ms.filter(function (m) { return !(m.bookings || []).length; });

      var head = el("div", "fbs__head");
      var title = el("strong", "fbs__title", "📋 " + monthName(d.month) + " 컨설팅 신청 현황");
      head.appendChild(title);
      if ((d.months || []).length > 1) {
        var sel = el("select", "fbs__month");
        sel.setAttribute("aria-label", "컨설팅 달 고르기");
        d.months.forEach(function (m) { var o = el("option", null, m.replace("-", "년 ") + "월"); o.value = m; if (m === d.month) o.selected = true; sel.appendChild(o); });
        sel.addEventListener("change", function () { render(box, load, sel.value, call); });
        head.appendChild(sel);
      }
      var again = el("button", "sys-link fbs__reload", "새로 고침");
      again.type = "button";
      again.addEventListener("click", function () { render(box, load, d.month, call); });
      head.appendChild(again);
      box.appendChild(head);

      var sum = el("div", "fbs__sum");
      var a = el("span", "fbs__num fbs__num--yes"); a.appendChild(el("b", null, String(yes.length))); a.appendChild(document.createTextNode(" 신청"));
      var b = el("span", "fbs__num fbs__num--no"); b.appendChild(el("b", null, String(no.length))); b.appendChild(document.createTextNode(" 미신청"));
      sum.appendChild(a);
      sum.appendChild(b);
      sum.appendChild(el("span", "fbs__of", "심화반 " + ms.length + "명 · 컨설팅 시간 " + (d.slots || 0) + "개"));
      box.appendChild(sum);
      if (ms.length) {
        var bar = el("div", "fbs__bar");
        var fill = el("i");
        fill.style.width = Math.round(yes.length * 100 / ms.length) + "%";
        bar.appendChild(fill);
        box.appendChild(bar);
      }
      if (d.until) box.appendChild(el("p", "sys-note", "신청 마감 " + stamp(d.until) + (new Date(d.until).getTime() < Date.now() ? " (지났어요 · 학생은 이제 신청 · 취소를 못 해요)" : "")));

      function list(label, rows, yesList) {
        var sec = el("div", "fbs__sec");
        sec.appendChild(el("p", "fbs__label", label + " " + rows.length + "명"));
        if (!rows.length) { sec.appendChild(el("p", "sys-note", yesList ? "아직 신청한 학생이 없어요." : "모두 신청했어요 🎉")); return sec; }
        var ul = el("ul", "fbs__list");
        rows.forEach(function (m) {
          var li = el("li", "fbs__row" + (yesList ? " is-yes" : " is-no"));
          var who = el("div", "fbs__who");
          who.appendChild(el("b", null, m.name || m.member));
          who.appendChild(el("span", null, [klass(m), m.teacher ? "담당 " + m.teacher : ""].filter(Boolean).join(" · ")));
          if (m.status && m.status !== "재원") who.appendChild(el("em", "fbs__tag", m.status));
          if (!m.kakao) who.appendChild(el("em", "fbs__tag", "카카오 연결 전"));
          li.appendChild(who);
          if (yesList) {
            var when = el("div", "fbs__when");
            var pad = el("div", "fbs__pad");
            m.bookings.forEach(function (x) {
              var t = el("span", x.past ? "is-past" : null, "🎤 " + x.when + " · " + (x.kind || "보컬") + (x.past ? " (지남)" : ""));
              when.appendChild(t);
              if (x.note) when.appendChild(el("small", null, "남긴 말: " + x.note));
              if (call && window.LeeshConsultNote && x.id) {
                var w = el("button", "sys-link fbs__write", x.result ? "📝 결과 보기 · 고치기" : "✍️ 결과 쓰기");
                w.type = "button";
                w.addEventListener("click", function () {
                  var done = function (changed) { pad.textContent = ""; if (changed) render(box, load, d.month, call); };
                  if (!x.result) { LeeshConsultNote.edit(pad, { call: call, member: m.member, name: m.name, booking: x, onDone: done }); return; }
                  pad.textContent = "불러오는 중…";
                  call("consult_notes_of", { p_member: m.member }).then(function (r) {
                    var n = r && r.ok && (r.items || []).filter(function (y) { return y.id === x.result; })[0];
                    if (!n) { pad.textContent = (r && r.error) || "결과를 찾지 못했어요."; return; }
                    LeeshConsultNote.edit(pad, { call: call, member: m.member, name: m.name, note: n, booking: x, onDone: done });
                  });
                });
                when.appendChild(w);
              }
            });
            li.appendChild(when);
            li.appendChild(pad);
          }
          ul.appendChild(li);
        });
        sec.appendChild(ul);
        return sec;
      }
      var cols = el("div", "fbs__cols");
      cols.appendChild(list("✅ 신청함", yes, true));
      cols.appendChild(list("⏳ 미신청", no, false));
      box.appendChild(cols);

      (d.others || []).forEach(function (o) { box.appendChild(el("p", "sys-note", "일반 학생 신청: " + (o.name || o.member) + " · " + o.when + " · " + (o.kind || ""))); });
      if (!(d.slots || 0) && !ms.length) box.appendChild(el("p", "sys-note", "심화반 명단과 컨설팅 시간이 아직 없어요."));

      var cp = el("button", "sys-btn sys-btn--ghost fbs__copy", "표로 복사 (구글시트에 붙여넣기)");
      cp.type = "button";
      cp.addEventListener("click", function () {
        var lines = [["이름", "수강 ID", "반", "담당", "신청", "컨설팅 시간", "종류"].join("\t")];
        yes.concat(no).forEach(function (m) {
          var bk = m.bookings || [];
          lines.push([m.name, m.member, klass(m), m.teacher || "", bk.length ? "신청" : "미신청",
            bk.map(function (x) { return x.when; }).join(", "), bk.map(function (x) { return x.kind || ""; }).join(", ")].join("\t"));
        });
        copyText(lines.join("\n"), cp);
      });
      box.appendChild(cp);
    }, function () {
      box.textContent = "";
      box.appendChild(el("p", "sys-msg sys-msg--error", "불러오지 못했어요. 잠시 뒤 다시 열어 주세요."));
    });
  }
  window.LeeshFbStatus = { render: render };
})();
