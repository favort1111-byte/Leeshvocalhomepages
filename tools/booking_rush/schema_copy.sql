-- 시험용 복사본: 실제 서버와 같은 표 모양 · 같은 겹침 막기 · 실제 함수 그대로 (로그인 확인 · 알림만 간단히)
create extension if not exists btree_gist;
create schema private; create schema cron;
create table public.members (id text primary key, name text not null, status text not null default '재원');
create table public.teachers (id serial primary key, name text not null, active boolean default true);
create table public.rooms (id serial primary key, name text, kind text default '연습실', sort int default 0, active boolean default true);
create table public.settings (id int primary key default 1, open_min int default 0, close_min int default 1440, unit_min int default 60,
  max_minutes int default 120, daily_max_minutes int default 1440, max_days int default 1, cancel_minutes int default 60,
  pin_login boolean default false, student_notes boolean default true, song_recs boolean default false, booking_open boolean default false, cctv_consent boolean default true);
create table private.clock (id int primary key default 1, fixed_kst timestamp);
create table private.notify_queue (id bigserial primary key, msg text, at timestamptz default now());
create table private.sent (id bigserial primary key, msg text);
create table private.fixed_blocks (id serial primary key, dow int, room text, start_h int, end_h int, memo text, active boolean default true);
create table private.fixed_blocks_state (id int primary key default 1, filled_until date);
create table public.bookings (id bigint generated always as identity primary key, room_id int references public.rooms(id),
  member_id text references public.members(id) on update cascade, day date not null, start_min int not null, end_min int not null,
  status text default '확정', memo text, created_at timestamptz default now(), cancelled_at timestamptz, teacher_id int references public.teachers(id),
  constraint bookings_check check (end_min > start_min and end_min <= 1440),
  constraint bookings_start_min_check check (start_min >= 0 and start_min < 1440),
  constraint bookings_status_check check (status = any (array['확정','취소'])),
  constraint bookings_no_member_overlap exclude using gist (member_id with =, day with =, int4range(start_min, end_min) with &&) where (status = '확정'),
  constraint bookings_no_room_overlap exclude using gist (room_id with =, day with =, int4range(start_min, end_min) with &&) where (status = '확정'),
  constraint bookings_no_teacher_overlap exclude using gist (teacher_id with =, day with =, int4range(start_min, end_min) with &&) where (status = '확정' and teacher_id is not null));
insert into public.settings (id) values (1);
insert into public.rooms (name, kind, sort) values ('B1','연습실',1),('B2','연습실',2),('B3','연습실',3),('B4','연습실',4),('B5','연습실',5),('C hall','춤연습실',6);
insert into private.fixed_blocks (dow, room, start_h, end_h, memo) values
 (1,'B1',0,2,'청소 (매주 고정)'),(1,'B2',0,2,'청소 (매주 고정)'),(1,'B3',0,2,'청소 (매주 고정)'),(1,'B4',0,2,'청소 (매주 고정)'),(1,'B5',0,2,'청소 (매주 고정)'),(1,'C hall',0,2,'청소 (매주 고정)'),
 (1,'C hall',18,23,'댄스특강 (매주 고정)'),(3,'C hall',18,23,'댄스특강 (매주 고정)'),(6,'C hall',13,18,'댄스특강 (매주 고정)'),(0,'C hall',13,18,'댄스특강 (매주 고정)'),(5,'C hall',18,22,'오디션 (매주 고정)');
insert into private.fixed_blocks_state values (1, date '2026-11-12');
insert into private.clock values (1, timestamp '2026-11-15 23:59:30');
create function private.now_kst() returns timestamp language sql stable set search_path = '' as $$ select coalesce((select fixed_kst from private.clock where id = 1), now() at time zone 'Asia/Seoul'); $$;
-- 로그인 확인은 간단히: p_id가 재원 · 외부 학생이면 통과 (실제 check_member의 마지막 검사와 같은 조건)
create function private.check_ready(p_id text, p_pin text) returns jsonb language sql stable set search_path = '' as $$
  select coalesce((select case when m.status in ('재원','외부') then jsonb_build_object('ok', true, 'id', m.id, 'name', m.name)
      else jsonb_build_object('ok', false, 'error', '현재 이용 중인 수강 ID가 아닙니다. 학원에 문의해주세요.') end from public.members m where m.id = p_id),
    jsonb_build_object('ok', false, 'code', 'not_linked', 'error', '아직 학원 승인 전이에요. 승인되면 바로 쓸 수 있어요.')); $$;
create function private.my_teacher() returns public.teachers language sql stable set search_path = '' as $$
  select t from public.teachers t where t.id = nullif(current_setting('sim.teacher', true), '')::int and t.active; $$;
create function public.is_admin() returns boolean language sql stable as $$ select coalesce(current_setting('sim.admin', true), '') = '1'; $$;
-- 알림: 실제처럼 예약 알림은 1시간 모아 보내는 줄에 쌓음 (텔레그램은 안 보냄)
create function private.notify(msg text) returns void language plpgsql set search_path = '' as $$ begin insert into private.notify_queue (msg) values (msg); end $$;
create function private.notify_send(msg text) returns void language plpgsql set search_path = '' as $$ begin insert into private.sent (msg) values (msg); end $$;
create function cron.unschedule(j text) returns boolean language sql as $$ select true; $$;
insert into public.members (id, name) select 'T' || lpad(i::text, 3, '0'), '시험학생' || i from generate_series(1, 220) i;
insert into public.members (id, name, status) values ('H001','휴원학생','휴원'),('X001','종료학생','종료'),('G001','외부손님','외부');
insert into public.teachers (name) select '시험선생' || i from generate_series(1, 8) i;
