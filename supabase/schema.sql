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
  select exists (select 1 from public.admins a
                 where a.email = lower(coalesce(auth.jwt() ->> 'email', '')));
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
          where (d > today or g >= (now_min / s.unit_min) * s.unit_min)
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
  if d = today and st < (now_min / s.unit_min) * s.unit_min then
    return private.fail('이미 지난 시간입니다.');
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
    'request', (select jsonb_build_object('at', q.created_at, 'likes', q.likes, 'goal', q.goal, 'memo', q.memo)
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
create or replace function public.member_song_request(p_id text, p_pin text, p_likes text default null,
  p_goal text default null, p_memo text default null) returns jsonb
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
  select id into open_id from public.song_requests where member_id = mid and status = '접수' order by id desc limit 1;
  if open_id is null then
    if (select count(*) from public.song_requests where member_id = mid and created_at > now() - interval '30 days') >= 5 then
      return private.fail('한 달에 5번까지 신청할 수 있어요.');
    end if;
    insert into public.song_requests (member_id, likes, goal, memo) values (mid, v_likes, p_goal, v_memo) returning id into open_id;
    perform private.notify('🎵 노래 추천 신청: ' || (who ->> 'name') || ' (' || mid || ')');
  else
    update public.song_requests set likes = v_likes, goal = p_goal, memo = v_memo where id = open_id;
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
revoke execute on function public.member_song_request(text, text, text, text, text) from public;
grant execute on function public.member_song_request(text, text, text, text, text) to anon, authenticated;
