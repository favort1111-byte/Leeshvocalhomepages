"""Generate the site pages. Image paths come from images.json; all page text lives here."""
import json, math, os, re, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import blog_content as blog  # facts from the academy's Naver blog
import privacy
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

# 개인정보처리방침 link on every page (the law asks for it to be easy to find, in bold)
LEGAL = ('<footer class="legal"><a href="privacy.html"><b>개인정보처리방침</b></a>'
         f'<span>© 이송희보컬레슨 · {blog.DIRECTIONS["address"]}</span></footer>\n')

def foot(*extra):
    scripts = ["config", "api"] + list(extra)
    return LEGAL + "".join(f'<script src="js/{n}.js"></script>\n' for n in scripts) + "</body>\n</html>\n"


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

# 게임.exe on the desktop: a pixel game pad
GAME_ICON = ('<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">'
             '<path d="M3 4h10v1h1v1h1v5h-1v1h-3v-1h-1v-1H6v1H5v1H2v-1H1V6h1V5h1z" fill="#1E1A18"/>'
             '<path d="M3 5h10v1h1v5h-2v-1h-1V9H5v1H4v1H2V6h1z" fill="#F2C14E"/>'
             '<path d="M4 6h1v1h1v1H5v1H4V8H3V7h1z" fill="#6E3B28"/>'
             '<rect x="11" y="6" width="1" height="1" fill="#C0392B"/><rect x="12" y="7" width="1" height="1" fill="#2E6B45"/>'
             '<rect x="10" y="7" width="1" height="1" fill="#1D6FB8"/><rect x="11" y="8" width="1" height="1" fill="#E07A3F"/>'
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
    target = ""
    if scene == "me":  # the student folder opens in place (js/scene.js); the #anchor keeps it reachable without JS
        href, target = "#scene-me", ' data-scene="scene-me" aria-haspopup="dialog"'
    elif scene:
        href, external = ICON_LINKS[scene]
    if external:
        target = ' target="_blank" rel="noopener"'
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


# ---------- where each desktop icon goes ----------
# Icons open their detail straight away (원장님 2026-10-18: no photo scene in between).
# These are the pages the old scenes' "자세히" buttons pointed to.
ICON_LINKS = {
    "results": ("about.html#results", False),
    "stage": ("about.html#teacher", False),
    "lesson": ("about.html#steps", False),
    "room": ("booking.html", False),
    "audition": ("about.html#care", False),
    "voice": ("consult.html", False),
    "hobby": ("about.html#tips", False),
    "exam": ("consult.html", False),
    "debut": ("about.html#care", False),
    "youtube": (YT, True),
    "map": (MAP, True),
}


# The folder on the desktop is the student's own folder: 수강 ID login, then 레슨 노트 / 월말평가 (js/mynotes.js).
MY_FOLDER = """  <section class="scene scene--book" id="scene-me" role="dialog" aria-label="내 폴더" hidden>
    <div class="scene__photo"></div>
    <button class="scene__back" type="button" data-leave>← 바탕화면</button>
    <div class="book" id="myBook">
      <div class="book__login sys" id="myLogin" aria-live="polite"></div>
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
    icon(590, 352, 44, 44, "게임.exe", "games.html", GAME_ICON),
])

# Each icon gets --i, which staggers its pop-in after the intro and its float on the desktop.
_n = iter(range(100))
home_icons = re.sub(r'(<a class="icon" [^>]*?style=")', lambda m: m.group(1) + f"--i:{next(_n)};", home_icons)


# ---------- motion: the screen switching on (first visit), then a desktop that breathes ----------
def boot_intro():
    """Old monitor switching on: a line of light opens into the screen, the name, a voice level meter.
    Pure CSS timing (css/style.css .boot); js/intro.js only skips it (seen before, link, tap)."""
    n = 31
    bars = "".join(
        f'<i style="--k:{k};--h:{0.18 + 0.82 * abs(math.sin(k * 0.73) * math.sin(k * 0.21 + 0.4)) * math.sin(math.pi * (k + 0.5) / n) ** 0.6:.2f}"></i>'
        for k in range(n))
    return ('  <div class="boot" id="boot" aria-hidden="true">\n'
            '    <div class="boot__screen">\n'
            '      <p class="boot__en">LEESH VOCAL LESSON</p>\n'
            '      <p class="boot__ko">이송희보컬레슨</p>\n'
            f'      <div class="boot__meter">{bars}</div>\n'
            '      <p class="boot__sub">강남 선릉역 · 1:1 보컬</p>\n'
            '    </div>\n'
            '    <p class="boot__skip">탭하면 넘어가요</p>\n'
            '  </div>\n'
            '  <script src="js/intro.js"></script>\n')


def wave_path(period, amp, phase, env_phase):
    """A voice-like line across 1600 units. Every component repeats within 800 units,
    so sliding it left by half (CSS) loops without a seam."""
    pts = []
    for x in range(0, 1601, 8):
        env = 0.55 + 0.45 * math.sin(2 * math.pi * x / 800 + env_phase)
        y = 60 + amp * env * (math.sin(2 * math.pi * x / period + phase) + 0.35 * math.sin(2 * math.pi * x / 400 + phase * 2))
        pts.append(f"{x},{y:.1f}")
    return "M" + " L".join(pts)


def wavebed():
    layers = [(160, 26, 0.0, 0.0, 22, 7, 0.7), (100, 18, 1.3, 2.1, 15, 5, 0.45), (200, 34, 2.4, 4.0, 31, 9, 0.3)]
    out = []
    for period, amp, ph, eph, dur, breath, op in layers:
        out.append(f'    <div class="wavebed__line" style="--dur:{dur}s;--breath:{breath}s;--o:{op}">'
                   f'<svg viewBox="0 0 1600 120" preserveAspectRatio="none"><path d="{wave_path(period, amp, ph, eph)}"/></svg></div>\n')
    return '  <div class="wavebed" aria-hidden="true">\n' + "".join(out) + "  </div>\n"


home = (head("이송희보컬레슨 | 강남 선릉역 1:1 보컬학원",
             "강남 선릉역 1:1 보컬학원 이송희보컬레슨. 대형 기획사 보컬 트레이너 원장의 오디션·입시·전문·취미반.")
        + f'<main class="stage wall wall--live" style="background-image:url(\'{img(0)}\')">\n'
        + boot_intro()
        + SR.format("이송희보컬레슨 — 강남 선릉역 1:1 보컬학원") + "\n"
        + nav("home", "light") + "\n"
        + wavebed()
        + '  <div class="icons">\n' + home_icons + "\n  </div>\n" + MY_FOLDER + "</main>\n" + foot("scene", "signin", "mynotes"))

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
         + about_groups + "\n</main>\n" + blog.about_sections() + foot())

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
           + "</main>\n" + blog.find_us_section() + foot())

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
    <small>번호는 상담 안내에만 사용돼요. <a href="privacy.html">개인정보처리방침</a></small>
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
      <div id="whoBox" class="sys-section" aria-live="polite"></div>
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
           + MY_FOLDER
           + "</main>\n" + foot("consult", "scene", "signin", "mynotes"))

# ---------- BOOKING (practice rooms, paper theme) ----------
booking = (head("Booking | 이송희보컬레슨",
                "이송희보컬레슨 수강생 연습실 예약. 365일 24시간 연습실을 사전예약제로 운영합니다.")
           + '<main class="stage booking">\n'
           + nav("booking", "dark") + "\n"
           + BOOKING_APP
           + "</main>\n" + foot("signin", "booking"))

# ---------- GAMES: 보컬 오락실 (js/games.js) ----------
GAME_LIST = [
    ("fly", "🎤", "목소리로 날아라", "높은 소리는 위로, 낮은 소리는 아래로. 목소리로 새를 날려요.", "음정 조절"),
    ("pitch", "🎹", "음정 퀴즈", "두 소리 중 더 높은 쪽은? 맞힐수록 어려워져요.", "귀 훈련"),
    ("rhythm", "🥁", "리듬 탭", "박자에 맞춰 톡톡. 빠른지 늦은지 알려줘요.", "박자감"),
    ("breath", "💨", "숨 참기 챌린지", "한 음으로 '아~' 얼마나 길게 할 수 있을까?", "호흡"),
]

def game_window(gid, title, body):
    return (f'    <section class="game" data-panel="{gid}" hidden aria-label="{title}">\n'
            f'      <header class="game__bar"><span class="game__dots" aria-hidden="true"><i></i><i></i><i></i></span>'
            f'<h2>{title}.exe</h2><button type="button" class="game__close" data-close aria-label="닫기">✕</button></header>\n'
            f'      <div class="game__body">\n{body}'
            f'        <div class="game__result" role="status" hidden></div>\n'
            f'      </div>\n    </section>\n')

GAMES_BODY = {
    "fly": """        <div class="game__screen">
          <canvas aria-label="게임 화면"></canvas>
          <div class="game__overlay">
            <p class="game__msg"></p>
            <div class="game__row">
              <button type="button" class="game__btn" data-start="voice">🎤 목소리로 하기</button>
              <button type="button" class="game__btn game__btn--ghost" data-start="tap">👆 터치로 하기</button>
            </div>
          </div>
        </div>
        <p class="game__note">목소리는 이 기기 안에서만 쓰이고, 녹음되거나 어디로 보내지지 않아요. 이어폰을 끼면 더 잘 돼요.</p>
""",
    "pitch": """        <div class="pitch">
          <p class="pitch__lives" aria-label="남은 기회">♥♥♥</p>
          <p class="pitch__level"></p>
          <p class="pitch__status" role="status"></p>
          <div class="game__row pitch__choices">
            <button type="button" class="game__btn pitch__choice" data-answer="1" disabled>첫 번째 소리</button>
            <button type="button" class="game__btn pitch__choice" data-answer="2" disabled>두 번째 소리</button>
          </div>
          <div class="game__row">
            <button type="button" class="game__btn" data-start>시작</button>
            <button type="button" class="game__btn game__btn--ghost" data-replay>🔁 다시 듣기</button>
          </div>
        </div>
""",
    "rhythm": """        <div class="rhythm">
          <fieldset class="game__row rhythm__opts">
            <legend class="sr-only">빠르기</legend>
            <label><input type="radio" name="bpm" value="80"> 느리게</label>
            <label><input type="radio" name="bpm" value="100" checked> 보통</label>
            <label><input type="radio" name="bpm" value="120"> 빠르게</label>
            <label class="rhythm__quiet"><input type="checkbox" name="quiet"> 후반 8박은 소리 끄기 (도전)</label>
          </fieldset>
          <p class="rhythm__grade" aria-live="polite">준비</p>
          <button type="button" class="rhythm__pad" aria-label="박자에 맞춰 누르기">TAP</button>
          <p class="rhythm__dots" aria-hidden="true"></p>
          <div class="game__row">
            <button type="button" class="game__btn" data-start>시작 (4박 세고 시작해요)</button>
          </div>
          <p class="game__note">PC는 스페이스바로도 돼요. 소리가 나는 순간에 맞춰 누르세요.</p>
        </div>
""",
    "breath": """        <div class="breath">
          <p class="breath__secs">0.0</p>
          <p class="breath__unit">초</p>
          <p class="breath__medal">10초면 동메달</p>
          <div class="breath__graph"><canvas aria-label="음높이 그래프"></canvas></div>
          <p class="breath__status" role="status">숨을 크게 들이쉬고, 편한 음으로 '아~' 길게 내 보세요. 선이 평평할수록 안정적이에요.</p>
          <div class="game__row">
            <button type="button" class="game__btn" data-start>🎤 시작</button>
          </div>
          <p class="game__note">🥉 10초 · 🥈 15초 · 🥇 20초 · 👑 25초 · 목소리는 이 기기 안에서만 쓰여요.</p>
        </div>
""",
}

games_menu = "\n".join(
    f'      <li><button type="button" class="arcade__cart" data-game="{gid}" aria-pressed="false">'
    f'<span class="arcade__emoji" aria-hidden="true">{emo}</span><b>{name}</b><span>{desc}</span>'
    f'<small class="arcade__tag">{tag}</small><small class="arcade__best" data-best="{gid}"></small></button></li>'
    for gid, emo, name, desc, tag in GAME_LIST)

games_page = (head("보컬 오락실 | 이송희보컬레슨", "이송희보컬레슨 미니게임: 목소리로 날아라, 음정 퀴즈, 리듬 탭, 숨 참기 챌린지.")
              .replace("</head>", '<link rel="stylesheet" href="css/games.css">\n</head>')
              + '<main class="stage arcade-page">\n'
              + nav("games", "light") + "\n"
              + '  <div class="arcade" id="arcade">\n'
              + '    <header class="arcade__head">\n'
              + '      <p class="arcade__kicker">mini games</p>\n'
              + '      <h1>보컬 오락실</h1>\n'
              + '      <p>놀면서 귀랑 목소리를 깨워요. 기록은 이 기기에만 저장돼요.</p>\n'
              + '    </header>\n'
              + f'    <ul class="arcade__menu">\n{games_menu}\n    </ul>\n'
              + "".join(game_window(gid, name, GAMES_BODY[gid]) for gid, _, name, _, _ in GAME_LIST)
              + '    <p class="arcade__more">진짜 노래 실력은 레슨에서 키워요 → <a href="about.html#steps">커리큘럼 보기</a> · <a href="consult.html">상담 신청</a></p>\n'
              + "  </div>\n"
              + "</main>\n" + foot("games"))

# ---------- PRIVACY (paper theme, like booking) ----------
privacy_page = (head("개인정보처리방침 | 이송희보컬레슨", "이송희보컬레슨 홈페이지 개인정보처리방침.")
                + '<main class="stage booking">\n'
                + nav("privacy", "dark") + "\n"
                + '  <div class="booking__inner">\n' + privacy.body() + "  </div>\n"
                + "</main>\n" + foot())

out = {"privacy.html": privacy_page, "index.html": home, "about.html": about, "contact.html": contact, "consult.html": consult, "booking.html": booking, "games.html": games_page}
target = sys.argv[1] if len(sys.argv) > 1 else REPO
for name, html in out.items():
    with open(os.path.join(target, name), "w") as f:
        f.write(html)
missing = sorted(set(range(20)) - set(IMG))
print("wrote", ", ".join(out), "| missing images:", missing or "none")
