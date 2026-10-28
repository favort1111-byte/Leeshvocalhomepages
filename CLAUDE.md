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
- **관리자 화면** `admin.html`: 주소는 누구나 열 수 있지만 로그인은 `public.admins`에 있는 이메일 + **이메일·비밀번호 로그인**만 (`is_admin`이 provider = email 확인, 마이그레이션 `leesh_admin_email_only`, 2026-10-28). 데이터는 RLS가 막음.
  관리자 **2명** (원장님 + 관리자 1명, 2026-10-28 이메일 초대 → `public.admins`에 추가. 다른 사람 이메일은 저장소에 적지 않기). 더하기: 원장님이 Authentication → Users → Add user → Send invitation → 원장님이 이메일을 직접 말하면 admins에 insert. 빼기: admins에서 delete (원장님께 먼저 확인).
  **비밀번호 정하기/잊었을 때:** 관리자 로그인 화면 "처음이거나 비밀번호를 모르겠어요" → 이메일로 링크(`/auth/v1/recover`, redirect_to = admin.html) → 돌아오면 "새 비밀번호 정하기" (`js/admin.js` mailLink, PUT `/auth/v1/user`). 대시보드 초대 메일 링크는 site_url(leeshlesson.com, 아직 옛 서버)로 가서 못 씀 → 초대한 뒤 이 버튼으로 비밀번호 정하기.
- 2026-10-27 완료: 새 가입 막기(원장님), 관리자 favort1111@gmail.com 등록, 방 이름 **B1~B5(연습실) · C hall(춤연습실)**, 마이그레이션 `leesh_first_pin_change`(0000 = 임시 비밀번호, 첫 로그인 때 `member_change_pin`으로 바꿔야 예약·내 폴더 사용).
- 수강생 명단 원본: 구글시트 "학생관리 통합 관리자"의 **수강ID 관리** 탭 (E001~). **읽기만, 절대 수정 금지** (원장님 지시).
  2026-10-27 시트의 학생 전부 넣음 (상태 재원·휴원·종료 그대로, 메모 "담당 ○○○", 비밀번호 0000 + 첫 로그인 때 바꾸기). 전화번호는 넣지 않음.
  **이 저장소는 공개라서 학생 이름·인원수·학원 규모는 여기(파일·커밋)에 적지 않기.**
- **로그인 방식 (결정, 2026-10-27): 카카오 로그인.** E번호는 학원 규모가 보여서 학생에게 안 보이게.
  학생이 처음 카카오로 로그인 → 이름·담당 선생님 보냄(`link_requests`) → 원장님이 관리자 → 수강 ID 탭 "카카오 연결 요청"에서 승인 → 다음부터 버튼 한 번.
  **수강 ID + 비밀번호 로그인은 없앰** (원장님 2026-10-28 "아예 없애버려"): 화면(`js/signin.js`)에서 빼고, 서버도 `settings.pin_login = false`라 `check_member`가 "카카오로 로그인해주세요"로 막음 (마이그레이션 `leesh_kakao_only`). 그때 수강 ID로 쓰는 사람 0명 확인. 수강 ID는 안쪽 번호로만 씀 (관리자 화면 비밀번호 칸 숨김).
- 카카오 디벨로퍼스 앱 ID 1624560, Redirect URI `https://lsdmokkecmymtxpmiwbm.supabase.co/auth/v1/callback`, 동의항목 닉네임(필수)·프로필 사진(선택)·이메일(필수).
  Supabase Auth: Kakao 켜짐, 새 가입 켜짐(카카오 계정 만들기용, 승인 전엔 아무것도 못 함), site_url https://leeshlesson.com.
  실제 카카오 로그인 시험은 진짜 주소(배포 후)에서만 가능. 배포 때 Redirect URLs에 실제 주소 추가 확인. 카카오 시크릿은 캡처·채팅에 절대 올리지 않기.

## 운영 규칙 (원장님 결정)
- 연습실 예약: 1인당 하루 최대 **2시간** (한 번에도 최대 2시간, 2026-10-27 Supabase settings에 반영). 블로그의 "3시간"은 옛 기준.
- 운영 24시간. 예약은 **당일만** (매일 밤 12시에 그날 예약이 열림, 무한 예약 막기 → `max_days = 0`). 직접 취소는 **시작 1시간 전까지**, 그 뒤엔 학원에 연락 (`cancel_minutes = 60`, 원장님이 3시간 → 1시간으로 바꿈). 자정을 넘기는 예약은 안 됨 (23시 시작은 1시간만) — 원장님이 그대로 두기로 함. 마이그레이션 `leesh_same_day_booking`.
  **이미 시작한 시간은 예약 안 됨** (원장님 2026-10-28, 선생님 의견: 18시가 지났는데 17시 버튼이 보였음): 18:05면 19:00부터 (`rooms_day`·`booking_create`에서 시작 시각 > 지금, 마이그레이션 `leesh_no_started_hour`). 예약 화면은 1분마다·다시 열 때 저절로 새로 고침 (`js/booking.js` refresh).
