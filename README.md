# 이송희보컬레슨 홈페이지

강남 선릉역 1:1 보컬학원 이송희보컬레슨 홈페이지.

**시스템과 디자인을 분리한 구조**입니다. 연습실 예약·상담 신청은 Supabase 데이터베이스가 맡고,
HTML/CSS는 그걸 보여주는 "테마"라서 디자인을 바꿔도 기능은 그대로 둘 수 있습니다.
(선생님 수업 예약용 구글시트와는 별개입니다)

## 구조

```
index.html        home    — 블러 인물사진 배경 + 바탕화면 아이콘
about.html        about   — "our vocal classes", 폴더 3개(오디션·입시 / 전문 / 취미)
contact.html      contact — "let's connect" + 폴더 콜라주
consult.html      consult — 상담 신청 (전화 / 방문 상담 / 체험 레슨)
booking.html      booking — 연습실 예약 (수강 ID 로그인, 연습실 5개 + 춤연습실)
admin.html        관리자  — 예약 현황, 수강 ID, 상담 신청, 설정 (메뉴에는 안 보이는 주소)

css/style.css     테마(디자인). 새 시안이 오면 이 파일과 HTML 틀만 바꾸면 됩니다
css/system.css    기능 화면(폼·예약 버튼 등) 기본 스타일. 테마가 --sys-* 변수로 덮어쓸 수 있음
css/admin.css     관리자 화면
js/config.js      Supabase 주소와 공개 키 (비어 있으면 예약은 카카오톡 안내, 상담은 카카오톡으로 복사)
js/api.js         데이터베이스 통신
js/consult.js     상담 신청
js/booking.js     연습실 예약
js/admin.js       관리자 화면

supabase/         데이터베이스 설계(schema.sql) + 연결 안내 (supabase/README.md) + 테스트
assets/img/       사진 20장 (번호는 아래 표)
tools/build_pages.py  HTML 5개를 생성하는 스크립트 (페이지 문구·내용 수정은 여기서)
tools/dev-server.js   계정 없이 예약·관리자까지 미리보기: node tools/dev-server.js
tools/build_preview.py  체험 모드 사본 만들기 (가짜 데이터, 비공개 아티팩트 미리보기용 · js/demo.js)
```

### 디자인을 바꿀 때 지켜야 할 것

새 테마의 HTML에 아래만 유지하면 기능이 그대로 붙습니다.

- 상담 폼: `id="consultForm"` 안의 name, phone, track, method, wish(`#consultWish`), message, website 입력칸과 `#consultMsg`
- 연습실 예약: `id="bookingApp"` 블록 (tools/build_pages.py의 BOOKING_APP 그대로)
- 스크립트: config.js → api.js → (consult.js | booking.js)

## 실행 · 테스트

```bash
node tools/dev-server.js               # http://localhost:8020 (예약 S001 / 5678, 관리자 owner@example.com / admin1234)
node --test supabase/test/*.test.js    # 예약 규칙 + 권한 테스트 (Postgres·PostgREST 필요, supabase/README.md)
python3 tools/build_pages.py           # HTML 다시 생성
```

페이지 좌표는 레퍼런스 스크린샷(가로 800 기준)을 단위로 씁니다. CSS의 `calc(120 * var(--s))`는
"레퍼런스에서 120px"이라는 뜻입니다. 휴대폰 폭(760px 이하)에서는 각 페이지가 세로로 재배치됩니다.

## 사진

사진 20장은 Higgsfield(Soul 2.0)로 생성했고, `assets/img/00.webp ~ 19.webp`로 저장소에 들어 있습니다
(웹용으로 줄여서 전체 약 1.7MB). 원본 CDN 주소는 `tools/images_source.json`에 기록만 남겨 두었습니다.

사진 교체 방법: `assets/img/`에 파일을 넣고 `tools/images.json`의 경로를 바꾼 뒤 `python3 tools/build_pages.py` 실행.
HTML을 직접 고치면 다음 빌드 때 덮어써지니 페이지 내용 수정도 `tools/build_pages.py`에서 하세요.

| 번호 | 내용 | 쓰이는 곳 |
|---|---|---|
| 0 | 블러 인물 (배경) | home, consult 배경 |
| 1 | 물가에서 뛰는 사람 | 아이콘 "무대.jpg", contact 폴라로이드 |
| 2 | 데이지와 하늘 | 아이콘 "레슨.jpg" |
| 3 | 핑크 들꽃 블러 | 아이콘 "연습실.jpg", 폴더, 콜라주 |
| 4 | 들판의 여성 | 아이콘 "오디션.jpg", 폴더, 콜라주 |
| 5 | 빨간 배경 흰 꽃 | 아이콘 "합격.jpg", 폴더, 콜라주 |
| 6 | 거실에서 춤추는 두 사람 | 아이콘 "취미반.jpg", 폴더 |
| 7 | 주황 꽃 블러 | 아이콘 "보컬.jpg", 폴더, 콜라주 |
| 8 | 보라 붓꽃 | 아이콘 "데뷔.jpg" |
| 9 | 들판을 달리는 두 사람 | 아이콘 "입시.jpg", 폴더, 콜라주 |
| 10 | 빈티지 마이크 | Audition 폴더 |
| 11 | 노래하는 여성 | Audition 폴더 |
| 12 | 피아노 치는 손 | Hobby 폴더 |
| 13 | 웃는 남성 | Audition 폴더, 콜라주 |
| 14 | 도자기 트로피 | Pro Class 폴더 |
| 15 | 헤드폰 | Audition 폴더 |
| 16 | 분홍 조약돌 | Hobby 폴더 |
| 17 | 금잔화 | Hobby 폴더 |
| 18 | 바닷가의 두 사람 | Pro Class 폴더, 콜라주 |
| 19 | 분홍 배경 남성 | Hobby 폴더 |

## 이전 버전에 있던 내용

합격실적 목록, 커리큘럼 4 STEP, 원장 프로필, 오시는 길은 4페이지 레이아웃에 자리가 없어
지금은 빠져 있습니다. 이전 버전은 git 기록(`afeb018`)에 남아 있습니다.
