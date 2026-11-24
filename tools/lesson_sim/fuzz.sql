begin;
update public.settings set lesson_rooms_open = true where id = 1;
select setseed(__SEED__);
create temp table lg (n serial, op text, who text, ok boolean, msg text, ms numeric) on commit drop;
create temp table bad (n serial, kind text, info jsonb) on commit drop;
create or replace function pg_temp.as_t(tid int) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', (select kakao_user from public.teachers where id = tid), 'role', 'authenticated')::text, true); $$;
create or replace function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'favort1111@gmail.com', 'app_metadata', json_build_object('provider', 'email'))::text, true); $$;
-- 앞으로 120일 동안 실제로 열리는 수업 (빠진 날 제외)
create or replace function pg_temp.occ() returns table(room int, member text, teacher int, d date, st int, en int, id bigint) language sql as $$
  select b.room_id, b.member_id, b.teacher_id, g.d::date, b.start_min, b.end_min, b.id
    from generate_series(private.now_kst()::date, private.now_kst()::date + 120, interval '1 day') g(d)
    join public.lesson_bookings b on b.status = '확정' and b.weekday = extract(dow from g.d)::int
     and b.first_day <= g.d::date and coalesce(b.last_day, 'infinity'::date) >= g.d::date
   where not exists (select 1 from public.lesson_skips k where k.booking_id = b.id and k.day = g.d::date) $$;
create or replace function pg_temp.clashes() returns jsonb language sql as $$
  with o as (select * from pg_temp.occ())
  select jsonb_agg(jsonb_build_object('a', a.id, 'b', b.id, 'd', a.d, 'why', case when a.room = b.room then 'room' when a.member = b.member then 'member' else 'teacher' end))
    from o a join o b on a.id < b.id and a.d = b.d and a.st < b.en and b.st < a.en
     and (a.room = b.room or a.member = b.member or a.teacher = b.teacher) $$;
insert into bad(kind, info) select 'baseline_clash', pg_temp.clashes() where pg_temp.clashes() is not null;

do $$
declare
  i int; adm boolean; tid int; tt public.teachers; op text; r jsonb; b public.lesson_bookings; nb public.lesson_bookings;
  m text; d date; o date; st int; mins int; room text; k timestamp; today date; nowm int; t0 timestamptz; c jsonb; kind text; base date;
