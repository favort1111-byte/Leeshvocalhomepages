"""신규 수강 안내 (welcome.html) — 수강 등록하면 보내는 "신규 수강 안내" 알림톡의 버튼이 여는 페이지.

원장님 2026-11-20 "신규 강의 자동카톡 보낼 때 첨부파일 2개도 같이" → 알림톡에는 그림 두 장을 그대로 못 붙여서
(알림톡 그림은 가로 배너 한 장만), 버튼("신규 수강 안내 보기")을 누르면 원장님이 만든 그림 두 장이 그대로 보이게 함:
  ① 신규 수강 안내 (공지 확인 방법 · 연습실 예약 안내 · 첫 레슨 준비)  assets/img/welcome/new-student-2026-11.webp
  ② 강의 규정 안내 (보강 신청 · 스케줄 변경 및 결석 · 협조)            assets/img/welcome/course-rules-2026-11.webp
그림을 바꾸면 새 파일 이름으로 넣고 아래 IMAGES만 고치기 (알림톡은 다시 신청할 필요 없음 — 버튼 주소가 그대로라서).
(2026-11-19 ~ 11-20 아침엔 그림 ①을 글로 옮겨 적은 페이지였음 — git 기록에.)
누구나 열 수 있지만 검색에는 안 나오게(noindex) · 메뉴에 없음."""

KAKAO = "https://pf.kakao.com/_xgNYbK"

IMAGES = [
    ("assets/img/welcome/new-student-2026-11.webp", 1080, 2839,
     "이송희보컬레슨 신규 수강 안내 — 공지사항 확인 방법(학원 홈페이지 → 내 폴더 → 공지), 연습실 예약 안내(학원 홈페이지에서 예약), "
     "첫 레슨 준비(희망곡 2곡 1절까지 · MR과 무반주 · 레슨 시간에 맞춰 방문 · 2층 도착 후 연락)"),
    ("assets/img/welcome/course-rules-2026-11.webp", 1080, 2087,
     "이송희보컬레슨 강의 규정 안내 — 보강 신청(최소 7일 전 알림 · 병결 포함 월 1회 · 차주 진행 · 확정 후 재보강 불가), "
     "스케줄 변경 및 결석(재수강 1회차 전 · 2회 이상 결석 시 결석 처리 · 당일 통보 시 보강 불가), 원활한 레슨을 위한 협조"),
]


def body():
    pics = "".join(
        f'    <img class="wel__img" src="{src}" width="{w}" height="{h}" alt="{alt}" loading="{"eager" if i == 0 else "lazy"}">\n'
        for i, (src, w, h, alt) in enumerate(IMAGES))
    return f"""  <article class="wel">
    <h1 class="wel__sr">이송희보컬레슨 신규 수강 안내</h1>
{pics}    <section class="wel__last">
      <p>홈페이지 내 폴더 <b>공지</b>의</p>
      <p class="wel__blue">'강의 규정'과 '보강 공지'를<br>꼭 정독하신 후<br>확인 답변 부탁드립니다!</p>
      <p class="wel__go"><a class="wel__btn" href="index.html#me">내 폴더 열기 →</a><a class="wel__btn" href="booking.html">연습실 예약하기 →</a><a class="wel__btn" href="guide.html">홈페이지 사용법 →</a><a class="wel__btn" href="{KAKAO}/chat" target="_blank" rel="noopener">카카오톡으로 답변하기 →</a></p>
      <p class="wel__bye">궁금하신 점은 언제든 편하게 남겨주세요 🍀</p>
    </section>
  </article>
"""
