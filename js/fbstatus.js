/* 원장님 컨설팅 신청 현황 (원장님 2026-11-16 "전체 인원 대비 누가 신청했고 누가 미신청했는지, 원장님 선생님 화면 · 관리자 둘 다")
   심화반 명단 한 명 한 명이 그 달 컨설팅 시간에 신청했는지 보여줘요. 일반 학생 신청(2026-11-17~)도 아래에 같은 줄 모양 + 결과 쓰기. 서버 director_feedback (관리자 · 선생님 "원장님"만).
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
      // 일반 학생(심화반 명단 밖) 신청을 학생별로 묶어 심화반과 같은 줄 모양으로 (원장님 2026-11-17 "일반 학생도 결과 쓰기")
      var gen = [], genBy = {};
      (d.others || []).forEach(function (o) {
        var g = genBy[o.member];
        if (!g) { g = genBy[o.member] = { member: o.member, name: o.name, teacher: o.teacher, status: o.status, kakao: true, bookings: [] }; gen.push(g); }
        g.bookings.push(o);
      });

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

      // 맨 위 숫자 (원장님 2026-11-18 "헷갈려요 → 심화반 몇 명 + 일반 학생 몇 명 = 총 결과로"): 총 신청 = 심화반 + 일반, 그 밑에 심화반 미신청 · 남은 시간
      var total = yes.length + gen.length, taken = 0;
      yes.concat(gen).forEach(function (m) { taken += (m.bookings || []).length; });
      var sum = el("div", "fbs__sum");
      var t = el("span", "fbs__num fbs__num--total"); t.appendChild(document.createTextNode("총 신청 ")); t.appendChild(el("b", null, String(total))); t.appendChild(document.createTextNode("명"));
      sum.appendChild(t);
      sum.appendChild(el("span", "fbs__eq", "="));
      var a = el("span", "fbs__num fbs__num--yes"); a.appendChild(document.createTextNode("심화반 ")); a.appendChild(el("b", null, String(yes.length))); a.appendChild(document.createTextNode("명"));
      sum.appendChild(a);
      sum.appendChild(el("span", "fbs__eq", "+"));
      var g = el("span", "fbs__num fbs__num--gen"); g.appendChild(document.createTextNode("일반 학생 ")); g.appendChild(el("b", null, String(gen.length))); g.appendChild(document.createTextNode("명"));
      sum.appendChild(g);
      box.appendChild(sum);
      if (ms.length) {
        var adv = el("p", "fbs__line");
        adv.appendChild(document.createTextNode("심화반 " + ms.length + "명 중 "));
        adv.appendChild(el("b", "fbs__ok", yes.length + "명 신청"));
        adv.appendChild(document.createTextNode(" · "));
        adv.appendChild(el("b", no.length ? "fbs__bad" : "fbs__ok", no.length ? no.length + "명 미신청" : "모두 신청"));
        box.appendChild(adv);
        var bar = el("div", "fbs__bar");
        var fill = el("i");
        fill.style.width = Math.round(yes.length * 100 / ms.length) + "%";
        bar.appendChild(fill);
        box.appendChild(bar);
      }
      if (d.slots) box.appendChild(el("p", "fbs__line", "컨설팅 시간 " + d.slots + "개 중 " + taken + "개 신청됨 · " + Math.max(0, d.slots - taken) + "개 남음"));
      if (d.until) box.appendChild(el("p", "sys-note", "신청 마감 " + stamp(d.until) + (new Date(d.until).getTime() < Date.now() ? " (지났어요 · 학생은 이제 신청 · 취소를 못 해요)" : "")));

      function list(label, rows, yesList, empty) {
        var sec = el("div", "fbs__sec");
        sec.appendChild(el("p", "fbs__label", label + " " + rows.length + "명"));
        if (!rows.length) { sec.appendChild(el("p", "sys-note", empty || (yesList ? "아직 신청한 학생이 없어요." : "모두 신청했어요 🎉"))); return sec; }
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
      cols.appendChild(list("✅ 심화반 신청", yes, true));
      cols.appendChild(list("⏳ 심화반 미신청", no, false));
      box.appendChild(cols);

      if (gen.length) box.appendChild(list("🙋 일반 학생 신청", gen, true));
      if (!(d.slots || 0) && !ms.length) box.appendChild(el("p", "sys-note", "심화반 명단과 컨설팅 시간이 아직 없어요."));

      // 표로 복사 (원장님 2026-11-18 "심화반 말고 다른 친구들도"): 전체 · 심화반만 · 일반 학생만 따로
      function copyBtn(label, rows) {
        var cp = el("button", "sys-btn sys-btn--ghost fbs__copy", label);
        cp.type = "button";
        cp.addEventListener("click", function () {
          var lines = [["이름", "수강 ID", "반", "담당", "신청", "컨설팅 시간", "종류", "남긴 말"].join("\t")];
          rows.forEach(function (m) {
            var bk = m.bookings || [];
            lines.push([m.name, m.member, m.track ? klass(m) : "일반", m.teacher || "", bk.length ? "신청" : "미신청",
              bk.map(function (x) { return x.when; }).join(", "), bk.map(function (x) { return x.kind || ""; }).join(", "),
              bk.map(function (x) { return String(x.note || "").replace(/\s+/g, " "); }).filter(Boolean).join(" / ")].join("\t"));
          });
          copyText(lines.join("\n"), cp);
        });
        return cp;
      }
      var copies = el("div", "fbs__copies");
      copies.appendChild(el("span", "fbs__copylabel", "표로 복사 (구글시트에 붙여넣기)"));
      copies.appendChild(copyBtn("전체 (심화반 + 일반 학생)", yes.concat(no).concat(gen)));
      copies.appendChild(copyBtn("심화반만", yes.concat(no)));
      if (gen.length) copies.appendChild(copyBtn("일반 학생만", gen));
      box.appendChild(copies);
    }, function () {
      box.textContent = "";
      box.appendChild(el("p", "sys-msg sys-msg--error", "불러오지 못했어요. 잠시 뒤 다시 열어 주세요."));
    });
  }
  window.LeeshFbStatus = { render: render };
})();
