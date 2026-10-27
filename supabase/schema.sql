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
begin
  if not (who ->> 'ok')::boolean then return who; end if;
  return private.with_token(who, jsonb_build_object(
    'ok', true,
    'id', who ->> 'id',
    'name', who ->> 'name',
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', n.lesson_date, 'teacher', n.teacher, 'did', n.did, 'practice', n.practice
      ) order by n.lesson_date desc, n.id desc)
      from (select * from public.lesson_notes where member_id = who ->> 'id'
            order by lesson_date desc, id desc limit 30) n
    ), '[]'::jsonb),
    'evals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'month', to_char(e.month, 'YYYY-MM'), 'teacher', e.teacher,
        'scores', jsonb_build_object('pitch', e.pitch, 'rhythm', e.rhythm, 'breath', e.breath,
                                     'expression', e.expression, 'stage', e.stage),
        'comment', e.comment, 'goal', e.goal
      ) order by e.month desc)
      from (select * from public.monthly_evals where member_id = who ->> 'id'
            order by month desc limit 12) e
    ), '[]'::jsonb)
  ));
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

-- 매일 새벽 4시(한국)에 보관 기간이 지난 정보를 지웁니다. 기간을 바꾸면 tools/privacy.py도 같이 고치기.
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
alter table public.admins   enable row level security;
alter table public.lesson_notes  enable row level security;
alter table public.monthly_evals enable row level security;
alter table public.link_requests enable row level security;

-- 손님(anon)은 표를 직접 볼 수 없고, 관리자로 로그인한 사람만 모든 표를 다룹니다.
do $$
declare tbl text;
begin
  foreach tbl in array array['settings', 'rooms', 'bookings', 'consults', 'lesson_notes', 'monthly_evals', 'link_requests'] loop
    execute format('drop policy if exists admin_all on public.%I', tbl);
    execute format('create policy admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', tbl);
  end loop;
end $$;
drop policy if exists admin_read on public.members;
create policy admin_read on public.members for select to authenticated using (public.is_admin());
drop policy if exists admin_read on public.admins;
create policy admin_read on public.admins for select to authenticated using (public.is_admin());

revoke all on public.settings, public.rooms, public.members, public.bookings, public.consults, public.admins, public.link_requests,
  public.lesson_notes, public.monthly_evals from anon;
revoke all on public.members from authenticated;
-- 비밀번호 해시는 관리자에게도 내보내지 않습니다. 수정은 admin_save_member로만.
grant select (id, name, phone, status, expires_on, memo, must_change_pin, kakao_user, created_at) on public.members to authenticated;
grant select, update, delete on public.link_requests to authenticated;
grant delete on public.members to authenticated;
drop policy if exists admin_delete on public.members;
create policy admin_delete on public.members for delete to authenticated using (public.is_admin());
grant select, insert, update, delete on public.settings, public.rooms, public.bookings, public.consults,
  public.lesson_notes, public.monthly_evals to authenticated;
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

-- 보관 기간 정리를 매일 19:00 UTC (= 한국 새벽 4시)에. 같은 이름이면 덮어씁니다.
create extension if not exists pg_cron;
select cron.schedule('leesh_cleanup', '0 19 * * *', 'select private.cleanup()');
