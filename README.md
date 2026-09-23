# 이송희보컬레슨 홈페이지

강남 선릉역 1:1 보컬학원 이송희보컬레슨 홈페이지 (정적 HTML/CSS/JS, 빌드 도구 없음).

레퍼런스 시안 4장(home / about / contact / subscribe)의 레이아웃을 그대로 옮긴 4페이지 구성입니다.
글자만 학원 내용으로 바꿨고, subscribe 페이지는 상담 신청(consult)으로 바꿨습니다.

## 실행 방법

```bash
python3 -m http.server 8000
# http://localhost:8000 접속
```

## 구조

```
index.html      home    — 블러 인물사진 배경 + 바탕화면 아이콘
about.html      about   — "our vocal classes", 폴더 3개(오디션·입시 / 전문 / 취미)
contact.html    contact — "let's connect" + 폴더 콜라주
consult.html    consult — 상담 신청 모달 (카카오톡 채널로 연결)
css/style.css   전체 스타일
js/main.js      상담 폼 처리
tools/build_pages.py  4개 HTML을 생성하는 스크립트
tools/images.json     사진 번호 → 주소 목록
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