- 월말평가는 **원장님만** 올림. 분기(3·6·9·12월)마다, 4항목(기본기·보컬 테크닉·액팅·스타일링) 각 10점, 총점 40점 + 단계 6개 (`js/config.js` `evalLevels`).
  원본: 구글드라이브 월말평가 폴더 (1부·2부·영상평가 폴더에 학생마다 `이름1.jpg`(피드백)·`이름2.jpg`(총점 단계) + "○월 월말평가 통합 결과" 시트). **읽기만.** 평가지는 대외비.
  **1차 완성본은 PDF** (원장님). PDF도 올릴 수 있음: 관리자 화면이 `js/vendor/pdfjs`(pdf.js 3.11.174, npm에서 받아 넣음)로 쪽마다 그림으로 바꿔 저장. 파일 이름이 학생 이름이 아니면 쪽에 적힌 "학생명 ○○○"로 학생을 나눔 (여러 학생 PDF 하나도 됨).
  관리자 → 월말평가 탭: PDF·사진 여러 개 + 통합 결과 표 붙여넣기 → 이름으로 학생 자동 매칭 → `eval_reports` 표 + Storage 비공개 버킷 `eval-reports/<수강 ID>/<YYYY-MM>/<쪽>.webp` (마이그레이션 `leesh_eval_reports`).
  학생은 내 폴더에서 점수·단계·평가지 사진을 봄 (로그인이 카카오뿐이라 모두 사진까지 보임). 예전 `monthly_evals`(5항목 1~5점) 표는 안 씀, 지우지 않음.
- **개인정보처리방침** `privacy.html` (원본 `tools/privacy.py`, 모든 페이지 바닥글에 링크). 받는 정보·위탁·국외 이전(Supabase, 일본 도쿄)·보관 기간을 적어둠.
  새 입력칸·서비스(텔레그램 알림, 레슨 노트 켜기 등)를 더하면 이 문서도 같이 고치기. 시행일 `EFFECTIVE`는 오픈 날로 바꾸기.
  책임자 "이송희 (원장)" 확인됨. 보관 기간은 원장님이 "잘 모르겠다" → 초안(1년 / 3개월) 그대로 둠.
  **자동 삭제는 켜지 않음** (원장님 결정, 2026-10-27). `private.cleanup`은 `schema.sql`에만 있고 예약 실행 줄은 주석. 지울 때는 원장님께 묻고 사람이 함.
- 레슨 노트는 **숨김** (선생님 업무가 늘까 봐, 선생님들께 물어본 뒤 결정). 지우지 말 것 — `js/config.js`의 `lessonNotes: true`로 바꾸면 내 폴더·관리자 화면에 다시 나옴. 데이터베이스 표·함수는 그대로.

## 블로그 → 홈페이지 이사 (2026-10-28, 원장님: "블로그 운영 안 할 수도 있어. 블로그 내용 모두 홈페이지로")
- 블로그 글 **전부**를 홈페이지 안으로 옮김. 이제 홈페이지는 블로그에 기대지 않음 (블로그 링크·"블로그 전체 보기" 버튼 없앰, 네이버 블로그 링크도 뺌).
  `tools/import_blog.py CACHE_DIR` → `data/blog/index.json`(목록) + `data/blog/posts/<글번호>.json`(본문 블록) + `data/blog/images.json`,
  `node tools/blog_images.js CACHE_DIR` → `assets/blog-posts/<글번호>/<n>.webp` (800px WebP). 같은 그림이 4개 글 이상 = 배너라 뺌, 5개 글 이상 같은 문단 = 홍보 문구라 뺌, 매 글 끝 공통 문구(상담·카카오·유튜브 안내)·해시태그·수강료 문구도 뺌.
  종류: visit(학원 내방 오디션) · audition(기획사 오디션) · results(합격자 현황, 회사·단계·이니셜 추출) · tips(원포인트 레슨, 유튜브) · curriculum · academy.
