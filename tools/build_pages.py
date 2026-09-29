"""Generate the site pages. Image paths come from images.json; all page text lives here."""
import json, os, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))
IMG = {int(k): v for k, v in json.load(open(os.path.join(HERE, "images.json"))).items()}

def img(i):
    return IMG.get(i, "")

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
         '<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@500&family=Cormorant+Garamond:wght@500&'
         'family=Gloock&family=Gowun+Batang&family=Jost:wght@400;500&family=Nanum+Pen+Script&'
         'family=Noto+Sans+KR:wght@400;500&display=swap" rel="stylesheet">')

PAGES = [("home", "index.html"), ("about", "about.html"), ("contact", "contact.html"),
         ("consult", "consult.html"), ("booking", "booking.html")]

def nav(current, theme):
    cur = ' aria-current="page"'
    links = "\n".join(
        f'    <a href="{href}"{cur if name == current else ""}>{name}</a>'
        for name, href in PAGES)
    return f'  <nav class="nav nav--{theme}" aria-label="주요 메뉴">\n{links}\n  </nav>'

def head(title, desc):
    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<meta name="description" content="{desc}">
{FONTS}
<link rel="stylesheet" href="css/style.css">
<link rel="stylesheet" href="css/system.css">
</head>
<body>
"""

def foot(*extra):
    scripts = ["config", "api"] + list(extra)
    return "".join(f'<script src="js/{n}.js"></script>\n' for n in scripts) + "</body>\n</html>\n"


SR = '<h1 class="sr-only">{}</h1>'

# ---------- icon art ----------
def globe_svg():
    rects = []
    c = 7.5
    for y in range(16):
        for x in range(16):
            d = ((x - c) ** 2 + (y - c) ** 2) ** 0.5
            if d > 7.6:
                continue
            if d > 6.7:
                col = "#123E73"
            elif (x - 4) ** 2 + (y - 4) ** 2 < 5:
                col = "#9AD4FB"
            elif y in (7, 8) or x in (7, 8) or abs(x - y) == 0 and 3 < x < 12:
                col = "#1C63B4"
            elif (x + y) % 6 == 0:
                col = "#2A78CF"
            else:
                col = "#3A92E6"
            rects.append(f'<rect x="{x}" y="{y}" width="1" height="1" fill="{col}"/>')
    ring = ''.join(f'<rect x="{x}" y="{y}" width="1" height="1" fill="#E9F6FF"/>'
                   for x, y in [(0, 10), (1, 9), (2, 9), (13, 5), (14, 5), (15, 4), (1, 11), (14, 6)])
    return ('<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">'
            + "".join(rects) + ring + '</svg>')

FINDER = ('<svg viewBox="0 0 48 48" aria-hidden="true">'
          '<rect x="1" y="1" width="46" height="46" fill="#C8C8C8" stroke="#3B3B3B" stroke-width="2"/>'
          '<path d="M3 45V3h42" fill="none" stroke="#F4F4F4" stroke-width="2"/>'
          '<path d="M3 45h42V3" fill="none" stroke="#7A7A7A" stroke-width="2"/>'
          '<rect x="6" y="6" width="36" height="36" fill="#D9D9D9"/>'
          '<path d="M28 28l10 10" stroke="#2B2B2B" stroke-width="6" stroke-linecap="round"/>'
          '<path d="M28 28l10 10" stroke="#8E8E8E" stroke-width="2.5" stroke-linecap="round"/>'
          '<circle cx="20" cy="19" r="11" fill="#B9F1F6" stroke="#262626" stroke-width="2.6"/>'
          '<path d="M13.5 16.5a7.5 7.5 0 0 1 6-5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>'
          '</svg>')

FOLDER = ('<svg viewBox="0 0 58 48" aria-hidden="true">'
          '<defs><linearGradient id="fg" x1="0" y1="0" x2="0" y2="1">'
          '<stop offset="0" stop-color="#6ACCF8"/><stop offset="1" stop-color="#2EA3EE"/></linearGradient></defs>'
          '<path d="M2 6a4 4 0 0 1 4-4h14l5 5h27a4 4 0 0 1 4 4v31a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z" fill="#2294DD"/>'
          '<path d="M1 15a4 4 0 0 1 4-4h48a4 4 0 0 1 4 4v28a4 4 0 0 1-4 4H5a4 4 0 0 1-4-4z" fill="url(#fg)"/>'
          '<path d="M5 13h48" stroke="#A9E4FC" stroke-width="1.2" opacity=".8"/>'
          '</svg>')

CLIP = ('<svg class="clip" viewBox="0 0 26 60" aria-hidden="true">'
        '<path d="M9 44V12a6 6 0 0 1 12 0v36a9 9 0 0 1-18 0V16" fill="none" stroke="#9FA1A3" stroke-width="2.4" stroke-linecap="round"/>'
        '</svg>')

def icon(left, top, w, h, label, href, inner, img_class="icon__img", external=False, extra="", scene=None):
    target = ' target="_blank" rel="noopener"' if external else ""
    if scene:  # zooms into the photo in place (js/scene.js); the #anchor keeps it reachable without JS
        href, target = f"#scene-{scene}", f' data-scene="scene-{scene}" aria-haspopup="dialog"'
    return (f'    <a class="icon" href="{href}"{target} style="left:calc({left} * var(--s));top:calc({top} * var(--s));width:calc({w} * var(--s))">\n'
            f'      <span class="{img_class}" style="height:calc({h} * var(--s))">{inner}</span>\n'
            f'      <span class="icon__label">{label}</span>\n'
            f'    </a>')

def thumb(left, top, w, h, i, label, href="about.html", scene=None):
    inner = f'<img src="{img(i)}" alt="" loading="lazy">'
    return icon(left, top, w, h, label, href, inner, scene=scene)

YT = "https://www.youtube.com/@vocallesson1533"
MAP = "https://map.naver.com/p/search/%EC%9D%B4%EC%86%A1%ED%9D%AC%EB%B3%B4%EC%BB%AC%EB%A0%88%EC%8A%A8"
KAKAO = "https://pf.kakao.com/_xgNYbK"


# ---------- photo scenes: an icon's photo grows to fill the screen, notes are handwritten on it ----------
def scene(sid, photo, label, big, lines, cta_text, cta_href, external=False):
    """big: headline (left on PC, top on phones); lines: short notes written one after another."""
    tilts = [2, -1.5, 1, -2, 1.5, -1]
    notes = "".join(
        f'        <p class="note" style="--d:{1.4 + i * 0.4:.1f}s;--r:{tilts[i % len(tilts)]}deg">{t}</p>\n'
        for i, t in enumerate(lines))
    cta_d = 1.4 + len(lines) * 0.4 + 0.2
    target = ' target="_blank" rel="noopener"' if external else ""
    return (f'  <section class="scene" id="scene-{sid}" role="dialog" aria-label="{label}" hidden>\n'
            f'    <div class="scene__photo" style="background-image:url(\'{img(photo)}\')"></div>\n'
            f'    <button class="scene__back" type="button" data-leave>← 바탕화면</button>\n'
            f'    <div class="scene__notes">\n'
            f'      <div class="scene__col scene__col--a">\n'
            f'        <p class="note note--big" style="--d:.55s;--r:-3deg">{big}</p>\n'
            f'      </div>\n'
            f'      <div class="scene__col scene__col--b">\n{notes}'
            f'        <a class="note note--cta" href="{cta_href}"{target} style="--d:{cta_d:.1f}s;--r:-2deg">{cta_text}</a>\n'
            f'      </div>\n'
            f'    </div>\n'
            f'  </section>\n')

SCENES = {
    "results": scene("results", 5, "합격 이야기", "최단 3주,<br>대형 기획사<br>합격까지.",
        ["tripleS 김유언 — 데뷔 ♪", "SM · JYP · CUBE 최종 합격", "SM · YG 1차 동시 합격",
         "서울예대 최종 합격 3명", "오디션 합격 기획사만 60여 곳"],
        "나도 준비해볼까? → 오디션 상담", "consult.html"),
    "stage": scene("stage", 1, "원장 이야기", "무대에 서본<br>사람이<br>가르쳐요.",
        ["가수 클로이(Klloy) — 앨범 2장", "백아연 · 현아 · 펀치 가이드 녹음", "호텔 델루나 · 김사부 OST 디렉션",
         "MBC 〈셔플 오디션〉 전담 트레이너", "대형 기획사 보컬 트레이너 9년차"],
        "원장님께 직접 배우기 → 상담", "consult.html"),
    "lesson": scene("lesson", 2, "레슨 이야기", "진단부터<br>플래닝까지,<br>4 STEP.",
        ["1 · 노래 진단 — 지금 내 소리 듣기", "2 · 실전 수업 — 기본기를 노래에", "3 · 디테일 레슨 — 톤 · 감정 · 끝음",
         "4 · 플래닝 — 선곡부터 무대까지", "담당 선생님이 끝까지, 1:1 담임제"],
        "첫 진단 받아보기 → 상담", "consult.html"),
    "room": scene("room", 3, "연습실 이야기", "새벽 2시에도<br>열려 있는<br>연습실.",
        ["365일 24시간 · 사전 예약제", "연습실 5개 + 춤연습실 1개", "피아노 · 컴퓨터 · 에어컨 완비",
         "50cm 방음벽, 스튜디오급 방음", "수강생은 무료"],
        "빈 시간 보기 → 연습실 예약", "booking.html"),
    "audition": scene("audition", 4, "오디션 이야기", "오디션은<br>많이보다<br>제대로.",
        ["매월 학원 내방 오디션", "신인개발팀 담당자 대면 심사", "본사 비공개 오디션 연결",
         "영상 캐스팅 오디션", "분기마다 실전 같은 월말평가"],
        "다음 오디션 준비하기 → 상담", "consult.html"),
    "voice": scene("voice", 7, "목소리 이야기", "고민은<br>달라도<br>시작은 같아요.",
        ["고음에서 목이 조여요", "음정이 자꾸 흔들려요", "비음 · 콧소리가 신경 쓰여요",
         "내 음색이 뭔지 모르겠어요", "→ 먼저 지금 소리를 진단해요"],
        "내 고민 말해보기 → 상담", "consult.html"),
    "hobby": scene("hobby", 6, "취미반 이야기", "노래방에서<br>바로 써먹는<br>발성.",
        ["고음 · 호흡 · 음정 기초부터", "좋아하는 노래로 배워요", "부담 없는 1:1 수업",
         "퇴근 후 연습실도 24시간", "한 곡 끝까지 부르는 날까지"],
        "취미로 시작하기 → 상담", "consult.html"),
    "exam": scene("exam", 9, "입시 이야기", "학교마다<br>전략이<br>달라요.",
        ["서울예대 최종 합격 3명", "한양대 수시 · 경희대 정시 합격", "서울예고 · 한림예고 합격",
         "학교별 선곡 · 자기소개 스피치", "분기별 모의 실기 평가"],
        "입시 상담 받기 → 상담", "consult.html"),
    "debut": scene("debut", 8, "데뷔 이야기", "연습생에서<br>무대까지.",
        ["tripleS 김유언 데뷔", "투엘슨 Ent. 합격 · 앨범 데뷔", "액팅 · 시선 · 표정 모니터링",
         "퍼스널 컬러 · 스타일링 체크", "전속 계약서 검토까지"],
        "데뷔 준비 이야기하기 → 상담", "consult.html"),
    "youtube": scene("youtube", 11, "유튜브 이야기", "9만 명이 보는<br>보컬 레슨.",
        ["코노에서 노래 잘 부르는 법 · 212만", "고음 진짜 바로 올리는 법 · 158만", "하루 만에 노래 잘 부르는 법 · 28만",
         "호흡압력법 · 음치탈출 · 비음 없애기", "영상 356개, 계속 올라가는 중"],
        "유튜브 채널 보러 가기 →", YT, external=True),
    "map": scene("map", 16, "오시는 길", "선릉역<br>7번 출구,<br>걸어서 2분.",
        ["강남구 테헤란로55길 21, 태원빌딩 2층", "7번 출구 직진 → 파리바게뜨에서 왼쪽", "청춘화로 · 서초동연가 사이로 오른쪽",
         "왼쪽, 1층 볼빨간딱새우 건물 2층", "전화 010-4458-5448"],
        "네이버 지도로 보기 →", MAP, external=True),
}


# The folder on the desktop is the student's own folder: 수강 ID login, then 레슨 노트 / 월말평가 (js/mynotes.js).
MY_FOLDER = """  <section class="scene scene--book" id="scene-me" role="dialog" aria-label="내 폴더" hidden>
    <div class="scene__photo"></div>
    <button class="scene__back" type="button" data-leave>← 바탕화면</button>
    <div class="book" id="myBook">
      <form class="book__login sys" id="myLogin">
        <h2 class="book__title">내 폴더</h2>
        <p class="book__lede">수강생은 레슨 노트와 월말평가를 여기서 봐요.</p>
        <label class="sys-field"><span>수강 ID</span><input name="memberId" autocomplete="username" autocapitalize="characters" spellcheck="false" required></label>
        <label class="sys-field"><span>비밀번호 4자리</span><input name="pin" type="password" inputmode="numeric" autocomplete="current-password" pattern="[0-9]{4}" maxlength="4" required></label>
        <button class="sys-btn sys-btn--block" type="submit">폴더 열기</button>
        <p class="sys-msg" id="myLoginMsg" role="status"></p>
      </form>
      <div class="book__open" id="myOpen" hidden>
        <header class="book__head">
          <h2 class="book__title" id="myTitle"></h2>
          <button class="book__logout" type="button" id="myLogout">로그아웃</button>
        </header>
        <div class="book__tabs" role="tablist">
          <button type="button" role="tab" aria-selected="true" data-book-tab="notes">레슨 노트</button>
          <button type="button" role="tab" aria-selected="false" data-book-tab="evals">월말평가</button>
          <a class="book__tablink" href="booking.html">연습실 예약 →</a>
        </div>
        <div class="book__page" data-book-page="notes" id="myNotes"></div>
        <div class="book__page" data-book-page="evals" id="myEvals" hidden></div>
      </div>
    </div>
  </section>
