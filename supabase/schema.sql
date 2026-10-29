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