- 페이지: `post.html?id=<글번호>` (js/post.js, 글 하나) · audition news `audition.html` · results `results.html` · **tips.html** (원포인트 레슨 영상 + "학원 이야기" 예전 소개 글). about의 원포인트 레슨 링크도 post.html로.
  미리보기 아티팩트는 파일 수 제한 때문에 post.html이 글·사진을 GitHub(raw, 작업 브랜치)에서 읽음 (`tools/build_preview.py` BLOG_BASE).
- 블로그의 기획사 오디션 공고 속 전화번호는 기획사가 공개한 연락처라 그대로 둠.

## 오디션 소식 메뉴 (2026-10-27 추가)
- 메뉴 "audition" 안에 영어 소메뉴 2개 (원장님 2026-10-28): **audition news** `audition.html` (내방 오디션 + 기획사 오디션) · **results** `results.html` (합격자 현황). 첫 화면 오디션.jpg 아이콘은 audition.html로.
- 목록 = 옮겨온 블로그 글 (위 참고) + 학원이 새로 올리는 소식.
- **인스타그램 → 오디션 소식 (2026-10-28):** 요즘 소식은 오디션반 인스타(프로페셔널 계정, 교육)에 먼저 올라감. 원장님은 블로그 글처럼 한 편씩 보이길 원함 (embed iframe은 연결 전까지만 보임).
  Meta 앱 "LeeshVocal Homepage" (원장님 페이스북 계정, Instagram 테스터로 leeshvocal_auditionn 연결). 토큰은 원장님이 **관리자 → 오디션 소식 → 인스타그램 연결**에 붙여넣기 (채팅 금지) → `admin_instagram_connect` → `private.instagram`(비공개)에 저장 + 최근 300개 가져옴.
  `private.ig_sync(pages)`가 http 확장으로 graph.instagram.com에서 글을 받아 `public.ig_posts`(누구나 읽기, hidden 제외)에 넣고, 20일마다 토큰 갱신. 칸은 글 내용으로 추측 (`private.ig_guess`: 합격+축하 → 합격, 내방 → 내방, 합격 → 합격, 오디션 → 오디션, 나머지 → **학원 소식**). 해시태그 규칙 없음, 빠지는 글 없음. 관리자에서 칸 옮기기(kind_fixed)·숨기기.
  페이지: `js/auditions.js`가 각 칸 맨 위에 6개 + 더 보기, `post.html?ig=<id>`가 글 하나. 사진은 `tools/ig_images.py`(GitHub Action `instagram-pictures.yml`)가 `assets/ig/<id>/<n>.webp`로 복사, 복사 전엔 인스타 링크로 보임.
  2026-10-28 연결 완료 (최근 300개, 2026-05~). 캡션마다 학원 홍보 문구·해시태그가 같이 붙어서 `private.ig_clean`으로 빼고 `title`·`body`를 따로 저장. 홍보 영상처럼 내용이 홍보 문구뿐인 글은 처음부터 숨김.
  **같은 제목 글은 한 묶음**(한 달 내방 오디션 포스터 여러 장 → 카드 하나). 학원이 같은 포스터를 3장씩 올리고 홍보 릴스도 같은 글이라, post.html은 **사진 지문**(`data/ig_hashes.json`, 256비트 dHash, 같은 포스터 차이 0 / 다른 포스터 80+, 12 이하면 같은 것)으로 한 번만 + 사진 글이 있으면 영상 표지는 뺌.
  **자동 실행 켬 (원장님 허락 2026-10-28):** pg_cron `leesh_instagram` 2시간마다 `private.ig_sync(1)` + GitHub Action 3시간마다 사진 복사. 둘 다 가져오기·복사만, 지우지 않음.
  Action이 main에 커밋하므로 main에 올릴 때는 **`git fetch origin main && git merge origin/main` 먼저** (작업 브랜치도).