"""

def scenes(*ids):
    return "".join(SCENES[i] for i in ids)

# ---------- HOME (reference 1600x900 -> 800 units) ----------
home_icons = "\n".join([
    icon(74, 110, 50, 50, "유튜브", YT, globe_svg(), scene="youtube"),
    thumb(228.5, 136, 37, 37, 1, "무대.jpg", scene="stage"),
    thumb(285.5, 216, 37, 37, 2, "레슨.jpg", scene="lesson"),
    thumb(169, 263.5, 37, 38, 3, "연습실.jpg", scene="room"),
    thumb(90, 296, 49, 68, 4, "오디션.jpg", scene="audition"),
    thumb(319, 324, 37, 37, 5, "합격.jpg", scene="results"),
    thumb(464, 349.5, 83.5, 46.5, 7, "보컬.jpg", scene="voice"),
    icon(504.5, 152.5, 48, 48, "오시는길", MAP, FINDER, scene="map"),
    thumb(563, 256.5, 61.5, 47.5, 6, "취미반.jpg", scene="hobby"),
    thumb(637.5, 119.5, 73.5, 43, 9, "입시.jpg", scene="exam"),
    thumb(699, 150, 43.5, 49, 8, "데뷔.jpg", scene="debut"),
    icon(674.5, 339.5, 58, 48.5, "내 폴더", "booking.html", FOLDER, scene="me"),
])

home = (head("이송희보컬레슨 | 강남 선릉역 1:1 보컬학원",
             "강남 선릉역 1:1 보컬학원 이송희보컬레슨. 대형 기획사 보컬 트레이너 원장의 오디션·입시·전문·취미반.")
        + f'<main class="stage wall" style="background-image:url(\'{img(0)}\')">\n'
        + SR.format("이송희보컬레슨 — 강남 선릉역 1:1 보컬학원") + "\n"
        + nav("home", "light") + "\n"
        + '  <div class="icons">\n' + home_icons + "\n  </div>\n" + scenes(*SCENES) + MY_FOLDER + "</main>\n" + foot("scene", "mynotes"))

# ---------- ABOUT (reference 800x797) ----------
def ph(left, top, w, h, i, kind, rot, z=1, alt=""):
    return (f'      <div class="ph ph--{kind}" style="left:calc({left} * var(--s));top:calc({top} * var(--s));'
            f'width:calc({w} * var(--s));height:calc({h} * var(--s));transform:rotate({rot}deg);z-index:{z}">'
            f'<img src="{img(i)}" alt="{alt}" loading="lazy"></div>')

def fgroup(n, tab, photos, title, text):
    return (f'  <div class="fblock">\n'
            f'    <div class="fgroup fgroup--{n}" aria-hidden="true">\n'
            f'      <div class="folder-back"></div>\n'
            f'      <div class="folder-tab"><span>{tab}</span></div>\n'
            f'      <div class="folder-front"></div>\n'
            + "\n".join(photos) + "\n"
            f'    </div>\n'
            f'    <div class="fcap fcap--{n}">\n'
            f'      <h2>{title}</h2>\n'
            f'      <p>{text}</p>\n'
            f'    </div>\n'
            f'  </div>')

about_groups = "\n".join([
    fgroup(1, "audition notes", [
        ph(12, 57, 77, 105, 15, "card", -3, 2),
        ph(99, 9, 98, 110, 11, "polaroid", 5, 3),
        ph(74, 149, 90, 86, 13, "white", -2, 4),
        ph(164, 169, 65, 68, 10, "flat", 5, 5),
    ], "Audition", "대형 기획사 연습생 커리큘럼으로 준비하는 오디션·입시반. 월 내방·비공개 오디션까지."),
    fgroup(2, "songs on repeat", [
        ph(31, 22, 59, 85, 4, "white", -3, 2),
        ph(126, 0, 66, 67, 7, "white", 3, 3),
        ph(110, 60, 75, 59, 9, "white", 4, 4),
        ph(20, 130, 80, 100, 14, "card", -4, 5),
        ph(112, 153, 83, 84, 5, "white", 2, 6),
        ph(148, 179, 72, 83, 18, "black", 6, 7),
    ], "Pro Class", "기본기부터 톤 메이킹까지, 4 STEP 담임제로 완성하는 전문반."),
    fgroup(3, "just for fun", [
        ph(25, 27, 68, 80, 19, "white", -3, 2),
        ph(112, 2, 70, 77, 16, "card", 4, 3),
        ph(115, 72, 75, 80, 3, "flat", 8, 4),
        ph(12, 219, 60, 40, 17, "flat", -3, 5),
        ph(60, 125, 65, 94, 12, "flat", 0, 6),
        ph(128, 170, 82, 84, 6, "white", -2, 7),
    ], "Hobby", "노래방에서 바로 써먹는 발성. 고음·호흡·음정을 제대로 배우는 취미반."),
])

about = (head("About | 이송희보컬레슨",
              "이송희보컬레슨의 오디션·입시반, 전문반, 취미반 소개.")
         + '<main class="stage about">\n'
         + nav("about", "cardboard") + "\n"
         +   '  <h1 class="about__title">our vocal<br>classes</h1>\n'
         + about_groups + "\n</main>\n" + foot())

# ---------- CONTACT (reference 800x612) ----------
def cph(left, top, w, h, i, kind, rot, z):
    return (f'    <div class="ph ph--{kind}" style="left:calc({left} * var(--s));top:calc({top} * var(--s));'
            f'width:calc({w} * var(--s));height:calc({h} * var(--s));transform:rotate({rot}deg);z-index:{z}">'
            f'<img src="{img(i)}" alt="" loading="lazy"></div>')

RECEIPT = ('    <div class="receipt">'
           '<b>VOCAL&nbsp;LESSON</b>'
           '<i><span>발성 진단</span><span>01</span></i>'
           '<i><span>호흡 · 고음</span><span>02</span></i>'
           '<i><span>톤 메이킹</span><span>03</span></i>'
           '<i><span>디테일 플래닝</span><span>04</span></i>'
           '<hr><i><span>상담</span><span>FREE</span></i>'
           '<hr><i><span>SEOLLEUNG 7</span><span>2F</span></i>'
           '</div>')

collage = "\n".join([
    '    <div class="bigfolder"><div class="bigfolder__back"></div>'
    '<div class="bigfolder__tab"></div><div class="bigfolder__front"></div></div>',
    '    <div class="folder-label">from lessons to stages</div>',
    cph(251, 145, 88, 104, 4, "white", 14, 4),
    RECEIPT,
    cph(137, 270, 190, 175, 1, "polaroid", -12, 6),
    "    " + CLIP.replace('class="clip"', 'class="clip"'),
    cph(331, 358, 122, 98, 3, "flat", -8, 7),
    cph(456, 343, 98, 98, 5, "white", 12, 8),
    cph(581, 382, 92, 66, 9, "white", -6, 8),
    cph(156, 457, 108, 86, 7, "white", -18, 9),
    cph(317, 460, 175, 160, 13, "polaroid", -14, 10),
    cph(484, 497, 92, 125, 18, "black", 8, 11),
])

contact = (head("Contact | 이송희보컬레슨",
                "이송희보컬레슨 상담 안내. 강남 선릉역 7번 출구 도보 2분, 카카오톡 24시간 문의.")
           + '<main class="stage contact">\n'
           + nav("contact", "dark") + "\n"
           + '  <div class="contact__text">\n'
           + "    <h1>let's connect</h1>\n"
           + "    <p>노래는 늘 깔끔하게 완성된 채로 오지 않아요. 오디션 전날 밤의 연습, 무심코 흥얼거린 가사, "
             "처음 잡아본 마이크에서 시작되죠. 지금 어디쯤인지부터 함께 확인해요. "
             "선릉역 7번 출구 도보 2분 · 카카오톡 24시간 문의 · 010-4458-5448</p>\n"
           + f'    <a class="pill-btn" href="{KAKAO}" target="_blank" rel="noopener">contact</a>\n'
           + "  </div>\n"
           + '  <div class="collage" aria-hidden="true">\n' + collage + "\n  </div>\n"
           + "</main>\n" + foot())

CONSULT_FORM = f"""  <form class="modal sys" id="consultForm" novalidate>
    <h1>Book a free consultation</h1>
    <div class="sys-row">
      <label class="sys-field"><span>이름</span><input name="name" autocomplete="name" required></label>
      <label class="sys-field"><span>연락처</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" required></label>
    </div>
    <label class="sys-field"><span>관심 있는 반</span>
      <select name="track">
        <option value="">아직 모르겠어요</option>
        <option>오디션·입시반</option>
        <option>전문반</option>
        <option>취미반</option>
      </select>
    </label>
    <fieldset class="sys-radios">
      <legend>상담 방식</legend>
      <label><input type="radio" name="method" value="전화 상담" checked> 전화 상담</label>
      <label><input type="radio" name="method" value="방문 상담"> 방문 상담</label>
      <label><input type="radio" name="method" value="체험 레슨"> 체험 레슨</label>
    </fieldset>
    <label class="sys-field" id="consultWish" hidden><span>희망 날짜·시간</span><input name="wish" maxlength="100" placeholder="예) 토요일 오후 2시 이후"></label>
    <label class="sys-field"><span>문의 내용 (선택)</span><textarea name="message" rows="3"></textarea></label>
    <label class="sys-hp" aria-hidden="true">홈페이지<input name="website" tabindex="-1" autocomplete="off"></label>
    <button class="sys-btn sys-btn--block" type="submit">상담 신청하기</button>
    <p class="sys-msg" id="consultMsg" role="status"></p>
    <small>번호는 상담 안내에만 사용돼요.</small>
  </form>
