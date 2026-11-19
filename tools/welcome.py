"""신규 수강 안내 (welcome.html) — 첫 레슨 전에 보는 안내 (원장님 2026-11-19).

원장님이 만든 안내 그림("이송희보컬레슨 신규 수강 안내")을 글 페이지로 옮긴 것.
첫 레슨 알림톡의 버튼("신규 수강 안내 보기")이 이 페이지를 엶 — 그림은 알림톡 안에 그대로 못 넣어서.
문구는 그림 그대로, 홈페이지와 다른 곳만 지금 규칙으로 고침:
  · "<일정, 공지>" → 공지 탭 (일정 · 공지가 따로, 규정은 공지 탭 "학원 규정 · 안내")
  · "하루 최대 2시간까지 선예약" → 한 번에 최대 2시간 (횟수 제한 없이 이어서)
  · "하루 전 또는 당일" → 오늘 · 내일 (밤 12시에 다음 날이 열림)
예약 규칙 · 내 폴더 탭 이름이 바뀌면 여기도 같이 고치기. 누구나 열 수 있지만 검색에는 안 나오게(noindex) · 메뉴에 없음."""

KAKAO = "https://pf.kakao.com/_xgNYbK"


def steps(*names):
    """초록 알약 줄: 회원가입 → 내 폴더 → 공지"""
    return '<span class="wel__path">' + '<span class="wel__arrow" aria-hidden="true">→</span>'.join(
        f'<b class="wel__pill">{n}</b>' for n in names) + "</span>"


# (번호, 제목, [(아이콘, 본문 html), …], 바로 가기 (글자, 주소) 목록)
PARTS = [
    ("1", "공지사항 확인 방법", [
        ("💻", "모든 공지사항은 <mark>학원 홈페이지</mark>에서 확인하실 수 있어요."
               + steps("카카오 로그인", "내 폴더", "공지")
               + '<small class="wel__small">처음 로그인하면 이름 · 담당 선생님을 보내고, 실장님이 확인하면 열려요 (보통 하루 안).</small>'),
        ("📌", "<b>공지</b> 탭의 \"학원 규정 · 안내\"에 <mark>강의 규정 · 보강 및 레슨 공지</mark> 등 꼭 필요한 내용이 안내되어 있습니다."),
        ("✅", '<strong class="wel__red">첫 레슨 시작 전 꼭! 확인 부탁드립니다.</strong>'),
    ], [("내 폴더 열기", "index.html#me"), ("홈페이지 사용법", "guide.html")]),
    ("2", "연습실 예약 안내", [
        ("💻", "연습실 예약은 <mark>학원 홈페이지</mark>에서 진행됩니다." + steps("학원 홈페이지", "practice room 클릭")),
        ("🎤", "<mark>보컬 연습실 · 액팅 연습실(C홀)</mark><br>한 번에 최대 2시간까지 예약 가능합니다."),
        ("🔁", "예약한 뒤에도 <mark>1~2시간씩</mark><br>계속 이어서 예약하실 수 있어요."),
        ("📅", "예약은 <mark>오늘 · 내일</mark> 것만 가능하며 (매일 밤 12시에 다음 날이 열려요)<br>원하실 때 예약 후 편하게 이용하시면 됩니다."),
    ], [("연습실 예약하기", "booking.html")]),
    ("3", "첫 레슨 준비", [
        ("🎵", "레슨 희망곡 <mark>2곡 정도, 1절까지</mark><br>준비해 오시면 됩니다."
               '<small class="wel__small">※ MR, 무반주 둘 다 준비해주시면 좋습니다.</small>'),
        ("⏰", '대기 공간이 협소하여<br><strong class="wel__red">정확한 레슨 시간에 맞춰 방문 부탁드립니다.</strong>'),
        ("🔐", "지문 출입 시스템으로 문이 잠겨 있어요.<br><mark>2층 도착 후 연락</mark> 주시면 바로 열어드립니다."),
    ], []),
]


def body():
    parts = ""
    for n, title, rows, links in PARTS:
        cards = "".join(
            f'''      <div class="wel__row">
        <span class="wel__icon" aria-hidden="true">{icon}</span>
        <div class="wel__text">{text}</div>
      </div>
''' for icon, text in rows)
        go = ("      <p class=\"wel__go\">" + "".join(f'<a class="wel__btn" href="{h}">{t} →</a>' for t, h in links) + "</p>\n") if links else ""
        parts += f'''    <section class="wel__part">
      <h3 class="wel__h"><span class="wel__bell" aria-hidden="true">🔔<i>{n}</i></span><span>{title}</span></h3>
{cards}{go}    </section>
'''
    return f"""  <article class="wel">
    <h1 class="wel__title">이송희보컬레슨 신규 수강 안내</h1>
    <p class="wel__lede">첫 레슨 전에 천천히 확인해주세요 ♡</p>
{parts}    <section class="wel__last">
      <p>홈페이지 내 폴더 <b>공지</b>의</p>
      <p class="wel__blue">'강의 규정'과 '보강 공지'를<br>꼭 정독하신 후<br>확인 답변 부탁드립니다!</p>
      <p class="wel__go"><a class="wel__btn" href="about.html#rules">강의 규정 보기 →</a><a class="wel__btn" href="{KAKAO}/chat" target="_blank" rel="noopener">카카오톡으로 답변하기 →</a></p>
      <p class="wel__bye">궁금하신 점은 언제든 편하게 남겨주세요 🍀</p>
    </section>
  </article>
"""
