-- 연습실 예약 동시 접속 시험용 복사본 (실제 서버와 같은 표 모양 · 같은 막는 규칙 · 같은 booking_create 함수)
create extension if not exists btree_gist;
create schema private;
create table public.members (id text primary key, name text not null, status text not null default '재원');
create table public.rooms (id serial primary key, name text, kind text default '연습실', sort int default 0, active boolean default true);
create table public.settings (id int primary key default 1, open_min int default 0, close_min int default 1440, unit_min int default 60,
  max_minutes int default 120, daily_max_minutes int default 1440, max_days int default 1, cancel_minutes int default 60,
  pin_login boolean default false, student_notes boolean default false, song_recs boolean default false);
create table private.clock (id int default 1, fixed_kst timestamp);
create table public.bookings (id bigint generated always as identity primary key, room_id int references public.rooms(id),
  member_id text references public.members(id) on update cascade, day date not null, start_min int not null, end_min int not null,
  status text default '확정', memo text, created_at timestamptz default now(), cancelled_at timestamptz,
  constraint bookings_check check (end_min > start_min and end_min <= 1440),
  constraint bookings_start_min_check check (start_min >= 0 and start_min < 1440),
  constraint bookings_status_check check (status = any (array['확정','취소'])),
  constraint bookings_no_member_overlap exclude using gist (member_id with =, day with =, int4range(start_min, end_min) with &&) where (status = '확정'),
  constraint bookings_no_room_overlap exclude using gist (room_id with =, day with =, int4range(start_min, end_min) with &&) where (status = '확정'));
insert into public.settings (id) values (1);
insert into public.rooms (name, sort) values ('B1',1),('B2',2),('B3',3),('B4',4),('B5',5),('C hall',6);
-- 서버와 같은 도우미
create function private.fail(msg text) returns jsonb language sql immutable set search_path = '' as $$ select jsonb_build_object('ok', false, 'error', msg); $$;
create function private.hhmm(m integer) returns text language sql immutable set search_path = '' as $$ select lpad((m / 60)::text, 2, '0') || ':' || lpad((m % 60)::text, 2, '0'); $$;
create function private.day_label(d date) returns text language sql immutable set search_path = '' as $$ select extract(month from d)::int || '/' || extract(day from d)::int; $$;
create function private.now_kst() returns timestamp language sql stable set search_path = '' as $$ select coalesce((select fixed_kst from private.clock where id = 1), now() at time zone 'Asia/Seoul'); $$;
create function private.to_min(t text) returns integer language plpgsql immutable set search_path = '' as $$
declare h int; mm int;
begin
  if t is null or t !~ '^\d{1,2}:\d{2}$' then return null; end if;
  h := split_part(t, ':', 1)::int; mm := split_part(t, ':', 2)::int;
  if mm > 59 or h > 24 or (h = 24 and mm <> 0) then return null; end if;
  return h * 60 + mm;
end $$;
-- 로그인 확인은 시험에서 간단히 (재원 학생이면 통과), 텔레그램 알림은 보내지 않음
create function private.check_ready(p_id text, p_pin text) returns jsonb language sql stable set search_path = '' as $$
  select coalesce((select jsonb_build_object('ok', true, 'id', m.id, 'name', m.name) from public.members m where m.id = p_id and m.status = '재원'),
                  jsonb_build_object('ok', false, 'error', '로그인 필요')); $$;
create function private.notify(msg text) returns void language sql as $$ select; $$;
-- 학생 80명 (가짜 이름)
insert into public.members (id, name) select 'T' || lpad(i::text, 3, '0'), '시험학생' || i from generate_series(1, 80) i;
-- 시험 시각을 오늘 오전 8시로 고정 (오늘 9시~ 예약 가능)
insert into private.clock values (1, date_trunc('day', now() at time zone 'Asia/Seoul') + interval '8 hours');
