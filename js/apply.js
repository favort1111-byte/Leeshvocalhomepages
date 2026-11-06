// apply.html: 학원 내방 오디션 신청서 — the same questions as the academy's Google Form (이름, 성별, 출생년도/나이,
// 키/몸무게, 지원분야 택 1, 특이사항, 댄스 음원). 학원생만: sign in with Kakao (js/signin.js) first. Each 내방 오디션
// the director posts in the admin page (audition_news kind 내방) takes applications until its 마감 (or the day itself);
// sending again changes the application. apply.html?news=<id> opens that audition.
(function () {
  var app = document.getElementById("applyApp");
  if (!app) return;
  var cfg = window.LEESH || {};
  var WD = ["일", "월", "화", "수", "목", "금", "토"];
  var FIELDS = ["보컬", "랩", "댄스", "라이브퍼포먼스", "연기"];
  var MB = 30;
  var whoBox = document.getElementById("applyWho"), area = document.getElementById("applyArea");
  var want = Number((/[?&]news=(\d+)/.exec(location.search) || [])[1]) || null;
  var who = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function day(d) {
    var dt = new Date(d + "T00:00:00Z");
    return (dt.getUTCMonth() + 1) + "월 " + dt.getUTCDate() + "일 (" + WD[dt.getUTCDay()] + ")";
  }
  function field(label, input, help) {
    var l = el("label", "sys-field");
    l.appendChild(el("span", null, label));
    if (help) l.appendChild(el("small", "apply__help", help));
    l.appendChild(input);
    return l;
  }
  function radios(name, values, value) {
    var box = el("div", "sys-radios apply__radios");
    values.forEach(function (v) {
      var l = el("label"), r = el("input");
      r.type = "radio";
      r.name = name;
      r.value = v;
      r.checked = v === value;
      l.appendChild(r);
      l.appendChild(document.createTextNode(" " + v));
      box.appendChild(l);
    });
    return box;
  }
  function picked(form, name) { var r = form.querySelector("[name=" + name + "]:checked"); return r ? r.value : null; }
  function say(node, text, kind) { node.textContent = text || ""; node.className = "sys-msg" + (kind ? " sys-msg--" + kind : ""); }

  if (!window.LeeshAPI || !LeeshAPI.enabled() || !window.LeeshSignIn) {
    document.getElementById("applyOff").hidden = false;
    return;
  }
  var sign = LeeshSignIn.mount(whoBox, {
    title: "학원생 로그인",
    lede: "내방 오디션은 학원생만 신청할 수 있어요. 카카오로 로그인해주세요.",
    onSignedIn: function (res, w) { who = w; load(res.name); }
  });

  function load(name) {
    return LeeshAPI.rpc("member_visit_open", { p_id: who.id, p_pin: who.key }).then(function (res) {
      if (!res.ok) { sign.show(res.error, "error"); whoBox.hidden = false; area.hidden = true; return; }
      whoBox.hidden = true;
      area.hidden = false;
      area.textContent = "";
      var hello = el("p");
      hello.appendChild(el("strong", null, (res.name || name) + "님, 안녕하세요."));
      var out = el("button", "sys-link", "로그아웃");
      out.type = "button";
      out.addEventListener("click", function () { sign.signOut(); who = null; whoBox.hidden = false; area.hidden = true; });
      hello.appendChild(document.createTextNode(" "));
      hello.appendChild(out);
      area.appendChild(hello);
      var list = res.auditions || [];
      if (!list.length) {
        area.appendChild(el("p", "book__empty", "지금 신청받는 내방 오디션이 없어요. 새 오디션이 열리면 오디션 소식과 인스타그램으로 알려드려요."));
        return;
      }
      var open = list.filter(function (a) { return a.id === want; })[0] || list[0];
      if (list.length > 1) {
        var chips = el("div", "sys-chips");
        list.forEach(function (a) {
          var b = el("button", "sys-chip", (a.company || a.title) + (a.date ? " · " + day(a.date) : ""));
          b.type = "button";
          b.setAttribute("aria-pressed", a === open ? "true" : "false");
          b.addEventListener("click", function () { want = a.id; load(name); });
          chips.appendChild(b);
        });
        area.appendChild(chips);
      }
      area.appendChild(form(open, res.name || name));
    });
  }

  /* 내방 오디션 참여 방법 + 주요 공지 사항 — 블로그 공지 [내방 오디션 참여 방법!] (2023.3.30) 그대로,
     접수는 담당쌤 카톡 대신 이 신청서로 (원장님 2026-11-06). */
  var RULES = [
    ["접수 후 선곡 및 특이사항 변경 불가하니 신중하게 지원해 주세요!", "(부득이한 경우는 담당쌤께 말씀해 주세요!)"],
    ["특이사항 요청 시 지원할 때 말씀해 주세요!", "(ex. 학교 수업 때문에 7시 이후 순서로 잡아주세요 · ex. 지방이라 버스를 타야 해서 6시에 시작하게 해주세요 등)"],
    ["당일 지각 및 불참 시 누적 2회 이상 6개월 동안 오디션 및 월말평가에 참여 불가합니다.",
     "(미리 스케줄 체크하여 특이사항으로 요청해 주세요) (병가 시에는 오디션 당일 일자 처방전 첨부 시 추후 참여 가능)"],
    ["참여 의사만 밝히고 약속한 기간까지 신청서 미접수 시 오디션 참여 불가 (누적 1회)", null],
    ["시작 30분 전 학원 도착 후 대기해 주세요!", null]
  ];
  function rules() {
    var box = el("details", "apply__rules");
    box.open = true;
    box.appendChild(el("summary", "apply__rules-title", "내방 오디션 참여 방법 · 주요 공지 사항"));
    var how = el("ul", "apply__how");
    var li = el("li");
    li.appendChild(document.createTextNode("접수 기간 : 오디션 "));
    li.appendChild(el("b", "apply__red", "일정 3일 전"));
    li.appendChild(document.createTextNode("까지 이 신청서로 보내기!"));
    how.appendChild(li);
    li = el("li");
    li.appendChild(document.createTextNode("오디션 일정은 인스타 참고! :) 팔로우하여 일정 확인해주세요! "));
    var a = el("a", null, "인스타그램 보기");
    a.href = "https://www.instagram.com/leeshvocal_auditionn/";
    a.target = "_blank";
    a.rel = "noopener";
    li.appendChild(a);
    how.appendChild(li);
    how.appendChild(el("li", null, "댄스 지원자는 댄스 음원을 꼭 첨부해주세요! 댄스곡의 시작점은 본인이 편집하여 제출하기 (ex. 0:10초부터 틀어주세요 안됨 ❌)"));
    box.appendChild(how);
    box.appendChild(el("p", "apply__rules-sub", "📍 주요 공지 사항"));
    var ol = el("ol", "apply__rule-list");
    RULES.forEach(function (r) {
      var item = el("li");
      item.appendChild(el("span", "apply__red", r[0]));
      if (r[1]) item.appendChild(el("small", null, r[1]));
      ol.appendChild(item);
    });
    box.appendChild(ol);
    box.appendChild(el("p", "apply__rules-end", "🔥 정보 누락되지 않도록 마지막으로 보내기 전에 꼭! 꼭! 꼭!! 확인해 주세요! 🔥"));
    return box;
  }

  /* One audition: what the director wrote (일시 · 장소 · 지원자격 · 지원분야 …) and the questions under it. */
  function form(a, name) {
    var mine = a.mine;
    var wrap = el("article", "apply");
    var head = el("header", "apply__head");
    if (a.image) {
      var img = el("img", "apply__poster");
      img.src = LeeshAPI.storage.newsUrl(a.image);
      img.alt = (a.company ? a.company + " " : "") + a.title + " 포스터";
      head.appendChild(img);
    }
    head.appendChild(el("h2", "apply__title", (a.company ? a.company + " " : "") + a.title));
    var facts = el("p", "apply__facts");
    if (a.date) facts.appendChild(el("span", null, "오디션 " + day(a.date)));
    if (a.deadline) facts.appendChild(el("span", null, "신청 마감 " + day(a.deadline)));
    if (facts.firstChild) head.appendChild(facts);
    if (a.body) head.appendChild(el("p", "apply__body", a.body));
    if (mine) head.appendChild(el("p", "sys-msg sys-msg--ok", "신청했어요. 고칠 게 있으면 아래에서 고쳐서 다시 보내주세요."));
    wrap.appendChild(head);
    wrap.appendChild(rules());

    var f = el("form", "sys apply__form");
    var nm = el("input"); nm.name = "name"; nm.maxLength = 30; nm.required = true; nm.value = mine ? mine.name : name || "";
    f.appendChild(field("이름", nm));
    var g = el("fieldset", "apply__set");
    g.appendChild(el("legend", null, "성별"));
    g.appendChild(radios("gender", ["남", "여"], mine && mine.gender));
    f.appendChild(g);
    var birth = el("input"); birth.name = "birth"; birth.maxLength = 30; birth.placeholder = "예) 10년/17살"; birth.value = mine && mine.birth || "";
    f.appendChild(field("출생년도/나이", birth, "ex) 10년/17살"));
    var size = el("input"); size.name = "size"; size.maxLength = 30; size.placeholder = "예) 168/48"; size.value = mine && mine.body_size || "";
    f.appendChild(field("키/몸무게", size, "ex) 168/48"));
    var fs = el("fieldset", "apply__set");
    fs.appendChild(el("legend", null, "지원분야"));
    fs.appendChild(el("small", "apply__help", "*보컬, 랩, 댄스, 라이브 퍼포먼스, 연기 중 택 1만 가능"));
    fs.appendChild(radios("field", FIELDS, mine && mine.field));
    f.appendChild(fs);

    // 특이사항 before 댄스음원 (원장님 2026-10-28: 이름 · 성별 · 출생년도/나이 · 키/몸무게 · 지원분야 · 특이사항 · 댄스음원)
    var note = el("textarea"); note.name = "note"; note.rows = 3; note.maxLength = 1000; note.value = mine && mine.note || "";
    f.appendChild(field("특이사항", note, "순서 조정이 필요한 경우 작성해주세요! ex) 학교가 늦게 끝나서 뒷순서로 배정 부탁드립니다(7시 이후) · 지방에 살아서 7시에는 학원에서 나가야 해서 앞순서로 배정 부탁드립니다."));

    // 댄스음원 (always shown, like the Google Form): required for 댄스 (MP3); a big file goes to 실장님 on KakaoTalk
    var dance = el("fieldset", "apply__set apply__music");
    dance.appendChild(el("legend", null, "댄스음원"));
    dance.appendChild(el("small", "apply__help", "* 댄스 지원자의 경우 음원 제출 필수(MP3파일)"));
    dance.appendChild(el("small", "apply__help", "* 댄스곡의 시작점은 본인이 편집해서 제출해주세요. (ex. \"0:10초부터 틀어주세요\"는 안 돼요 ❌)"));
    dance.appendChild(el("small", "apply__help", "* 용량이 클 시 실장님께 카톡으로 제출해주세요-!"));
    if (cfg.visitKakaoId) dance.appendChild(el("small", "apply__help", "카톡아이디 : " + cfg.visitKakaoId));
    dance.appendChild(el("small", "apply__help apply__limit", "소리 파일(audio) 1개를 올려주세요. 최대 " + MB + "MB예요."));
    if (mine && mine.music) dance.appendChild(el("p", "sys-note", "올린 음원: " + (mine.music.name || "음원 파일") + " (새 파일을 고르면 바뀌어요)"));
    var music = el("input"); music.type = "file"; music.name = "music"; music.accept = "audio/*,.mp3,.m4a,.wav";
    dance.appendChild(music);
    var byKakao = el("label", "sys-keep");
    var bk = el("input"); bk.type = "checkbox"; bk.name = "bykakao";
    byKakao.appendChild(bk);
    byKakao.appendChild(document.createTextNode(" 음원은 실장님께 카톡으로 보낼게요"));
    dance.appendChild(byKakao);
    f.appendChild(dance);

    var okBox = el("label", "sys-keep apply__agree");
    var ok = el("input"); ok.type = "checkbox"; ok.name = "agree"; ok.checked = !!mine;
    okBox.appendChild(ok);
    okBox.appendChild(document.createTextNode(" 위 주요 공지 사항을 읽고 확인했어요"));
    f.appendChild(okBox);

    var btn = el("button", "sys-btn sys-btn--block", mine ? "고친 내용 보내기" : "제출");
    btn.type = "submit";
    f.appendChild(btn);
    var msg = el("p", "sys-msg");
    msg.setAttribute("role", "status");
    f.appendChild(msg);

    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var gender = picked(f, "gender"), fld = picked(f, "field"), file = music.files[0];
      if (!nm.value.trim()) { say(msg, "이름을 적어주세요.", "error"); return; }
      if (!ok.checked) { say(msg, "주요 공지 사항을 읽고 \"확인했어요\"에 체크해주세요.", "error"); return; }
      if (!gender) { say(msg, "성별을 골라주세요.", "error"); return; }
      if (!fld) { say(msg, "지원분야를 하나 골라주세요.", "error"); return; }
      if (fld === "댄스" && !file && !(mine && mine.music) && !bk.checked) {
        say(msg, "댄스 지원자는 음원을 올려주세요. 용량이 크면 \"음원은 실장님께 카톡으로 보낼게요\"를 체크해주세요.", "error");
        return;
      }
      if (file && !/^audio\//.test(file.type) && !/\.(mp3|m4a|wav)$/i.test(file.name)) { say(msg, "음원은 MP3 같은 소리 파일로 올려주세요.", "error"); return; }
      if (file && file.size > MB * 1048576) { say(msg, MB + "MB보다 커요. 실장님께 카톡으로 보내고 \"음원은 실장님께 카톡으로 보낼게요\"를 체크해주세요.", "error"); return; }
      btn.disabled = true;
      say(msg, file ? "음원을 올리는 중이에요…" : "보내는 중…");
      var up = Promise.resolve(null);
      if (file) {
        var ext = (/\.([a-z0-9]{2,4})$/i.exec(file.name) || [, "mp3"])[1].toLowerCase();
        var path = who.id + "/" + a.id + "-" + Date.now().toString(36) + "." + ext;
        var blob = file.type ? file : file.slice(0, file.size, "audio/mpeg");
        up = LeeshAPI.kakao.token().then(function (t) { return LeeshAPI.storage.uploadVisit(path, blob, t); }).then(function (ok) {
          if (!ok) throw new Error("upload");
          return { path: path, name: file.name.slice(0, 80), type: blob.type, size: file.size };
        });
      }
      up.then(function (m) {
        var extra = bk.checked && !m && !(mine && mine.music) ? "[음원은 실장님께 카톡으로 보냄] " : "";
        return LeeshAPI.rpc("member_visit_apply", {
          p_id: who.id, p_pin: who.key, p_news: a.id, p_name: nm.value.trim(), p_gender: gender,
          p_birth: birth.value.trim() || null, p_size: size.value.trim() || null, p_field: fld,
          p_music: m, p_note: (extra + note.value.trim()).trim() || null
        });
      }).then(function (res) {
        btn.disabled = false;
        if (!res.ok) { say(msg, res.error, "error"); return; }
        say(msg, mine ? "고쳤어요." : "신청했어요! 순서와 안내는 학원에서 따로 알려드려요.", "ok");
        want = a.id;
        setTimeout(function () { load(name); }, 1200);
      }, function () {
        btn.disabled = false;
        say(msg, "음원을 올리지 못했어요. 다시 해보거나 카카오톡 채널로 보내주세요.", "error");
      });
    });
    wrap.appendChild(f);
    return wrap;
  }

  sign.start().then(function () { if (!who) { whoBox.hidden = false; area.hidden = true; } });
})();
