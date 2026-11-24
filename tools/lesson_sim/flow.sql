begin;
create temp table r (n serial, step text, ok boolean, res jsonb) on commit drop;
create or replace function pg_temp.as_t(tid int) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', (select kakao_user from public.teachers where id = tid), 'role', 'authenticated')::text, true); $$;
create or replace function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'favort1111@gmail.com', 'app_metadata', json_build_object('provider', 'email'))::text, true); $$;
-- 이번 주에 열리는지 보기
create or replace function pg_temp.on_day(bid bigint, d date) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(public.lesson_room_view(d::text, 1)->'items') x where (x->>'id')::bigint = bid and x->>'date' = d::text) $$;
do $$
declare
  tid int; m text; m2 text; ot text; today date := private.now_kst()::date; w date; reg bigint; mk bigint; x jsonb; st text; b public.lesson_bookings; reg2 bigint;
begin
  -- 선생님 하나(원장님 아닌) · 담당 재원 학생 2명 · 다른 선생님 학생 1명
  select t.id into tid from public.teachers t where t.active and t.kakao_user is not null and t.name <> '원장님'
    and (select count(*) from public.members mm where mm.status = '재원' and private.teaches(t, mm.id)) >= 2 order by t.id limit 1;
  select mm.id into m from public.members mm, public.teachers t where t.id = tid and mm.status = '재원' and private.teaches(t, mm.id) order by mm.id limit 1;
  select mm.id into m2 from public.members mm, public.teachers t where t.id = tid and mm.status = '재원' and private.teaches(t, mm.id) and mm.id <> m order by mm.id limit 1;
  select mm.id into ot from public.members mm, public.teachers t where t.id = tid and mm.status = '재원' and mm.id not in (select m3.id from public.members m3, public.teachers t3 where t3.id = tid and private.teaches(t3, m3.id)) order by mm.id limit 1;
  w := today + 7 + ((3 - extract(dow from today + 7)::int + 7) % 7);   -- 다음 주 이후 첫 수요일
  insert into r(step, ok, res) values ('준비', true, jsonb_build_object('teacher', tid, 'wed', w));

  -- 0) 예약 닫혀 있을 때 선생님은 막힘
  perform pg_temp.as_t(tid);
  x := public.lesson_room_book('A4', m, '정규', w::text, '03:00', 50, null, null);
  insert into r(step, ok, res) values ('닫혀 있을 때 선생님 정규 신청 → 막혀야', not (x->>'ok')::boolean, x);
  update public.settings set lesson_rooms_open = true;

  -- 1) 정규 신청 (끝 날 없음)
  x := public.lesson_room_book('A4', m, '정규', w::text, '03:00', 50, null, '시험');
  reg := (x->>'id')::bigint;
  insert into r(step, ok, res) values ('정규 신청', (x->>'ok')::boolean, x);
  insert into r(step, ok, res) values ('정규: 첫날 · 다음 주 · 5주 뒤 보임, 전날 안 보임',
    pg_temp.on_day(reg, w) and pg_temp.on_day(reg, w + 7) and pg_temp.on_day(reg, w + 35) and not pg_temp.on_day(reg, w - 7), null);
  -- 2) 같은 칸 다른 학생 → 겹침 막힘, 같은 학생 다른 방 같은 시간 → 막힘, 같은 선생님 다른 방 → 막힘
  x := public.lesson_room_book('A4', m2, '보강', (w + 14)::text, '03:20', 30, null, null);
  insert into r(step, ok, res) values ('같은 방 · 겹치는 시간 보강 → 막혀야', not (x->>'ok')::boolean, x);
  x := public.lesson_room_book('A3', m2, '보강', (w + 14)::text, '03:20', 30, null, null);
  insert into r(step, ok, res) values ('같은 선생님 · 다른 방 · 같은 시간 → 막혀야', not (x->>'ok')::boolean, x);
  -- 3) 한 번 빼기 → 그날만 사라지고 다음 주는 그대로 → 그 빈 칸에 보강 가능
  x := public.lesson_room_cancel(reg, 'once', (w + 14)::text);
  insert into r(step, ok, res) values ('정규 한 번 빼기', (x->>'ok')::boolean, x);
  insert into r(step, ok, res) values ('뺀 날만 없음 (전 주 · 다음 주 있음)', not pg_temp.on_day(reg, w + 14) and pg_temp.on_day(reg, w + 7) and pg_temp.on_day(reg, w + 21), null);
  x := public.lesson_room_book('A4', m2, '보강', (w + 14)::text, '03:00', 50, null, null);
  mk := (x->>'id')::bigint;
  insert into r(step, ok, res) values ('뺀 칸에 다른 학생 보강', (x->>'ok')::boolean, x);
  insert into r(step, ok, res) values ('보강은 그날만 보임', pg_temp.on_day(mk, w + 14) and not pg_temp.on_day(mk, w + 21), null);
  -- 4) 보강 취소
  x := public.lesson_room_cancel(mk, 'all', null);
  select * into b from public.lesson_bookings where id = mk;
  insert into r(step, ok, res) values ('보강 취소 → 취소 · 누가', (x->>'ok')::boolean and b.status = '취소' and b.cancelled_by is not null and not pg_temp.on_day(mk, w + 14), jsonb_build_object('r', x, 'by', b.cancelled_by));
  -- 5) 한 번만 다른 시간 (보강으로 옮기기)
  x := public.lesson_room_move(reg, 'once', (w + 21)::text, (w + 22)::text, 'A3', '04:00', 50);
  insert into r(step, ok, res) values ('한 번만 다른 시간(보강으로)', (x->>'ok')::boolean, x);
  insert into r(step, ok, res) values ('원래 날 빠지고 옮긴 날 보강 생김', not pg_temp.on_day(reg, w + 21) and pg_temp.on_day(reg, w + 28)
     and exists (select 1 from public.lesson_bookings where member_id = m and kind = '보강' and first_day = w + 22 and status = '확정' and room_id = (select id from public.lesson_rooms where name = 'A3')), null);
  -- 6) 이날부터 시간 바꾸기
  x := public.lesson_room_move(reg, 'from', (w + 28)::text, (w + 29)::text, 'A2', '05:00', 60);
  reg2 := (x->>'id')::bigint;
  select * into b from public.lesson_bookings where id = reg;
  insert into r(step, ok, res) values ('이날부터 시간 바꾸기', (x->>'ok')::boolean, x);
  insert into r(step, ok, res) values ('옛 정규는 전날까지 · 새 정규는 그날부터 계속', b.last_day = w + 27 and pg_temp.on_day(reg, w + 7) and not pg_temp.on_day(reg, w + 28)
     and exists (select 1 from public.lesson_bookings where member_id = m and kind = '정규' and status = '확정' and first_day = w + 29 and last_day is null and start_min = 300 and end_min = 360), jsonb_build_object('old_last', b.last_day, 'new', reg2));
  select id into reg2 from public.lesson_bookings where member_id = m and kind = '정규' and status = '확정' and first_day = w + 29;
  -- 7) 이날부터 끝내기
  x := public.lesson_room_cancel(reg2, 'from', (w + 29 + 21)::text);
  select * into b from public.lesson_bookings where id = reg2;
  insert into r(step, ok, res) values ('이날부터 끝내기 → 전날까지', (x->>'ok')::boolean and b.last_day = w + 29 + 20 and pg_temp.on_day(reg2, w + 29 + 14) and not pg_temp.on_day(reg2, w + 29 + 21), jsonb_build_object('last', b.last_day));
  -- 8) 시작 전 정규 전부 취소 → 취소
  x := public.lesson_room_cancel(reg2, 'all', null);
  select * into b from public.lesson_bookings where id = reg2;
  insert into r(step, ok, res) values ('시작 전 정규 전부 취소 → 취소', (x->>'ok')::boolean and b.status = '취소' and b.cancelled_by is not null, jsonb_build_object('r', x, 'by', b.cancelled_by));
  -- 9) 끝 날 있는 정규
  x := public.lesson_room_book('A1', m2, '정규', w::text, '06:00', 120, (w + 14)::text, null);
  insert into r(step, ok, res) values ('끝 날 있는 정규 (3번) · 120분', (x->>'ok')::boolean and pg_temp.on_day((x->>'id')::bigint, w + 14) and not pg_temp.on_day((x->>'id')::bigint, w + 21), x);
  -- 10) 막혀야 하는 것들
  x := public.lesson_room_book('A1', m2, '보강', (today - 1)::text, '10:00', 50, null, null);
  insert into r(step, ok, res) values ('어제 날짜 → 막혀야', not (x->>'ok')::boolean, x);
  x := public.lesson_room_book('A1', m2, '보강', w::text, '10:00', 130, null, null);
  insert into r(step, ok, res) values ('130분 → 막혀야', not (x->>'ok')::boolean, x);
  x := public.lesson_room_book('A1', m2, '보강', w::text, '23:30', 50, null, null);
  insert into r(step, ok, res) values ('자정 넘김 → 막혀야', not (x->>'ok')::boolean, x);
  x := public.lesson_room_book('A1', m2, '보강', w::text, '10:05', 50, null, null);
  insert into r(step, ok, res) values ('10분 단위 아님 → 막혀야', not (x->>'ok')::boolean, x);
  if ot is not null then
    x := public.lesson_room_book('A1', ot, '보강', w::text, '06:00', 50, null, null);
    insert into r(step, ok, res) values ('담당 아닌 학생 → 막혀야', not (x->>'ok')::boolean, x);
  end if;
  select id into reg2 from public.lesson_bookings where status = '확정' and teacher_id <> tid and coalesce(last_day, 'infinity') >= today limit 1;
  x := public.lesson_room_cancel(reg2, 'all', null);
  insert into r(step, ok, res) values ('다른 선생님 예약 취소 → 막혀야', not (x->>'ok')::boolean, x);
  x := public.lesson_room_move(reg2, 'once', w::text, (w + 1)::text, 'A1', '07:00', 50);
  insert into r(step, ok, res) values ('다른 선생님 예약 옮기기 → 막혀야', not (x->>'ok')::boolean, x);
  -- 11) 이미 시작한 정규(시트에서 온 것) 전부 취소 → 어제까지 (관리자)
  perform pg_temp.as_admin();
  select id into reg2 from public.lesson_bookings where status = '확정' and kind = '정규' and first_day < today and last_day is null limit 1;
  x := public.lesson_room_cancel(reg2, 'all', null);
  select * into b from public.lesson_bookings where id = reg2;
  insert into r(step, ok, res) values ('관리자: 시작한 정규 전부 취소 → 어제까지 · 기록 남음', (x->>'ok')::boolean and b.status = '확정' and b.last_day = today - 1 and b.cancelled_by = '관리자', jsonb_build_object('r', x, 'last', b.last_day));
  -- 관리자: 아무 학생 보강
  select id into ot from public.members where status = '재원' and id <> 'DEMO' order by id desc limit 1;
  x := public.lesson_room_book('A2', ot, '보강', (w + 1)::text, '01:00', 40, null, null);
  insert into r(step, ok, res) values ('관리자: 아무 학생 보강', (x->>'ok')::boolean, x);
  -- 12) 오늘 이미 시작한 수업 빼기/취소 (지금 시각 기준, 오늘 지난 수업이 있으면)
  select b2.id into reg2 from public.lesson_bookings b2 where b2.status = '확정' and b2.kind = '정규' and b2.weekday = extract(dow from today)::int
    and b2.first_day <= today and coalesce(b2.last_day, 'infinity') >= today
    and b2.start_min <= extract(hour from private.now_kst())::int * 60 + extract(minute from private.now_kst())::int limit 1;
  if reg2 is not null then
    x := public.lesson_room_cancel(reg2, 'once', today::text);
    insert into r(step, ok, res) values ('오늘 이미 시작한 정규 한 번 빼기 → 막혀야', not (x->>'ok')::boolean, x);
    x := public.lesson_room_move(reg2, 'once', today::text, (w + 2)::text, 'A1', '08:00', 50);
    insert into r(step, ok, res) values ('오늘 이미 시작한 정규 옮기기 → 막혀야', not (x->>'ok')::boolean, x);
    x := public.lesson_room_cancel(reg2, 'from', today::text);
    select * into b from public.lesson_bookings where id = reg2;
    insert into r(step, ok, res) values ('오늘 시작한 정규 "오늘부터 끝내기" → 오늘 수업은 남김', (x->>'ok')::boolean and b.status = '확정' and b.last_day = today, jsonb_build_object('r', x, 'last', b.last_day));
    update public.lesson_bookings set last_day = null where id = reg2;
    x := public.lesson_room_cancel(reg2, 'all', null);
    select * into b from public.lesson_bookings where id = reg2;
    insert into r(step, ok, res) values ('오늘 시작한 정규 "전부 끝내기" → 오늘까지', (x->>'ok')::boolean and b.last_day = today, jsonb_build_object('r', x, 'last', b.last_day));
  else
    insert into r(step, ok, res) values ('(오늘 이미 시작한 정규 없음 · 건너뜀)', true, null);
  end if;
end $$;
select json_agg(json_build_object('n', n, 'step', step, 'ok', ok, 'msg', coalesce(res->>'error', res::text)) order by n) from r;
rollback;
