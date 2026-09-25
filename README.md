# 이송희보컬레슨 홈페이지

강남 선릉역 1:1 보컬학원 이송희보컬레슨 홈페이지.

**시스템과 디자인을 분리한 구조**입니다. 문구·목록·예약 같은 데이터와 기능은 구글시트 + 앱스스크립트가 맡고,
HTML/CSS는 그걸 보여주는 "테마"라서 디자인을 바꿔도 기능은 그대로 둘 수 있습니다.

## 구조

```
index.html        home    — 블러 인물사진 배경 + 바탕화면 아이콘
about.html        about   — "our vocal classes", 폴더 3개(오디션·입시 / 전문 / 취미)
contact.html      contact — "let's connect" + 폴더 콜라주
consult.html      consult — 상담 신청 (전화 / 방문 상담 / 체험 레슨 예약)
booking.html      booking — 수강생 연습실 예약

css/style.css     테마(디자인). 새 시안이 오면 이 파일과 HTML 틀만 바꾸면 됩니다
css/system.css    기능 화면(폼·예약 버튼 등) 기본 스타일. 테마가 --sys-* 변수로 덮어쓸 수 있음
js/config.js      앱스스크립트 웹 앱 주소 (비어 있으면 예약·상담은 카카오톡 안내로 대체)
js/api.js         서버 통신
js/content.js     data-content / data-list 가 붙은 요소를 콘텐츠 시트 값으로 채움
js/consult.js     상담 신청
js/booking.js     연습실 예약

backend/          구글시트에 붙이는 앱스스크립트 코드 + 설치 안내 (backend/README.md)
tools/build_pages.py  HTML 5개를 생성하는 스크립트 (페이지 수정은 여기서)
tools/dev-server.js   배포 없이 예약·상담까지 미리보기: node tools/dev-server.js
```

### 디자인을 바꿀 때 지켜야 할 것

새 테마의 HTML에 아래만 유지하면 기능이 그대로 붙습니다.

- 문구: `data-content="키"` (키 목록은 구글시트 **콘텐츠** 탭)
- 목록: `<ul data-list="results|pricing" data-group="입시">` 안에 `<template>` + `data-field`
- 상담 폼: `id="consultForm"` 안의 name, phone, track, method, message, website 입력칸과 `#slotPicker`, `#consultMsg`
- 연습실 예약: `id="bookingApp"` 블록 (tools/build_pages.py의 BOOKING_APP 그대로)
- 스크립트: config.js → api.js → content.js → (consult.js | booking.js)

## 실행 · 테스트

```bash
node tools/dev-server.js               # http://localhost:8020 (체험 로그인: 김시우 / 5678)
node --test backend/test/*.test.js     # 예약 규칙 + 서버 API 테스트
python3 tools/build_pages.py           # HTML 다시 생성
```

페이지 좌표는 레퍼런스 스크린샷(가로 800 기준)을 단위로 씁니다. CSS의 `calc(120 * var(--s))`는
"레퍼런스에서 120px"이라는 뜻입니다. 휴대폰 폭(760px 이하)에서는 각 페이지가 세로로 재배치됩니다.

## 사진

사진 20장은 Higgsfield(Soul 2.0)로 생성했고, 지금은 Higgsfield CDN 주소를 직접 연결하고 있습니다.
CDN 파일이 지워지면 사진도 사라지니, 가능하면 파일을 받아 저장소에 넣는 걸 권장합니다.

사진 교체 방법: `tools/images.json`의 주소를 바꾸고 `python3 tools/build_pages.py` 실행.
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

합격실적 목록, 커리큘럼 4 STEP, 수강료 표, 원장 프로필, 오시는 길은 4페이지 레이아웃에 자리가 없어
지금은 빠져 있습니다. 이전 버전은 git 기록(`afeb018`)에 남아 있습니다.
