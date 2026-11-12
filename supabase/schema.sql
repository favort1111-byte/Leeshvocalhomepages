-- 이송희보컬레슨 홈페이지 — 연습실 예약 · 상담 신청 데이터베이스 (Supabase)
--
-- Supabase 대시보드 → SQL Editor → New query 에 이 파일 전체를 붙여넣고 Run.
-- 처음 한 번만 실행합니다. (다시 실행해도 기존 데이터는 지워지지 않아요)
--
-- 구조
--   public.*   홈페이지가 읽고 쓰는 표. 손님(anon)은 표를 직접 못 보고 아래 함수로만 접근합니다.
--   private.*  비밀번호 실패 기록, 텔레그램 토큰 등 밖으로 절대 안 나가는 것.
-- 시간은 모두 한국 시간. 날짜는 date, 시각은 자정부터 센 분(0~1440)으로 저장합니다.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;
do $$ begin
  create extension if not exists pg_net with schema extensions;  -- 텔레그램 알림용 (Supabase에 기본 포함)
exception when others then
  raise notice 'pg_net 없음: 텔레그램 알림은 꺼진 채로 설치합니다.';
end $$;

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------- 표

create table if not exists public.settings (
  id                int primary key default 1 check (id = 1),
  open_min          int not null default 0    check (open_min between 0 and 1440),
  close_min         int not null default 1440 check (close_min between 0 and 1440),
  unit_min          int not null default 60   check (unit_min in (30, 60)),
  max_minutes       int not null default 120  check (max_minutes > 0 and max_minutes % 60 = 0),
  daily_max_minutes int not null default 120  check (daily_max_minutes > 0),
  max_days          int not null default 0    check (max_days between 0 and 60),
  cancel_minutes    int not null default 60   check (cancel_minutes >= 0),
  check (close_min > open_min)
);
insert into public.settings (id) values (1) on conflict do nothing;
-- 수강 ID + 비밀번호 로그인: 원장님 결정으로 끔 (2026-10-28, 카카오만). 다시 켜려면 true로 + js/signin.js 되살리기.
alter table public.settings add column if not exists pin_login boolean not null default false;

create table if not exists public.rooms (
  id     serial primary key,
  name   text not null unique check (length(trim(name)) > 0),
  kind   text not null default '연습실',
  sort   int  not null default 0,
  active boolean not null default true
);
insert into public.rooms (name, kind, sort)
select v.name, v.kind, v.sort
from (values ('연습실 1', '연습실', 1), ('연습실 2', '연습실', 2), ('연습실 3', '연습실', 3),
             ('연습실 4', '연습실', 4), ('연습실 5', '연습실', 5), ('춤연습실', '춤연습실', 6)) v(name, kind, sort)
where not exists (select 1 from public.rooms);

-- 수강 ID. 외부 손님은 상태 '외부' + 사용기한으로 임시 발급합니다.
create table if not exists public.members (
  id         text primary key check (id ~ '^[A-Z0-9_-]{2,20}$'),
  name       text not null check (length(trim(name)) > 0),
  phone      text,
  pin_hash   text not null,
  status     text not null default '재원' check (status in ('재원', '외부', '휴원', '종료')),
  expires_on date,
  memo       text,
  created_at timestamptz not null default now()
);
-- 0000 is a temporary PIN: the student picks their own at first sign-in (member_change_pin).
alter table public.members add column if not exists must_change_pin boolean not null default false;
-- 카카오로 로그인: 원장님이 승인한 카카오 계정(Supabase Auth 사용자)과 수강 ID를 잇습니다.
alter table public.members add column if not exists kakao_user uuid unique;
-- 수강이 끝난 날 (상태가 '종료'가 된 때). 개인정보처리방침: 끝난 날로부터 1년 뒤 지웁니다 (private.cleanup).
alter table public.members add column if not exists ended_at timestamptz;
update public.members set ended_at = now() where status = '종료' and ended_at is null;

-- 처음 카카오로 들어온 학생의 "저는 ○○○예요" 요청. 원장님이 관리자 화면에서 승인합니다.
create table if not exists public.link_requests (
  id          bigserial primary key,
  user_id     uuid not null unique,  -- 카카오 계정 하나에 요청 하나
  kakao_name  text,
  name        text not null check (length(trim(name)) between 1 and 30),
  teacher     text,
  status      text not null default '대기' check (status in ('대기', '승인', '거절')),
  member_id   text references public.members (id) on update cascade on delete set null,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);

-- 같은 방·같은 시간, 같은 사람·같은 시간이 겹치는 예약은 데이터베이스가 거절합니다 (동시에 눌러도).
-- member_id가 비어 있는 예약은 원장님이 막아 둔 시간(청소·레슨 등)입니다.
create table if not exists public.bookings (
  id           bigint generated always as identity primary key,
  room_id      int  not null references public.rooms (id),
  member_id    text references public.members (id) on update cascade,
  day          date not null,
  start_min    int  not null check (start_min >= 0 and start_min < 1440),
  end_min      int  not null check (end_min > start_min and end_min <= 1440),
  status       text not null default '확정' check (status in ('확정', '취소')),
  memo         text,
  created_at   timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint bookings_no_room_overlap exclude using gist
    (room_id with =, day with =, int4range(start_min, end_min) with &&) where (status = '확정'),
  constraint bookings_no_member_overlap exclude using gist
    (member_id with =, day with =, int4range(start_min, end_min) with &&) where (status = '확정')
);
create index if not exists bookings_day_idx on public.bookings (day);
create index if not exists bookings_member_idx on public.bookings (member_id, day);

create table if not exists public.consults (
  id         bigint generated always as identity primary key,
  status     text not null default '접수' check (status in ('접수', '연락완료', '등록', '보류', '취소')),
  method     text not null default '전화 상담',
  wish       text,
  name       text not null,
  phone      text not null,
  track      text,
  message    text,
  memo       text,
  created_at timestamptz not null default now()
);
create index if not exists consults_phone_idx on public.consults (phone, created_at);

-- 레슨 노트: 수업이 끝나면 선생님이 적고, 학생은 수강 ID로 로그인해서 봅니다.
create table if not exists public.lesson_notes (
  id          bigint generated always as identity primary key,
  member_id   text not null references public.members (id) on update cascade on delete cascade,
  lesson_date date not null,
  teacher     text,
  did         text not null check (length(trim(did)) > 0),   -- 오늘 한 것
  practice    text,                                          -- 다음 수업까지 연습할 것
  created_at  timestamptz not null default now()
);
create index if not exists lesson_notes_member_idx on public.lesson_notes (member_id, lesson_date desc);

-- 월말평가: 한 사람당 한 달에 하나. 점수는 1~5.
create table if not exists public.monthly_evals (
  id         bigint generated always as identity primary key,
  member_id  text not null references public.members (id) on update cascade on delete cascade,
  month      date not null check (extract(day from month) = 1),
  pitch      smallint not null check (pitch between 1 and 5),       -- 음정
  rhythm     smallint not null check (rhythm between 1 and 5),      -- 박자·리듬
  breath     smallint not null check (breath between 1 and 5),      -- 호흡·발성
  expression smallint not null check (expression between 1 and 5),  -- 표현·감정
  stage      smallint not null check (stage between 1 and 5),       -- 무대·태도
  comment    text,
  goal       text,                                                  -- 다음 달 목표
  teacher    text,
  created_at timestamptz not null default now(),
  unique (member_id, month)
);

-- 월말평가 리포트 (분기마다 3·6·9·12월). 원장님이 평가지 사진과 점수표를 올리면 학생은 "내 폴더"에서 봅니다.
-- 사진은 Storage의 비공개 버킷 eval-reports/<수강 ID>/<YYYY-MM>/<쪽>.webp 에, 여기엔 점수와 쪽수만.
create table if not exists public.eval_reports (
  member_id  text not null references public.members (id) on update cascade on delete cascade,
  month      date not null check (extract(day from month) = 1),
  pages      smallint not null default 0 check (pages between 0 and 6),
  song       text,
  teacher    text,
  basic      numeric(3,1) check (basic between 0 and 10),      -- 기본기
  technique  numeric(3,1) check (technique between 0 and 10),  -- 보컬 테크닉
  acting     numeric(3,1) check (acting between 0 and 10),     -- 액팅
  styling    numeric(3,1) check (styling between 0 and 10),    -- 스타일링
  total      numeric(3,1) check (total between 0 and 40),
  stage      text,                                             -- 단계 (기초 연습 ~ 연습생 계약 임박)
  updated_at timestamptz not null default now(),
  primary key (member_id, month)
);

-- 오디션 소식 (audition.html). 원장님이 관리자 화면에서 쓰거나, Claude에게 말해서 넣습니다. 누구나 읽을 수 있어요.
-- 합격 소식에는 학생 실명 대신 이니셜·학년 등으로 (개인정보).
create table if not exists public.audition_news (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('내방', '오디션', '합격')),
  company    text check (char_length(company) <= 40),
  title      text not null check (char_length(title) between 1 and 80),
  event_date date,                                  -- 오디션 날 (합격 소식은 발표 날)
  deadline   date,                                  -- 접수 마감 (지나면 "지난 소식")
  body       text check (char_length(body) <= 3000),
  link       text check (link ~ '^https?://'),
  image      text,                                  -- 포스터: Storage audition-news/<경로> 또는 assets/… 주소
  published  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 학원 공지 (휴원일, 행사, 월말평가 날 …): 원장님이 관리자 화면에서 쓰고, 학생은 "내 폴더 → 공지"에서 봅니다.
create table if not exists public.notices (
  id         bigint generated always as identity primary key,
  title      text not null check (char_length(title) between 1 and 80),
  body       text check (char_length(body) <= 3000),
  start_date date,                                  -- 행사·휴원 날짜 (없으면 그냥 알림)
  end_date   date,                                  -- 이 날이 지나면 안 보임
  pinned     boolean not null default false,
  published  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 학생이 직접 쓰는 것 (선생님 일 없음): 내 레퍼토리(준비하는 곡) · 연습 일지(날마다 연습 기록)
create table if not exists public.repertoire (
  id         bigint generated always as identity primary key,
  member_id  text not null references public.members (id) on update cascade on delete cascade,
  title      text not null check (char_length(title) between 1 and 80),
  artist     text check (char_length(artist) <= 60),
  purpose    text check (purpose in ('오디션', '입시', '연습', '공연')),
  status     text not null default '준비 중' check (status in ('준비 중', '완성', '쉬는 중')),
  memo       text check (char_length(memo) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.practice_logs (
  id         bigint generated always as identity primary key,
  member_id  text not null references public.members (id) on update cascade on delete cascade,
  day        date not null,
  minutes    int check (minutes between 0 and 1440),
  song       text check (char_length(song) <= 80),
  did        text check (char_length(did) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists practice_logs_member_idx on public.practice_logs (member_id, day desc);
create index if not exists repertoire_member_idx on public.repertoire (member_id);

-- 나를 위한 노래 추천: 학생이 부른 영상(카카오톡으로 받음)을 분석해서 원장님이 올리고, 학생은 "내 폴더 → 노래 추천"에서 봅니다.
-- 관리자 화면에서 분석 시트를 붙여넣거나, Claude에게 말해서 넣습니다. 녹음 파일은 홈페이지에 두지 않아요.
create table if not exists public.song_recs (
  id         bigint generated always as identity primary key,
  member_id  text not null references public.members (id) on update cascade on delete cascade,
  made_on    date not null default ((now() at time zone 'Asia/Seoul')::date),
  summary    jsonb not null default '[]'::jsonb,   -- [["낸 음역", "라(A3) ~ 높은 도(C5)"], ["음색", "…"], …]
  songs      jsonb not null default '[]'::jsonb,   -- [{"tag": "팝", "title": "…", "artist": "…", "why": "…", "melon": "…", "spotify": "…", "key": "…"}]
  note       text check (char_length(note) <= 1000),  -- 선생님 한마디
  published  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists song_recs_member_idx on public.song_recs (member_id, made_on desc);
-- 학생의 "추천받기" 신청: 좋아하는 가수·곡과 목표. 열린 신청은 한 사람에 하나.
create table if not exists public.song_requests (
  id         bigint generated always as identity primary key,
  member_id  text not null references public.members (id) on update cascade on delete cascade,
  likes      text check (char_length(likes) <= 300),
  goal       text check (goal in ('오디션', '입시', '취미', '공연')),
  memo       text check (char_length(memo) <= 500),
  status     text not null default '접수' check (status in ('접수', '완료')),
  created_at timestamptz not null default now()
);
alter table public.song_requests add column if not exists files jsonb not null default '[]'::jsonb;  -- [{"path","name","type","size","sec"}]

-- 관리자 화면에 로그인할 수 있는 이메일 (Supabase Authentication에 만든 계정)
create table if not exists public.admins (
  email text primary key check (email = lower(email))
);

create table if not exists private.login_fails (
  member_id text not null,
  at        timestamptz not null default now()
);
create index if not exists login_fails_idx on private.login_fails (member_id, at);

-- "이 기기에서 로그인 유지": 휴대폰에는 비밀번호 대신 이 열쇠를 저장합니다.
-- 열쇠 자체는 저장하지 않고 해시만 둡니다. 비밀번호를 바꾸면 모든 기기에서 풀립니다.
create table if not exists private.member_tokens (
  hash       bytea primary key,
  member_id  text not null references public.members (id) on delete cascade on update cascade,
  expires_at timestamptz not null
);
create index if not exists member_tokens_member_idx on private.member_tokens (member_id);

create table if not exists private.telegram (
  id        int primary key default 1 check (id = 1),
  bot_token text,
  chat_id   text
);
insert into private.telegram (id) values (1) on conflict do nothing;

-- 테스트에서만 시계를 고정할 때 씁니다. 운영에서는 비워 둡니다.
create table if not exists private.clock (
  id  int primary key default 1 check (id = 1),
  fixed_kst timestamp
);
insert into private.clock (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------- 도우미

create or replace function private.now_kst() returns timestamp
language sql stable set search_path = '' as $$
  select coalesce((select fixed_kst from private.clock where id = 1), now() at time zone 'Asia/Seoul');
$$;

create or replace function private.hhmm(m int) returns text
language sql immutable set search_path = '' as $$
  select lpad((m / 60)::text, 2, '0') || ':' || lpad((m % 60)::text, 2, '0');
$$;

create or replace function private.to_min(t text) returns int
language plpgsql immutable set search_path = '' as $$
declare h int; mm int;
begin
  if t is null or t !~ '^\d{1,2}:\d{2}$' then return null; end if;
  h := split_part(t, ':', 1)::int; mm := split_part(t, ':', 2)::int;
  if mm > 59 or h > 24 or (h = 24 and mm <> 0) then return null; end if;
  return h * 60 + mm;
end $$;

create or replace function private.day_label(d date) returns text
language sql immutable set search_path = '' as $$
  select extract(month from d)::int || '/' || extract(day from d)::int
      || '(' || (array['일','월','화','수','목','금','토'])[extract(dow from d)::int + 1] || ')';
$$;

create or replace function private.fail(msg text) returns jsonb
language sql immutable set search_path = '' as $$ select jsonb_build_object('ok', false, 'error', msg); $$;

create or replace function private.notify(msg text) returns void
language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  select bot_token, chat_id into t from private.telegram where id = 1;
  if coalesce(t.bot_token, '') = '' or coalesce(t.chat_id, '') = '' then return; end if;
  begin
    execute 'select net.http_post(url := $1, body := $2)'
      using 'https://api.telegram.org/bot' || t.bot_token || '/sendMessage',
            jsonb_build_object('chat_id', t.chat_id, 'text', msg);
  exception when others then
    null; -- 알림 실패가 예약을 막으면 안 됩니다
  end;
end $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  -- 이메일·비밀번호로 로그인한 관리자 계정만 (카카오로 만든 계정은 이메일이 같아도 관리자가 아님)
  select exists (select 1 from public.admins a
                 where a.email = lower(coalesce(auth.jwt() ->> 'email', '')))
     and coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') = 'email';
$$;

/*
  수강 ID + 비밀번호 확인. 맞으면 {ok, id, name, via}, 아니면 {ok:false, error}.
  p_pin 자리에는 비밀번호 4자리 또는 "로그인 유지" 열쇠(48자)가 올 수 있습니다. via = 'pin' | 'token'.
  예외를 던지지 않고 값을 돌려주는 이유: 틀린 기록(login_fails)이 롤백되지 않고 남아야
  15분에 10번 제한이 동작합니다. 열쇠는 맞힐 수 없을 만큼 길어서 틀려도 기록하지 않습니다.
*/
create or replace function private.check_member(p_id text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  mid text := upper(trim(coalesce(p_id, '')));
  raw text := trim(coalesce(p_pin, ''));
  pin text := regexp_replace(raw, '\D', '', 'g');
  via text := case when length(raw) >= 32 then 'token'
                   when raw = '' and auth.uid() is not null then 'kakao' else 'pin' end;
  m public.members;
  fails int;
begin
  if via <> 'kakao' and not coalesce((select s.pin_login from public.settings s where s.id = 1), false) then
    return private.fail('카카오로 로그인해주세요.');
  end if;
  if via = 'kakao' then
    -- signed in with Kakao: the approved link is the identity, p_id is ignored
    select * into m from public.members where kakao_user = auth.uid();
    if m.id is null then
      return jsonb_build_object('ok', false, 'code', 'not_linked', 'error', '아직 학원 승인 전이에요. 승인되면 바로 쓸 수 있어요.');
    end if;
  elsif via = 'token' then
    select mb.* into m from private.member_tokens t join public.members mb on mb.id = t.member_id
     where t.hash = extensions.digest(raw, 'sha256') and t.member_id = mid and t.expires_at > now();
    if m.id is null then
      return private.fail('로그인이 풀렸어요. 수강 ID와 비밀번호로 다시 로그인해주세요.');
    end if;
    -- 쓰는 동안은 계속 유지 (한 달에 한 번쯤 기한을 뒤로 미룸)
    update private.member_tokens set expires_at = now() + interval '180 days'
     where hash = extensions.digest(raw, 'sha256') and expires_at < now() + interval '150 days';
  else
    if mid = '' or length(pin) <> 4 then
      return private.fail('수강 ID와 비밀번호 4자리를 입력해주세요.');
    end if;
    select count(*) into fails from private.login_fails
     where member_id = mid and at > now() - interval '15 minutes';
    if fails >= 10 then
      return private.fail('비밀번호를 여러 번 틀렸습니다. 15분 뒤에 다시 시도하거나 학원에 문의해주세요.');
    end if;
    select * into m from public.members where id = mid;
    if m.id is null or m.pin_hash <> extensions.crypt(pin, m.pin_hash) then
      insert into private.login_fails (member_id) values (mid);
      return private.fail('수강 ID 또는 비밀번호가 맞지 않습니다.');
    end if;
  end if;
  if m.status not in ('재원', '외부') then
    return private.fail('현재 이용 중인 수강 ID가 아닙니다. 학원에 문의해주세요.');
  end if;
  if m.expires_on is not null and m.expires_on < private.now_kst()::date then
    return private.fail('사용 기한이 지난 ID입니다. 학원에 문의해주세요.');
  end if;
  return jsonb_build_object('ok', true, 'id', m.id, 'name', m.name, 'via', via,
                            'mustChange', via <> 'kakao' and m.must_change_pin);
end $$;

-- 예약 · 취소 · 내 폴더용: 임시 비밀번호(0000) 상태면 먼저 새 비밀번호를 정하게 합니다.
create or replace function private.check_ready(p_id text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who jsonb := private.check_member(p_id, p_pin);
begin
  if (who ->> 'ok')::boolean and (who ->> 'mustChange')::boolean then
    return jsonb_build_object('ok', false, 'code', 'must_change', 'error', '처음 비밀번호를 새로 정해주세요.');
  end if;
  return who;
end $$;

-- 비밀번호로 로그인했을 때 새 "로그인 유지" 열쇠를 만들어 돌려줍니다. 한 사람당 기기 5대까지.
create or replace function private.issue_token(mid text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  tok text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  delete from private.member_tokens where member_id = mid
     and (expires_at <= now() or hash in (
       select hash from private.member_tokens where member_id = mid order by expires_at desc offset 4));
  insert into private.member_tokens (hash, member_id, expires_at)
  values (extensions.digest(tok, 'sha256'), mid, now() + interval '180 days');
  return tok;
end $$;

-- 로그인한 응답에 붙일 열쇠: 비밀번호로 들어왔을 때만 새로 만듭니다.
create or replace function private.with_token(who jsonb, body jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  select case when who ->> 'via' = 'pin'
              then body || jsonb_build_object('token', private.issue_token(who ->> 'id'))
              else body end;
$$;

-- 학생이 직접 비밀번호를 바꿉니다 (처음 0000으로 로그인했을 때). 다른 기기는 모두 로그아웃되고 이 기기에 새 열쇠를 줍니다.
create or replace function public.member_change_pin(p_id text, p_pin text, p_new text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who jsonb := private.check_member(p_id, p_pin);
  pin text := regexp_replace(coalesce(p_new, ''), '\D', '', 'g');
  mid text;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  if length(pin) <> 4 or length(coalesce(p_new, '')) <> 4 then return private.fail('새 비밀번호는 숫자 4자리로 정해주세요.'); end if;
  if pin = '0000' then return private.fail('0000은 쓸 수 없어요. 다른 4자리로 정해주세요.'); end if;
  if pin ~ '^(.)\1{3}$' or pin in ('1234', '4321') then return private.fail('너무 쉬운 번호예요. 다른 4자리로 정해주세요.'); end if;
  update public.members set pin_hash = extensions.crypt(pin, extensions.gen_salt('bf')), must_change_pin = false where id = mid;
  delete from private.login_fails where member_id = mid;
  delete from private.member_tokens where member_id = mid;
  return jsonb_build_object('ok', true, 'id', mid, 'name', who ->> 'name', 'token', private.issue_token(mid));
end $$;

-- 로그아웃: 이 기기의 열쇠를 지웁니다.
create or replace function public.member_logout(p_id text, p_token text) returns jsonb
language sql security definer set search_path = '' as $$
  delete from private.member_tokens
   where member_id = upper(trim(coalesce(p_id, ''))) and hash = extensions.digest(trim(coalesce(p_token, '')), 'sha256');
  select jsonb_build_object('ok', true);
$$;

-- ---------------------------------------------------------------- 홈페이지용 함수

-- 날짜별 방마다 빈 시작 시간. p_date가 비면 오늘.
create or replace function public.rooms_day(p_date text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.settings;
  t timestamp := private.now_kst();
  today date := t::date;
  now_min int := extract(hour from t)::int * 60 + extract(minute from t)::int;
  d date;
begin
  select * into s from public.settings where id = 1;
  begin
    d := coalesce(nullif(p_date, '')::date, today);
  exception when others then
    return private.fail('날짜 형식이 올바르지 않습니다.');
  end;
  if d < today or d > today + s.max_days then
    return private.fail('예약할 수 없는 날짜입니다.');
  end if;
  return jsonb_build_object(
    'ok', true,
    'date', d,
    'now', case when d = today then now_min end,   -- lets the page grey out hours already gone
    'days', (select jsonb_agg(today + i order by i) from generate_series(0, s.max_days) i),
    'unit', s.unit_min,
    'open', private.hhmm(s.open_min),
    'close', private.hhmm(s.close_min),
    'maxHours', s.max_minutes / 60,
    'dailyMaxHours', trim_scale(s.daily_max_minutes / 60.0),
    'cancelBefore', case when s.cancel_minutes % 60 = 0 then (s.cancel_minutes / 60) || '시간' else s.cancel_minutes || '분' end,
    'rooms', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', r.name, 'type', r.kind,
        'free', coalesce((
          select jsonb_agg(private.hhmm(g) order by g)
          from generate_series(s.open_min, s.close_min - s.unit_min, s.unit_min) g
          where (d > today or g > now_min)   -- 이미 시작한 시간은 안 됨 (18:05면 19:00부터, 원장님 2026-10-28)
            and not exists (
              select 1 from public.bookings b
              where b.room_id = r.id and b.day = d and b.status = '확정'
                and b.start_min < g + s.unit_min and g < b.end_min)
        ), '[]'::jsonb)
      ) order by r.sort, r.id)
      from public.rooms r where r.active
    ), '[]'::jsonb)
  );
end $$;

-- 로그인 + 내 예약 목록 (지금 이후)
create or replace function public.member_login(p_id text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who jsonb := private.check_member(p_id, p_pin);
  s public.settings;
  t timestamp := private.now_kst();
  today date := t::date;
  now_min int := extract(hour from t)::int * 60 + extract(minute from t)::int;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  select * into s from public.settings where id = 1;
  return private.with_token(who, jsonb_build_object(
    'ok', true,
    'id', who ->> 'id',
    'name', who ->> 'name',
    'mustChange', (who ->> 'mustChange')::boolean,
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'room', r.name, 'date', b.day,
        'start', private.hhmm(b.start_min), 'end', private.hhmm(b.end_min),
        'cancellable', (b.day - today) * 1440 + b.start_min - now_min >= s.cancel_minutes
      ) order by b.day, b.start_min)
      from public.bookings b join public.rooms r on r.id = b.room_id
      where b.member_id = who ->> 'id' and b.status = '확정'
        and (b.day > today or (b.day = today and b.end_min > now_min))
    ), '[]'::jsonb)
  ));
end $$;

create or replace function public.booking_create(
  p_id text, p_pin text, p_room text, p_date text, p_start text, p_hours int
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  mid text;
  s public.settings;
  t timestamp := private.now_kst();
  today date := t::date;
  now_min int := extract(hour from t)::int * 60 + extract(minute from t)::int;
  d date;
  room public.rooms;
  st int := private.to_min(p_start);
  en int;
  used int;
  new_id bigint;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  select * into s from public.settings where id = 1;

  begin
    d := p_date::date;
  exception when others then
    return private.fail('날짜 형식이 올바르지 않습니다.');
  end;
  if d is null then return private.fail('날짜 형식이 올바르지 않습니다.'); end if;
  if d < today then return private.fail('지난 날짜는 예약할 수 없습니다.'); end if;
  if d > today + s.max_days then
    return private.fail(case when s.max_days = 0 then '예약은 당일만 할 수 있어요. 매일 밤 12시에 그날 예약이 열려요.'
                             else '예약은 오늘부터 ' || s.max_days || '일 뒤까지만 가능합니다.' end);
  end if;

  select * into room from public.rooms where name = p_room and active;
  if room.id is null then
    return private.fail('선택한 연습실을 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.');
  end if;

  if st is null then return private.fail('시작 시간이 올바르지 않습니다.'); end if;
  if p_hours is null or p_hours < 1 then return private.fail('이용 시간을 선택해주세요.'); end if;
  if p_hours * 60 > s.max_minutes then
    return private.fail('한 번에 최대 ' || s.max_minutes / 60 || '시간까지 예약할 수 있습니다.');
  end if;
  en := st + p_hours * 60;
  if (st - s.open_min) % s.unit_min <> 0 then
    return private.fail('예약은 ' || s.unit_min || '분 단위로만 가능합니다.');
  end if;
  if st < s.open_min or en > s.close_min then
    return private.fail('운영 시간(' || private.hhmm(s.open_min) || '~' || private.hhmm(s.close_min) || ') 안에서만 예약할 수 있습니다.');
  end if;
  if d = today and st <= now_min then
    return private.fail('이미 시작한 시간이에요. 다음 시간부터 예약할 수 있어요.');
  end if;

  -- 같은 사람의 동시 요청을 한 줄로 세워 하루 최대 시간 검사가 새지 않게 합니다.
  perform pg_advisory_xact_lock(hashtext('member:' || mid));
  select coalesce(sum(end_min - start_min), 0) into used
    from public.bookings where member_id = mid and day = d and status = '확정';
  if used + (en - st) > s.daily_max_minutes then
    return private.fail('하루 최대 ' || trim_scale(s.daily_max_minutes / 60.0) || '시간까지 예약할 수 있습니다. (이날 이미 '
      || trim_scale(used / 60.0) || '시간 예약)');
  end if;

  begin
    insert into public.bookings (room_id, member_id, day, start_min, end_min)
    values (room.id, mid, d, st, en) returning id into new_id;
  exception when exclusion_violation then
    if sqlerrm like '%bookings_no_member_overlap%' then
      return private.fail('같은 시간에 이미 다른 연습실을 예약하셨습니다.');
    end if;
    return private.fail('방금 다른 예약이 들어왔습니다. 다른 시간을 골라주세요.');
  end;

  perform private.notify('🎤 연습실 예약' || chr(10) || (who ->> 'name') || ' (' || mid || ') · ' || room.name
    || chr(10) || private.day_label(d) || ' ' || private.hhmm(st) || '~' || private.hhmm(en));

  return jsonb_build_object('ok', true, 'booking', jsonb_build_object(
    'id', new_id, 'room', room.name, 'date', d, 'start', private.hhmm(st), 'end', private.hhmm(en)));
end $$;

create or replace function public.booking_cancel(p_id text, p_pin text, p_booking bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  s public.settings;
  t timestamp := private.now_kst();
  today date := t::date;
  now_min int := extract(hour from t)::int * 60 + extract(minute from t)::int;
  b public.bookings;
  room_name text;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  select * into s from public.settings where id = 1;
  select * into b from public.bookings
   where id = p_booking and member_id = who ->> 'id' and status = '확정'
   for update;
  if b.id is null then return private.fail('취소할 예약을 찾을 수 없습니다.'); end if;
  if (b.day - today) * 1440 + b.start_min - now_min < s.cancel_minutes then
    return private.fail('시작 ' || case when s.cancel_minutes % 60 = 0 then (s.cancel_minutes / 60) || '시간' else s.cancel_minutes || '분' end || ' 전이 지나 직접 취소할 수 없습니다. 학원에 연락해주세요.');
  end if;
  update public.bookings set status = '취소', cancelled_at = now(), memo = coalesce(memo || ' / ', '') || '본인 취소'
   where id = b.id;
  select name into room_name from public.rooms where id = b.room_id;
  perform private.notify('↩️ 연습실 예약 취소' || chr(10) || (who ->> 'name') || ' · ' || room_name
    || chr(10) || private.day_label(b.day) || ' ' || private.hhmm(b.start_min) || '~' || private.hhmm(b.end_min));
  return jsonb_build_object('ok', true, 'cancelled', b.id);
end $$;

create or replace function public.consult_create(
  p_name text, p_phone text, p_track text default null, p_method text default null,
  p_wish text default null, p_message text default null, p_website text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  nm text := left(trim(coalesce(p_name, '')), 30);
  digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_phone text;
  v_method text := case when p_method in ('전화 상담', '방문 상담', '체험 레슨') then p_method else '전화 상담' end;
  recent int;
begin
  if coalesce(p_website, '') <> '' then return jsonb_build_object('ok', true); end if; -- 자동 입력 프로그램
  if nm = '' then return private.fail('이름을 입력해주세요.'); end if;
  if length(digits) < 9 or length(digits) > 11 then return private.fail('연락처를 정확히 입력해주세요.'); end if;
  v_phone := case length(digits)
    when 11 then substr(digits, 1, 3) || '-' || substr(digits, 4, 4) || '-' || substr(digits, 8)
    when 10 then substr(digits, 1, 3) || '-' || substr(digits, 4, 3) || '-' || substr(digits, 7)
    else digits end;
  perform pg_advisory_xact_lock(hashtext('consult:' || v_phone));
  select count(*) into recent from public.consults c where c.phone = v_phone and c.created_at > now() - interval '1 hour';
  if recent >= 3 then return private.fail('이미 여러 번 접수되었습니다. 곧 연락드릴게요.'); end if;

  insert into public.consults (method, wish, name, phone, track, message)
  values (v_method, nullif(left(trim(coalesce(p_wish, '')), 100), ''), nm, v_phone,
          nullif(left(coalesce(p_track, ''), 30), ''), nullif(left(trim(coalesce(p_message, '')), 1000), ''));

  perform private.notify('📩 새 상담 신청 · ' || v_method || chr(10) || nm || ' · ' || v_phone
    || coalesce(chr(10) || '관심: ' || nullif(p_track, ''), '')
    || coalesce(chr(10) || '희망: ' || nullif(trim(p_wish), ''), '')
    || coalesce(chr(10) || chr(10) || nullif(trim(p_message), ''), ''));
  return jsonb_build_object('ok', true, 'method', v_method);
end $$;

-- 내 노트: 로그인한 학생 본인의 레슨 노트(최근 30개)와 월말평가(최근 12개월)
create or replace function public.member_notebook(p_id text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  mid text;
  today date := private.now_kst()::date;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  return private.with_token(who, jsonb_build_object(
    'ok', true,
    'id', mid,
    'name', who ->> 'name',
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', n.lesson_date, 'teacher', n.teacher, 'did', n.did, 'practice', n.practice
      ) order by n.lesson_date desc, n.id desc)
      from (select * from public.lesson_notes where member_id = mid
            order by lesson_date desc, id desc limit 30) n
    ), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'month', to_char(r.month, 'YYYY-MM'), 'pages', r.pages, 'song', r.song, 'teacher', r.teacher,
        'basic', r.basic, 'technique', r.technique, 'acting', r.acting, 'styling', r.styling,
        'total', r.total, 'stage', r.stage
      ) order by r.month desc)
      from (select * from public.eval_reports where member_id = mid order by month desc limit 12) r
    ), '[]'::jsonb),
    -- 내 예약: 오늘부터의 예약 + 이번 달 연습실 이용
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object('room', rm.name, 'date', b.day,
               'start', private.hhmm(b.start_min), 'end', private.hhmm(b.end_min)) order by b.day, b.start_min)
      from public.bookings b join public.rooms rm on rm.id = b.room_id
      where b.member_id = mid and b.status = '확정' and b.day >= today
    ), '[]'::jsonb),
    'month', (select jsonb_build_object('count', count(*), 'minutes', coalesce(sum(b.end_min - b.start_min), 0))
              from public.bookings b
              where b.member_id = mid and b.status = '확정' and b.day >= date_trunc('month', today)::date and b.day <= today),
    -- 공지 + 다가오는 학원 내방 오디션
    'notices', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body, 'start', n.start_date,
               'end', n.end_date, 'pinned', n.pinned, 'at', n.created_at) order by n.pinned desc, coalesce(n.start_date, n.created_at::date) desc)
      from (select * from public.notices where published and (end_date is null or end_date >= today)
            order by pinned desc, created_at desc limit 20) n
    ), '[]'::jsonb),
    'visits', coalesce((
      select jsonb_agg(jsonb_build_object('title', a.title, 'company', a.company, 'date', a.event_date, 'deadline', a.deadline)
               order by a.event_date)
      from (select * from public.audition_news where published and kind = '내방' and event_date >= today
            order by event_date limit 6) a
    ), '[]'::jsonb),
    'repertoire', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'artist', r.artist, 'purpose', r.purpose,
               'status', r.status, 'memo', r.memo,
               'minutes', (select coalesce(sum(l.minutes), 0) from public.practice_logs l where l.member_id = mid and l.song = r.title))
               order by (r.status = '준비 중') desc, r.updated_at desc)
      from public.repertoire r where r.member_id = mid
    ), '[]'::jsonb),
    'logs', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'day', l.day, 'minutes', l.minutes, 'song', l.song, 'did', l.did)
               order by l.day desc, l.id desc)
      from (select * from public.practice_logs where member_id = mid order by day desc, id desc limit 60) l
    ), '[]'::jsonb),
    -- 노래 추천 (원장님이 올린 것) + 아직 답을 못 받은 내 신청
    'recs', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'date', s.made_on, 'summary', s.summary, 'songs', s.songs, 'note', s.note)
               order by s.made_on desc, s.id desc)
      from (select * from public.song_recs where member_id = mid and published order by made_on desc, id desc limit 5) s
    ), '[]'::jsonb),
    'request', (select jsonb_build_object('at', q.created_at, 'likes', q.likes, 'goal', q.goal, 'memo', q.memo, 'files', q.files)
                from public.song_requests q where q.member_id = mid and q.status = '접수' order by q.id desc limit 1)
  ));
end $$;

-- 내 레퍼토리: 학생이 곡을 더하고 고치고 지웁니다 (한 사람 50곡까지).
create or replace function public.member_repertoire_save(p_id text, p_pin text, p_song bigint, p_title text,
  p_artist text default null, p_purpose text default null, p_status text default '준비 중', p_memo text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  mid text;
  v_title text := trim(coalesce(p_title, ''));
  new_id bigint;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  if v_title = '' or char_length(v_title) > 80 then return private.fail('곡 제목을 적어주세요.'); end if;
  if p_purpose is not null and p_purpose not in ('오디션', '입시', '연습', '공연') then return private.fail('용도를 골라주세요.'); end if;
  if coalesce(p_status, '준비 중') not in ('준비 중', '완성', '쉬는 중') then return private.fail('상태를 골라주세요.'); end if;
  if p_song is null then
    if (select count(*) from public.repertoire where member_id = mid) >= 50 then return private.fail('곡은 50개까지 넣을 수 있어요.'); end if;
    insert into public.repertoire (member_id, title, artist, purpose, status, memo)
    values (mid, v_title, nullif(trim(coalesce(p_artist, '')), ''), p_purpose, coalesce(p_status, '준비 중'), nullif(trim(coalesce(p_memo, '')), ''))
    returning id into new_id;
  else
    update public.repertoire set title = v_title, artist = nullif(trim(coalesce(p_artist, '')), ''), purpose = p_purpose,
      status = coalesce(p_status, '준비 중'), memo = nullif(trim(coalesce(p_memo, '')), ''), updated_at = now()
    where id = p_song and member_id = mid returning id into new_id;
    if new_id is null then return private.fail('곡을 찾을 수 없어요.'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', new_id);
end $$;

create or replace function public.member_repertoire_delete(p_id text, p_pin text, p_song bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare who jsonb := private.check_ready(p_id, p_pin);
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  delete from public.repertoire where id = p_song and member_id = who ->> 'id';
  return jsonb_build_object('ok', true);
end $$;

-- 연습 일지: 오늘부터 60일 전까지의 날짜로 씁니다.
create or replace function public.member_log_save(p_id text, p_pin text, p_log bigint, p_day text,
  p_minutes int default null, p_song text default null, p_did text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  mid text;
  today date := private.now_kst()::date;
  d date;
  new_id bigint;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  begin d := p_day::date; exception when others then return private.fail('날짜를 골라주세요.'); end;
  if d is null or d > today or d < today - 60 then return private.fail('오늘부터 60일 전까지의 날짜로 써주세요.'); end if;
  if p_minutes is not null and (p_minutes < 0 or p_minutes > 1440) then return private.fail('연습 시간을 다시 확인해주세요.'); end if;
  if trim(coalesce(p_did, '')) = '' and p_minutes is null then return private.fail('연습한 내용이나 시간을 적어주세요.'); end if;
  if p_log is null then
    if (select count(*) from public.practice_logs where member_id = mid and day = d) >= 10 then return private.fail('하루에 10개까지 쓸 수 있어요.'); end if;
    insert into public.practice_logs (member_id, day, minutes, song, did)
    values (mid, d, p_minutes, nullif(trim(coalesce(p_song, '')), ''), nullif(trim(coalesce(p_did, '')), ''))
    returning id into new_id;
  else
    update public.practice_logs set day = d, minutes = p_minutes, song = nullif(trim(coalesce(p_song, '')), ''),
      did = nullif(trim(coalesce(p_did, '')), '')
    where id = p_log and member_id = mid returning id into new_id;
    if new_id is null then return private.fail('일지를 찾을 수 없어요.'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', new_id);
end $$;

create or replace function public.member_log_delete(p_id text, p_pin text, p_log bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare who jsonb := private.check_ready(p_id, p_pin);
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  delete from public.practice_logs where id = p_log and member_id = who ->> 'id';
  return jsonb_build_object('ok', true);
end $$;

-- 노래 추천받기 신청: 열린 신청이 있으면 그걸 고쳐요 (한 달에 5번까지).
-- p_files: 학생이 올린 노래 녹음 (song-recordings/<수강 ID>/…, 3개까지). null이면 녹음은 그대로 둠.
drop function if exists public.member_song_request(text, text, text, text, text);
create or replace function public.member_song_request(p_id text, p_pin text, p_likes text default null,
  p_goal text default null, p_memo text default null, p_files jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  mid text;
  open_id bigint;
  v_likes text := nullif(trim(coalesce(p_likes, '')), '');
  v_memo text := nullif(trim(coalesce(p_memo, '')), '');
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  if p_goal is not null and p_goal not in ('오디션', '입시', '취미', '공연') then return private.fail('목표를 골라주세요.'); end if;
  if char_length(coalesce(v_likes, '')) > 300 or char_length(coalesce(v_memo, '')) > 500 then return private.fail('글이 너무 길어요.'); end if;
  if p_files is not null then
    if jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) > 3 then return private.fail('녹음은 3개까지 올릴 수 있어요.'); end if;
    if exists (select 1 from jsonb_array_elements(p_files) f where coalesce(f ->> 'path', '') not like mid || '/%') then
      return private.fail('녹음을 다시 올려주세요.');
    end if;
  end if;
  select id into open_id from public.song_requests where member_id = mid and status = '접수' order by id desc limit 1;
  if open_id is null then
    if (select count(*) from public.song_requests where member_id = mid and created_at > now() - interval '30 days') >= 5 then
      return private.fail('한 달에 5번까지 신청할 수 있어요.');
    end if;
    insert into public.song_requests (member_id, likes, goal, memo, files)
    values (mid, v_likes, p_goal, v_memo, coalesce(p_files, '[]'::jsonb)) returning id into open_id;
    perform private.notify('🎵 노래 추천 신청: ' || (who ->> 'name') || ' (' || mid || ')'
      || case when jsonb_array_length(coalesce(p_files, '[]'::jsonb)) > 0 then ' · 녹음 ' || jsonb_array_length(p_files) || '개' else '' end);
  else
    update public.song_requests set likes = v_likes, goal = p_goal, memo = v_memo, files = coalesce(p_files, files) where id = open_id;
  end if;
  return jsonb_build_object('ok', true, 'id', open_id);
end $$;

-- ---------------------------------------------------------------- 카카오 로그인

-- 카카오로 로그인한 사람의 상태: 연결됨 / 요청 대기 / 거절 / 아직 요청 없음.
create or replace function public.kakao_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  m public.members;
  r public.link_requests;
begin
  if uid is null then return private.fail('카카오 로그인이 필요해요.'); end if;
  select * into m from public.members where kakao_user = uid;
  if m.id is not null then
    return jsonb_build_object('ok', true, 'linked', true, 'name', m.name, 'active', m.status in ('재원', '외부'));
  end if;
  select * into r from public.link_requests where user_id = uid;
  return jsonb_build_object('ok', true, 'linked', false, 'request',
    case when r.id is null then null else jsonb_build_object('status', r.status, 'name', r.name, 'teacher', r.teacher) end);
end $$;

-- "저는 ○○○예요" 연결 요청 (다시 보내면 고쳐서 다시 대기).
create or replace function public.kakao_link_request(p_name text, p_teacher text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  meta jsonb := coalesce(auth.jwt() -> 'user_metadata', '{}'::jsonb);
  v_name text := trim(coalesce(p_name, ''));
begin
  if uid is null then return private.fail('카카오 로그인이 필요해요.'); end if;
  if exists (select 1 from public.members where kakao_user = uid) then return private.fail('이미 연결된 계정이에요.'); end if;
  if length(v_name) < 1 or length(v_name) > 30 then return private.fail('이름을 정확히 적어주세요.'); end if;
  insert into public.link_requests (user_id, kakao_name, name, teacher)
  values (uid, nullif(coalesce(meta ->> 'full_name', meta ->> 'name', meta ->> 'nickname', meta ->> 'preferred_username'), ''),
          v_name, nullif(trim(coalesce(p_teacher, '')), ''))
  on conflict (user_id) do update
    set name = excluded.name, teacher = excluded.teacher, kakao_name = excluded.kakao_name,
        status = '대기', member_id = null, created_at = now(), decided_at = null;
  perform private.notify('🔗 카카오 연결 요청: ' || v_name || coalesce(' · ' || nullif(trim(coalesce(p_teacher, '')), '') || ' 선생님', ''));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- 관리자용 함수

-- 수강 ID 추가·수정. p_pin을 주면 비밀번호도 바꿉니다 (새 ID는 필수).
create or replace function public.admin_save_member(
  p_id text, p_name text, p_phone text default null, p_status text default '재원',
  p_expires_on date default null, p_memo text default null, p_pin text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  mid text := upper(trim(coalesce(p_id, '')));
  pin text := regexp_replace(coalesce(p_pin, ''), '\D', '', 'g');
  exists_ boolean;
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있습니다.'); end if;
  if mid !~ '^[A-Z0-9_-]{2,20}$' then return private.fail('수강 ID는 영문·숫자 2~20자로 정해주세요.'); end if;
  if trim(coalesce(p_name, '')) = '' then return private.fail('이름을 입력해주세요.'); end if;
  if p_status not in ('재원', '외부', '휴원', '종료') then return private.fail('상태를 골라주세요.'); end if;
  if pin <> '' and length(pin) <> 4 then return private.fail('비밀번호는 숫자 4자리입니다.'); end if;
  select true into exists_ from public.members where id = mid;
  if exists_ is null then
    if pin = '' then return private.fail('새 수강 ID에는 비밀번호 4자리가 필요합니다.'); end if;
    insert into public.members (id, name, phone, status, expires_on, memo, pin_hash, must_change_pin)
    values (mid, trim(p_name), nullif(trim(coalesce(p_phone, '')), ''), p_status, p_expires_on,
            nullif(trim(coalesce(p_memo, '')), ''), extensions.crypt(pin, extensions.gen_salt('bf')), pin = '0000');
  else
    update public.members set name = trim(p_name), phone = nullif(trim(coalesce(p_phone, '')), ''),
      status = p_status, expires_on = p_expires_on, memo = nullif(trim(coalesce(p_memo, '')), ''),
      pin_hash = case when pin <> '' then extensions.crypt(pin, extensions.gen_salt('bf')) else pin_hash end,
      must_change_pin = case when pin <> '' then pin = '0000' else must_change_pin end
    where id = mid;
    if pin <> '' then
      delete from private.login_fails where member_id = mid;
      delete from private.member_tokens where member_id = mid;  -- 모든 기기에서 로그아웃
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', mid, 'created', exists_ is null);
end $$;

-- 연결 요청 승인(수강 ID와 잇기) 또는 거절.
create or replace function public.admin_kakao_decide(p_request bigint, p_member text, p_approve boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.link_requests;
  mid text := upper(trim(coalesce(p_member, '')));
  owner text;
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있습니다.'); end if;
  select * into r from public.link_requests where id = p_request;
  if r.id is null then return private.fail('요청을 찾을 수 없어요.'); end if;
  if not coalesce(p_approve, false) then
    update public.link_requests set status = '거절', member_id = null, decided_at = now() where id = r.id;
    return jsonb_build_object('ok', true, 'status', '거절');
  end if;
  if not exists (select 1 from public.members where id = mid) then return private.fail('수강 ID를 골라주세요.'); end if;
  select id into owner from public.members where kakao_user = r.user_id and id <> mid;
  if owner is not null then return private.fail('이 카카오 계정은 이미 ' || owner || '에 연결돼 있어요.'); end if;
  update public.members set kakao_user = r.user_id where id = mid;
  update public.link_requests set status = '승인', member_id = mid, decided_at = now() where id = r.id;
  return jsonb_build_object('ok', true, 'status', '승인', 'member', mid);
end $$;

-- 카카오 연결 해제 (휴대폰·계정을 바꿨을 때 등).
create or replace function public.admin_kakao_unlink(p_member text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있습니다.'); end if;
  update public.link_requests set status = '거절', decided_at = now()
   where user_id = (select kakao_user from public.members where id = upper(trim(coalesce(p_member, ''))));
  update public.members set kakao_user = null where id = upper(trim(coalesce(p_member, '')));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- 보관 기간 (개인정보처리방침, tools/privacy.py)

create or replace function private.track_ended() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = '종료' and (tg_op = 'INSERT' or old.status is distinct from '종료') then new.ended_at := now();
  elsif new.status <> '종료' then new.ended_at := null;
  end if;
  return new;
end $$;
drop trigger if exists members_track_ended on public.members;
create trigger members_track_ended before insert or update of status on public.members
  for each row execute function private.track_ended();

-- 보관 기간이 지난 정보를 지웁니다 (지금은 예약 실행 안 함, 맨 아래 참고). 기간을 바꾸면 tools/privacy.py도 같이 고치기.
create or replace function private.cleanup() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  today date := private.now_kst()::date;
  gone_members text[];
  n_consults int; n_bookings int; n_users int; n_members int;
begin
  delete from public.consults where created_at < now() - interval '1 year';
  get diagnostics n_consults = row_count;
  delete from public.bookings where day < today - 365;
  get diagnostics n_bookings = row_count;
  delete from private.login_fails where at < now() - interval '1 day';
  delete from private.member_tokens where expires_at <= now();

  -- 수강이 끝나고 1년: 학생 정보와 그 학생의 예약·평가·노트, 연결된 카카오 계정까지
  select coalesce(array_agg(id), '{}') into gone_members from public.members
   where status = '종료' and ended_at < now() - interval '1 year';
  delete from auth.users where id in (select kakao_user from public.members where id = any (gone_members) and kakao_user is not null)
    and id not in (select user_id from public.admins);
  delete from public.bookings where member_id = any (gone_members);
  delete from public.members where id = any (gone_members);
  get diagnostics n_members = row_count;

  -- 카카오로 들어왔지만 3개월 넘게 승인되지 않은 계정 (요청을 안 보냈거나, 대기·거절)
  delete from auth.users u
   where u.created_at < now() - interval '3 months'
     and u.id not in (select kakao_user from public.members where kakao_user is not null)
     and u.id not in (select user_id from public.admins)
     and u.id not in (select user_id from public.link_requests where status = '승인')
     and coalesce(u.raw_app_meta_data ->> 'provider', '') = 'kakao';
  get diagnostics n_users = row_count;
  delete from public.link_requests r where r.status <> '승인' and r.created_at < now() - interval '3 months';
  delete from public.link_requests r where r.status = '승인'
     and not exists (select 1 from public.members m where m.kakao_user = r.user_id);

  return jsonb_build_object('consults', n_consults, 'bookings', n_bookings, 'members', n_members, 'kakao_users', n_users);
end $$;

-- ---------------------------------------------------------------- 권한

alter table public.settings enable row level security;
alter table public.rooms    enable row level security;
alter table public.members  enable row level security;
alter table public.bookings enable row level security;
alter table public.consults enable row level security;
alter table public.eval_reports enable row level security;
alter table public.audition_news enable row level security;
alter table public.notices enable row level security;
alter table public.repertoire enable row level security;
alter table public.practice_logs enable row level security;
alter table public.song_recs enable row level security;
alter table public.song_requests enable row level security;
alter table public.admins   enable row level security;
alter table public.lesson_notes  enable row level security;
alter table public.monthly_evals enable row level security;
alter table public.link_requests enable row level security;

-- 손님(anon)은 표를 직접 볼 수 없고, 관리자로 로그인한 사람만 모든 표를 다룹니다.
do $$
declare tbl text;
begin
  foreach tbl in array array['settings', 'rooms', 'bookings', 'consults', 'lesson_notes', 'monthly_evals', 'eval_reports', 'audition_news', 'notices', 'repertoire', 'practice_logs', 'song_recs', 'song_requests', 'link_requests'] loop
    execute format('drop policy if exists admin_all on public.%I', tbl);
    execute format('create policy admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', tbl);
  end loop;
end $$;
drop policy if exists admin_read on public.members;
create policy admin_read on public.members for select to authenticated using (public.is_admin());
drop policy if exists admin_read on public.admins;
create policy admin_read on public.admins for select to authenticated using (public.is_admin());

revoke all on public.settings, public.rooms, public.members, public.bookings, public.consults, public.admins, public.link_requests,
  public.lesson_notes, public.monthly_evals, public.eval_reports, public.notices, public.repertoire, public.practice_logs, public.song_recs, public.song_requests from anon;
revoke all on public.members from authenticated;
-- 비밀번호 해시는 관리자에게도 내보내지 않습니다. 수정은 admin_save_member로만.
grant select (id, name, phone, status, expires_on, memo, must_change_pin, kakao_user, created_at) on public.members to authenticated;
grant select, update, delete on public.link_requests to authenticated;
grant delete on public.members to authenticated;
drop policy if exists admin_delete on public.members;
create policy admin_delete on public.members for delete to authenticated using (public.is_admin());
grant select, insert, update, delete on public.settings, public.rooms, public.bookings, public.consults,
  public.lesson_notes, public.monthly_evals, public.eval_reports, public.audition_news,
  public.notices, public.repertoire, public.practice_logs, public.song_recs, public.song_requests to authenticated;
-- 오디션 소식은 공개: 누구나 올라간(published) 글만 읽기
grant select on public.audition_news to anon;
drop policy if exists public_read on public.audition_news;
create policy public_read on public.audition_news for select to anon, authenticated using (published);
grant select on public.admins to authenticated;
grant usage, select on all sequences in schema public to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
revoke execute on function public.rooms_day(text), public.member_login(text, text), public.member_notebook(text, text),
  public.member_logout(text, text), public.member_change_pin(text, text, text),
  public.booking_create(text, text, text, text, text, int), public.booking_cancel(text, text, bigint),
  public.consult_create(text, text, text, text, text, text, text),
  public.admin_save_member(text, text, text, text, date, text, text), public.is_admin(),
  public.kakao_status(), public.kakao_link_request(text, text),
  public.admin_kakao_decide(bigint, text, boolean), public.admin_kakao_unlink(text) from public;
grant execute on function public.rooms_day(text), public.member_login(text, text), public.member_notebook(text, text),
  public.member_logout(text, text), public.member_change_pin(text, text, text),
  public.booking_create(text, text, text, text, text, int), public.booking_cancel(text, text, bigint),
  public.consult_create(text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.admin_save_member(text, text, text, text, date, text, text), public.is_admin(),
  public.kakao_status(), public.kakao_link_request(text, text),
  public.admin_kakao_decide(bigint, text, boolean), public.admin_kakao_unlink(text) to authenticated;

-- 자동 정리는 켜지 않습니다 (원장님 결정, 2026-10-27). 켜려면 원장님 허락을 받은 뒤 아래 두 줄을 따로 실행:
--   create extension if not exists pg_cron;
--   select cron.schedule('leesh_cleanup', '0 19 * * *', 'select private.cleanup()');

-- 월말평가 평가지 사진: 비공개 버킷. 원장님은 올리고 지우고, 학생은 카카오로 로그인했을 때 자기 폴더만 봅니다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('eval-reports', 'eval-reports', false, 3145728, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists eval_reports_admin on storage.objects;
create policy eval_reports_admin on storage.objects for all to authenticated
  using (bucket_id = 'eval-reports' and public.is_admin())
  with check (bucket_id = 'eval-reports' and public.is_admin());
drop policy if exists eval_reports_own on storage.objects;
create policy eval_reports_own on storage.objects for select to authenticated
  using (bucket_id = 'eval-reports' and (storage.foldername(name))[1] =
         (select m.id from public.members m where m.kakao_user = auth.uid() and m.status in ('재원', '외부')));

-- 오디션 소식 포스터: 공개 버킷 (누구나 보기), 올리고 지우기는 원장님만.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audition-news', 'audition-news', true, 3145728, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists audition_news_admin on storage.objects;
create policy audition_news_admin on storage.objects for all to authenticated
  using (bucket_id = 'audition-news' and public.is_admin())
  with check (bucket_id = 'audition-news' and public.is_admin());

-- 내 폴더: 학생이 직접 쓰는 레퍼토리·연습 일지 함수
revoke execute on function public.member_repertoire_save(text, text, bigint, text, text, text, text, text),
  public.member_repertoire_delete(text, text, bigint), public.member_log_save(text, text, bigint, text, int, text, text),
  public.member_log_delete(text, text, bigint) from public;
grant execute on function public.member_repertoire_save(text, text, bigint, text, text, text, text, text),
  public.member_repertoire_delete(text, text, bigint), public.member_log_save(text, text, bigint, text, int, text, text),
  public.member_log_delete(text, text, bigint) to anon, authenticated;

-- 노래 추천받기 신청
revoke execute on function public.member_song_request(text, text, text, text, text, jsonb) from public;
grant execute on function public.member_song_request(text, text, text, text, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------- 인스타그램 → 홈페이지 (2026-10-28)
-- 오디션반 인스타의 글을 가져와 오디션 소식에 블로그 글처럼 보여줍니다 (원장님: 해시태그 없이, 빠지는 글 없이).
-- 연결 열쇠(토큰)는 원장님이 관리자 화면에 붙여넣고, 비공개 표에만 둡니다. 사진은 GitHub Action이 assets/ig/로 복사.
create extension if not exists http with schema extensions;

create table if not exists private.instagram (
  id           int primary key default 1 check (id = 1),
  token        text,
  token_set_at timestamptz,
  refreshed_at timestamptz,
  last_sync    timestamptz,
  last_error   text
);
insert into private.instagram (id) values (1) on conflict do nothing;

create table if not exists public.ig_posts (
  id         text primary key,                        -- 인스타 글 번호
  posted_at  timestamptz not null,
  caption    text,
  permalink  text,
  media_type text,
  images     jsonb not null default '[]'::jsonb,      -- 인스타 사진 주소 (시간이 지나면 끊김 → assets/ig/<id>/<n>.webp 로 복사)
  kind       text not null default '소식' check (kind in ('내방', '오디션', '합격', '소식')),
  kind_fixed boolean not null default false,          -- 원장님이 칸을 옮긴 글은 다시 추측하지 않음
  hidden     boolean not null default false,
  synced_at  timestamptz not null default now()
);
create index if not exists ig_posts_posted_idx on public.ig_posts (posted_at desc);

-- 글 내용으로 칸 고르기: 합격 축하 → 합격, 내방 → 학원 내방 오디션, 오디션 → 기획사 오디션, 나머지 → 학원 소식
create or replace function private.ig_guess(c text) returns text
language sql immutable set search_path = '' as $$
  select case
    when c ~ '합격' and c ~ '축하' then '합격'
    when c ~ '내방' then '내방'
    when c ~ '합격' then '합격'
    when c ~* '오디션|audition|캐스팅' then '오디션'
    else '소식' end;
$$;

-- 인스타에서 최근 글 가져오기 (pages × 50개). 열쇠는 20일마다 새로 받아서 60일 기한이 끊기지 않게.
create or replace function private.ig_sync(pages int default 1) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ig private.instagram;
  url text;
  r extensions.http_response;
  j jsonb;
  m jsonb;
  n int := 0;
  p int := 0;
begin
  select * into ig from private.instagram where id = 1;
  if coalesce(ig.token, '') = '' then return jsonb_build_object('ok', false, 'error', '인스타그램이 아직 연결되지 않았어요.'); end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '25');
  if coalesce(ig.refreshed_at, ig.token_set_at) < now() - interval '20 days' then
    r := extensions.http_get('https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=' || ig.token);
    if r.status = 200 and (r.content::jsonb ->> 'access_token') is not null then
      update private.instagram set token = r.content::jsonb ->> 'access_token', refreshed_at = now() where id = 1;
      ig.token := r.content::jsonb ->> 'access_token';
    end if;
  end if;
  url := 'https://graph.instagram.com/v23.0/me/media?limit=50&fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,'
      || 'children%7Bmedia_type,media_url,thumbnail_url%7D&access_token=' || ig.token;
  loop
    r := extensions.http_get(url);
    if r.status <> 200 then
      update private.instagram set last_error = left(coalesce(r.content, 'HTTP ' || r.status), 300) where id = 1;
      return jsonb_build_object('ok', false, 'error', '인스타그램에서 글을 받지 못했어요.', 'status', r.status);
    end if;
    j := r.content::jsonb;
    for m in select * from jsonb_array_elements(coalesce(j -> 'data', '[]'::jsonb)) loop
      insert into public.ig_posts (id, posted_at, caption, permalink, media_type, images, kind, synced_at)
      values (m ->> 'id', (m ->> 'timestamp')::timestamptz, m ->> 'caption', m ->> 'permalink', m ->> 'media_type',
        coalesce((select jsonb_agg(coalesce(case when c ->> 'media_type' = 'VIDEO' then c ->> 'thumbnail_url' end, c ->> 'media_url'))
                  from jsonb_array_elements(m -> 'children' -> 'data') c),
                 jsonb_build_array(coalesce(case when m ->> 'media_type' = 'VIDEO' then m ->> 'thumbnail_url' end, m ->> 'media_url'))),
        private.ig_guess(coalesce(m ->> 'caption', '')), now())
      on conflict (id) do update set caption = excluded.caption, permalink = excluded.permalink, media_type = excluded.media_type,
        images = excluded.images, synced_at = now(),
        kind = case when public.ig_posts.kind_fixed then public.ig_posts.kind else excluded.kind end;
      n := n + 1;
    end loop;
    p := p + 1;
    exit when p >= pages or (j -> 'paging' ->> 'next') is null;
    url := j -> 'paging' ->> 'next';
  end loop;
  update private.instagram set last_sync = now(), last_error = null where id = 1;
  return jsonb_build_object('ok', true, 'count', n);
end $$;

-- 관리자 화면: 열쇠 넣기(+ 처음엔 최근 300개 가져오기), 지금 가져오기, 상태 보기. 열쇠 자체는 다시 보여주지 않음.
create or replace function public.admin_instagram_connect(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  if length(trim(coalesce(p_token, ''))) < 40 then return private.fail('토큰을 다시 복사해서 붙여넣어 주세요.'); end if;
  update private.instagram set token = trim(p_token), token_set_at = now(), refreshed_at = now(), last_error = null where id = 1;
  return private.ig_sync(6);
end $$;
create or replace function public.admin_instagram_sync() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  return private.ig_sync(1);
end $$;
create or replace function public.admin_instagram_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare ig private.instagram;
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  select * into ig from private.instagram where id = 1;
  return jsonb_build_object('ok', true, 'connected', coalesce(ig.token, '') <> '', 'since', ig.token_set_at,
    'lastSync', ig.last_sync, 'error', ig.last_error, 'count', (select count(*) from public.ig_posts));
end $$;

alter table public.ig_posts enable row level security;
drop policy if exists admin_all on public.ig_posts;
create policy admin_all on public.ig_posts for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists public_read on public.ig_posts;
create policy public_read on public.ig_posts for select to anon, authenticated using (not hidden);
grant select on public.ig_posts to anon;
grant select, update, delete on public.ig_posts to authenticated;
revoke all on private.instagram from public, anon, authenticated;
revoke all on function private.ig_sync(int), private.ig_guess(text) from public, anon, authenticated;
revoke execute on function public.admin_instagram_connect(text), public.admin_instagram_sync(), public.admin_instagram_status() from public, anon;
grant execute on function public.admin_instagram_connect(text), public.admin_instagram_sync(), public.admin_instagram_status() to authenticated;

-- 인스타 글 정리 (2026-10-28): 모든 글에 붙는 학원 홍보 문구·해시태그·구분선을 빼고 진짜 내용으로 칸을 고르고 제목을 뽑음.
-- 내용이 홍보 문구뿐인 글(홍보 영상)은 처음부터 숨김 (관리자 화면에서 다시 보이기 가능).
alter table public.ig_posts add column if not exists title text;
alter table public.ig_posts add column if not exists body text;

create or replace function private.ig_clean(c text) returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    coalesce(c, ''),
    '📍📍대형 기획사 보컬 트레이너 원장.*?\(24시간 상담\)❤️', '', 'g'),        -- the academy's standard promo block
    '✔️.{0,2}?오디션은 많이 보는 것보다.*?문의주세요!.{0,2}?:\)', '', 'g'),               -- (sometimes on its own)
    '#[^\s#]+', '', 'g'),                                                    -- hashtags
    '(^|\n)[\s⠀_─･｡ﾟ☆:*.☽-]*(?=\n|$)', '\1', 'g'),                          -- separator / blank lines
    '\n{2,}', E'\n\n', 'g'), E' \n\t⠀');
$$;

create or replace function private.ig_title(body text) returns text
language sql immutable set search_path = '' as $$
  select left(coalesce((
    select btrim(l, E' \t⠀') from regexp_split_to_table(coalesce(body, ''), '\n') with ordinality t(l, i)
    where btrim(l, E' \t⠀') <> '' and btrim(l, E' \t⠀') !~ '^\[?\s*\d{4}\s*이송희\s*보컬\s*레슨\s*\]?$'
    order by i limit 1), ''), 80);
$$;

-- 칸 고르기 (정리한 내용으로): 합격 소식 → 합격, 내방 오디션 → 내방, 기획사 오디션 공고 → 오디션, 나머지 → 학원 소식
create or replace function private.ig_guess(c text) returns text
language sql immutable set search_path = '' as $$
  select case
    when b ~ '(합격자|합격을 축하|축하합니다|최종\s*합격|\d차\s*합격|합격했|합격하였)' and b !~ '합격\s*곡' then '합격'
    when b ~ '내방\s*오디션' then '내방'
    when b ~ '오디션' and b ~ '(모집\s*(대상|분야)|지원\s*(방법|자격|분야)|접수\s*(기간|방법)|오디션\s*(공고|일정))'
         and b !~ '(특강|클래스|챌린지|다이어트)' then '오디션'
    else '소식' end
  from (select private.ig_clean(c) b) x;
$$;

create or replace function private.ig_sync(pages int default 1) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ig private.instagram;
  url text;
  r extensions.http_response;
  j jsonb;
  m jsonb;
  b text;
  n int := 0;
  p int := 0;
begin
  select * into ig from private.instagram where id = 1;
  if coalesce(ig.token, '') = '' then return jsonb_build_object('ok', false, 'error', '인스타그램이 아직 연결되지 않았어요.'); end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '25');
  if coalesce(ig.refreshed_at, ig.token_set_at) < now() - interval '20 days' then
    r := extensions.http_get('https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=' || ig.token);
    if r.status = 200 and (r.content::jsonb ->> 'access_token') is not null then
      update private.instagram set token = r.content::jsonb ->> 'access_token', refreshed_at = now() where id = 1;
      ig.token := r.content::jsonb ->> 'access_token';
    end if;
  end if;
  url := 'https://graph.instagram.com/v23.0/me/media?limit=50&fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,'
      || 'children%7Bmedia_type,media_url,thumbnail_url%7D&access_token=' || ig.token;
  loop
    r := extensions.http_get(url);
    if r.status <> 200 then
      update private.instagram set last_error = left(coalesce(r.content, 'HTTP ' || r.status), 300) where id = 1;
      return jsonb_build_object('ok', false, 'error', '인스타그램에서 글을 받지 못했어요.', 'status', r.status);
    end if;
    j := r.content::jsonb;
    for m in select * from jsonb_array_elements(coalesce(j -> 'data', '[]'::jsonb)) loop
      b := private.ig_clean(m ->> 'caption');
      insert into public.ig_posts (id, posted_at, caption, permalink, media_type, images, kind, title, body, hidden, synced_at)
      values (m ->> 'id', (m ->> 'timestamp')::timestamptz, m ->> 'caption', m ->> 'permalink', m ->> 'media_type',
        coalesce((select jsonb_agg(coalesce(case when c ->> 'media_type' = 'VIDEO' then c ->> 'thumbnail_url' end, c ->> 'media_url'))
                  from jsonb_array_elements(m -> 'children' -> 'data') c),
                 jsonb_build_array(coalesce(case when m ->> 'media_type' = 'VIDEO' then m ->> 'thumbnail_url' end, m ->> 'media_url'))),
        private.ig_guess(m ->> 'caption'), private.ig_title(b), b, b = '', now())
      on conflict (id) do update set caption = excluded.caption, permalink = excluded.permalink, media_type = excluded.media_type,
        images = excluded.images, title = excluded.title, body = excluded.body, synced_at = now(),
        kind = case when public.ig_posts.kind_fixed then public.ig_posts.kind else excluded.kind end;
      n := n + 1;
    end loop;
    p := p + 1;
    exit when p >= pages or (j -> 'paging' ->> 'next') is null;
    url := j -> 'paging' ->> 'next';
  end loop;
  update private.instagram set last_sync = now(), last_error = null where id = 1;
  return jsonb_build_object('ok', true, 'count', n);
end $$;
revoke all on function private.ig_clean(text), private.ig_title(text), private.ig_guess(text), private.ig_sync(int) from public, anon, authenticated;

-- 칸 고르기 다듬기: 합격은 글 첫머리(3줄)로만, 기획사 오디션은 공고 문구로, 특강·단과반·챌린지는 학원 소식으로.
create or replace function private.ig_guess(c text) returns text
language sql immutable set search_path = '' as $$
  select case
    when h ~ '(합격자|합격을 축하|축하합니다|데뷔를 축하|컴백을 축하|합격했|최종\s*합격생을 배출)' and h !~ '(Q&A|특강)' then '합격'
    when b ~ '내방\s*오디션' then '내방'
    when b ~* '(오디션 개최|audition|공개 오디션을 진행|지원\s*자격|접수\s*기간|모집\s*대상)' and b !~ '(특강|단과반|클래스|챌린지|다이어트|OPEN)' then '오디션'
    else '소식' end
  from (select b, array_to_string((regexp_split_to_array(b, '\n+'))[1:3], ' ') h
        from (select private.ig_clean(c) b) x) y;
$$;
revoke all on function private.ig_guess(text) from public, anon, authenticated;

-- 제목: 인사말("안녕하세요…")이나 아주 짧은 줄("혹시…")은 건너뛰고 그다음 줄로
create or replace function private.ig_title(body text) returns text
language sql immutable set search_path = '' as $$
  select left(coalesce((
    select btrim(l, E' \t⠀') from regexp_split_to_table(coalesce(body, ''), '\n') with ordinality t(l, i)
    where char_length(btrim(l, E' \t⠀')) > 4
      and btrim(l, E' \t⠀') !~ '^\[?\s*\d{4}\s*이송희\s*보컬\s*레슨\s*\]?$'
      and btrim(l, E' \t⠀') !~ '^안녕하세요'
    order by i limit 1), btrim(split_part(coalesce(body, ''), E'\n', 1))), 80);
$$;
revoke all on function private.ig_title(text) from public, anon, authenticated;

-- 원장님 허락 (2026-10-28 "응 2개다 켜줘"): 2시간마다 인스타 새 글 가져오기. 가져오기만 하고 지우지 않음.
create extension if not exists pg_cron;
select cron.schedule('leesh_instagram', '7 */2 * * *', 'select private.ig_sync(1)');
-- 합격 소식 → about 합격 실적판 (2026-10-28): 합격 소식에 종류·단계·이니셜을 같이 적으면 실적판(연도별 칩, 기획사 카드, 숫자)이 저절로 늘어남.
alter table public.audition_news add column if not exists pass_type text check (pass_type in ('기획사', '방송', '입시'));
alter table public.audition_news add column if not exists pass_stage text check (char_length(pass_stage) <= 30);
alter table public.audition_news add column if not exists initials text check (char_length(initials) <= 20);
-- 학생 실명은 받지 않음: 한글 2~4자 그대로(예: 김민지)는 막고 김OO처럼만
alter table public.audition_news drop constraint if exists audition_news_initials_not_name;
alter table public.audition_news add constraint audition_news_initials_not_name check (initials is null or initials !~ '^[가-힣]{2,4}$');

-- 노래 녹음 (2026-10-28): 학생이 내 폴더에서 녹음하거나 파일을 골라 올림. 비공개 버킷, 본인 폴더(<수강 ID>/)만 · 6개까지.
-- 원장님(관리자)이 듣고 내려받고, 추천을 올린 뒤 관리자 화면의 "녹음 지우기"로 지움 (자동 삭제는 안 켬).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('song-recordings', 'song-recordings', false, 31457280,
        array['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/x-m4a', 'audio/m4a', 'audio/wav', 'audio/x-wav', 'audio/ogg',
              'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create or replace function private.song_owner() returns text
language sql stable security definer set search_path = '' as $$
  select m.id from public.members m where m.kakao_user = auth.uid() and m.status in ('재원', '외부') limit 1;
$$;
create or replace function private.song_file_count(mid text) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from storage.objects o where o.bucket_id = 'song-recordings' and (storage.foldername(o.name))[1] = mid;
$$;
grant execute on function private.song_owner(), private.song_file_count(text) to authenticated;
grant usage on schema private to authenticated;
drop policy if exists song_recordings_admin on storage.objects;
create policy song_recordings_admin on storage.objects for all to authenticated
  using (bucket_id = 'song-recordings' and public.is_admin())
  with check (bucket_id = 'song-recordings' and public.is_admin());
drop policy if exists song_recordings_own_read on storage.objects;
create policy song_recordings_own_read on storage.objects for select to authenticated
  using (bucket_id = 'song-recordings' and (storage.foldername(name))[1] = private.song_owner());
drop policy if exists song_recordings_own_add on storage.objects;
create policy song_recordings_own_add on storage.objects for insert to authenticated
  with check (bucket_id = 'song-recordings' and (storage.foldername(name))[1] = private.song_owner()
              and private.song_file_count(private.song_owner()) < 6);
drop policy if exists song_recordings_own_remove on storage.objects;
create policy song_recordings_own_remove on storage.objects for delete to authenticated
  using (bucket_id = 'song-recordings' and (storage.foldername(name))[1] = private.song_owner());

-- 내방 오디션 신청 (2026-10-28): 학원 구글 폼과 같은 질문을 홈페이지에서. 학원생(카카오 로그인)만, 관리자에서 올린
-- "학원 내방 오디션" 소식(audition_news kind 내방)마다 신청서가 붙음. 마감(없으면 오디션 날)까지 신청·고치기.
create table if not exists public.visit_applications (
  id         bigint generated always as identity primary key,
  news_id    bigint references public.audition_news (id) on delete set null,
  audition   text not null check (char_length(audition) <= 120),   -- 신청할 때의 오디션 이름 (소식이 지워져도 남게)
  member_id  text not null references public.members (id) on update cascade on delete cascade,
  name       text not null check (char_length(name) between 1 and 30),
  gender     text check (gender in ('남', '여')),
  birth      text check (char_length(birth) <= 30),                  -- 출생년도/나이 (예: 10년/17살)
  body_size  text check (char_length(body_size) <= 30),              -- 키/몸무게 (예: 168/48)
  field      text check (field in ('보컬', '랩', '댄스', '라이브퍼포먼스', '연기')),
  music      jsonb,                                                 -- 댄스 음원 {"path","name","type","size"} (visit-music 버킷)
  note       text check (char_length(note) <= 1000),                -- 특이사항 (순서 조정 등)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (news_id, member_id)
);
alter table public.visit_applications enable row level security;
drop policy if exists admin_all on public.visit_applications;
create policy admin_all on public.visit_applications for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.visit_applications from anon;
grant select, update, delete on public.visit_applications to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- 학생: 신청 / 고치기 (같은 오디션에 한 번, 다시 보내면 고쳐짐)
create or replace function public.member_visit_apply(p_id text, p_pin text, p_news bigint, p_name text,
  p_gender text default null, p_birth text default null, p_size text default null, p_field text default null,
  p_music jsonb default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  mid text;
  n public.audition_news;
  today date := private.now_kst()::date;
  v_name text := trim(coalesce(p_name, ''));
  app_id bigint;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  select * into n from public.audition_news where id = p_news and kind = '내방' and published;
  if n.id is null then return private.fail('신청할 오디션을 찾을 수 없어요.'); end if;
  if coalesce(n.deadline, n.event_date) is not null and coalesce(n.deadline, n.event_date) < today then
    return private.fail('신청이 마감됐어요. 학원에 문의해주세요.');
  end if;
  if v_name = '' or char_length(v_name) > 30 then return private.fail('이름을 적어주세요.'); end if;
  if p_gender is not null and p_gender not in ('남', '여') then return private.fail('성별을 골라주세요.'); end if;
  if p_field is null or p_field not in ('보컬', '랩', '댄스', '라이브퍼포먼스', '연기') then return private.fail('지원분야를 하나 골라주세요.'); end if;
  if char_length(coalesce(p_birth, '')) > 30 or char_length(coalesce(p_size, '')) > 30 or char_length(coalesce(p_note, '')) > 1000 then
    return private.fail('글이 너무 길어요.');
  end if;
  if p_music is not null and coalesce(p_music ->> 'path', '') not like mid || '/%' then return private.fail('음원을 다시 올려주세요.'); end if;
  insert into public.visit_applications (news_id, audition, member_id, name, gender, birth, body_size, field, music, note)
  values (n.id, left(coalesce(n.company || ' ', '') || n.title, 120), mid, v_name, p_gender,
          nullif(trim(coalesce(p_birth, '')), ''), nullif(trim(coalesce(p_size, '')), ''), p_field, p_music,
          nullif(trim(coalesce(p_note, '')), ''))
  on conflict (news_id, member_id) do update set name = excluded.name, gender = excluded.gender, birth = excluded.birth,
    body_size = excluded.body_size, field = excluded.field, music = coalesce(excluded.music, public.visit_applications.music),
    note = excluded.note, updated_at = now()
  returning id into app_id;
  perform private.notify('🎤 내방 오디션 신청: ' || v_name || ' · ' || p_field || chr(10) || coalesce(n.company || ' ', '') || n.title);
  return jsonb_build_object('ok', true, 'id', app_id);
end $$;

-- 학생: 지금 신청받는 내방 오디션 + 내가 낸 신청서
create or replace function public.member_visit_open(p_id text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  mid text;
  today date := private.now_kst()::date;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  return jsonb_build_object('ok', true, 'name', who ->> 'name', 'auditions', coalesce((
    select jsonb_agg(jsonb_build_object('id', n.id, 'company', n.company, 'title', n.title, 'date', n.event_date,
             'deadline', n.deadline, 'body', n.body, 'image', n.image,
             'mine', (select to_jsonb(a) - 'member_id' from public.visit_applications a where a.news_id = n.id and a.member_id = mid))
             order by n.event_date nulls last, n.id)
    from public.audition_news n
    where n.kind = '내방' and n.published and coalesce(n.deadline, n.event_date, today) >= today
  ), '[]'::jsonb));
end $$;

revoke execute on function public.member_visit_apply(text, text, bigint, text, text, text, text, text, jsonb, text),
  public.member_visit_open(text, text) from public;
grant execute on function public.member_visit_apply(text, text, bigint, text, text, text, text, text, jsonb, text),
  public.member_visit_open(text, text) to anon, authenticated;

-- 댄스 음원: 비공개 버킷, 학생 본인 폴더(<수강 ID>/)만 · 30MB · 6개까지. 원장님은 듣고 내려받고 지움.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('visit-music', 'visit-music', false, 31457280,
        array['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create or replace function private.visit_file_count(mid text) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from storage.objects o where o.bucket_id = 'visit-music' and (storage.foldername(o.name))[1] = mid;
$$;
grant execute on function private.visit_file_count(text) to authenticated;
drop policy if exists visit_music_admin on storage.objects;
create policy visit_music_admin on storage.objects for all to authenticated
  using (bucket_id = 'visit-music' and public.is_admin()) with check (bucket_id = 'visit-music' and public.is_admin());
drop policy if exists visit_music_own_read on storage.objects;
create policy visit_music_own_read on storage.objects for select to authenticated
  using (bucket_id = 'visit-music' and (storage.foldername(name))[1] = private.song_owner());
drop policy if exists visit_music_own_add on storage.objects;
create policy visit_music_own_add on storage.objects for insert to authenticated
  with check (bucket_id = 'visit-music' and (storage.foldername(name))[1] = private.song_owner()
              and private.visit_file_count(private.song_owner()) < 6);
drop policy if exists visit_music_own_remove on storage.objects;
create policy visit_music_own_remove on storage.objects for delete to authenticated
  using (bucket_id = 'visit-music' and (storage.foldername(name))[1] = private.song_owner());

-- 인스타 내방 일정 글 → 신청서 (2026-10-28, 원장님: "인스타에 블리츠웨이 오디션 내용이 있는데?"):
-- "✅ 10월 30일 (금) 18시 30분 블리츠웨이뮤직" 같은 줄을 읽어 아직 안 지난 오디션을 audition_news(source 'ig')로 만들고,
-- 그러면 apply.html 신청서가 저절로 열림. 월말평가 줄은 뺌. 원장님이 관리자에서 고친 내용(포스터·안내)은 그대로 둠.
alter table public.audition_news add column if not exists source text check (source in ('ig'));
create unique index if not exists audition_news_ig_once on public.audition_news (company, event_date) where source = 'ig';

create or replace function private.ig_visits() returns int
language plpgsql security definer set search_path = '' as $$
declare
  p record;
  l text;
  m text[];
  y int;
  d date;
  who text;
  n int := 0;
  today date := private.now_kst()::date;
begin
  for p in select posted_at, body from public.ig_posts
           where kind = '내방' and not hidden and posted_at > now() - interval '75 days' loop
    for l in select regexp_split_to_table(coalesce(p.body, ''), '\n') loop
      m := regexp_match(l, '(\d{1,2})월\s*(\d{1,2})일\s*(?:\([월화수목금토일]\))?\s*(\d{1,2})시\s*(?:(\d{1,2})분)?\s*(.+)$');
      continue when m is null or m[5] ~ '월말\s*평가';
      y := extract(year from p.posted_at at time zone 'Asia/Seoul')::int;
      -- a December post can list January dates
      if m[1]::int < extract(month from p.posted_at at time zone 'Asia/Seoul')::int - 6 then y := y + 1; end if;
      begin d := make_date(y, m[1]::int, m[2]::int); exception when others then continue; end;
      continue when d < today;
      who := btrim(regexp_replace(m[5], '\s*내방\s*오디션\s*$', ''));
      continue when who = '';
      insert into public.audition_news (kind, company, title, event_date, body, published, source)
      values ('내방', left(who, 40), '내방오디션', d,
        '일시 : ' || m[1] || '월 ' || m[2] || '일 ' || coalesce(substring(l from '\([월화수목금토일]\)') || ' ', '')
          || m[3] || '시' || coalesce(' ' || m[4] || '분', '') || E'\n장소 : 이송희보컬레슨 (학원 내방 오디션)'
          || E'\n지원자격·지원분야는 인스타그램 포스터를 확인해주세요.',
        true, 'ig')
      on conflict (company, event_date) where source = 'ig' do nothing;
      if found then n := n + 1; end if;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function private.ig_visits() from public, anon, authenticated;

-- 가져올 때마다 같이: ig_sync가 끝에서 ig_visits를 부름 (예약 실행은 그대로 private.ig_sync(1))
create or replace function private.ig_sync(pages int default 1) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ig private.instagram;
  url text;
  r extensions.http_response;
  j jsonb;
  m jsonb;
  b text;
  n int := 0;
  p int := 0;
begin
  select * into ig from private.instagram where id = 1;
  if coalesce(ig.token, '') = '' then return jsonb_build_object('ok', false, 'error', '인스타그램이 아직 연결되지 않았어요.'); end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '25');
  if coalesce(ig.refreshed_at, ig.token_set_at) < now() - interval '20 days' then
    r := extensions.http_get('https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=' || ig.token);
    if r.status = 200 and (r.content::jsonb ->> 'access_token') is not null then
      update private.instagram set token = r.content::jsonb ->> 'access_token', refreshed_at = now() where id = 1;
      ig.token := r.content::jsonb ->> 'access_token';
    end if;
  end if;
  url := 'https://graph.instagram.com/v23.0/me/media?limit=50&fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,'
      || 'children%7Bmedia_type,media_url,thumbnail_url%7D&access_token=' || ig.token;
  loop
    r := extensions.http_get(url);
    if r.status <> 200 then
      update private.instagram set last_error = left(coalesce(r.content, 'HTTP ' || r.status), 300) where id = 1;
      return jsonb_build_object('ok', false, 'error', '인스타그램에서 글을 받지 못했어요.', 'status', r.status);
    end if;
    j := r.content::jsonb;
    for m in select * from jsonb_array_elements(coalesce(j -> 'data', '[]'::jsonb)) loop
      b := private.ig_clean(m ->> 'caption');
      insert into public.ig_posts (id, posted_at, caption, permalink, media_type, images, kind, title, body, hidden, synced_at)
      values (m ->> 'id', (m ->> 'timestamp')::timestamptz, m ->> 'caption', m ->> 'permalink', m ->> 'media_type',
        coalesce((select jsonb_agg(coalesce(case when c ->> 'media_type' = 'VIDEO' then c ->> 'thumbnail_url' end, c ->> 'media_url'))
                  from jsonb_array_elements(m -> 'children' -> 'data') c),
                 jsonb_build_array(coalesce(case when m ->> 'media_type' = 'VIDEO' then m ->> 'thumbnail_url' end, m ->> 'media_url'))),
        private.ig_guess(m ->> 'caption'), private.ig_title(b), b, b = '', now())
      on conflict (id) do update set caption = excluded.caption, permalink = excluded.permalink, media_type = excluded.media_type,
        images = excluded.images, title = excluded.title, body = excluded.body, synced_at = now(),
        kind = case when public.ig_posts.kind_fixed then public.ig_posts.kind else excluded.kind end;
      n := n + 1;
    end loop;
    p := p + 1;
    exit when p >= pages or (j -> 'paging' ->> 'next') is null;
    url := j -> 'paging' ->> 'next';
  end loop;
  update private.instagram set last_sync = now(), last_error = null where id = 1;
  -- 내방 일정 글의 "✅ 10월 30일 (금) 18시 30분 블리츠웨이뮤직" 줄 → 신청서 (private.ig_visits)
  return jsonb_build_object('ok', true, 'count', n, 'visits', private.ig_visits());
end $$;
revoke all on function private.ig_sync(int) from public, anon, authenticated;

-- ---------------------------------------------------------------- 마이그레이션 leesh_partner_requests (2026-10-28)
-- 제휴 업체 예약 신청 (2026-10-28, 원장님): 예전엔 학생 → 선생님 → 관리자 → 업체 전화. 이제 학생이 내 폴더에서
-- 신청하면 관리자 화면 "제휴 신청" 탭에 바로 보이고, 관리자가 업체에 전화로 예약한 뒤 결과(날짜·시간·안내)를 적으면
-- 학생 내 폴더에 보임. 업체 목록(종류 · 이름 · 안내)은 관리자가 고침. 학생에게만 보이고 공개 페이지에는 안 나옴.
create table if not exists public.partners (
  id         bigint generated always as identity primary key,
  category   text not null check (char_length(category) between 1 and 30),   -- 헤어 메이크업, 피부과 …
  name       text check (char_length(name) <= 60),                          -- 업체 이름 (비워두면 종류만 보임)
  info       text check (char_length(info) <= 500),                         -- 학생에게 보이는 안내 (위치·혜택·준비물 등)
  sort       int not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.partners (category, sort)
select c, o::int * 10
from unnest(array['헤어 메이크업', '붙임머리', '스타일링 컨설팅', '경락', '헬스장', '피부과', '성형외과', '치과', '촬영 스튜디오', '심리상담센터'])
     with ordinality as t(c, o)
where not exists (select 1 from public.partners);

create table if not exists public.partner_requests (
  id         bigint generated always as identity primary key,
  partner_id bigint references public.partners (id) on delete set null,
  partner    text not null check (char_length(partner) <= 100),             -- 신청할 때의 업체 (목록이 바뀌어도 남게)
  member_id  text not null references public.members (id) on update cascade on delete cascade,
  wish       text check (char_length(wish) <= 200),                         -- 원하는 날짜·시간
  memo       text check (char_length(memo) <= 500),                         -- 받고 싶은 것·요청 사항
  status     text not null default '접수' check (status in ('접수', '예약 완료', '취소')),
  reply      text check (char_length(reply) <= 500),                        -- 관리자가 학생에게: 예약 날짜·시간·안내
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists partner_requests_member_idx on public.partner_requests (member_id, created_at desc);

alter table public.partners enable row level security;
alter table public.partner_requests enable row level security;
drop policy if exists admin_all on public.partners;
create policy admin_all on public.partners for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all on public.partner_requests;
create policy admin_all on public.partner_requests for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.partners, public.partner_requests from anon;
grant select, insert, update, delete on public.partners to authenticated;
grant select, update, delete on public.partner_requests to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- 학생: 제휴 업체 목록 + 내 신청 (최근 10개)
create or replace function public.member_partners(p_id text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  mid text;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  return jsonb_build_object('ok', true,
    'partners', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'category', p.category, 'name', p.name, 'info', p.info) order by p.sort, p.id)
      from public.partners p where p.active
    ), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'partner', r.partner, 'wish', r.wish, 'memo', r.memo,
               'status', r.status, 'reply', r.reply, 'at', r.created_at) order by r.created_at desc)
      from (select * from public.partner_requests where member_id = mid order by created_at desc limit 10) r
    ), '[]'::jsonb));
end $$;

-- 학생: 신청 (열린 신청은 3개까지, 한 달에 10번까지)
create or replace function public.member_partner_request(p_id text, p_pin text, p_partner bigint,
  p_wish text default null, p_memo text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  mid text;
  p public.partners;
  v_wish text := nullif(trim(coalesce(p_wish, '')), '');
  v_memo text := nullif(trim(coalesce(p_memo, '')), '');
  label text;
  new_id bigint;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  select * into p from public.partners where id = p_partner and active;
  if p.id is null then return private.fail('업체를 골라주세요.'); end if;
  if v_wish is null then return private.fail('원하는 날짜·시간을 적어주세요.'); end if;
  if char_length(v_wish) > 200 or char_length(coalesce(v_memo, '')) > 500 then return private.fail('글이 너무 길어요.'); end if;
  if (select count(*) from public.partner_requests where member_id = mid and status = '접수') >= 3 then
    return private.fail('아직 처리 중인 신청이 3개 있어요. 예약이 끝나면 다시 신청해주세요.');
  end if;
  if (select count(*) from public.partner_requests where member_id = mid and created_at > now() - interval '30 days') >= 10 then
    return private.fail('한 달에 10번까지 신청할 수 있어요.');
  end if;
  label := p.category || coalesce(' · ' || p.name, '');
  insert into public.partner_requests (partner_id, partner, member_id, wish, memo)
  values (p.id, left(label, 100), mid, v_wish, v_memo) returning id into new_id;
  perform private.notify('💄 제휴 업체 신청: ' || (who ->> 'name') || ' · ' || label || chr(10) || v_wish);
  return jsonb_build_object('ok', true, 'id', new_id);
end $$;

-- 학생: 아직 예약 전(접수)인 신청 취소
create or replace function public.member_partner_cancel(p_id text, p_pin text, p_req bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who jsonb := private.check_ready(p_id, p_pin);
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  update public.partner_requests set status = '취소', updated_at = now()
  where id = p_req and member_id = who ->> 'id' and status = '접수';
  if not found then return private.fail('이미 예약된 신청은 학원에 연락해서 취소해주세요.'); end if;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.member_partners(text, text), public.member_partner_request(text, text, bigint, text, text),
  public.member_partner_cancel(text, text, bigint) from public;
grant execute on function public.member_partners(text, text), public.member_partner_request(text, text, bigint, text, text),
  public.member_partner_cancel(text, text, bigint) to anon, authenticated;

-- ---------------------------------------------------------------- 마이그레이션 leesh_two_day_booking (2026-10-28)
-- 연습실 예약 조건 (원장님 2026-10-28): 오늘·내일 예약 (10/28이면 28일 00:00 ~ 29일 23:00 시작까지),
-- 한 번에 최대 2시간, 횟수 제한 없이 더 예약 가능 (하루 합계 제한 없앰 = 24시간).
update public.settings set max_days = 1, daily_max_minutes = 1440, max_minutes = 120 where id = 1;
CREATE OR REPLACE FUNCTION public.booking_create(p_id text, p_pin text, p_room text, p_date text, p_start text, p_hours integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  mid text;
  s public.settings;
  t timestamp := private.now_kst();
  today date := t::date;
  now_min int := extract(hour from t)::int * 60 + extract(minute from t)::int;
  d date;
  room public.rooms;
  st int := private.to_min(p_start);
  en int;
  used int;
  new_id bigint;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  select * into s from public.settings where id = 1;

  begin
    d := p_date::date;
  exception when others then
    return private.fail('날짜 형식이 올바르지 않습니다.');
  end;
  if d is null then return private.fail('날짜 형식이 올바르지 않습니다.'); end if;
  if d < today then return private.fail('지난 날짜는 예약할 수 없습니다.'); end if;
  if d > today + s.max_days then
    return private.fail(case when s.max_days = 0 then '예약은 당일만 할 수 있어요. 매일 밤 12시에 그날 예약이 열려요.'
                             when s.max_days = 1 then '예약은 오늘과 내일만 할 수 있어요. 매일 밤 12시에 다음 날 예약이 열려요.'
                             else '예약은 오늘부터 ' || s.max_days || '일 뒤까지만 가능합니다.' end);
  end if;

  select * into room from public.rooms where name = p_room and active;
  if room.id is null then
    return private.fail('선택한 연습실을 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.');
  end if;

  if st is null then return private.fail('시작 시간이 올바르지 않습니다.'); end if;
  if p_hours is null or p_hours < 1 then return private.fail('이용 시간을 선택해주세요.'); end if;
  if p_hours * 60 > s.max_minutes then
    return private.fail('한 번에 최대 ' || s.max_minutes / 60 || '시간까지 예약할 수 있습니다.');
  end if;
  en := st + p_hours * 60;
  if (st - s.open_min) % s.unit_min <> 0 then
    return private.fail('예약은 ' || s.unit_min || '분 단위로만 가능합니다.');
  end if;
  if st < s.open_min or en > s.close_min then
    return private.fail('운영 시간(' || private.hhmm(s.open_min) || '~' || private.hhmm(s.close_min) || ') 안에서만 예약할 수 있습니다.');
  end if;
  if d = today and st <= now_min then
    return private.fail('이미 시작한 시간이에요. 다음 시간부터 예약할 수 있어요.');
  end if;

  -- 같은 사람의 동시 요청을 한 줄로 세워 하루 최대 시간 검사가 새지 않게 합니다.
  perform pg_advisory_xact_lock(hashtext('member:' || mid));
  select coalesce(sum(end_min - start_min), 0) into used
    from public.bookings where member_id = mid and day = d and status = '확정';
  if used + (en - st) > s.daily_max_minutes then
    return private.fail('하루 최대 ' || trim_scale(s.daily_max_minutes / 60.0) || '시간까지 예약할 수 있습니다. (이날 이미 '
      || trim_scale(used / 60.0) || '시간 예약)');
  end if;

  begin
    insert into public.bookings (room_id, member_id, day, start_min, end_min)
    values (room.id, mid, d, st, en) returning id into new_id;
  exception when exclusion_violation then
    if sqlerrm like '%bookings_no_member_overlap%' then
      return private.fail('같은 시간에 이미 다른 연습실을 예약하셨습니다.');
    end if;
    return private.fail('방금 다른 예약이 들어왔습니다. 다른 시간을 골라주세요.');
  end;

  perform private.notify('🎤 연습실 예약' || chr(10) || (who ->> 'name') || ' (' || mid || ') · ' || room.name
    || chr(10) || private.day_label(d) || ' ' || private.hhmm(st) || '~' || private.hhmm(en));

  return jsonb_build_object('ok', true, 'booking', jsonb_build_object(
    'id', new_id, 'room', room.name, 'date', d, 'start', private.hhmm(st), 'end', private.hhmm(en)));
end $function$
;

-- ---------------------------------------------------------------- 마이그레이션 leesh_teachers (2026-10-28)
-- 선생님 화면 · 레슨 일지 (2026-10-28, 원장님): 선생님은 관리자가 아니라 "선생님" 권한.
-- 카카오로 로그인 → 이름을 골라 연결 요청 → 원장님이 관리자 → 선생님 탭에서 승인 → teacher.html에서
-- 담당 학생(수강생 메모 "담당 ○○○", 재원·휴원)만 보고 레슨 일지를 씀. 학생은 내 폴더 → 레슨 노트에서 봄.
-- 일지 칸은 선생님들이 쓰던 구글시트 그대로: 오늘 수업 · 준비곡·곡별 피드백 · 연습 포인트 · 오디션 일정 · 노래 추천
-- + 선생님 메모(학생에게 안 보임).

create table if not exists public.teachers (
  id         bigint generated always as identity primary key,
  name       text not null unique check (char_length(name) between 1 and 20),   -- 수강생 메모 "담당 ○○○"의 ○○○
  kakao_user uuid unique,                                                         -- 승인된 카카오 계정
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
-- 처음 선생님 목록: 수강생 메모에 적힌 담당 선생님 전부
insert into public.teachers (name)
select distinct substring(memo from '담당\s*([^\s·,]+)') from public.members
where substring(memo from '담당\s*([^\s·,]+)') is not null
on conflict (name) do nothing;

create table if not exists public.teacher_requests (
  id         bigint generated always as identity primary key,
  user_id    uuid not null unique,
  kakao_name text,
  name       text not null check (char_length(name) between 1 and 20),         -- 고른 선생님 이름
  status     text not null default '대기' check (status in ('대기', '승인', '거절')),
  teacher_id bigint references public.teachers (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

-- 레슨 일지 칸 (예전 did · practice는 그대로 씀)
alter table public.lesson_notes drop constraint if exists lesson_notes_did_check;
alter table public.lesson_notes alter column did drop not null;
alter table public.lesson_notes add column if not exists songs text check (char_length(songs) <= 2000);       -- 준비곡 · 곡별 피드백
alter table public.lesson_notes add column if not exists audition text check (char_length(audition) <= 800);  -- 오디션 일정
alter table public.lesson_notes add column if not exists recommend text check (char_length(recommend) <= 800);-- 노래 추천
alter table public.lesson_notes add column if not exists memo text check (char_length(memo) <= 1000);         -- 선생님 메모 (학생에게 안 보임)
alter table public.lesson_notes add column if not exists teacher_id bigint references public.teachers (id) on delete set null;
alter table public.lesson_notes add column if not exists updated_at timestamptz not null default now();
alter table public.lesson_notes drop constraint if exists lesson_notes_has_content;
alter table public.lesson_notes add constraint lesson_notes_has_content check (
  coalesce(nullif(trim(did), ''), nullif(trim(songs), ''), nullif(trim(practice), ''), nullif(trim(audition), ''),
           nullif(trim(recommend), ''), nullif(trim(memo), '')) is not null);
create index if not exists lesson_notes_member_idx on public.lesson_notes (member_id, lesson_date desc);

alter table public.teachers enable row level security;
alter table public.teacher_requests enable row level security;
drop policy if exists admin_all on public.teachers;
create policy admin_all on public.teachers for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all on public.teacher_requests;
create policy admin_all on public.teacher_requests for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.teachers, public.teacher_requests from anon;
grant select, insert, update, delete on public.teachers to authenticated;
grant select, update, delete on public.teacher_requests to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- 지금 로그인한 카카오 계정의 선생님 (없으면 null)
create or replace function private.my_teacher() returns public.teachers
language sql stable security definer set search_path = '' as $$
  select t from public.teachers t where t.kakao_user = auth.uid() and t.active and auth.uid() is not null;
$$;
-- 이 선생님의 담당 학생인지 (재원·휴원)
create or replace function private.teaches(t public.teachers, mid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.id = mid and m.status in ('재원', '휴원')
                 and substring(m.memo from '담당\s*([^\s·,]+)') = t.name);
$$;

-- 선생님 화면 첫 화면: 연결됐으면 담당 학생, 아니면 요청 상태 + 고를 이름
create or replace function public.teacher_me() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.teachers := private.my_teacher();
  r public.teacher_requests;
begin
  if auth.uid() is null then return private.fail('카카오 로그인이 필요해요.'); end if;
  if t.id is null then
    select * into r from public.teacher_requests where user_id = auth.uid();
    return jsonb_build_object('ok', true, 'linked', false,
      'request', case when r.id is null then null else jsonb_build_object('name', r.name, 'status', r.status) end,
      'names', coalesce((select jsonb_agg(x.name order by x.name) from public.teachers x where x.active), '[]'::jsonb));
  end if;
  return jsonb_build_object('ok', true, 'linked', true, 'name', t.name,
    'students', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'status', m.status,
               'last', (select max(n.lesson_date) from public.lesson_notes n where n.member_id = m.id)) order by m.name)
      from public.members m
      where m.status in ('재원', '휴원') and substring(m.memo from '담당\s*([^\s·,]+)') = t.name
    ), '[]'::jsonb));
end $$;

create or replace function public.teacher_request(p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  meta jsonb := coalesce(auth.jwt() -> 'user_metadata', '{}'::jsonb);
  v_name text := trim(coalesce(p_name, ''));
begin
  if uid is null then return private.fail('카카오 로그인이 필요해요.'); end if;
  if (private.my_teacher()).id is not null then return private.fail('이미 연결된 계정이에요.'); end if;
  if not exists (select 1 from public.teachers where name = v_name and active) then return private.fail('선생님 이름을 골라주세요.'); end if;
  insert into public.teacher_requests (user_id, kakao_name, name)
  values (uid, nullif(coalesce(meta ->> 'full_name', meta ->> 'name', meta ->> 'nickname', meta ->> 'preferred_username'), ''), v_name)
  on conflict (user_id) do update set name = excluded.name, kakao_name = excluded.kakao_name,
    status = '대기', teacher_id = null, created_at = now(), decided_at = null;
  perform private.notify('👩‍🏫 선생님 연결 요청: ' || v_name);
  return jsonb_build_object('ok', true);
end $$;

-- 학생 한 명: 레슨 일지 전부(메모 포함, 내가 쓴 것만 고치기) + 연습 일지 + 레퍼토리
create or replace function public.teacher_student(p_member text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.teachers := private.my_teacher();
  m public.members;
begin
  if t.id is null then return private.fail('선생님으로 연결된 계정만 볼 수 있어요.'); end if;
  if not private.teaches(t, p_member) then return private.fail('담당 학생만 볼 수 있어요.'); end if;
  select * into m from public.members where id = p_member;
  return jsonb_build_object('ok', true, 'student', jsonb_build_object('id', m.id, 'name', m.name, 'status', m.status),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'date', n.lesson_date, 'teacher', n.teacher, 'did', n.did, 'songs', n.songs,
               'practice', n.practice, 'audition', n.audition, 'recommend', n.recommend, 'memo', n.memo,
               'mine', n.teacher_id = t.id) order by n.lesson_date desc, n.id desc)
      from (select * from public.lesson_notes where member_id = m.id order by lesson_date desc, id desc limit 60) n
    ), '[]'::jsonb),
    'logs', coalesce((
      select jsonb_agg(jsonb_build_object('day', l.day, 'minutes', l.minutes, 'song', l.song, 'did', l.did) order by l.day desc, l.id desc)
      from (select * from public.practice_logs where member_id = m.id order by day desc, id desc limit 20) l
    ), '[]'::jsonb),
    'repertoire', coalesce((
      select jsonb_agg(jsonb_build_object('title', r.title, 'artist', r.artist, 'status', r.status, 'purpose', r.purpose) order by r.updated_at desc)
      from public.repertoire r where r.member_id = m.id
    ), '[]'::jsonb));
end $$;

-- 일지 쓰기 / 고치기 (p_note가 있으면 내가 쓴 일지 고치기)
create or replace function public.teacher_note_save(p_member text, p_date date, p_note bigint default null,
  p_did text default null, p_songs text default null, p_practice text default null, p_audition text default null,
  p_recommend text default null, p_memo text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.teachers := private.my_teacher();
  v_id bigint;
  f text[] := array[nullif(trim(coalesce(p_did, '')), ''), nullif(trim(coalesce(p_songs, '')), ''), nullif(trim(coalesce(p_practice, '')), ''),
                    nullif(trim(coalesce(p_audition, '')), ''), nullif(trim(coalesce(p_recommend, '')), ''), nullif(trim(coalesce(p_memo, '')), '')];
begin
  if t.id is null then return private.fail('선생님으로 연결된 계정만 쓸 수 있어요.'); end if;
  if not private.teaches(t, p_member) then return private.fail('담당 학생만 쓸 수 있어요.'); end if;
  if p_date is null or p_date > private.now_kst()::date + 1 or p_date < private.now_kst()::date - 366 then return private.fail('수업 날짜를 확인해주세요.'); end if;
  if coalesce(f[1], f[2], f[3], f[4], f[5], f[6]) is null then return private.fail('한 칸 이상 적어주세요.'); end if;
  if char_length(coalesce(f[1], '')) > 800 or char_length(coalesce(f[2], '')) > 2000 or char_length(coalesce(f[3], '')) > 400
     or char_length(coalesce(f[4], '')) > 800 or char_length(coalesce(f[5], '')) > 800 or char_length(coalesce(f[6], '')) > 1000 then
    return private.fail('글이 너무 길어요.');
  end if;
  if p_note is null then
    insert into public.lesson_notes (member_id, lesson_date, teacher, teacher_id, did, songs, practice, audition, recommend, memo)
    values (p_member, p_date, t.name, t.id, f[1], f[2], f[3], f[4], f[5], f[6]) returning id into v_id;
  else
    update public.lesson_notes set lesson_date = p_date, did = f[1], songs = f[2], practice = f[3], audition = f[4],
      recommend = f[5], memo = f[6], updated_at = now()
    where id = p_note and member_id = p_member and teacher_id = t.id returning id into v_id;
    if v_id is null then return private.fail('내가 쓴 일지만 고칠 수 있어요.'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.teacher_note_delete(p_note bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.teachers := private.my_teacher();
begin
  if t.id is null then return private.fail('선생님으로 연결된 계정만 할 수 있어요.'); end if;
  delete from public.lesson_notes where id = p_note and teacher_id = t.id;
  if not found then return private.fail('내가 쓴 일지만 지울 수 있어요.'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- 관리자: 선생님 연결 요청 승인 / 거절, 연결 끊기
create or replace function public.admin_teacher_decide(p_request bigint, p_teacher bigint, p_approve boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.teacher_requests;
  owner text;
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있습니다.'); end if;
  select * into r from public.teacher_requests where id = p_request;
  if r.id is null then return private.fail('요청을 찾을 수 없어요.'); end if;
  if not coalesce(p_approve, false) then
    update public.teacher_requests set status = '거절', teacher_id = null, decided_at = now() where id = r.id;
    return jsonb_build_object('ok', true, 'status', '거절');
  end if;
  if not exists (select 1 from public.teachers where id = p_teacher) then return private.fail('선생님을 골라주세요.'); end if;
  select name into owner from public.teachers where kakao_user = r.user_id and id <> p_teacher;
  if owner is not null then return private.fail('이 카카오 계정은 이미 ' || owner || ' 선생님에 연결돼 있어요.'); end if;
  update public.teachers set kakao_user = r.user_id where id = p_teacher;
  update public.teacher_requests set status = '승인', teacher_id = p_teacher, decided_at = now() where id = r.id;
  return jsonb_build_object('ok', true, 'status', '승인');
end $$;

revoke all on function private.my_teacher(), private.teaches(public.teachers, text) from public, anon, authenticated;
revoke execute on function public.teacher_me(), public.teacher_request(text), public.teacher_student(text),
  public.teacher_note_save(text, date, bigint, text, text, text, text, text, text), public.teacher_note_delete(bigint),
  public.admin_teacher_decide(bigint, bigint, boolean) from public, anon;
grant execute on function public.teacher_me(), public.teacher_request(text), public.teacher_student(text),
  public.teacher_note_save(text, date, bigint, text, text, text, text, text, text), public.teacher_note_delete(bigint),
  public.admin_teacher_decide(bigint, bigint, boolean) to authenticated;

-- 학생 내 폴더 → 레슨 노트: 새 칸 (메모 빼고)
CREATE OR REPLACE FUNCTION public.member_notebook(p_id text, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  mid text;
  today date := private.now_kst()::date;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  return private.with_token(who, jsonb_build_object(
    'ok', true,
    'id', mid,
    'name', who ->> 'name',
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', n.lesson_date, 'teacher', n.teacher, 'did', n.did, 'practice', n.practice,
        'songs', n.songs, 'audition', n.audition, 'recommend', n.recommend   -- 선생님 메모(memo)는 학생에게 안 보냄
      ) order by n.lesson_date desc, n.id desc)
      from (select * from public.lesson_notes where member_id = mid
            order by lesson_date desc, id desc limit 30) n
    ), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'month', to_char(r.month, 'YYYY-MM'), 'pages', r.pages, 'song', r.song, 'teacher', r.teacher,
        'basic', r.basic, 'technique', r.technique, 'acting', r.acting, 'styling', r.styling,
        'total', r.total, 'stage', r.stage
      ) order by r.month desc)
      from (select * from public.eval_reports where member_id = mid order by month desc limit 12) r
    ), '[]'::jsonb),
    -- 내 예약: 오늘부터의 예약 + 이번 달 연습실 이용
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object('room', rm.name, 'date', b.day,
               'start', private.hhmm(b.start_min), 'end', private.hhmm(b.end_min)) order by b.day, b.start_min)
      from public.bookings b join public.rooms rm on rm.id = b.room_id
      where b.member_id = mid and b.status = '확정' and b.day >= today
    ), '[]'::jsonb),
    'month', (select jsonb_build_object('count', count(*), 'minutes', coalesce(sum(b.end_min - b.start_min), 0))
              from public.bookings b
              where b.member_id = mid and b.status = '확정' and b.day >= date_trunc('month', today)::date and b.day <= today),
    -- 공지 + 다가오는 학원 내방 오디션
    'notices', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body, 'start', n.start_date,
               'end', n.end_date, 'pinned', n.pinned, 'at', n.created_at) order by n.pinned desc, coalesce(n.start_date, n.created_at::date) desc)
      from (select * from public.notices where published and (end_date is null or end_date >= today)
            order by pinned desc, created_at desc limit 20) n
    ), '[]'::jsonb),
    'visits', coalesce((
      select jsonb_agg(jsonb_build_object('title', a.title, 'company', a.company, 'date', a.event_date, 'deadline', a.deadline)
               order by a.event_date)
      from (select * from public.audition_news where published and kind = '내방' and event_date >= today
            order by event_date limit 6) a
    ), '[]'::jsonb),
    'repertoire', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'artist', r.artist, 'purpose', r.purpose,
               'status', r.status, 'memo', r.memo,
               'minutes', (select coalesce(sum(l.minutes), 0) from public.practice_logs l where l.member_id = mid and l.song = r.title))
               order by (r.status = '준비 중') desc, r.updated_at desc)
      from public.repertoire r where r.member_id = mid
    ), '[]'::jsonb),
    'logs', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'day', l.day, 'minutes', l.minutes, 'song', l.song, 'did', l.did)
               order by l.day desc, l.id desc)
      from (select * from public.practice_logs where member_id = mid order by day desc, id desc limit 60) l
    ), '[]'::jsonb),
    -- 노래 추천 (원장님이 올린 것) + 아직 답을 못 받은 내 신청
    'recs', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'date', s.made_on, 'summary', s.summary, 'songs', s.songs, 'note', s.note)
               order by s.made_on desc, s.id desc)
      from (select * from public.song_recs where member_id = mid and published order by made_on desc, id desc limit 5) s
    ), '[]'::jsonb),
    'request', (select jsonb_build_object('at', q.created_at, 'likes', q.likes, 'goal', q.goal, 'memo', q.memo, 'files', q.files)
                from public.song_requests q where q.member_id = mid and q.status = '접수' order by q.id desc limit 1)
  ));
end $function$
;

-- ---------------------------------------------------------------- 마이그레이션 leesh_sheet_sync + leesh_sheet_sync_url (2026-10-29)
-- 구글시트 "학생관리 통합 관리자 → 수강ID 관리" → 홈페이지 수강생 (원장님 2026-10-29, A 방법 · 3시간마다 + 버튼).
-- 시트가 원본. 시트 옆에 따로 만든 Apps Script(tools/sheet_sync.gs, 시트 파일은 안 건드리고 읽기 전용 권한)가
-- 3시간마다 (바뀐 게 있을 때만) 이 함수로 보냄. 비밀 열쇠는 스크립트가 처음 한 번 스스로 등록 (채팅·저장소에 안 남음).
-- 가져오는 것: 수강ID · 학생명 · 현재 담당교사 · 휴원·종료 보관 상태 (종료보관 → 종료, 휴원보관 → 휴원, 나머지 → 재원).
-- 새 학생은 추가, 바뀐 건 고침, 시트에 없는 학생은 그대로 (지우지 않음). 카카오 연결·예약·평가 기록은 그대로.

create table if not exists private.sheet_sync (
  id            int primary key check (id = 1),
  key_hash      bytea,                  -- sha256(열쇠). 열쇠 자체는 저장 안 함
  registered_at timestamptz,
  last_at       timestamptz,
  last_result   jsonb,
  open_until    timestamptz            -- 관리자가 "시트 연결 열기"를 누르면 30분 동안만 새 열쇠 등록 가능
);
alter table private.sheet_sync add column if not exists open_until timestamptz;
insert into private.sheet_sync (id) values (1) on conflict (id) do nothing;

-- 스크립트가 처음 한 번: 열쇠 등록. 관리자가 "시트 연결 열기"를 누른 뒤 30분 안에만 됨 (모르는 사람이 먼저 등록 못 하게)
create or replace function public.sheet_register(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s private.sheet_sync;
begin
  if char_length(coalesce(p_key, '')) < 40 then return private.fail('열쇠가 너무 짧아요.'); end if;
  select * into s from private.sheet_sync where id = 1 for update;
  if s.key_hash = extensions.digest(p_key, 'sha256') then return jsonb_build_object('ok', true); end if;  -- 같은 스크립트가 다시
  if s.open_until is null or s.open_until < now() then
    return private.fail('관리자 화면 → 수강 ID → "시트 연결 열기"를 먼저 누른 뒤 30분 안에 해주세요.');
  end if;
  update private.sheet_sync set key_hash = extensions.digest(p_key, 'sha256'), registered_at = now(), open_until = null where id = 1;
  return jsonb_build_object('ok', true);
end $$;

-- 시트 명단 받기. p_rows = [{"id":"E001","name":"…","teacher":"안유정","archive":"종료보관"}, …]
create or replace function public.sheet_sync_members(p_key text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s private.sheet_sync;
  r jsonb;
  v_id text; v_name text; v_teacher text; v_status text; v_memo text;
  m public.members;
  added int := 0; changed int := 0; same int := 0; skipped int := 0;
  new_teachers text[] := '{}';
  res jsonb;
begin
  select * into s from private.sheet_sync where id = 1;
  if s.key_hash is null or s.key_hash <> extensions.digest(coalesce(p_key, ''), 'sha256') then
    return private.fail('연결 열쇠가 맞지 않아요.');
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 2000 then
    return private.fail('보낸 명단이 비어 있거나 너무 커요.');
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_id := upper(trim(coalesce(r ->> 'id', '')));
    v_name := trim(coalesce(r ->> 'name', ''));
    v_teacher := nullif(regexp_replace(trim(coalesce(r ->> 'teacher', '')), '\s+', '', 'g'), '');
    v_status := case trim(coalesce(r ->> 'archive', '')) when '종료보관' then '종료' when '휴원보관' then '휴원' else '재원' end;
    if v_id !~ '^E\d{3,}$' or v_name = '' or char_length(v_name) > 30 or char_length(coalesce(v_teacher, '')) > 20 then
      skipped := skipped + 1;
      continue;
    end if;
    select * into m from public.members where id = v_id;
    if m.id is null then
      insert into public.members (id, name, status, memo, pin_hash, must_change_pin)
      values (v_id, v_name, v_status, case when v_teacher is not null then '담당 ' || v_teacher end,
              extensions.crypt('0000', extensions.gen_salt('bf')), true);
      added := added + 1;
    else
      -- 메모의 "담당 ○○○"만 바꾸고 나머지 메모는 그대로
      v_memo := case
        when v_teacher is null then m.memo
        when coalesce(m.memo, '') ~ '담당\s*[^\s·,]+' then regexp_replace(m.memo, '담당\s*[^\s·,]+', '담당 ' || v_teacher)
        else nullif(concat_ws(' · ', nullif(m.memo, ''), '담당 ' || v_teacher), '') end;
      if m.name is distinct from v_name or m.status is distinct from v_status or m.memo is distinct from v_memo then
        update public.members set name = v_name, status = v_status, memo = v_memo where id = v_id;
        changed := changed + 1;
      else
        same := same + 1;
      end if;
    end if;
    -- 시트에 새 선생님이 생기면 선생님 목록에도 (선생님 화면 연결용)
    if v_teacher is not null and not exists (select 1 from public.teachers where name = v_teacher) then
      insert into public.teachers (name) values (v_teacher) on conflict (name) do nothing;
      new_teachers := array_append(new_teachers, v_teacher);
    end if;
  end loop;
  res := jsonb_build_object('ok', true, 'added', added, 'changed', changed, 'same', same, 'skipped', skipped,
                            'newTeachers', to_jsonb(new_teachers), 'at', now());
  update private.sheet_sync set last_at = now(), last_result = res where id = 1;
  if added > 0 then perform private.notify('📋 구글시트에서 새 수강생 ' || added || '명이 홈페이지에 들어왔어요.'); end if;
  return res;
end $$;

-- 관리자: 연결 상태 보기 / 시트 연결 열기 (예전 열쇠를 비우고 30분 동안 새 등록 받기)
create or replace function public.admin_sheet_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s private.sheet_sync;
begin
  if not public.is_admin() then return private.fail('관리자만 볼 수 있어요.'); end if;
  select * into s from private.sheet_sync where id = 1;
  return jsonb_build_object('ok', true, 'connected', s.key_hash is not null, 'registeredAt', s.registered_at, 'openUntil', s.open_until,
                            'lastAt', s.last_at, 'last', s.last_result);
end $$;
create or replace function public.admin_sheet_open() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  update private.sheet_sync set key_hash = null, registered_at = null, open_until = now() + interval '30 minutes' where id = 1;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.sheet_register(text), public.sheet_sync_members(text, jsonb),
  public.admin_sheet_status(), public.admin_sheet_open() from public;
grant execute on function public.sheet_register(text), public.sheet_sync_members(text, jsonb) to anon, authenticated;
grant execute on function public.admin_sheet_status(), public.admin_sheet_open() to authenticated;

-- 스크립트의 "지금 보내기" 주소(웹 앱)를 같이 등록 → 관리자 화면 "지금 시트에서 가져오기" 버튼이 엶
alter table private.sheet_sync add column if not exists web_url text;
drop function if exists public.sheet_register(text);
create or replace function public.sheet_register(p_key text, p_url text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s private.sheet_sync;
begin
  if char_length(coalesce(p_key, '')) < 40 then return private.fail('열쇠가 너무 짧아요.'); end if;
  if p_url is not null and p_url !~ '^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$' then return private.fail('웹 앱 주소가 이상해요.'); end if;
  select * into s from private.sheet_sync where id = 1 for update;
  if s.key_hash = extensions.digest(p_key, 'sha256') then  -- 같은 스크립트가 다시 (주소만 새로)
    update private.sheet_sync set web_url = coalesce(p_url, web_url) where id = 1;
    return jsonb_build_object('ok', true);
  end if;
  if s.open_until is null or s.open_until < now() then
    return private.fail('관리자 화면 → 수강 ID → "시트 연결 열기"를 먼저 누른 뒤 30분 안에 해주세요.');
  end if;
  update private.sheet_sync set key_hash = extensions.digest(p_key, 'sha256'), registered_at = now(), open_until = null, web_url = p_url where id = 1;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.sheet_register(text, text) from public;
grant execute on function public.sheet_register(text, text) to anon, authenticated;
create or replace function public.admin_sheet_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s private.sheet_sync;
begin
  if not public.is_admin() then return private.fail('관리자만 볼 수 있어요.'); end if;
  select * into s from private.sheet_sync where id = 1;
  return jsonb_build_object('ok', true, 'connected', s.key_hash is not null, 'registeredAt', s.registered_at, 'openUntil', s.open_until,
                            'lastAt', s.last_at, 'last', s.last_result, 'webUrl', s.web_url);
end $$;

-- ---------------------------------------------------------------- 마이그레이션 leesh_rooms_members_only (2026-10-29)
-- 연습실 빈 시간표도 수강생만 (원장님 2026-10-29 "예약실 예약화면도 회원만")
CREATE OR REPLACE FUNCTION public.rooms_day(p_date text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.settings;
  t timestamp := private.now_kst();
  today date := t::date;
  now_min int := extract(hour from t)::int * 60 + extract(minute from t)::int;
  d date;
begin
  -- 수강생 전용 (원장님 2026-10-29): 빈 시간표도 카카오로 로그인한 승인된 학생(또는 관리자)만
  if not public.is_admin() and not coalesce((private.check_ready('', '') ->> 'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'code', 'members_only', 'error', '수강생만 볼 수 있어요. 카카오로 로그인해주세요.');
  end if;
  select * into s from public.settings where id = 1;
  begin
    d := coalesce(nullif(p_date, '')::date, today);
  exception when others then
    return private.fail('날짜 형식이 올바르지 않습니다.');
  end;
  if d < today or d > today + s.max_days then
    return private.fail('예약할 수 없는 날짜입니다.');
  end if;
  return jsonb_build_object(
    'ok', true,
    'date', d,
    'now', case when d = today then now_min end,   -- lets the page grey out hours already gone
    'days', (select jsonb_agg(today + i order by i) from generate_series(0, s.max_days) i),
    'unit', s.unit_min,
    'open', private.hhmm(s.open_min),
    'close', private.hhmm(s.close_min),
    'maxHours', s.max_minutes / 60,
    'dailyMaxHours', trim_scale(s.daily_max_minutes / 60.0),
    'cancelBefore', case when s.cancel_minutes % 60 = 0 then (s.cancel_minutes / 60) || '시간' else s.cancel_minutes || '분' end,
    'rooms', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', r.name, 'type', r.kind,
        'free', coalesce((
          select jsonb_agg(private.hhmm(g) order by g)
          from generate_series(s.open_min, s.close_min - s.unit_min, s.unit_min) g
          where (d > today or g > now_min)   -- 이미 시작한 시간은 안 됨 (18:05면 19:00부터, 원장님 2026-10-28)
            and not exists (
              select 1 from public.bookings b
              where b.room_id = r.id and b.day = d and b.status = '확정'
                and b.start_min < g + s.unit_min and g < b.end_min)
        ), '[]'::jsonb)
      ) order by r.sort, r.id)
      from public.rooms r where r.active
    ), '[]'::jsonb)
  );
end $function$
;

-- ---------------------------------------------------------------- 마이그레이션 leesh_hide_student_notes (2026-10-29)
-- 학생에게 레슨 노트 숨기기 (원장님 2026-10-29). 선생님 화면·관리자는 그대로. 켜려면 update public.settings set student_notes = true;
alter table public.settings add column if not exists student_notes boolean not null default false;
CREATE OR REPLACE FUNCTION public.member_notebook(p_id text, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  mid text;
  today date := private.now_kst()::date;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  return private.with_token(who, jsonb_build_object(
    'ok', true,
    'id', mid,
    'name', who ->> 'name',
    -- 레슨 노트는 settings.student_notes가 켜져 있을 때만 학생에게 (원장님 2026-10-29: 선생님들과 얘기 끝날 때까지 숨김)
    'notes', case when not coalesce((select st.student_notes from public.settings st where st.id = 1), false) then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', n.lesson_date, 'teacher', n.teacher, 'did', n.did, 'practice', n.practice,
        'songs', n.songs, 'audition', n.audition, 'recommend', n.recommend   -- 선생님 메모(memo)는 학생에게 안 보냄
      ) order by n.lesson_date desc, n.id desc)
      from (select * from public.lesson_notes where member_id = mid
            order by lesson_date desc, id desc limit 30) n
    ), '[]'::jsonb) end,
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'month', to_char(r.month, 'YYYY-MM'), 'pages', r.pages, 'song', r.song, 'teacher', r.teacher,
        'basic', r.basic, 'technique', r.technique, 'acting', r.acting, 'styling', r.styling,
        'total', r.total, 'stage', r.stage
      ) order by r.month desc)
      from (select * from public.eval_reports where member_id = mid order by month desc limit 12) r
    ), '[]'::jsonb),
    -- 내 예약: 오늘부터의 예약 + 이번 달 연습실 이용
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object('room', rm.name, 'date', b.day,
               'start', private.hhmm(b.start_min), 'end', private.hhmm(b.end_min)) order by b.day, b.start_min)
      from public.bookings b join public.rooms rm on rm.id = b.room_id
      where b.member_id = mid and b.status = '확정' and b.day >= today
    ), '[]'::jsonb),
    'month', (select jsonb_build_object('count', count(*), 'minutes', coalesce(sum(b.end_min - b.start_min), 0))
              from public.bookings b
              where b.member_id = mid and b.status = '확정' and b.day >= date_trunc('month', today)::date and b.day <= today),
    -- 공지 + 다가오는 학원 내방 오디션
    'notices', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body, 'start', n.start_date,
               'end', n.end_date, 'pinned', n.pinned, 'at', n.created_at) order by n.pinned desc, coalesce(n.start_date, n.created_at::date) desc)
      from (select * from public.notices where published and (end_date is null or end_date >= today)
            order by pinned desc, created_at desc limit 20) n
    ), '[]'::jsonb),
    'visits', coalesce((
      select jsonb_agg(jsonb_build_object('title', a.title, 'company', a.company, 'date', a.event_date, 'deadline', a.deadline)
               order by a.event_date)
      from (select * from public.audition_news where published and kind = '내방' and event_date >= today
            order by event_date limit 6) a
    ), '[]'::jsonb),
    'repertoire', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'artist', r.artist, 'purpose', r.purpose,
               'status', r.status, 'memo', r.memo,
               'minutes', (select coalesce(sum(l.minutes), 0) from public.practice_logs l where l.member_id = mid and l.song = r.title))
               order by (r.status = '준비 중') desc, r.updated_at desc)
      from public.repertoire r where r.member_id = mid
    ), '[]'::jsonb),
    'logs', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'day', l.day, 'minutes', l.minutes, 'song', l.song, 'did', l.did)
               order by l.day desc, l.id desc)
      from (select * from public.practice_logs where member_id = mid order by day desc, id desc limit 60) l
    ), '[]'::jsonb),
    -- 노래 추천 (원장님이 올린 것) + 아직 답을 못 받은 내 신청
    'recs', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'date', s.made_on, 'summary', s.summary, 'songs', s.songs, 'note', s.note)
               order by s.made_on desc, s.id desc)
      from (select * from public.song_recs where member_id = mid and published order by made_on desc, id desc limit 5) s
    ), '[]'::jsonb),
    'request', (select jsonb_build_object('at', q.created_at, 'likes', q.likes, 'goal', q.goal, 'memo', q.memo, 'files', q.files)
                from public.song_requests q where q.member_id = mid and q.status = '접수' order by q.id desc limit 1)
  ));
end $function$
;
-- ---------------------------------------------------------------- 텔레그램 알림 (원장님 2026-10-29)
-- 새 신청(카카오 연결 요청 · 선생님 연결 요청 · 상담 · 노래 추천 · 제휴 · 내방 오디션)이 오면 원장님 텔레그램으로.
-- 원장님이 관리자 → 설정 → 텔레그램 알림에서 봇 토큰을 붙여넣고(채팅 금지), 봇에게 말을 건 뒤 "연결 확인".
-- 연습실 예약·취소 알림은 기본으로 끔 (bookings). 여러 관리자가 각자 연결할 수 있게 chat_ids 목록.
alter table private.telegram add column if not exists chat_ids text[] not null default '{}';
alter table private.telegram add column if not exists bot_name text;
alter table private.telegram add column if not exists bookings boolean not null default false;

create or replace function private.notify(msg text) returns void
language plpgsql security definer set search_path = '' as $$
declare t record; c text;
begin
  select bot_token, chat_ids, bookings into t from private.telegram where id = 1;
  if coalesce(t.bot_token, '') = '' or cardinality(t.chat_ids) = 0 then return; end if;
  if not t.bookings and (msg like '🎤 연습실%' or msg like '↩️ 연습실%') then return; end if;
  foreach c in array t.chat_ids loop
    begin
      perform net.http_post(url := 'https://api.telegram.org/bot' || t.bot_token || '/sendMessage',
        body := jsonb_build_object('chat_id', c, 'text', msg || chr(10) || chr(10) || '👉 https://leeshlesson.com/admin.html',
                                   'disable_web_page_preview', true));
    exception when others then
      null; -- 알림 실패가 신청을 막으면 안 됩니다
    end;
  end loop;
end $$;

-- 상담 알림에는 전화번호를 넣지 않음 (관리자 화면에서 보기)
do $$
declare d text := pg_get_functiondef('public.consult_create'::regproc);
begin
  if position($s$nm || ' · ' || v_phone$s$ in d) > 0 then
    execute replace(d, $s$nm || ' · ' || v_phone$s$, 'nm');
  end if;
end $$;

create or replace function public.admin_telegram_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t private.telegram;
begin
  if not public.is_admin() then return private.fail('관리자만 볼 수 있어요.'); end if;
  select * into t from private.telegram where id = 1;
  return jsonb_build_object('ok', true, 'hasBot', coalesce(t.bot_token, '') <> '', 'bot', t.bot_name,
                            'chats', cardinality(t.chat_ids), 'bookings', t.bookings);
end $$;

-- 봇 토큰 저장 (BotFather가 준 것). 텔레그램에 물어봐서 맞는 토큰인지 확인. 토큰은 다시 보여주지 않음.
create or replace function public.admin_telegram_set(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v text := trim(coalesce(p_token, '')); r record; j jsonb;
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  if v !~ '^[0-9]{5,15}:[A-Za-z0-9_-]{30,50}$' then return private.fail('토큰 모양이 달라요. BotFather가 준 "숫자:글자" 전체를 붙여넣어 주세요.'); end if;
  select status, content into r from extensions.http_get('https://api.telegram.org/bot' || v || '/getMe');
  begin j := r.content::jsonb; exception when others then j := null; end;
  if r.status <> 200 or not coalesce((j ->> 'ok')::boolean, false) then return private.fail('텔레그램이 이 토큰을 모른대요. 다시 복사해주세요.'); end if;
  update private.telegram set bot_token = v, bot_name = j -> 'result' ->> 'username', chat_ids = '{}', chat_id = null where id = 1;
  return jsonb_build_object('ok', true, 'bot', j -> 'result' ->> 'username');
end $$;

-- 봇에게 말을 건 사람(개인 채팅)을 받는 사람으로 등록하고 시험 메시지를 보냄
create or replace function public.admin_telegram_link() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t private.telegram; r record; j jsonb; found text[]; c text;
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  select * into t from private.telegram where id = 1;
  if coalesce(t.bot_token, '') = '' then return private.fail('봇 토큰을 먼저 저장해주세요.'); end if;
  select status, content into r from extensions.http_get('https://api.telegram.org/bot' || t.bot_token || '/getUpdates');
  begin j := r.content::jsonb; exception when others then j := null; end;
  if r.status <> 200 or j is null then return private.fail('텔레그램에 연결하지 못했어요. 잠시 뒤 다시 눌러주세요.'); end if;
  select coalesce(array_agg(distinct u -> 'message' -> 'chat' ->> 'id'), '{}') into found
    from jsonb_array_elements(j -> 'result') u
   where u -> 'message' -> 'chat' ->> 'type' = 'private';
  if cardinality(found) = 0 then
    return private.fail('봇에게 온 메시지가 없어요. 텔레그램에서 @' || coalesce(t.bot_name, '봇') || ' 을 찾아 "시작"을 누르거나 아무 말이나 보낸 뒤 다시 눌러주세요.');
  end if;
  update private.telegram set chat_ids = array(select distinct x from unnest(chat_ids || found) x) where id = 1
    returning chat_ids into found;
  foreach c in array found loop
    perform net.http_post(url := 'https://api.telegram.org/bot' || t.bot_token || '/sendMessage',
      body := jsonb_build_object('chat_id', c, 'text', '✅ 이송희보컬레슨 알림이 연결됐어요. 새 신청이 오면 여기로 알려드릴게요.'));
  end loop;
  return jsonb_build_object('ok', true, 'chats', cardinality(found));
end $$;

create or replace function public.admin_telegram_options(p_bookings boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  update private.telegram set bookings = coalesce(p_bookings, false) where id = 1;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_telegram_off() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  update private.telegram set bot_token = null, bot_name = null, chat_ids = '{}', chat_id = null where id = 1;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.admin_telegram_status(), public.admin_telegram_set(text), public.admin_telegram_link(),
  public.admin_telegram_options(boolean), public.admin_telegram_off() from public, anon;
grant execute on function public.admin_telegram_status(), public.admin_telegram_set(text), public.admin_telegram_link(),
  public.admin_telegram_options(boolean), public.admin_telegram_off() to authenticated;
-- 텔레그램 알림을 그룹 대화방으로도 (원장님 2026-10-29: 관리자와 같이 받는 그룹)
-- 봇을 그룹에 초대하면 그 그룹(초대 기록·그룹 안 /start)을 찾아 받는 곳으로 정함. 그룹이 있으면 그룹만 (1:1과 겹쳐 두 번 오지 않게).
-- 그룹이 슈퍼그룹으로 바뀌면 번호가 바뀌므로 migrate_to_chat_id를 따라감.
create or replace function public.admin_telegram_link() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t private.telegram; r record; j jsonb; groups text[]; people text[]; gone text[]; found text[]; c text;
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  select * into t from private.telegram where id = 1;
  if coalesce(t.bot_token, '') = '' then return private.fail('봇 토큰을 먼저 저장해주세요.'); end if;
  select status, content into r from extensions.http_get('https://api.telegram.org/bot' || t.bot_token || '/getUpdates');
  begin j := r.content::jsonb; exception when others then j := null; end;
  if r.status <> 200 or j is null then return private.fail('텔레그램에 연결하지 못했어요. 잠시 뒤 다시 눌러주세요.'); end if;

  with chats as (
    select coalesce(u -> 'message', u -> 'my_chat_member', u -> 'channel_post') as m from jsonb_array_elements(j -> 'result') u
  )
  select coalesce(array_agg(distinct m -> 'chat' ->> 'id') filter (where m -> 'chat' ->> 'type' in ('group', 'supergroup')), '{}'),
         coalesce(array_agg(distinct m -> 'chat' ->> 'id') filter (where m -> 'chat' ->> 'type' = 'private'), '{}'),
         coalesce(array_agg(distinct m -> 'chat' ->> 'id') filter (where m ? 'migrate_to_chat_id'
                    or m -> 'new_chat_member' ->> 'status' in ('left', 'kicked')), '{}')
    into groups, people, gone
    from chats where m is not null;
  -- 슈퍼그룹으로 바뀐 그룹은 새 번호로
  select coalesce(array_agg(distinct x), '{}') into groups from (
    select g as x from unnest(groups) g where g <> all (gone)
    union
    select u -> 'message' ->> 'migrate_to_chat_id' from jsonb_array_elements(j -> 'result') u where u -> 'message' ? 'migrate_to_chat_id'
  ) s;

  if cardinality(groups) > 0 then
    found := groups;
  elsif cardinality(people) > 0 then
    found := array(select distinct x from unnest(coalesce(t.chat_ids, '{}') || people) x where x not like '-%');
  else
    return private.fail('봇에게 온 메시지가 없어요. 1:1이면 @' || coalesce(t.bot_name, '봇') || ' 에서 "시작", 그룹이면 봇을 그룹에 초대한 뒤 그룹에 /start 를 보내고 다시 눌러주세요.');
  end if;
  update private.telegram set chat_ids = found where id = 1;
  foreach c in array found loop
    perform net.http_post(url := 'https://api.telegram.org/bot' || t.bot_token || '/sendMessage',
      body := jsonb_build_object('chat_id', c, 'text', '✅ 이송희보컬레슨 알림이 연결됐어요. 새 신청이 오면 여기로 알려드릴게요.'));
  end loop;
  return jsonb_build_object('ok', true, 'chats', cardinality(found), 'groups', cardinality(groups));
end $$;

create or replace function public.admin_telegram_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t private.telegram;
begin
  if not public.is_admin() then return private.fail('관리자만 볼 수 있어요.'); end if;
  select * into t from private.telegram where id = 1;
  return jsonb_build_object('ok', true, 'hasBot', coalesce(t.bot_token, '') <> '', 'bot', t.bot_name,
                            'chats', cardinality(t.chat_ids), 'bookings', t.bookings,
                            'groups', (select count(*) from unnest(t.chat_ids) x where x like '-%'));
end $$;
-- 텔레그램에 묻기: 연결이 1초를 넘으면 실패하던 것 → 기다리는 시간을 늘리고 3번까지 다시 (2026-10-29)
create or replace function private.tg_get(p_url text, out status int, out content text)
language plpgsql security definer set search_path = '' as $$
declare i int;
begin
  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT', '10');
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '20');
  for i in 1..3 loop
    begin
      select h.status, h.content into status, content from extensions.http_get(p_url) h;
      return;
    exception when others then
      status := 0; content := null;
      perform pg_sleep(1);
    end;
  end loop;
end $$;
revoke all on function private.tg_get(text) from public;

-- 그룹이 여럿이면 봇이 가장 최근에 소식을 받은 그룹 하나만 (원장님 2026-10-29: 그룹을 두 번 만들어 둘 다 잡혔음)
create or replace function public.admin_telegram_link() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t private.telegram; r record; j jsonb; latest text; people text[]; found text[]; c text;
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  select * into t from private.telegram where id = 1;
  if coalesce(t.bot_token, '') = '' then return private.fail('봇 토큰을 먼저 저장해주세요.'); end if;
  select * into r from private.tg_get('https://api.telegram.org/bot' || t.bot_token || '/getUpdates');
  begin j := r.content::jsonb; exception when others then j := null; end;
  if r.status <> 200 or j is null then return private.fail('텔레그램에 연결하지 못했어요. 잠시 뒤 다시 눌러주세요.'); end if;

  with ups as (
    select (u ->> 'update_id')::bigint as uid, coalesce(u -> 'message', u -> 'my_chat_member', u -> 'channel_post') as m
      from jsonb_array_elements(j -> 'result') u
  ), gone as (  -- 슈퍼그룹으로 바뀐 옛 그룹, 봇이 나간 그룹
    select m -> 'chat' ->> 'id' as x from ups where m ? 'migrate_to_chat_id' or m -> 'new_chat_member' ->> 'status' in ('left', 'kicked')
  ), cand as (
    select m -> 'chat' ->> 'id' as x, uid from ups where m -> 'chat' ->> 'type' in ('group', 'supergroup')
    union all
    select m ->> 'migrate_to_chat_id', uid from ups where m ? 'migrate_to_chat_id'
  )
  select x into latest from cand where x not in (select x from gone) group by x order by max(uid) desc limit 1;

  select coalesce(array_agg(distinct u -> 'message' -> 'chat' ->> 'id'), '{}') into people
    from jsonb_array_elements(j -> 'result') u where u -> 'message' -> 'chat' ->> 'type' = 'private';

  if latest is not null then
    found := array[latest];
  elsif cardinality(people) > 0 then
    found := array(select distinct x from unnest(coalesce(t.chat_ids, '{}') || people) x where x not like '-%');
  else
    return private.fail('봇에게 온 메시지가 없어요. 1:1이면 @' || coalesce(t.bot_name, '봇') || ' 에서 "시작", 그룹이면 봇을 그룹에 초대한 뒤 그룹에 /start 를 보내고 다시 눌러주세요.');
  end if;
  update private.telegram set chat_ids = found where id = 1;
  foreach c in array found loop
    perform net.http_post(url := 'https://api.telegram.org/bot' || t.bot_token || '/sendMessage', timeout_milliseconds := 15000,
      body := jsonb_build_object('chat_id', c, 'text', '✅ 이송희보컬레슨 알림이 연결됐어요. 새 신청이 오면 여기로 알려드릴게요.'));
  end loop;
  return jsonb_build_object('ok', true, 'chats', cardinality(found), 'groups', case when latest is null then 0 else 1 end);
end $$;

create or replace function public.admin_telegram_set(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v text := trim(coalesce(p_token, '')); r record; j jsonb;
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  if v !~ '^[0-9]{5,15}:[A-Za-z0-9_-]{30,50}$' then return private.fail('토큰 모양이 달라요. BotFather가 준 "숫자:글자" 전체를 붙여넣어 주세요.'); end if;
  select * into r from private.tg_get('https://api.telegram.org/bot' || v || '/getMe');
  begin j := r.content::jsonb; exception when others then j := null; end;
  if r.status <> 200 or not coalesce((j ->> 'ok')::boolean, false) then return private.fail('텔레그램이 이 토큰을 모른대요. 다시 복사해주세요.'); end if;
  update private.telegram set bot_token = v, bot_name = j -> 'result' ->> 'username', chat_ids = '{}', chat_id = null where id = 1;
  return jsonb_build_object('ok', true, 'bot', j -> 'result' ->> 'username');
end $$;

create or replace function private.notify(msg text) returns void
language plpgsql security definer set search_path = '' as $$
declare t record; c text;
begin
  select bot_token, chat_ids, bookings into t from private.telegram where id = 1;
  if coalesce(t.bot_token, '') = '' or cardinality(t.chat_ids) = 0 then return; end if;
  if not t.bookings and (msg like '🎤 연습실%' or msg like '↩️ 연습실%') then return; end if;
  foreach c in array t.chat_ids loop
    begin
      perform net.http_post(url := 'https://api.telegram.org/bot' || t.bot_token || '/sendMessage', timeout_milliseconds := 15000,
        body := jsonb_build_object('chat_id', c, 'text', msg || chr(10) || chr(10) || '👉 https://leeshlesson.com/admin.html',
                                   'disable_web_page_preview', true));
    exception when others then
      null; -- 알림 실패가 신청을 막으면 안 됩니다
    end;
  end loop;
end $$;

-- 학생 노래 추천 잠시 숨김 (원장님 2026-10-29: 선생님들과 얘기 끝날 때까지). 화면 config.js songRecs: false + 서버는 새 신청을 막음.
-- 켤 때: update public.settings set song_recs = true; (+ config.js songRecs: true)
alter table public.settings add column if not exists song_recs boolean not null default true;
update public.settings set song_recs = false where id = 1;
do $$
declare d text := pg_get_functiondef('public.member_song_request(text,text,text,text,text,jsonb)'::regprocedure);
        mark text := $s$if not (who ->> 'ok')::boolean then return who; end if;$s$;
begin
  if position('song_recs' in d) = 0 then
    if position(mark in d) = 0 then raise exception 'member_song_request: 넣을 자리를 못 찾음'; end if;
    execute overlay(d placing mark || chr(10) || $s$  if not coalesce((select song_recs from public.settings where id = 1), true) then
    return private.fail('지금은 노래 추천 신청을 잠시 쉬고 있어요. 학원에 문의해주세요.');
  end if;$s$ from position(mark in d) for length(mark));
  end if;
end $$;
-- 체험 레슨 없앰 (원장님 2026-10-29: 이제 체험 레슨 안 함). 상담 방식은 전화 · 방문만, 그 밖의 값은 전화 상담으로.
do $$
declare d text := pg_get_functiondef('public.consult_create'::regproc);
begin
  if position($s$('전화 상담', '방문 상담', '체험 레슨')$s$ in d) > 0 then
    execute replace(d, $s$('전화 상담', '방문 상담', '체험 레슨')$s$, $s$('전화 상담', '방문 상담')$s$);
  end if;
end $$;
-- 레슨 일지 꾸미기 (원장님 2026-10-29: 선생님들이 구글시트처럼 빨간 글씨·색깔·형광펜으로 강조하며 수업 중에 씀)
-- rich = true면 칸마다 꾸민 글(제한된 HTML: 굵게·색·형광펜·크게·줄바꿈만). 화면(js/richtext.js)이 보여줄 때 다시 걸러요.
alter table public.lesson_notes add column if not exists rich boolean not null default false;

-- 글자 수 제한은 꾸미기 표시를 뺀 글자로 (표시가 붙으면 길어지므로 저장 칸은 넉넉히)
alter table public.lesson_notes drop constraint if exists lesson_notes_audition_check;
alter table public.lesson_notes drop constraint if exists lesson_notes_memo_check;
alter table public.lesson_notes drop constraint if exists lesson_notes_recommend_check;
alter table public.lesson_notes drop constraint if exists lesson_notes_songs_check;

create or replace function private.rich_text(v text) returns text
language sql immutable set search_path = '' as $$
  select replace(replace(replace(replace(replace(
           regexp_replace(regexp_replace(coalesce(v, ''), '<br\s*/?>|</div>|</p>', ' ', 'gi'), '<[^>]*>', '', 'g'),
         '&nbsp;', ' '), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&amp;', '&');
$$;

-- 꾸민 글에 허용하는 것만 (선생님 화면 · 관리자 화면 둘 다 이 검사를 거침)
create or replace function private.rich_ok(v text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare tag text;
begin
  if v is null then return true; end if;
  if v ~* '(javascript|vbscript|data)\s*:|expression\s*\(|url\s*\(|@import' then return false; end if;
  for tag in select m[1] from regexp_matches(v, '<([^>]*)>', 'g') m loop
    if tag !~* '^/?(b|i|u|s|br|div|span)(\s+style="[a-z0-9 :;#(),.%-]*")?\s*/?$' then return false; end if;
  end loop;
  return true;
end $$;

create or replace function private.lesson_note_check() returns trigger
language plpgsql set search_path = '' as $$
declare
  lim int[] := array[800, 2000, 400, 800, 800, 1000];
  vals text[] := array[new.did, new.songs, new.practice, new.audition, new.recommend, new.memo];
  i int;
begin
  for i in 1..6 loop
    if vals[i] is null then continue; end if;
    if char_length(vals[i]) > 20000 then raise exception '글이 너무 길어요.'; end if;
    if new.rich then
      if not private.rich_ok(vals[i]) then raise exception '꾸민 글에 쓸 수 없는 내용이 있어요.'; end if;
      if char_length(private.rich_text(vals[i])) > lim[i] then raise exception '글이 너무 길어요.'; end if;
    elsif char_length(vals[i]) > lim[i] then
      raise exception '글이 너무 길어요.';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists lesson_notes_check on public.lesson_notes;
create trigger lesson_notes_check before insert or update on public.lesson_notes
  for each row execute function private.lesson_note_check();

-- 선생님 저장: p_rich 추가 (빈 칸 판단·글자 수는 꾸미기 표시를 뺀 글자로)
drop function if exists public.teacher_note_save(text, date, bigint, text, text, text, text, text, text);
create or replace function public.teacher_note_save(p_member text, p_date date, p_note bigint default null,
  p_did text default null, p_songs text default null, p_practice text default null, p_audition text default null,
  p_recommend text default null, p_memo text default null, p_rich boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.teachers := private.my_teacher();
  v_id bigint;
  raw text[] := array[p_did, p_songs, p_practice, p_audition, p_recommend, p_memo];
  f text[] := '{}';
  lim int[] := array[800, 2000, 400, 800, 800, 1000];
  i int; txt text;
begin
  if t.id is null then return private.fail('선생님으로 연결된 계정만 쓸 수 있어요.'); end if;
  if not private.teaches(t, p_member) then return private.fail('담당 학생만 쓸 수 있어요.'); end if;
  if p_date is null or p_date > private.now_kst()::date + 1 or p_date < private.now_kst()::date - 366 then return private.fail('수업 날짜를 확인해주세요.'); end if;
  for i in 1..6 loop
    txt := case when p_rich then private.rich_text(raw[i]) else coalesce(raw[i], '') end;
    if char_length(txt) > lim[i] then return private.fail('글이 너무 길어요.'); end if;
    f := f || case when trim(txt) = '' then null else trim(raw[i]) end;
  end loop;
  if coalesce(f[1], f[2], f[3], f[4], f[5], f[6]) is null then return private.fail('한 칸 이상 적어주세요.'); end if;
  if p_rich and not (private.rich_ok(f[1]) and private.rich_ok(f[2]) and private.rich_ok(f[3]) and private.rich_ok(f[4])
                     and private.rich_ok(f[5]) and private.rich_ok(f[6])) then
    return private.fail('꾸민 글에 쓸 수 없는 내용이 있어요. 다시 붙여넣어 주세요.');
  end if;
  if p_note is null then
    insert into public.lesson_notes (member_id, lesson_date, teacher, teacher_id, did, songs, practice, audition, recommend, memo, rich)
    values (p_member, p_date, t.name, t.id, f[1], f[2], f[3], f[4], f[5], f[6], coalesce(p_rich, false)) returning id into v_id;
  else
    update public.lesson_notes set lesson_date = p_date, did = f[1], songs = f[2], practice = f[3], audition = f[4],
      recommend = f[5], memo = f[6], rich = coalesce(p_rich, false), updated_at = now()
    where id = p_note and member_id = p_member and teacher_id = t.id returning id into v_id;
    if v_id is null then return private.fail('내가 쓴 일지만 고칠 수 있어요.'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.teacher_note_save(text, date, bigint, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.teacher_note_save(text, date, bigint, text, text, text, text, text, text, boolean) to authenticated;

-- 선생님 화면 · 학생 내 폴더에 rich 표시도 같이 보냄
do $$
declare f text; d text;
begin
  foreach f in array array['public.teacher_student(text)', 'public.member_notebook(text,text)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position($s$'rich', n.rich$s$ in d) = 0 then
      if position($s$'recommend', n.recommend$s$ in d) = 0 then raise exception '% 고칠 자리를 못 찾음', f; end if;
      execute replace(d, $s$'recommend', n.recommend$s$, $s$'recommend', n.recommend, 'rich', n.rich$s$);
    end if;
  end loop;
end $$;
-- 상담 신청 = 학원이 카톡으로 받던 양식 4가지 (원장님 2026-10-29)
--   1. 성함 · 생년월일 · 연락처   2. 상담 유형 (방문/전화)
--   3. 클래스명 / 온·오프라인 / 강사 (온라인은 거주 지역도)   4. 희망 요일과 시간대
alter table public.consults add column if not exists birth text;
alter table public.consults add column if not exists lesson_mode text;
alter table public.consults add column if not exists teacher_pref text;
alter table public.consults add column if not exists region text;
alter table public.consults add column if not exists days text;
alter table public.consults add column if not exists times text;

drop function if exists public.consult_create(text, text, text, text, text, text, text);
create or replace function public.consult_create(p_name text, p_phone text, p_track text default null, p_method text default null,
  p_wish text default null, p_message text default null, p_website text default null,
  p_birth text default null, p_mode text default null, p_teacher text default null, p_region text default null,
  p_days text default null, p_times text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  nm text := left(trim(coalesce(p_name, '')), 30);
  digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_phone text;
  v_method text := case when p_method in ('전화 상담', '방문 상담') then p_method else '전화 상담' end;
  v_birth text := left(trim(coalesce(p_birth, '')), 20);
  v_mode text := case when p_mode in ('오프라인', '온라인') then p_mode else '오프라인' end;
  v_region text := nullif(left(trim(coalesce(p_region, '')), 50), '');
  v_days text;
  v_times text := nullif(left(trim(coalesce(p_times, '')), 60), '');
  v_track text := nullif(left(coalesce(p_track, ''), 30), '');
  v_teacher text := nullif(left(trim(coalesce(p_teacher, '')), 30), '');
  recent int;
begin
  if coalesce(p_website, '') <> '' then return jsonb_build_object('ok', true); end if; -- 자동 입력 프로그램
  if nm = '' then return private.fail('성함을 입력해주세요.'); end if;
  if v_birth !~ '\d{2}' then return private.fail('생년월일을 입력해주세요. 예) 2008.03.15'); end if;
  if length(digits) < 9 or length(digits) > 11 then return private.fail('연락처를 정확히 입력해주세요.'); end if;
  if v_mode = '온라인' and v_region is null then return private.fail('온라인 레슨은 거주 지역도 적어주세요.'); end if;
  select string_agg(d, ',' order by array_position(array['월','화','수','목','금','토','일'], d)) into v_days
    from (select distinct trim(x) d from unnest(string_to_array(coalesce(p_days, ''), ',')) x) s
   where d in ('월','화','수','목','금','토','일');
  if v_days is null then return private.fail('희망하는 상담 요일을 골라주세요.'); end if;
  if v_times is null then return private.fail('희망하는 시간대를 적어주세요. 예) 2시~10시 사이'); end if;
  v_phone := case length(digits)
    when 11 then substr(digits, 1, 3) || '-' || substr(digits, 4, 4) || '-' || substr(digits, 8)
    when 10 then substr(digits, 1, 3) || '-' || substr(digits, 4, 3) || '-' || substr(digits, 7)
    else digits end;
  perform pg_advisory_xact_lock(hashtext('consult:' || v_phone));
  select count(*) into recent from public.consults c where c.phone = v_phone and c.created_at > now() - interval '1 hour';
  if recent >= 3 then return private.fail('이미 여러 번 접수되었습니다. 곧 연락드릴게요.'); end if;

  insert into public.consults (method, wish, name, phone, track, message, birth, lesson_mode, teacher_pref, region, days, times)
  values (v_method, v_days || ' · ' || v_times, nm, v_phone, v_track, nullif(left(trim(coalesce(p_message, '')), 1000), ''),
          v_birth, v_mode, v_teacher, case when v_mode = '온라인' then v_region end, v_days, v_times);

  perform private.notify('📩 새 상담 신청 · ' || v_method || chr(10) || nm
    || chr(10) || coalesce(v_track, '반 미정') || ' / ' || v_mode || coalesce(' / ' || v_teacher, '')
    || chr(10) || '희망: ' || v_days || ' · ' || v_times);
  return jsonb_build_object('ok', true, 'method', v_method);
end $$;
revoke all on function public.consult_create(text, text, text, text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.consult_create(text, text, text, text, text, text, text, text, text, text, text, text, text) to anon, authenticated;
-- 익명 건의함 (원장님 2026-10-29): 학생 내 폴더 → 건의함. 이름 없이, 내용은 암호화해서 저장. 지금은 관리자만 읽음.
--  · 누가 썼는지 저장하지 않음 (member_id 칸 없음). 보낸 때도 날짜만 (시각으로 추측 못 하게).
--  · 내용은 pgcrypto로 암호화(열쇠는 private.suggest_key, 화면·API로 안 나감) → 관리자 함수만 풀어서 보여줌.
--  · 장난 방지: 로그인한 수강생만, 하루 5번. 횟수는 "수강 ID + 날짜 + 비밀 소금"의 해시로만 세서 글과 이어지지 않음.
create table if not exists private.suggest_key (
  id int primary key default 1 check (id = 1),
  k text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  salt text not null default encode(extensions.gen_random_bytes(32), 'hex')
);
insert into private.suggest_key (id) values (1) on conflict do nothing;

create table if not exists private.suggestions (
  id bigint generated always as identity primary key,
  day date not null,
  topic text not null,
  body bytea not null,
  is_read boolean not null default false
);
create table if not exists private.suggest_counts (
  h bytea not null,
  day date not null,
  n int not null default 0,
  primary key (h, day)
);

create or replace function public.member_suggest(p_id text, p_pin text, p_topic text, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  k private.suggest_key;
  today date := private.now_kst()::date;
  v_topic text := case when p_topic in ('수업', '선생님', '연습실', '시설', '홈페이지', '기타') then p_topic else '기타' end;
  v_body text := trim(coalesce(p_body, ''));
  hh bytea; cnt int;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  if char_length(v_body) < 2 then return private.fail('하고 싶은 말을 적어주세요.'); end if;
  if char_length(v_body) > 1000 then return private.fail('1000자까지 쓸 수 있어요.'); end if;
  select * into k from private.suggest_key where id = 1;
  hh := extensions.digest((who ->> 'id') || '|' || today::text || '|' || k.salt, 'sha256');
  insert into private.suggest_counts (h, day, n) values (hh, today, 1)
    on conflict (h, day) do update set n = private.suggest_counts.n + 1 returning n into cnt;
  if cnt > 5 then return private.fail('하루에 5번까지 보낼 수 있어요. 내일 다시 보내주세요.'); end if;
  delete from private.suggest_counts where day < today - 1;  -- 지난 횟수는 바로 지움
  insert into private.suggestions (day, topic, body) values (today, v_topic, extensions.pgp_sym_encrypt(v_body, k.k));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_suggestions() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare k private.suggest_key;
begin
  if not public.is_admin() then return private.fail('관리자만 볼 수 있어요.'); end if;
  select * into k from private.suggest_key where id = 1;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'day', s.day, 'topic', s.topic, 'read', s.is_read,
             'body', extensions.pgp_sym_decrypt(s.body, k.k)) order by s.id desc)
      from (select * from private.suggestions order by id desc limit 300) s), '[]'::jsonb));
end $$;

create or replace function public.admin_suggest_count() returns int
language sql stable security definer set search_path = '' as $$
  select case when public.is_admin() then (select count(*)::int from private.suggestions where not is_read) else 0 end;
$$;

create or replace function public.admin_suggest_mark(p_id bigint, p_read boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  update private.suggestions set is_read = coalesce(p_read, true) where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_suggest_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  delete from private.suggestions where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.member_suggest(text, text, text, text), public.admin_suggestions(), public.admin_suggest_count(),
  public.admin_suggest_mark(bigint, boolean), public.admin_suggest_delete(bigint) from public, anon;
grant execute on function public.member_suggest(text, text, text, text) to anon, authenticated;
grant execute on function public.admin_suggestions(), public.admin_suggest_count(), public.admin_suggest_mark(bigint, boolean),
  public.admin_suggest_delete(bigint) to authenticated;

-- ============ leesh_grid_notes (2026-10-30) ============
-- 레슨 일지를 진짜 스프레드시트처럼 (원장님 2026-10-30 "ABCDEFG 열, 1234 좁은 줄"): 일지 한 장 = 표 한 장 (lesson_notes.sheet)
--   {"v":1, "n":행 수, "w":{"열":너비px}, "h":{"행":높이px}, "c":{"행,열":{"t":"꾸민 글", "s":{"b":1,"i":1,"u":1,"x":1,"z":글씨px,"f":"글자색","g":"채우기색"}}}}
--   행·열은 0부터 (열 0~25 = A~Z, 행 0~999). 칸 글은 예전 꾸민 글과 같은 규칙(private.rich_ok), 칸마다 5000자, 전체 400KB.
--   예전 일지(칸 5개)는 그대로 두고, 화면이 표 모양으로 바꿔 보여줌.
alter table public.lesson_notes add column if not exists sheet jsonb;

create or replace function private.sheet_ok(s jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; sk text; sv jsonb;
begin
  if s is null then return true; end if;
  if jsonb_typeof(s) <> 'object' or octet_length(s::text) > 400000 then return false; end if;
  for k in select jsonb_object_keys(s) loop
    if k not in ('v', 'n', 'w', 'h', 'c') then return false; end if;
  end loop;
  if s ? 'v' and jsonb_typeof(s -> 'v') <> 'number' then return false; end if;
  if s ? 'n' and (jsonb_typeof(s -> 'n') <> 'number' or (s ->> 'n')::numeric > 1000 or (s ->> 'n')::numeric < 1) then return false; end if;
  if jsonb_typeof(coalesce(s -> 'w', '{}')) <> 'object' or jsonb_typeof(coalesce(s -> 'h', '{}')) <> 'object'
     or jsonb_typeof(coalesce(s -> 'c', '{}')) <> 'object' then return false; end if;
  for k, v in select key, value from jsonb_each(coalesce(s -> 'w', '{}')) loop
    if k !~ '^\d{1,2}$' or k::int > 25 or jsonb_typeof(v) <> 'number' or v::numeric < 20 or v::numeric > 1500 then return false; end if;
  end loop;
  for k, v in select key, value from jsonb_each(coalesce(s -> 'h', '{}')) loop
    if k !~ '^\d{1,3}$' or jsonb_typeof(v) <> 'number' or v::numeric < 12 or v::numeric > 1500 then return false; end if;
  end loop;
  for k, v in select key, value from jsonb_each(coalesce(s -> 'c', '{}')) loop
    if k !~ '^\d{1,3},\d{1,2}$' or split_part(k, ',', 2)::int > 25 or jsonb_typeof(v) <> 'object' then return false; end if;
    for sk in select jsonb_object_keys(v) loop
      if sk not in ('t', 's') then return false; end if;
    end loop;
    if v ? 't' and (jsonb_typeof(v -> 't') <> 'string' or char_length(v ->> 't') > 40000 or not private.rich_ok(v ->> 't')
                    or char_length(private.rich_text(v ->> 't')) > 5000) then return false; end if;
    if jsonb_typeof(coalesce(v -> 's', '{}')) <> 'object' then return false; end if;
    for sk, sv in select key, value from jsonb_each(coalesce(v -> 's', '{}')) loop
      if sk in ('b', 'i', 'u', 'x') then
        if jsonb_typeof(sv) not in ('number', 'boolean') then return false; end if;
      elsif sk = 'z' then
        if jsonb_typeof(sv) <> 'number' or sv::numeric < 8 or sv::numeric > 48 then return false; end if;
      elsif sk in ('f', 'g') then
        if jsonb_typeof(sv) <> 'string' or (sv #>> '{}') !~* '^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[0-9.]+\s*)?\))$' then return false; end if;
      else
        return false;
      end if;
    end loop;
  end loop;
  return true;
end $$;

-- 표에 적힌 글 (빈 표인지 볼 때)
create or replace function private.sheet_text(s jsonb) returns text
language sql immutable set search_path = '' as $$
  select coalesce(string_agg(private.rich_text(e.value ->> 't'), ' '), '')
  from jsonb_each(case when jsonb_typeof(s -> 'c') = 'object' then s -> 'c' else '{}'::jsonb end) e;
$$;
revoke all on function private.sheet_ok(jsonb), private.sheet_text(jsonb) from public, anon, authenticated;

create or replace function private.lesson_note_check() returns trigger
language plpgsql set search_path = '' as $$
declare
  lim int[] := array[800, 2000, 400, 800, 800, 1000];
  vals text[] := array[new.did, new.songs, new.practice, new.audition, new.recommend, new.memo];
  i int;
begin
  if new.sheet is not null and not private.sheet_ok(new.sheet) then raise exception '표에 쓸 수 없는 내용이 있어요.'; end if;
  for i in 1..6 loop
    if vals[i] is null then continue; end if;
    if char_length(vals[i]) > 20000 then raise exception '글이 너무 길어요.'; end if;
    if new.rich then
      if not private.rich_ok(vals[i]) then raise exception '꾸민 글에 쓸 수 없는 내용이 있어요.'; end if;
      if char_length(private.rich_text(vals[i])) > lim[i] then raise exception '글이 너무 길어요.'; end if;
    elsif char_length(vals[i]) > lim[i] then
      raise exception '글이 너무 길어요.';
    end if;
  end loop;
  return new;
end $$;

-- 선생님 저장: p_sheet (표)가 오면 표로 저장하고 예전 칸 5개는 비움
drop function if exists public.teacher_note_save(text, date, bigint, text, text, text, text, text, text, boolean);
create or replace function public.teacher_note_save(p_member text, p_date date, p_note bigint default null,
  p_did text default null, p_songs text default null, p_practice text default null, p_audition text default null,
  p_recommend text default null, p_memo text default null, p_rich boolean default false, p_sheet jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.teachers := private.my_teacher();
  v_id bigint;
  raw text[] := array[p_did, p_songs, p_practice, p_audition, p_recommend, p_memo];
  f text[] := '{}';
  lim int[] := array[800, 2000, 400, 800, 800, 1000];
  i int; txt text;
begin
  if t.id is null then return private.fail('선생님으로 연결된 계정만 쓸 수 있어요.'); end if;
  if not private.teaches(t, p_member) then return private.fail('담당 학생만 쓸 수 있어요.'); end if;
  if p_date is null or p_date > private.now_kst()::date + 1 or p_date < private.now_kst()::date - 366 then return private.fail('수업 날짜를 확인해주세요.'); end if;
  if p_sheet is not null then
    if not private.sheet_ok(p_sheet) then return private.fail('표에 쓸 수 없는 내용이 있거나 너무 길어요 (한 칸에 5000자까지).'); end if;
    if trim(private.sheet_text(p_sheet)) = '' then return private.fail('한 칸 이상 적어주세요.'); end if;
    f := array[null, null, null, null, null, null]::text[];
  else
    for i in 1..6 loop
      txt := case when p_rich then private.rich_text(raw[i]) else coalesce(raw[i], '') end;
      if char_length(txt) > lim[i] then return private.fail('글이 너무 길어요.'); end if;
      f := f || case when trim(txt) = '' then null else trim(raw[i]) end;
    end loop;
    if coalesce(f[1], f[2], f[3], f[4], f[5], f[6]) is null then return private.fail('한 칸 이상 적어주세요.'); end if;
    if p_rich and not (private.rich_ok(f[1]) and private.rich_ok(f[2]) and private.rich_ok(f[3]) and private.rich_ok(f[4])
                       and private.rich_ok(f[5]) and private.rich_ok(f[6])) then
      return private.fail('꾸민 글에 쓸 수 없는 내용이 있어요. 다시 붙여넣어 주세요.');
    end if;
  end if;
  if p_note is null then
    insert into public.lesson_notes (member_id, lesson_date, teacher, teacher_id, did, songs, practice, audition, recommend, memo, rich, sheet)
    values (p_member, p_date, t.name, t.id, f[1], f[2], f[3], f[4], f[5], f[6], coalesce(p_rich, false) or p_sheet is not null, p_sheet)
    returning id into v_id;
  else
    update public.lesson_notes set lesson_date = p_date, did = f[1], songs = f[2], practice = f[3], audition = f[4],
      recommend = f[5], memo = f[6], rich = coalesce(p_rich, false) or p_sheet is not null, sheet = p_sheet, updated_at = now()
    where id = p_note and member_id = p_member and teacher_id = t.id returning id into v_id;
    if v_id is null then return private.fail('내가 쓴 일지만 고칠 수 있어요.'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.teacher_note_save(text, date, bigint, text, text, text, text, text, text, boolean, jsonb) from public, anon;
grant execute on function public.teacher_note_save(text, date, bigint, text, text, text, text, text, text, boolean, jsonb) to authenticated;

-- 선생님 화면 · 학생 내 폴더에 표도 같이 보냄
do $$
declare f text; d text;
begin
  foreach f in array array['public.teacher_student(text)', 'public.member_notebook(text,text)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position($s$'sheet', n.sheet$s$ in d) = 0 then
      if (length(d) - length(replace(d, $s$'rich', n.rich$s$, ''))) / length($s$'rich', n.rich$s$) <> 1 then raise exception '% 고칠 자리를 못 찾음', f; end if;
      execute replace(d, $s$'rich', n.rich$s$, $s$'rich', n.rich, 'sheet', n.sheet$s$);
    end if;
  end loop;
end $$;

-- ============ leesh_grid_notes_content (2026-10-30) ============
-- 표로 쓴 일지도 "내용이 있는 일지"로 (칸 5개가 비어 있어도 됨)
alter table public.lesson_notes drop constraint if exists lesson_notes_has_content;
alter table public.lesson_notes add constraint lesson_notes_has_content check (
  coalesce(nullif(trim(did), ''), nullif(trim(songs), ''), nullif(trim(practice), ''), nullif(trim(audition), ''),
           nullif(trim(recommend), ''), nullif(trim(memo), '')) is not null
  or (sheet is not null and jsonb_typeof(sheet -> 'c') = 'object' and sheet -> 'c' <> '{}'::jsonb));
-- ---------------------------------------------------------------- 마이그레이션 leesh_lesson_import (2026-11-03)
-- 선생님 구글시트(학생 한 명 = 파일 하나) → 홈페이지 레슨 노트 (원장님 2026-11-03).
--   날짜 탭(2026년부터) = 레슨 노트 한 장 (lesson_notes.sheet, 칸 · 색 · 굵게 그대로)
--   다른 탭(곡 가사 · 곡별 피드백 · OT · 발성 · 알림장) = "곡·자료" 시트 (public.lesson_sheets)
--   당분간 계속 맞추기: 원장님 구글 계정의 Apps Script(tools/lesson_sync.gs, 읽기 전용)가 1시간마다 바뀐 파일만 보냄.
--   홈페이지에서 고친 일지는 그 뒤로 시트가 덮지 않음(site_edited), 홈페이지에서 지운 일지는 다시 안 들어옴(lesson_skip).
--   시트에서 탭을 지워도 홈페이지 것은 지우지 않음 (자동 삭제 안 함).
-- 학생 맞추기: 파일 이름 앞 이름(글자까지 똑같이) + 폴더 선생님("이수빈 레슨시트", "유정T 레슨시트")이 명단 "담당 ○○○"와 같을 때만.
--   하나라도 다르면 '확인 필요'로 두고 관리자(또는 Claude)가 정함 (원장님 2026-10-31 "이름·선생님 명확히").

create table if not exists private.lesson_sync (
  id            int primary key check (id = 1),
  key_hash      bytea,
  registered_at timestamptz,
  open_until    timestamptz,
  last_at       timestamptz,
  last_result   jsonb
);
insert into private.lesson_sync (id) values (1) on conflict (id) do nothing;

create table if not exists public.lesson_sources (
  file_id         text primary key check (file_id ~ '^[A-Za-z0-9_-]{20,100}$'),
  title           text not null,
  folder          text,
  member_id       text references public.members (id) on update cascade on delete set null,
  teacher_id      bigint references public.teachers (id) on delete set null,
  status          text not null default 'pending' check (status in ('ok', 'pending', 'ignore')),
  why             text,
  set_by          text not null default 'auto' check (set_by in ('auto', 'admin')),
  modified        timestamptz,          -- 구글 드라이브의 마지막 수정 시각
  synced_modified timestamptz,          -- 마지막으로 다 가져온 때의 수정 시각 (같으면 다시 안 가져옴)
  synced_ver      int,
  synced_at       timestamptz,
  notes           int not null default 0,
  sheets          int not null default 0,
  kept            int not null default 0,   -- 홈페이지에서 고쳐서 시트로 안 덮은 일지
  gone            int not null default 0,   -- 시트에서 없어졌지만 홈페이지엔 남겨둔 것
  seen_at         timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
alter table public.lesson_sources enable row level security;
drop policy if exists lesson_sources_admin on public.lesson_sources;
create policy lesson_sources_admin on public.lesson_sources for select to authenticated using (public.is_admin());

alter table public.lesson_notes add column if not exists src_file text;
alter table public.lesson_notes add column if not exists src_tab bigint;
alter table public.lesson_notes add column if not exists src_title text;
alter table public.lesson_notes add column if not exists synced_at timestamptz;
alter table public.lesson_notes add column if not exists site_edited boolean not null default false;
create unique index if not exists lesson_notes_src_idx on public.lesson_notes (src_file, src_tab) where src_file is not null;

create table if not exists public.lesson_sheets (
  id         bigint generated always as identity primary key,
  member_id  text not null references public.members (id) on update cascade on delete cascade,
  teacher_id bigint references public.teachers (id) on delete set null,
  src_file   text not null,
  src_tab    bigint not null,
  title      text not null check (char_length(title) between 1 and 120),
  pos        int not null default 0,
  sheet      jsonb not null check (private.sheet_ok(sheet)),
  synced_at  timestamptz not null default now(),
  unique (src_file, src_tab)
);
create index if not exists lesson_sheets_member_idx on public.lesson_sheets (member_id, src_file, pos);
alter table public.lesson_sheets enable row level security;
drop policy if exists lesson_sheets_admin on public.lesson_sheets;
create policy lesson_sheets_admin on public.lesson_sheets for select to authenticated using (public.is_admin());

create table if not exists private.lesson_skip (
  src_file text not null,
  src_tab  bigint not null,
  at       timestamptz not null default now(),
  primary key (src_file, src_tab)
);

-- 폴더 이름 → 선생님 ("이수빈 레슨시트" · "유정T 레슨시트" · "이윤지T 학생 레슨 시트지"). 딱 한 명일 때만
create or replace function private.folder_teacher(p_folder text) returns bigint
language sql stable security definer set search_path = '' as $$
  select case when count(*) = 1 then min(t.id) end
  from public.teachers t
  where t.active and t.name <> '원장님' and coalesce(p_folder, '') <> ''
    and (position(t.name in replace(p_folder, ' ', '')) > 0
         or (char_length(t.name) = 3 and position(substr(t.name, 2) || 'T' in replace(p_folder, ' ', '')) > 0));
$$;

-- 파일 하나의 학생 맞추기 (set_by = 'admin'이면 그대로)
create or replace function private.lesson_match(p_file text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.lesson_sources;
  v_name text; v_tid bigint; v_tname text; n int; v_mid text; other text;
begin
  select * into s from public.lesson_sources where file_id = p_file for update;
  if s.file_id is null or s.set_by = 'admin' then return; end if;
  v_name := substring(s.title from '^\s*([가-힣]{2,4})');
  v_tid := private.folder_teacher(s.folder);
  select name into v_tname from public.teachers where id = v_tid;
  if v_name is null then
    update public.lesson_sources set status = 'pending', member_id = null, teacher_id = v_tid, why = '파일 이름에서 학생 이름을 못 찾았어요' where file_id = p_file;
    return;
  end if;
  if v_tid is null then
    select string_agg(m.id || ' ' || coalesce(substring(m.memo from '담당\s*([^\s·,]+)'), '담당 없음'), ', ') into other
    from public.members m where m.name = v_name and m.status in ('재원', '휴원');
    update public.lesson_sources set status = 'pending', member_id = null, teacher_id = null,
      why = '선생님 폴더 밖에 있어서 담당 선생님을 확인 못 했어요' || coalesce(' (명단: ' || other || ')', '') where file_id = p_file;
    return;
  end if;
  select count(*), min(m.id) into n, v_mid from public.members m
  where m.name = v_name and m.status in ('재원', '휴원') and substring(m.memo from '담당\s*([^\s·,]+)') = v_tname;
  if n = 1 then
    update public.lesson_sources set status = 'ok', member_id = v_mid, teacher_id = v_tid, why = null where file_id = p_file;
    return;
  end if;
  select string_agg(m.id || ' ' || m.status || ' ' || coalesce(substring(m.memo from '담당\s*([^\s·,]+)'), '담당 없음'), ', ') into other
  from public.members m where m.name = v_name;
  update public.lesson_sources set status = 'pending', member_id = null, teacher_id = v_tid,
    why = case when n > 1 then '이름·담당이 같은 학생이 ' || n || '명이에요'
               when other is null then '명단에 "' || v_name || '" 학생이 없어요'
               else '담당 선생님이 달라요 (폴더: ' || v_tname || ' / 명단: ' || other || ')' end
  where file_id = p_file;
end $$;

-- 스크립트: 열쇠 등록 (관리자 → 선생님 → "레슨 시트 연결 열기" 뒤 30분 안에만)
create or replace function public.lesson_register(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s private.lesson_sync;
begin
  if char_length(coalesce(p_key, '')) < 40 then return private.fail('열쇠가 너무 짧아요.'); end if;
  select * into s from private.lesson_sync where id = 1 for update;
  if s.key_hash = extensions.digest(p_key, 'sha256') then return jsonb_build_object('ok', true); end if;
  if s.open_until is null or s.open_until < now() then
    return private.fail('관리자 화면 → 선생님 → "레슨 시트 연결 열기"를 먼저 누른 뒤 30분 안에 해주세요.');
  end if;
  update private.lesson_sync set key_hash = extensions.digest(p_key, 'sha256'), registered_at = now(), open_until = null where id = 1;
  return jsonb_build_object('ok', true);
end $$;

create or replace function private.lesson_key_ok(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select key_hash = extensions.digest(coalesce(p_key, ''), 'sha256') from private.lesson_sync where id = 1), false);
$$;

-- 스크립트: 찾은 파일 목록 → 가져올 파일. p_files = [{"id","title","folder","modified"}]
create or replace function public.lesson_sync_plan(p_key text, p_files jsonb, p_ver int default 1) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_id text; v_fetch text[] := '{}'; s public.lesson_sources;
begin
  if not private.lesson_key_ok(p_key) then return private.fail('연결 열쇠가 맞지 않아요.'); end if;
  if jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) > 3000 then return private.fail('파일 목록이 이상해요.'); end if;
  for r in select * from jsonb_array_elements(p_files) loop
    v_id := r ->> 'id';
    if v_id is null or v_id !~ '^[A-Za-z0-9_-]{20,100}$' then continue; end if;
    insert into public.lesson_sources (file_id, title, folder, modified, seen_at)
    values (v_id, left(coalesce(r ->> 'title', ''), 200), left(r ->> 'folder', 200), (r ->> 'modified')::timestamptz, now())
    on conflict (file_id) do update set title = excluded.title, folder = excluded.folder, modified = excluded.modified, seen_at = now();
    perform private.lesson_match(v_id);
    select * into s from public.lesson_sources where file_id = v_id;
    if s.status = 'ok' and (s.synced_modified is null or s.synced_modified < s.modified or s.synced_ver is distinct from p_ver) then
      v_fetch := v_fetch || v_id;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'fetch', to_jsonb(v_fetch),
    'pending', (select count(*) from public.lesson_sources where status = 'pending'));
end $$;

-- 스크립트: 파일 하나의 탭들 보내기 (여러 번 나눠 보내고 마지막에 p_done = true)
--   p_notes  = [{"tab":gid,"title":"2026-10-27(1회차)","date":"2026-10-27","sheet":{…}}]
--   p_sheets = [{"tab":gid,"title":"Curtain call","pos":3,"sheet":{…}}]
--   p_tabs   = 이번에 시트에 있던 탭 번호 전부 (p_done 때만, 없어진 탭 세기용)
create or replace function public.lesson_sync_push(p_key text, p_file text, p_notes jsonb default '[]', p_sheets jsonb default '[]',
  p_done boolean default false, p_modified timestamptz default null, p_ver int default 1, p_tabs jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.lesson_sources; t public.teachers; r jsonb; v_date date; v_tab bigint; v_sheet jsonb; ex public.lesson_notes;
  added int := 0; updated int := 0; kept int := 0; skipped int := 0; sh int := 0; bad int := 0;
begin
  if not private.lesson_key_ok(p_key) then return private.fail('연결 열쇠가 맞지 않아요.'); end if;
  select * into s from public.lesson_sources where file_id = p_file;
  if s.file_id is null or s.status <> 'ok' or s.member_id is null then return private.fail('확인된 학생 파일이 아니에요.'); end if;
  select * into t from public.teachers where id = s.teacher_id;
  if jsonb_typeof(coalesce(p_notes, '[]')) <> 'array' or jsonb_typeof(coalesce(p_sheets, '[]')) <> 'array' then return private.fail('보낸 내용이 이상해요.'); end if;

  for r in select * from jsonb_array_elements(coalesce(p_notes, '[]')) loop
    begin
      v_tab := (r ->> 'tab')::bigint; v_date := (r ->> 'date')::date; v_sheet := r -> 'sheet';
    exception when others then bad := bad + 1; continue; end;
    if v_tab is null or v_date is null or v_date < date '2026-01-01' or v_date > private.now_kst()::date + 400 then skipped := skipped + 1; continue; end if;
    if exists (select 1 from private.lesson_skip k where k.src_file = p_file and k.src_tab = v_tab) then skipped := skipped + 1; continue; end if;
    if not private.sheet_ok(v_sheet) or trim(private.sheet_text(v_sheet)) = '' then bad := bad + 1; continue; end if;
    select * into ex from public.lesson_notes where src_file = p_file and src_tab = v_tab;
    if ex.id is null then
      insert into public.lesson_notes (member_id, lesson_date, teacher, teacher_id, rich, sheet, src_file, src_tab, src_title, synced_at)
      values (s.member_id, v_date, t.name, s.teacher_id, true, v_sheet, p_file, v_tab, left(r ->> 'title', 120), now());
      added := added + 1;
    elsif ex.site_edited then
      kept := kept + 1;
    else
      if ex.sheet is distinct from v_sheet or ex.lesson_date <> v_date or ex.member_id <> s.member_id then
        update public.lesson_notes set member_id = s.member_id, lesson_date = v_date, sheet = v_sheet, rich = true,
          teacher = coalesce(t.name, teacher), teacher_id = coalesce(s.teacher_id, teacher_id),
          src_title = left(r ->> 'title', 120), synced_at = now(), updated_at = now()
        where id = ex.id;
        updated := updated + 1;
      end if;
    end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_sheets, '[]')) loop
    begin
      v_tab := (r ->> 'tab')::bigint; v_sheet := r -> 'sheet';
    exception when others then bad := bad + 1; continue; end;
    if v_tab is null or coalesce(trim(r ->> 'title'), '') = '' or not private.sheet_ok(v_sheet) or trim(private.sheet_text(v_sheet)) = '' then
      bad := bad + 1; continue;
    end if;
    insert into public.lesson_sheets (member_id, teacher_id, src_file, src_tab, title, pos, sheet, synced_at)
    values (s.member_id, s.teacher_id, p_file, v_tab, left(trim(r ->> 'title'), 120), coalesce((r ->> 'pos')::int, 0), v_sheet, now())
    on conflict (src_file, src_tab) do update set member_id = excluded.member_id, teacher_id = excluded.teacher_id, title = excluded.title,
      pos = excluded.pos, sheet = excluded.sheet, synced_at = now()
    where public.lesson_sheets.sheet is distinct from excluded.sheet or public.lesson_sheets.title is distinct from excluded.title
       or public.lesson_sheets.pos is distinct from excluded.pos or public.lesson_sheets.member_id is distinct from excluded.member_id;
    sh := sh + 1;
  end loop;

  if p_done then
    update public.lesson_sources set synced_modified = coalesce(p_modified, modified), synced_ver = p_ver, synced_at = now(),
      notes = (select count(*) from public.lesson_notes where src_file = p_file),
      sheets = (select count(*) from public.lesson_sheets where src_file = p_file),
      kept = (select count(*) from public.lesson_notes where src_file = p_file and site_edited),
      gone = case when jsonb_typeof(p_tabs) = 'array' then
        (select count(*) from public.lesson_notes n where n.src_file = p_file and not (p_tabs @> to_jsonb(n.src_tab)))
        + (select count(*) from public.lesson_sheets x where x.src_file = p_file and not (p_tabs @> to_jsonb(x.src_tab)))
        else gone end
    where file_id = p_file;
  end if;
  return jsonb_build_object('ok', true, 'added', added, 'updated', updated, 'kept', kept, 'skipped', skipped, 'sheets', sh, 'bad', bad);
end $$;

-- 스크립트: 한 번 돌고 나서 결과 남기기
create or replace function public.lesson_sync_done(p_key text, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.lesson_key_ok(p_key) then return private.fail('연결 열쇠가 맞지 않아요.'); end if;
  update private.lesson_sync set last_at = now(), last_result = case when jsonb_typeof(p_result) = 'object' and octet_length(p_result::text) < 20000 then p_result end where id = 1;
  return jsonb_build_object('ok', true);
end $$;

-- 관리자: 상태 · 연결 열기 · 학생 직접 정하기
create or replace function public.admin_lesson_sync_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s private.lesson_sync;
begin
  if not public.is_admin() then return private.fail('관리자만 볼 수 있어요.'); end if;
  select * into s from private.lesson_sync where id = 1;
  return jsonb_build_object('ok', true, 'connected', s.key_hash is not null, 'registeredAt', s.registered_at, 'openUntil', s.open_until,
    'lastAt', s.last_at, 'last', s.last_result,
    'sources', coalesce((select jsonb_agg(jsonb_build_object('file', x.file_id, 'title', x.title, 'folder', x.folder, 'member', x.member_id,
        'name', m.name, 'teacher', tt.name, 'status', x.status, 'why', x.why, 'by', x.set_by, 'notes', x.notes, 'sheets', x.sheets,
        'kept', x.kept, 'gone', x.gone, 'syncedAt', x.synced_at, 'modified', x.modified)
        order by x.status = 'ok', x.folder nulls first, x.title)
      from public.lesson_sources x left join public.members m on m.id = x.member_id left join public.teachers tt on tt.id = x.teacher_id), '[]'::jsonb));
end $$;

create or replace function public.admin_lesson_sync_open() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  update private.lesson_sync set key_hash = null, registered_at = null, open_until = now() + interval '30 minutes' where id = 1;
  return jsonb_build_object('ok', true);
end $$;

-- p_member = 수강 ID → 그 학생으로 확정 · null + p_ignore → 가져오지 않기 · null → 다시 자동으로
create or replace function public.admin_lesson_source_set(p_file text, p_member text default null, p_ignore boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.members; v_tid bigint;
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  if not exists (select 1 from public.lesson_sources where file_id = p_file) then return private.fail('그 파일을 못 찾았어요.'); end if;
  if p_member is not null then
    select * into m from public.members where id = upper(trim(p_member));
    if m.id is null then return private.fail('그 수강 ID가 없어요.'); end if;
    select coalesce((select teacher_id from public.lesson_sources where file_id = p_file),
                    (select id from public.teachers where name = substring(m.memo from '담당\s*([^\s·,]+)'))) into v_tid;
    update public.lesson_sources set status = 'ok', member_id = m.id, teacher_id = v_tid, set_by = 'admin', why = null, synced_modified = null
    where file_id = p_file;
    update public.lesson_notes set member_id = m.id where src_file = p_file and member_id <> m.id;
    update public.lesson_sheets set member_id = m.id where src_file = p_file and member_id <> m.id;
  elsif p_ignore then
    update public.lesson_sources set status = 'ignore', member_id = null, set_by = 'admin', why = '가져오지 않기로 함' where file_id = p_file;
  else
    update public.lesson_sources set set_by = 'auto', synced_modified = null where file_id = p_file;
    perform private.lesson_match(p_file);
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.lesson_register(text), public.lesson_sync_plan(text, jsonb, int),
  public.lesson_sync_push(text, text, jsonb, jsonb, boolean, timestamptz, int, jsonb), public.lesson_sync_done(text, jsonb),
  public.admin_lesson_sync_status(), public.admin_lesson_sync_open(), public.admin_lesson_source_set(text, text, boolean),
  private.folder_teacher(text), private.lesson_match(text), private.lesson_key_ok(text) from public;
grant execute on function public.lesson_register(text), public.lesson_sync_plan(text, jsonb, int),
  public.lesson_sync_push(text, text, jsonb, jsonb, boolean, timestamptz, int, jsonb), public.lesson_sync_done(text, jsonb) to anon, authenticated;
grant execute on function public.admin_lesson_sync_status(), public.admin_lesson_sync_open(), public.admin_lesson_source_set(text, text, boolean) to authenticated;

-- 선생님 화면: 가져온 일지를 홈페이지에서 고치면 그 뒤로 시트가 안 덮음 / 지우면 다시 안 들어옴
CREATE OR REPLACE FUNCTION public.teacher_note_save(p_member text, p_date date, p_note bigint DEFAULT NULL::bigint, p_did text DEFAULT NULL::text, p_songs text DEFAULT NULL::text, p_practice text DEFAULT NULL::text, p_audition text DEFAULT NULL::text, p_recommend text DEFAULT NULL::text, p_memo text DEFAULT NULL::text, p_rich boolean DEFAULT false, p_sheet jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  t public.teachers := private.my_teacher();
  v_id bigint;
  raw text[] := array[p_did, p_songs, p_practice, p_audition, p_recommend, p_memo];
  f text[] := '{}';
  lim int[] := array[800, 2000, 400, 800, 800, 1000];
  i int; txt text;
begin
  if t.id is null then return private.fail('선생님으로 연결된 계정만 쓸 수 있어요.'); end if;
  if not private.teaches(t, p_member) then return private.fail('담당 학생만 쓸 수 있어요.'); end if;
  if p_date is null or p_date > private.now_kst()::date + 1 or p_date < private.now_kst()::date - 366 then return private.fail('수업 날짜를 확인해주세요.'); end if;
  if p_sheet is not null then
    if not private.sheet_ok(p_sheet) then return private.fail('표에 쓸 수 없는 내용이 있거나 너무 길어요 (한 칸에 5000자까지).'); end if;
    if trim(private.sheet_text(p_sheet)) = '' then return private.fail('한 칸 이상 적어주세요.'); end if;
    f := array[null, null, null, null, null, null]::text[];
  else
    for i in 1..6 loop
      txt := case when p_rich then private.rich_text(raw[i]) else coalesce(raw[i], '') end;
      if char_length(txt) > lim[i] then return private.fail('글이 너무 길어요.'); end if;
      f := f || case when trim(txt) = '' then null else trim(raw[i]) end;
    end loop;
    if coalesce(f[1], f[2], f[3], f[4], f[5], f[6]) is null then return private.fail('한 칸 이상 적어주세요.'); end if;
    if p_rich and not (private.rich_ok(f[1]) and private.rich_ok(f[2]) and private.rich_ok(f[3]) and private.rich_ok(f[4])
                       and private.rich_ok(f[5]) and private.rich_ok(f[6])) then
      return private.fail('꾸민 글에 쓸 수 없는 내용이 있어요. 다시 붙여넣어 주세요.');
    end if;
  end if;
  if p_note is null then
    insert into public.lesson_notes (member_id, lesson_date, teacher, teacher_id, did, songs, practice, audition, recommend, memo, rich, sheet)
    values (p_member, p_date, t.name, t.id, f[1], f[2], f[3], f[4], f[5], f[6], coalesce(p_rich, false) or p_sheet is not null, p_sheet)
    returning id into v_id;
  else
    update public.lesson_notes set
      site_edited = site_edited or (src_file is not null and (sheet is distinct from p_sheet or lesson_date <> p_date)),
      lesson_date = p_date, did = f[1], songs = f[2], practice = f[3], audition = f[4],
      recommend = f[5], memo = f[6], rich = coalesce(p_rich, false) or p_sheet is not null, sheet = p_sheet, updated_at = now()
    where id = p_note and member_id = p_member and teacher_id = t.id returning id into v_id;
    if v_id is null then return private.fail('내가 쓴 일지만 고칠 수 있어요.'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $function$;

CREATE OR REPLACE FUNCTION public.teacher_note_delete(p_note bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t public.teachers := private.my_teacher(); n public.lesson_notes;
begin
  if t.id is null then return private.fail('선생님으로 연결된 계정만 할 수 있어요.'); end if;
  select * into n from public.lesson_notes where id = p_note and teacher_id = t.id;
  if n.id is null then return private.fail('내가 쓴 일지만 지울 수 있어요.'); end if;
  if n.src_file is not null then
    insert into private.lesson_skip (src_file, src_tab) values (n.src_file, n.src_tab) on conflict do nothing;
  end if;
  delete from public.lesson_notes where id = n.id;
  return jsonb_build_object('ok', true);
end $function$;

CREATE OR REPLACE FUNCTION public.teacher_student(p_member text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  t public.teachers := private.my_teacher();
  m public.members;
begin
  if t.id is null then return private.fail('선생님으로 연결된 계정만 볼 수 있어요.'); end if;
  if not private.teaches(t, p_member) then return private.fail('담당 학생만 볼 수 있어요.'); end if;
  select * into m from public.members where id = p_member;
  return jsonb_build_object('ok', true, 'student', jsonb_build_object('id', m.id, 'name', m.name, 'status', m.status),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'date', n.lesson_date, 'teacher', n.teacher, 'did', n.did, 'songs', n.songs,
               'practice', n.practice, 'audition', n.audition, 'recommend', n.recommend, 'rich', n.rich, 'sheet', n.sheet, 'memo', n.memo,
               'mine', n.teacher_id = t.id, 'src', n.src_file is not null, 'srcTitle', n.src_title, 'siteEdited', n.site_edited)
             order by n.lesson_date desc, n.id desc)
      from (select * from public.lesson_notes where member_id = m.id order by lesson_date desc, id desc limit 60) n
    ), '[]'::jsonb),
    'sheets', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'teacher', tt.name) order by x.src_file, x.pos, x.id)
      from public.lesson_sheets x left join public.teachers tt on tt.id = x.teacher_id where x.member_id = m.id
    ), '[]'::jsonb),
    'logs', coalesce((
      select jsonb_agg(jsonb_build_object('day', l.day, 'minutes', l.minutes, 'song', l.song, 'did', l.did) order by l.day desc, l.id desc)
      from (select * from public.practice_logs where member_id = m.id order by day desc, id desc limit 20) l
    ), '[]'::jsonb),
    'repertoire', coalesce((
      select jsonb_agg(jsonb_build_object('title', r.title, 'artist', r.artist, 'status', r.status, 'purpose', r.purpose) order by r.updated_at desc)
      from public.repertoire r where r.member_id = m.id
    ), '[]'::jsonb));
end $function$;

-- 선생님 화면: 곡·자료 시트 하나 열기 (담당 학생 것만)
create or replace function public.teacher_lesson_sheet(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.teachers := private.my_teacher(); x public.lesson_sheets;
begin
  if t.id is null then return private.fail('선생님으로 연결된 계정만 볼 수 있어요.'); end if;
  select * into x from public.lesson_sheets where id = p_id;
  if x.id is null or not private.teaches(t, x.member_id) then return private.fail('담당 학생 것만 볼 수 있어요.'); end if;
  return jsonb_build_object('ok', true, 'id', x.id, 'title', x.title, 'sheet', x.sheet, 'syncedAt', x.synced_at);
end $$;
revoke all on function public.teacher_lesson_sheet(bigint) from public;
grant execute on function public.teacher_lesson_sheet(bigint) to authenticated;
-- ---------------------------------------------------------------- 마이그레이션 leesh_lesson_import_skip (2026-11-03)
-- 가져온 일지를 누가 지우든(선생님 화면 · 관리자 수업 기록) 다시 안 들어오게
create or replace function private.lesson_notes_gone() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.src_file is not null then
    insert into private.lesson_skip (src_file, src_tab) values (old.src_file, old.src_tab) on conflict do nothing;
  end if;
  return old;
end $$;
drop trigger if exists lesson_notes_gone on public.lesson_notes;
create trigger lesson_notes_gone after delete on public.lesson_notes for each row execute function private.lesson_notes_gone();
-- ---------------------------------------------------------------- 마이그레이션 leesh_grid_wrap (2026-11-03)
-- 표 칸 서식에 wr(칸 안 줄바꿈) 더하기. 나머지는 구글시트처럼 오른쪽 빈 칸으로 넘쳐 보임 (js/grid.js)
CREATE OR REPLACE FUNCTION private.sheet_ok(s jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare k text; v jsonb; sk text; sv jsonb;
begin
  if s is null then return true; end if;
  if jsonb_typeof(s) <> 'object' or octet_length(s::text) > 400000 then return false; end if;
  for k in select jsonb_object_keys(s) loop
    if k not in ('v', 'n', 'w', 'h', 'c') then return false; end if;
  end loop;
  if s ? 'v' and jsonb_typeof(s -> 'v') <> 'number' then return false; end if;
  if s ? 'n' and (jsonb_typeof(s -> 'n') <> 'number' or (s ->> 'n')::numeric > 1000 or (s ->> 'n')::numeric < 1) then return false; end if;
  if jsonb_typeof(coalesce(s -> 'w', '{}')) <> 'object' or jsonb_typeof(coalesce(s -> 'h', '{}')) <> 'object'
     or jsonb_typeof(coalesce(s -> 'c', '{}')) <> 'object' then return false; end if;
  for k, v in select key, value from jsonb_each(coalesce(s -> 'w', '{}')) loop
    if k !~ '^\d{1,2}$' or k::int > 25 or jsonb_typeof(v) <> 'number' or v::numeric < 20 or v::numeric > 1500 then return false; end if;
  end loop;
  for k, v in select key, value from jsonb_each(coalesce(s -> 'h', '{}')) loop
    if k !~ '^\d{1,3}$' or jsonb_typeof(v) <> 'number' or v::numeric < 12 or v::numeric > 1500 then return false; end if;
  end loop;
  for k, v in select key, value from jsonb_each(coalesce(s -> 'c', '{}')) loop
    if k !~ '^\d{1,3},\d{1,2}$' or split_part(k, ',', 2)::int > 25 or jsonb_typeof(v) <> 'object' then return false; end if;
    for sk in select jsonb_object_keys(v) loop
      if sk not in ('t', 's') then return false; end if;
    end loop;
    if v ? 't' and (jsonb_typeof(v -> 't') <> 'string' or char_length(v ->> 't') > 40000 or not private.rich_ok(v ->> 't')
                    or char_length(private.rich_text(v ->> 't')) > 5000) then return false; end if;
    if jsonb_typeof(coalesce(v -> 's', '{}')) <> 'object' then return false; end if;
    for sk, sv in select key, value from jsonb_each(coalesce(v -> 's', '{}')) loop
      if sk in ('b', 'i', 'u', 'x', 'wr') then
        if jsonb_typeof(sv) not in ('number', 'boolean') then return false; end if;
      elsif sk = 'z' then
        if jsonb_typeof(sv) <> 'number' or sv::numeric < 8 or sv::numeric > 48 then return false; end if;
      elsif sk in ('f', 'g') then
        if jsonb_typeof(sv) <> 'string' or (sv #>> '{}') !~* '^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[0-9.]+\s*)?\))$' then return false; end if;
      else
        return false;
      end if;
    end loop;
  end loop;
  return true;
end $function$;

-- ===== leesh_interviews (2026-11-04) =====
-- 합격자 인터뷰 (원장님 2026-11-04): 대형 · 유명 기획사 합격생의 선곡 · 꿀팁 · 스타일링. interview.html이 보여주고,
-- 첫 화면 팝업 "합격자 인터뷰 보러가기"는 올라간 인터뷰가 있을 때만 뜸. 쓰기는 원장님(관리자)만, 학생 이름은 이니셜.
create table if not exists public.interviews (
  id         bigint generated always as identity primary key,
  company    text not null check (char_length(company) between 1 and 40),
  stage      text check (char_length(stage) <= 30),
  initials   text check (char_length(initials) <= 20),
  title      text not null check (char_length(title) between 1 and 80),
  songs      text check (char_length(songs) <= 2000),
  tips       text check (char_length(tips) <= 3000),
  styling    text check (char_length(styling) <= 2000),
  body       text check (char_length(body) <= 3000),
  video      text check (video is null or video ~ '^https://'),
  image      text check (char_length(image) <= 300),
  posted_on  date not null default (now() at time zone 'Asia/Seoul')::date,
  published  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint interviews_initials_not_name check (initials is null or initials !~ '^[가-힣]{2,4}$')
);
alter table public.interviews enable row level security;
drop policy if exists admin_all on public.interviews;
create policy admin_all on public.interviews for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists public_read on public.interviews;
create policy public_read on public.interviews for select to anon, authenticated using (published);
revoke all on public.interviews from anon;
grant select on public.interviews to anon;
grant select, insert, update, delete on public.interviews to authenticated;
revoke truncate, references, trigger on public.interviews from authenticated, anon;
-- ---------------------------------------------------------------- 마이그레이션 leesh_lesson_private (2026-11-04)
-- 원장님 2026-11-04 "상담, 등록일지 내용의 개인신상정보는 갖고오지마":
--   생년월일 + (사는 곳 · 주소 · 학교)가 같이 적힌 탭(상담/등록 일지 · OT)은 통째로 안 가져옴 (이미 있던 것도 지움),
--   제목이 상담 · 등록 일지 · 신상 · 개인정보인 탭도. 일지 속 휴대폰 번호는 "(전화번호 뺌)"으로 바꿔서 넣음.
--   원장님 레슨 노트(폴더 '원장님 레슨 노트', 스크립트가 탭마다 보냄)는 담당 = 원장님으로 맞춤.
create or replace function private.lesson_private(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select t ~ '생년월일' and t ~ '사는 ?곳|주소|거주|학교' from (select private.sheet_text(p) t) x;
$$;
create or replace function private.mask_phone(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p -> 'c') = 'object' then jsonb_set(p, '{c}', coalesce((
    select jsonb_object_agg(e.key, case when e.value ? 't' then jsonb_set(e.value, '{t}',
      to_jsonb(regexp_replace(e.value ->> 't', '01[016789][-. ]?[0-9]{3,4}[-. ]?[0-9]{4}', '(전화번호 뺌)', 'g'))) else e.value end)
    from jsonb_each(p -> 'c') e), '{}'::jsonb)) else p end;
$$;
revoke all on function private.lesson_private(jsonb), private.mask_phone(jsonb) from public, anon, authenticated;
create or replace function private.lesson_match(p_file text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.lesson_sources;
  v_name text; v_tid bigint; v_tname text; n int; v_mid text; other text;
begin
  select * into s from public.lesson_sources where file_id = p_file for update;
  if s.file_id is null or s.set_by = 'admin' then return; end if;
  v_name := substring(s.title from '^\s*([가-힣]{2,4})');
  -- 원장님 레슨 노트 (시트 하나에 학생마다 탭 하나, 2026-11-04): 담당 = 원장님
  v_tid := case when s.folder = '원장님 레슨 노트' then (select min(id) from public.teachers where name = '원장님' and active)
               else private.folder_teacher(s.folder) end;
  select name into v_tname from public.teachers where id = v_tid;
  if v_name is null then
    update public.lesson_sources set status = 'pending', member_id = null, teacher_id = v_tid, why = '파일 이름에서 학생 이름을 못 찾았어요' where file_id = p_file;
    return;
  end if;
  if v_tid is null then
    select string_agg(m.id || ' ' || coalesce(substring(m.memo from '담당\s*([^\s·,]+)'), '담당 없음'), ', ') into other
    from public.members m where m.name = v_name and m.status in ('재원', '휴원');
    update public.lesson_sources set status = 'pending', member_id = null, teacher_id = null,
      why = '선생님 폴더 밖에 있어서 담당 선생님을 확인 못 했어요' || coalesce(' (명단: ' || other || ')', '') where file_id = p_file;
    return;
  end if;
  select count(*), min(m.id) into n, v_mid from public.members m
  where m.name = v_name and m.status in ('재원', '휴원') and substring(m.memo from '담당\s*([^\s·,]+)') = v_tname;
  if n = 1 then
    update public.lesson_sources set status = 'ok', member_id = v_mid, teacher_id = v_tid, why = null where file_id = p_file;
    return;
  end if;
  select string_agg(m.id || ' ' || m.status || ' ' || coalesce(substring(m.memo from '담당\s*([^\s·,]+)'), '담당 없음'), ', ') into other
  from public.members m where m.name = v_name;
  update public.lesson_sources set status = 'pending', member_id = null, teacher_id = v_tid,
    why = case when n > 1 then '이름·담당이 같은 학생이 ' || n || '명이에요'
               when other is null then '명단에 "' || v_name || '" 학생이 없어요'
               else '담당 선생님이 달라요 (폴더: ' || v_tname || ' / 명단: ' || other || ')' end
  where file_id = p_file;
end $$;
create or replace function public.lesson_sync_push(p_key text, p_file text, p_notes jsonb default '[]', p_sheets jsonb default '[]',
  p_done boolean default false, p_modified timestamptz default null, p_ver int default 1, p_tabs jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.lesson_sources; t public.teachers; r jsonb; v_date date; v_tab bigint; v_sheet jsonb; ex public.lesson_notes;
  added int := 0; updated int := 0; kept int := 0; skipped int := 0; sh int := 0; bad int := 0; blocked int := 0;
begin
  if not private.lesson_key_ok(p_key) then return private.fail('연결 열쇠가 맞지 않아요.'); end if;
  select * into s from public.lesson_sources where file_id = p_file;
  if s.file_id is null or s.status <> 'ok' or s.member_id is null then return private.fail('확인된 학생 파일이 아니에요.'); end if;
  select * into t from public.teachers where id = s.teacher_id;
  if jsonb_typeof(coalesce(p_notes, '[]')) <> 'array' or jsonb_typeof(coalesce(p_sheets, '[]')) <> 'array' then return private.fail('보낸 내용이 이상해요.'); end if;

  for r in select * from jsonb_array_elements(coalesce(p_notes, '[]')) loop
    begin
      v_tab := (r ->> 'tab')::bigint; v_date := (r ->> 'date')::date; v_sheet := r -> 'sheet';
    exception when others then bad := bad + 1; continue; end;
    if v_tab is null or v_date is null or v_date < date '2026-01-01' or v_date > private.now_kst()::date + 400 then skipped := skipped + 1; continue; end if;
    if exists (select 1 from private.lesson_skip k where k.src_file = p_file and k.src_tab = v_tab) then skipped := skipped + 1; continue; end if;
    if private.lesson_private(v_sheet) then blocked := blocked + 1; continue; end if;
    v_sheet := private.mask_phone(v_sheet);
    if not private.sheet_ok(v_sheet) or trim(private.sheet_text(v_sheet)) = '' then bad := bad + 1; continue; end if;
    select * into ex from public.lesson_notes where src_file = p_file and src_tab = v_tab;
    if ex.id is null then
      insert into public.lesson_notes (member_id, lesson_date, teacher, teacher_id, rich, sheet, src_file, src_tab, src_title, synced_at)
      values (s.member_id, v_date, t.name, s.teacher_id, true, v_sheet, p_file, v_tab, left(r ->> 'title', 120), now());
      added := added + 1;
    elsif ex.site_edited then
      kept := kept + 1;
    else
      if ex.sheet is distinct from v_sheet or ex.lesson_date <> v_date or ex.member_id <> s.member_id then
        update public.lesson_notes set member_id = s.member_id, lesson_date = v_date, sheet = v_sheet, rich = true,
          teacher = coalesce(t.name, teacher), teacher_id = coalesce(s.teacher_id, teacher_id),
          src_title = left(r ->> 'title', 120), synced_at = now(), updated_at = now()
        where id = ex.id;
        updated := updated + 1;
      end if;
    end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_sheets, '[]')) loop
    begin
      v_tab := (r ->> 'tab')::bigint; v_sheet := r -> 'sheet';
    exception when others then bad := bad + 1; continue; end;
    if v_tab is null or coalesce(trim(r ->> 'title'), '') = '' or not private.sheet_ok(v_sheet) or trim(private.sheet_text(v_sheet)) = '' then
      bad := bad + 1; continue;
    end if;
    if private.lesson_private(v_sheet) or trim(r ->> 'title') ~ '상담|등록 ?일지|신상|개인 ?정보' then
      delete from public.lesson_sheets where src_file = p_file and src_tab = v_tab;
      blocked := blocked + 1; continue;
    end if;
    insert into public.lesson_sheets (member_id, teacher_id, src_file, src_tab, title, pos, sheet, synced_at)
    values (s.member_id, s.teacher_id, p_file, v_tab, left(trim(r ->> 'title'), 120), coalesce((r ->> 'pos')::int, 0), v_sheet, now())
    on conflict (src_file, src_tab) do update set member_id = excluded.member_id, teacher_id = excluded.teacher_id, title = excluded.title,
      pos = excluded.pos, sheet = excluded.sheet, synced_at = now()
    where public.lesson_sheets.sheet is distinct from excluded.sheet or public.lesson_sheets.title is distinct from excluded.title
       or public.lesson_sheets.pos is distinct from excluded.pos or public.lesson_sheets.member_id is distinct from excluded.member_id;
    sh := sh + 1;
  end loop;

  if p_done then
    update public.lesson_sources set synced_modified = coalesce(p_modified, modified), synced_ver = p_ver, synced_at = now(),
      notes = (select count(*) from public.lesson_notes where src_file = p_file),
      sheets = (select count(*) from public.lesson_sheets where src_file = p_file),
      kept = (select count(*) from public.lesson_notes where src_file = p_file and site_edited),
      gone = case when jsonb_typeof(p_tabs) = 'array' then
        (select count(*) from public.lesson_notes n where n.src_file = p_file and not (p_tabs @> to_jsonb(n.src_tab)))
        + (select count(*) from public.lesson_sheets x where x.src_file = p_file and not (p_tabs @> to_jsonb(x.src_tab)))
        else gone end
    where file_id = p_file;
  end if;
  return jsonb_build_object('ok', true, 'added', added, 'updated', updated, 'kept', kept, 'skipped', skipped, 'sheets', sh, 'bad', bad, 'blocked', blocked);
end $$;
-- ---------------------------------------------------------------- 마이그레이션 leesh_backup (2026-11-04)
-- 홈페이지 데이터 백업 (원장님 2026-11-04 "데이터가 날아갈 위험", 1번 = 무료 · 원장님 구글 드라이브):
--   원장님 구글 계정의 Apps Script(tools/backup.gs)가 하루 한 번 표마다 나눠 받아서 드라이브 "홈페이지백업파일" 폴더에 zip으로 저장.
--   열쇠는 관리자 → 설정 → "백업 연결 열기" 뒤 30분 안에 스크립트가 스스로 등록 (채팅·저장소에 안 남음).
--   받는 것 = public 표 전부 + 건의함(암호화된 그대로) + 지운 일지 목록. 토큰 · 열쇠 · 비밀번호 해시는 안 보냄.
create table if not exists private.backup_sync (
  id            int primary key check (id = 1),
  key_hash      bytea,
  registered_at timestamptz,
  open_until    timestamptz,
  last_at       timestamptz,
  last_result   jsonb
);
insert into private.backup_sync (id) values (1) on conflict (id) do nothing;

create or replace function private.backup_list() returns text[]
language sql stable security definer set search_path = '' as $$
  select array_agg(t order by t) from (
    select 'public.' || c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    union all select 'private.suggestions' union all select 'private.lesson_skip'
  ) x;
$$;

create or replace function private.backup_key_ok(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select key_hash = extensions.digest(coalesce(p_key, ''), 'sha256') from private.backup_sync where id = 1), false);
$$;

create or replace function public.backup_register(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s private.backup_sync;
begin
  if char_length(coalesce(p_key, '')) < 40 then return private.fail('열쇠가 너무 짧아요.'); end if;
  select * into s from private.backup_sync where id = 1 for update;
  if s.key_hash = extensions.digest(p_key, 'sha256') then return jsonb_build_object('ok', true); end if;
  if s.open_until is null or s.open_until < now() then
    return private.fail('관리자 화면 → 설정 → "백업 연결 열기"를 먼저 누른 뒤 30분 안에 해주세요.');
  end if;
  update private.backup_sync set key_hash = extensions.digest(p_key, 'sha256'), registered_at = now(), open_until = null where id = 1;
  return jsonb_build_object('ok', true);
end $$;

-- 표 목록과 줄 수
create or replace function public.backup_tables(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t text; n bigint; out jsonb := '[]';
begin
  if not private.backup_key_ok(p_key) then return private.fail('연결 열쇠가 맞지 않아요.'); end if;
  foreach t in array private.backup_list() loop
    execute format('select count(*) from %s', (select format('%I.%I', split_part(t, '.', 1), split_part(t, '.', 2)))) into n;
    out := out || jsonb_build_object('table', t, 'rows', n);
  end loop;
  return jsonb_build_object('ok', true, 'at', now(), 'tables', out);
end $$;

-- 표 하나의 줄들 (기본 키 순서로 p_offset부터 p_limit줄). 비밀번호 해시 칸은 뺌
create or replace function public.backup_rows(p_key text, p_table text, p_offset int default 0, p_limit int default 200) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare sch text; tbl text; ord text; rows jsonb;
begin
  if not private.backup_key_ok(p_key) then return private.fail('연결 열쇠가 맞지 않아요.'); end if;
  if not (p_table = any (private.backup_list())) then return private.fail('백업하는 표가 아니에요.'); end if;
  sch := split_part(p_table, '.', 1); tbl := split_part(p_table, '.', 2);
  select string_agg(format('%I', a.attname), ', ' order by k.ord) into ord
  from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
  cross join lateral unnest(i.indkey) with ordinality k(attnum, ord)
  join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
  where i.indisprimary and n.nspname = sch and c.relname = tbl;
  execute format('select coalesce(jsonb_agg(to_jsonb(x) - ''pin_hash''), ''[]''::jsonb) from (select * from %I.%I order by %s limit %s offset %s) x',
    sch, tbl, coalesce(ord, 'ctid'), greatest(1, least(coalesce(p_limit, 200), 1000)), greatest(0, coalesce(p_offset, 0))) into rows;
  return jsonb_build_object('ok', true, 'rows', rows);
end $$;

create or replace function public.backup_done(p_key text, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.backup_key_ok(p_key) then return private.fail('연결 열쇠가 맞지 않아요.'); end if;
  update private.backup_sync set last_at = now(),
    last_result = case when jsonb_typeof(p_result) = 'object' and octet_length(p_result::text) < 20000 then p_result end where id = 1;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_backup_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s private.backup_sync;
begin
  if not public.is_admin() then return private.fail('관리자만 볼 수 있어요.'); end if;
  select * into s from private.backup_sync where id = 1;
  return jsonb_build_object('ok', true, 'connected', s.key_hash is not null, 'registeredAt', s.registered_at,
    'openUntil', s.open_until, 'lastAt', s.last_at, 'last', s.last_result);
end $$;

create or replace function public.admin_backup_open() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  update private.backup_sync set key_hash = null, registered_at = null, open_until = now() + interval '30 minutes' where id = 1;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function private.backup_list(), private.backup_key_ok(text) from public, anon, authenticated;
revoke all on function public.backup_register(text), public.backup_tables(text), public.backup_rows(text, text, int, int),
  public.backup_done(text, jsonb), public.admin_backup_status(), public.admin_backup_open() from public;
grant execute on function public.backup_register(text), public.backup_tables(text), public.backup_rows(text, text, int, int),
  public.backup_done(text, jsonb) to anon, authenticated;
grant execute on function public.admin_backup_status(), public.admin_backup_open() to authenticated;
-- ---------------------------------------------------------------- 마이그레이션 leesh_backup_files (2026-11-04)
-- 파일 백업 (원장님 2026-11-04 "하는 김에 다", 1번 = 백업 전용 계정): 원장님이 대시보드에서 만든 백업용 계정(이메일 로그인) 하나만
-- 비공개 보관함(평가지 사진 · 노래 녹음 · 댄스 음원) 파일을 **읽기만** 할 수 있음. 그 계정이 누구인지는 백업 스크립트가
-- 열쇠(backup_sync.key_hash)를 가지고 처음 부를 때 정해짐. 관리자 → 설정 → "다시 연결하기"를 누르면 같이 풀림.
alter table private.backup_sync add column if not exists file_uid uuid;

create or replace function public.backup_file_reader() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and auth.uid() = (select file_uid from private.backup_sync where id = 1);
$$;
revoke all on function public.backup_file_reader() from public, anon;
grant execute on function public.backup_file_reader() to authenticated;

drop policy if exists backup_file_read on storage.objects;
create policy backup_file_read on storage.objects for select to authenticated
  using (bucket_id in ('eval-reports', 'song-recordings', 'visit-music') and public.backup_file_reader());

-- 백업 스크립트(백업용 계정으로 로그인 + 열쇠): 보관함의 파일 목록. 처음 부른 계정이 백업용 계정으로 정해짐
create or replace function public.backup_files(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s private.backup_sync;
begin
  if not private.backup_key_ok(p_key) then return private.fail('연결 열쇠가 맞지 않아요.'); end if;
  if auth.uid() is null then return private.fail('백업용 계정으로 로그인해서 불러야 해요.'); end if;
  select * into s from private.backup_sync where id = 1 for update;
  if s.file_uid is null then
    if public.is_admin() or exists (select 1 from public.members m where m.kakao_user = auth.uid()) then
      return private.fail('관리자 · 학생 계정은 백업용으로 쓸 수 없어요. 백업용 계정을 따로 만들어주세요.');
    end if;
    update private.backup_sync set file_uid = auth.uid() where id = 1;
  elsif s.file_uid <> auth.uid() then
    return private.fail('이미 다른 백업용 계정이 연결돼 있어요. 관리자 → 설정 → "다시 연결하기" 뒤에 해주세요.');
  end if;
  return jsonb_build_object('ok', true, 'files', coalesce((
    select jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'name', o.name, 'size', (o.metadata ->> 'size')::bigint,
      'updated', coalesce(o.updated_at, o.created_at), 'public', b.public,
      'who', (select m.id || ' ' || m.name from public.members m where m.id = split_part(o.name, '/', 1)))
      order by o.bucket_id, o.name)
    from storage.objects o join storage.buckets b on b.id = o.bucket_id
    where o.bucket_id in ('eval-reports', 'song-recordings', 'visit-music', 'audition-news')), '[]'::jsonb));
end $$;
revoke all on function public.backup_files(text) from public, anon;
grant execute on function public.backup_files(text) to authenticated;

-- 다시 연결하기 = 열쇠와 백업용 계정 연결을 같이 풂
create or replace function public.admin_backup_open() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  update private.backup_sync set key_hash = null, registered_at = null, file_uid = null, open_until = now() + interval '30 minutes' where id = 1;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_backup_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s private.backup_sync;
begin
  if not public.is_admin() then return private.fail('관리자만 볼 수 있어요.'); end if;
  select * into s from private.backup_sync where id = 1;
  return jsonb_build_object('ok', true, 'connected', s.key_hash is not null, 'registeredAt', s.registered_at,
    'openUntil', s.open_until, 'lastAt', s.last_at, 'last', s.last_result, 'files', s.file_uid is not null);
end $$;
-- ---------------------------------------------------------------- 마이그레이션 leesh_sheet_tabs (2026-11-04)
-- 선생님 화면 아래쪽 시트 탭을 구글시트처럼 (선생님들 의견 2026-11-04):
--   1) 탭 이름 바꾸기 (lesson_notes.title, 가져온 일지는 구글 탭 이름 src_title이 기본)
--   2) 탭 순서 옮기기 (tab_pos, 일지 · 곡·자료 같이)
--   3) 신입생 첫 수업에 OT · 양식 탭 저절로 (teacher_starter)
--   5) 저장이 끊겨도 두 번 들어가지 않게 (client_key) + 미리 만들어 둔 앞날짜 일지도 저장 (오늘 + 120일까지)
--   6) 곡·자료(노래 가사 등) 탭도 아래 탭에 같이, 선생님이 고칠 수 있게 (teacher_sheet_save, 고치면 site_edited → 구글시트가 덮지 않음)
alter table public.lesson_notes add column if not exists title text;
alter table public.lesson_notes add column if not exists tab_pos int;
alter table public.lesson_notes add column if not exists client_key text;
alter table public.lesson_notes drop constraint if exists lesson_notes_title_len;
alter table public.lesson_notes add constraint lesson_notes_title_len check (title is null or char_length(title) between 1 and 60);
create unique index if not exists lesson_notes_client_key on public.lesson_notes (teacher_id, client_key) where client_key is not null;

alter table public.lesson_sheets alter column src_file drop not null;
alter table public.lesson_sheets alter column src_tab drop not null;
alter table public.lesson_sheets add column if not exists site_edited boolean not null default false;
alter table public.lesson_sheets add column if not exists tab_pos int;
alter table public.lesson_sheets add column if not exists created_by bigint references public.teachers(id) on delete set null;
alter table public.lesson_sheets add column if not exists client_key text;
alter table public.lesson_sheets add column if not exists updated_at timestamptz;
create unique index if not exists lesson_sheets_client_key on public.lesson_sheets (member_id, client_key) where client_key is not null;

-- 일지 저장: 탭 이름(p_title: null = 그대로, '' = 지우기) · 끊겨서 다시 보내도 한 장만(p_key)
drop function if exists public.teacher_note_save(text, date, bigint, text, text, text, text, text, text, boolean, jsonb);
create or replace function public.teacher_note_save(p_member text, p_date date, p_note bigint default null, p_did text default null,
  p_songs text default null, p_practice text default null, p_audition text default null, p_recommend text default null,
  p_memo text default null, p_rich boolean default false, p_sheet jsonb default null, p_title text default null, p_key text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.teachers := private.my_teacher();
  v_id bigint; v_note bigint := p_note;
  raw text[] := array[p_did, p_songs, p_practice, p_audition, p_recommend, p_memo];
  f text[] := '{}';
  lim int[] := array[800, 2000, 400, 800, 800, 1000];
  i int; txt text;
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_key text := nullif(left(trim(coalesce(p_key, '')), 64), '');
begin
  if t.id is null then return private.fail('선생님으로 연결된 계정만 쓸 수 있어요.'); end if;
  if not private.teaches(t, p_member) then return private.fail('담당 학생만 쓸 수 있어요.'); end if;
  -- 선생님들이 앞으로 할 수업 탭을 미리 만들어 둠 (구글시트에서 가져온 11/21 일지 등) → 120일 뒤까지
  if p_date is null or p_date > private.now_kst()::date + 120 or p_date < private.now_kst()::date - 366 then return private.fail('수업 날짜를 확인해주세요.'); end if;
  if char_length(coalesce(v_title, '')) > 60 then return private.fail('탭 이름은 60자까지예요.'); end if;
  if p_sheet is not null then
    if not private.sheet_ok(p_sheet) then return private.fail('표에 쓸 수 없는 내용이 있거나 너무 길어요 (한 칸에 5000자까지).'); end if;
    if trim(private.sheet_text(p_sheet)) = '' then return private.fail('한 칸 이상 적어주세요.'); end if;
    f := array[null, null, null, null, null, null]::text[];
  else
    for i in 1..6 loop
      txt := case when p_rich then private.rich_text(raw[i]) else coalesce(raw[i], '') end;
      if char_length(txt) > lim[i] then return private.fail('글이 너무 길어요.'); end if;
      f := f || case when trim(txt) = '' then null else trim(raw[i]) end;
    end loop;
    if coalesce(f[1], f[2], f[3], f[4], f[5], f[6]) is null then return private.fail('한 칸 이상 적어주세요.'); end if;
    if p_rich and not (private.rich_ok(f[1]) and private.rich_ok(f[2]) and private.rich_ok(f[3]) and private.rich_ok(f[4])
                       and private.rich_ok(f[5]) and private.rich_ok(f[6])) then
      return private.fail('꾸민 글에 쓸 수 없는 내용이 있어요. 다시 붙여넣어 주세요.');
    end if;
  end if;
  -- 저장은 됐는데 대답이 안 와서 다시 보낸 새 일지 → 처음 만든 그 일지를 고침
  if v_note is null and v_key is not null then
    select id into v_note from public.lesson_notes where teacher_id = t.id and client_key = v_key and member_id = p_member;
  end if;
  if v_note is null then
    insert into public.lesson_notes (member_id, lesson_date, teacher, teacher_id, did, songs, practice, audition, recommend, memo, rich, sheet, title, client_key)
    values (p_member, p_date, t.name, t.id, f[1], f[2], f[3], f[4], f[5], f[6], coalesce(p_rich, false) or p_sheet is not null, p_sheet, v_title, v_key)
    returning id into v_id;
  else
    update public.lesson_notes set
      site_edited = site_edited or (src_file is not null and (sheet is distinct from p_sheet or lesson_date <> p_date)),
      lesson_date = p_date, did = f[1], songs = f[2], practice = f[3], audition = f[4],
      recommend = f[5], memo = f[6], rich = coalesce(p_rich, false) or p_sheet is not null, sheet = p_sheet,
      title = case when p_title is null then title else v_title end, updated_at = now()
    where id = v_note and member_id = p_member and teacher_id = t.id returning id into v_id;
    if v_id is null then return private.fail('내가 쓴 일지만 고칠 수 있어요.'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.teacher_note_save(text, date, bigint, text, text, text, text, text, text, boolean, jsonb, text, text) from public, anon;
grant execute on function public.teacher_note_save(text, date, bigint, text, text, text, text, text, text, boolean, jsonb, text, text) to authenticated;

-- 곡·자료 탭 만들기 · 고치기 · 이름 바꾸기 (p_sheet null = 이름만). 담당 학생 것만. 구글시트에서 온 탭을 고치면 그 뒤로 시트가 덮지 않음.
create or replace function public.teacher_sheet_save(p_member text, p_id bigint default null, p_title text default null,
  p_sheet jsonb default null, p_key text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.teachers := private.my_teacher();
  x public.lesson_sheets; v_id bigint := p_id;
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_key text := nullif(left(trim(coalesce(p_key, '')), 64), '');
begin
  if t.id is null then return private.fail('선생님으로 연결된 계정만 쓸 수 있어요.'); end if;
  if not private.teaches(t, p_member) then return private.fail('담당 학생만 쓸 수 있어요.'); end if;
  if v_title is not null and char_length(v_title) > 100 then return private.fail('탭 이름은 100자까지예요.'); end if;
  if p_sheet is not null and not private.sheet_ok(p_sheet) then return private.fail('표에 쓸 수 없는 내용이 있거나 너무 길어요 (한 칸에 5000자까지).'); end if;
  if v_id is null and v_key is not null then
    select id into v_id from public.lesson_sheets where member_id = p_member and client_key = v_key;
  end if;
  if v_id is null then
    if v_title is null then return private.fail('탭 이름을 적어주세요.'); end if;
    insert into public.lesson_sheets (member_id, teacher_id, created_by, title, pos, sheet, site_edited, client_key, updated_at, synced_at)
    values (p_member, t.id, t.id, v_title, 0, coalesce(p_sheet, '{"v":1,"n":100,"w":{},"h":{},"c":{}}'::jsonb), true, v_key, now(), now())
    returning id into v_id;
    return jsonb_build_object('ok', true, 'id', v_id);
  end if;
  select * into x from public.lesson_sheets where id = v_id and member_id = p_member;
  if x.id is null then return private.fail('이 학생의 탭이 아니에요.'); end if;
  if p_title is not null and v_title is null then return private.fail('탭 이름을 적어주세요.'); end if;
  update public.lesson_sheets set
    title = coalesce(v_title, title), sheet = coalesce(p_sheet, sheet),
    site_edited = site_edited or (src_file is not null and (sheet is distinct from coalesce(p_sheet, sheet) or title is distinct from coalesce(v_title, title))),
    updated_at = now()
  where id = x.id;
  return jsonb_build_object('ok', true, 'id', x.id);
end $$;
revoke all on function public.teacher_sheet_save(text, bigint, text, jsonb, text) from public, anon;
grant execute on function public.teacher_sheet_save(text, bigint, text, jsonb, text) to authenticated;

-- 홈페이지에서 만든 곡·자료 탭만 지우기 (구글시트에서 온 탭은 시트에서)
create or replace function public.teacher_sheet_delete(p_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.teachers := private.my_teacher(); x public.lesson_sheets;
begin
  if t.id is null then return private.fail('선생님으로 연결된 계정만 할 수 있어요.'); end if;
  select * into x from public.lesson_sheets where id = p_id;
  if x.id is null or not private.teaches(t, x.member_id) then return private.fail('담당 학생 것만 지울 수 있어요.'); end if;
  if x.src_file is not null then return private.fail('구글시트에서 가져온 탭은 구글시트에서 지워주세요.'); end if;
  delete from public.lesson_sheets where id = x.id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.teacher_sheet_delete(bigint) from public, anon;
grant execute on function public.teacher_sheet_delete(bigint) to authenticated;

-- 탭 순서: p_order = ["n123", "s45", …] 왼쪽부터. 내 일지 · 이 학생의 곡·자료만 바뀜.
create or replace function public.teacher_tab_order(p_member text, p_order jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.teachers := private.my_teacher(); e text; i int := 0;
begin
  if t.id is null then return private.fail('선생님으로 연결된 계정만 할 수 있어요.'); end if;
  if not private.teaches(t, p_member) then return private.fail('담당 학생만 할 수 있어요.'); end if;
  if jsonb_typeof(p_order) <> 'array' or jsonb_array_length(p_order) > 1000 then return private.fail('순서를 다시 보내주세요.'); end if;
  for e in select value from jsonb_array_elements_text(p_order) loop
    if e ~ '^n\d{1,18}$' then
      update public.lesson_notes set tab_pos = i where id = substr(e, 2)::bigint and member_id = p_member and teacher_id = t.id;
    elsif e ~ '^s\d{1,18}$' then
      update public.lesson_sheets set tab_pos = i where id = substr(e, 2)::bigint and member_id = p_member;
    end if;
    i := i + 1;
  end loop;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.teacher_tab_order(text, jsonb) from public, anon;
grant execute on function public.teacher_tab_order(text, jsonb) to authenticated;

-- 신입생 (일지 · 곡·자료가 하나도 없는 학생): 첫 수업에 OT · 양식 탭을 같이 만들어 줌
create or replace function public.teacher_starter(p_member text, p_ot jsonb, p_form jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.teachers := private.my_teacher(); a bigint; b bigint;
begin
  if t.id is null then return private.fail('선생님으로 연결된 계정만 할 수 있어요.'); end if;
  if not private.teaches(t, p_member) then return private.fail('담당 학생만 할 수 있어요.'); end if;
  perform 1 from public.members where id = p_member for update;
  if exists (select 1 from public.lesson_notes where member_id = p_member) or exists (select 1 from public.lesson_sheets where member_id = p_member) then
    return jsonb_build_object('ok', true, 'made', false);
  end if;
  if not private.sheet_ok(p_ot) or not private.sheet_ok(p_form) then return private.fail('표에 쓸 수 없는 내용이 있어요.'); end if;
  insert into public.lesson_sheets (member_id, teacher_id, created_by, title, pos, tab_pos, sheet, site_edited, updated_at, synced_at)
  values (p_member, t.id, t.id, 'OT', 0, 0, p_ot, true, now(), now()) returning id into a;
  insert into public.lesson_sheets (member_id, teacher_id, created_by, title, pos, tab_pos, sheet, site_edited, updated_at, synced_at)
  values (p_member, t.id, t.id, '양식', 1, 1, p_form, true, now(), now()) returning id into b;
  return jsonb_build_object('ok', true, 'made', true, 'ot', a, 'form', b);
end $$;
revoke all on function public.teacher_starter(text, jsonb, jsonb) from public, anon;
grant execute on function public.teacher_starter(text, jsonb, jsonb) to authenticated;

-- 학생 페이지: 일지 200개까지 (탭 이름 · 순서), 곡·자료도 순서 · 고친 표시
create or replace function public.teacher_student(p_member text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  t public.teachers := private.my_teacher();
  m public.members;
begin
  if t.id is null then return private.fail('선생님으로 연결된 계정만 볼 수 있어요.'); end if;
  if not private.teaches(t, p_member) then return private.fail('담당 학생만 볼 수 있어요.'); end if;
  select * into m from public.members where id = p_member;
  return jsonb_build_object('ok', true, 'student', jsonb_build_object('id', m.id, 'name', m.name, 'status', m.status),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'date', n.lesson_date, 'teacher', n.teacher, 'did', n.did, 'songs', n.songs,
               'practice', n.practice, 'audition', n.audition, 'recommend', n.recommend, 'rich', n.rich, 'sheet', n.sheet, 'memo', n.memo,
               'mine', n.teacher_id = t.id, 'src', n.src_file is not null, 'srcTitle', n.src_title, 'siteEdited', n.site_edited,
               'title', n.title, 'tabPos', n.tab_pos)
             order by n.lesson_date desc, n.id desc)
      from (select * from public.lesson_notes where member_id = m.id order by lesson_date desc, id desc limit 200) n
    ), '[]'::jsonb),
    'sheets', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'teacher', tt.name, 'pos', x.pos, 'tabPos', x.tab_pos,
               'src', x.src_file is not null, 'siteEdited', x.site_edited) order by x.src_file nulls last, x.pos, x.id)
      from public.lesson_sheets x left join public.teachers tt on tt.id = x.teacher_id where x.member_id = m.id
    ), '[]'::jsonb),
    'logs', coalesce((
      select jsonb_agg(jsonb_build_object('day', l.day, 'minutes', l.minutes, 'song', l.song, 'did', l.did) order by l.day desc, l.id desc)
      from (select * from public.practice_logs where member_id = m.id order by day desc, id desc limit 20) l
    ), '[]'::jsonb),
    'repertoire', coalesce((
      select jsonb_agg(jsonb_build_object('title', r.title, 'artist', r.artist, 'status', r.status, 'purpose', r.purpose) order by r.updated_at desc)
      from public.repertoire r where r.member_id = m.id
    ), '[]'::jsonb));
end $$;

create or replace function public.teacher_lesson_sheet(p_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t public.teachers := private.my_teacher(); x public.lesson_sheets;
begin
  if t.id is null then return private.fail('선생님으로 연결된 계정만 볼 수 있어요.'); end if;
  select * into x from public.lesson_sheets where id = p_id;
  if x.id is null or not private.teaches(t, x.member_id) then return private.fail('담당 학생 것만 볼 수 있어요.'); end if;
  return jsonb_build_object('ok', true, 'id', x.id, 'title', x.title, 'sheet', x.sheet, 'syncedAt', x.synced_at,
    'src', x.src_file is not null, 'siteEdited', x.site_edited);
end $$;

-- 구글시트 맞추기: 홈페이지에서 고친 곡·자료 탭은 덮지 않음
create or replace function public.lesson_sync_push(p_key text, p_file text, p_notes jsonb DEFAULT '[]'::jsonb, p_sheets jsonb DEFAULT '[]'::jsonb, p_done boolean DEFAULT false, p_modified timestamp with time zone DEFAULT NULL::timestamp with time zone, p_ver integer DEFAULT 1, p_tabs jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.lesson_sources; t public.teachers; r jsonb; v_date date; v_tab bigint; v_sheet jsonb; ex public.lesson_notes;
  added int := 0; updated int := 0; kept int := 0; skipped int := 0; sh int := 0; bad int := 0; blocked int := 0;
begin
  if not private.lesson_key_ok(p_key) then return private.fail('연결 열쇠가 맞지 않아요.'); end if;
  select * into s from public.lesson_sources where file_id = p_file;
  if s.file_id is null or s.status <> 'ok' or s.member_id is null then return private.fail('확인된 학생 파일이 아니에요.'); end if;
  select * into t from public.teachers where id = s.teacher_id;
  if jsonb_typeof(coalesce(p_notes, '[]')) <> 'array' or jsonb_typeof(coalesce(p_sheets, '[]')) <> 'array' then return private.fail('보낸 내용이 이상해요.'); end if;

  for r in select * from jsonb_array_elements(coalesce(p_notes, '[]')) loop
    begin
      v_tab := (r ->> 'tab')::bigint; v_date := (r ->> 'date')::date; v_sheet := r -> 'sheet';
    exception when others then bad := bad + 1; continue; end;
    if v_tab is null or v_date is null or v_date < date '2026-01-01' or v_date > private.now_kst()::date + 400 then skipped := skipped + 1; continue; end if;
    if exists (select 1 from private.lesson_skip k where k.src_file = p_file and k.src_tab = v_tab) then skipped := skipped + 1; continue; end if;
    if private.lesson_private(v_sheet) then blocked := blocked + 1; continue; end if;
    v_sheet := private.mask_phone(v_sheet);
    if not private.sheet_ok(v_sheet) or trim(private.sheet_text(v_sheet)) = '' then bad := bad + 1; continue; end if;
    select * into ex from public.lesson_notes where src_file = p_file and src_tab = v_tab;
    if ex.id is null then
      insert into public.lesson_notes (member_id, lesson_date, teacher, teacher_id, rich, sheet, src_file, src_tab, src_title, synced_at)
      values (s.member_id, v_date, t.name, s.teacher_id, true, v_sheet, p_file, v_tab, left(r ->> 'title', 120), now());
      added := added + 1;
    elsif ex.site_edited then
      kept := kept + 1;
    else
      if ex.sheet is distinct from v_sheet or ex.lesson_date <> v_date or ex.member_id <> s.member_id then
        update public.lesson_notes set member_id = s.member_id, lesson_date = v_date, sheet = v_sheet, rich = true,
          teacher = coalesce(t.name, teacher), teacher_id = coalesce(s.teacher_id, teacher_id),
          src_title = left(r ->> 'title', 120), synced_at = now(), updated_at = now()
        where id = ex.id;
        updated := updated + 1;
      end if;
    end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_sheets, '[]')) loop
    begin
      v_tab := (r ->> 'tab')::bigint; v_sheet := r -> 'sheet';
    exception when others then bad := bad + 1; continue; end;
    if v_tab is null or coalesce(trim(r ->> 'title'), '') = '' or not private.sheet_ok(v_sheet) or trim(private.sheet_text(v_sheet)) = '' then
      bad := bad + 1; continue;
    end if;
    if private.lesson_private(v_sheet) or trim(r ->> 'title') ~ '상담|등록 ?일지|신상|개인 ?정보' then
      delete from public.lesson_sheets where src_file = p_file and src_tab = v_tab and not site_edited;
      blocked := blocked + 1; continue;
    end if;
    insert into public.lesson_sheets (member_id, teacher_id, src_file, src_tab, title, pos, sheet, synced_at)
    values (s.member_id, s.teacher_id, p_file, v_tab, left(trim(r ->> 'title'), 120), coalesce((r ->> 'pos')::int, 0), v_sheet, now())
    on conflict (src_file, src_tab) do update set member_id = excluded.member_id, teacher_id = excluded.teacher_id, title = excluded.title,
      pos = excluded.pos, sheet = excluded.sheet, synced_at = now()
    where not public.lesson_sheets.site_edited and (public.lesson_sheets.sheet is distinct from excluded.sheet or public.lesson_sheets.title is distinct from excluded.title
       or public.lesson_sheets.pos is distinct from excluded.pos or public.lesson_sheets.member_id is distinct from excluded.member_id);
    sh := sh + 1;
  end loop;

  if p_done then
    update public.lesson_sources set synced_modified = coalesce(p_modified, modified), synced_ver = p_ver, synced_at = now(),
      notes = (select count(*) from public.lesson_notes where src_file = p_file),
      sheets = (select count(*) from public.lesson_sheets where src_file = p_file),
      kept = (select count(*) from public.lesson_notes where src_file = p_file and site_edited),
      gone = case when jsonb_typeof(p_tabs) = 'array' then
        (select count(*) from public.lesson_notes n where n.src_file = p_file and not (p_tabs @> to_jsonb(n.src_tab)))
        + (select count(*) from public.lesson_sheets x where x.src_file = p_file and not (p_tabs @> to_jsonb(x.src_tab)))
        else gone end
    where file_id = p_file;
  end if;
  return jsonb_build_object('ok', true, 'added', added, 'updated', updated, 'kept', kept, 'skipped', skipped, 'sheets', sh, 'bad', bad, 'blocked', blocked);
end $function$
;

-- 만 14세 미만 학생: 부모님 카카오 계정으로 연결 요청 (원장님 2026-11-04, 카카오가 14세 미만 본인 계정 로그인을 막음)
alter table public.link_requests add column if not exists guardian boolean not null default false;
drop function if exists public.kakao_link_request(text, text);
create or replace function public.kakao_link_request(p_name text, p_teacher text default null, p_guardian boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  meta jsonb := coalesce(auth.jwt() -> 'user_metadata', '{}'::jsonb);
  v_name text := trim(coalesce(p_name, ''));
begin
  if uid is null then return private.fail('카카오 로그인이 필요해요.'); end if;
  if exists (select 1 from public.members where kakao_user = uid) then return private.fail('이미 연결된 계정이에요.'); end if;
  if length(v_name) < 1 or length(v_name) > 30 then return private.fail('이름을 정확히 적어주세요.'); end if;
  insert into public.link_requests (user_id, kakao_name, name, teacher, guardian)
  values (uid, nullif(coalesce(meta ->> 'full_name', meta ->> 'name', meta ->> 'nickname', meta ->> 'preferred_username'), ''),
          v_name, nullif(trim(coalesce(p_teacher, '')), ''), coalesce(p_guardian, false))
  on conflict (user_id) do update
    set name = excluded.name, teacher = excluded.teacher, kakao_name = excluded.kakao_name, guardian = excluded.guardian,
        status = '대기', member_id = null, created_at = now(), decided_at = null;
  perform private.notify('🔗 카카오 연결 요청: ' || v_name || case when coalesce(p_guardian, false) then ' (부모님 계정)' else '' end
    || coalesce(' · ' || nullif(trim(coalesce(p_teacher, '')), '') || ' 선생님', ''));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.kakao_link_request(text, text, boolean) from public, anon;
grant execute on function public.kakao_link_request(text, text, boolean) to authenticated;
-- ---------------------------------------------------------------- 마이그레이션 leesh_note_title (2026-11-04)
-- 일지 탭 이름만 바꾸기 ('' = 날짜로 되돌리기). 내가 쓴 일지만.
create or replace function public.teacher_note_title(p_note bigint, p_title text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.teachers := private.my_teacher(); v_id bigint; v_title text := nullif(trim(coalesce(p_title, '')), '');
begin
  if t.id is null then return private.fail('선생님으로 연결된 계정만 할 수 있어요.'); end if;
  if char_length(coalesce(v_title, '')) > 60 then return private.fail('탭 이름은 60자까지예요.'); end if;
  update public.lesson_notes set title = v_title where id = p_note and teacher_id = t.id returning id into v_id;
  if v_id is null then return private.fail('내가 쓴 일지만 바꿀 수 있어요.'); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.teacher_note_title(bigint, text) from public, anon;
grant execute on function public.teacher_note_title(bigint, text) to authenticated;
-- ---------------------------------------------------------------- 마이그레이션 leesh_kakao_status_guardian (2026-11-04)
-- 요청 고치기에서 부모님 계정 표시도 그대로
create or replace function public.kakao_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := auth.uid();
  m public.members;
  r public.link_requests;
begin
  if uid is null then return private.fail('카카오 로그인이 필요해요.'); end if;
  select * into m from public.members where kakao_user = uid;
  if m.id is not null then
    return jsonb_build_object('ok', true, 'linked', true, 'name', m.name, 'active', m.status in ('재원', '외부'));
  end if;
  select * into r from public.link_requests where user_id = uid;
  return jsonb_build_object('ok', true, 'linked', false, 'request',
    case when r.id is null then null else jsonb_build_object('status', r.status, 'name', r.name, 'teacher', r.teacher, 'guardian', r.guardian) end);
end $function$
;
-- ---------------------------------------------------------------- 마이그레이션 leesh_booking_room_lock (2026-11-05)
-- 연습실 예약 동시 접속 시험(80~200명이 한꺼번에, 복사본 DB): 겹친 예약은 0건이었지만 같은 시간에 몰리면 2~3%가 deadlock 오류
-- (화면에는 "연결이 원활하지 않습니다") → 같은 방 · 같은 날 예약을 한 줄로 세움. 고친 뒤 오류 0, 가장 느린 응답 8초 → 0.2초.
create or replace function public.booking_create(p_id text, p_pin text, p_room text, p_date text, p_start text, p_hours integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  mid text;
  s public.settings;
  t timestamp := private.now_kst();
  today date := t::date;
  now_min int := extract(hour from t)::int * 60 + extract(minute from t)::int;
  d date;
  room public.rooms;
  st int := private.to_min(p_start);
  en int;
  used int;
  new_id bigint;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  select * into s from public.settings where id = 1;

  begin
    d := p_date::date;
  exception when others then
    return private.fail('날짜 형식이 올바르지 않습니다.');
  end;
  if d is null then return private.fail('날짜 형식이 올바르지 않습니다.'); end if;
  if d < today then return private.fail('지난 날짜는 예약할 수 없습니다.'); end if;
  if d > today + s.max_days then
    return private.fail(case when s.max_days = 0 then '예약은 당일만 할 수 있어요. 매일 밤 12시에 그날 예약이 열려요.'
                             when s.max_days = 1 then '예약은 오늘과 내일만 할 수 있어요. 매일 밤 12시에 다음 날 예약이 열려요.'
                             else '예약은 오늘부터 ' || s.max_days || '일 뒤까지만 가능합니다.' end);
  end if;

  select * into room from public.rooms where name = p_room and active;
  if room.id is null then
    return private.fail('선택한 연습실을 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.');
  end if;

  if st is null then return private.fail('시작 시간이 올바르지 않습니다.'); end if;
  if p_hours is null or p_hours < 1 then return private.fail('이용 시간을 선택해주세요.'); end if;
  if p_hours * 60 > s.max_minutes then
    return private.fail('한 번에 최대 ' || s.max_minutes / 60 || '시간까지 예약할 수 있습니다.');
  end if;
  en := st + p_hours * 60;
  if (st - s.open_min) % s.unit_min <> 0 then
    return private.fail('예약은 ' || s.unit_min || '분 단위로만 가능합니다.');
  end if;
  if st < s.open_min or en > s.close_min then
    return private.fail('운영 시간(' || private.hhmm(s.open_min) || '~' || private.hhmm(s.close_min) || ') 안에서만 예약할 수 있습니다.');
  end if;
  if d = today and st <= now_min then
    return private.fail('이미 시작한 시간이에요. 다음 시간부터 예약할 수 있어요.');
  end if;

  -- 같은 사람의 동시 요청을 한 줄로 세워 하루 최대 시간 검사가 새지 않게 합니다.
  perform pg_advisory_xact_lock(hashtext('member:' || mid));
  select coalesce(sum(end_min - start_min), 0) into used
    from public.bookings where member_id = mid and day = d and status = '확정';
  if used + (en - st) > s.daily_max_minutes then
    return private.fail('하루 최대 ' || trim_scale(s.daily_max_minutes / 60.0) || '시간까지 예약할 수 있습니다. (이날 이미 '
      || trim_scale(used / 60.0) || '시간 예약)');
  end if;

  -- 같은 방 · 같은 날 예약도 한 줄로 세워요 (2026-11-05 동시 접속 시험: 수십 명이 한꺼번에 같은 시간을 누르면
  -- 겹침 검사끼리 서로 기다리다 deadlock이 났음 → 순서: 사람 → 방, 방은 하나라서 서로 물고 늘어질 일이 없음)
  perform pg_advisory_xact_lock(hashtext('room:' || room.id || ':' || d));
  begin
    insert into public.bookings (room_id, member_id, day, start_min, end_min)
    values (room.id, mid, d, st, en) returning id into new_id;
  exception when exclusion_violation then
    if sqlerrm like '%bookings_no_member_overlap%' then
      return private.fail('같은 시간에 이미 다른 연습실을 예약하셨습니다.');
    end if;
    return private.fail('방금 다른 예약이 들어왔습니다. 다른 시간을 골라주세요.');
  when deadlock_detected or lock_not_available then
    return private.fail('예약하는 사람이 몰렸어요. 한 번 더 눌러주세요.');
  end;

  perform private.notify('🎤 연습실 예약' || chr(10) || (who ->> 'name') || ' (' || mid || ') · ' || room.name
    || chr(10) || private.day_label(d) || ' ' || private.hhmm(st) || '~' || private.hhmm(en));

  return jsonb_build_object('ok', true, 'booking', jsonb_build_object(
    'id', new_id, 'room', room.name, 'date', d, 'start', private.hhmm(st), 'end', private.hhmm(en)));
end $function$
;
-- ---------------------------------------------------------------- 마이그레이션 leesh_booking_pause (2026-11-05)
-- 연습실 예약 잠깐 멈춤 (원장님 2026-11-05 "학생들 다 가입시켜놓고 한번에 시작"). 화면은 config.js bookingOpen: false → "준비 중".
-- 다시 열 때는 둘 다: update public.settings set booking_open = true; + config.js bookingOpen: true
alter table public.settings add column if not exists booking_open boolean not null default true;
update public.settings set booking_open = false where id = 1;
CREATE OR REPLACE FUNCTION public.booking_create(p_id text, p_pin text, p_room text, p_date text, p_start text, p_hours integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  mid text;
  s public.settings;
  t timestamp := private.now_kst();
  today date := t::date;
  now_min int := extract(hour from t)::int * 60 + extract(minute from t)::int;
  d date;
  room public.rooms;
  st int := private.to_min(p_start);
  en int;
  used int;
  new_id bigint;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  select * into s from public.settings where id = 1;
  -- 연습실 예약 잠깐 멈춤 (원장님 2026-11-05: 학생들 다 가입시킨 뒤 한 번에 시작). 다시 열기: update public.settings set booking_open = true;
  if not coalesce(s.booking_open, true) then
    return private.fail('연습실 예약은 준비 중이에요. 시작하면 학원에서 알려드릴게요.');
  end if;

  begin
    d := p_date::date;
  exception when others then
    return private.fail('날짜 형식이 올바르지 않습니다.');
  end;
  if d is null then return private.fail('날짜 형식이 올바르지 않습니다.'); end if;
  if d < today then return private.fail('지난 날짜는 예약할 수 없습니다.'); end if;
  if d > today + s.max_days then
    return private.fail(case when s.max_days = 0 then '예약은 당일만 할 수 있어요. 매일 밤 12시에 그날 예약이 열려요.'
                             when s.max_days = 1 then '예약은 오늘과 내일만 할 수 있어요. 매일 밤 12시에 다음 날 예약이 열려요.'
                             else '예약은 오늘부터 ' || s.max_days || '일 뒤까지만 가능합니다.' end);
  end if;

  select * into room from public.rooms where name = p_room and active;
  if room.id is null then
    return private.fail('선택한 연습실을 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.');
  end if;

  if st is null then return private.fail('시작 시간이 올바르지 않습니다.'); end if;
  if p_hours is null or p_hours < 1 then return private.fail('이용 시간을 선택해주세요.'); end if;
  if p_hours * 60 > s.max_minutes then
    return private.fail('한 번에 최대 ' || s.max_minutes / 60 || '시간까지 예약할 수 있습니다.');
  end if;
  en := st + p_hours * 60;
  if (st - s.open_min) % s.unit_min <> 0 then
    return private.fail('예약은 ' || s.unit_min || '분 단위로만 가능합니다.');
  end if;
  if st < s.open_min or en > s.close_min then
    return private.fail('운영 시간(' || private.hhmm(s.open_min) || '~' || private.hhmm(s.close_min) || ') 안에서만 예약할 수 있습니다.');
  end if;
  if d = today and st <= now_min then
    return private.fail('이미 시작한 시간이에요. 다음 시간부터 예약할 수 있어요.');
  end if;

  -- 같은 사람의 동시 요청을 한 줄로 세워 하루 최대 시간 검사가 새지 않게 합니다.
  perform pg_advisory_xact_lock(hashtext('member:' || mid));
  select coalesce(sum(end_min - start_min), 0) into used
    from public.bookings where member_id = mid and day = d and status = '확정';
  if used + (en - st) > s.daily_max_minutes then
    return private.fail('하루 최대 ' || trim_scale(s.daily_max_minutes / 60.0) || '시간까지 예약할 수 있습니다. (이날 이미 '
      || trim_scale(used / 60.0) || '시간 예약)');
  end if;

  -- 같은 방 · 같은 날 예약도 한 줄로 세워요 (2026-11-05 동시 접속 시험: 수십 명이 한꺼번에 같은 시간을 누르면
  -- 겹침 검사끼리 서로 기다리다 deadlock이 났음 → 순서: 사람 → 방, 방은 하나라서 서로 물고 늘어질 일이 없음)
  perform pg_advisory_xact_lock(hashtext('room:' || room.id || ':' || d));
  begin
    insert into public.bookings (room_id, member_id, day, start_min, end_min)
    values (room.id, mid, d, st, en) returning id into new_id;
  exception when exclusion_violation then
    if sqlerrm like '%bookings_no_member_overlap%' then
      return private.fail('같은 시간에 이미 다른 연습실을 예약하셨습니다.');
    end if;
    return private.fail('방금 다른 예약이 들어왔습니다. 다른 시간을 골라주세요.');
  when deadlock_detected or lock_not_available then
    return private.fail('예약하는 사람이 몰렸어요. 한 번 더 눌러주세요.');
  end;

  perform private.notify('🎤 연습실 예약' || chr(10) || (who ->> 'name') || ' (' || mid || ') · ' || room.name
    || chr(10) || private.day_label(d) || ' ' || private.hhmm(st) || '~' || private.hhmm(en));

  return jsonb_build_object('ok', true, 'booking', jsonb_build_object(
    'id', new_id, 'room', room.name, 'date', d, 'start', private.hhmm(st), 'end', private.hhmm(en)));
end $function$;
-- ---------------------------------------------------------------- 마이그레이션 leesh_messages (2026-11-05)
-- 관리자 → 학생 · 선생님 메시지 (원장님 2026-11-05 "학생이 로그인하면 볼 수 있는 메시지, 선생님한테도").
-- 한 사람에게 한 줄 (여러 명에게 보내면 줄이 여러 개). 받는 사람만 읽고, 읽은 시각이 관리자 화면에 보여요. 답장은 없음.
create table if not exists public.messages (
  id         bigint generated always as identity primary key,
  to_member  text references public.members (id) on update cascade on delete cascade,
  to_teacher bigint references public.teachers (id) on delete cascade,
  sender     text not null default '학원' check (sender in ('학원', '원장님', '실장님')),
  body       text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  constraint messages_one_to check ((to_member is null) <> (to_teacher is null))
);
create index if not exists messages_member_idx on public.messages (to_member, created_at desc) where to_member is not null;
create index if not exists messages_teacher_idx on public.messages (to_teacher, created_at desc) where to_teacher is not null;

alter table public.messages enable row level security;
drop policy if exists admin_all on public.messages;
create policy admin_all on public.messages for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.messages from anon;
grant select, insert, update, delete on public.messages to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- 학생: 내 메시지 (최근 50개)
create or replace function public.member_messages(p_id text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who jsonb := private.check_ready(p_id, p_pin);
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'sender', m.sender, 'body', m.body, 'at', m.created_at, 'read', m.read_at is not null)
           order by m.created_at desc)
    from (select * from public.messages where to_member = who ->> 'id' order by created_at desc limit 50) m), '[]'::jsonb));
end $$;

-- 학생: 읽음 표시 (자기 메시지만)
create or replace function public.member_message_read(p_id text, p_pin text, p_ids bigint[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who jsonb := private.check_ready(p_id, p_pin);
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  update public.messages set read_at = now()
   where to_member = who ->> 'id' and id = any (coalesce(p_ids, '{}')) and read_at is null;
  return jsonb_build_object('ok', true);
end $$;

-- 선생님: 내 메시지 (최근 50개)
create or replace function public.teacher_messages() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.teachers := private.my_teacher();
begin
  if t.id is null then return private.fail('선생님 연결이 필요해요.'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'sender', m.sender, 'body', m.body, 'at', m.created_at, 'read', m.read_at is not null)
           order by m.created_at desc)
    from (select * from public.messages where to_teacher = t.id order by created_at desc limit 50) m), '[]'::jsonb));
end $$;

create or replace function public.teacher_message_read(p_ids bigint[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.teachers := private.my_teacher();
begin
  if t.id is null then return private.fail('선생님 연결이 필요해요.'); end if;
  update public.messages set read_at = now()
   where to_teacher = t.id and id = any (coalesce(p_ids, '{}')) and read_at is null;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.member_messages(text, text), public.member_message_read(text, text, bigint[]),
  public.teacher_messages(), public.teacher_message_read(bigint[]) from public, anon;
grant execute on function public.member_messages(text, text), public.member_message_read(text, text, bigint[]) to anon, authenticated;
grant execute on function public.teacher_messages(), public.teacher_message_read(bigint[]) to authenticated;
-- ---------------------------------------------------------------- 마이그레이션 leesh_parents (2026-11-05)
-- 학부모 계정 (원장님 2026-11-05 "미성년자가 많다 보니 학부모가 보고 싶어함"): 부모님 본인 카카오로 parent.html →
-- 성함 + 자녀 이름 보내기(parent_requests) → 관리자 → 학부모 탭에서 자녀(수강 ID)를 골라 승인 → 보기만:
-- 월말평가 · 일정·공지 · 학원 메시지 (원장님이 고름). 예약 · 글쓰기 · 건의함 · 연습 일지 · 레퍼토리 · 레슨 노트는 안 보임.
-- 학생 화면에는 부모님 연결을 표시하지 않음 (원장님 2026-11-05). 자녀 여러 명 OK (형제).
create table if not exists public.parents (
  id         bigint generated always as identity primary key,
  kakao_user uuid not null unique,
  name       text not null check (char_length(trim(name)) between 1 and 30),   -- 부모님 성함 (예: 김OO 어머님)
  kakao_name text check (char_length(kakao_name) <= 60),
  created_at timestamptz not null default now()
);
create table if not exists public.parent_links (
  parent_id  bigint not null references public.parents (id) on delete cascade,
  member_id  text not null references public.members (id) on update cascade on delete cascade,
  created_at timestamptz not null default now(),
  primary key (parent_id, member_id)
);
create index if not exists parent_links_member_idx on public.parent_links (member_id);
create table if not exists public.parent_requests (
  id         bigint generated always as identity primary key,
  user_id    uuid not null unique,
  kakao_name text check (char_length(kakao_name) <= 60),
  name       text not null check (char_length(trim(name)) between 1 and 30),
  children   text not null check (char_length(trim(children)) between 1 and 200),  -- 부모님이 적은 자녀 이름 (그대로)
  status     text not null default '대기' check (status in ('대기', '승인', '거절')),
  parent_id  bigint references public.parents (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

alter table public.parents enable row level security;
alter table public.parent_links enable row level security;
alter table public.parent_requests enable row level security;
drop policy if exists admin_all on public.parents;
create policy admin_all on public.parents for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all on public.parent_links;
create policy admin_all on public.parent_links for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all on public.parent_requests;
create policy admin_all on public.parent_requests for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.parents, public.parent_links, public.parent_requests from anon;
grant select, insert, update, delete on public.parents, public.parent_links, public.parent_requests to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- 메시지 받는 사람에 학부모 더하기
alter table public.messages add column if not exists to_parent bigint references public.parents (id) on delete cascade;
alter table public.messages drop constraint if exists messages_one_to;
alter table public.messages add constraint messages_one_to check (num_nonnulls(to_member, to_teacher, to_parent) = 1);
create index if not exists messages_parent_idx on public.messages (to_parent, created_at desc) where to_parent is not null;

-- 로그인한 학부모 / 그 학부모가 볼 수 있는 자녀 (종료된 학생은 안 보임)
create or replace function private.my_parent() returns public.parents
language sql stable security definer set search_path = '' as $$
  select p from public.parents p where p.kakao_user = auth.uid() and auth.uid() is not null;
$$;
create or replace function private.parent_children() returns setof text
language sql stable security definer set search_path = '' as $$
  select l.member_id from public.parents p
    join public.parent_links l on l.parent_id = p.id
    join public.members m on m.id = l.member_id
   where p.kakao_user = auth.uid() and auth.uid() is not null and m.status <> '종료';
$$;
grant execute on function private.parent_children() to authenticated;

-- 평가지 사진: 학부모는 자기 자녀 폴더만 읽기
drop policy if exists eval_reports_parent on storage.objects;
create policy eval_reports_parent on storage.objects for select to authenticated
  using (bucket_id = 'eval-reports' and (storage.foldername(name))[1] in (select private.parent_children()));

create or replace function public.parent_me() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p public.parents := private.my_parent();
  r public.parent_requests;
begin
  if auth.uid() is null then return private.fail('카카오 로그인이 필요해요.'); end if;
  if p.id is null then
    select * into r from public.parent_requests where user_id = auth.uid();
    return jsonb_build_object('ok', true, 'linked', false,
      'request', case when r.id is null then null else jsonb_build_object('name', r.name, 'children', r.children, 'status', r.status) end);
  end if;
  return jsonb_build_object('ok', true, 'linked', true, 'name', p.name,
    'children', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'status', m.status) order by m.name)
      from public.parent_links l join public.members m on m.id = l.member_id
      where l.parent_id = p.id and m.status <> '종료'), '[]'::jsonb),
    'unread', (select count(*) from public.messages where to_parent = p.id and read_at is null));
end $$;

create or replace function public.parent_request(p_name text, p_children text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  meta jsonb := coalesce(auth.jwt() -> 'user_metadata', '{}'::jsonb);
  v_name text := trim(coalesce(p_name, ''));
  v_kids text := trim(coalesce(p_children, ''));
begin
  if uid is null then return private.fail('카카오 로그인이 필요해요.'); end if;
  if exists (select 1 from public.parents where kakao_user = uid) then return private.fail('이미 연결된 학부모 계정이에요.'); end if;
  if char_length(v_name) < 1 or char_length(v_name) > 30 then return private.fail('보호자 성함을 적어주세요.'); end if;
  if char_length(v_kids) < 1 or char_length(v_kids) > 200 then return private.fail('자녀 이름을 적어주세요.'); end if;
  insert into public.parent_requests (user_id, kakao_name, name, children)
  values (uid, nullif(coalesce(meta ->> 'full_name', meta ->> 'name', meta ->> 'nickname', meta ->> 'preferred_username'), ''), v_name, v_kids)
  on conflict (user_id) do update
    set name = excluded.name, children = excluded.children, kakao_name = excluded.kakao_name,
        status = '대기', parent_id = null, created_at = now(), decided_at = null;
  perform private.notify('👪 학부모 연결 요청: ' || v_name || ' · 자녀 ' || v_kids);
  return jsonb_build_object('ok', true);
end $$;

-- 자녀 한 명: 월말평가 + 일정·공지 (+ 다가오는 학원 내방 오디션) — 학생 내 폴더와 같은 모양
create or replace function public.parent_child(p_member text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p public.parents := private.my_parent();
  m public.members;
  today date := private.now_kst()::date;
begin
  if p.id is null then return private.fail('학부모 연결이 필요해요.'); end if;
  select mb.* into m from public.members mb join public.parent_links l on l.member_id = mb.id
   where l.parent_id = p.id and mb.id = p_member and mb.status <> '종료';
  if m.id is null then return private.fail('연결된 자녀가 아니에요.'); end if;
  return jsonb_build_object('ok', true, 'id', m.id, 'name', m.name, 'status', m.status,
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'month', to_char(r.month, 'YYYY-MM'), 'pages', r.pages, 'song', r.song, 'teacher', r.teacher,
        'basic', r.basic, 'technique', r.technique, 'acting', r.acting, 'styling', r.styling,
        'total', r.total, 'stage', r.stage
      ) order by r.month desc)
      from (select * from public.eval_reports where member_id = m.id order by month desc limit 12) r
    ), '[]'::jsonb),
    'notices', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body, 'start', n.start_date,
               'end', n.end_date, 'pinned', n.pinned, 'at', n.created_at) order by n.pinned desc, coalesce(n.start_date, n.created_at::date) desc)
      from (select * from public.notices where published and (end_date is null or end_date >= today)
            order by pinned desc, created_at desc limit 20) n
    ), '[]'::jsonb),
    'visits', coalesce((
      select jsonb_agg(jsonb_build_object('title', a.title, 'company', a.company, 'date', a.event_date, 'deadline', a.deadline)
               order by a.event_date)
      from (select * from public.audition_news where published and kind = '내방' and event_date >= today
            order by event_date limit 6) a
    ), '[]'::jsonb));
end $$;

create or replace function public.parent_messages() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p public.parents := private.my_parent();
begin
  if p.id is null then return private.fail('학부모 연결이 필요해요.'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'sender', x.sender, 'body', x.body, 'at', x.created_at, 'read', x.read_at is not null)
           order by x.created_at desc)
    from (select * from public.messages where to_parent = p.id order by created_at desc limit 50) x), '[]'::jsonb));
end $$;

create or replace function public.parent_message_read(p_ids bigint[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p public.parents := private.my_parent();
begin
  if p.id is null then return private.fail('학부모 연결이 필요해요.'); end if;
  update public.messages set read_at = now()
   where to_parent = p.id and id = any (coalesce(p_ids, '{}')) and read_at is null;
  return jsonb_build_object('ok', true);
end $$;

-- 관리자: 요청 승인(자녀 수강 ID 고르기) · 거절
create or replace function public.admin_parent_decide(p_req bigint, p_members text[], p_ok boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.parent_requests;
  pid bigint;
  n int;
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  select * into r from public.parent_requests where id = p_req;
  if r.id is null then return private.fail('요청을 찾을 수 없어요.'); end if;
  if not coalesce(p_ok, false) then
    update public.parent_requests set status = '거절', decided_at = now() where id = r.id;
    return jsonb_build_object('ok', true);
  end if;
  select count(*) into n from public.members where id = any (coalesce(p_members, '{}'));
  if n = 0 then return private.fail('자녀(수강 ID)를 한 명 이상 골라주세요.'); end if;
  insert into public.parents (kakao_user, name, kakao_name) values (r.user_id, r.name, r.kakao_name)
  on conflict (kakao_user) do update set name = excluded.name, kakao_name = excluded.kakao_name
  returning id into pid;
  insert into public.parent_links (parent_id, member_id)
  select pid, id from public.members where id = any (p_members)
  on conflict do nothing;
  update public.parent_requests set status = '승인', parent_id = pid, decided_at = now() where id = r.id;
  return jsonb_build_object('ok', true, 'parent', pid, 'children', n);
end $$;

revoke all on function public.parent_me(), public.parent_request(text, text), public.parent_child(text),
  public.parent_messages(), public.parent_message_read(bigint[]), public.admin_parent_decide(bigint, text[], boolean) from public, anon;
grant execute on function public.parent_me(), public.parent_request(text, text), public.parent_child(text),
  public.parent_messages(), public.parent_message_read(bigint[]), public.admin_parent_decide(bigint, text[], boolean) to authenticated;
revoke all on function private.my_parent() from public, anon;
-- ---------------------------------------------------------------- 마이그레이션 leesh_teacher_inbox (2026-11-05)
-- 선생님 → 학원(원장님 · 실장님) 메시지 (원장님 2026-11-05 "선생님이 관리자에게 보낼 수 있도록. 학생은 보내는 거 없음").
-- 선생님 화면에서 보내고, 관리자 → 메시지 탭 맨 위 "선생님이 보낸 메시지"에서 읽음 · 답장(= 그 선생님에게 messages).
create table if not exists public.admin_inbox (
  id         bigint generated always as identity primary key,
  teacher_id bigint not null references public.teachers (id) on delete cascade,
  body       text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists admin_inbox_teacher_idx on public.admin_inbox (teacher_id, created_at desc);
alter table public.admin_inbox enable row level security;
drop policy if exists admin_all on public.admin_inbox;
create policy admin_all on public.admin_inbox for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.admin_inbox from anon;
grant select, insert, update, delete on public.admin_inbox to authenticated;
grant usage, select on all sequences in schema public to authenticated;

create or replace function public.teacher_send(p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.teachers := private.my_teacher();
  v text := trim(coalesce(p_body, ''));
  n int;
begin
  if t.id is null then return private.fail('선생님 연결이 필요해요.'); end if;
  if char_length(v) < 1 then return private.fail('보낼 내용을 적어주세요.'); end if;
  if char_length(v) > 2000 then return private.fail('2000자까지 보낼 수 있어요.'); end if;
  select count(*) into n from public.admin_inbox where teacher_id = t.id and created_at > now() - interval '1 day';
  if n >= 30 then return private.fail('하루에 30개까지 보낼 수 있어요. 급한 일은 전화로 연락해 주세요.'); end if;
  insert into public.admin_inbox (teacher_id, body) values (t.id, v);
  -- 알림에는 내용을 넣지 않아요 (학생 이야기가 들어갈 수 있어서)
  perform private.notify('✉ ' || t.name || ' 선생님이 메시지를 보냈어요. 관리자 → 메시지에서 확인해 주세요.');
  return jsonb_build_object('ok', true);
end $$;

-- 선생님: 받은 메시지 + 내가 보낸 메시지 (읽었는지)
create or replace function public.teacher_messages() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.teachers := private.my_teacher();
begin
  if t.id is null then return private.fail('선생님 연결이 필요해요.'); end if;
  return jsonb_build_object('ok', true,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'sender', m.sender, 'body', m.body, 'at', m.created_at, 'read', m.read_at is not null)
             order by m.created_at desc)
      from (select * from public.messages where to_teacher = t.id order by created_at desc limit 50) m), '[]'::jsonb),
    'sent', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'body', x.body, 'at', x.created_at, 'read', x.read_at is not null)
             order by x.created_at desc)
      from (select * from public.admin_inbox where teacher_id = t.id order by created_at desc limit 50) x), '[]'::jsonb));
end $$;

revoke all on function public.teacher_send(text) from public, anon;
grant execute on function public.teacher_send(text) to authenticated;
-- ---------------------------------------------------------------- 마이그레이션 leesh_visit_notify_once (2026-11-05)
-- 내방 오디션 신청: 텔레그램 알림은 처음 신청할 때만 (같은 오디션을 고쳐서 다시 보내면 알림 없음)
CREATE OR REPLACE FUNCTION public.member_visit_apply(p_id text, p_pin text, p_news bigint, p_name text, p_gender text DEFAULT NULL::text, p_birth text DEFAULT NULL::text, p_size text DEFAULT NULL::text, p_field text DEFAULT NULL::text, p_music jsonb DEFAULT NULL::jsonb, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  is_new boolean;
  who jsonb := private.check_ready(p_id, p_pin);
  mid text;
  n public.audition_news;
  today date := private.now_kst()::date;
  v_name text := trim(coalesce(p_name, ''));
  app_id bigint;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  select * into n from public.audition_news where id = p_news and kind = '내방' and published;
  if n.id is null then return private.fail('신청할 오디션을 찾을 수 없어요.'); end if;
  if coalesce(n.deadline, n.event_date) is not null and coalesce(n.deadline, n.event_date) < today then
    return private.fail('신청이 마감됐어요. 학원에 문의해주세요.');
  end if;
  if v_name = '' or char_length(v_name) > 30 then return private.fail('이름을 적어주세요.'); end if;
  if p_gender is not null and p_gender not in ('남', '여') then return private.fail('성별을 골라주세요.'); end if;
  if p_field is null or p_field not in ('보컬', '랩', '댄스', '라이브퍼포먼스', '연기') then return private.fail('지원분야를 하나 골라주세요.'); end if;
  if char_length(coalesce(p_birth, '')) > 30 or char_length(coalesce(p_size, '')) > 30 or char_length(coalesce(p_note, '')) > 1000 then
    return private.fail('글이 너무 길어요.');
  end if;
  if p_music is not null and coalesce(p_music ->> 'path', '') not like mid || '/%' then return private.fail('음원을 다시 올려주세요.'); end if;
  insert into public.visit_applications (news_id, audition, member_id, name, gender, birth, body_size, field, music, note)
  values (n.id, left(coalesce(n.company || ' ', '') || n.title, 120), mid, v_name, p_gender,
          nullif(trim(coalesce(p_birth, '')), ''), nullif(trim(coalesce(p_size, '')), ''), p_field, p_music,
          nullif(trim(coalesce(p_note, '')), ''))
  on conflict (news_id, member_id) do update set name = excluded.name, gender = excluded.gender, birth = excluded.birth,
    body_size = excluded.body_size, field = excluded.field, music = coalesce(excluded.music, public.visit_applications.music),
    note = excluded.note, updated_at = now()
  returning id, (xmax = 0) into app_id, is_new;
  -- 알림은 처음 신청할 때만 (원장님 2026-11-05: 한 명이 고쳐서 3번 보내 텔레그램이 3번 옴)
  if is_new then perform private.notify('🎤 내방 오디션 신청: ' || v_name || ' · ' || p_field || chr(10) || coalesce(n.company || ' ', '') || n.title); end if;
  return jsonb_build_object('ok', true, 'id', app_id, 'new', is_new);
end $function$;
-- ---------------------------------------------------------------- 마이그레이션 leesh_notify_digest (2026-11-05)
-- 텔레그램: 연습실 예약 · 취소와 내방 오디션 신청은 바로 보내지 않고 모아서 1시간에 한 번 (원장님 2026-11-05 "매 건 받으면 정신없음").
-- 카카오 연결 요청 · 선생님 · 학부모 요청 · 상담 · 노래 추천 · 제휴 · 선생님 메시지는 지금처럼 바로.
create table if not exists private.notify_queue (
  id         bigint generated always as identity primary key,
  msg        text not null,
  created_at timestamptz not null default now()
);
revoke all on private.notify_queue from public, anon, authenticated;

-- 실제로 보내기 (예전 private.notify 내용 그대로)
create or replace function private.notify_send(msg text) returns void
language plpgsql security definer set search_path = '' as $$
declare t record; c text;
begin
  select bot_token, chat_ids into t from private.telegram where id = 1;
  if coalesce(t.bot_token, '') = '' or cardinality(t.chat_ids) = 0 then return; end if;
  foreach c in array t.chat_ids loop
    begin
      perform net.http_post(url := 'https://api.telegram.org/bot' || t.bot_token || '/sendMessage', timeout_milliseconds := 15000,
        body := jsonb_build_object('chat_id', c, 'text', msg || chr(10) || chr(10) || '👉 https://leeshlesson.com/admin.html',
                                   'disable_web_page_preview', true));
    exception when others then
      null; -- 알림 실패가 신청을 막으면 안 됩니다
    end;
  end loop;
end $$;

create or replace function private.notify(msg text) returns void
language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  select bot_token, chat_ids, bookings into t from private.telegram where id = 1;
  if coalesce(t.bot_token, '') = '' or cardinality(t.chat_ids) = 0 then return; end if;
  if msg like '🎤 연습실%' or msg like '↩️ 연습실%' then
    if not t.bookings then return; end if;
    insert into private.notify_queue (msg) values (msg);   -- 1시간 모아서
    return;
  end if;
  if msg like '🎤 내방 오디션%' then
    insert into private.notify_queue (msg) values (msg);   -- 1시간 모아서
    return;
  end if;
  perform private.notify_send(msg);
exception when others then
  null; -- 알림 때문에 신청이 실패하면 안 됩니다
end $$;

-- 모아 둔 것 보내기 (매시 정각, pg_cron leesh_notify_digest)
create or replace function private.notify_digest() returns void
language plpgsql security definer set search_path = '' as $$
declare
  ids bigint[];
  n int;
  lines text;
  txt text;
begin
  -- 같은 때 두 번 돌지 않게
  if not pg_try_advisory_xact_lock(hashtext('leesh_notify_digest')) then return; end if;
  select array_agg(id order by id), count(*) into ids, n from private.notify_queue;
  if coalesce(n, 0) = 0 then return; end if;
  select string_agg('• ' || to_char(q.created_at at time zone 'Asia/Seoul', 'HH24:MI') || ' ' || replace(q.msg, chr(10), ' · '), chr(10) order by q.id)
    into lines
    from (select * from private.notify_queue where id = any (ids) order by id limit 40) q;
  txt := '⏰ 지난 1시간 알림 ' || n || '건 (연습실 예약 · 내방 오디션)' || chr(10) || chr(10) || lines
         || case when n > 40 then chr(10) || '… 외 ' || (n - 40) || '건 (관리자 화면에서 확인)' else '' end;
  perform private.notify_send(left(txt, 3800));
  delete from private.notify_queue where id = any (ids);
end $$;

revoke all on function private.notify_send(text), private.notify_digest() from public, anon, authenticated;

select cron.unschedule('leesh_notify_digest') where exists (select 1 from cron.job where jobname = 'leesh_notify_digest');
select cron.schedule('leesh_notify_digest', '0 * * * *', 'select private.notify_digest()');
-- ---------------------------------------------------------------- 마이그레이션 leesh_grid_align (2026-11-05)
-- 시트 칸 정렬 (선생님 의견 "가운데 정렬, 스프레드시트처럼"): 서식 키 a(가로 l/c/r) · va(세로 t/m/b) 허락
CREATE OR REPLACE FUNCTION private.sheet_ok(s jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare k text; v jsonb; sk text; sv jsonb;
begin
  if s is null then return true; end if;
  if jsonb_typeof(s) <> 'object' or octet_length(s::text) > 400000 then return false; end if;
  for k in select jsonb_object_keys(s) loop
    if k not in ('v', 'n', 'w', 'h', 'c') then return false; end if;
  end loop;
  if s ? 'v' and jsonb_typeof(s -> 'v') <> 'number' then return false; end if;
  if s ? 'n' and (jsonb_typeof(s -> 'n') <> 'number' or (s ->> 'n')::numeric > 1000 or (s ->> 'n')::numeric < 1) then return false; end if;
  if jsonb_typeof(coalesce(s -> 'w', '{}')) <> 'object' or jsonb_typeof(coalesce(s -> 'h', '{}')) <> 'object'
     or jsonb_typeof(coalesce(s -> 'c', '{}')) <> 'object' then return false; end if;
  for k, v in select key, value from jsonb_each(coalesce(s -> 'w', '{}')) loop
    if k !~ '^\d{1,2}$' or k::int > 25 or jsonb_typeof(v) <> 'number' or v::numeric < 20 or v::numeric > 1500 then return false; end if;
  end loop;
  for k, v in select key, value from jsonb_each(coalesce(s -> 'h', '{}')) loop
    if k !~ '^\d{1,3}$' or jsonb_typeof(v) <> 'number' or v::numeric < 12 or v::numeric > 1500 then return false; end if;
  end loop;
  for k, v in select key, value from jsonb_each(coalesce(s -> 'c', '{}')) loop
    if k !~ '^\d{1,3},\d{1,2}$' or split_part(k, ',', 2)::int > 25 or jsonb_typeof(v) <> 'object' then return false; end if;
    for sk in select jsonb_object_keys(v) loop
      if sk not in ('t', 's') then return false; end if;
    end loop;
    if v ? 't' and (jsonb_typeof(v -> 't') <> 'string' or char_length(v ->> 't') > 40000 or not private.rich_ok(v ->> 't')
                    or char_length(private.rich_text(v ->> 't')) > 5000) then return false; end if;
    if jsonb_typeof(coalesce(v -> 's', '{}')) <> 'object' then return false; end if;
    for sk, sv in select key, value from jsonb_each(coalesce(v -> 's', '{}')) loop
      if sk in ('b', 'i', 'u', 'x', 'wr') then
        if jsonb_typeof(sv) not in ('number', 'boolean') then return false; end if;
      elsif sk = 'a' then
        if jsonb_typeof(sv) <> 'string' or (sv #>> '{}') not in ('l', 'c', 'r') then return false; end if;
      elsif sk = 'va' then
        if jsonb_typeof(sv) <> 'string' or (sv #>> '{}') not in ('t', 'm', 'b') then return false; end if;
      elsif sk = 'z' then
        if jsonb_typeof(sv) <> 'number' or sv::numeric < 8 or sv::numeric > 48 then return false; end if;
      elsif sk in ('f', 'g') then
        if jsonb_typeof(sv) <> 'string' or (sv #>> '{}') !~* '^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[0-9.]+\s*)?\))$' then return false; end if;
      else
        return false;
      end if;
    end loop;
  end loop;
  return true;
end $function$;
-- ---------------------------------------------------------------- 마이그레이션 leesh_visit_close_day_before (2026-11-06)
-- 내방 오디션 신청서: 마감일을 따로 안 적었으면 오디션 하루 전까지 (원장님 2026-11-06 "1일 전에 닫히는 걸로").
-- 예전엔 오디션 당일까지 열려 있었음. 마감일을 적은 오디션은 그 날짜 그대로.
CREATE OR REPLACE FUNCTION public.member_visit_open(p_id text, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  mid text;
  today date := private.now_kst()::date;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  return jsonb_build_object('ok', true, 'name', who ->> 'name', 'auditions', coalesce((
    select jsonb_agg(jsonb_build_object('id', n.id, 'company', n.company, 'title', n.title, 'date', n.event_date,
             'deadline', coalesce(n.deadline, n.event_date - 1), 'body', n.body, 'image', n.image,
             'mine', (select to_jsonb(a) - 'member_id' from public.visit_applications a where a.news_id = n.id and a.member_id = mid))
             order by n.event_date nulls last, n.id)
    from public.audition_news n
    where n.kind = '내방' and n.published and coalesce(n.deadline, n.event_date - 1, today) >= today
  ), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.member_visit_apply(p_id text, p_pin text, p_news bigint, p_name text, p_gender text DEFAULT NULL::text, p_birth text DEFAULT NULL::text, p_size text DEFAULT NULL::text, p_field text DEFAULT NULL::text, p_music jsonb DEFAULT NULL::jsonb, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  is_new boolean;
  who jsonb := private.check_ready(p_id, p_pin);
  mid text;
  n public.audition_news;
  today date := private.now_kst()::date;
  v_name text := trim(coalesce(p_name, ''));
  app_id bigint;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  select * into n from public.audition_news where id = p_news and kind = '내방' and published;
  if n.id is null then return private.fail('신청할 오디션을 찾을 수 없어요.'); end if;
  if coalesce(n.deadline, n.event_date - 1) is not null and coalesce(n.deadline, n.event_date - 1) < today then
    return private.fail('신청이 마감됐어요. 학원에 문의해주세요.');
  end if;
  if v_name = '' or char_length(v_name) > 30 then return private.fail('이름을 적어주세요.'); end if;
  if p_gender is not null and p_gender not in ('남', '여') then return private.fail('성별을 골라주세요.'); end if;
  if p_field is null or p_field not in ('보컬', '랩', '댄스', '라이브퍼포먼스', '연기') then return private.fail('지원분야를 하나 골라주세요.'); end if;
  if char_length(coalesce(p_birth, '')) > 30 or char_length(coalesce(p_size, '')) > 30 or char_length(coalesce(p_note, '')) > 1000 then
    return private.fail('글이 너무 길어요.');
  end if;
  if p_music is not null and coalesce(p_music ->> 'path', '') not like mid || '/%' then return private.fail('음원을 다시 올려주세요.'); end if;
  insert into public.visit_applications (news_id, audition, member_id, name, gender, birth, body_size, field, music, note)
  values (n.id, left(coalesce(n.company || ' ', '') || n.title, 120), mid, v_name, p_gender,
          nullif(trim(coalesce(p_birth, '')), ''), nullif(trim(coalesce(p_size, '')), ''), p_field, p_music,
          nullif(trim(coalesce(p_note, '')), ''))
  on conflict (news_id, member_id) do update set name = excluded.name, gender = excluded.gender, birth = excluded.birth,
    body_size = excluded.body_size, field = excluded.field, music = coalesce(excluded.music, public.visit_applications.music),
    note = excluded.note, updated_at = now()
  returning id, (xmax = 0) into app_id, is_new;
  -- 알림은 처음 신청할 때만 (원장님 2026-11-05: 한 명이 고쳐서 3번 보내 텔레그램이 3번 옴)
  if is_new then perform private.notify('🎤 내방 오디션 신청: ' || v_name || ' · ' || p_field || chr(10) || coalesce(n.company || ' ', '') || n.title); end if;
  return jsonb_build_object('ok', true, 'id', app_id, 'new', is_new);
end $function$;

-- ---------------------------------------------------------------- 마이그레이션 leesh_room_wifi (2026-11-06)
-- 연습실 와이파이 (원장님 2026-11-06, 블로그 서로이웃 공지 "연습실 공지사항 (예약방법/WI-FI)"). 저장소가 공개라
-- 비밀번호는 DB에만 넣고(이 파일엔 없음), 로그인한 수강생에게만 member_wifi로 보여줌 (내 폴더 → 일정·공지).
-- 학부모 화면 · 공개 페이지에는 안 나옴. 바꿀 때: update private.room_wifi set pass = '…' where name = '…';
create table if not exists private.room_wifi (
  sort int primary key,
  name text not null check (char_length(name) <= 60),
  pass text not null check (char_length(pass) <= 100)
);
revoke all on private.room_wifi from public, anon, authenticated;

create or replace function public.member_wifi(p_id text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare who jsonb := private.check_ready(p_id, p_pin);
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  return jsonb_build_object('ok', true, 'wifi', coalesce((
    select jsonb_agg(jsonb_build_object('name', w.name, 'pass', w.pass) order by w.sort) from private.room_wifi w), '[]'::jsonb));
end $$;
revoke execute on function public.member_wifi(text, text) from public;
grant execute on function public.member_wifi(text, text) to anon, authenticated;

-- ---------------------------------------------------------------- 마이그레이션 leesh_room_door (2026-11-06)
-- 연습실 비밀번호 (블로그 서로이웃 공지 "매월 연습실 비밀번호 변경 공지": 매월 초 1~5일에 바꿈). 저장소가 공개라 값은 DB에만.
-- 관리자 → 설정 → "연습실 비밀번호"에서 바꾸고, 로그인한 수강생만 내 폴더 → 일정·공지에서 봄 (member_wifi의 door).
create table if not exists private.room_door (
  id         int primary key default 1 check (id = 1),
  pass       text not null check (char_length(pass) between 1 and 40),
  changed_on date not null,
  updated_at timestamptz not null default now()
);
revoke all on private.room_door from public, anon, authenticated;

create or replace function public.member_wifi(p_id text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare who jsonb := private.check_ready(p_id, p_pin);
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  return jsonb_build_object('ok', true,
    'wifi', coalesce((select jsonb_agg(jsonb_build_object('name', w.name, 'pass', w.pass) order by w.sort) from private.room_wifi w), '[]'::jsonb),
    'door', (select jsonb_build_object('pass', d.pass, 'changed_on', d.changed_on) from private.room_door d where d.id = 1));
end $$;

create or replace function public.admin_room_door() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 볼 수 있어요.'); end if;
  return jsonb_build_object('ok', true,
    'door', (select jsonb_build_object('pass', d.pass, 'changed_on', d.changed_on) from private.room_door d where d.id = 1));
end $$;

create or replace function public.admin_room_door_set(p_pass text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v text := btrim(coalesce(p_pass, ''));
begin
  if not public.is_admin() then return private.fail('관리자만 바꿀 수 있어요.'); end if;
  if v = '' or char_length(v) > 40 then return private.fail('비밀번호를 적어주세요.'); end if;
  insert into private.room_door (id, pass, changed_on, updated_at) values (1, v, private.now_kst()::date, now())
  on conflict (id) do update set pass = excluded.pass, changed_on = excluded.changed_on, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.admin_room_door(), public.admin_room_door_set(text) from public, anon;
grant execute on function public.admin_room_door(), public.admin_room_door_set(text) to authenticated;

-- ---------------------------------------------------------------- 마이그레이션 leesh_room_door_remove (2026-11-06)
-- 원장님 2026-11-06: 연습실 비밀번호는 따로 칸 없이 그냥 일정·공지 글로 (비밀번호 바꿀 때 공지도 고침) → leesh_room_door 되돌림.
create or replace function public.member_wifi(p_id text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare who jsonb := private.check_ready(p_id, p_pin);
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  return jsonb_build_object('ok', true, 'wifi', coalesce((
    select jsonb_agg(jsonb_build_object('name', w.name, 'pass', w.pass) order by w.sort) from private.room_wifi w), '[]'::jsonb));
end $$;
drop function if exists public.admin_room_door();
drop function if exists public.admin_room_door_set(text);
drop table if exists private.room_door;

-- ---------------------------------------------------------------- 마이그레이션 leesh_parent_wifi (2026-11-06)
-- 원장님 2026-11-06 "공지사항은 모두 학부모도 볼 수 있게": 학부모 화면 일정·공지에도 연습실 안내(와이파이 포함).
create or replace function public.parent_wifi() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.parents := private.my_parent();
begin
  if auth.uid() is null then return private.fail('카카오 로그인이 필요해요.'); end if;
  if p.id is null then return private.fail('학원에서 확인한 뒤에 볼 수 있어요.'); end if;
  return jsonb_build_object('ok', true, 'wifi', coalesce((
    select jsonb_agg(jsonb_build_object('name', w.name, 'pass', w.pass) order by w.sort) from private.room_wifi w), '[]'::jsonb));
end $$;
revoke execute on function public.parent_wifi() from public, anon;
grant execute on function public.parent_wifi() to authenticated;

-- ---------------------------------------------------------------- 마이그레이션 leesh_visit_last (2026-11-06)
-- 내방 오디션 신청서: 지난번에 쓴 내용(이름 · 성별 · 출생년도/나이 · 키/몸무게 · 지원분야)을 다음 신청서에 미리 채움
-- (원장님 2026-11-06 "매번 같은 내용으로 접수하니 적혀 있으면 좋겠다"). 특이사항 · 음원은 오디션마다 달라서 안 채움.
create or replace function public.member_visit_open(p_id text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  mid text;
  today date := private.now_kst()::date;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  return jsonb_build_object('ok', true, 'name', who ->> 'name',
    'last', (select jsonb_build_object('name', a.name, 'gender', a.gender, 'birth', a.birth, 'body_size', a.body_size, 'field', a.field)
             from public.visit_applications a where a.member_id = mid order by a.updated_at desc nulls last, a.id desc limit 1),
    'auditions', coalesce((
    select jsonb_agg(jsonb_build_object('id', n.id, 'company', n.company, 'title', n.title, 'date', n.event_date,
             'deadline', coalesce(n.deadline, n.event_date - 1), 'body', n.body, 'image', n.image,
             'mine', (select to_jsonb(a) - 'member_id' from public.visit_applications a where a.news_id = n.id and a.member_id = mid))
             order by n.event_date nulls last, n.id)
    from public.audition_news n
    where n.kind = '내방' and n.published and coalesce(n.deadline, n.event_date - 1, today) >= today
  ), '[]'::jsonb));
end $$;


-- ---------------------------------------------------------------- 마이그레이션 leesh_lesson_photos (2026-11-07)
-- 레슨 노트 · 곡·자료 시트에 사진 붙이기 (원장님 2026-11-07 "사진 올리기 가능하게", 선생님 의견).
-- 담당 선생님(원장님 포함)이 올리고 지움. 레슨 노트 사진은 그 학생도 봄 (settings.student_notes가 켜져 있을 때), 곡·자료 사진은 선생님 · 관리자만.
-- 비공개 보관함 lesson-photos/<수강 ID>/<이름>.webp (화면이 1600px WebP로 줄여서 올림), 한 시트에 30장까지. 자동 삭제 없음.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lesson-photos', 'lesson-photos', false, 3145728, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create table if not exists public.lesson_photos (
  id bigserial primary key,
  member_id text not null references public.members(id) on delete cascade,
  note_id bigint references public.lesson_notes(id) on delete cascade,
  sheet_id bigint references public.lesson_sheets(id) on delete cascade,
  teacher_id bigint references public.teachers(id) on delete set null,
  path text not null unique,
  w int, h int,
  created_at timestamptz not null default now(),
  constraint lesson_photos_one_ref check ((note_id is null) <> (sheet_id is null)),
  constraint lesson_photos_path check (path ~ '^[A-Z0-9_-]{2,20}/[a-z0-9]{8,40}\.(webp|jpg|png)$' and split_part(path, '/', 1) = member_id)
);
create index if not exists lesson_photos_member on public.lesson_photos (member_id);
alter table public.lesson_photos enable row level security;
drop policy if exists lesson_photos_admin on public.lesson_photos;
create policy lesson_photos_admin on public.lesson_photos for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 보관함 권한: 선생님은 담당 학생 폴더 (올리기 · 보기 · 지우기), 학생은 자기 레슨 노트 사진만 보기
create or replace function private.photo_teacher(p_name text) returns boolean
language sql stable security definer set search_path = public, private as $$
  select private.teaches(private.my_teacher(), split_part(p_name, '/', 1));
$$;
create or replace function private.photo_student(p_name text) returns boolean
language sql stable security definer set search_path = public, private as $$
  select coalesce((select st.student_notes from public.settings st where st.id = 1), false)
     and exists (select 1 from public.lesson_photos p
                 where p.path = p_name and p.note_id is not null and p.member_id = private.song_owner());
$$;
revoke all on function private.photo_teacher(text) from public;
revoke all on function private.photo_student(text) from public;
grant execute on function private.photo_teacher(text) to authenticated;
grant execute on function private.photo_student(text) to authenticated;

drop policy if exists lesson_photos_admin on storage.objects;
create policy lesson_photos_admin on storage.objects for all to authenticated
  using (bucket_id = 'lesson-photos' and public.is_admin()) with check (bucket_id = 'lesson-photos' and public.is_admin());
drop policy if exists lesson_photos_teacher_add on storage.objects;
create policy lesson_photos_teacher_add on storage.objects for insert to authenticated
  with check (bucket_id = 'lesson-photos' and private.photo_teacher(name));
drop policy if exists lesson_photos_teacher_read on storage.objects;
create policy lesson_photos_teacher_read on storage.objects for select to authenticated
  using (bucket_id = 'lesson-photos' and private.photo_teacher(name));
drop policy if exists lesson_photos_teacher_remove on storage.objects;
create policy lesson_photos_teacher_remove on storage.objects for delete to authenticated
  using (bucket_id = 'lesson-photos' and private.photo_teacher(name));
drop policy if exists lesson_photos_student_read on storage.objects;
create policy lesson_photos_student_read on storage.objects for select to authenticated
  using (bucket_id = 'lesson-photos' and private.photo_student(name));

-- 백업 계정도 읽기 (backup.gs가 "레슨 사진" 폴더로)
drop policy if exists backup_file_read on storage.objects;
create policy backup_file_read on storage.objects for select to authenticated
  using (bucket_id = any (array['eval-reports', 'song-recordings', 'visit-music', 'lesson-photos']) and public.backup_file_reader());

-- 사진 붙이기: 올린 파일을 일지 · 곡·자료 한 장에 이어요
create or replace function public.teacher_photo_add(p_member text, p_note bigint, p_sheet bigint, p_path text, p_w int, p_h int)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare t public.teachers := private.my_teacher(); n int; v_id bigint;
begin
  if t.id is null then return private.fail('선생님으로 연결된 계정만 할 수 있어요.'); end if;
  if not private.teaches(t, p_member) then return private.fail('담당 학생에게만 사진을 올릴 수 있어요.'); end if;
  if (p_note is null) = (p_sheet is null) then return private.fail('사진을 붙일 시트를 골라주세요.'); end if;
  if p_note is not null and not exists (select 1 from public.lesson_notes where id = p_note and member_id = p_member) then return private.fail('일지를 찾을 수 없어요.'); end if;
  if p_sheet is not null and not exists (select 1 from public.lesson_sheets where id = p_sheet and member_id = p_member) then return private.fail('시트를 찾을 수 없어요.'); end if;
  if coalesce(p_path, '') !~ ('^' || p_member || '/[a-z0-9]{8,40}\.(webp|jpg|png)$') then return private.fail('사진 이름이 올바르지 않아요.'); end if;
  if not exists (select 1 from storage.objects where bucket_id = 'lesson-photos' and name = p_path) then return private.fail('사진이 아직 올라가지 않았어요. 다시 해주세요.'); end if;
  select count(*) into n from public.lesson_photos where coalesce(note_id, -1) = coalesce(p_note, -1) and coalesce(sheet_id, -1) = coalesce(p_sheet, -1);
  if n >= 30 then return private.fail('한 시트에 사진은 30장까지예요.'); end if;
  insert into public.lesson_photos (member_id, note_id, sheet_id, teacher_id, path, w, h)
  values (p_member, p_note, p_sheet, t.id, p_path, least(greatest(coalesce(p_w, 0), 0), 10000), least(greatest(coalesce(p_h, 0), 0), 10000))
  on conflict (path) do nothing
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.teacher_photo_delete(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare t public.teachers := private.my_teacher(); p public.lesson_photos;
begin
  if t.id is null then return private.fail('선생님으로 연결된 계정만 할 수 있어요.'); end if;
  select * into p from public.lesson_photos where id = p_id;
  if p.id is null or not private.teaches(t, p.member_id) then return private.fail('담당 학생 사진만 지울 수 있어요.'); end if;
  delete from public.lesson_photos where id = p.id;
  return jsonb_build_object('ok', true, 'path', p.path);
end $$;

create or replace function public.teacher_photos(p_member text)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare t public.teachers := private.my_teacher();
begin
  if t.id is null then return private.fail('선생님으로 연결된 계정만 볼 수 있어요.'); end if;
  if not private.teaches(t, p_member) then return private.fail('담당 학생만 볼 수 있어요.'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'note', p.note_id, 'sheet', p.sheet_id, 'path', p.path, 'w', p.w, 'h', p.h, 'at', p.created_at,
             'by', (select x.name from public.teachers x where x.id = p.teacher_id)) order by p.created_at)
    from public.lesson_photos p where p.member_id = p_member), '[]'::jsonb));
end $$;

create or replace function public.member_photos(p_id text, p_pin text)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare who jsonb := private.check_ready(p_id, p_pin);
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  if not coalesce((select st.student_notes from public.settings st where st.id = 1), false) then return jsonb_build_object('ok', true, 'items', '[]'::jsonb); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'note', p.note_id, 'path', p.path, 'w', p.w, 'h', p.h) order by p.created_at)
    from public.lesson_photos p where p.member_id = who ->> 'id' and p.note_id is not null), '[]'::jsonb));
end $$;

revoke all on function public.teacher_photo_add(text, bigint, bigint, text, int, int) from public, anon;
revoke all on function public.teacher_photo_delete(bigint) from public, anon;
revoke all on function public.teacher_photos(text) from public, anon;
grant execute on function public.teacher_photo_add(text, bigint, bigint, text, int, int) to authenticated;
grant execute on function public.teacher_photo_delete(bigint) to authenticated;
grant execute on function public.teacher_photos(text) to authenticated;
grant execute on function public.member_photos(text, text) to anon, authenticated;

-- 백업 파일 목록에 레슨 사진도
CREATE OR REPLACE FUNCTION public.backup_files(p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s private.backup_sync;
begin
  if not private.backup_key_ok(p_key) then return private.fail('연결 열쇠가 맞지 않아요.'); end if;
  if auth.uid() is null then return private.fail('백업용 계정으로 로그인해서 불러야 해요.'); end if;
  select * into s from private.backup_sync where id = 1 for update;
  if s.file_uid is null then
    if public.is_admin() or exists (select 1 from public.members m where m.kakao_user = auth.uid()) then
      return private.fail('관리자 · 학생 계정은 백업용으로 쓸 수 없어요. 백업용 계정을 따로 만들어주세요.');
    end if;
    update private.backup_sync set file_uid = auth.uid() where id = 1;
  elsif s.file_uid <> auth.uid() then
    return private.fail('이미 다른 백업용 계정이 연결돼 있어요. 관리자 → 설정 → "다시 연결하기" 뒤에 해주세요.');
  end if;
  return jsonb_build_object('ok', true, 'files', coalesce((
    select jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'name', o.name, 'size', (o.metadata ->> 'size')::bigint,
      'updated', coalesce(o.updated_at, o.created_at), 'public', b.public,
      'who', (select m.id || ' ' || m.name from public.members m where m.id = split_part(o.name, '/', 1)))
      order by o.bucket_id, o.name)
    from storage.objects o join storage.buckets b on b.id = o.bucket_id
    where o.bucket_id in ('eval-reports', 'song-recordings', 'visit-music', 'audition-news', 'lesson-photos')), '[]'::jsonb));
end $function$;

-- leesh_lesson_photos_grant

grant select, insert, update, delete on public.lesson_photos to authenticated; grant usage, select on sequence public.lesson_photos_id_seq to authenticated;
-- leesh_notebook_note_id (2026-11-07): 학생 레슨 노트에 일지 번호 (레슨 사진을 그 일지 아래에 붙이려고)
CREATE OR REPLACE FUNCTION public.member_notebook(p_id text, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  mid text;
  today date := private.now_kst()::date;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  return private.with_token(who, jsonb_build_object(
    'ok', true,
    'id', mid,
    'name', who ->> 'name',
    -- 레슨 노트는 settings.student_notes가 켜져 있을 때만 학생에게 (원장님 2026-10-29: 선생님들과 얘기 끝날 때까지 숨김)
    'notes', case when not coalesce((select st.student_notes from public.settings st where st.id = 1), false) then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'date', n.lesson_date, 'teacher', n.teacher, 'did', n.did, 'practice', n.practice,
        'songs', n.songs, 'audition', n.audition, 'recommend', n.recommend, 'rich', n.rich, 'sheet', n.sheet   -- 선생님 메모(memo)는 학생에게 안 보냄
      ) order by n.lesson_date desc, n.id desc)
      from (select * from public.lesson_notes where member_id = mid
            order by lesson_date desc, id desc limit 30) n
    ), '[]'::jsonb) end,
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'month', to_char(r.month, 'YYYY-MM'), 'pages', r.pages, 'song', r.song, 'teacher', r.teacher,
        'basic', r.basic, 'technique', r.technique, 'acting', r.acting, 'styling', r.styling,
        'total', r.total, 'stage', r.stage
      ) order by r.month desc)
      from (select * from public.eval_reports where member_id = mid order by month desc limit 12) r
    ), '[]'::jsonb),
    -- 내 예약: 오늘부터의 예약 + 이번 달 연습실 이용
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object('room', rm.name, 'date', b.day,
               'start', private.hhmm(b.start_min), 'end', private.hhmm(b.end_min)) order by b.day, b.start_min)
      from public.bookings b join public.rooms rm on rm.id = b.room_id
      where b.member_id = mid and b.status = '확정' and b.day >= today
    ), '[]'::jsonb),
    'month', (select jsonb_build_object('count', count(*), 'minutes', coalesce(sum(b.end_min - b.start_min), 0))
              from public.bookings b
              where b.member_id = mid and b.status = '확정' and b.day >= date_trunc('month', today)::date and b.day <= today),
    -- 공지 + 다가오는 학원 내방 오디션
    'notices', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body, 'start', n.start_date,
               'end', n.end_date, 'pinned', n.pinned, 'at', n.created_at) order by n.pinned desc, coalesce(n.start_date, n.created_at::date) desc)
      from (select * from public.notices where published and (end_date is null or end_date >= today)
            order by pinned desc, created_at desc limit 20) n
    ), '[]'::jsonb),
    'visits', coalesce((
      select jsonb_agg(jsonb_build_object('title', a.title, 'company', a.company, 'date', a.event_date, 'deadline', a.deadline)
               order by a.event_date)
      from (select * from public.audition_news where published and kind = '내방' and event_date >= today
            order by event_date limit 6) a
    ), '[]'::jsonb),
    'repertoire', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'artist', r.artist, 'purpose', r.purpose,
               'status', r.status, 'memo', r.memo,
               'minutes', (select coalesce(sum(l.minutes), 0) from public.practice_logs l where l.member_id = mid and l.song = r.title))
               order by (r.status = '준비 중') desc, r.updated_at desc)
      from public.repertoire r where r.member_id = mid
    ), '[]'::jsonb),
    'logs', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'day', l.day, 'minutes', l.minutes, 'song', l.song, 'did', l.did)
               order by l.day desc, l.id desc)
      from (select * from public.practice_logs where member_id = mid order by day desc, id desc limit 60) l
    ), '[]'::jsonb),
    -- 노래 추천 (원장님이 올린 것) + 아직 답을 못 받은 내 신청
    'recs', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'date', s.made_on, 'summary', s.summary, 'songs', s.songs, 'note', s.note)
               order by s.made_on desc, s.id desc)
      from (select * from public.song_recs where member_id = mid and published order by made_on desc, id desc limit 5) s
    ), '[]'::jsonb),
    'request', (select jsonb_build_object('at', q.created_at, 'likes', q.likes, 'goal', q.goal, 'memo', q.memo, 'files', q.files)
                from public.song_requests q where q.member_id = mid and q.status = '접수' order by q.id desc limit 1)
  ));
end $function$;

-- ---------------------------------------------------------------- 마이그레이션 leesh_lesson_import_ot (2026-11-09)
-- 선생님 구글시트의 OT 탭(생년월일 · 사는 곳 포함)도 "곡·자료"로 가져옴 (원장님 2026-11-08 결정 + 선생님 의견 2026-11-09).
-- 곡·자료는 담당 선생님 · 관리자만 보고, 휴대폰 번호는 "(전화번호 뺌)". 제목이 상담 · 등록 일지 · 신상 · 개인정보인 탭과
-- 개인정보가 든 날짜 탭(레슨 노트 = 학생도 봄)은 그대로 안 가져옴. 이미 가져온 파일도 다시 받도록 synced_modified를 비움.
CREATE OR REPLACE FUNCTION public.lesson_sync_push(p_key text, p_file text, p_notes jsonb DEFAULT '[]'::jsonb, p_sheets jsonb DEFAULT '[]'::jsonb, p_done boolean DEFAULT false, p_modified timestamp with time zone DEFAULT NULL::timestamp with time zone, p_ver integer DEFAULT 1, p_tabs jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.lesson_sources; t public.teachers; r jsonb; v_date date; v_tab bigint; v_sheet jsonb; ex public.lesson_notes;
  added int := 0; updated int := 0; kept int := 0; skipped int := 0; sh int := 0; bad int := 0; blocked int := 0;
begin
  if not private.lesson_key_ok(p_key) then return private.fail('연결 열쇠가 맞지 않아요.'); end if;
  select * into s from public.lesson_sources where file_id = p_file;
  if s.file_id is null or s.status <> 'ok' or s.member_id is null then return private.fail('확인된 학생 파일이 아니에요.'); end if;
  select * into t from public.teachers where id = s.teacher_id;
  if jsonb_typeof(coalesce(p_notes, '[]')) <> 'array' or jsonb_typeof(coalesce(p_sheets, '[]')) <> 'array' then return private.fail('보낸 내용이 이상해요.'); end if;

  for r in select * from jsonb_array_elements(coalesce(p_notes, '[]')) loop
    begin
      v_tab := (r ->> 'tab')::bigint; v_date := (r ->> 'date')::date; v_sheet := r -> 'sheet';
    exception when others then bad := bad + 1; continue; end;
    if v_tab is null or v_date is null or v_date < date '2026-01-01' or v_date > private.now_kst()::date + 400 then skipped := skipped + 1; continue; end if;
    if exists (select 1 from private.lesson_skip k where k.src_file = p_file and k.src_tab = v_tab) then skipped := skipped + 1; continue; end if;
    if private.lesson_private(v_sheet) then blocked := blocked + 1; continue; end if;
    v_sheet := private.mask_phone(v_sheet);
    if not private.sheet_ok(v_sheet) or trim(private.sheet_text(v_sheet)) = '' then bad := bad + 1; continue; end if;
    select * into ex from public.lesson_notes where src_file = p_file and src_tab = v_tab;
    if ex.id is null then
      insert into public.lesson_notes (member_id, lesson_date, teacher, teacher_id, rich, sheet, src_file, src_tab, src_title, synced_at)
      values (s.member_id, v_date, t.name, s.teacher_id, true, v_sheet, p_file, v_tab, left(r ->> 'title', 120), now());
      added := added + 1;
    elsif ex.site_edited then
      kept := kept + 1;
    else
      if ex.sheet is distinct from v_sheet or ex.lesson_date <> v_date or ex.member_id <> s.member_id then
        update public.lesson_notes set member_id = s.member_id, lesson_date = v_date, sheet = v_sheet, rich = true,
          teacher = coalesce(t.name, teacher), teacher_id = coalesce(s.teacher_id, teacher_id),
          src_title = left(r ->> 'title', 120), synced_at = now(), updated_at = now()
        where id = ex.id;
        updated := updated + 1;
      end if;
    end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_sheets, '[]')) loop
    begin
      v_tab := (r ->> 'tab')::bigint; v_sheet := r -> 'sheet';
    exception when others then bad := bad + 1; continue; end;
    if v_tab is null or coalesce(trim(r ->> 'title'), '') = '' or not private.sheet_ok(v_sheet) or trim(private.sheet_text(v_sheet)) = '' then
      bad := bad + 1; continue;
    end if;
    if trim(r ->> 'title') ~ '상담|등록 ?일지|신상|개인 ?정보' then
      delete from public.lesson_sheets where src_file = p_file and src_tab = v_tab and not site_edited;
      blocked := blocked + 1; continue;
    end if;
    -- OT처럼 생년월일 · 사는 곳이 적힌 탭도 곡·자료로 받음 (원장님 2026-11-08 "선생님이랑 관리자만 보면 됨", 선생님 의견 "OT 시트가 안 보여요").
    -- 곡·자료는 담당 선생님 · 관리자만 봄. 휴대폰 번호는 가림. 레슨 노트(학생도 봄)는 위에서 그대로 막음.
    if private.lesson_private(v_sheet) then v_sheet := private.mask_phone(v_sheet); end if;
    insert into public.lesson_sheets (member_id, teacher_id, src_file, src_tab, title, pos, sheet, synced_at)
    values (s.member_id, s.teacher_id, p_file, v_tab, left(trim(r ->> 'title'), 120), coalesce((r ->> 'pos')::int, 0), v_sheet, now())
    on conflict (src_file, src_tab) do update set member_id = excluded.member_id, teacher_id = excluded.teacher_id, title = excluded.title,
      pos = excluded.pos, sheet = excluded.sheet, synced_at = now()
    where not public.lesson_sheets.site_edited and (public.lesson_sheets.sheet is distinct from excluded.sheet or public.lesson_sheets.title is distinct from excluded.title
       or public.lesson_sheets.pos is distinct from excluded.pos or public.lesson_sheets.member_id is distinct from excluded.member_id);
    sh := sh + 1;
  end loop;

  if p_done then
    update public.lesson_sources set synced_modified = coalesce(p_modified, modified), synced_ver = p_ver, synced_at = now(),
      notes = (select count(*) from public.lesson_notes where src_file = p_file),
      sheets = (select count(*) from public.lesson_sheets where src_file = p_file),
      kept = (select count(*) from public.lesson_notes where src_file = p_file and site_edited),
      gone = case when jsonb_typeof(p_tabs) = 'array' then
        (select count(*) from public.lesson_notes n where n.src_file = p_file and not (p_tabs @> to_jsonb(n.src_tab)))
        + (select count(*) from public.lesson_sheets x where x.src_file = p_file and not (p_tabs @> to_jsonb(x.src_tab)))
        else gone end
    where file_id = p_file;
  end if;
  return jsonb_build_object('ok', true, 'added', added, 'updated', updated, 'kept', kept, 'skipped', skipped, 'sheets', sh, 'bad', bad, 'blocked', blocked);
end $function$;

update public.lesson_sources set synced_modified = null where status = 'ok' and folder <> '원장님 레슨 노트';
-- ---------------------------------------------------------------- 마이그레이션 leesh_lesson_dedupe (2026-11-09)
-- ① 원장님 레슨 노트 시트의 백업 사본(이름에 "원장님"+"레슨 노트"가 들어가서 스크립트가 같이 찾음)이 따로 들어와
--    같은 일지 · 곡·자료가 3번씩 보였음 → 진짜 시트 하나(private.lesson_sync.director_file, 값은 DB에만)만 받고 사본은 'ignore'.
-- ② 선생님 폴더 이름 "○○쌤 …"도 담당 선생님으로 알아봄 (최홍주 선생님 폴더 "홍주쌤 학생 시트지 공유").
alter table private.lesson_sync add column if not exists director_file text;
CREATE OR REPLACE FUNCTION private.lesson_match(p_file text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.lesson_sources;
  v_name text; v_tid bigint; v_tname text; n int; v_mid text; other text;
begin
  select * into s from public.lesson_sources where file_id = p_file for update;
  if s.file_id is null or s.set_by = 'admin' then return; end if;
  -- 원장님 레슨 노트의 백업 사본("…_백업_…", "…_재빌드전")은 안 가져옴 (2026-11-09: 사본까지 들어와 같은 일지가 3번씩 보였음)
  if s.folder = '원장님 레슨 노트' and coalesce((select director_file from private.lesson_sync where id = 1), '') <> ''
     and split_part(p_file, '_', 1) <> (select director_file from private.lesson_sync where id = 1) then
    update public.lesson_sources set status = 'ignore', member_id = null, why = '원장님 레슨 노트 백업 사본이라 안 가져와요' where file_id = p_file;
    return;
  end if;
  v_name := substring(s.title from '^\s*([가-힣]{2,4})');
  -- 원장님 레슨 노트 (시트 하나에 학생마다 탭 하나, 2026-11-04): 담당 = 원장님
  v_tid := case when s.folder = '원장님 레슨 노트' then (select min(id) from public.teachers where name = '원장님' and active)
               else private.folder_teacher(s.folder) end;
  select name into v_tname from public.teachers where id = v_tid;
  if v_name is null then
    update public.lesson_sources set status = 'pending', member_id = null, teacher_id = v_tid, why = '파일 이름에서 학생 이름을 못 찾았어요' where file_id = p_file;
    return;
  end if;
  if v_tid is null then
    select string_agg(m.id || ' ' || coalesce(substring(m.memo from '담당\s*([^\s·,]+)'), '담당 없음'), ', ') into other
    from public.members m where m.name = v_name and m.status in ('재원', '휴원');
    update public.lesson_sources set status = 'pending', member_id = null, teacher_id = null,
      why = '선생님 폴더 밖에 있어서 담당 선생님을 확인 못 했어요' || coalesce(' (명단: ' || other || ')', '') where file_id = p_file;
    return;
  end if;
  select count(*), min(m.id) into n, v_mid from public.members m
  where m.name = v_name and m.status in ('재원', '휴원') and substring(m.memo from '담당\s*([^\s·,]+)') = v_tname;
  if n = 1 then
    update public.lesson_sources set status = 'ok', member_id = v_mid, teacher_id = v_tid, why = null where file_id = p_file;
    return;
  end if;
  select string_agg(m.id || ' ' || m.status || ' ' || coalesce(substring(m.memo from '담당\s*([^\s·,]+)'), '담당 없음'), ', ') into other
  from public.members m where m.name = v_name;
  update public.lesson_sources set status = 'pending', member_id = null, teacher_id = v_tid,
    why = case when n > 1 then '이름·담당이 같은 학생이 ' || n || '명이에요'
               when other is null then '명단에 "' || v_name || '" 학생이 없어요'
               else '담당 선생님이 달라요 (폴더: ' || v_tname || ' / 명단: ' || other || ')' end
  where file_id = p_file;
end $function$;

create or replace function private.folder_teacher(p_folder text)
 returns bigint language sql stable security definer set search_path to '' as $function$
  select case when count(*) = 1 then min(t.id) end
  from public.teachers t
  where t.active and t.name <> '원장님' and coalesce(p_folder, '') <> ''
    and (position(t.name in replace(p_folder, ' ', '')) > 0
         or (char_length(t.name) = 3 and (position(substr(t.name, 2) || 'T' in replace(p_folder, ' ', '')) > 0
                                       or position(substr(t.name, 2) || '쌤' in replace(p_folder, ' ', '')) > 0)));
$function$;
-- ---------------------------------------------------------------- 마이그레이션 leesh_lesson_short_date (2026-11-09)
-- 탭 이름의 연도가 두 자리("26-10-31(1회차)")면 스크립트가 날짜 탭으로 못 알아보고 곡·자료로 보냈음 (최홍주 선생님 시트 대부분 + 다른 선생님 몇 장).
-- 서버가 받을 때 레슨 노트로 옮김 (2026년부터만, 개인정보 날짜 탭은 그대로 막음). 원장님 쪽 스크립트는 안 바꿔도 됨.
create or replace function private.tab_short_date(p_title text) returns date
language plpgsql immutable set search_path = '' as $$
declare m text[];
begin
  m := regexp_match(coalesce(p_title, ''), '^\s*(\d{2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})(\D|$)');
  if m is null then return null; end if;
  return make_date(2000 + m[1]::int, m[2]::int, m[3]::int);
exception when others then return null;
end $$;
revoke all on function private.tab_short_date(text) from public, anon, authenticated;
CREATE OR REPLACE FUNCTION public.lesson_sync_push(p_key text, p_file text, p_notes jsonb DEFAULT '[]'::jsonb, p_sheets jsonb DEFAULT '[]'::jsonb, p_done boolean DEFAULT false, p_modified timestamp with time zone DEFAULT NULL::timestamp with time zone, p_ver integer DEFAULT 1, p_tabs jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.lesson_sources; t public.teachers; r jsonb; v_date date; v_tab bigint; v_sheet jsonb; ex public.lesson_notes;
  added int := 0; updated int := 0; kept int := 0; skipped int := 0; sh int := 0; bad int := 0; blocked int := 0;
begin
  if not private.lesson_key_ok(p_key) then return private.fail('연결 열쇠가 맞지 않아요.'); end if;
  select * into s from public.lesson_sources where file_id = p_file;
  if s.file_id is null or s.status <> 'ok' or s.member_id is null then return private.fail('확인된 학생 파일이 아니에요.'); end if;
  select * into t from public.teachers where id = s.teacher_id;
  if jsonb_typeof(coalesce(p_notes, '[]')) <> 'array' or jsonb_typeof(coalesce(p_sheets, '[]')) <> 'array' then return private.fail('보낸 내용이 이상해요.'); end if;
  -- 연도가 두 자리인 날짜 탭("26-10-31(1회차)")은 스크립트가 날짜로 못 알아봐서 곡·자료로 보냄 → 여기서 레슨 노트로 옮김 (2026-11-09, 최홍주 선생님 시트)
  select coalesce(p_notes, '[]'::jsonb) || coalesce(jsonb_agg(e || jsonb_build_object('date', private.tab_short_date(e ->> 'title'))) filter (where private.tab_short_date(e ->> 'title') is not null), '[]'::jsonb),
         coalesce(jsonb_agg(e) filter (where private.tab_short_date(e ->> 'title') is null), '[]'::jsonb)
    into p_notes, p_sheets
  from jsonb_array_elements(coalesce(p_sheets, '[]'::jsonb)) e;

  for r in select * from jsonb_array_elements(coalesce(p_notes, '[]')) loop
    begin
      v_tab := (r ->> 'tab')::bigint; v_date := (r ->> 'date')::date; v_sheet := r -> 'sheet';
    exception when others then bad := bad + 1; continue; end;
    if v_tab is null or v_date is null or v_date < date '2026-01-01' or v_date > private.now_kst()::date + 400 then skipped := skipped + 1; continue; end if;
    if exists (select 1 from private.lesson_skip k where k.src_file = p_file and k.src_tab = v_tab) then skipped := skipped + 1; continue; end if;
    if private.lesson_private(v_sheet) then blocked := blocked + 1; continue; end if;
    v_sheet := private.mask_phone(v_sheet);
    if not private.sheet_ok(v_sheet) or trim(private.sheet_text(v_sheet)) = '' then bad := bad + 1; continue; end if;
    select * into ex from public.lesson_notes where src_file = p_file and src_tab = v_tab;
    if ex.id is null then
      insert into public.lesson_notes (member_id, lesson_date, teacher, teacher_id, rich, sheet, src_file, src_tab, src_title, synced_at)
      values (s.member_id, v_date, t.name, s.teacher_id, true, v_sheet, p_file, v_tab, left(r ->> 'title', 120), now());
      added := added + 1;
    elsif ex.site_edited then
      kept := kept + 1;
    else
      if ex.sheet is distinct from v_sheet or ex.lesson_date <> v_date or ex.member_id <> s.member_id then
        update public.lesson_notes set member_id = s.member_id, lesson_date = v_date, sheet = v_sheet, rich = true,
          teacher = coalesce(t.name, teacher), teacher_id = coalesce(s.teacher_id, teacher_id),
          src_title = left(r ->> 'title', 120), synced_at = now(), updated_at = now()
        where id = ex.id;
        updated := updated + 1;
      end if;
    end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_sheets, '[]')) loop
    begin
      v_tab := (r ->> 'tab')::bigint; v_sheet := r -> 'sheet';
    exception when others then bad := bad + 1; continue; end;
    if v_tab is null or coalesce(trim(r ->> 'title'), '') = '' or not private.sheet_ok(v_sheet) or trim(private.sheet_text(v_sheet)) = '' then
      bad := bad + 1; continue;
    end if;
    if trim(r ->> 'title') ~ '상담|등록 ?일지|신상|개인 ?정보' then
      delete from public.lesson_sheets where src_file = p_file and src_tab = v_tab and not site_edited;
      blocked := blocked + 1; continue;
    end if;
    -- OT처럼 생년월일 · 사는 곳이 적힌 탭도 곡·자료로 받음 (원장님 2026-11-08 "선생님이랑 관리자만 보면 됨", 선생님 의견 "OT 시트가 안 보여요").
    -- 곡·자료는 담당 선생님 · 관리자만 봄. 휴대폰 번호는 가림. 레슨 노트(학생도 봄)는 위에서 그대로 막음.
    if private.lesson_private(v_sheet) then v_sheet := private.mask_phone(v_sheet); end if;
    insert into public.lesson_sheets (member_id, teacher_id, src_file, src_tab, title, pos, sheet, synced_at)
    values (s.member_id, s.teacher_id, p_file, v_tab, left(trim(r ->> 'title'), 120), coalesce((r ->> 'pos')::int, 0), v_sheet, now())
    on conflict (src_file, src_tab) do update set member_id = excluded.member_id, teacher_id = excluded.teacher_id, title = excluded.title,
      pos = excluded.pos, sheet = excluded.sheet, synced_at = now()
    where not public.lesson_sheets.site_edited and (public.lesson_sheets.sheet is distinct from excluded.sheet or public.lesson_sheets.title is distinct from excluded.title
       or public.lesson_sheets.pos is distinct from excluded.pos or public.lesson_sheets.member_id is distinct from excluded.member_id);
    sh := sh + 1;
  end loop;

  if p_done then
    update public.lesson_sources set synced_modified = coalesce(p_modified, modified), synced_ver = p_ver, synced_at = now(),
      notes = (select count(*) from public.lesson_notes where src_file = p_file),
      sheets = (select count(*) from public.lesson_sheets where src_file = p_file),
      kept = (select count(*) from public.lesson_notes where src_file = p_file and site_edited),
      gone = case when jsonb_typeof(p_tabs) = 'array' then
        (select count(*) from public.lesson_notes n where n.src_file = p_file and not (p_tabs @> to_jsonb(n.src_tab)))
        + (select count(*) from public.lesson_sheets x where x.src_file = p_file and not (p_tabs @> to_jsonb(x.src_tab)))
        else gone end
    where file_id = p_file;
  end if;
  return jsonb_build_object('ok', true, 'added', added, 'updated', updated, 'kept', kept, 'skipped', skipped, 'sheets', sh, 'bad', bad, 'blocked', blocked);
end $function$;
-- ---------------------------------------------------------------- 마이그레이션 leesh_audition_reviews (2026-11-09)
-- 오디션 후기 (원장님 2026-11-09 "작성은 학생이 하고 보는 건 선생님들이랑 관리자만"):
--   학생이 내 폴더 → "오디션 후기"에서 쓰고 · 고치고 · 지움 (본인 것만 보임, 다른 학생 후기는 안 보임).
--   선생님은 모두(담당이 아니어도) 전체 후기를 봄 (원장님 "선생님 모두"), 관리자는 전부. 학부모 · 공개 페이지에는 안 보임.
--   텔레그램은 처음 쓸 때만 1시간 모아 보내기 ("📝 오디션 후기 …").
create table if not exists public.audition_reviews (
  id bigserial primary key,
  member_id text not null references public.members(id) on delete cascade,
  audition_date date not null,
  company text not null,
  kind text,          -- 내방 · 공개 · 비공개 · 온라인(영상) · 학교 입시 · 기타
  part text,          -- 보컬 · 랩 · 댄스 · 연기 · 라이브퍼포먼스 · 기타
  songs text,         -- 준비한 곡 · 부른 곡
  process text,       -- 진행 순서 · 분위기 · 심사위원
  asked text,         -- 받은 질문 · 요청 (다른 곡, 애드리브, 춤 …)
  feel text,          -- 잘한 점 · 아쉬운 점
  tip text,           -- 다음에 보는 사람에게 팁
  result text,        -- 결과 기다리는 중 · 1차 합격 · 최종 합격 · 불합격 · 모름
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint audition_reviews_len check (char_length(company) between 1 and 60
    and char_length(coalesce(kind, '')) <= 20 and char_length(coalesce(part, '')) <= 20 and char_length(coalesce(result, '')) <= 20
    and char_length(coalesce(songs, '')) <= 500 and char_length(coalesce(process, '')) <= 2000
    and char_length(coalesce(asked, '')) <= 2000 and char_length(coalesce(feel, '')) <= 2000 and char_length(coalesce(tip, '')) <= 1000)
);
create index if not exists audition_reviews_member on public.audition_reviews (member_id, audition_date desc);
create index if not exists audition_reviews_date on public.audition_reviews (audition_date desc, id desc);
alter table public.audition_reviews enable row level security;
drop policy if exists audition_reviews_admin on public.audition_reviews;
create policy audition_reviews_admin on public.audition_reviews for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.audition_reviews to authenticated;
grant usage, select on sequence public.audition_reviews_id_seq to authenticated;

create or replace function private.review_json(r public.audition_reviews) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'date', r.audition_date, 'company', r.company, 'kind', r.kind, 'part', r.part,
    'songs', r.songs, 'process', r.process, 'asked', r.asked, 'feel', r.feel, 'tip', r.tip, 'result', r.result,
    'at', r.created_at, 'updated', r.updated_at);
$$;
revoke all on function private.review_json(public.audition_reviews) from public, anon, authenticated;

create or replace function public.member_reviews(p_id text, p_pin text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare who jsonb := private.check_ready(p_id, p_pin);
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(private.review_json(r) order by r.audition_date desc, r.id desc)
    from public.audition_reviews r where r.member_id = who ->> 'id'), '[]'::jsonb));
end $$;

create or replace function public.member_review_save(p_id text, p_pin text, p_review bigint, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  mid text; d date; today date := private.now_kst()::date; v_id bigint; v_name text;
  f_company text; f_kind text; f_part text; f_result text;
  f_songs text; f_process text; f_asked text; f_feel text; f_tip text;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  if jsonb_typeof(p_data) <> 'object' then return private.fail('보낸 내용이 이상해요.'); end if;
  begin d := (p_data ->> 'date')::date; exception when others then return private.fail('오디션 날짜를 골라주세요.'); end;
  if d is null or d > today or d < today - 730 then return private.fail('오디션 날짜는 오늘부터 2년 전까지로 골라주세요.'); end if;
  f_company := left(trim(coalesce(p_data ->> 'company', '')), 60);
  if f_company = '' then return private.fail('기획사(또는 학교) 이름을 적어주세요.'); end if;
  f_kind := nullif(left(trim(coalesce(p_data ->> 'kind', '')), 20), '');
  f_part := nullif(left(trim(coalesce(p_data ->> 'part', '')), 20), '');
  f_result := nullif(left(trim(coalesce(p_data ->> 'result', '')), 20), '');
  f_songs := nullif(trim(coalesce(p_data ->> 'songs', '')), '');
  f_process := nullif(trim(coalesce(p_data ->> 'process', '')), '');
  f_asked := nullif(trim(coalesce(p_data ->> 'asked', '')), '');
  f_feel := nullif(trim(coalesce(p_data ->> 'feel', '')), '');
  f_tip := nullif(trim(coalesce(p_data ->> 'tip', '')), '');
  if char_length(coalesce(f_songs, '')) > 500 or char_length(coalesce(f_process, '')) > 2000 or char_length(coalesce(f_asked, '')) > 2000
     or char_length(coalesce(f_feel, '')) > 2000 or char_length(coalesce(f_tip, '')) > 1000 then
    return private.fail('글이 너무 길어요. 조금 줄여주세요.');
  end if;
  if coalesce(f_songs, f_process, f_asked, f_feel, f_tip) is null then return private.fail('부른 곡이나 오디션 내용을 하나 이상 적어주세요.'); end if;
  if p_review is null then
    if (select count(*) from public.audition_reviews where member_id = mid and created_at > now() - interval '1 day') >= 10 then
      return private.fail('하루에 10개까지 쓸 수 있어요.');
    end if;
    insert into public.audition_reviews (member_id, audition_date, company, kind, part, songs, process, asked, feel, tip, result)
    values (mid, d, f_company, f_kind, f_part, f_songs, f_process, f_asked, f_feel, f_tip, f_result)
    returning id into v_id;
    select name into v_name from public.members where id = mid;
    perform private.notify('📝 오디션 후기 · ' || coalesce(v_name, mid) || ' · ' || f_company || ' (' || to_char(d, 'MM/DD') || ')');
    return jsonb_build_object('ok', true, 'id', v_id, 'new', true);
  end if;
  update public.audition_reviews set audition_date = d, company = f_company, kind = f_kind, part = f_part, songs = f_songs,
    process = f_process, asked = f_asked, feel = f_feel, tip = f_tip, result = f_result, updated_at = now()
  where id = p_review and member_id = mid returning id into v_id;
  if v_id is null then return private.fail('후기를 찾을 수 없어요.'); end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'new', false);
end $$;

create or replace function public.member_review_delete(p_id text, p_pin text, p_review bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare who jsonb := private.check_ready(p_id, p_pin);
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  delete from public.audition_reviews where id = p_review and member_id = who ->> 'id';
  return jsonb_build_object('ok', true);
end $$;

-- 선생님: 모든 학생의 후기 (원장님 "선생님 모두"). 학생 이름 · 담당 선생님도 같이, 최근 오디션 날짜 순 300개.
create or replace function public.teacher_reviews() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.teachers := private.my_teacher();
begin
  if t.id is null then return private.fail('선생님으로 연결된 계정만 볼 수 있어요.'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(private.review_json(r) || jsonb_build_object('name', m.name,
             'teacher', substring(m.memo from '담당\s*([^\s·,]+)'), 'mine', private.teaches(t, m.id))
           order by r.audition_date desc, r.id desc)
    from (select * from public.audition_reviews order by audition_date desc, id desc limit 300) r
    join public.members m on m.id = r.member_id), '[]'::jsonb));
end $$;

create or replace function public.admin_reviews() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 볼 수 있어요.'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(private.review_json(r) || jsonb_build_object('member', m.id, 'name', m.name,
             'teacher', substring(m.memo from '담당\s*([^\s·,]+)'))
           order by r.audition_date desc, r.id desc)
    from public.audition_reviews r join public.members m on m.id = r.member_id), '[]'::jsonb));
end $$;

revoke all on function public.member_reviews(text, text), public.member_review_save(text, text, bigint, jsonb),
  public.member_review_delete(text, text, bigint), public.teacher_reviews(), public.admin_reviews() from public;
grant execute on function public.member_reviews(text, text), public.member_review_save(text, text, bigint, jsonb),
  public.member_review_delete(text, text, bigint) to anon, authenticated;
revoke all on function public.teacher_reviews(), public.admin_reviews() from anon;
grant execute on function public.teacher_reviews(), public.admin_reviews() to authenticated;

-- 텔레그램: 오디션 후기도 1시간 모아 보내기
create or replace function private.notify(msg text)
 returns void language plpgsql security definer set search_path to '' as $function$
declare t record;
begin
  select bot_token, chat_ids, bookings into t from private.telegram where id = 1;
  if coalesce(t.bot_token, '') = '' or cardinality(t.chat_ids) = 0 then return; end if;
  if msg like '🎤 연습실%' or msg like '↩️ 연습실%' then
    if not t.bookings then return; end if;
    insert into private.notify_queue (msg) values (msg);   -- 1시간 모아서
    return;
  end if;
  if msg like '🎤 내방 오디션%' or msg like '📝 오디션 후기%' then
    insert into private.notify_queue (msg) values (msg);   -- 1시간 모아서
    return;
  end if;
  perform private.notify_send(msg);
exception when others then
  null; -- 알림 때문에 신청이 실패하면 안 됩니다
end $function$;
-- ---------------------------------------------------------------- 마이그레이션 leesh_audition_reviews_form (2026-11-09)
-- 원장님이 정한 양식 그대로: 이름 · 성별 · 생년월일 · 담당쌤 · 기획사명 · 오디션 일자 · 준비한 곡(보컬곡 / 댄스곡) · 질문 리스트 ·
-- 나만의 꿀팁 / 나의 후기 · 진행 순서 / 상황 설명 · 특이사항. 이름 · 담당쌤은 명단(수강 ID · 메모 "담당 ○○○")에서 저절로.
-- 처음 만든 칸(종류 · 분야 · 결과 · 잘한 점)은 아직 쓴 사람 0명이라 빼고 새 칸으로.
alter table public.audition_reviews drop constraint if exists audition_reviews_len;
alter table public.audition_reviews drop column if exists kind, drop column if exists part, drop column if exists result,
  drop column if exists feel, drop column if exists songs;
alter table public.audition_reviews add column if not exists gender text, add column if not exists birth text,
  add column if not exists song_vocal text, add column if not exists song_dance text, add column if not exists note text;
alter table public.audition_reviews add constraint audition_reviews_len check (char_length(company) between 1 and 60
  and char_length(coalesce(gender, '')) <= 4 and char_length(coalesce(birth, '')) <= 20
  and char_length(coalesce(song_vocal, '')) <= 300 and char_length(coalesce(song_dance, '')) <= 300
  and char_length(coalesce(asked, '')) <= 2000 and char_length(coalesce(tip, '')) <= 2000
  and char_length(coalesce(process, '')) <= 2000 and char_length(coalesce(note, '')) <= 1000);

drop function if exists private.review_json(public.audition_reviews);
create or replace function private.review_json(r public.audition_reviews) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'date', r.audition_date, 'company', r.company, 'gender', r.gender, 'birth', r.birth,
    'songVocal', r.song_vocal, 'songDance', r.song_dance, 'asked', r.asked, 'tip', r.tip, 'process', r.process, 'note', r.note,
    'at', r.created_at, 'updated', r.updated_at);
$$;
revoke all on function private.review_json(public.audition_reviews) from public, anon, authenticated;

-- 학생: 내 후기 + 이름 · 담당쌤 (양식 맨 위에 보여줌)
create or replace function public.member_reviews(p_id text, p_pin text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare who jsonb := private.check_ready(p_id, p_pin); m public.members;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  select * into m from public.members where id = who ->> 'id';
  return jsonb_build_object('ok', true, 'name', m.name, 'teacher', substring(m.memo from '담당\s*([^\s·,]+)'), 'items', coalesce((
    select jsonb_agg(private.review_json(r) order by r.audition_date desc, r.id desc)
    from public.audition_reviews r where r.member_id = m.id), '[]'::jsonb));
end $$;

create or replace function public.member_review_save(p_id text, p_pin text, p_review bigint, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  mid text; d date; today date := private.now_kst()::date; v_id bigint; v_name text;
  f_company text; f_gender text; f_birth text; f_vocal text; f_dance text; f_asked text; f_tip text; f_process text; f_note text;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  if jsonb_typeof(p_data) <> 'object' then return private.fail('보낸 내용이 이상해요.'); end if;
  f_gender := nullif(trim(coalesce(p_data ->> 'gender', '')), '');
  if f_gender is null or f_gender not in ('남', '여') then return private.fail('성별을 골라주세요.'); end if;
  f_birth := left(trim(coalesce(p_data ->> 'birth', '')), 20);
  if f_birth !~ '\d{2}' then return private.fail('생년월일을 적어주세요. 예) 2009.03.15'); end if;
  f_company := left(trim(coalesce(p_data ->> 'company', '')), 60);
  if f_company = '' then return private.fail('기획사 이름을 적어주세요.'); end if;
  begin d := (p_data ->> 'date')::date; exception when others then return private.fail('오디션 일자를 골라주세요.'); end;
  if d is null or d > today or d < today - 730 then return private.fail('오디션 일자는 오늘부터 2년 전까지로 골라주세요.'); end if;
  f_vocal := nullif(left(trim(coalesce(p_data ->> 'songVocal', '')), 300), '');
  f_dance := nullif(left(trim(coalesce(p_data ->> 'songDance', '')), 300), '');
  f_asked := nullif(trim(coalesce(p_data ->> 'asked', '')), '');
  f_tip := nullif(trim(coalesce(p_data ->> 'tip', '')), '');
  f_process := nullif(trim(coalesce(p_data ->> 'process', '')), '');
  f_note := nullif(trim(coalesce(p_data ->> 'note', '')), '');
  if char_length(coalesce(f_asked, '')) > 2000 or char_length(coalesce(f_tip, '')) > 2000
     or char_length(coalesce(f_process, '')) > 2000 or char_length(coalesce(f_note, '')) > 1000 then
    return private.fail('글이 너무 길어요. 조금 줄여주세요.');
  end if;
  if coalesce(f_vocal, f_dance, f_asked, f_tip, f_process, f_note) is null then return private.fail('준비한 곡이나 후기를 하나 이상 적어주세요.'); end if;
  if p_review is null then
    if (select count(*) from public.audition_reviews where member_id = mid and created_at > now() - interval '1 day') >= 10 then
      return private.fail('하루에 10개까지 쓸 수 있어요.');
    end if;
    insert into public.audition_reviews (member_id, audition_date, company, gender, birth, song_vocal, song_dance, asked, tip, process, note)
    values (mid, d, f_company, f_gender, f_birth, f_vocal, f_dance, f_asked, f_tip, f_process, f_note)
    returning id into v_id;
    select name into v_name from public.members where id = mid;
    perform private.notify('📝 오디션 후기 · ' || coalesce(v_name, mid) || ' · ' || f_company || ' (' || to_char(d, 'MM/DD') || ')');
    return jsonb_build_object('ok', true, 'id', v_id, 'new', true);
  end if;
  update public.audition_reviews set audition_date = d, company = f_company, gender = f_gender, birth = f_birth, song_vocal = f_vocal,
    song_dance = f_dance, asked = f_asked, tip = f_tip, process = f_process, note = f_note, updated_at = now()
  where id = p_review and member_id = mid returning id into v_id;
  if v_id is null then return private.fail('후기를 찾을 수 없어요.'); end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'new', false);
end $$;

create or replace function public.teacher_reviews() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.teachers := private.my_teacher();
begin
  if t.id is null then return private.fail('선생님으로 연결된 계정만 볼 수 있어요.'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(private.review_json(r) || jsonb_build_object('name', m.name,
             'teacher', substring(m.memo from '담당\s*([^\s·,]+)'), 'mine', private.teaches(t, m.id))
           order by r.audition_date desc, r.id desc)
    from (select * from public.audition_reviews order by audition_date desc, id desc limit 300) r
    join public.members m on m.id = r.member_id), '[]'::jsonb));
end $$;

create or replace function public.admin_reviews() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 볼 수 있어요.'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(private.review_json(r) || jsonb_build_object('member', m.id, 'name', m.name,
             'teacher', substring(m.memo from '담당\s*([^\s·,]+)'))
           order by r.audition_date desc, r.id desc)
    from public.audition_reviews r join public.members m on m.id = r.member_id), '[]'::jsonb));
end $$;
-- ===== leesh_admin_log (2026-11-10) =====
-- 관리자 작업 기록 (원장님 2026-11-10 "관리자 작업기록 만들어줘")
-- 관리자(이메일 로그인)가 관리자 화면에서 바꾼 것을 표마다 저절로 남김: 누가 · 언제 · 어느 표 · 추가/수정/삭제 · 무엇(이름 · 제목) · 바뀐 칸.
-- Claude가 관리 도구(Management API)로 바꾼 것도 "Claude (관리 도구)"로 남김. 학생 · 선생님 · 자동 실행(시트 맞추기 · 인스타)은 안 남김.
-- 글 내용 · 전화번호 · 생년월일 같은 값은 남기지 않고 "바뀜"만. 지울 수 없음 (관리자 화면에도 지우기 없음), 자동 삭제 없음.

create table if not exists private.admin_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  first_at timestamptz not null default now(),
  actor text not null,
  tbl text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  row_id text,
  label text,
  labels text[] not null default '{}',
  changes jsonb not null default '{}',
  n int not null default 1
);
create index if not exists admin_log_at on private.admin_log (at desc);
create index if not exists admin_log_merge on private.admin_log (actor, tbl, action, row_id, at desc);
revoke all on private.admin_log from public, anon, authenticated;

-- 한 줄을 사람이 알아보는 이름으로
create or replace function private.log_label(p_tbl text, r jsonb)
returns text language plpgsql stable security definer set search_path = '' as $$
declare m text; t text; d text;
begin
  if r is null then return null; end if;
  if p_tbl = 'members' then return concat_ws(' ', r->>'name', '(' || (r->>'id') || ')'); end if;
  if p_tbl = 'admins' then return r->>'email'; end if;
  if p_tbl = 'settings' then return '예약 · 운영 설정'; end if;
  if coalesce(r->>'member_id', r->>'to_member') is not null then
    select name into m from public.members where id = coalesce(r->>'member_id', r->>'to_member');
    m := coalesce(m, coalesce(r->>'member_id', r->>'to_member'));
  end if;
  if p_tbl = 'messages' and m is null then
    if r->>'to_teacher' is not null then select name || ' 선생님' into m from public.teachers where id = (r->>'to_teacher')::bigint; end if;
    if r->>'to_parent' is not null then select coalesce(name, kakao_name) || ' (학부모)' into m from public.parents where id = (r->>'to_parent')::bigint; end if;
  end if;
  if p_tbl = 'parent_links' then
    select coalesce(name, kakao_name) into t from public.parents where id = (r->>'parent_id')::bigint;
    return concat_ws(' → ', t, m);
  end if;
  if p_tbl = 'admin_inbox' then select name || ' 선생님' into t from public.teachers where id = (r->>'teacher_id')::bigint; end if;
  if p_tbl = 'bookings' then select name into t from public.rooms where id = (r->>'room_id')::int; end if;
  if p_tbl in ('lesson_photos') then t := '사진'; end if;
  t := coalesce(t, r->>'title', r->>'name', r->>'company', r->>'kakao_name', r->>'category', r->>'partner', r->>'audition');
  d := coalesce(r->>'day', r->>'lesson_date', r->>'event_date', r->>'audition_date', r->>'made_on', r->>'posted_on', left(r->>'month', 7));
  return nullif(concat_ws(' · ', m, nullif(t, m), d), '');
end $$;

create or replace function private.log_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  who text; o jsonb; nw jsonb; rid text; lbl text; ch jsonb := '{}'; k text; a jsonb; b jsonb;
  skip text[] := array['updated_at', 'synced_at', 'seen_at', 'client_key', 'decided_at', 'synced_modified', 'synced_ver', 'modified', 'notes', 'sheets', 'kept', 'gone'];
  hide text[] := array['pin_hash', 'phone', 'birth', 'body', 'sheet', 'message', 'caption', 'summary', 'songs', 'did', 'practice', 'audition', 'recommend',
                       'asked', 'tip', 'process', 'note', 'files', 'music', 'images', 'info', 'reply', 'wish', 'likes', 'goal', 'comment', 'tips', 'styling', 'body_size', 'path'];
  win interval; prev private.admin_log;
begin
  if coalesce(auth.jwt() ->> 'email', '') <> '' then
    if not public.is_admin() then return null; end if;
    who := lower(auth.jwt() ->> 'email');
  elsif current_setting('application_name', true) = 'mgmt-api' then
    who := 'Claude (관리 도구)';
  else
    return null;
  end if;

  if tg_op <> 'INSERT' then o := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then nw := to_jsonb(new); end if;
  rid := coalesce(coalesce(nw, o)->>'id', coalesce(nw, o)->>'file_id', coalesce(nw, o)->>'email',
                  concat_ws('/', coalesce(nw, o)->>'parent_id', coalesce(nw, o)->>'member_id', coalesce(nw, o)->>'month'));
  lbl := private.log_label(tg_table_name, coalesce(nw, o));

  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(nw) loop
      a := o -> k; b := nw -> k;
      if a is distinct from b and not (k = any (skip)) then
        if k = 'kakao_user' then
          ch := ch || jsonb_build_object(k, jsonb_build_array(case when a = 'null'::jsonb then '없음' else '연결' end, case when b = 'null'::jsonb then '없음' else '연결' end));
        elsif k = any (hide) or jsonb_typeof(coalesce(b, a)) in ('object', 'array')
              or length(coalesce(a #>> '{}', '')) > 40 or length(coalesce(b #>> '{}', '')) > 40 then
          ch := ch || jsonb_build_object(k, true);
        else
          ch := ch || jsonb_build_object(k, jsonb_build_array(a #>> '{}', b #>> '{}'));
        end if;
      end if;
    end loop;
    if ch = '{}' then return null; end if;
  end if;

  -- 같은 사람이 짧은 사이에 같은 일을 하면 한 줄로 (일지 저절로 저장 · 여러 명에게 메시지 · Claude의 한꺼번에 고치기)
  win := case when tg_op = 'UPDATE' then interval '10 minutes' else interval '2 minutes' end;
  select * into prev from private.admin_log l
  where l.actor = who and l.tbl = tg_table_name and l.action = lower(tg_op) and l.at > now() - win
    and (tg_op <> 'UPDATE' or who like 'Claude%' or l.row_id is not distinct from rid)
  order by l.at desc limit 1;
  if found then
    update private.admin_log set at = now(), n = n + case when prev.row_id is not distinct from rid and tg_op = 'UPDATE' then 0 else 1 end,
      row_id = case when prev.row_id is not distinct from rid then rid else null end,
      labels = case when lbl is null or lbl = any (labels) or cardinality(labels) >= 5 then labels else labels || lbl end,
      changes = changes || ch
    where id = prev.id;
  else
    insert into private.admin_log (actor, tbl, action, row_id, label, labels, changes)
    values (who, tg_table_name, lower(tg_op), rid, lbl, case when lbl is null then '{}' else array[lbl] end, ch);
  end if;
  return null;
end $$;

do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' loop
    execute format('drop trigger if exists zz_admin_log on public.%I', t);
    execute format('create trigger zz_admin_log after insert or update or delete on public.%I for each row execute function private.log_change()', t);
  end loop;
end $$;

-- 관리자 화면에서 읽기 (지우기 · 고치기 함수는 일부러 없음)
create or replace function public.admin_log(p_before bigint default null, p_actor text default null, p_tbl text default null,
                                            p_find text default null, p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare rows jsonb; actors jsonb;
begin
  if not public.is_admin() then return private.fail('관리자만 볼 수 있어요.'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'at', at, 'first', first_at, 'actor', actor, 'tbl', tbl, 'action', action,
           'label', label, 'labels', labels, 'changes', changes, 'n', n) order by at desc), '[]') into rows
  from (select * from private.admin_log l
        where (p_before is null or l.id < p_before)
          and (p_actor is null or l.actor = p_actor)
          and (p_tbl is null or l.tbl = p_tbl)
          and (coalesce(p_find, '') = '' or l.label ilike '%' || p_find || '%' or array_to_string(l.labels, ' ') ilike '%' || p_find || '%')
        order by l.id desc limit greatest(1, least(coalesce(p_limit, 100), 300))) x;
  select coalesce(jsonb_agg(distinct actor), '[]') into actors from private.admin_log;
  return jsonb_build_object('ok', true, 'items', rows, 'actors', actors);
end $$;
revoke all on function public.admin_log(bigint, text, text, text, int) from public, anon;
grant execute on function public.admin_log(bigint, text, text, text, int) to authenticated;
revoke all on function private.log_change() from public, anon, authenticated;
revoke all on function private.log_label(text, jsonb) from public, anon, authenticated;

-- 매일 백업에도 넣기
create or replace function private.backup_list()
returns text[] language sql stable security definer set search_path = '' as $$
  select array_agg(t order by t) from (
    select 'public.' || c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    union all select 'private.suggestions' union all select 'private.lesson_skip' union all select 'private.admin_log'
  ) x;
$$;

-- ===== leesh_admin_log_name (2026-11-10) =====
-- 관리자 작업 기록: 관리 도구(Management API)로 바꾼 것의 이름 (원장님 2026-11-10 "Claude 라고 남기지 말고 ○○○으로")
-- 이름은 저장소가 공개라 DB(private.log_names)에만 넣음.
create table if not exists private.log_names (key text primary key, name text not null);
revoke all on private.log_names from public, anon, authenticated;
create or replace function private.log_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  who text; o jsonb; nw jsonb; rid text; lbl text; ch jsonb := '{}'; k text; a jsonb; b jsonb;
  skip text[] := array['updated_at', 'synced_at', 'seen_at', 'client_key', 'decided_at', 'synced_modified', 'synced_ver', 'modified', 'notes', 'sheets', 'kept', 'gone'];
  hide text[] := array['pin_hash', 'phone', 'birth', 'body', 'sheet', 'message', 'caption', 'summary', 'songs', 'did', 'practice', 'audition', 'recommend',
                       'asked', 'tip', 'process', 'note', 'files', 'music', 'images', 'info', 'reply', 'wish', 'likes', 'goal', 'comment', 'tips', 'styling', 'body_size', 'path'];
  win interval; prev private.admin_log;
begin
  if coalesce(auth.jwt() ->> 'email', '') <> '' then
    if not public.is_admin() then return null; end if;
    who := lower(auth.jwt() ->> 'email');
  elsif current_setting('application_name', true) = 'mgmt-api' then
    who := coalesce((select name from private.log_names where key = 'mgmt-api'), '관리 도구');
  else
    return null;
  end if;

  if tg_op <> 'INSERT' then o := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then nw := to_jsonb(new); end if;
  rid := coalesce(coalesce(nw, o)->>'id', coalesce(nw, o)->>'file_id', coalesce(nw, o)->>'email',
                  concat_ws('/', coalesce(nw, o)->>'parent_id', coalesce(nw, o)->>'member_id', coalesce(nw, o)->>'month'));
  lbl := private.log_label(tg_table_name, coalesce(nw, o));

  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(nw) loop
      a := o -> k; b := nw -> k;
      if a is distinct from b and not (k = any (skip)) then
        if k = 'kakao_user' then
          ch := ch || jsonb_build_object(k, jsonb_build_array(case when a = 'null'::jsonb then '없음' else '연결' end, case when b = 'null'::jsonb then '없음' else '연결' end));
        elsif k = any (hide) or jsonb_typeof(coalesce(b, a)) in ('object', 'array')
              or length(coalesce(a #>> '{}', '')) > 40 or length(coalesce(b #>> '{}', '')) > 40 then
          ch := ch || jsonb_build_object(k, true);
        else
          ch := ch || jsonb_build_object(k, jsonb_build_array(a #>> '{}', b #>> '{}'));
        end if;
      end if;
    end loop;
    if ch = '{}' then return null; end if;
  end if;

  -- 같은 사람이 짧은 사이에 같은 일을 하면 한 줄로 (일지 저절로 저장 · 여러 명에게 메시지 · Claude의 한꺼번에 고치기)
  win := case when tg_op = 'UPDATE' then interval '10 minutes' else interval '2 minutes' end;
  select * into prev from private.admin_log l
  where l.actor = who and l.tbl = tg_table_name and l.action = lower(tg_op) and l.at > now() - win
    and (tg_op <> 'UPDATE' or current_setting('application_name', true) = 'mgmt-api' or l.row_id is not distinct from rid)
  order by l.at desc limit 1;
  if found then
    update private.admin_log set at = now(), n = n + case when prev.row_id is not distinct from rid and tg_op = 'UPDATE' then 0 else 1 end,
      row_id = case when prev.row_id is not distinct from rid then rid else null end,
      labels = case when lbl is null or lbl = any (labels) or cardinality(labels) >= 5 then labels else labels || lbl end,
      changes = changes || ch
    where id = prev.id;
  else
    insert into private.admin_log (actor, tbl, action, row_id, label, labels, changes)
    values (who, tg_table_name, lower(tg_op), rid, lbl, case when lbl is null then '{}' else array[lbl] end, ch);
  end if;
  return null;
end $$;


-- ===== leesh_kakao_stuck (2026-11-10) =====
-- 연결 요청을 못 끝낸 카카오 계정 (원장님 2026-11-10 "누가 신청했는데 안 되는지도 모르는 거 같아")
-- 관리자 → 수강 ID → 카카오 연결 요청 아래에 보이기:
--   ① 이메일 인증 전이라 카카오 로그인이 안 끝난 계정 → "로그인 풀어주기" (학생이 다시 카카오 로그인하면 이름 보내는 화면)
--   ② 카카오 로그인은 했는데 이름을 안 보낸 계정
--   둘 다 카카오 이름을 보고 수강 ID를 골라 "바로 연결" (학생이 다시 할 일 없음), 모르는 계정은 "목록에서 빼기".

create table if not exists private.kakao_ignored (user_id uuid primary key, at timestamptz not null default now());
revoke all on private.kakao_ignored from public, anon, authenticated;

create or replace function private.kakao_stuck_list()
returns setof jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user', u.id,
    'kakao_name', coalesce(u.raw_user_meta_data ->> 'name', u.raw_user_meta_data ->> 'nickname', u.raw_user_meta_data ->> 'full_name', '(이름 없음)'),
    'kind', case when u.email_confirmed_at is null and u.last_sign_in_at is null then 'email' else 'noname' end,
    'at', u.created_at,
    'last', u.last_sign_in_at)
  from auth.users u
  where u.raw_app_meta_data ->> 'provider' = 'kakao'
    and not exists (select 1 from public.members m where m.kakao_user = u.id)
    and not exists (select 1 from public.teachers t where t.kakao_user = u.id)
    and not exists (select 1 from public.link_requests r where r.user_id = u.id)
    and not exists (select 1 from public.teacher_requests r where r.user_id = u.id)
    and not exists (select 1 from public.parents p where p.kakao_user = u.id)
    and not exists (select 1 from public.parent_requests r where r.user_id = u.id)
    and not exists (select 1 from private.kakao_ignored i where i.user_id = u.id)
  order by u.created_at desc
  limit 100;
$$;

create or replace function public.admin_kakao_stuck()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 볼 수 있어요.'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((select jsonb_agg(x) from private.kakao_stuck_list() x), '[]'));
end $$;

-- 카카오 계정 하나가 관리자 계정이면 안 됨 (이메일 로그인 관리자와 같은 이메일)
create or replace function private.kakao_user_ok(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users u where u.id = p_user and u.raw_app_meta_data ->> 'provider' = 'kakao')
     and not exists (select 1 from auth.users u join public.admins a on a.email = lower(u.email) where u.id = p_user);
$$;

-- ① 로그인 풀어주기 (이메일 인증 전 계정만)
create or replace function public.admin_kakao_confirm(p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있습니다.'); end if;
  if not private.kakao_user_ok(p_user) then return private.fail('카카오 계정을 찾을 수 없어요.'); end if;
  update auth.users set email_confirmed_at = now(), confirmation_token = '', confirmation_sent_at = null
  where id = p_user and email_confirmed_at is null;
  return jsonb_build_object('ok', true);
end $$;

-- ①② 수강 ID에 바로 연결 (학생이 이름을 안 보냈어도). 승인된 연결 요청 기록도 남김.
create or replace function public.admin_kakao_attach(p_user uuid, p_member text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.members; mid text := upper(trim(coalesce(p_member, ''))); kname text; owner text;
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있습니다.'); end if;
  if not private.kakao_user_ok(p_user) then return private.fail('카카오 계정을 찾을 수 없어요.'); end if;
  select * into m from public.members where id = mid;
  if m.id is null then return private.fail('수강 ID를 골라주세요.'); end if;
  if m.status = '종료' then return private.fail('종료된 학생이에요.'); end if;
  if m.kakao_user is not null and m.kakao_user <> p_user then return private.fail('이미 다른 카카오 계정과 연결된 학생이에요 (' || m.name || ' · ' || m.id || ').'); end if;
  select id into owner from public.members where kakao_user = p_user and id <> mid;
  if owner is not null then return private.fail('이 카카오 계정은 이미 ' || owner || '에 연결돼 있어요.'); end if;
  if exists (select 1 from public.teachers where kakao_user = p_user) then return private.fail('선생님으로 연결된 카카오 계정이에요.'); end if;
  select coalesce(raw_user_meta_data ->> 'name', raw_user_meta_data ->> 'nickname') into kname from auth.users where id = p_user;
  update auth.users set email_confirmed_at = now(), confirmation_token = '', confirmation_sent_at = null
  where id = p_user and email_confirmed_at is null;
  update public.members set kakao_user = p_user where id = mid;
  insert into public.link_requests (user_id, kakao_name, name, teacher, status, member_id, decided_at)
  values (p_user, left(kname, 60), left(m.name, 30), nullif(substring(coalesce(m.memo, '') from '담당\s*([^\s·,]+)'), ''), '승인', mid, now())
  on conflict (user_id) do update set status = '승인', member_id = mid, decided_at = now();
  delete from private.kakao_ignored where user_id = p_user;
  return jsonb_build_object('ok', true, 'member', mid, 'name', m.name);
end $$;

-- 모르는 계정은 목록에서 빼기 (계정은 그대로, 나중에 그 사람이 이름을 보내면 연결 요청에 정상으로 뜸)
create or replace function public.admin_kakao_ignore(p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있습니다.'); end if;
  insert into private.kakao_ignored (user_id) values (p_user) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.admin_kakao_stuck() from public, anon;
revoke all on function public.admin_kakao_confirm(uuid) from public, anon;
revoke all on function public.admin_kakao_attach(uuid, text) from public, anon;
revoke all on function public.admin_kakao_ignore(uuid) from public, anon;
grant execute on function public.admin_kakao_stuck() to authenticated;
grant execute on function public.admin_kakao_confirm(uuid) to authenticated;
grant execute on function public.admin_kakao_attach(uuid, text) to authenticated;
grant execute on function public.admin_kakao_ignore(uuid) to authenticated;
revoke all on function private.kakao_stuck_list() from public, anon, authenticated;
revoke all on function private.kakao_user_ok(uuid) from public, anon, authenticated;

-- ===== leesh_audition_sheet (2026-11-10) =====
-- 오디션 정보 시트 → audition news "기획사 오디션 정보" (원장님 2026-11-10)
-- 시트 "이송희보컬레슨 오디션 정보 목록" '오디션 목록' 탭 (인스타 · 기획사 홈페이지에서 모은 공고, 국내 · 해외 모두)을
-- 서버가 3시간마다 읽어서(링크 공유 · 읽기만, 시트는 고치지 않음) audition_news(kind '오디션', source 'sheet')로 넣음.
-- 확인일이 2026-07-19 뒤인 줄만 (그 전 소식은 예전 블로그 · 인스타 글로 이미 있음). 공고ID(없으면 원문 주소 · 기획사+오디션명)로 같은 공고는 한 번만.
-- 내용은 시트 칸만 짧게: 상태 · 형태 · 지역 / 접수 기간 / 심사 일정 / 장소 / 대상 / 분야 / 접수 방법 / 준비물. 메모 · 확인 · 공고ID 같은 안쪽 칸은 안 씀.
-- 관리자가 관리자 화면에서 고치거나 숨긴 글은 그 뒤로 덮지 않음, 시트에서 지운 줄도 홈페이지에서 지우지 않음.

alter table public.audition_news add column if not exists ext_id text;
alter table public.audition_news add column if not exists apply_link text;
alter table public.audition_news add column if not exists synced_at timestamptz;
create unique index if not exists audition_news_ext_id on public.audition_news (ext_id) where ext_id is not null;
alter table public.audition_news drop constraint if exists audition_news_source_check;
alter table public.audition_news add constraint audition_news_source_check check (source = any (array['ig', 'sheet']));
alter table public.audition_news drop constraint if exists audition_news_apply_link_check;
alter table public.audition_news add constraint audition_news_apply_link_check check (apply_link is null or apply_link ~ '^(https?://|mailto:)');

create table if not exists private.audition_sheet (
  id int primary key default 1 check (id = 1),
  sheet_id text not null,
  tab text not null default '오디션 목록',
  since date not null default '2026-07-19',
  last_at timestamptz, last_ok boolean, last_note text
);
revoke all on private.audition_sheet from public, anon, authenticated;
insert into private.audition_sheet (sheet_id) values ('1iViJCW0i2i4WMzusQSZ7IpMzjQZ7L__ZHFAc-j6dU0U') on conflict (id) do nothing;

create or replace function private.aud_clean(t text)
returns text language sql immutable set search_path = '' as $$
  select case when x in ('', '공고확인', '미상', '원문확인', '-', '확인 필요') then null else x end
  from (select btrim(regexp_replace(coalesce(t, ''), '\s+', ' ', 'g')) x) s;
$$;

create or replace function private.audition_sheet_sync()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cfg private.audition_sheet; res record; j jsonb; cols jsonb; r jsonb; i int; idx jsonb := '{}';
  v jsonb; cells text[]; added int := 0; changed int := 0; skipped int := 0;
  v_company text; v_title text; key text; dl date; ev date; seen date; v_body text; v_link text; v_apply text; st text; t text;
  old public.audition_news;
begin
  select * into cfg from private.audition_sheet where id = 1;
  if cfg.sheet_id is null then return jsonb_build_object('ok', false, 'error', 'no sheet'); end if;
  select status, content into res from extensions.http_get(
    'https://docs.google.com/spreadsheets/d/' || cfg.sheet_id || '/gviz/tq?tqx=out:json&headers=1&sheet=' || extensions.urlencode(cfg.tab));
  if res.status <> 200 then
    update private.audition_sheet set last_at = now(), last_ok = false, last_note = '시트를 읽지 못함 (' || res.status || ')' where id = 1;
    return jsonb_build_object('ok', false, 'status', res.status);
  end if;
  j := substring(res.content from '\((\{.*\})\);?\s*$')::jsonb;
  cols := j -> 'table' -> 'cols';
  for i in 0 .. jsonb_array_length(cols) - 1 loop
    if coalesce(cols -> i ->> 'label', '') <> '' and not idx ? (cols -> i ->> 'label') then
      idx := idx || jsonb_build_object(cols -> i ->> 'label', i);
    end if;
  end loop;

  for r in select x from jsonb_array_elements(j -> 'table' -> 'rows') x loop
    -- 칸 값 (날짜 칸은 "2026-09-13" 모양의 f)
    cells := array(select coalesce(c ->> 'f', c ->> 'v') from jsonb_array_elements(r -> 'c') with ordinality e(c, n) order by n);
    -- 몇 줄은 시트에서 칸 하나가 빠져 한 칸씩 왼쪽으로 밀려 있음 (원문주소 칸에 날짜, 확인일 칸에 메모):
    -- 그런 줄은 심사일정 자리에 빈칸을 하나 넣어 제자리로 (시트는 그대로 두고 읽을 때만)
    if coalesce(cells[(idx ->> '원문주소')::int + 1], '') ~ '^\d{4}-\d{2}-\d{2}$'
       and coalesce(cells[(idx ->> '확인일')::int + 1], '') !~ '^\d{4}-\d{2}-\d{2}' then
      cells := cells[1:(idx ->> '심사일정')::int] || array[null::text] || cells[(idx ->> '심사일정')::int + 1:];
    end if;
    v := '{}';
    for t in select jsonb_object_keys(idx) loop
      v := v || jsonb_build_object(t, cells[(idx ->> t)::int + 1]);
    end loop;
    v_company := left(private.aud_clean(v ->> '기획사'), 40);
    v_title := left(private.aud_clean(v ->> '오디션명'), 80);
    if v_company is null or v_title is null then skipped := skipped + 1; continue; end if;
    seen := case when (v ->> '확인일') ~ '^\d{4}-\d{2}-\d{2}' then left(v ->> '확인일', 10)::date end;
    if seen is not null and seen <= cfg.since then skipped := skipped + 1; continue; end if;
    dl := case when (v ->> '접수마감') ~ '^\d{4}-\d{2}-\d{2}' then left(v ->> '접수마감', 10)::date end;
    ev := (select m[1]::date from regexp_matches(coalesce(v ->> '심사일정', ''), '(\d{4}-\d{2}-\d{2})') m limit 1);
    st := private.aud_clean(v ->> '상태');
    if st = '마감' and dl is null then dl := coalesce(ev, seen, current_date - 1); end if;
    v_link := case when private.aud_clean(v ->> '원문주소') ~ '^https?://' then private.aud_clean(v ->> '원문주소')
                 when private.aud_clean(v ->> '지원주소') ~ '^https?://' then private.aud_clean(v ->> '지원주소') end;
    v_apply := case when private.aud_clean(v ->> '지원주소') ~ '^(https?://|mailto:)' and private.aud_clean(v ->> '지원주소') is distinct from v_link
                  then private.aud_clean(v ->> '지원주소') end;
    key := coalesce(private.aud_clean(v ->> '공고ID'), v_link, v_company || '|' || v_title);
    v_body := concat_ws(E'\n',
      nullif(concat_ws(' · ', st, private.aud_clean(v ->> '형태'), private.aud_clean(v ->> '지역')), ''),
      case when coalesce(private.aud_clean(v ->> '접수시작'), private.aud_clean(v ->> '접수마감')) is not null then
        '접수: ' || concat_ws(' ~ ', private.aud_clean(v ->> '접수시작'), private.aud_clean(v ->> '접수마감'))
        || coalesce(' ' || private.aud_clean(v ->> '마감시각'), '') || coalesce(' (' || private.aud_clean(v ->> '마감기준') || ')', '') end,
      '심사 일정: ' || private.aud_clean(v ->> '심사일정'),
      '장소: ' || private.aud_clean(v ->> '장소'),
      '대상: ' || nullif(concat_ws(' · ', private.aud_clean(v ->> '성별'), private.aud_clean(v ->> '나이'), private.aud_clean(v ->> '자격')), ''),
      '분야: ' || private.aud_clean(v ->> '분야'),
      '접수 방법: ' || private.aud_clean(v ->> '접수'),
      '준비물: ' || private.aud_clean(v ->> '준비물'));
    v_body := left(nullif(v_body, ''), 3000);

    select * into old from public.audition_news where ext_id = key;
    if old.id is null then
      insert into public.audition_news (kind, company, title, event_date, deadline, body, link, apply_link, published, created_at, updated_at, source, ext_id, synced_at)
      values ('오디션', v_company, v_title, ev, dl, v_body, v_link, v_apply, true,
              coalesce(seen::timestamptz, now()), now(), 'sheet', key, now());
      added := added + 1;
    elsif old.source = 'sheet' and (old.updated_at is null or old.updated_at <= old.synced_at + interval '1 second') then
      if (old.company, old.title, old.event_date, old.deadline, old.body, old.link, old.apply_link)
         is distinct from (v_company, v_title, ev, dl, v_body, v_link, v_apply) then
        update public.audition_news set company = v_company, title = v_title, event_date = ev, deadline = dl, body = v_body,
          link = v_link, apply_link = v_apply, updated_at = now(), synced_at = now()
        where id = old.id;
        changed := changed + 1;
      end if;
    end if;
  end loop;
  update private.audition_sheet set last_at = now(), last_ok = true,
    last_note = '새 ' || added || ' · 바뀜 ' || changed || ' · 건너뜀 ' || skipped where id = 1;
  return jsonb_build_object('ok', true, 'added', added, 'changed', changed, 'skipped', skipped);
end $$;
revoke all on function private.audition_sheet_sync() from public, anon, authenticated;

-- 3시간마다 (가져오기만, 지우지 않음)
select cron.schedule('leesh_audition_sheet', '23 */3 * * *', 'select private.audition_sheet_sync()');

-- ===== leesh_game_event (2026-11-10) =====
-- 보컬오락실 이벤트 순위표 (원장님 2026-11-10): 계이름 맞히기 · 멜로디 따라치기 · 목소리로 날아라(목소리로 한 판만)
-- 기간 안에 로그인한 학생이 낸 점수 중 학생마다 게임별 최고 점수만 서버에 저장. 같은 점수면 먼저 낸 사람이 위.
-- 학생 화면엔 1등을 "이*희"처럼 가려서, 관리자 화면엔 1~10등 이름 그대로. 자동 삭제 없음.

create table if not exists private.game_event (
  id text primary key,
  title text not null,
  starts timestamptz not null,
  ends timestamptz not null,
  games text[] not null,
  max_score jsonb not null default '{}'
);
revoke all on private.game_event from public, anon, authenticated;
insert into private.game_event (id, title, starts, ends, games, max_score)
values ('2026-11', '보컬오락실 이벤트', '2026-11-15 00:00:00+09', '2026-11-28 23:59:59.999+09',
        array['solfa', 'simon', 'fly'], '{"solfa": 400, "simon": 60, "fly": 600}')
on conflict (id) do nothing;

create table if not exists public.game_scores (
  event text not null,
  member_id text not null references public.members (id) on delete cascade,
  game text not null check (game in ('solfa', 'simon', 'fly')),
  score int not null check (score >= 0),
  at timestamptz not null default now(),       -- 최고 점수를 낸 시각
  plays int not null default 1,                -- 이 게임을 끝낸 판 수
  last_at timestamptz not null default now(),  -- 마지막으로 끝낸 시각
  primary key (event, member_id, game)
);
alter table public.game_scores enable row level security;
revoke all on public.game_scores from anon, authenticated;
drop trigger if exists zz_admin_log on public.game_scores;
create trigger zz_admin_log after insert or update or delete on public.game_scores for each row execute function private.log_change();

-- 이름 가리기: 이송희 → 이*희, 김유 → 김*, 남궁민수 → 남**수
create or replace function private.mask_name(n text)
returns text language sql immutable set search_path = '' as $$
  select case when n is null or length(btrim(n)) = 0 then '?'
              when length(btrim(n)) = 1 then btrim(n)
              when length(btrim(n)) = 2 then left(btrim(n), 1) || '*'
              else left(btrim(n), 1) || repeat('*', length(btrim(n)) - 2) || right(btrim(n), 1) end;
$$;

create or replace function private.game_now()
returns private.game_event language sql stable security definer set search_path = '' as $$
  select * from private.game_event where now() <= ends + interval '7 days' order by starts limit 1;
$$;

-- 학생: 게임이 끝날 때 점수 보내기 (기간 안 · 이벤트 게임 · 말이 되는 점수만, 최고 점수만 남김)
create or replace function public.member_game_score(p_id text, p_pin text, p_game text, p_score int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  ev private.game_event; mid text; old public.game_scores; best boolean := false;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  select * into ev from private.game_event where now() between starts and ends order by starts limit 1;
  if ev.id is null then return jsonb_build_object('ok', true, 'event', false); end if;
  if not (p_game = any (ev.games)) then return private.fail('이벤트 게임이 아니에요.'); end if;
  if p_score is null or p_score < 0 or p_score > coalesce((ev.max_score ->> p_game)::int, 1000) then
    return private.fail('점수를 확인할 수 없어요.');
  end if;
  select * into old from public.game_scores where event = ev.id and member_id = mid and game = p_game for update;
  if old.member_id is null then
    insert into public.game_scores (event, member_id, game, score) values (ev.id, mid, p_game, p_score);
    best := true;
  else
    if old.last_at > now() - interval '1 second' then return private.fail('너무 빨라요. 잠시 뒤에 다시 해주세요.'); end if;
    if old.plays >= 2000 then return private.fail('오늘은 그만! 내일 다시 도전해요.'); end if;
    best := p_score > old.score;
    update public.game_scores set plays = plays + 1, last_at = now(),
      score = greatest(score, p_score), at = case when p_score > score then now() else at end
    where event = ev.id and member_id = mid and game = p_game;
  end if;
  return jsonb_build_object('ok', true, 'event', true, 'best', best);
end $$;

-- 학생: 이벤트 안내 + 게임별 1등(이름 가림) + 내 최고 점수 · 내 순위
create or replace function public.member_game_board(p_id text, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  ev private.game_event; mid text; out jsonb := '{}'; g text; top record; mine public.game_scores; rk int;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  ev := private.game_now();
  if ev.id is null then return jsonb_build_object('ok', true, 'event', null); end if;
  foreach g in array ev.games loop
    select s.score, s.at, m.name into top from public.game_scores s join public.members m on m.id = s.member_id
     where s.event = ev.id and s.game = g order by s.score desc, s.at limit 1;
    select * into mine from public.game_scores where event = ev.id and member_id = mid and game = g;
    rk := case when mine.member_id is null then null else
      (select count(*) + 1 from public.game_scores s where s.event = ev.id and s.game = g
        and (s.score > mine.score or (s.score = mine.score and s.at < mine.at))) end;
    out := out || jsonb_build_object(g, jsonb_build_object(
      'top', case when top.score is null then null else jsonb_build_object('name', private.mask_name(top.name), 'score', top.score) end,
      'mine', mine.score, 'rank', rk,
      'players', (select count(*) from public.game_scores where event = ev.id and game = g)));
  end loop;
  return jsonb_build_object('ok', true, 'event', jsonb_build_object('id', ev.id, 'title', ev.title, 'starts', ev.starts, 'ends', ev.ends,
    'open', now() between ev.starts and ev.ends, 'games', to_jsonb(ev.games)), 'board', out);
end $$;

-- 관리자: 게임별 1~10등 (이름 · 수강 ID · 담당 · 점수 · 시각 · 판 수)
create or replace function public.admin_game_board()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare ev private.game_event; out jsonb := '{}'; g text;
begin
  if not public.is_admin() then return private.fail('관리자만 볼 수 있어요.'); end if;
  select * into ev from private.game_event order by starts desc limit 1;
  if ev.id is null then return jsonb_build_object('ok', true, 'event', null); end if;
  foreach g in array ev.games loop
    out := out || jsonb_build_object(g, coalesce((select jsonb_agg(jsonb_build_object('id', x.member_id, 'name', x.name,
        'teacher', substring(coalesce(x.memo, '') from '담당\s*([^\s·,]+)'), 'score', x.score, 'at', x.at, 'plays', x.plays) order by x.score desc, x.at)
      from (select s.*, m.name, m.memo from public.game_scores s join public.members m on m.id = s.member_id
            where s.event = ev.id and s.game = g order by s.score desc, s.at limit 10) x), '[]'));
  end loop;
  return jsonb_build_object('ok', true, 'event', jsonb_build_object('id', ev.id, 'title', ev.title, 'starts', ev.starts, 'ends', ev.ends,
    'open', now() between ev.starts and ev.ends, 'games', to_jsonb(ev.games),
    'players', (select count(distinct member_id) from public.game_scores where event = ev.id)), 'board', out);
end $$;

revoke all on function public.member_game_score(text, text, text, int) from public;
revoke all on function public.member_game_board(text, text) from public;
revoke all on function public.admin_game_board() from public, anon;
grant execute on function public.member_game_score(text, text, text, int) to anon, authenticated;
grant execute on function public.member_game_board(text, text) to anon, authenticated;
grant execute on function public.admin_game_board() to authenticated;
revoke all on function private.game_now() from public, anon, authenticated;

-- ===== leesh_game_event_caps (2026-11-10) =====
-- 원장님 "만점자가 많이 나오면 애매, 점수 무한정": 세 게임 모두 끝판이 없음. 상한은 사람이 못 내는 점수(조작 거르기)로만.
update private.game_event set max_score = '{"solfa": 3000, "simon": 200, "fly": 2000}' where id = '2026-11';

-- ===== leesh_game_event_off (2026-11-10) =====
-- 보컬오락실 이벤트는 아직 기획 중 (원장님 2026-11-10 "아직 하면 안 돼, 홈페이지에 올리지 마"): 켜기 스위치, 처음엔 꺼짐.
-- 꺼져 있으면 학생 화면에 상자가 안 뜨고 점수도 안 받음. 켤 때: update private.game_event set enabled = true where id = '2026-11';
alter table private.game_event add column if not exists enabled boolean not null default false;
update private.game_event set enabled = false;
create or replace function private.game_now()
returns private.game_event language sql stable security definer set search_path = '' as $$
  select * from private.game_event where enabled and now() <= ends + interval '7 days' order by starts limit 1;
$$;

-- 학생: 게임이 끝날 때 점수 보내기 (기간 안 · 이벤트 게임 · 말이 되는 점수만, 최고 점수만 남김)
create or replace function public.member_game_score(p_id text, p_pin text, p_game text, p_score int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  ev private.game_event; mid text; old public.game_scores; best boolean := false;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  select * into ev from private.game_event where enabled and now() between starts and ends order by starts limit 1;
  if ev.id is null then return jsonb_build_object('ok', true, 'event', false); end if;
  if not (p_game = any (ev.games)) then return private.fail('이벤트 게임이 아니에요.'); end if;
  if p_score is null or p_score < 0 or p_score > coalesce((ev.max_score ->> p_game)::int, 1000) then
    return private.fail('점수를 확인할 수 없어요.');
  end if;
  select * into old from public.game_scores where event = ev.id and member_id = mid and game = p_game for update;
  if old.member_id is null then
    insert into public.game_scores (event, member_id, game, score) values (ev.id, mid, p_game, p_score);
    best := true;
  else
    if old.last_at > now() - interval '1 second' then return private.fail('너무 빨라요. 잠시 뒤에 다시 해주세요.'); end if;
    if old.plays >= 2000 then return private.fail('오늘은 그만! 내일 다시 도전해요.'); end if;
    best := p_score > old.score;
    update public.game_scores set plays = plays + 1, last_at = now(),
      score = greatest(score, p_score), at = case when p_score > score then now() else at end
    where event = ev.id and member_id = mid and game = p_game;
  end if;
  return jsonb_build_object('ok', true, 'event', true, 'best', best);
end $$;

-- 학생: 이벤트 안내 + 게임별 1등(이름 가림) + 내 최고 점수 · 내 순위
create or replace function public.member_game_board(p_id text, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  ev private.game_event; mid text; out jsonb := '{}'; g text; top record; mine public.game_scores; rk int;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  ev := private.game_now();
  if ev.id is null then return jsonb_build_object('ok', true, 'event', null); end if;
  foreach g in array ev.games loop
    select s.score, s.at, m.name into top from public.game_scores s join public.members m on m.id = s.member_id
     where s.event = ev.id and s.game = g order by s.score desc, s.at limit 1;
    select * into mine from public.game_scores where event = ev.id and member_id = mid and game = g;
    rk := case when mine.member_id is null then null else
      (select count(*) + 1 from public.game_scores s where s.event = ev.id and s.game = g
        and (s.score > mine.score or (s.score = mine.score and s.at < mine.at))) end;
    out := out || jsonb_build_object(g, jsonb_build_object(
      'top', case when top.score is null then null else jsonb_build_object('name', private.mask_name(top.name), 'score', top.score) end,
      'mine', mine.score, 'rank', rk,
      'players', (select count(*) from public.game_scores where event = ev.id and game = g)));
  end loop;
  return jsonb_build_object('ok', true, 'event', jsonb_build_object('id', ev.id, 'title', ev.title, 'starts', ev.starts, 'ends', ev.ends,
    'open', now() between ev.starts and ev.ends, 'games', to_jsonb(ev.games)), 'board', out);
end $$;

-- 관리자: 게임별 1~10등 (이름 · 수강 ID · 담당 · 점수 · 시각 · 판 수)
create or replace function public.admin_game_board()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare ev private.game_event; out jsonb := '{}'; g text;
begin
  if not public.is_admin() then return private.fail('관리자만 볼 수 있어요.'); end if;
  select * into ev from private.game_event order by starts desc limit 1;
  if ev.id is null then return jsonb_build_object('ok', true, 'event', null); end if;
  foreach g in array ev.games loop
    out := out || jsonb_build_object(g, coalesce((select jsonb_agg(jsonb_build_object('id', x.member_id, 'name', x.name,
        'teacher', substring(coalesce(x.memo, '') from '담당\s*([^\s·,]+)'), 'score', x.score, 'at', x.at, 'plays', x.plays) order by x.score desc, x.at)
      from (select s.*, m.name, m.memo from public.game_scores s join public.members m on m.id = s.member_id
            where s.event = ev.id and s.game = g order by s.score desc, s.at limit 10) x), '[]'));
  end loop;
  return jsonb_build_object('ok', true, 'event', jsonb_build_object('id', ev.id, 'title', ev.title, 'starts', ev.starts, 'ends', ev.ends,
    'open', ev.enabled and now() between ev.starts and ev.ends, 'enabled', ev.enabled, 'games', to_jsonb(ev.games),
    'players', (select count(distinct member_id) from public.game_scores where event = ev.id)), 'board', out);
end $$;


-- ===== leesh_game_event_points (2026-11-10) =====
-- 원장님 "동점 안 나오게, 다른 사람 단계는 안 보이게 점수로만": 이벤트 점수 = 단계 점수 + 빠르기 · 정확도 보너스 (js/games.js · js/games2.js).
-- 상한은 사람이 못 내는 점수로만: 따라치기 60음 · 계이름 3000개 · 날아라 2000기둥 수준
update private.game_event set max_score = '{"solfa": 1000000, "simon": 300000, "fly": 300000}' where id = '2026-11';

-- ===== leesh_student_sheets (2026-11-10) =====
-- 학생도 내 곡·자료(가사지 · 곡 노트 · 오디션 일정 …)를 보기만 (원장님 2026-11-10 "이전 시트에서 진행했던 가사지가 아직도 안 보인다"):
-- 예전 구글시트는 학생과 공유해서 가사 탭도 같이 봤는데, 홈페이지는 곡·자료를 선생님 · 관리자만 봤음.
-- OT · 양식 · 상담 · 등록 · 신상 · 개인정보 · 연락처 · 결제 · 수강료 · 학부모 제목의 시트와, 생년월일 + 사는 곳/주소/학교가 같이 적힌 시트(private.lesson_private)는
-- 학생에게 절대 안 보임 (원장님 2026-11-08 "OT는 선생님이랑 관리자만"). 휴대폰 번호는 가려서 보냄. 레슨 노트가 켜져 있을 때만(settings.student_notes).

create or replace function private.sheet_for_student(p_title text, p_sheet jsonb)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(p_title, '') !~ '(^|[^A-Za-z])(OT|ot|Ot)([^A-Za-z]|$)'
     and coalesce(p_title, '') !~ '오티|양식|상담|등록|신상|개인정보|연락처|결제|수강료|학부모|주소'
     and not private.lesson_private(p_sheet)
     and btrim(private.sheet_text(p_sheet)) <> '';
$$;
revoke all on function private.sheet_for_student(text, jsonb) from public, anon, authenticated;

-- 목록 (이름만, 표는 누를 때 따로)
create or replace function public.member_sheets(p_id text, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare who jsonb := private.check_ready(p_id, p_pin); on_ boolean;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  select coalesce(student_notes, false) into on_ from public.settings limit 1;
  if not coalesce(on_, false) then return jsonb_build_object('ok', true, 'items', '[]'::jsonb); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'teacher', t.name, 'updated', s.updated_at)
           order by s.tab_pos nulls last, s.pos nulls last, s.id)
    from public.lesson_sheets s left join public.teachers t on t.id = s.teacher_id
    where s.member_id = who ->> 'id' and private.sheet_for_student(s.title, s.sheet)), '[]'::jsonb));
end $$;

-- 한 장 (내 것 · 학생에게 보여도 되는 것만, 휴대폰 번호는 가림)
create or replace function public.member_sheet(p_id text, p_pin text, p_sid bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare who jsonb := private.check_ready(p_id, p_pin); s public.lesson_sheets; on_ boolean;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  select coalesce(student_notes, false) into on_ from public.settings limit 1;
  if not coalesce(on_, false) then return private.fail('지금은 볼 수 없어요.'); end if;
  select * into s from public.lesson_sheets where id = p_sid and member_id = who ->> 'id';
  if s.id is null or not private.sheet_for_student(s.title, s.sheet) then return private.fail('볼 수 없는 시트예요.'); end if;
  return jsonb_build_object('ok', true, 'id', s.id, 'title', s.title, 'sheet', private.mask_phone(s.sheet));
end $$;

revoke all on function public.member_sheets(text, text) from public;
revoke all on function public.member_sheet(text, text, bigint) from public;
grant execute on function public.member_sheets(text, text) to anon, authenticated;
grant execute on function public.member_sheet(text, text, bigint) to anon, authenticated;

-- ===== leesh_practice_photos (2026-11-10) =====
-- 연습 일지 사진 (원장님 2026-11-10 "학생들 연습일지에 사진 업로드"): 학생이 자기 연습 일지에 사진을 붙임.
-- 파일은 레슨 사진과 같은 비공개 보관함 lesson-photos/<수강 ID>/log/<이름> (긴 쪽 1600px로 줄여서).
-- 보는 사람: 그 학생 본인 · 담당 선생님(private.photo_teacher가 학생 폴더 전체를 봄) · 관리자. 학부모 · 다른 학생은 못 봄.
-- 일지를 지우면 사진 줄도 지워짐(파일은 남음, 자동 삭제 없음). 일지 하나에 10장, 하루 40장.

create table if not exists public.practice_photos (
  id bigserial primary key,
  member_id text not null references public.members (id) on delete cascade,
  log_id bigint not null references public.practice_logs (id) on delete cascade,
  path text not null unique check (path ~ '^[A-Za-z0-9]+/log/[a-z0-9]+\.(webp|jpg)$'),
  w int, h int,
  created_at timestamptz not null default now()
);
create index if not exists practice_photos_log on public.practice_photos (log_id);
create index if not exists practice_photos_member on public.practice_photos (member_id, created_at desc);
alter table public.practice_photos enable row level security;
revoke all on public.practice_photos from anon, authenticated;
drop policy if exists practice_photos_admin on public.practice_photos;
create policy practice_photos_admin on public.practice_photos for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.practice_photos to authenticated;
grant usage on sequence public.practice_photos_id_seq to authenticated;
drop trigger if exists zz_admin_log on public.practice_photos;
create trigger zz_admin_log after insert or update or delete on public.practice_photos for each row execute function private.log_change();

-- 보관함: 학생은 자기 폴더의 log/ 안에만 올리기 · 보기 · 지우기
create or replace function private.photo_log_owner(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select split_part(p_name, '/', 2) = 'log' and split_part(p_name, '/', 1) = private.song_owner();
$$;
revoke all on function private.photo_log_owner(text) from public, anon;
grant execute on function private.photo_log_owner(text) to authenticated;
drop policy if exists lesson_photos_log_add on storage.objects;
drop policy if exists lesson_photos_log_read on storage.objects;
drop policy if exists lesson_photos_log_remove on storage.objects;
create policy lesson_photos_log_add on storage.objects for insert to authenticated with check (bucket_id = 'lesson-photos' and private.photo_log_owner(name));
create policy lesson_photos_log_read on storage.objects for select to authenticated using (bucket_id = 'lesson-photos' and private.photo_log_owner(name));
create policy lesson_photos_log_remove on storage.objects for delete to authenticated using (bucket_id = 'lesson-photos' and private.photo_log_owner(name));

-- 학생: 내 연습 일지 사진 목록
create or replace function public.member_log_photos(p_id text, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare who jsonb := private.check_ready(p_id, p_pin);
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'log', p.log_id, 'path', p.path, 'w', p.w, 'h', p.h) order by p.id)
    from public.practice_photos p where p.member_id = who ->> 'id'), '[]'::jsonb));
end $$;

-- 학생: 올린 파일을 일지에 붙이기 (내 일지 · 내 폴더 · 파일이 정말 올라갔는지 확인)
create or replace function public.member_log_photo_add(p_id text, p_pin text, p_log bigint, p_path text, p_w int default null, p_h int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare who jsonb := private.check_ready(p_id, p_pin); mid text; new_id bigint;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  if not exists (select 1 from public.practice_logs where id = p_log and member_id = mid) then return private.fail('일지를 찾을 수 없어요.'); end if;
  if coalesce(p_path, '') !~ ('^' || mid || '/log/[a-z0-9]+\.(webp|jpg)$') then return private.fail('사진 이름이 맞지 않아요.'); end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'lesson-photos' and o.name = p_path) then return private.fail('사진이 아직 안 올라갔어요. 다시 해주세요.'); end if;
  if (select count(*) from public.practice_photos where log_id = p_log) >= 10 then return private.fail('일지 하나에 사진은 10장까지예요.'); end if;
  if (select count(*) from public.practice_photos where member_id = mid and created_at > now() - interval '1 day') >= 40 then return private.fail('오늘은 사진을 많이 올렸어요. 내일 다시 올려주세요.'); end if;
  insert into public.practice_photos (member_id, log_id, path, w, h)
  values (mid, p_log, p_path, case when p_w between 1 and 10000 then p_w end, case when p_h between 1 and 10000 then p_h end)
  on conflict (path) do nothing returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id);
end $$;

-- 학생: 사진 빼기 (줄 지우고, 파일 지울 이름을 돌려줌)
create or replace function public.member_log_photo_delete(p_id text, p_pin text, p_photo bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare who jsonb := private.check_ready(p_id, p_pin); p text;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  delete from public.practice_photos where id = p_photo and member_id = who ->> 'id' returning path into p;
  if p is null then return private.fail('사진을 찾을 수 없어요.'); end if;
  return jsonb_build_object('ok', true, 'path', p);
end $$;

-- 선생님: 담당 학생의 연습 일지 사진
create or replace function public.teacher_log_photos(p_member text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.teachers := private.my_teacher();
begin
  if t.id is null then return private.fail('선생님 연결이 필요해요.'); end if;
  if not private.teaches(t, p_member) then return private.fail('담당 학생이 아니에요.'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'log', p.log_id, 'path', p.path, 'w', p.w, 'h', p.h) order by p.id)
    from public.practice_photos p where p.member_id = p_member), '[]'::jsonb));
end $$;

revoke all on function public.member_log_photos(text, text) from public;
revoke all on function public.member_log_photo_add(text, text, bigint, text, int, int) from public;
revoke all on function public.member_log_photo_delete(text, text, bigint) from public;
revoke all on function public.teacher_log_photos(text) from public, anon;
grant execute on function public.member_log_photos(text, text) to anon, authenticated;
grant execute on function public.member_log_photo_add(text, text, bigint, text, int, int) to anon, authenticated;
grant execute on function public.member_log_photo_delete(text, text, bigint) to anon, authenticated;
grant execute on function public.teacher_log_photos(text) to authenticated;

-- ===== leesh_teacher_log_ids (2026-11-10) =====
-- 선생님 화면 연습 일지에 일지 번호(id)도 보내기 → 그 일지의 사진을 붙여 보여줌 (2026-11-10 연습 일지 사진)
do $do$
declare d text := pg_get_functiondef('public.teacher_student(text)'::regprocedure);
begin
  if position($q$jsonb_build_object('id', l.id, 'day', l.day$q$ in d) = 0 then
    d := replace(d, $q$jsonb_build_object('day', l.day, 'minutes', l.minutes$q$, $q$jsonb_build_object('id', l.id, 'day', l.day, 'minutes', l.minutes$q$);
    execute d;
  end if;
end $do$;

-- ===== leesh_kakao_auto (2026-11-10) =====
-- 카톡 자동발송 (원장님 2026-11-10): 상담 예약 · 컨설팅 · 특강 · 첫 레슨 · 보강 전날 오후 6시에 솔라피 알림톡으로 리마인더.
-- 솔라피 열쇠(API Key · Secret) · 발신번호 · 채널(pfId) · 템플릿 ID는 관리자 화면 설정에만 넣음(채팅 · 저장소 금지), private에 보관.
-- 받는 번호: 학생은 학생관리 시트 '회차·결제 관리' P열 "결제 연락처"(시트 담당 세션의 스크립트가 sheet_sync_contacts로 보냄, 읽기만) ·
-- 상담은 상담 신청서 번호 · 일정마다 직접 적은 번호가 있으면 그걸 먼저. 번호는 관리자만, 화면엔 가운데를 가려서.

create table if not exists private.solapi (
  id int primary key default 1 check (id = 1),
  api_key text, api_secret text, sender text, pf_id text,
  templates jsonb not null default '{}',
  send_hour int not null default 18 check (send_hour between 8 and 21),
  enabled boolean not null default false,
  last_run_at timestamptz, last_note text
);
insert into private.solapi (id) values (1) on conflict do nothing;
revoke all on private.solapi from public, anon, authenticated;

create table if not exists private.member_contacts (
  member_id text primary key references public.members (id) on delete cascade,
  phone text not null check (phone ~ '^01[0-9]{8,9}$'),
  updated_at timestamptz not null default now()
);
revoke all on private.member_contacts from public, anon, authenticated;

create table if not exists public.reminders (
  id bigserial primary key,
  kind text not null check (kind in ('상담', '컨설팅', '특강', '첫 레슨', '보강')),
  member_id text references public.members (id) on delete set null,
  consult_id bigint references public.consults (id) on delete set null,
  name text not null check (char_length(name) between 1 and 30),
  phone text check (phone is null or phone ~ '^01[0-9]{8,9}$'),
  at timestamptz not null,
  place text check (char_length(coalesce(place, '')) <= 60),
  memo text check (char_length(coalesce(memo, '')) <= 200),
  status text not null default '예정' check (status in ('예정', '보냄', '실패', '취소')),
  sent_at timestamptz,
  result text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reminders_at on public.reminders (at);
alter table public.reminders enable row level security;
revoke all on public.reminders from anon, authenticated;
drop trigger if exists zz_admin_log on public.reminders;
create trigger zz_admin_log after insert or update or delete on public.reminders for each row execute function private.log_change();

create or replace function private.phone_norm(p text)
returns text language sql immutable set search_path = '' as $$
  select m[1] || m[2] || m[3] from regexp_matches(coalesce(p, ''), '(01[016789])[- .)]*([0-9]{3,4})[- .]*([0-9]{4})') m limit 1;
$$;
create or replace function private.phone_mask(p text)
returns text language sql immutable set search_path = '' as $$
  select case when p is null then null else left(p, 3) || '-****-' || right(p, 4) end;
$$;

-- 시트 → 연락처 (시트 담당 세션의 Apps Script가 수강ID 명단과 같은 열쇠로 부름). 빈 칸이면 그 학생 번호를 지움.
create or replace function public.sheet_sync_contacts(p_key text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s private.sheet_sync; r jsonb; v_id text; v_phone text; saved int := 0; cleared int := 0; skipped int := 0;
begin
  select * into s from private.sheet_sync where id = 1;
  if s.key_hash is null or s.key_hash <> extensions.digest(coalesce(p_key, ''), 'sha256') then return private.fail('연결 열쇠가 맞지 않아요.'); end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then return private.fail('보낸 목록이 맞지 않아요.'); end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_id := upper(trim(coalesce(r ->> 'id', '')));
    if not exists (select 1 from public.members where id = v_id) then skipped := skipped + 1; continue; end if;
    v_phone := private.phone_norm(r ->> 'phone');
    if v_phone is null then
      delete from private.member_contacts where member_id = v_id;
      if found then cleared := cleared + 1; end if;
    else
      insert into private.member_contacts (member_id, phone) values (v_id, v_phone)
      on conflict (member_id) do update set phone = excluded.phone, updated_at = now() where private.member_contacts.phone <> excluded.phone;
      saved := saved + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'saved', saved, 'cleared', cleared, 'skipped', skipped);
end $$;
revoke all on function public.sheet_sync_contacts(text, jsonb) from public;
grant execute on function public.sheet_sync_contacts(text, jsonb) to anon, authenticated;

-- 솔라피 부르기 (HMAC-SHA256 서명)
create or replace function private.solapi_call(p_method text, p_path text, p_body jsonb default null, out status int, out content text)
returns record language plpgsql security definer set search_path = '' as $$
declare c private.solapi; d text; salt text; sig text; res record;
begin
  select * into c from private.solapi where id = 1;
  if c.api_key is null or c.api_secret is null then status := 0; content := '솔라피 연결 전'; return; end if;
  d := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  salt := encode(extensions.gen_random_bytes(16), 'hex');
  sig := encode(extensions.hmac(d || salt, c.api_secret, 'sha256'), 'hex');
  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT', '10');
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '20');
  begin
    select h.status, h.content into res from extensions.http((
      p_method, 'https://api.solapi.com' || p_path,
      array[extensions.http_header('Authorization', 'HMAC-SHA256 apiKey=' || c.api_key || ', date=' || d || ', salt=' || salt || ', signature=' || sig)],
      'application/json', case when p_body is null then null else p_body::text end)::extensions.http_request) h;
    status := res.status; content := res.content;
  exception when others then status := 0; content := sqlerrm;
  end;
end $$;
revoke all on function private.solapi_call(text, text, jsonb) from public, anon, authenticated;

-- 알림톡 문구에 들어갈 값: #{이름} · #{일시} · #{장소} · #{안내}
create or replace function private.reminder_when(p timestamptz)
returns text language sql stable set search_path = '' as $$
  select to_char(k, 'FMMM"월" FMDD"일"') || '(' || (array['일','월','화','수','목','금','토'])[extract(dow from k)::int + 1] || ') '
       || case when extract(hour from k) < 12 then '오전 ' else '오후 ' end
       || (case when extract(hour from k)::int % 12 = 0 then 12 else extract(hour from k)::int % 12 end)::text
       || case when extract(minute from k) = 0 then '시' else ':' || to_char(k, 'MI') end
  from (select p at time zone 'Asia/Seoul' k) x;
$$;

create or replace function private.reminder_phone(r public.reminders)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(r.phone,
    (select phone from private.member_contacts where member_id = r.member_id),
    (select private.phone_norm(phone) from public.consults where id = r.consult_id));
$$;

-- 한 건 보내기
create or replace function private.reminder_send(p_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c private.solapi; r public.reminders; ph text; tpl text; res record; j jsonb; ok boolean; why text;
begin
  select * into c from private.solapi where id = 1;
  select * into r from public.reminders where id = p_id for update;
  if r.id is null then return private.fail('일정을 찾을 수 없어요.'); end if;
  if r.status = '취소' then return private.fail('취소된 일정이에요.'); end if;
  tpl := c.templates ->> r.kind;
  ph := private.reminder_phone(r);
  if c.api_key is null or c.sender is null or c.pf_id is null then why := '솔라피 연결 전이에요 (관리자 → 카톡 자동발송 → 솔라피 연결).';
  elsif coalesce(tpl, '') = '' then why := '"' || r.kind || '" 알림톡 템플릿 ID가 비어 있어요.';
  elsif ph is null then why := '받는 전화번호가 없어요.';
  end if;
  if why is not null then
    update public.reminders set status = '실패', result = why, updated_at = now() where id = r.id;
    return private.fail(why);
  end if;
  select * into res from private.solapi_call('POST', '/messages/v4/send-many/detail', jsonb_build_object('messages', jsonb_build_array(jsonb_build_object(
    'to', ph, 'from', c.sender,
    'kakaoOptions', jsonb_build_object('pfId', c.pf_id, 'templateId', tpl, 'disableSms', true,
      'variables', jsonb_build_object('#{이름}', r.name, '#{일시}', private.reminder_when(r.at),
                                      '#{장소}', coalesce(nullif(r.place, ''), '이송희보컬레슨'), '#{안내}', coalesce(nullif(r.memo, ''), '-')))))));
  begin j := res.content::jsonb; exception when others then j := null; end;
  ok := res.status between 200 and 299 and coalesce(jsonb_array_length(j -> 'failedMessageList'), 0) = 0;
  why := case when ok then '보냄' else left(coalesce(j -> 'failedMessageList' -> 0 ->> 'statusMessage', j ->> 'errorMessage', j ->> 'message', res.content, '응답 없음'), 200) end;
  update public.reminders set status = case when ok then '보냄' else '실패' end, sent_at = case when ok then now() else sent_at end,
    result = why, updated_at = now() where id = r.id;
  return jsonb_build_object('ok', ok, 'error', case when ok then null else why end);
end $$;
revoke all on function private.reminder_send(bigint) from public, anon, authenticated;

-- 매시 2분: 보내는 시각(기본 18시) ~ 22시 사이에, 내일 일정 중 아직 안 보낸 것 (18시 뒤에 넣은 내일 일정도 22시까지는 저절로)
create or replace function private.reminders_daily()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c private.solapi; h int := extract(hour from now() at time zone 'Asia/Seoul'); tmr date := (now() at time zone 'Asia/Seoul')::date + 1;
  r record; sent int := 0; failed int := 0; x jsonb;
begin
  select * into c from private.solapi where id = 1;
  if not c.enabled or h < c.send_hour or h >= 22 then return jsonb_build_object('ok', true, 'skip', true); end if;
  for r in select id from public.reminders where status = '예정' and (at at time zone 'Asia/Seoul')::date = tmr order by at limit 200 loop
    x := private.reminder_send(r.id);
    if (x ->> 'ok')::boolean then sent := sent + 1; else failed := failed + 1; end if;
  end loop;
  update private.solapi set last_run_at = now(), last_note = '보냄 ' || sent || ' · 실패 ' || failed where id = 1 and (sent + failed) > 0;
  return jsonb_build_object('ok', true, 'sent', sent, 'failed', failed);
end $$;
revoke all on function private.reminders_daily() from public, anon, authenticated;
select cron.schedule('leesh_reminders', '2 * * * *', 'select private.reminders_daily()');

/* ---------------- 관리자 ---------------- */
create or replace function public.admin_solapi_status()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c private.solapi;
begin
  if not public.is_admin() then return private.fail('관리자만 볼 수 있어요.'); end if;
  select * into c from private.solapi where id = 1;
  return jsonb_build_object('ok', true, 'connected', c.api_key is not null and c.api_secret is not null,
    'key_tail', case when c.api_key is null then null else '…' || right(c.api_key, 4) end,
    'sender', private.phone_mask(c.sender), 'pf_id', c.pf_id is not null, 'templates', c.templates,
    'send_hour', c.send_hour, 'enabled', c.enabled, 'last_run_at', c.last_run_at, 'last_note', c.last_note,
    'contacts', (select count(*) from private.member_contacts));
end $$;

-- 연결: 빈 칸은 그대로 둠. 넣은 열쇠로 잔액을 물어 맞는지 확인
create or replace function public.admin_solapi_set(p_key text default null, p_secret text default null, p_sender text default null, p_pf text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare res record; j jsonb; snd text := private.phone_norm(p_sender);
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  if nullif(trim(coalesce(p_sender, '')), '') is not null and snd is null and trim(p_sender) !~ '^0[2-9][0-9]{7,10}$' then return private.fail('발신번호를 다시 확인해주세요.'); end if;
  update private.solapi set
    api_key = coalesce(nullif(trim(coalesce(p_key, '')), ''), api_key),
    api_secret = coalesce(nullif(trim(coalesce(p_secret, '')), ''), api_secret),
    sender = coalesce(snd, nullif(regexp_replace(coalesce(p_sender, ''), '[^0-9]', '', 'g'), ''), sender),
    pf_id = coalesce(nullif(trim(coalesce(p_pf, '')), ''), pf_id)
  where id = 1;
  select * into res from private.solapi_call('GET', '/cash/v1/balance');
  begin j := res.content::jsonb; exception when others then j := null; end;
  if res.status between 200 and 299 then
    return jsonb_build_object('ok', true, 'balance', j -> 'balance', 'point', j -> 'point');
  end if;
  return private.fail('솔라피가 열쇠를 받지 않았어요: ' || left(coalesce(j ->> 'errorMessage', j ->> 'message', res.content, '응답 없음'), 120));
end $$;

create or replace function public.admin_solapi_options(p_templates jsonb default null, p_send_hour int default null, p_enabled boolean default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t jsonb := '{}'; k text;
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  if p_templates is not null then
    foreach k in array array['상담', '컨설팅', '특강', '첫 레슨', '보강'] loop
      if nullif(trim(coalesce(p_templates ->> k, '')), '') is not null then
        if trim(p_templates ->> k) !~ '^[A-Za-z0-9_-]{6,60}$' then return private.fail('"' || k || '" 템플릿 ID를 다시 확인해주세요.'); end if;
        t := t || jsonb_build_object(k, trim(p_templates ->> k));
      end if;
    end loop;
    update private.solapi set templates = t where id = 1;
  end if;
  if p_send_hour is not null then
    if p_send_hour not between 8 and 21 then return private.fail('보내는 시각은 8시 ~ 21시 사이로 골라주세요.'); end if;
    update private.solapi set send_hour = p_send_hour where id = 1;
  end if;
  if p_enabled is not null then update private.solapi set enabled = p_enabled where id = 1; end if;
  return public.admin_solapi_status();
end $$;

create or replace function public.admin_solapi_off()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  update private.solapi set api_key = null, api_secret = null, enabled = false where id = 1;
  return jsonb_build_object('ok', true);
end $$;

-- 일정 목록 (번호는 가려서)
create or replace function public.admin_reminders(p_from date default null, p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 볼 수 있어요.'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'member', r.member_id, 'consult', r.consult_id, 'name', r.name,
      'at', r.at, 'when', private.reminder_when(r.at), 'place', r.place, 'memo', r.memo, 'status', r.status, 'sent_at', r.sent_at,
      'result', r.result, 'phone', r.ph, 'own_phone', r.phone is not null) order by r.at)
    from (select r0.*, private.phone_mask(private.reminder_phone(r0)) ph from public.reminders r0
          where r0.at >= coalesce(p_from, (now() at time zone 'Asia/Seoul')::date - 7)::timestamp at time zone 'Asia/Seoul'
          order by r0.at limit greatest(1, least(coalesce(p_limit, 200), 500))) r), '[]'::jsonb));
end $$;

-- 일정 넣기 · 고치기 (특강처럼 여러 학생이면 p_members로 한 번에 여러 줄)
create or replace function public.admin_reminder_save(p_id bigint, p_kind text, p_at timestamptz, p_place text default null, p_memo text default null,
  p_members text[] default null, p_consult bigint default null, p_name text default null, p_phone text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me text := lower(auth.jwt() ->> 'email'); m public.members; c public.consults; ph text := private.phone_norm(p_phone); n int := 0; mid text;
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  if p_kind not in ('상담', '컨설팅', '특강', '첫 레슨', '보강') then return private.fail('종류를 골라주세요.'); end if;
  if p_at is null or p_at < now() - interval '1 day' then return private.fail('날짜 · 시간을 확인해주세요.'); end if;
  if nullif(trim(coalesce(p_phone, '')), '') is not null and ph is null then return private.fail('휴대폰 번호를 다시 확인해주세요.'); end if;
  if p_id is not null then
    update public.reminders set kind = p_kind, at = p_at, place = nullif(trim(coalesce(p_place, '')), ''), memo = nullif(trim(coalesce(p_memo, '')), ''),
      name = coalesce(nullif(trim(coalesce(p_name, '')), ''), name), phone = case when p_phone is null then phone else ph end,
      status = case when status = '보냄' and at = p_at then status else '예정' end, result = case when status = '보냄' and at = p_at then result else null end,
      updated_at = now()
    where id = p_id;
    if not found then return private.fail('일정을 찾을 수 없어요.'); end if;
    return jsonb_build_object('ok', true, 'count', 1);
  end if;
  if p_consult is not null then
    select * into c from public.consults where id = p_consult;
    if c.id is null then return private.fail('상담 신청을 찾을 수 없어요.'); end if;
    insert into public.reminders (kind, consult_id, name, phone, at, place, memo, created_by)
    values (p_kind, c.id, left(coalesce(nullif(trim(coalesce(p_name, '')), ''), c.name), 30), ph, p_at, nullif(trim(coalesce(p_place, '')), ''), nullif(trim(coalesce(p_memo, '')), ''), me);
    return jsonb_build_object('ok', true, 'count', 1);
  end if;
  if coalesce(array_length(p_members, 1), 0) = 0 then
    if nullif(trim(coalesce(p_name, '')), '') is null or ph is null then return private.fail('학생을 고르거나, 이름과 번호를 적어주세요.'); end if;
    insert into public.reminders (kind, name, phone, at, place, memo, created_by)
    values (p_kind, left(trim(p_name), 30), ph, p_at, nullif(trim(coalesce(p_place, '')), ''), nullif(trim(coalesce(p_memo, '')), ''), me);
    return jsonb_build_object('ok', true, 'count', 1);
  end if;
  if array_length(p_members, 1) > 100 then return private.fail('한 번에 100명까지예요.'); end if;
  foreach mid in array p_members loop
    select * into m from public.members where id = upper(trim(mid));
    if m.id is null then continue; end if;
    insert into public.reminders (kind, member_id, name, phone, at, place, memo, created_by)
    values (p_kind, m.id, m.name, case when array_length(p_members, 1) = 1 then ph end, p_at, nullif(trim(coalesce(p_place, '')), ''), nullif(trim(coalesce(p_memo, '')), ''), me);
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'count', n);
end $$;

create or replace function public.admin_reminder_cancel(p_id bigint, p_delete boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  if p_delete then delete from public.reminders where id = p_id;
  else update public.reminders set status = '취소', updated_at = now() where id = p_id and status <> '보냄'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- 지금 보내기 (시험 · 늦게 넣은 일정)
create or replace function public.admin_reminder_send(p_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  update public.reminders set status = '예정' where id = p_id and status = '실패';
  return private.reminder_send(p_id);
end $$;

-- 번호 확인용: 이 학생에게 보낼 번호가 있는지 (가려서)
create or replace function public.admin_member_phones(p_ids text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 볼 수 있어요.'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((select jsonb_object_agg(member_id, private.phone_mask(phone))
    from private.member_contacts where member_id = any (coalesce(p_ids, '{}'))), '{}'::jsonb));
end $$;

revoke all on function public.admin_solapi_status() from public, anon;
revoke all on function public.admin_solapi_set(text, text, text, text) from public, anon;
revoke all on function public.admin_solapi_options(jsonb, int, boolean) from public, anon;
revoke all on function public.admin_solapi_off() from public, anon;
revoke all on function public.admin_reminders(date, int) from public, anon;
revoke all on function public.admin_reminder_save(bigint, text, timestamptz, text, text, text[], bigint, text, text) from public, anon;
revoke all on function public.admin_reminder_cancel(bigint, boolean) from public, anon;
revoke all on function public.admin_reminder_send(bigint) from public, anon;
revoke all on function public.admin_member_phones(text[]) from public, anon;
grant execute on function public.admin_solapi_status(), public.admin_solapi_set(text, text, text, text), public.admin_solapi_options(jsonb, int, boolean),
  public.admin_solapi_off(), public.admin_reminders(date, int), public.admin_reminder_save(bigint, text, timestamptz, text, text, text[], bigint, text, text),
  public.admin_reminder_cancel(bigint, boolean), public.admin_reminder_send(bigint), public.admin_member_phones(text[]) to authenticated;
revoke all on function private.phone_norm(text) from public, anon, authenticated;
revoke all on function private.phone_mask(text) from public, anon, authenticated;
revoke all on function private.reminder_when(timestamptz) from public, anon, authenticated;
revoke all on function private.reminder_phone(public.reminders) from public, anon, authenticated;

-- ===== leesh_kakao_texts (2026-11-10) =====
-- 카톡 자동발송 문구 (원장님 2026-11-10 "바꿀 수 있는 문구 여러 개, 우리가 수정해서 솔라피에 신청"):
-- 종류마다 관리자 화면에서 고친 알림톡 문구를 저장 (솔라피 검수 신청용 원본 · 관리자 미리보기). 실제로 나가는 글은 솔라피에 승인된 템플릿.
alter table private.solapi add column if not exists texts jsonb not null default '{}';

create or replace function public.admin_solapi_texts(p_texts jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t jsonb := '{}'; k text; v text;
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  foreach k in array array['상담', '컨설팅', '특강', '첫 레슨', '보강'] loop
    v := p_texts ->> k;
    if v is null then continue; end if;
    v := btrim(replace(v, E'\r', ''));
    if char_length(v) > 1000 then return private.fail('"' || k || '" 문구가 1000자를 넘어요 (알림톡은 1000자까지).'); end if;
    if v <> '' then t := t || jsonb_build_object(k, v); end if;
  end loop;
  update private.solapi set texts = t where id = 1;
  return jsonb_build_object('ok', true, 'texts', t);
end $$;
revoke all on function public.admin_solapi_texts(jsonb) from public, anon;
grant execute on function public.admin_solapi_texts(jsonb) to authenticated;

create or replace function public.admin_solapi_status()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c private.solapi;
begin
  if not public.is_admin() then return private.fail('관리자만 볼 수 있어요.'); end if;
  select * into c from private.solapi where id = 1;
  return jsonb_build_object('ok', true, 'connected', c.api_key is not null and c.api_secret is not null,
    'key_tail', case when c.api_key is null then null else '…' || right(c.api_key, 4) end,
    'sender', private.phone_mask(c.sender), 'pf_id', c.pf_id is not null, 'templates', c.templates, 'texts', c.texts,
    'send_hour', c.send_hour, 'enabled', c.enabled, 'last_run_at', c.last_run_at, 'last_note', c.last_note,
    'contacts', (select count(*) from private.member_contacts));
end $$;

-- ===== leesh_review_height_weight (2026-11-10) =====
-- 오디션 후기에 키 · 몸무게 (원장님 2026-11-10: 성별 · 생년월일과 기획사명 · 오디션 일자 사이). 선택 칸, 20자까지.
alter table public.audition_reviews add column if not exists height text check (char_length(coalesce(height, '')) <= 20);
alter table public.audition_reviews add column if not exists weight text check (char_length(coalesce(weight, '')) <= 20);
CREATE OR REPLACE FUNCTION private.review_json(r public.audition_reviews)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object('id', r.id, 'date', r.audition_date, 'company', r.company, 'gender', r.gender, 'birth', r.birth, 'height', r.height, 'weight', r.weight,
    'songVocal', r.song_vocal, 'songDance', r.song_dance, 'asked', r.asked, 'tip', r.tip, 'process', r.process, 'note', r.note,
    'at', r.created_at, 'updated', r.updated_at);
$function$;
CREATE OR REPLACE FUNCTION public.member_review_save(p_id text, p_pin text, p_review bigint, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  mid text; d date; today date := private.now_kst()::date; v_id bigint; v_name text;
  f_company text; f_gender text; f_birth text; f_height text; f_weight text; f_vocal text; f_dance text; f_asked text; f_tip text; f_process text; f_note text;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  if jsonb_typeof(p_data) <> 'object' then return private.fail('보낸 내용이 이상해요.'); end if;
  f_gender := nullif(trim(coalesce(p_data ->> 'gender', '')), '');
  if f_gender is null or f_gender not in ('남', '여') then return private.fail('성별을 골라주세요.'); end if;
  f_birth := left(trim(coalesce(p_data ->> 'birth', '')), 20);
  if f_birth !~ '\d{2}' then return private.fail('생년월일을 적어주세요. 예) 2009.03.15'); end if;
  f_height := nullif(left(trim(coalesce(p_data ->> 'height', '')), 20), '');
  f_weight := nullif(left(trim(coalesce(p_data ->> 'weight', '')), 20), '');
  f_company := left(trim(coalesce(p_data ->> 'company', '')), 60);
  if f_company = '' then return private.fail('기획사 이름을 적어주세요.'); end if;
  begin d := (p_data ->> 'date')::date; exception when others then return private.fail('오디션 일자를 골라주세요.'); end;
  if d is null or d > today or d < today - 730 then return private.fail('오디션 일자는 오늘부터 2년 전까지로 골라주세요.'); end if;
  f_vocal := nullif(left(trim(coalesce(p_data ->> 'songVocal', '')), 300), '');
  f_dance := nullif(left(trim(coalesce(p_data ->> 'songDance', '')), 300), '');
  f_asked := nullif(trim(coalesce(p_data ->> 'asked', '')), '');
  f_tip := nullif(trim(coalesce(p_data ->> 'tip', '')), '');
  f_process := nullif(trim(coalesce(p_data ->> 'process', '')), '');
  f_note := nullif(trim(coalesce(p_data ->> 'note', '')), '');
  if char_length(coalesce(f_asked, '')) > 2000 or char_length(coalesce(f_tip, '')) > 2000
     or char_length(coalesce(f_process, '')) > 2000 or char_length(coalesce(f_note, '')) > 1000 then
    return private.fail('글이 너무 길어요. 조금 줄여주세요.');
  end if;
  if coalesce(f_vocal, f_dance, f_asked, f_tip, f_process, f_note) is null then return private.fail('준비한 곡이나 후기를 하나 이상 적어주세요.'); end if;
  if p_review is null then
    if (select count(*) from public.audition_reviews where member_id = mid and created_at > now() - interval '1 day') >= 10 then
      return private.fail('하루에 10개까지 쓸 수 있어요.');
    end if;
    insert into public.audition_reviews (member_id, audition_date, company, gender, birth, height, weight, song_vocal, song_dance, asked, tip, process, note)
    values (mid, d, f_company, f_gender, f_birth, f_height, f_weight, f_vocal, f_dance, f_asked, f_tip, f_process, f_note)
    returning id into v_id;
    select name into v_name from public.members where id = mid;
    perform private.notify('📝 오디션 후기 · ' || coalesce(v_name, mid) || ' · ' || f_company || ' (' || to_char(d, 'MM/DD') || ')');
    return jsonb_build_object('ok', true, 'id', v_id, 'new', true);
  end if;
  update public.audition_reviews set audition_date = d, company = f_company, gender = f_gender, birth = f_birth, height = f_height, weight = f_weight, song_vocal = f_vocal,
    song_dance = f_dance, asked = f_asked, tip = f_tip, process = f_process, note = f_note, updated_at = now()
  where id = p_review and member_id = mid returning id into v_id;
  if v_id is null then return private.fail('후기를 찾을 수 없어요.'); end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'new', false);
end $function$;

-- ===== leesh_teacher_visit_month (2026-11-11) =====
-- 선생님 화면 학생 페이지 "한눈에 보기"에 이번 달(한국 시간) 학원 내방 오디션 일정 + 이 학생의 신청 여부 (원장님 2026-11-11)
create or replace function public.teacher_visit_month(p_member text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  t public.teachers := private.my_teacher();
  d date := (now() at time zone 'Asia/Seoul')::date;
begin
  if t.id is null then return private.fail('선생님 연결이 필요해요.'); end if;
  if not private.teaches(t, p_member) then return private.fail('담당 학생이 아니에요.'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', n.id, 'company', n.company, 'date', n.event_date,
             'deadline', coalesce(n.deadline, n.event_date - 1),
             'applied', a.id is not null, 'field', a.field, 'note', a.note)
           order by n.event_date, n.id)
    from public.audition_news n
    left join public.visit_applications a on a.news_id = n.id and a.member_id = p_member
    where n.kind = '내방' and n.published and n.event_date is not null
      and date_trunc('month', n.event_date) = date_trunc('month', d)), '[]'::jsonb));
end $$;
revoke all on function public.teacher_visit_month(text) from public, anon;
grant execute on function public.teacher_visit_month(text) to authenticated;

-- ===== leesh_kakao_vars (2026-11-11) =====
-- 원장님 리마인더 문구 (2026-11-11): 자리 #{시간} #{강사} #{클래스} #{특강} 더함
alter table public.reminders add column if not exists teacher text, add column if not exists track text, add column if not exists topic text;

create or replace function private.reminder_time(p timestamptz) returns text language sql stable set search_path = '' as $$
  select case when extract(hour from k) < 12 then '오전 ' else '오후 ' end
       || (case when extract(hour from k)::int % 12 = 0 then 12 else extract(hour from k)::int % 12 end)::text
       || case when extract(minute from k) = 0 then '시' else ':' || to_char(k, 'MI') end
  from (select p at time zone 'Asia/Seoul' k) x;
$$;

-- 학생의 담당 선생님 이름 (메모 "담당 ○○○", 원장님이면 이송희)
create or replace function private.reminder_teacher(m public.members) returns text language sql stable set search_path = '' as $$
  select case when t = '원장님' then '이송희' else t end from (select substring(m.memo from '담당\s*([^\s·,]+)') t) x;
$$;

drop function if exists public.admin_reminder_save(bigint, text, timestamptz, text, text, text[], bigint, text, text);
create or replace function public.admin_reminder_save(p_id bigint, p_kind text, p_at timestamptz, p_place text default null, p_memo text default null,
  p_members text[] default null, p_consult bigint default null, p_name text default null, p_phone text default null,
  p_teacher text default null, p_track text default null, p_topic text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me text := lower(auth.jwt() ->> 'email'); m public.members; c public.consults; ph text := private.phone_norm(p_phone); n int := 0; mid text;
  v_place text := nullif(trim(coalesce(p_place, '')), ''); v_memo text := nullif(trim(coalesce(p_memo, '')), '');
  v_t text := left(nullif(trim(coalesce(p_teacher, '')), ''), 30); v_tr text := left(nullif(trim(coalesce(p_track, '')), ''), 30); v_to text := left(nullif(trim(coalesce(p_topic, '')), ''), 40);
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  if p_kind not in ('상담', '컨설팅', '특강', '첫 레슨', '보강') then return private.fail('종류를 골라주세요.'); end if;
  if p_at is null or p_at < now() - interval '1 day' then return private.fail('날짜 · 시간을 확인해주세요.'); end if;
  if nullif(trim(coalesce(p_phone, '')), '') is not null and ph is null then return private.fail('휴대폰 번호를 다시 확인해주세요.'); end if;
  if p_id is not null then
    update public.reminders set kind = p_kind, at = p_at, place = v_place, memo = v_memo, teacher = coalesce(v_t, teacher), track = v_tr, topic = v_to,
      name = coalesce(nullif(trim(coalesce(p_name, '')), ''), name), phone = case when p_phone is null then phone else ph end,
      status = case when status = '보냄' and at = p_at then status else '예정' end, result = case when status = '보냄' and at = p_at then result else null end,
      updated_at = now()
    where id = p_id;
    if not found then return private.fail('일정을 찾을 수 없어요.'); end if;
    return jsonb_build_object('ok', true, 'count', 1);
  end if;
  if p_consult is not null then
    select * into c from public.consults where id = p_consult;
    if c.id is null then return private.fail('상담 신청을 찾을 수 없어요.'); end if;
    insert into public.reminders (kind, consult_id, name, phone, at, place, memo, teacher, track, topic, created_by)
    values (p_kind, c.id, left(coalesce(nullif(trim(coalesce(p_name, '')), ''), c.name), 30), ph, p_at, v_place, v_memo, v_t, v_tr, v_to, me);
    return jsonb_build_object('ok', true, 'count', 1);
  end if;
  if coalesce(array_length(p_members, 1), 0) = 0 then
    if nullif(trim(coalesce(p_name, '')), '') is null or ph is null then return private.fail('학생을 고르거나, 이름과 번호를 적어주세요.'); end if;
    insert into public.reminders (kind, name, phone, at, place, memo, teacher, track, topic, created_by)
    values (p_kind, left(trim(p_name), 30), ph, p_at, v_place, v_memo, v_t, v_tr, v_to, me);
    return jsonb_build_object('ok', true, 'count', 1);
  end if;
  if array_length(p_members, 1) > 100 then return private.fail('한 번에 100명까지예요.'); end if;
  foreach mid in array p_members loop
    select * into m from public.members where id = upper(trim(mid));
    if m.id is null then continue; end if;
    insert into public.reminders (kind, member_id, name, phone, at, place, memo, teacher, track, topic, created_by)
    values (p_kind, m.id, m.name, case when array_length(p_members, 1) = 1 then ph end, p_at, v_place, v_memo,
            coalesce(v_t, private.reminder_teacher(m)), v_tr, v_to, me);
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'count', n);
end $$;
revoke all on function public.admin_reminder_save(bigint, text, timestamptz, text, text, text[], bigint, text, text, text, text, text) from public, anon;
grant execute on function public.admin_reminder_save(bigint, text, timestamptz, text, text, text[], bigint, text, text, text, text, text) to authenticated;

create or replace function public.admin_reminders(p_from date default null, p_limit integer default 200) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 볼 수 있어요.'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'member', r.member_id, 'consult', r.consult_id, 'name', r.name,
      'at', r.at, 'when', private.reminder_when(r.at), 'place', r.place, 'memo', r.memo, 'teacher', r.teacher, 'track', r.track, 'topic', r.topic,
      'status', r.status, 'sent_at', r.sent_at, 'result', r.result, 'phone', r.ph, 'own_phone', r.phone is not null) order by r.at)
    from (select r0.*, private.phone_mask(private.reminder_phone(r0)) ph from public.reminders r0
          where r0.at >= coalesce(p_from, (now() at time zone 'Asia/Seoul')::date - 7)::timestamp at time zone 'Asia/Seoul'
          order by r0.at limit greatest(1, least(coalesce(p_limit, 200), 500))) r), '[]'::jsonb));
end $$;

-- 보낼 자리 값: 저장한 문구에 있는 자리만 보냄 (문구가 없으면 전부)
create or replace function private.reminder_vars(r public.reminders, txt text) returns jsonb language plpgsql stable set search_path = '' as $$
declare a jsonb := jsonb_build_object(
    '#{이름}', r.name, '#{일시}', private.reminder_when(r.at), '#{시간}', private.reminder_time(r.at),
    '#{장소}', coalesce(nullif(r.place, ''), '이송희보컬레슨'),
    '#{안내}', coalesce(nullif(r.memo, ''), case when r.kind = '특강' then '따로 챙기실 준비물은 없어요!' else '-' end),
    '#{강사}', coalesce(nullif(r.teacher, ''), '담당'), '#{클래스}', coalesce(nullif(r.track, ''), '보컬'), '#{특강}', coalesce(nullif(r.topic, ''), '오디션'));
  o jsonb := '{}'; k text;
begin
  if coalesce(txt, '') = '' then return a; end if;
  for k in select jsonb_object_keys(a) loop
    if position(k in txt) > 0 then o := o || jsonb_build_object(k, a -> k); end if;
  end loop;
  return o;
end $$;

create or replace function private.reminder_send(p_id bigint) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c private.solapi; r public.reminders; ph text; tpl text; res record; j jsonb; ok boolean; why text;
begin
  select * into c from private.solapi where id = 1;
  select * into r from public.reminders where id = p_id for update;
  if r.id is null then return private.fail('일정을 찾을 수 없어요.'); end if;
  if r.status = '취소' then return private.fail('취소된 일정이에요.'); end if;
  tpl := c.templates ->> r.kind;
  ph := private.reminder_phone(r);
  if c.api_key is null or c.sender is null or c.pf_id is null then why := '솔라피 연결 전이에요 (관리자 → 카톡 자동발송 → 솔라피 연결).';
  elsif coalesce(tpl, '') = '' then why := '"' || r.kind || '" 알림톡 템플릿 ID가 비어 있어요.';
  elsif ph is null then why := '받는 전화번호가 없어요.';
  end if;
  if why is not null then
    update public.reminders set status = '실패', result = why, updated_at = now() where id = r.id;
    return private.fail(why);
  end if;
  select * into res from private.solapi_call('POST', '/messages/v4/send-many/detail', jsonb_build_object('messages', jsonb_build_array(jsonb_build_object(
    'to', ph, 'from', c.sender,
    'kakaoOptions', jsonb_build_object('pfId', c.pf_id, 'templateId', tpl, 'disableSms', true,
      'variables', private.reminder_vars(r, c.texts ->> r.kind))))));
  begin j := res.content::jsonb; exception when others then j := null; end;
  ok := res.status between 200 and 299 and coalesce(jsonb_array_length(j -> 'failedMessageList'), 0) = 0;
  why := case when ok then '보냄' else left(coalesce(j -> 'failedMessageList' -> 0 ->> 'statusMessage', j ->> 'errorMessage', j ->> 'message', res.content, '응답 없음'), 200) end;
  update public.reminders set status = case when ok then '보냄' else '실패' end, sent_at = case when ok then now() else sent_at end,
    result = why, updated_at = now() where id = r.id;
  return jsonb_build_object('ok', ok, 'error', case when ok then null else why end);
end $$;

-- 원장님 문구 4개 저장 (상담은 원장님 문구가 없어서 비워 둠 → 화면 기본 문구)
update private.solapi set texts = coalesce(texts, '{}'::jsonb) || jsonb_build_object(
'첫 레슨', $t$[이송희보컬레슨학원 수업 리마인더]
안녕하세요 #{이름}님! 😻
내일 #{시간}, #{강사}T와 함께하는
#{클래스} 1:1 보컬레슨이 시작됩니다!
목표하시는 오디션을 향해
저희가 함께 차근차근 준비하겠습니다.
궁금한 점은 언제든 편하게 문의 주세요!
내일 뵙겠습니다 💛
이송희보컬레슨학원 드림$t$,
'컨설팅', $t$[이송희보컬레슨학원 컨설팅 리마인더]
안녕하세요 #{이름}님! 😻
내일 #{시간}, 이송희 원장님과 함께하는
1:1 오디션 컨설팅이 진행됩니다!
현재 실력과 방향을 점검하고
꼭 필요한 부분을 짚어드릴게요.
준비하고 계신 곡이나 궁금한 점을
미리 정리해 오시면 더 알찬 시간이 될 거예요!
내일 뵙겠습니다 💛
이송희보컬레슨학원 드림$t$,
'특강', $t$[이송희보컬레슨학원 특강 리마인더]
안녕하세요 #{이름}님! 😻
내일 #{시간}, #{강사}과 함께하는
#{특강} 특강이 열립니다!
오디션 현장에서 바로 써먹을 수 있는
실전 팁을 가득 담아 준비했어요.
#{안내}
늦지 않게 와주시면 감사하겠습니다.
내일 뵙겠습니다 💛
이송희보컬레슨학원 드림$t$,
'보강', $t$[이송희보컬레슨학원 보강 리마인더]
안녕하세요 #{이름}님! 😻
내일 #{시간}, #{강사}T와 함께하는
보강 수업이 있어요!
보강은 한 번 잡힌 일정으로 진행되어
불참 시 추가 보강이 어려운 점
너그러운 양해 부탁드려요. 🫶🏻
혹시 일정이 어려우시면
꼭 미리 연락 주세요!
소중한 레슨 놓치지 않도록
내일 꼭 뵐게요 💛
이송희보컬레슨학원 드림$t$) where id = 1;

-- ===== leesh_director_consults (2026-11-11) =====
-- 원장 컨설팅 (원장님 2026-11-11 "심화반 원장님 컨설팅 시트를 선생님들만 볼 수 있게, 학생은 보면 안 됨, 학생별로")
-- 시트(링크 공유 · 읽기만)를 서버가 1시간마다 읽어 표에 넣음. 시트 주소는 저장소가 공개라 DB(private.consult_sheet)에만.
-- 탭 순서: 처음 ~ "주말>" = 평일, "주말>" ~ "퇴원>" = 주말, "퇴원>" 뒤 = 퇴원(선생님 화면에 안 보임). 탭 이름 "이름(반)".
-- 탭마다 B열부터: "시간" 머리 줄 아래가 컨설팅 한 번 = 한 줄 (위가 최신). 휴대폰 번호는 가림. 지우지 않음(없어진 탭은 missing).
create table if not exists private.consult_sheet (
  id int primary key default 1 check (id = 1),
  sheet_id text,
  last_at timestamptz, last_ok boolean, last_note text
);
revoke all on private.consult_sheet from public, anon, authenticated;

create table if not exists public.director_consults (
  gid text primary key,
  title text not null,
  name text,
  klass text,
  section text,
  member_id text references public.members(id) on delete set null,
  sheet_teacher text,
  head jsonb not null default '[]',
  rows jsonb not null default '[]',
  pos int,
  missing boolean not null default false,
  synced_at timestamptz not null default now()
);
alter table public.director_consults enable row level security;
revoke all on public.director_consults from public, anon, authenticated;
create trigger zz_admin_log after insert or update or delete on public.director_consults for each row execute function private.log_change();

create or replace function private.consult_sync() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cfg private.consult_sheet; res record; j jsonb; m text[]; v_name text; v_gid text; sec text := '평일'; n int := 0;
  seen text[] := '{}'; v_title text; v_who text; v_klass text; hdr int; rws jsonb; hd jsonb; r jsonb; cells text[]; w int; got int := 0; bad int := 0;
  v_mid text; v_tch text; i int;
begin
  select * into cfg from private.consult_sheet where id = 1;
  if cfg.sheet_id is null then return jsonb_build_object('ok', false, 'error', 'no sheet'); end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '20000');
  select status, content into res from extensions.http_get('https://docs.google.com/spreadsheets/d/' || cfg.sheet_id || '/htmlview');
  if res.status <> 200 then
    update private.consult_sheet set last_at = now(), last_ok = false, last_note = '시트를 읽지 못함 (' || res.status || ')' where id = 1;
    return jsonb_build_object('ok', false, 'status', res.status);
  end if;
  for m in select x from regexp_matches(res.content, 'items\.push\(\{name: "((?:[^"\\]|\\.)*)", pageUrl: "[^"]*", gid: "(\d+)"', 'g') x loop
    v_title := btrim(replace(replace(replace(replace(replace(replace(m[1], '\/', '/'), '\"', '"'), '\x3e', '>'), '\x3c', '<'), '\x26', '&'), '\x27', ''''));
    v_gid := m[2];
    n := n + 1;
    if v_title ~ '^주말\s*>' then sec := '주말'; continue; end if;
    if v_title ~ '^퇴원\s*>' then sec := '퇴원'; continue; end if;
    v_name := substring(v_title from '^\s*([가-힣]{2,4})\s*\(');
    if v_name is null then continue; end if;
    v_klass := substring(v_title from '\(([^)]*)\)');
    seen := seen || v_gid;
    if sec = '퇴원' then
      update public.director_consults set section = '퇴원', title = v_title, pos = n, missing = false where gid = v_gid;
      continue;
    end if;
    select status, content into res from extensions.http_get('https://docs.google.com/spreadsheets/d/' || cfg.sheet_id
      || '/gviz/tq?tqx=out:json&headers=0&gid=' || v_gid || '&range=B1:Z400');
    if res.status <> 200 then bad := bad + 1; continue; end if;
    begin j := substring(res.content from '\((\{.*\})\);?\s*$')::jsonb; exception when others then bad := bad + 1; continue; end;
    hdr := null; rws := '[]'; hd := '[]'; w := 0; i := 0;
    for r in select x from jsonb_array_elements(j -> 'table' -> 'rows') x loop
      cells := array(select btrim(regexp_replace(coalesce(c ->> 'f', c ->> 'v', ''), '01[016789][-. ]?[0-9]{3,4}[-. ]?[0-9]{4}', '(전화번호 뺌)', 'g'), E' \t\r\n')
                     from jsonb_array_elements(coalesce(r -> 'c', '[]')) with ordinality e(c, k) order by k);
      i := i + 1;
      if hdr is null then
        if cells[1] = '시간' then hdr := i; hd := to_jsonb(cells); end if;
        continue;
      end if;
      if coalesce(array_to_string(cells, ''), '') = '' then continue; end if;
      rws := rws || jsonb_build_array(to_jsonb(cells));
    end loop;
    if hdr is null then hd := '["시간","이름(출생년도) / 선생님","나이/키/체중/고민","수강기간 및 합격여부","비고"]'; end if;
    -- 오른쪽 빈 칸은 잘라 냄 (머리 줄 · 내용 중 가장 넓은 것까지)
    select greatest(coalesce(max(k), 0), 1) into w from (
      select k from jsonb_array_elements(hd) with ordinality e(v, k) where v #>> '{}' <> ''
      union all select k from jsonb_array_elements(rws) rr, jsonb_array_elements(rr) with ordinality e(v, k) where v #>> '{}' <> '') z;
    hd := (select coalesce(jsonb_agg(v order by k), '[]') from jsonb_array_elements(hd) with ordinality e(v, k) where k <= w);
    rws := (select coalesce(jsonb_agg((select coalesce(jsonb_agg(v order by k), '[]') from jsonb_array_elements(rr) with ordinality e(v, k) where k <= w) order by o), '[]')
            from jsonb_array_elements(rws) with ordinality q(rr, o));
    -- 시트에 적힌 선생님 ("정지아 (11) / 수빈쌤")
    v_tch := (select substring(x #>> '{}' from '/\s*([가-힣]{1,4})\s*(?:쌤|T|선생님)')
              from jsonb_array_elements(rws) rr, jsonb_array_elements(rr) x where (x #>> '{}') ~ '/\s*[가-힣]{1,4}\s*(쌤|T|선생님)' limit 1);
    -- 명단과 맞추기 (레슨 시트와 같은 기준): 이름이 글자까지 같은 재원 · 휴원 학생 + 시트의 선생님("수빈쌤")이 명단 담당("이수빈")과 같을 때, 딱 한 명일 때만
    select case when count(*) = 1 then min(mm.id) end into v_mid from public.members mm
    where mm.name = v_name and mm.status in ('재원', '휴원')
      and (v_tch is null or substring(mm.memo from '담당\s*([^\s·,]+)') like '%' || v_tch);
    insert into public.director_consults as d (gid, title, name, klass, section, member_id, sheet_teacher, head, rows, pos, missing, synced_at)
    values (v_gid, v_title, v_name, v_klass, sec, v_mid, v_tch, hd, rws, n, false, now())
    on conflict (gid) do update set title = excluded.title, name = excluded.name, klass = excluded.klass, section = excluded.section,
      member_id = excluded.member_id, sheet_teacher = excluded.sheet_teacher, head = excluded.head, rows = excluded.rows,
      pos = excluded.pos, missing = false, synced_at = now()
    where (d.title, d.name, d.klass, d.section, d.member_id, d.sheet_teacher, d.head, d.rows, d.pos, d.missing)
      is distinct from (excluded.title, excluded.name, excluded.klass, excluded.section, excluded.member_id, excluded.sheet_teacher, excluded.head, excluded.rows, excluded.pos, false);
    got := got + 1;
  end loop;
  if n = 0 then
    update private.consult_sheet set last_at = now(), last_ok = false, last_note = '탭 목록을 못 찾음' where id = 1;
    return jsonb_build_object('ok', false, 'error', 'no tabs');
  end if;
  update public.director_consults set missing = true where not (gid = any(seen)) and not missing;
  update private.consult_sheet set last_at = now(), last_ok = bad = 0, last_note = '학생 탭 ' || got || ' · 못 읽음 ' || bad where id = 1;
  return jsonb_build_object('ok', bad = 0, 'tabs', got, 'bad', bad);
end $$;
revoke all on function private.consult_sync() from public, anon, authenticated;

-- 선생님(승인된 선생님 모두) · 관리자만. 학생 · 학부모 · 표 직접 읽기는 막힘.
create or replace function public.teacher_consults() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.teachers := private.my_teacher();
begin
  if t.id is null and not public.is_admin() then return private.fail('선생님으로 연결된 계정만 볼 수 있어요.'); end if;
  return jsonb_build_object('ok', true, 'synced', (select last_at from private.consult_sheet where id = 1),
    'items', coalesce((select jsonb_agg(jsonb_build_object('gid', d.gid, 'name', d.name, 'klass', d.klass, 'section', d.section,
        'teacher', coalesce(substring(m.memo from '담당\s*([^\s·,]+)'), d.sheet_teacher), 'mine', t.id is not null and d.member_id is not null and private.teaches(t, d.member_id),
        'count', jsonb_array_length(d.rows), 'last', d.rows -> 0 ->> 0) order by d.pos)
      from public.director_consults d left join public.members m on m.id = d.member_id
      where d.section in ('평일', '주말') and not d.missing and (m.id is null or m.status in ('재원', '휴원'))), '[]'::jsonb));
end $$;

create or replace function public.teacher_consult(p_gid text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.teachers := private.my_teacher(); d public.director_consults;
begin
  if t.id is null and not public.is_admin() then return private.fail('선생님으로 연결된 계정만 볼 수 있어요.'); end if;
  select * into d from public.director_consults where gid = p_gid and section in ('평일', '주말') and not missing;
  if d.gid is null then return private.fail('컨설팅 기록을 찾을 수 없어요.'); end if;
  return jsonb_build_object('ok', true, 'gid', d.gid, 'name', d.name, 'klass', d.klass, 'head', d.head, 'rows', d.rows);
end $$;
revoke all on function public.teacher_consults(), public.teacher_consult(text) from public, anon;
grant execute on function public.teacher_consults(), public.teacher_consult(text) to authenticated;

-- 1시간마다 (읽기만, 지우지 않음)
select cron.schedule('leesh_consult_sheet', '41 * * * *', 'select private.consult_sync()');
-- 시트 주소는 저장소가 공개라 여기 적지 않음: insert into private.consult_sheet (id, sheet_id) values (1, '<시트 ID>');

-- ===== leesh_director_consults_view (2026-11-11) =====
-- 원장 컨설팅 보는 사람 (원장님 2026-11-11): 시트의 선생님("은지쌤")이 그만둔 선생님(teachers.active = false)이면 원장님 · 관리자만.
-- 선생님 이름은 시트 기준으로 ("수빈" → 이수빈), 원장님 화면은 선생님별 드롭다운으로 봄.
create or replace function private.consult_teacher(p text) returns public.teachers
language sql stable security definer set search_path = '' as $$
  select t from public.teachers t where p is not null and t.name <> '원장님' and t.name like '%' || p
    and (select count(*) from public.teachers x where x.name <> '원장님' and x.name like '%' || p) = 1;
$$;
revoke all on function private.consult_teacher(text) from public, anon, authenticated;

create or replace function private.consult_can(t public.teachers, d public.director_consults) returns boolean
language sql stable security definer set search_path = '' as $$
  select d.section in ('평일', '주말') and not d.missing
    and (public.is_admin() or t.name = '원장님'
         or (t.id is not null and coalesce((private.consult_teacher(d.sheet_teacher)).active, true)));
$$;
revoke all on function private.consult_can(public.teachers, public.director_consults) from public, anon, authenticated;

create or replace function public.teacher_consults() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.teachers := private.my_teacher();
begin
  if t.id is null and not public.is_admin() then return private.fail('선생님으로 연결된 계정만 볼 수 있어요.'); end if;
  return jsonb_build_object('ok', true, 'synced', (select last_at from private.consult_sheet where id = 1),
    'director', public.is_admin() or t.name = '원장님',
    'items', coalesce((select jsonb_agg(jsonb_build_object('gid', d.gid, 'name', d.name, 'klass', d.klass, 'section', d.section,
        'teacher', coalesce(ct.name, substring(m.memo from '담당\s*([^\s·,]+)'), d.sheet_teacher),
        'left', ct.id is not null and not ct.active,
        'mine', t.id is not null and (ct.id = t.id or (d.member_id is not null and private.teaches(t, d.member_id))),
        'count', jsonb_array_length(d.rows), 'last', d.rows -> 0 ->> 0) order by d.pos)
      from public.director_consults d left join public.members m on m.id = d.member_id
      left join lateral (select (private.consult_teacher(d.sheet_teacher)).*) ct on true
      where private.consult_can(t, d) and (m.id is null or m.status in ('재원', '휴원'))), '[]'::jsonb));
end $$;

create or replace function public.teacher_consult(p_gid text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.teachers := private.my_teacher(); d public.director_consults;
begin
  if t.id is null and not public.is_admin() then return private.fail('선생님으로 연결된 계정만 볼 수 있어요.'); end if;
  select * into d from public.director_consults where gid = p_gid;
  if d.gid is null or not private.consult_can(t, d) then return private.fail('컨설팅 기록을 찾을 수 없어요.'); end if;
  return jsonb_build_object('ok', true, 'gid', d.gid, 'name', d.name, 'klass', d.klass, 'head', d.head, 'rows', d.rows);
end $$;
revoke all on function public.teacher_consults(), public.teacher_consult(text) from public, anon;
grant execute on function public.teacher_consults(), public.teacher_consult(text) to authenticated;

-- ===== leesh_director_consults_own (2026-11-11) =====
-- 원장 컨설팅: 선생님은 자기 담당 학생만 (원장님 2026-11-11). 원장님 · 관리자는 전부 (그만둔 선생님 학생 포함).
-- 담당 = 시트에 적힌 선생님("수빈쌤" → 이수빈)이 나이거나, 명단에 연결된 학생의 담당이 나.
create or replace function private.consult_can(t public.teachers, d public.director_consults) returns boolean
language sql stable security definer set search_path = '' as $$
  select d.section in ('평일', '주말') and not d.missing
    and (public.is_admin() or t.name = '원장님'
         or (t.id is not null and ((private.consult_teacher(d.sheet_teacher)).id = t.id
                                   or (d.member_id is not null and private.teaches(t, d.member_id)))));
$$;
revoke all on function private.consult_can(public.teachers, public.director_consults) from public, anon, authenticated;

-- ===== leesh_director_feedback (2026-11-11) =====
-- 원장님 피드백 신청 (원장님 2026-11-11): 심화반 학생만 내 폴더에서 신청, 정해 둔 시간만, 한 타임에 한 명 (먼저 신청한 사람).
-- 명단(수강 ID)은 저장소가 공개라 여기 적지 않고 DB에만 (관리자 화면에서 더하기 · 빼기).
create table if not exists public.feedback_members (
  member_id text primary key references public.members(id) on delete cascade,
  track text not null check (track in ('평일', '주말')),
  slot text check (slot in ('A', 'B')),
  added_at timestamptz not null default now()
);
create table if not exists public.feedback_slots (
  id bigserial primary key,
  at timestamptz not null unique,
  kinds text not null check (kinds in ('보컬', '보컬·댄스')),
  open boolean not null default true
);
create table if not exists public.feedback_bookings (
  id bigserial primary key,
  slot_id bigint not null unique references public.feedback_slots(id) on delete cascade,
  member_id text not null references public.members(id) on delete cascade,
  kind text not null check (kind in ('보컬', '댄스')),
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now()
);
alter table public.feedback_members enable row level security;
alter table public.feedback_slots enable row level security;
alter table public.feedback_bookings enable row level security;
revoke all on public.feedback_members, public.feedback_slots, public.feedback_bookings from public, anon, authenticated;
create trigger zz_admin_log after insert or update or delete on public.feedback_members for each row execute function private.log_change();
create trigger zz_admin_log after insert or update or delete on public.feedback_slots for each row execute function private.log_change();
create trigger zz_admin_log after insert or update or delete on public.feedback_bookings for each row execute function private.log_change();

-- 학생 한 명은 앞으로 남은 신청 하나만 (바꾸려면 취소하고 다시)
create or replace function public.member_feedback(p_id text, p_pin text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare who jsonb := private.check_ready(p_id, p_pin); fm public.feedback_members;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  select * into fm from public.feedback_members where member_id = who ->> 'id';
  if fm.member_id is null then return jsonb_build_object('ok', true, 'eligible', false); end if;
  return jsonb_build_object('ok', true, 'eligible', true, 'track', fm.track, 'slot', fm.slot,
    'slots', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'at', s.at, 'when', private.reminder_when(s.at), 'kinds', s.kinds,
        'taken', b.id is not null, 'mine', b.member_id = fm.member_id, 'booking', case when b.member_id = fm.member_id then b.id end,
        'kind', case when b.member_id = fm.member_id then b.kind end, 'note', case when b.member_id = fm.member_id then b.note end,
        'cancel', s.at - interval '1 hour' > now()) order by s.at)
      from public.feedback_slots s left join public.feedback_bookings b on b.slot_id = s.id
      where s.open and s.at > now() - interval '3 hours'), '[]'::jsonb));
end $$;

create or replace function public.member_feedback_book(p_id text, p_pin text, p_slot bigint, p_kind text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare who jsonb := private.check_ready(p_id, p_pin); mid text; s public.feedback_slots; v_name text; v_kind text := coalesce(nullif(trim(p_kind), ''), '보컬');
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  if not exists (select 1 from public.feedback_members where member_id = mid) then return private.fail('심화반 학생만 신청할 수 있어요.'); end if;
  perform pg_advisory_xact_lock(hashtext('feedback:' || mid));
  select * into s from public.feedback_slots where id = p_slot for update;
  if s.id is null or not s.open then return private.fail('신청할 수 없는 시간이에요.'); end if;
  if s.at <= now() then return private.fail('이미 지난 시간이에요.'); end if;
  if v_kind not in ('보컬', '댄스') then return private.fail('피드백 종류를 골라주세요.'); end if;
  if v_kind = '댄스' and s.kinds <> '보컬·댄스' then return private.fail('이 시간은 보컬 피드백만 할 수 있어요.'); end if;
  if exists (select 1 from public.feedback_bookings b join public.feedback_slots x on x.id = b.slot_id where b.member_id = mid and x.at > now()) then
    return private.fail('이미 신청한 시간이 있어요. 바꾸려면 먼저 취소해주세요.');
  end if;
  if exists (select 1 from public.feedback_bookings where slot_id = s.id) then return private.fail('방금 다른 학생이 신청했어요. 다른 시간을 골라주세요.'); end if;
  begin
    insert into public.feedback_bookings (slot_id, member_id, kind, note) values (s.id, mid, v_kind, nullif(left(trim(coalesce(p_note, '')), 300), ''));
  exception when unique_violation then
    return private.fail('방금 다른 학생이 신청했어요. 다른 시간을 골라주세요.');
  end;
  select name into v_name from public.members where id = mid;
  perform private.notify('🎯 원장님 피드백 신청: ' || v_name || ' · ' || private.reminder_when(s.at) || ' · ' || v_kind);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.member_feedback_cancel(p_id text, p_pin text, p_booking bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare who jsonb := private.check_ready(p_id, p_pin); b public.feedback_bookings; s public.feedback_slots; v_name text;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  select * into b from public.feedback_bookings where id = p_booking and member_id = who ->> 'id';
  if b.id is null then return private.fail('신청을 찾을 수 없어요.'); end if;
  select * into s from public.feedback_slots where id = b.slot_id;
  if s.at - interval '1 hour' <= now() then return private.fail('시작 1시간 전부터는 직접 취소할 수 없어요. 학원(실장님)에 연락해주세요.'); end if;
  delete from public.feedback_bookings where id = b.id;
  select name into v_name from public.members where id = b.member_id;
  perform private.notify('🎯 원장님 피드백 취소: ' || v_name || ' · ' || private.reminder_when(s.at));
  return jsonb_build_object('ok', true);
end $$;

-- 관리자: 시간표 · 신청 · 명단 보기, 신청 취소, 시간 더하기 · 닫기 · 지우기, 명단 더하기 · 빼기
create or replace function public.admin_feedback() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 볼 수 있어요.'); end if;
  return jsonb_build_object('ok', true,
    'slots', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'at', s.at, 'when', private.reminder_when(s.at), 'kinds', s.kinds, 'open', s.open,
        'booking', b.id, 'member', b.member_id, 'name', m.name, 'teacher', substring(m.memo from '담당\s*([^\s·,]+)'), 'kind', b.kind, 'note', b.note, 'booked_at', b.created_at) order by s.at)
      from public.feedback_slots s left join public.feedback_bookings b on b.slot_id = s.id left join public.members m on m.id = b.member_id
      where s.at > now() - interval '30 days'), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object('member', f.member_id, 'name', m.name, 'track', f.track, 'slot', f.slot,
        'teacher', substring(m.memo from '담당\s*([^\s·,]+)'), 'status', m.status, 'kakao', m.kakao_user is not null) order by f.track desc, f.slot, m.name)
      from public.feedback_members f join public.members m on m.id = f.member_id), '[]'::jsonb));
end $$;

create or replace function public.admin_feedback_cancel(p_booking bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  delete from public.feedback_bookings where id = p_booking;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_feedback_slot(p_id bigint, p_at timestamptz default null, p_kinds text default null, p_open boolean default null, p_delete boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  if p_id is null then
    if p_at is null or p_kinds not in ('보컬', '보컬·댄스') then return private.fail('날짜 · 시간 · 종류를 골라주세요.'); end if;
    if exists (select 1 from public.feedback_slots where at = p_at) then return private.fail('이미 있는 시간이에요.'); end if;
    insert into public.feedback_slots (at, kinds) values (p_at, p_kinds);
    return jsonb_build_object('ok', true);
  end if;
  if p_delete then
    if exists (select 1 from public.feedback_bookings where slot_id = p_id) then return private.fail('신청한 학생이 있어요. 먼저 신청을 취소해주세요.'); end if;
    delete from public.feedback_slots where id = p_id;
  else
    update public.feedback_slots set open = coalesce(p_open, open), kinds = coalesce(p_kinds, kinds) where id = p_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_feedback_member(p_member text, p_track text default null, p_slot text default null, p_remove boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.members;
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  if p_remove then delete from public.feedback_members where member_id = upper(trim(p_member)); return jsonb_build_object('ok', true); end if;
  select * into m from public.members where id = upper(trim(p_member));
  if m.id is null then return private.fail('수강 ID를 찾을 수 없어요.'); end if;
  if p_track not in ('평일', '주말') then return private.fail('평일 · 주말을 골라주세요.'); end if;
  insert into public.feedback_members (member_id, track, slot) values (m.id, p_track, nullif(p_slot, ''))
  on conflict (member_id) do update set track = excluded.track, slot = excluded.slot;
  return jsonb_build_object('ok', true, 'name', m.name);
end $$;

revoke all on function public.member_feedback(text, text), public.member_feedback_book(text, text, bigint, text, text), public.member_feedback_cancel(text, text, bigint),
  public.admin_feedback(), public.admin_feedback_cancel(bigint), public.admin_feedback_slot(bigint, timestamptz, text, boolean, boolean),
  public.admin_feedback_member(text, text, text, boolean) from public;
grant execute on function public.member_feedback(text, text), public.member_feedback_book(text, text, bigint, text, text), public.member_feedback_cancel(text, text, bigint) to anon, authenticated;
grant execute on function public.admin_feedback(), public.admin_feedback_cancel(bigint), public.admin_feedback_slot(bigint, timestamptz, text, boolean, boolean),
  public.admin_feedback_member(text, text, text, boolean) to authenticated;

-- 2026년 11월 시간 (원장님 2026-11-11): 보컬만 / 보컬 · 댄스
insert into public.feedback_slots (at, kinds) select (d || ' ' || h || ':00+09')::timestamptz, k from (values
  ('2026-11-16', 18, '보컬'), ('2026-11-16', 19, '보컬'), ('2026-11-16', 20, '보컬'),
  ('2026-11-17', 19, '보컬·댄스'), ('2026-11-17', 20, '보컬·댄스'),
  ('2026-11-19', 17, '보컬·댄스'), ('2026-11-19', 18, '보컬·댄스'), ('2026-11-19', 19, '보컬'), ('2026-11-19', 20, '보컬'),
  ('2026-11-20', 17, '보컬'), ('2026-11-20', 18, '보컬'), ('2026-11-20', 19, '보컬'), ('2026-11-20', 20, '보컬'),
  ('2026-11-23', 18, '보컬'), ('2026-11-23', 19, '보컬'), ('2026-11-23', 20, '보컬'),
  ('2026-11-24', 19, '보컬'), ('2026-11-24', 20, '보컬'),
  ('2026-11-27', 15, '보컬'), ('2026-11-27', 16, '보컬'), ('2026-11-27', 17, '보컬'), ('2026-11-27', 18, '보컬'), ('2026-11-27', 19, '보컬'), ('2026-11-27', 20, '보컬')
) v(d, h, k) on conflict (at) do nothing;
-- 명단은 저장소가 공개라 여기 적지 않음 (관리자 화면 → 원장님 피드백 → 명단에 더하기)

-- ===== leesh_director_feedback_name (2026-11-11) =====
-- 이름 바꿈 (원장님 2026-11-11 "원장님 피드백이 아니고 원장님 컨설팅"): 텔레그램 문구
create or replace function public.member_feedback_book(p_id text, p_pin text, p_slot bigint, p_kind text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare who jsonb := private.check_ready(p_id, p_pin); mid text; s public.feedback_slots; v_name text; v_kind text := coalesce(nullif(trim(p_kind), ''), '보컬');
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  if not exists (select 1 from public.feedback_members where member_id = mid) then return private.fail('심화반 학생만 신청할 수 있어요.'); end if;
  perform pg_advisory_xact_lock(hashtext('feedback:' || mid));
  select * into s from public.feedback_slots where id = p_slot for update;
  if s.id is null or not s.open then return private.fail('신청할 수 없는 시간이에요.'); end if;
  if s.at <= now() then return private.fail('이미 지난 시간이에요.'); end if;
  if v_kind not in ('보컬', '댄스') then return private.fail('피드백 종류를 골라주세요.'); end if;
  if v_kind = '댄스' and s.kinds <> '보컬·댄스' then return private.fail('이 시간은 보컬 피드백만 할 수 있어요.'); end if;
  if exists (select 1 from public.feedback_bookings b join public.feedback_slots x on x.id = b.slot_id where b.member_id = mid and x.at > now()) then
    return private.fail('이미 신청한 시간이 있어요. 바꾸려면 먼저 취소해주세요.');
  end if;
  if exists (select 1 from public.feedback_bookings where slot_id = s.id) then return private.fail('방금 다른 학생이 신청했어요. 다른 시간을 골라주세요.'); end if;
  begin
    insert into public.feedback_bookings (slot_id, member_id, kind, note) values (s.id, mid, v_kind, nullif(left(trim(coalesce(p_note, '')), 300), ''));
  exception when unique_violation then
    return private.fail('방금 다른 학생이 신청했어요. 다른 시간을 골라주세요.');
  end;
  select name into v_name from public.members where id = mid;
  perform private.notify('🎯 원장님 컨설팅 신청: ' || v_name || ' · ' || private.reminder_when(s.at) || ' · ' || v_kind);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.member_feedback_cancel(p_id text, p_pin text, p_booking bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare who jsonb := private.check_ready(p_id, p_pin); b public.feedback_bookings; s public.feedback_slots; v_name text;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  select * into b from public.feedback_bookings where id = p_booking and member_id = who ->> 'id';
  if b.id is null then return private.fail('신청을 찾을 수 없어요.'); end if;
  select * into s from public.feedback_slots where id = b.slot_id;
  if s.at - interval '1 hour' <= now() then return private.fail('시작 1시간 전부터는 직접 취소할 수 없어요. 학원(실장님)에 연락해주세요.'); end if;
  delete from public.feedback_bookings where id = b.id;
  select name into v_name from public.members where id = b.member_id;
  perform private.notify('🎯 원장님 컨설팅 취소: ' || v_name || ' · ' || private.reminder_when(s.at));
  return jsonb_build_object('ok', true);
end $$;

-- ===== leesh_director_feedback_name2 (2026-11-11) =====
-- 시간 묶음 · 종류 이름도 "피드백" → "컨설팅" (원장님 2026-11-11)
create or replace function public.member_feedback_book(p_id text, p_pin text, p_slot bigint, p_kind text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare who jsonb := private.check_ready(p_id, p_pin); mid text; s public.feedback_slots; v_name text; v_kind text := coalesce(nullif(trim(p_kind), ''), '보컬');
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  if not exists (select 1 from public.feedback_members where member_id = mid) then return private.fail('심화반 학생만 신청할 수 있어요.'); end if;
  perform pg_advisory_xact_lock(hashtext('feedback:' || mid));
  select * into s from public.feedback_slots where id = p_slot for update;
  if s.id is null or not s.open then return private.fail('신청할 수 없는 시간이에요.'); end if;
  if s.at <= now() then return private.fail('이미 지난 시간이에요.'); end if;
  if v_kind not in ('보컬', '댄스') then return private.fail('컨설팅 종류를 골라주세요.'); end if;
  if v_kind = '댄스' and s.kinds <> '보컬·댄스' then return private.fail('이 시간은 보컬 컨설팅만 할 수 있어요.'); end if;
  if exists (select 1 from public.feedback_bookings b join public.feedback_slots x on x.id = b.slot_id where b.member_id = mid and x.at > now()) then
    return private.fail('이미 신청한 시간이 있어요. 바꾸려면 먼저 취소해주세요.');
  end if;
  if exists (select 1 from public.feedback_bookings where slot_id = s.id) then return private.fail('방금 다른 학생이 신청했어요. 다른 시간을 골라주세요.'); end if;
  begin
    insert into public.feedback_bookings (slot_id, member_id, kind, note) values (s.id, mid, v_kind, nullif(left(trim(coalesce(p_note, '')), 300), ''));
  exception when unique_violation then
    return private.fail('방금 다른 학생이 신청했어요. 다른 시간을 골라주세요.');
  end;
  select name into v_name from public.members where id = mid;
  perform private.notify('🎯 원장님 컨설팅 신청: ' || v_name || ' · ' || private.reminder_when(s.at) || ' · ' || v_kind);
  return jsonb_build_object('ok', true);
end $$;

-- ===== leesh_director_feedback_until (2026-11-11) =====
-- 예약 기간 (원장님 2026-11-11 안내 문구 "예약 기간 11월 11일(수) ~ 11월 15일(일), 기간 이후에는 추가 예약 및 일정 변경이 어려움"):
-- 시간마다 book_until(이때까지 신청 · 취소), 지나면 학생은 신청도 취소도 못 함 (학원에 연락). 관리자가 더한 시간은 비어 있으면 제한 없음.
alter table public.feedback_slots add column if not exists book_until timestamptz;
update public.feedback_slots set book_until = '2026-11-15 23:59:59+09' where at >= '2026-11-16' and at < '2026-12-01' and book_until is null;
create or replace function public.member_feedback(p_id text, p_pin text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare who jsonb := private.check_ready(p_id, p_pin); fm public.feedback_members;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  select * into fm from public.feedback_members where member_id = who ->> 'id';
  if fm.member_id is null then return jsonb_build_object('ok', true, 'eligible', false); end if;
  return jsonb_build_object('ok', true, 'eligible', true, 'track', fm.track, 'slot', fm.slot,
    'slots', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'at', s.at, 'when', private.reminder_when(s.at), 'kinds', s.kinds,
        'taken', b.id is not null, 'mine', b.member_id = fm.member_id, 'booking', case when b.member_id = fm.member_id then b.id end,
        'kind', case when b.member_id = fm.member_id then b.kind end, 'note', case when b.member_id = fm.member_id then b.note end,
        'cancel', s.at - interval '1 hour' > now() and (s.book_until is null or s.book_until > now()),
        'closed', s.book_until is not null and s.book_until <= now(), 'until', s.book_until) order by s.at)
      from public.feedback_slots s left join public.feedback_bookings b on b.slot_id = s.id
      where s.open and s.at > now() - interval '3 hours'), '[]'::jsonb));
end $$;

create or replace function public.member_feedback_book(p_id text, p_pin text, p_slot bigint, p_kind text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare who jsonb := private.check_ready(p_id, p_pin); mid text; s public.feedback_slots; v_name text; v_kind text := coalesce(nullif(trim(p_kind), ''), '보컬');
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  if not exists (select 1 from public.feedback_members where member_id = mid) then return private.fail('심화반 학생만 신청할 수 있어요.'); end if;
  perform pg_advisory_xact_lock(hashtext('feedback:' || mid));
  select * into s from public.feedback_slots where id = p_slot for update;
  if s.id is null or not s.open then return private.fail('신청할 수 없는 시간이에요.'); end if;
  if s.at <= now() then return private.fail('이미 지난 시간이에요.'); end if;
  if s.book_until is not null and s.book_until <= now() then return private.fail('예약 기간이 끝났어요. 학원(실장님)에 연락해주세요.'); end if;
  if v_kind not in ('보컬', '댄스') then return private.fail('컨설팅 종류를 골라주세요.'); end if;
  if v_kind = '댄스' and s.kinds <> '보컬·댄스' then return private.fail('이 시간은 보컬 컨설팅만 할 수 있어요.'); end if;
  if exists (select 1 from public.feedback_bookings b join public.feedback_slots x on x.id = b.slot_id where b.member_id = mid and x.at > now()) then
    return private.fail('이미 신청한 시간이 있어요. 바꾸려면 먼저 취소해주세요.');
  end if;
  if exists (select 1 from public.feedback_bookings where slot_id = s.id) then return private.fail('방금 다른 학생이 신청했어요. 다른 시간을 골라주세요.'); end if;
  begin
    insert into public.feedback_bookings (slot_id, member_id, kind, note) values (s.id, mid, v_kind, nullif(left(trim(coalesce(p_note, '')), 300), ''));
  exception when unique_violation then
    return private.fail('방금 다른 학생이 신청했어요. 다른 시간을 골라주세요.');
  end;
  select name into v_name from public.members where id = mid;
  perform private.notify('🎯 원장님 컨설팅 신청: ' || v_name || ' · ' || private.reminder_when(s.at) || ' · ' || v_kind);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.member_feedback_cancel(p_id text, p_pin text, p_booking bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare who jsonb := private.check_ready(p_id, p_pin); b public.feedback_bookings; s public.feedback_slots; v_name text;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  select * into b from public.feedback_bookings where id = p_booking and member_id = who ->> 'id';
  if b.id is null then return private.fail('신청을 찾을 수 없어요.'); end if;
  select * into s from public.feedback_slots where id = b.slot_id;
  if s.book_until is not null and s.book_until <= now() then return private.fail('예약 기간이 끝나서 직접 바꿀 수 없어요. 학원(실장님)에 연락해주세요.'); end if;
  if s.at - interval '1 hour' <= now() then return private.fail('시작 1시간 전부터는 직접 취소할 수 없어요. 학원(실장님)에 연락해주세요.'); end if;
  delete from public.feedback_bookings where id = b.id;
  select name into v_name from public.members where id = b.member_id;
  perform private.notify('🎯 원장님 컨설팅 취소: ' || v_name || ' · ' || private.reminder_when(s.at));
  return jsonb_build_object('ok', true);
end $$;

-- ===== leesh_director_feedback_until_admin (2026-11-11) =====
drop function if exists public.admin_feedback_slot(bigint, timestamptz, text, boolean, boolean);
create or replace function public.admin_feedback_slot(p_id bigint, p_at timestamptz default null, p_kinds text default null, p_open boolean default null, p_delete boolean default false, p_until timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  if p_id is null then
    if p_at is null or p_kinds not in ('보컬', '보컬·댄스') then return private.fail('날짜 · 시간 · 종류를 골라주세요.'); end if;
    if exists (select 1 from public.feedback_slots where at = p_at) then return private.fail('이미 있는 시간이에요.'); end if;
    insert into public.feedback_slots (at, kinds, book_until) values (p_at, p_kinds, p_until);
    return jsonb_build_object('ok', true);
  end if;
  if p_delete then
    if exists (select 1 from public.feedback_bookings where slot_id = p_id) then return private.fail('신청한 학생이 있어요. 먼저 신청을 취소해주세요.'); end if;
    delete from public.feedback_slots where id = p_id;
  else
    update public.feedback_slots set open = coalesce(p_open, open), kinds = coalesce(p_kinds, kinds), book_until = coalesce(p_until, book_until) where id = p_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_feedback_slot(bigint, timestamptz, text, boolean, boolean, timestamptz) from public, anon;
grant execute on function public.admin_feedback_slot(bigint, timestamptz, text, boolean, boolean, timestamptz) to authenticated;

create or replace function public.admin_feedback() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then return private.fail('관리자만 볼 수 있어요.'); end if;
  return jsonb_build_object('ok', true,
    'slots', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'at', s.at, 'when', private.reminder_when(s.at), 'kinds', s.kinds, 'open', s.open, 'until', s.book_until,
        'booking', b.id, 'member', b.member_id, 'name', m.name, 'teacher', substring(m.memo from '담당\s*([^\s·,]+)'), 'kind', b.kind, 'note', b.note, 'booked_at', b.created_at) order by s.at)
      from public.feedback_slots s left join public.feedback_bookings b on b.slot_id = s.id left join public.members m on m.id = b.member_id
      where s.at > now() - interval '30 days'), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object('member', f.member_id, 'name', m.name, 'track', f.track, 'slot', f.slot,
        'teacher', substring(m.memo from '담당\s*([^\s·,]+)'), 'status', m.status, 'kakao', m.kakao_user is not null) order by f.track desc, f.slot, m.name)
      from public.feedback_members f join public.members m on m.id = f.member_id), '[]'::jsonb));
end $$;

-- ===== leesh_suggest_read (2026-11-11) =====
-- 건의함 읽음 표시 (원장님 2026-11-11): 보낸 학생 기기에만 무작위 번호(ticket)를 남기고,
-- 로그인 없이 그 번호로 "읽었는지"만 물어봄 → 서버는 여전히 누가 썼는지 모름.
alter table private.suggestions add column if not exists ticket uuid not null default gen_random_uuid();
create unique index if not exists suggestions_ticket on private.suggestions (ticket);

create or replace function public.member_suggest(p_id text, p_pin text, p_topic text, p_body text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  k private.suggest_key;
  today date := private.now_kst()::date;
  v_topic text := case when p_topic in ('수업', '선생님', '연습실', '시설', '홈페이지', '기타') then p_topic else '기타' end;
  v_body text := trim(coalesce(p_body, ''));
  hh bytea; cnt int; v_t uuid;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  if char_length(v_body) < 2 then return private.fail('하고 싶은 말을 적어주세요.'); end if;
  if char_length(v_body) > 1000 then return private.fail('1000자까지 쓸 수 있어요.'); end if;
  select * into k from private.suggest_key where id = 1;
  hh := extensions.digest((who ->> 'id') || '|' || today::text || '|' || k.salt, 'sha256');
  insert into private.suggest_counts (h, day, n) values (hh, today, 1)
    on conflict (h, day) do update set n = private.suggest_counts.n + 1 returning n into cnt;
  if cnt > 5 then return private.fail('하루에 5번까지 보낼 수 있어요. 내일 다시 보내주세요.'); end if;
  delete from private.suggest_counts where day < today - 1;  -- 지난 횟수는 바로 지움
  insert into private.suggestions (day, topic, body) values (today, v_topic, extensions.pgp_sym_encrypt(v_body, k.k))
    returning ticket into v_t;
  return jsonb_build_object('ok', true, 'ticket', v_t);
end $function$;

-- 로그인 없이 부름 (누가 묻는지 모르게). 번호를 아는 사람만, 읽었는지만 알 수 있음. 지운 건의는 "읽음".
create or replace function public.member_suggest_status(p_tickets uuid[])
 returns jsonb language sql stable security definer set search_path to ''
as $function$
  select jsonb_build_object('ok', true, 'items', coalesce(jsonb_agg(jsonb_build_object('t', t, 'read', coalesce(s.is_read, true))), '[]'::jsonb))
  from unnest((coalesce(p_tickets, '{}'::uuid[]))[1:30]) as t
  left join private.suggestions s on s.ticket = t
$function$;
revoke all on function public.member_suggest_status(uuid[]) from public;
grant execute on function public.member_suggest_status(uuid[]) to anon, authenticated;

-- ===== leesh_visit_cancel (2026-11-12) =====
-- 내방 오디션 신청 취소 (원장님 2026-11-12 "취소하고 싶은 학생이 취소하는 칸이 없다"):
-- 신청 마감(마감일, 없으면 오디션 하루 전)까지는 학생이 직접 취소 → 신청 지움 + 텔레그램(1시간 모아 보내기).
-- 마감 뒤엔 학원(실장님)에 연락. 올린 음원 파일은 지우지 않음 (자동 삭제 없음).
create or replace function public.member_visit_cancel(p_id text, p_pin text, p_news bigint)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  mid text;
  n public.audition_news;
  a public.visit_applications;
  today date := private.now_kst()::date;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  select * into n from public.audition_news where id = p_news and kind = '내방';
  select * into a from public.visit_applications where news_id = p_news and member_id = mid;
  if a.id is null then return private.fail('취소할 신청이 없어요.'); end if;
  if n.id is not null and coalesce(n.deadline, n.event_date - 1) is not null and coalesce(n.deadline, n.event_date - 1) < today then
    return private.fail('신청 마감이 지나서 직접 취소할 수 없어요. 학원(실장님)에 연락해주세요.');
  end if;
  delete from public.visit_applications where id = a.id;
  perform private.notify('🎤 내방 오디션 신청 취소: ' || a.name || ' · ' || coalesce(a.field, '') || chr(10) || coalesce(a.audition, ''));
  return jsonb_build_object('ok', true);
end $function$;
revoke all on function public.member_visit_cancel(text, text, bigint) from public;
grant execute on function public.member_visit_cancel(text, text, bigint) to anon, authenticated;

-- ===== leesh_suggest_reply (2026-11-12) =====
-- 건의함 답글 (원장님 2026-11-12 "댓글 같은 거라도 달 수 있게"): 학원이 건의마다 답글을 남기면
-- 보낸 학생 기기("내가 보낸 건의", 무작위 번호로만 찾음)에만 보임. 답글도 암호화해서 저장. 누가 썼는지는 여전히 모름.
alter table private.suggestions add column if not exists reply bytea;
alter table private.suggestions add column if not exists reply_at timestamptz;

create or replace function public.admin_suggestions()
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare k private.suggest_key;
begin
  if not public.is_admin() then return private.fail('관리자만 볼 수 있어요.'); end if;
  select * into k from private.suggest_key where id = 1;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'day', s.day, 'topic', s.topic, 'read', s.is_read,
             'body', extensions.pgp_sym_decrypt(s.body, k.k),
             'reply', case when s.reply is null then null else extensions.pgp_sym_decrypt(s.reply, k.k) end,
             'reply_at', s.reply_at) order by s.id desc)
      from (select * from private.suggestions order by id desc limit 300) s), '[]'::jsonb));
end $function$;

create or replace function public.admin_suggest_reply(p_id bigint, p_reply text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare k private.suggest_key; v text := trim(coalesce(p_reply, ''));
begin
  if not public.is_admin() then return private.fail('관리자만 할 수 있어요.'); end if;
  if char_length(v) > 1000 then return private.fail('답글은 1000자까지 쓸 수 있어요.'); end if;
  select * into k from private.suggest_key where id = 1;
  update private.suggestions
     set reply = case when v = '' then null else extensions.pgp_sym_encrypt(v, k.k) end,
         reply_at = case when v = '' then null else now() end,
         is_read = true
   where id = p_id;
  if not found then return private.fail('건의를 찾을 수 없어요.'); end if;
  return jsonb_build_object('ok', true);
end $function$;
revoke all on function public.admin_suggest_reply(bigint, text) from public;
grant execute on function public.admin_suggest_reply(bigint, text) to authenticated;

-- 로그인 없이 번호로: 읽음 + 답글
create or replace function public.member_suggest_status(p_tickets uuid[])
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare k private.suggest_key;
begin
  select * into k from private.suggest_key where id = 1;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('t', t, 'read', coalesce(s.is_read, true),
             'reply', case when s.reply is null then null else extensions.pgp_sym_decrypt(s.reply, k.k) end,
             'reply_at', s.reply_at))
    from unnest((coalesce(p_tickets, '{}'::uuid[]))[1:30]) as t
    left join private.suggestions s on s.ticket = t), '[]'::jsonb));
end $function$;
revoke all on function public.member_suggest_status(uuid[]) from public;
grant execute on function public.member_suggest_status(uuid[]) to anon, authenticated;

-- ===== leesh_booking_open_at (2026-11-12) =====
-- 연습실 예약 저절로 열기 (원장님 2026-11-12 "16일 월요일 00:00부터 오픈, 자동으로"):
-- pg_cron(GMT) 2026-11-15 15:00 = 한국 11-16 00:00에 한 번 → settings.booking_open = true + 텔레그램 + 작업 스스로 지움.
-- 화면은 js/config.js bookingOpenAt이 같은 시각에 저절로 열림.
create or replace function private.booking_open_now()
 returns void language plpgsql security definer set search_path to ''
as $function$
begin
  if private.now_kst() < timestamp '2026-11-16 00:00' - interval '1 minute' then return; end if; -- 혹시 일찍 돌면 아무것도 안 함
  update public.settings set booking_open = true where booking_open is distinct from true;
  perform private.notify_send('✅ 연습실 예약을 열었어요 (' || to_char(private.now_kst(), 'MM/DD HH24:MI') || ') · 이제 학생들이 홈페이지에서 예약할 수 있어요');
  perform cron.unschedule('leesh_booking_open');
exception when others then
  update public.settings set booking_open = true;  -- 알림 · 작업 지우기가 실패해도 예약은 꼭 열기
end $function$;
select cron.schedule('leesh_booking_open', '0 15 15 11 *', 'select private.booking_open_now()');

-- ===== leesh_teacher_booking (2026-11-12) =====
-- 선생님 연습실 예약 (원장님 2026-11-12 "선생님들은 C홀 같은 데서 수업 → 오늘~내일 조건 없이 미리미리, 항상 예약"):
-- 학생 예약과 같은 표 bookings에 teacher_id로 (member_id 비움), 학생 빈 시간표에서도 찬 칸으로 보임.
-- 선생님은 날짜 제한 없음(오늘 ~ 1년 뒤), 준비 중(booking_open = false)이어도 됨, 시작 전이면 언제든 직접 취소. 한 번 최대 시간은 학생과 같음.
alter table public.bookings add column if not exists teacher_id int references public.teachers(id);
alter table public.bookings drop constraint if exists bookings_no_teacher_overlap;
alter table public.bookings add constraint bookings_no_teacher_overlap
  exclude using gist (teacher_id with =, day with =, int4range(start_min, end_min) with &&) where (status = '확정' and teacher_id is not null);

create or replace function public.teacher_rooms(p_date text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.teachers := private.my_teacher();
  s public.settings;
  k timestamp := private.now_kst();
  today date := k::date;
  now_min int := extract(hour from k)::int * 60 + extract(minute from k)::int;
  d date;
begin
  if t.id is null then return private.fail('승인된 선생님만 예약할 수 있어요.'); end if;
  select * into s from public.settings where id = 1;
  begin d := coalesce(nullif(p_date, '')::date, today); exception when others then return private.fail('날짜 형식이 올바르지 않습니다.'); end;
  if d < today or d > today + 365 then return private.fail('오늘부터 1년 안의 날짜를 골라주세요.'); end if;
  return jsonb_build_object('ok', true, 'date', d, 'today', today, 'last', today + 365,
    'now', case when d = today then now_min end, 'unit', s.unit_min,
    'maxHours', s.max_minutes / 60,
    'rooms', coalesce((
      select jsonb_agg(jsonb_build_object('name', r.name, 'type', r.kind,
        'free', coalesce((select jsonb_agg(private.hhmm(g) order by g)
          from generate_series(s.open_min, s.close_min - s.unit_min, s.unit_min) g
          where (d > today or g > now_min)
            and not exists (select 1 from public.bookings b where b.room_id = r.id and b.day = d and b.status = '확정'
                            and b.start_min < g + s.unit_min and g < b.end_min)), '[]'::jsonb)
      ) order by r.sort, r.id) from public.rooms r where r.active), '[]'::jsonb),
    'mine', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'room', r.name, 'date', b.day,
        'start', private.hhmm(b.start_min), 'end', private.hhmm(b.end_min)) order by b.day, b.start_min)
      from public.bookings b join public.rooms r on r.id = b.room_id
      where b.teacher_id = t.id and b.status = '확정' and (b.day > today or (b.day = today and b.end_min > now_min))), '[]'::jsonb));
end $$;

create or replace function public.teacher_booking_create(p_room text, p_date text, p_start text, p_hours integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.teachers := private.my_teacher();
  s public.settings;
  k timestamp := private.now_kst();
  today date := k::date;
  now_min int := extract(hour from k)::int * 60 + extract(minute from k)::int;
  d date;
  room public.rooms;
  st int := private.to_min(p_start);
  en int;
  new_id bigint;
begin
  if t.id is null then return private.fail('승인된 선생님만 예약할 수 있어요.'); end if;
  select * into s from public.settings where id = 1;
  begin d := p_date::date; exception when others then return private.fail('날짜 형식이 올바르지 않습니다.'); end;
  if d is null then return private.fail('날짜 형식이 올바르지 않습니다.'); end if;
  if d < today then return private.fail('지난 날짜는 예약할 수 없습니다.'); end if;
  if d > today + 365 then return private.fail('1년 안의 날짜만 예약할 수 있어요.'); end if;
  select * into room from public.rooms where name = p_room and active;
  if room.id is null then return private.fail('선택한 연습실을 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.'); end if;
  if st is null then return private.fail('시작 시간이 올바르지 않습니다.'); end if;
  if p_hours is null or p_hours < 1 then return private.fail('이용 시간을 선택해주세요.'); end if;
  if p_hours * 60 > s.max_minutes then return private.fail('한 번에 최대 ' || s.max_minutes / 60 || '시간까지 예약할 수 있어요. 더 필요하면 이어서 한 번 더 예약해주세요.'); end if;
  en := st + p_hours * 60;
  if (st - s.open_min) % s.unit_min <> 0 then return private.fail('예약은 ' || s.unit_min || '분 단위로만 가능합니다.'); end if;
  if st < s.open_min or en > s.close_min then
    return private.fail('운영 시간(' || private.hhmm(s.open_min) || '~' || private.hhmm(s.close_min) || ') 안에서만 예약할 수 있습니다.');
  end if;
  if d = today and st <= now_min then return private.fail('이미 시작한 시간이에요. 다음 시간부터 예약할 수 있어요.'); end if;
  perform pg_advisory_xact_lock(hashtext('teacher:' || t.id));
  perform pg_advisory_xact_lock(hashtext('room:' || room.id || ':' || d));
  begin
    insert into public.bookings (room_id, member_id, teacher_id, day, start_min, end_min, memo)
    values (room.id, null, t.id, d, st, en, t.name || ' 선생님') returning id into new_id;
  exception when exclusion_violation then
    if sqlerrm like '%bookings_no_teacher_overlap%' then return private.fail('같은 시간에 이미 다른 방을 예약하셨어요.'); end if;
    return private.fail('그 시간에 이미 예약이 있어요. 다른 시간을 골라주세요.');
  when deadlock_detected or lock_not_available then
    return private.fail('예약하는 사람이 몰렸어요. 한 번 더 눌러주세요.');
  end;
  perform private.notify('🎤 연습실 예약' || chr(10) || t.name || ' 선생님 · ' || room.name
    || chr(10) || private.day_label(d) || ' ' || private.hhmm(st) || '~' || private.hhmm(en));
  return jsonb_build_object('ok', true, 'booking', jsonb_build_object(
    'id', new_id, 'room', room.name, 'date', d, 'start', private.hhmm(st), 'end', private.hhmm(en)));
end $$;

create or replace function public.teacher_booking_cancel(p_booking bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.teachers := private.my_teacher();
  k timestamp := private.now_kst();
  today date := k::date;
  now_min int := extract(hour from k)::int * 60 + extract(minute from k)::int;
  b public.bookings;
  room_name text;
begin
  if t.id is null then return private.fail('승인된 선생님만 취소할 수 있어요.'); end if;
  select * into b from public.bookings where id = p_booking and teacher_id = t.id and status = '확정' for update;
  if b.id is null then return private.fail('취소할 예약을 찾을 수 없습니다.'); end if;
  if b.day < today or (b.day = today and b.start_min <= now_min) then
    return private.fail('이미 시작한 예약은 취소할 수 없어요. 학원에 연락해주세요.');
  end if;
  update public.bookings set status = '취소', cancelled_at = now(), memo = coalesce(memo || ' / ', '') || '선생님 취소' where id = b.id;
  select name into room_name from public.rooms where id = b.room_id;
  perform private.notify('↩️ 연습실 예약 취소' || chr(10) || t.name || ' 선생님 · ' || room_name
    || chr(10) || private.day_label(b.day) || ' ' || private.hhmm(b.start_min) || '~' || private.hhmm(b.end_min));
  return jsonb_build_object('ok', true, 'cancelled', b.id);
end $$;

revoke all on function public.teacher_rooms(text), public.teacher_booking_create(text, text, text, integer), public.teacher_booking_cancel(bigint) from public, anon;
grant execute on function public.teacher_rooms(text), public.teacher_booking_create(text, text, text, integer), public.teacher_booking_cancel(bigint) to authenticated;

-- ===== leesh_fixed_blocks (2026-11-12) =====
-- 매주 고정 막음을 끝없이 (원장님 2026-11-12 "별다른 지시 전에는 무한대로"):
-- 규칙 표 private.fixed_blocks + 매일 0시 1분(한국) pg_cron이 "오늘 + 365일"까지 채움.
-- 이미 채운 날(filled_until)까지는 다시 안 넣음 → 관리자가 어떤 날 막음을 지우면 그날은 그대로 비어 있음.
-- 그 칸에 이미 다른 예약이 있으면 그 줄만 건너뛰고 텔레그램으로 알림.
create table if not exists private.fixed_blocks (
  id serial primary key,
  dow int not null check (dow between 0 and 6),   -- 0 일 · 1 월 … 6 토
  room text not null,
  start_h int not null check (start_h between 0 and 23),
  end_h int not null check (end_h between 1 and 24 and end_h > start_h),
  memo text not null,
  active boolean not null default true
);
create table if not exists private.fixed_blocks_state (
  id int primary key default 1 check (id = 1),
  filled_until date not null
);
insert into private.fixed_blocks (dow, room, start_h, end_h, memo)
select * from (values
  (1, 'B1', 0, 2, '청소 (매주 고정)'), (1, 'B2', 0, 2, '청소 (매주 고정)'), (1, 'B3', 0, 2, '청소 (매주 고정)'),
  (1, 'B4', 0, 2, '청소 (매주 고정)'), (1, 'B5', 0, 2, '청소 (매주 고정)'), (1, 'C hall', 0, 2, '청소 (매주 고정)'),
  (1, 'C hall', 18, 23, '댄스특강 (매주 고정)'), (3, 'C hall', 18, 23, '댄스특강 (매주 고정)'),
  (6, 'C hall', 13, 18, '댄스특강 (매주 고정)'), (0, 'C hall', 13, 18, '댄스특강 (매주 고정)'),
  (5, 'C hall', 18, 22, '오디션 (매주 고정)')
) v(a, b, c, d, e)
where not exists (select 1 from private.fixed_blocks);
-- 2026-11-12에 넣은 1년치는 2027-11-11까지 채운 것으로
insert into private.fixed_blocks_state (id, filled_until) values (1, date '2027-11-11') on conflict (id) do nothing;

create or replace function private.fixed_blocks_fill() returns int
language plpgsql security definer set search_path = '' as $$
declare
  st private.fixed_blocks_state;
  upto date := private.now_kst()::date + 365;
  d date;
  r record;
  n int := 0;
  skipped text := '';
begin
  select * into st from private.fixed_blocks_state where id = 1 for update;
  if st.filled_until >= upto then return 0; end if;
  d := st.filled_until + 1;
  while d <= upto loop
    for r in select b.*, rm.id as room_id from private.fixed_blocks b join public.rooms rm on rm.name = b.room
             where b.active and b.dow = extract(dow from d)::int loop
      begin
        insert into public.bookings (room_id, member_id, teacher_id, day, start_min, end_min, memo)
        values (r.room_id, null, null, d, r.start_h * 60, r.end_h * 60, r.memo);
        n := n + 1;
      exception when exclusion_violation then
        skipped := skipped || chr(10) || to_char(d, 'MM/DD') || ' ' || r.room || ' ' || r.start_h || '~' || r.end_h || '시 ' || r.memo;
      end;
    end loop;
    d := d + 1;
  end loop;
  update private.fixed_blocks_state set filled_until = upto where id = 1;
  if skipped <> '' then
    perform private.notify_send('⚠️ 매주 고정 막음을 못 넣은 칸 (이미 다른 예약이 있음)' || skipped);
  end if;
  return n;
end $$;
revoke all on function private.fixed_blocks_fill() from public, anon, authenticated;

select cron.schedule('leesh_fixed_blocks', '1 15 * * *', 'select private.fixed_blocks_fill()');

-- ===== leesh_member_status_cancel (2026-11-12) =====
-- 그만둔 · 쉬는 학생의 앞으로 예약 저절로 취소 (원장님 2026-11-12):
-- members.status가 재원 · 외부(예약할 수 있는 상태)에서 휴원 · 종료 등으로 바뀌면 아직 시작 안 한 '확정' 예약을 '취소'로.
-- 시트 맞추기(3시간마다) · 관리자 화면 어디서 바뀌어도 같음. 다시 재원이 돼도 취소된 예약은 되살리지 않음.
create or replace function private.member_status_cancel() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  k timestamp := private.now_kst();
  today date := k::date;
  now_min int := extract(hour from k)::int * 60 + extract(minute from k)::int;
  b record;
begin
  if new.status in ('재원', '외부') or old.status not in ('재원', '외부') then return new; end if;
  for b in
    update public.bookings x
       set status = '취소', cancelled_at = now(),
           memo = coalesce(x.memo || ' / ', '') || new.status || '(으)로 바뀌어 자동 취소'
     where x.member_id = new.id and x.status = '확정'
       and (x.day > today or (x.day = today and x.start_min > now_min))
    returning x.day, x.start_min, x.end_min, x.room_id
  loop
    perform private.notify('↩️ 연습실 예약 자동 취소 (' || new.status || ')' || chr(10) || new.name || ' · '
      || (select r.name from public.rooms r where r.id = b.room_id)
      || chr(10) || private.day_label(b.day) || ' ' || private.hhmm(b.start_min) || '~' || private.hhmm(b.end_min));
  end loop;
  return new;
end $$;
revoke all on function private.member_status_cancel() from public, anon, authenticated;

drop trigger if exists member_status_cancel on public.members;
create trigger member_status_cancel after update of status on public.members
  for each row when (old.status is distinct from new.status)
  execute function private.member_status_cancel();

-- ===== leesh_visit_pick (2026-11-12) =====
-- 내방 오디션 지원분야 고르는 방식 (원장님 2026-11-12, 선생님 "이닛 내방오디션 택2인데 택1로 되어 있어요 · 보컬or랩, 댄스 중 택2"):
-- audition_news.pick = '1' 택 1(기본) · '2' 2개까지 · 'vd' 보컬 또는 랩 + 댄스. 여러 개는 visit_applications.field에 "보컬 + 댄스".
alter table public.audition_news add column if not exists pick text not null default '1' check (pick in ('1', '2', 'vd'));
alter table public.visit_applications drop constraint if exists visit_applications_field_check;
alter table public.visit_applications add constraint visit_applications_field_check check (
  cardinality(string_to_array(field, ' + ')) between 1 and 2
  and string_to_array(field, ' + ') <@ array['보컬', '랩', '댄스', '라이브퍼포먼스', '연기']);
CREATE OR REPLACE FUNCTION public.member_visit_apply(p_id text, p_pin text, p_news bigint, p_name text, p_gender text DEFAULT NULL::text, p_birth text DEFAULT NULL::text, p_size text DEFAULT NULL::text, p_field text DEFAULT NULL::text, p_music jsonb DEFAULT NULL::jsonb, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  is_new boolean;
  who jsonb := private.check_ready(p_id, p_pin);
  mid text;
  n public.audition_news;
  today date := private.now_kst()::date;
  v_name text := trim(coalesce(p_name, ''));
  app_id bigint;
  flds text[];
  v_field text;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  select * into n from public.audition_news where id = p_news and kind = '내방' and published;
  if n.id is null then return private.fail('신청할 오디션을 찾을 수 없어요.'); end if;
  if coalesce(n.deadline, n.event_date - 1) is not null and coalesce(n.deadline, n.event_date - 1) < today then
    return private.fail('신청이 마감됐어요. 학원에 문의해주세요.');
  end if;
  if v_name = '' or char_length(v_name) > 30 then return private.fail('이름을 적어주세요.'); end if;
  if p_gender is not null and p_gender not in ('남', '여') then return private.fail('성별을 골라주세요.'); end if;
  -- 지원분야: 오디션마다 고르는 방식 (원장님 2026-11-12, 이닛 내방 = 보컬 또는 랩 + 댄스 택 2) — 여러 개면 "보컬 + 댄스"
  flds := array(select distinct trim(x) from unnest(string_to_array(coalesce(p_field, ''), '+')) x where trim(x) <> '');
  if cardinality(flds) = 0 or not flds <@ array['보컬', '랩', '댄스', '라이브퍼포먼스', '연기'] then return private.fail('지원분야를 골라주세요.'); end if;
  if coalesce(n.pick, '1') = '1' and cardinality(flds) <> 1 then return private.fail('지원분야는 하나만 골라주세요.'); end if;
  if n.pick = '2' and cardinality(flds) > 2 then return private.fail('지원분야는 2개까지 고를 수 있어요.'); end if;
  if n.pick = 'vd' and not (cardinality(flds) = 2 and '댄스' = any(flds) and (flds && array['보컬', '랩']) and flds <@ array['보컬', '랩', '댄스']) then
    return private.fail('이 오디션은 보컬 또는 랩 중 하나 + 댄스, 2개를 골라주세요.');
  end if;
  v_field := array_to_string(array(select f from unnest(array['보컬', '랩', '댄스', '라이브퍼포먼스', '연기']) f where f = any(flds)), ' + ');
  if char_length(coalesce(p_birth, '')) > 30 or char_length(coalesce(p_size, '')) > 30 or char_length(coalesce(p_note, '')) > 1000 then
    return private.fail('글이 너무 길어요.');
  end if;
  if p_music is not null and coalesce(p_music ->> 'path', '') not like mid || '/%' then return private.fail('음원을 다시 올려주세요.'); end if;
  insert into public.visit_applications (news_id, audition, member_id, name, gender, birth, body_size, field, music, note)
  values (n.id, left(coalesce(n.company || ' ', '') || n.title, 120), mid, v_name, p_gender,
          nullif(trim(coalesce(p_birth, '')), ''), nullif(trim(coalesce(p_size, '')), ''), v_field, p_music,
          nullif(trim(coalesce(p_note, '')), ''))
  on conflict (news_id, member_id) do update set name = excluded.name, gender = excluded.gender, birth = excluded.birth,
    body_size = excluded.body_size, field = excluded.field, music = coalesce(excluded.music, public.visit_applications.music),
    note = excluded.note, updated_at = now()
  returning id, (xmax = 0) into app_id, is_new;
  -- 알림은 처음 신청할 때만 (원장님 2026-11-05: 한 명이 고쳐서 3번 보내 텔레그램이 3번 옴)
  if is_new then perform private.notify('🎤 내방 오디션 신청: ' || v_name || ' · ' || v_field || chr(10) || coalesce(n.company || ' ', '') || n.title); end if;
  return jsonb_build_object('ok', true, 'id', app_id, 'new', is_new);
end $function$;

CREATE OR REPLACE FUNCTION public.member_visit_open(p_id text, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  who jsonb := private.check_ready(p_id, p_pin);
  mid text;
  today date := private.now_kst()::date;
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  mid := who ->> 'id';
  return jsonb_build_object('ok', true, 'name', who ->> 'name',
    'last', (select jsonb_build_object('name', a.name, 'gender', a.gender, 'birth', a.birth, 'body_size', a.body_size, 'field', a.field)
             from public.visit_applications a where a.member_id = mid order by a.updated_at desc nulls last, a.id desc limit 1),
    'auditions', coalesce((
    select jsonb_agg(jsonb_build_object('id', n.id, 'company', n.company, 'title', n.title, 'date', n.event_date,
             'deadline', coalesce(n.deadline, n.event_date - 1), 'body', n.body, 'image', n.image, 'pick', coalesce(n.pick, '1'),
             'mine', (select to_jsonb(a) - 'member_id' from public.visit_applications a where a.news_id = n.id and a.member_id = mid))
             order by n.event_date nulls last, n.id)
    from public.audition_news n
    where n.kind = '내방' and n.published and coalesce(n.deadline, n.event_date - 1, today) >= today
  ), '[]'::jsonb));
end $function$;

update public.audition_news set pick = 'vd' where id = 283;
