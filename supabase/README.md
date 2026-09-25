# 연습실 예약 · 상담 신청 데이터베이스 (Supabase)

홈페이지의 **연습실 예약(방 6개) · 상담 신청 · 관리자 화면**이 쓰는 데이터베이스입니다.
선생님 수업 예약용 구글시트와는 **완전히 별개**예요.

> 아직 운영 전입니다. 메뉴를 다 짠 뒤에 아래 순서로 연결하면 돼요.

---

## 연결 순서 (처음 한 번, 15분 정도)

1. **프로젝트 만들기**: https://supabase.com 에 구글 계정으로 가입 → **New project**
   - 이름: `leeshlesson`, Region: **Northeast Asia (Seoul)**, 데이터베이스 비밀번호는 아무거나 길게 (따로 보관)
2. **표 만들기**: 왼쪽 **SQL Editor** → **New query** → `supabase/schema.sql` 내용을 전부 붙여넣고 **Run**
   - 연습실 1~5, 춤연습실이 기본으로 들어가요. 이름은 관리자 화면에서 바꿀 수 있어요.
3. **원장님 관리자 계정**: 왼쪽 **Authentication → Users → Add user → Create new user**
   - 이메일·비밀번호 입력, **Auto Confirm User** 체크
   - 다시 **SQL Editor**에서 (이메일은 소문자로):
     ```sql
     insert into public.admins values ('원장님이메일@gmail.com');
     ```
4. **홈페이지에 연결**: **Project Settings → API**(또는 **API Keys**)에서
   - **Project URL** (`https://xxxx.supabase.co`)
   - **anon public** 또는 **publishable** 키
   두 개를 Claude에게 주면 `js/config.js`에 넣어요. **service_role / secret 키는 절대 주지 마세요.**

## 텔레그램 알림 (선택)

예약·취소·상담 신청이 들어오면 텔레그램으로 알려줍니다.

1. 텔레그램 **@BotFather** → `/newbot` → 토큰(`123456:ABC...`) 받기
2. 새 봇에게 아무 메시지나 보내고, 브라우저로 `https://api.telegram.org/bot토큰/getUpdates` 를 열어 `"chat":{"id":숫자` 의 숫자 확인
3. **SQL Editor**에서:
   ```sql
   update private.telegram set bot_token = '토큰', chat_id = '숫자';
   ```

토큰은 `private` 영역에 들어가서 홈페이지나 관리자 화면으로는 보이지 않아요.

---

## 관리자 화면 (`admin.html`)

| 메뉴 | 하는 일 |
|---|---|
| 예약 현황 | 날짜별 방 × 시간 표. 빈칸 → 시간 막기(청소·레슨) 또는 수강생 대신 예약, 예약 → 취소 |
| 수강 ID | 수강 ID 발급·수정, 비밀번호 재설정, 상태(재원·외부·휴원·종료), 외부 손님 사용 기한 |
| 상담 신청 | 들어온 신청 목록, 전화 걸기, 상태(접수→연락완료→등록)와 메모 |
| 설정 | 방 이름·순서·예약 받기 on/off, 방 추가 / 예약 규칙 |

## 동작 규칙 (기본값, 관리자 화면 **설정**에서 변경)

- 로그인: **수강 ID + 비밀번호 4자리**. 비밀번호 10번 틀리면 15분 잠김 (관리자가 비밀번호를 새로 정하면 바로 풀림)
- 예약 가능한 ID: 상태가 `재원`, 또는 `외부`이면서 사용 기한이 안 지난 ID
- 00:00~24:00, 1시간 단위, 1회 최대 2시간, 한 사람 하루 최대 3시간, 오늘부터 7일 뒤까지
- 같은 방·같은 시간, 같은 사람의 겹치는 시간은 데이터베이스가 막아요 (동시에 눌러도 한 명만)
- 학생 직접 취소: 시작 60분 전까지. 그 뒤는 관리자 화면에서
- 상담 신청: 같은 번호로 1시간에 3번까지

## 개발자용

```bash
node --test supabase/test/*.test.js   # 규칙·권한 테스트 (로컬 Postgres + PostgREST에서 실제 SQL 실행)
node tools/dev-server.js              # http://localhost:8020 — 계정 없이 전체 미리보기
                                      #   예약 S001 / 5678, 관리자 owner@example.com / admin1234
```

로컬 실행에는 Postgres(`psql`)와 [PostgREST](https://github.com/PostgREST/postgrest/releases) 실행 파일이 필요합니다.
접속 주소는 `LEESH_DB` 환경변수로 바꿀 수 있어요 (기본 `postgresql://postgres:postgres@localhost:5432/leesh`).
`supabase/test/local-shim.sql`은 로컬 전용이니 Supabase에서는 실행하지 마세요.
