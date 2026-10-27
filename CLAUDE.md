# 작업 규칙 (Claude용)

## 미리보기 아티팩트 — 모든 변경마다 올리기
원장님은 배포 전에 혼자 아티팩트로 보면서 작업합니다. **요청받은 변경은 하나도 빠짐없이 아티팩트에 반영해서 올립니다.**

- 작업 현황 아티팩트: https://claude.ai/artifact/CE3wYoVrkMxH1DbmjR5cpS (비공개, "이송희보컬레슨 작업 현황")
- 올리는 순서:
  1. `python3 tools/build_pages.py` (페이지를 고쳤다면)
  2. `python3 tools/build_preview.py <스크래치 폴더>/preview` — 체험 모드 사본 (js/demo.js, 가짜 데이터)
  3. Artifact 도구로 `preview/index.html` 게시, `url`은 위 주소, `root`는 preview 폴더, `files`에 나머지 파일 전부
     (다른 html 5개, css/*, js/*, assets/img/*)
- 예전 레트로 시안 아티팩트(VLT52RjsQ56ofw8tPRwCiA)는 구버전이라 여기엔 쓰지 않습니다.
- 올린 뒤 링크를 알려주고 "새로고침하면 보여요"라고 말합니다.

## Supabase (2026-10-27 연결)
- 프로젝트 **LeeshVocal**, ref `lsdmokkecmymtxpmiwbm`, 지역 도쿄(ap-northeast-1, 서울 대신 그대로 쓰기로 함), 조직 "리쉬보컬" 무료 요금제. 주인 favort1111@gmail.com.
- `supabase/schema.sql`을 마이그레이션 `leesh_initial_schema` + `leesh_hardening`(pg_net을 extensions로, rls_auto_enable 실행 권한 회수)으로 설치함. `js/config.js`에 주소와 **publishable 키만** 넣음.
- Claude 접근: 환경 **Network secrets**에 Bearer 토큰(호스트 `api.supabase.com`, 90일 기한, 최소 권한)이 들어 있어서 Management API(`/v1/projects/<ref>/database/query`, `/database/migrations`, `/advisors/security`, `/api-keys`)를 바로 호출할 수 있음. 토큰 값은 보지도, 저장하지도 않음.
  토큰으로 **못 하는 것**: Auth 설정 변경(`project_admin_write` 필요), 사용자 만들기 → 원장님이 대시보드에서.
- 지우기·되돌리기 어려운 작업은 원장님께 먼저 묻고, 큰 변경 전에는 백업. 설정을 바꾼 뒤에는 결과를 확인하고 다음 단계로 (2026-10-27, 확인 없이 가입 시험을 보내 시험 계정이 생겼던 일이 있음 → 바로 삭제).
- 2026-10-27 완료: 새 가입 막기(원장님), 관리자 favort1111@gmail.com 등록, 방 이름 **B1~B5(연습실) · C hall(춤연습실)**, 마이그레이션 `leesh_first_pin_change`(0000 = 임시 비밀번호, 첫 로그인 때 `member_change_pin`으로 바꿔야 예약·내 폴더 사용).
- 수강생 명단 원본: 구글시트 "학생관리 통합 관리자"의 **수강ID 관리** 탭 (E001~). **읽기만, 절대 수정 금지** (원장님 지시). 아직 Supabase에 넣지 않음:
  E번호가 학원 규모를 드러내서 로그인 방식(휴대폰 번호 / 무작위 코드) 결정 대기 중.

## 배포·병합
- **순서: 만들기가 먼저, 배포는 나중.** 지금은 운영 전입니다. 필요한 메뉴를 다 짠 뒤에 Supabase 연결 → 테스트 → 배포 순서로 갑니다.
- main 병합은 원장님이 말할 때만 합니다.
- 수강료 내용은 넣지 않습니다.

## 도메인
- `leeshlesson.com` — **카페24(cafe24)**에 등록되어 있음 (원장님 확인, 2026-09-29).
- 카페24에 **SSD 가상서버 일반형**도 있음: 2025.08.06 ~ 2027.08.05, 자동연장 꺼짐, IP 222.239.250.204. leeshlesson.com이 여기에 연결됨.
  추천: 서버 대신 GitHub Pages + Supabase로 가고, 서버는 2027년 만료 때 연장하지 않음. 도메인은 따로 자동연장 켜기.
  서버 root 비밀번호는 받지도, 저장하지도 않음 (배포에 필요 없음). 도메인 만료일 **2027-08-06** (자동연장 결제 예정 2027-08-01, 23,500원). 자동연장은 카드 등록이 필요한데 원장님이 직접 등록.
- 배포할 때: 카페24 **도메인관리 → leeshlesson.com 선택 → 호스트 관리**에서 GitHub Pages로 연결 (A 레코드 185.199.108.153 / .109.153 / .110.153 / .111.153, `www`는 CNAME `favort1111-byte.github.io`),
  저장소에는 `CNAME` 파일 추가 + GitHub Pages 설정에서 사용자 도메인·HTTPS 켜기. 운영 전이라 아직 하지 않음. 원장님은 직접 못 하시므로 캡처를 받아 한 칸씩 안내.
- **배포 날 방법 (원장님과 합의, 2026-09-29):** 원장님이 카페24를 직접 만지지 않음.
  원장님 컴퓨터에 **Claude 데스크톱 앱 + Claude in Chrome 확장**을 설치하고, 원장님은 카페24 로그인만 해둔 뒤
  데스크톱 앱의 Claude가 크롬에서 호스트 관리 값을 입력. 클라우드 세션은 원장님 컴퓨터에 접근할 수 없으므로 이 단계만 데스크톱 앱에서 진행.
  배포 날이 가까워지면 앱·확장 설치부터 먼저 안내. (대안: 네임서버를 Cloudflare로 옮기고 API 토큰으로 관리 — 준비가 많아 보류)

## 보관 자료
- **네이버 블로그(blog.naver.com/o_oa8)가 학원 정보의 원본**입니다 (원장님: "심혈을 기울여 만든 블로그, 웬만한 건 다 사용"). 정리본 `docs/blog.md`, 홈페이지 데이터 `tools/blog_content.py`, 사진 `assets/img/blog/`.
  블로그 접속은 환경 허용 도메인 `*.naver.com`, `*.pstatic.net`이 필요해요 (원장님이 추가함). 블로그 글은 대부분 이미지 안내판이라 직접 읽어서 옮겨야 해요.
- `docs/menu-ideas.md`: 메뉴 아이디어 원본 기록 (GPT 기본표·특색 5개·해외 조사 5개, Claude 아이디어). **메뉴 구성을 논의할 때 먼저 꺼내서 보여줍니다.**
- 메뉴 아이디어 보드 아티팩트: https://claude.ai/artifact/XHhi3x4pqGu8mRmwUb2B3G (원본 `docs/menu-ideas.html`). 아이디어가 추가되면 md와 이 보드를 같이 고쳐서 다시 올립니다.

## 말투
- 설명은 이해하기 쉽고 간단하게, 한국어로.
