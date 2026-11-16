/* 원장님 컨설팅 결과 쓰기 (원장님 2026-11-16 "원장님 홈페이지에서 컨설팅 내용을 기입, 메모장이든 레슨시트든")
   컨설팅 한 번 = 레슨 시트와 같은 표 한 장 (js/grid.js). 쓰기 · 고치기 · 지우기 = 원장님 · 관리자, 보기 = + 그 학생 담당 선생님.
   서버 consult_notes_of · consult_note_save · consult_note_delete.
   call(fn, args) 는 서버 결과({ ok, ... })를 돌려주는 Promise (선생님 화면 · 관리자 화면이 각자 넘겨줌). */
(function () {
  var FIELDS = [["a", "컨설팅 일시 · 종류"], ["b", "현재 상태 · 고민"], ["c", "노래 체크"], ["d", "피드백"], ["e", "다음 목표 · 숙제"], ["f", "담당 선생님 전달"]];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function btn(text, cls) { var b = el("button", cls || "sys-btn sys-btn--ghost", text); b.type = "button"; return b; }
  function today() { var k = new Date(Date.now() + 9 * 3600000); return k.toISOString().slice(0, 10); }
  function dayOf(iso) { return iso ? new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(0, 10) : today(); }
  function dayText(d) {
    var p = String(d || "").split("-"), wd = ["일", "월", "화", "수", "목", "금", "토"];
    if (p.length !== 3) return d || "";
    return Number(p[1]) + "월 " + Number(p[2]) + "일(" + wd[new Date(Date.UTC(+p[0], p[1] - 1, +p[2])).getUTCDay()] + ")";
  }
  function hm(iso) { var k = new Date(new Date(iso || Date.now()).getTime() + 9 * 3600000); return k.getUTCHours() + ":" + String(k.getUTCMinutes()).padStart(2, "0"); }
  function twice(b, label, run) {
    b.addEventListener("click", function () {
      if (b.getAttribute("data-armed") !== "1") { b.setAttribute("data-armed", "1"); b.textContent = label; return; }
      b.disabled = true;
      run();
    });
  }
  function starter(booking) {
    var d = window.LeeshGrid.template(FIELDS);
    if (booking && booking.when) d.c["0,1"] = { t: booking.when + (booking.kind ? " · " + booking.kind + " 컨설팅" : "") };
    return d;
  }

  /** 표 한 장 쓰기 · 고치기. opts: call, member, name, note({id, day, sheet}), booking({id, when, kind, at}), onDone(changed) */
  function edit(box, opts) {
    box.textContent = "";
    var wrap = el("div", "cn__edit");
    var head = el("div", "cn__head");
    head.appendChild(el("strong", null, "✍️ " + (opts.name || "") + " 컨설팅 결과" + (opts.note && opts.note.id ? " 고치기" : " 쓰기")));
    var dl = el("label", "cn__day");
    dl.appendChild(el("span", null, "날짜 "));
    var day = el("input");
    day.type = "date";
    day.value = (opts.note && opts.note.day) || (opts.booking && dayOf(opts.booking.at)) || today();
    dl.appendChild(day);
    head.appendChild(dl);
    wrap.appendChild(head);
    wrap.appendChild(el("p", "sys-note", "레슨 시트처럼 칸에 바로 쓰면 돼요. 쓰고 2초 뒤 저절로 저장돼요. 원장님 · 관리자 · 그 학생 담당 선생님만 보고, 학생 · 학부모에게는 안 보여요."));
    var grid = window.LeeshGrid.editor({ data: (opts.note && opts.note.sheet) || starter(opts.booking), onInput: function () { later(); } });
    wrap.appendChild(grid.node);
    var acts = el("div", "cn__acts");
    var save = btn("저장", "sys-btn"), close = btn("닫기"), state = el("span", "sys-note cn__state");
    acts.appendChild(save);
    acts.appendChild(close);
    acts.appendChild(state);
    wrap.appendChild(acts);
    box.appendChild(wrap);

    var id = opts.note && opts.note.id, timer = null, busy = false, again = false, changed = false, dirty = false;
    function later() { dirty = true; state.textContent = "고치는 중…"; clearTimeout(timer); timer = setTimeout(run, 2000); }
    function run() {
      clearTimeout(timer);
      if (busy) { again = true; return Promise.resolve(); }
      if (!dirty && id) return Promise.resolve();
      var bad = grid.over();
      if (bad) { state.textContent = bad + " 칸 글이 너무 길어요 (한 칸 5000자까지)."; return Promise.resolve(); }
      busy = true;
      dirty = false;
      state.textContent = "저장하는 중…";
      return opts.call("consult_note_save", { p_id: id || null, p_member: opts.member, p_booking: (opts.booking && opts.booking.id) || null, p_day: day.value || today(), p_sheet: grid.get() })
        .then(function (r) {
          busy = false;
          if (!r || !r.ok) { dirty = true; state.textContent = (r && r.error) || "저장하지 못했어요. 잠시 뒤 다시 눌러 주세요."; return; }
          id = r.id;
          changed = true;
          state.textContent = "저장됨 " + hm();
          if (again) { again = false; run(); }
        }, function () { busy = false; dirty = true; state.textContent = "연결이 원활하지 않아요. 잠시 뒤 다시 눌러 주세요."; });
    }
    day.addEventListener("change", function () { dirty = true; run(); });
    save.addEventListener("click", function () { dirty = true; run(); });
    close.addEventListener("click", function () {
      var p = dirty ? run() : Promise.resolve();
      p.then(function () { if (!dirty && opts.onDone) opts.onDone(changed); });
    });
    if (id) {
      var del = btn("이 기록 지우기", "sys-link cn__del");
      twice(del, "한 번 더 누르면 지워요", function () {
        opts.call("consult_note_delete", { p_id: id }).then(function (r) {
          if (r && r.ok) { if (opts.onDone) opts.onDone(true); } else state.textContent = (r && r.error) || "지우지 못했어요.";
        });
      });
      acts.appendChild(del);
    }
    // 화면을 떠날 때 저장 안 한 내용이 있으면 저장
    window.addEventListener("pagehide", function () { if (dirty) run(); });
    return { flush: run };
  }

  /** 학생 한 명의 홈페이지 컨설팅 결과 목록 (+ 원장님 · 관리자는 새로 쓰기 · 고치기) */
  function list(box, opts) {
    box.textContent = "";
    box.classList.add("cn");
    box.appendChild(el("p", "sys-note", "컨설팅 결과 불러오는 중…"));
    opts.call("consult_notes_of", { p_member: opts.member }).then(function (r) {
      box.textContent = "";
      if (!r || !r.ok) { if (r && r.error) box.appendChild(el("p", "sys-note", r.error)); return; }
      var items = r.items || [], name = opts.name || r.name || "";
      var head = el("div", "cn__head");
      head.appendChild(el("strong", null, "✍️ 홈페이지 컨설팅 결과 " + items.length + "개"));
      box.appendChild(head);
      var pad = el("div", "cn__pad");
      if (r.write) {
        var add = btn("+ 새 컨설팅 결과 쓰기", "sys-btn sys-btn--ghost cn__add");
        add.addEventListener("click", function () { edit(pad, { call: opts.call, member: opts.member, name: name, onDone: function () { list(box, opts); } }); });
        head.appendChild(add);
      }
      box.appendChild(pad);
      if (!items.length) box.appendChild(el("p", "sys-note", r.write ? "아직 홈페이지에 쓴 결과가 없어요. 위 버튼으로 바로 쓸 수 있어요." : "아직 홈페이지에 쓴 결과가 없어요."));
      items.forEach(function (n, i) {
        var card = el("article", "cn__card");
        var h = el("p", "cn__cardhead");
        h.appendChild(el("b", null, dayText(n.day) + (n.when ? " · " + n.when.replace(/^\d+월 \d+일\([^)]*\) /, "") : "") + (n.kind ? " · " + n.kind : "")));
        if (i === 0) h.appendChild(el("span", "rv__tag", "가장 최근"));
        if (r.write) {
          var fix = btn("고치기", "sys-link");
          fix.addEventListener("click", function () { edit(card, { call: opts.call, member: opts.member, name: name, note: n, booking: n.booking ? { id: n.booking } : null, onDone: function () { list(box, opts); } }); });
          h.appendChild(fix);
        }
        card.appendChild(h);
        card.appendChild(window.LeeshGrid.view(n.sheet));
        box.appendChild(card);
      });
    }, function () { box.textContent = ""; });
  }

  window.LeeshConsultNote = { edit: edit, list: list };
})();