"""

BOOKING_APP = f"""  <div class="booking__inner">
    <h1 class="booking__title">practice room</h1>
    <p class="booking__note">수강생 전용 · 연습실 5개와 춤연습실을 365일 24시간 사전예약제로 운영합니다.</p>
    <section class="sys sys-card" id="bookingApp" aria-live="polite">
      <div id="bookingOff" hidden>
        <p>연습실 예약 시스템을 준비하고 있습니다. 그동안은 카카오톡으로 예약해주세요.</p>
        <a class="sys-btn" href="{KAKAO}" target="_blank" rel="noopener">카카오톡으로 예약하기</a>
      </div>
      <div class="sys-board" id="boardWrap">
        <h2 class="sys-h">빈 시간 보기</h2>
        <div class="sys-chips" id="days"></div>
        <div id="board" aria-live="polite"></div>
        <p class="sys-legend" aria-hidden="true"><span class="is-free">빈 시간</span><span class="is-taken">예약됨</span><span class="is-past">지난 시간</span></p>
      </div>
      <form id="whoForm" class="sys-section">
        <h2 class="sys-h">로그인하고 예약하기</h2>
        <div class="sys-row">
          <label class="sys-field"><span>수강 ID</span><input name="memberId" autocomplete="username" autocapitalize="characters" spellcheck="false" required></label>
          <label class="sys-field"><span>비밀번호 4자리</span><input name="pin" type="password" inputmode="numeric" autocomplete="current-password" pattern="[0-9]{{4}}" maxlength="4" required></label>
        </div>
        <button class="sys-btn" type="submit">로그인</button>
        <p class="sys-note">수강 ID는 학원에서 발급해드려요. 비밀번호를 잊었으면 학원에 문의해주세요.</p>
        <p class="sys-msg" id="whoMsg" role="status"></p>
      </form>
      <div id="bookArea" class="sys-section" hidden>
        <p><strong id="hello"></strong> <button class="sys-link" type="button" id="switchUser">로그아웃</button></p>
        <div class="sys-section">
          <h2 class="sys-h">내 예약</h2>
          <ul class="sys-list" id="myList"></ul>
        </div>
        <div class="sys-section">
          <h2 class="sys-h">새 예약</h2>
          <p class="sys-note" id="rules"></p>
          <div id="rooms"></div>
          <div class="sys-pick">
            <span class="sys-pick__label" id="pickLabel">연습실과 시작 시간을 골라주세요.</span>
            <select id="hours" aria-label="이용 시간" disabled></select>
            <button class="sys-btn" type="button" id="bookBtn" disabled>예약하기</button>
          </div>
          <p class="sys-msg" id="bookMsg" role="status"></p>
        </div>
      </div>
    </section>
  </div>