- **학원이 직접 올리는 소식 (2026-10-28, 원장님: "직접도, Claude에게 말해서도 둘 다"):** 표 `public.audition_news` (마이그레이션 `leesh_audition_news`, 누구나 읽기·원장님만 쓰기) + 공개 버킷 `audition-news`(포스터).
  원장님: 관리자 → **오디션 소식** 탭에서 쓰기·고치기·숨기기·삭제. 페이지는 `js/auditions.js`가 읽어서 각 칸 맨 위에 펼쳐지는 카드로 (마감 지나면 "지난 소식").
  **원장님이 Claude에게 말하면:** Management API SQL로 `insert into public.audition_news (kind, company, title, event_date, deadline, body, link) values (…)` — kind는 '내방' / '오디션' / '합격'. 넣은 뒤 select로 확인하고 알려주기.
  **합격 소식 → about 합격 실적판 (2026-10-28):** 합격 소식에 종류(`pass_type` 기획사/방송/입시)·단계(`pass_stage` 1차 합격…최종 합격/연습생 계약/데뷔)·이니셜(`initials`)·회사(`company`)를 적으면 `js/passboard.js`가 about 실적판에 더함: 그해 칩 줄(2026~, 2025는 원래 줄에), 회사 카드에 "2026 1차 합격" 줄 (없는 회사는 새 카드 + NEW), "74곳+" 숫자, 데뷔는 맨 위 카드, 입시는 "새 합격" 칸. results는 날짜별 소식으로 그대로.
  Claude에게 말하면: `insert into public.audition_news (kind, company, title, event_date, pass_type, pass_stage, initials) values ('합격', 'SM 엔터테인먼트', '1차 합격 (김OO)', '2026-11-02', '기획사', '1차 합격', '김OO')`. DB가 한글 2~4자 실명 이니셜을 막음(`audition_news_initials_not_name`).
  **합격 소식은 학생 이름을 꼭 이니셜(김OO)로** — 원장님도 그렇게 올리기로 함.
  학원 운영방침 (원장님 2026-10-28 확인): **데뷔한 연예인(tripleS 김유연, MEOVV 나린, TUIDE 서희 등)을 빼고 일반 학생은 실명을 쓰지 않음.** 2026-10-28 점검: 블로그 합격 글 152개·포스터·인스타 합격 글 모두 이니셜(○○), 실명은 데뷔 제자뿐. 포스터 사진을 채팅으로 받으면 `assets/news/`에 webp로 넣고 `image = 'assets/news/파일.webp'` (이건 main에 올려야 보임).

## 첫 화면 (2026-10-28)
- 아이콘 이름은 **영어** (YouTube, stage.jpg, audition.jpg …), 마우스를 올리면 한글 뜻(title). **map (오시는 길)**, **my folder (내 폴더)**만 한글을 작게 같이 씀.
- 인스타그램 아이콘 **1개 "Instagram"** = 오디션반 계정. 취미반 인스타는 운영을 안 해서 홈페이지에서 전부 뺌 (원장님 2026-10-28, 필요하면 `blog_content.INSTA_HOBBY`로 다시). 아이콘을 아무 데로나 돌아다니게 하는 건 원장님과 얘기해서 안 함 (누르기 어렵고 정신없음).
- 새 오디션 소식(14일 안, 안 본 것)이 있으면 audition.jpg에 빨간 N + 흔들림 (`js/newsbadge.js`, audition.html을 열면 꺼짐).

## 내 폴더 메뉴 (2026-10-28, 원장님이 정한 순서)
- 탭 7개: **내 예약**(연습실 예약 + 이번 달 사용 합계) · **일정·공지**(날짜 있는 공지·내방 오디션은 "다가오는 일정", 제목에 월말평가/휴원이 들어가면 표시) · **월말평가** · **노래 추천** · **영상 추천**(최근 평가에서 제일 낮은 항목 → 원포인트 레슨 영상 4개) · **레퍼토리** · **연습 일지**. 레슨 노트는 숨김 (위 참고).
- **노래 추천:** 학생이 내 폴더에서 신청(`member_song_request` → `song_requests`) + 노래 영상은 **카카오톡 채널로** (홈페이지에 녹음 안 올림).
  원장님이 영상을 Claude에게 주고 "목소리 분석·추천곡" 시트를 만든 뒤 (예전 방식 그대로), 관리자 → **노래 추천** 탭에 시트를 복사해 붙여넣으면 `song_recs`(summary·songs jsonb)로 들어감 (마이그레이션 `leesh_song_recs`).
  학생에게는 분석한 곡·낸 음역·편한 음역(주로 머문 음)·음정·음색·분위기·어울리는 곡 + 추천곡(이유, 멜론/Spotify/유튜브, "레퍼토리에 넣기")만. 센트·dB·자료(성별)·② 곡별 음역·참고 칸은 안 보임.
  **원장님이 Claude에게 말하면:** `insert into public.song_recs (member_id, made_on, summary, songs, note) values (…)` → 그 학생의 `song_requests` 접수를 '완료'로 → select로 확인. 분석 시트·학생 이름은 저장소에 적지 않기.
- **연습 일지 보기:** 관리자 → 연습 일지 탭 (담당 선생님별 · 학생별, 보기만). 선생님 계정은 아직 없음 → 원장님 화면으로 보거나, 필요하면 선생님용 보기 전용 계정을 나중에.

