// Student sign-in, shared by 연습실 예약 (booking.js) and 내 폴더 (mynotes.js).
//   1. 카카오로 로그인 — the usual way. The first time, the student says who they are and the
//      director approves the link in the admin page; after that one tap (and the session stays).
//   2. 수강 ID + 비밀번호 — tucked away. 0000 is a temporary PIN that must be changed first.
// LeeshSignIn.mount(box, { title, lede, onSignedIn(res, who) }) → { start(), signOut(), note(text) }
// who = { id, key, kakao } where key is the stay-signed-in token ('' for Kakao).
(function () {
  var cfg = window.LEESH || {};
  var TEACHERS = cfg.teachers || [];
  var KAKAO_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3C6.5 3 2 6.6 2 11c0 2.8 1.9 5.3 4.7 6.7l-1 3.6c-.1.3.3.6.6.4l4.3-2.8c.5.1 1 .1 1.4.1 5.5 0 10-3.6 10-8S17.5 3 12 3z" fill="currentColor"/></svg>';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function msgEl(box) { return box.querySelector(".signin__msg"); }
  function say(box, text, kind) {
    var m = msgEl(box);
    if (!m) return;
    m.textContent = text || "";
    m.className = "sys-msg signin__msg" + (kind ? " sys-msg--" + kind : "");
  }
  function input(name, label, attrs) {
    var l = el("label", "sys-field");
    l.appendChild(el("span", null, label));
    var i = el("input");
    i.name = name;
    Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); });
    l.appendChild(i);
    return l;
  }
  function pinInput(name, label) {
    return input(name, label, { type: "password", inputmode: "numeric", pattern: "[0-9]{4}", maxlength: "4", autocomplete: name === "pin" ? "current-password" : "new-password", required: "" });
  }
  function button(text, cls, type) {
    var b = el("button", cls || "sys-btn", text);
    b.type = type || "button";
    return b;
  }

  function mount(box, opts) {
    var keep = true;

    function done(res, who) {
      say(box, "");
      opts.onSignedIn(res, who);
    }
    function head() {
      box.textContent = "";
      if (opts.title) box.appendChild(el("h2", opts.titleClass || "sys-h", opts.title));
      if (opts.lede) box.appendChild(el("p", opts.ledeClass || "sys-note", opts.lede));
    }

    /* ---------- the first screen ---------- */
    function choose(note, kind) {
      head();
      var kakaoOk = LeeshAPI.kakao && LeeshAPI.kakao.available();
      if (kakaoOk) {
        var k = button("", "signin__kakao");
        k.innerHTML = KAKAO_ICON + "<span>카카오로 로그인</span>";
        k.addEventListener("click", function () { k.disabled = true; LeeshAPI.kakao.start(); });
        box.appendChild(k);
        box.appendChild(el("p", "sys-note signin__hint", "처음이면 카카오로 로그인한 뒤 이름을 알려주세요. 원장님이 확인하면 바로 쓸 수 있어요."));
      }
      var alt = el("details", "signin__alt");
      if (!kakaoOk) alt.open = true;
      alt.appendChild(el("summary", null, "수강 ID로 로그인"));
      var f = el("form", "signin__form");
      var row = el("div", "sys-row");
      row.appendChild(input("memberId", "수강 ID", { autocomplete: "username", autocapitalize: "characters", spellcheck: "false", required: "" }));
      row.appendChild(pinInput("pin", "비밀번호 4자리"));
      f.appendChild(row);
      var kl = el("label", "sys-keep");
      var kc = el("input");
      kc.type = "checkbox"; kc.name = "keep"; kc.checked = true;
      kl.appendChild(kc);
      kl.appendChild(document.createTextNode(" 이 기기에서 로그인 유지"));
      f.appendChild(kl);
      var sb = button("로그인", "sys-btn", "submit");
      f.appendChild(sb);
      f.appendChild(el("p", "sys-note", "처음 받은 비밀번호가 0000이면 로그인한 뒤 내 비밀번호로 바꿔요. 잊었으면 학원에 문의해주세요."));
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        keep = kc.checked;
        sb.disabled = true;
        say(box, "확인 중…");
        var id = f.querySelector("[name=memberId]").value.trim(), pin = f.querySelector("[name=pin]").value.trim();
        LeeshAPI.rpc("member_login", { p_id: id, p_pin: pin }).then(function (res) {
          sb.disabled = false;
          if (!res.ok) { say(box, res.error, "error"); return; }
          var who = { id: res.id, key: res.token || pin, kakao: false };
          if (res.mustChange) return newPin(res, who);
          if (res.token) LeeshAPI.who.set(who, keep);
          done(res, who);
        });
      });
      alt.appendChild(f);
      box.appendChild(alt);
      box.appendChild(el("p", "sys-msg signin__msg", ""));
      var err = LeeshAPI.kakao && LeeshAPI.kakao.lastError();
      if (err) say(box, "카카오 로그인을 마치지 못했어요. 다시 눌러주세요.", "error");
      else if (note) say(box, note, kind);
    }

    /* ---------- 0000 → my own PIN ---------- */
    function newPin(res, who) {
      head();
      box.appendChild(el("p", "signin__title", res.name + "님, 처음 오셨네요!"));
      box.appendChild(el("p", "sys-note", "앞으로 쓸 비밀번호 4자리를 정해주세요. 0000이나 1111, 1234처럼 쉬운 번호는 안 돼요."));
      var f = el("form", "signin__form");
      var row = el("div", "sys-row");
      row.appendChild(pinInput("p1", "새 비밀번호"));
      row.appendChild(pinInput("p2", "한 번 더"));
      f.appendChild(row);
      var sb = button("비밀번호 정하고 시작하기", "sys-btn", "submit");
      f.appendChild(sb);
      f.appendChild(el("p", "sys-msg signin__msg", ""));
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        var p1 = f.querySelector("[name=p1]").value.trim(), p2 = f.querySelector("[name=p2]").value.trim();
        if (p1 !== p2) { say(box, "두 칸의 번호가 달라요.", "error"); return; }
        sb.disabled = true;
        LeeshAPI.rpc("member_change_pin", { p_id: who.id, p_pin: who.key, p_new: p1 }).then(function (r) {
          sb.disabled = false;
          if (!r.ok) { say(box, r.error, "error"); return; }
          var me = { id: r.id, key: r.token, kakao: false };
          LeeshAPI.who.set(me, keep);
          LeeshAPI.rpc("member_login", { p_id: me.id, p_pin: me.key }).then(function (again) {
            if (again.ok) done(again, me); else choose(again.error, "error");
          });
        });
      });
      box.appendChild(f);
      f.querySelector("[name=p1]").focus();
    }

    /* ---------- Kakao, not linked yet ---------- */
    function linkForm(req) {
      head();
      box.appendChild(el("p", "signin__title", req && req.status === "거절" ? "연결이 안 됐어요" : "처음 오셨네요!"));
      box.appendChild(el("p", "sys-note", req && req.status === "거절"
        ? "이름이나 선생님이 맞지 않았을 수 있어요. 다시 보내거나 학원에 문의해주세요."
        : "이름과 담당 선생님을 알려주세요. 원장님이 확인하면 이 카카오 계정으로 바로 쓸 수 있어요."));
      var f = el("form", "signin__form");
      var row = el("div", "sys-row");
      row.appendChild(input("name", "이름", { autocomplete: "name", maxlength: "30", required: "" }));
      var tl = el("label", "sys-field");
      tl.appendChild(el("span", null, "담당 선생님"));
      var sel = el("select");
      sel.name = "teacher";
      ["", "잘 모르겠어요"].concat(TEACHERS).forEach(function (t, i) {
        var o = el("option", null, i === 0 ? "고르기" : t);
        o.value = i < 2 ? (i === 1 ? t : "") : t;
        sel.appendChild(o);
      });
      tl.appendChild(sel);
      row.appendChild(tl);
      f.appendChild(row);
      if (req) { f.querySelector("[name=name]").value = req.name || ""; sel.value = req.teacher || ""; }
      var sb = button("연결 요청 보내기", "sys-btn", "submit");
      f.appendChild(sb);
      f.appendChild(el("p", "sys-msg signin__msg", ""));
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        sb.disabled = true;
        LeeshAPI.rpc("kakao_link_request", { p_name: f.querySelector("[name=name]").value, p_teacher: sel.value || null }).then(function (r) {
          sb.disabled = false;
          if (!r.ok) { say(box, r.error, "error"); return; }
          kakaoCheck();
        });
      });
      box.appendChild(f);
      box.appendChild(otherAccount());
    }
    function pending(req) {
      head();
      box.appendChild(el("p", "signin__title", req.name + "님, 확인을 기다리고 있어요"));
      box.appendChild(el("p", "sys-note", "원장님이 확인하면 바로 쓸 수 있어요. 보통 하루 안에 확인해요."));
      var row = el("div", "signin__row");
      var again = button("확인됐는지 다시 보기", "sys-btn");
      again.addEventListener("click", function () { again.disabled = true; kakaoCheck(); });
      var fix = button("요청 고치기", "sys-link");
      fix.addEventListener("click", function () { linkForm(req); });
      row.appendChild(again);
      row.appendChild(fix);
      box.appendChild(row);
      box.appendChild(el("p", "sys-msg signin__msg", ""));
      box.appendChild(otherAccount());
    }
    function otherAccount() {
      var b = button("다른 카카오 계정으로 로그인", "sys-link signin__other");
      b.addEventListener("click", function () { LeeshAPI.kakao.signOut(); choose(); });
      return b;
    }
    function kakaoCheck() {
      return LeeshAPI.rpc("member_login", { p_id: "", p_pin: "" }).then(function (res) {
        if (res.ok) return done(res, { id: res.id, key: "", kakao: true });
        if (res.code !== "not_linked") {
          if (res.error === LeeshAPI.NETWORK_ERROR) return choose(res.error, "error");
          // linked but 휴원/종료, or the session ran out
          if (!LeeshAPI.kakao.session()) return choose("카카오 로그인이 풀렸어요. 다시 눌러주세요.");
          return choose(res.error, "error");
        }
        return LeeshAPI.rpc("kakao_status", {}).then(function (st) {
          if (!st.ok) return choose(st.error, "error");
          if (st.request && st.request.status === "대기") return pending(st.request);
          return linkForm(st.request);
        });
      });
    }

    /* ---------- entry ---------- */
    function start() {
      head();
      box.appendChild(el("p", "sys-note", "확인 중…"));
      var saved = LeeshAPI.who.get();
      if (saved) {
        return LeeshAPI.rpc("member_login", { p_id: saved.id, p_pin: saved.key }).then(function (res) {
          if (res.ok && !res.mustChange) return done(res, { id: res.id, key: saved.key, kakao: false });
          if (res.error !== LeeshAPI.NETWORK_ERROR) LeeshAPI.who.clear();
          if (LeeshAPI.kakao.session()) return kakaoCheck();
          choose(res.ok ? "" : res.error, "error");
        });
      }
      if (LeeshAPI.kakao && LeeshAPI.kakao.session()) return kakaoCheck();
      choose();
      return Promise.resolve();
    }
    function signOut() {
      LeeshAPI.who.clear();
      if (LeeshAPI.kakao) LeeshAPI.kakao.signOut();
      choose();
    }
    return { start: start, signOut: signOut, show: choose, note: function (t) { say(box, t); } };
  }

  window.LeeshSignIn = { mount: mount };
})();