"""

# ---------- CONSULT (reference 800x450) ----------
consult_icons = "\n".join([
    icon(97, 110, 48, 48, "유튜브", YT, globe_svg(), scene="youtube"),
    thumb(70, 248, 37, 37, 1, "무대.jpg", scene="stage"),
    thumb(128, 320, 37, 38, 2, "레슨.jpg", scene="lesson"),
    thumb(709, 205, 43, 50, 8, "데뷔.jpg", scene="debut"),
    icon(641, 338, 58, 48, "내 폴더", "booking.html", FOLDER, scene="me"),
])

consult = (head("Consult | 이송희보컬레슨",
                "이송희보컬레슨 무료 상담 신청. 연락처를 남겨주시면 카카오톡 채널로 안내드립니다.")
           + f'<main class="stage wall consult" style="background-image:url(\'{img(0)}\')">\n'
           + nav("consult", "light") + "\n"
           + '  <div class="icons">\n' + consult_icons + "\n  </div>\n"
           + CONSULT_FORM
           + scenes("youtube", "stage", "lesson", "debut") + MY_FOLDER
           + "</main>\n" + foot("consult", "scene", "mynotes"))

# ---------- BOOKING (practice rooms, paper theme) ----------
booking = (head("Booking | 이송희보컬레슨",
                "이송희보컬레슨 수강생 연습실 예약. 365일 24시간 연습실을 사전예약제로 운영합니다.")
           + '<main class="stage booking">\n'
           + nav("booking", "dark") + "\n"
           + BOOKING_APP
           + "</main>\n" + foot("booking"))

out = {"index.html": home, "about.html": about, "contact.html": contact, "consult.html": consult, "booking.html": booking}
target = sys.argv[1] if len(sys.argv) > 1 else REPO
for name, html in out.items():
    with open(os.path.join(target, name), "w") as f:
        f.write(html)
missing = sorted(set(range(20)) - set(IMG))
print("wrote", ", ".join(out), "| missing images:", missing or "none")