begin
  for i in 1..__N__ loop
    k := private.now_kst(); today := k::date; nowm := extract(hour from k)::int * 60 + extract(minute from k)::int;
    if random() < 0.3 then adm := true; tid := null; tt := null; perform pg_temp.as_admin();
    else adm := false; tid := (array[1,3,5,6,7,8])[1 + floor(random() * 6)::int]; select * into tt from public.teachers where id = tid; perform pg_temp.as_t(tid); end if;
    op := (array['book','book','book','book','once','from','all','mvonce','mvfrom','mvonce'])[1 + floor(random() * 10)::int];
    room := 'A' || (1 + floor(random() * 4))::int;
    d := today + (floor(random() * 75) - 5)::int;
    st := floor(random() * 144)::int * 10;
    if random() < 0.5 then st := (540 + floor(random() * 84)::int * 10); end if;   -- 9시~23시에 더 많이
    mins := (1 + floor(random() * 13))::int * 10;                                  -- 10~130분 (130은 막혀야 함)
    begin
      t0 := clock_timestamp();
      if op = 'book' then
        if adm or random() < 0.15 then
          select id into m from public.members where status in ('재원','외부') and id <> 'DEMO' order by random() limit 1;
        else
          select mm.id into m from public.members mm where mm.status in ('재원','외부') and private.teaches(tt, mm.id) order by random() limit 1;
        end if;
        kind := case when random() < 0.5 then '정규' else '보강' end;
        r := public.lesson_room_book(room, m, kind, d::text, private.hhmm(st), mins,
               case when random() < 0.3 then (d + floor(random() * 60)::int)::text end, case when random() < 0.1 then repeat('메', 501) end);
        insert into lg(op, who, ok, msg, ms) values (op, case when adm then 'admin' else 't' end, (r->>'ok')::boolean, r->>'error', extract(epoch from clock_timestamp() - t0) * 1000);
        if (r->>'ok')::boolean then
          select * into nb from public.lesson_bookings where id = (r->>'id')::bigint;
          if not adm and not private.teaches(tt, nb.member_id) then insert into bad(kind, info) values ('teacher_booked_other_student', to_jsonb(nb)); end if;
          if nb.first_day < today or (nb.first_day = today and nb.start_min <= nowm) then insert into bad(kind, info) values ('booked_past', to_jsonb(nb)); end if;
          if nb.end_min - nb.start_min > 120 then insert into bad(kind, info) values ('too_long', to_jsonb(nb)); end if;
          if not adm and nb.teacher_id is distinct from tid then insert into bad(kind, info) values ('teacher_id_wrong', to_jsonb(nb)); end if;
        end if;
      else
        select * into b from public.lesson_bookings where status = '확정'
         order by (not adm and random() < 0.6 and teacher_id = tid) desc, (coalesce(last_day, 'infinity'::date) >= today) desc, random() limit 1;
        base := greatest(b.first_day, today - 7);
        o := base + ((b.weekday - extract(dow from base)::int + 7) % 7) + 7 * floor(random() * 6)::int;
        if b.kind = '보강' then o := b.first_day; end if;
        if op in ('once','from','all') then
          r := public.lesson_room_cancel(b.id, op, o::text);
        else
          r := public.lesson_room_move(b.id, case when op = 'mvonce' then 'once' else 'from' end, o::text, d::text, room, private.hhmm(st), mins);
        end if;
        insert into lg(op, who, ok, msg, ms) values (op, case when adm then 'admin' else 't' end, (r->>'ok')::boolean, r->>'error', extract(epoch from clock_timestamp() - t0) * 1000);
        if (r->>'ok')::boolean then
          if not adm and b.teacher_id is distinct from tid then insert into bad(kind, info) values ('teacher_changed_others', jsonb_build_object('op', op, 'b', to_jsonb(b), 'tid', tid)); end if;
          if op in ('once','from','mvonce') and b.kind = '정규' and o < today then insert into bad(kind, info) values ('changed_past', jsonb_build_object('op', op, 'on', o, 'b', to_jsonb(b))); end if;
          if op = 'all' and b.kind = '정규' and b.first_day < today then
            select * into nb from public.lesson_bookings where id = b.id;
            if nb.status <> '확정' or nb.last_day <> today - 1 then insert into bad(kind, info) values ('all_started_wrong', jsonb_build_object('before', to_jsonb(b), 'after', to_jsonb(nb))); end if;
          end if;
          if op like 'mv%' and (d < today or (d = today and st <= nowm)) then insert into bad(kind, info) values ('moved_to_past', jsonb_build_object('op', op, 'd', d, 'st', st)); end if;
          if op in ('once','from','all') and (select cancelled_by from public.lesson_bookings where id = b.id) is null
             and not (op = 'once' and b.kind = '정규') then insert into bad(kind, info) values ('no_cancelled_by', jsonb_build_object('op', op, 'id', b.id)); end if;
        end if;
      end if;
      c := pg_temp.clashes();
      if c is not null then insert into bad(kind, info) values ('clash_after_' || op, jsonb_build_object('i', i, 'r', r, 'tid', tid, 'adm', adm, 'args', jsonb_build_object('room', room, 'd', d, 'st', st, 'mins', mins, 'o', o, 'b', to_jsonb(b)),
  'rows', (select jsonb_agg(to_jsonb(x) - 'memo' - 'student_name') from public.lesson_bookings x where x.id in ((c->0->>'a')::bigint, (c->0->>'b')::bigint)),
  'skips', (select jsonb_agg(to_jsonb(kk)) from public.lesson_skips kk where kk.booking_id in ((c->0->>'a')::bigint, (c->0->>'b')::bigint)), 'c0', c->0)); exit; end if;
    exception when others then
      insert into bad(kind, info) values ('exception_' || op, jsonb_build_object('i', i, 'err', sqlerrm, 'state', sqlstate));
    end;
  end loop;
end $$;

-- 보기 함수가 실제 열리는 수업과 같은지 (관리자, 앞으로 8주)
select pg_temp.as_admin();
insert into bad(kind, info)
select 'view_mismatch', jsonb_build_object('week', w, 'view', v, 'occ', o)
  from (select w, jsonb_array_length(public.lesson_room_view(w::text, 7)->'items') v,
               (select count(*) from pg_temp.occ() x where x.d between w and w + 6) o
          from generate_series(private.now_kst()::date, private.now_kst()::date + 49, interval '7 day') g(w0), lateral (select g.w0::date w) q) z
 where v <> o;

select json_build_object(
  'ops', (select json_object_agg(op || '/' || who, json_build_object('n', n, 'ok', ok, 'avg_ms', a, 'max_ms', mx)) from
           (select op, who, count(*) n, count(*) filter (where ok) ok, round(avg(ms), 1) a, round(max(ms), 1) mx from lg group by 1, 2) s),
  'fails', (select json_object_agg(msg, n) from (select regexp_replace(msg, ':.*', ':…') msg, count(*) n from lg where not ok group by 1 order by 2 desc) s),
  'bad', (select coalesce(json_agg(json_build_object('kind', kind, 'info', info) order by n), '[]') from bad),
  'rows_after', (select count(*) from public.lesson_bookings where status = '확정'));
rollback;