## 다음에 이어서 할 일 (2026-10-28 기준)
1. ~~정리 대기~~ 2026-10-28 확인: 시험 연결 2개 해제·시험 예약 2건 취소 끝 (원장님이 관리자 화면에서).
2. **배포 준비:** 원장님 컴퓨터(윈도우/맥?)에 Claude 데스크톱 앱 + Claude in Chrome 설치 안내 → 오픈 날 정하기 → 카페24 연결.
3. 월말평가 실제 올리기는 오픈하면서 학생별로 (아직 실제 Storage 업로드 시험 안 함).
4. 학생 안내 문구는 홈페이지가 다 된 뒤에.
5. **레슨 노트 (선생님들과 얘기 중, 2026-10-28):** 지금 선생님들은 학생마다 구글시트 한 장에 자유롭게 씀 (오디션 일정 · 준비곡+곡별 피드백 · 아픈 이유/연습 포인트 · 노래 추천), **학생과 공유해서 같이 봄**.
   제안한 것: 선생님을 관리자로 넣지 말고 **"선생님" 역할**(카카오 로그인 → 원장님 승인, 노트 쓰기 + 연습 일지 보기만) + 그 시트 모양을 본뜬 학생 노트 (학생에게 보이는 칸 / 선생님 메모 칸 나누기) → 한두 분이 한 달 시험.
   원장님이 선생님들과 얘기한 뒤 결정. 선생님별 "학생현황·수업기록" 시트(학부모 연락처·결제)는 홈페이지로 옮기지 않음.

## 배포·병합
- **순서: 만들기가 먼저, 배포는 나중.** 지금은 운영 전입니다. 필요한 메뉴를 다 짠 뒤에 Supabase 연결 → 테스트 → 배포 순서로 갑니다.
- **main 자동 반영 (원장님 2026-10-28 "앞으로 작업되는 모두 메인에 자동으로 올려줘"):** 작업을 확인(빌드·시험)한 뒤 작업 브랜치에 올리고 **main에도 바로 올림** (fast-forward). 올린 뒤 시험용 주소에 반영됐는지 확인하고 알려주기. 아직 운영 전이라 학생들은 이 주소를 모름.
  (예전 규칙 "main 병합은 원장님이 말할 때만"은 이 결정으로 바뀜. 실제 도메인 연결·배포는 여전히 원장님과 날짜를 정해서.)
- 페이지의 css/js 주소에는 `?v=<내용 해시>`가 붙음 (`tools/build_pages.py` stamp, admin.html 포함). 그래서 css/js를 고치면 **꼭 build_pages.py를 다시 돌려서** 같이 올리기 (안 그러면 브라우저가 옛 css를 써서 화면이 깨짐, 2026-10-28 집 그림이 화면 가득 나왔던 일).
- **시험용 주소 (2단계 테스트, 2026-10-27):** GitHub Pages가 main을 `https://favort1111-byte.github.io/Leeshvocalhomepages/`에 보여줌 (저장소 공개, 학생들은 모름).
  원장님 허락으로 2026-10-27 main에 처음 병합. 진짜 카카오 로그인은 여기서 시험. Supabase **Redirect URLs**에 `https://favort1111-byte.github.io/Leeshvocalhomepages/**` 필요 (원장님이 대시보드에서 추가, 내 토큰은 403).
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
- 네이버 블로그(blog.naver.com/o_oa8)는 예전 학원 정보의 원본이었고, 2026-10-28 글 전부를 홈페이지로 옮김 (위 "블로그 → 홈페이지 이사"). 앞으로 블로그는 안 쓸 수도 있음. 정리본 `docs/blog.md`, 홈페이지 데이터 `tools/blog_content.py`, 사진 `assets/img/blog/`.
  블로그 접속은 환경 허용 도메인 `*.naver.com`, `*.pstatic.net`이 필요해요 (원장님이 추가함). 블로그 글은 대부분 이미지 안내판이라 직접 읽어서 옮겨야 해요.
- `docs/menu-ideas.md`: 메뉴 아이디어 원본 기록 (GPT 기본표·특색 5개·해외 조사 5개, Claude 아이디어). **메뉴 구성을 논의할 때 먼저 꺼내서 보여줍니다.**
- 메뉴 아이디어 보드 아티팩트: https://claude.ai/artifact/XHhi3x4pqGu8mRmwUb2B3G (원본 `docs/menu-ideas.html`). 아이디어가 추가되면 md와 이 보드를 같이 고쳐서 다시 올립니다.

## 말투
- 설명은 이해하기 쉽고 간단하게, 한국어로.
