/* 퇴원 · 휴원 학생 (원장님 2026-11-27 "각 선생님 스프레드시트에 퇴원생 현황 탭이 오픈됐어 → 홈페이지 선생님 화면에").
   원본 = 선생님 파일 "○○ 학생현황 확인"의 '퇴원·휴원 학생' 탭. 원장님 구글 계정의 레슨 시트 가져오기 스크립트(tools/lesson_sync.gs)가
   1시간마다 읽어서 보내고(dropout_sync_push), 홈페이지는 보기만 해요. 고치는 곳은 시트 ④ 퇴원 이유 기록.
   선생님 = 자기 파일만 · 원장님(선생님 "원장님") · 관리자 = 모든 선생님(고르기). 학생 · 학부모는 못 봄. 서버 teacher_dropouts.
   LeeshDropouts.render(box, call) — call(fn, args)는 서버 결과를 돌려주는 Promise. */
(function () {
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function stamp(iso) {
    if (!iso) return "";
    var k = new Date(new Date(iso).getTime() + 9 * 3600000), h = k.getUTCHours(), mi = k.getUTCMinutes();
    return (k.getUTCMonth() + 1) + "월 " + k.getUTCDate() + "일 " + (h < 12 ? "오전 " : "오후 ") + (h % 12 || 12) + "시" + (mi ? " " + mi + "분" : "");
  }
  function md(d) { var p = String(d || "").split("-"); return p.length === 3 ? Number(p[1]) + "/" + Number(p[2]) : (d || ""); }
  function table(head, rows, cls) {
    var wrap = el("div", "dp__wrap");
    var t = el("table", "dp__tbl" + (cls ? " " + cls : ""));
    var tr = el("tr");
    head.forEach(function (h) { tr.appendChild(el("th", null, h)); });
    var th = el("thead"); th.appendChild(tr); t.appendChild(th);
    var tb = el("tbody");
    rows.forEach(function (r) { tb.appendChild(r); });
    t.appendChild(tb);
    wrap.appendChild(t);
    return wrap;
  }
  function row(cells, cls) {
    var tr = el("tr", cls || null);
    cells.forEach(function (c) {
      var td = el("td");
      if (c && c.nodeType) td.appendChild(c); else td.textContent = c == null ? "" : String(c);
      tr.appendChild(td);
    });
    return tr;
  }

  function draw(box, d, call) {
    box.textContent = "";
    var data = d.data || null;
    // 원장님 · 관리자: 선생님 고르기
    if (d.director) {
      var bar = el("div", "dp__bar");
      bar.appendChild(el("span", "rv__label", "선생님"));
      var sel = el("select", "dp__pick");
      sel.setAttribute("aria-label", "선생님 고르기");
      (d.teachers || []).forEach(function (t) {
        var o = el("option", null, t.name + " (" + t.people + "명)");
        o.value = t.id;
        if (t.id === d.teacher) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener("change", function () { render(box, call, Number(sel.value)); });
      bar.appendChild(sel);
      box.appendChild(bar);
      if (!(d.teachers || []).length) {
        box.appendChild(el("p", "book__empty", "아직 들어온 시트가 없어요. 원장님 구글 계정의 레슨 시트 가져오기 스크립트에 새 코드를 붙여넣으면 1시간 안에 들어와요."));
        return;
      }
    }
    if (!data) {
      box.appendChild(el("p", "book__empty", "아직 시트에서 들어온 내용이 없어요. 1시간마다 저절로 들어와요."));
      return;
    }
    var note = el("p", "sys-note", (d.director ? d.teacher_name + " 선생님 " : "") + "「학생현황 확인」 시트의 '퇴원·휴원 학생' 탭이에요. 시트에서 고치면 1시간 안에 여기도 바뀌어요"
      + (d.synced ? " (마지막 확인 " + stamp(d.synced) + ")" : "") + ". 학생 · 학부모에게는 보이지 않아요.");
    box.appendChild(note);
    (data.summary || []).forEach(function (s) {
      box.appendChild(el("p", /⚠/.test(s) ? "dp__warn" : "dp__sum", s));
    });

    // ① 월별 현황
    if ((data.months || []).length) {
      box.appendChild(el("h4", "dp__h", "① 월별 현황"));
      box.appendChild(table(["월", "새로 시작", "휴원", "퇴원", "퇴원한 학생"], data.months.map(function (m) {
        return row(m, m[0] === "누적" ? "dp__total" : null);
      }), "dp__months"));
      if (data.monthsNote) box.appendChild(el("p", "sys-note", data.monthsNote));
    }

    // ② 명단
    var people = data.people || [];
    box.appendChild(el("h4", "dp__h", "② 퇴원 · 휴원 학생 " + people.length + "명"));
    if (!people.length) box.appendChild(el("p", "book__empty", "퇴원 · 휴원한 학생이 없어요."));
    else {
      var list = el("div", "dp__list");
      people.forEach(function (p) {
        var c = el("div", "dp__card" + (p.status === "휴원" ? " is-rest" : ""));
        var top = el("div", "dp__top");
        top.appendChild(el("b", null, p.name));
        top.appendChild(el("span", "dp__tag" + (p.status === "휴원" ? " dp__tag--rest" : ""), p.status === "종료" ? "퇴원" : p.status));
        if (p.kind) top.appendChild(el("span", "dp__kind", p.kind));
        c.appendChild(top);
        c.appendChild(el("p", "dp__period", "수업 " + md(p.first) + " ~ " + md(p.last) + (p.count ? " · " + p.count + "회" : "")));
        if (p.reason) c.appendChild(el("p", "dp__reason", p.reason));
        else if (p.status === "종료") c.appendChild(el("p", "dp__none", "퇴원 이유 미작성 · 시트 ④에 적어 주세요"));
        list.appendChild(c);
      });
      box.appendChild(list);
    }

    // ④ 퇴원 이유 기록 (예전 퇴원정리시트 포함)
    var rec = data.records || [];
    if (rec.length) {
      var det = el("details", "dp__rec");
      det.appendChild(el("summary", null, "④ 퇴원 이유 기록 전체 " + rec.length + "줄 (예전 「퇴원정리시트」 포함)"));
      det.appendChild(table(["이름", "클래스", "나이", "기간", "퇴원 이유"], rec.map(function (r) {
        return row([r.name, r.klass, r.age, r.period, r.reason]);
      })));
      box.appendChild(det);
    }
  }

  function render(box, call, teacher) {
    box.classList.add("dp");
    box.textContent = "";
    box.appendChild(el("p", "sys-note", "불러오는 중…"));
    call("teacher_dropouts", teacher ? { p_teacher: teacher } : {}).then(function (d) {
      if (!d || !d.ok) { box.textContent = ""; box.appendChild(el("p", "sys-msg sys-msg--error", (d && d.error) || "불러오지 못했어요.")); return; }
      draw(box, d, call);
    }, function () {
      box.textContent = "";
      box.appendChild(el("p", "sys-msg sys-msg--error", "연결이 원활하지 않아요. 잠시 뒤에 다시 열어 주세요."));
    });
  }

  window.LeeshDropouts = { render: render };
})();
