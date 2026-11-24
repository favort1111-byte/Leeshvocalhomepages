begin;
update public.settings set lesson_rooms_open = true where id = 1;
select setseed(__SEED__);
create temp table lg (n serial, op text, ok boolean, msg text);
create temp table bad (n serial, kind text, info jsonb);
create or replace function pg_temp.as_t(tid bigint) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', (select kakao_user from public.teachers where id = tid), 'role', 'authenticated')::text, true); $$;
create or replace function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'favort1111@gmail.com', 'app_metadata', json_build_object('provider', 'email'))::text, true); $$;
-- 관리자 화면 값을 "선생님 · 키(날짜 또는 w요일) → '14:50~15:40,…'" 로
create or replace function pg_temp.view_map() returns table(tid bigint, k text, v text) language sql as $$
  with f as (select public.teacher_free(null, 14) j)
  select (t->>'id')::bigint, 'd' || (d->>'date'), coalesce((select string_agg((x->>0) || '~' || (x->>1), ',' order by x->>0) from jsonb_array_elements(d->'free') x), '')
    from f, jsonb_array_elements(f.j->'teachers') t, jsonb_array_elements(t->'days') d where (d->>'date')::date > private.now_kst()::date
  union all
  select (t->>'id')::bigint, 'w' || (w->>'wd'), coalesce((select string_agg((x->>0) || '~' || (x->>1), ',' order by x->>0) from jsonb_array_elements(w->'free') x), '')
    from f, jsonb_array_elements(f.j->'teachers') t, jsonb_array_elements(t->'weekly') w $$;
-- 완전히 다른 방법: 10분 칸 하나씩 (근무 안 · 수업 밖 · 휴무 밖) → 이어지는 칸 묶기 → 30분 이상
create or replace function pg_temp.ref_map() returns table(tid bigint, k text, v text) language sql as $$
  with today as (select private.now_kst()::date d),
  tt as (select id from public.teachers where active),
  keys as (select tt.id tid, 'd' || g.d::date k, g.d::date dd, extract(dow from g.d)::int wd, false weekly
             from tt, today, generate_series(today.d + 1, today.d + 13, interval '1 day') g(d)
           union all select tt.id, 'w' || w, null, w, true from tt, generate_series(0, 6) w),
  slots as (select keys.*, s.m from keys, generate_series(0, 1430, 10) s(m)),
  ok as (
    select sl.* from slots sl, today
     where (case when exists (select 1 from public.teacher_hours h where h.teacher_id = sl.tid)
                 then exists (select 1 from public.teacher_hours h where h.teacher_id = sl.tid and h.weekday = sl.wd
                               and ((h.s1 is not null and sl.m >= h.s1 and sl.m < h.e1) or (h.s2 is not null and sl.m >= h.s2 and sl.m < h.e2)))
                 else sl.m >= 600 and sl.m < 1320 end)
       and not exists (select 1 from public.lesson_bookings b where b.teacher_id = sl.tid and b.status = '확정' and b.weekday = sl.wd
                         and sl.m >= b.start_min and sl.m < b.end_min
                         and case when sl.weekly then b.kind = '정규' and coalesce(b.last_day, 'infinity'::date) >= today.d
                                  else b.first_day <= sl.dd and coalesce(b.last_day, 'infinity'::date) >= sl.dd
                                       and not exists (select 1 from public.lesson_skips s where s.booking_id = b.id and s.day = sl.dd) end)
       and (sl.weekly or not exists (select 1 from public.teacher_offs o where o.teacher_id = sl.tid and o.day = sl.dd
                         and sl.m >= coalesce(o.s, 0) and sl.m < coalesce(o.e, 1440)))),
  runs as (select tid, k, min(m) a, max(m) + 10 b from (select ok.*, m - 10 * row_number() over (partition by tid, k order by m) grp from ok) z group by tid, k, grp)
  select keys.tid, keys.k, coalesce((select string_agg(private.hhmm(r.a) || '~' || private.hhmm(r.b), ',' order by private.hhmm(r.a)) from runs r
                                       where r.tid = keys.tid and r.k = keys.k and r.b - r.a >= 30), '')
    from keys $$;
create or replace function pg_temp.compare(i int, op text) returns int language plpgsql as $$
declare n int; begin
  perform pg_temp.as_admin();
  create temp table if not exists vm (tid bigint, k text, v text); truncate vm; insert into vm select * from pg_temp.view_map();
  create temp table if not exists rm (tid bigint, k text, v text); truncate rm; insert into rm select * from pg_temp.ref_map();
  select count(*) into n from rm full join vm using (tid, k) where rm.v is distinct from vm.v;
  if n > 0 then
    insert into bad(kind, info) select 'mismatch', jsonb_build_object('i', i, 'op', op, 'tid', tid, 'k', k, 'ref', rm.v, 'view', vm.v)
      from rm full join vm using (tid, k) where rm.v is distinct from vm.v limit 3;
  end if;
  return n;
end $$;

do $$
declare
  i int; tid bigint; tts bigint[] := array[1,3,5,6,7,8]; op text; r jsonb; fj jsonb; dj jsonb; fr jsonb; m text; d date; st int; en int; mins int;
  room text; b public.lesson_bookings; o date; base date; today date; checks int := 0; mm int; slot record; free_after text; oid bigint;
begin
  for i in 1..__N__ loop
    today := private.now_kst()::date;
    tid := tts[1 + floor(random() * 6)::int];
    perform pg_temp.as_t(tid);
    op := (array['book','book','book','book','once','from','all','mvonce','mvfrom','offadd','offadd','offdel','hours'])[1 + floor(random() * 13)::int];
    begin
      if op = 'book' then
        -- 그 선생님 빈 시간 하나를 골라서 예약 (내일 ~ 13일 뒤)
        fj := public.teacher_free(null, 14)->'teachers'->0;
        select x into dj from jsonb_array_elements(fj->'days') x where (x->>'date')::date > today and jsonb_array_length(x->'free') > 0 order by random() limit 1;
        if dj is null then insert into lg(op, ok, msg) values (op, false, '빈 시간 없음'); continue; end if;
        fr := dj->'free'->(floor(random() * jsonb_array_length(dj->'free'))::int);
        st := private.to_min(fr->>0); en := private.to_min(fr->>1);
        mins := least(120, (en - st)); mins := 30 + floor(random() * ((mins - 30) / 10 + 1))::int * 10;
        st := st + floor(random() * ((en - st - mins) / 10 + 1))::int * 10;
        d := (dj->>'date')::date;
        select mm2.id into m from public.members mm2, public.teachers t where t.id = tid and mm2.status in ('재원','외부') and private.teaches(t, mm2.id) order by random() limit 1;
        r := null;
        foreach room in array (select array_agg(x order by random()) from unnest(array['A1','A2','A3','A4']) x) loop
          r := public.lesson_room_book(room, m, case when random() < 0.5 then '정규' else '보강' end, d::text, private.hhmm(st), mins, null, null);
          exit when (r->>'ok')::boolean;
        end loop;
        insert into lg(op, ok, msg) values (op, (r->>'ok')::boolean, r->>'error');
        if (r->>'ok')::boolean then
          -- 방금 잡은 시간이 관리자 빈 시간에서 바로 사라졌는지
          perform pg_temp.as_admin();
          select coalesce(string_agg((x->>0) || '~' || (x->>1), ','), '') into free_after
            from jsonb_array_elements(public.teacher_free(tid::int, 14)->'teachers'->0->'days') dd, jsonb_array_elements(dd->'free') x
           where (dd->>'date')::date = d and private.to_min(x->>0) < st + mins and st < private.to_min(x->>1);
          if free_after <> '' then insert into bad(kind, info) values ('booked_still_free', jsonb_build_object('i', i, 'tid', tid, 'd', d, 'st', st, 'mins', mins, 'free', free_after)); end if;
        end if;
      elsif op in ('once','from','all','mvonce','mvfrom') then
        select * into b from public.lesson_bookings where status = '확정' and teacher_id = tid and coalesce(last_day, 'infinity'::date) >= today order by random() limit 1;
        if b.id is null then continue; end if;
        base := greatest(b.first_day, today + 1);
        o := base + ((b.weekday - extract(dow from base)::int + 7) % 7) + 7 * floor(random() * 3)::int;
        if b.kind = '보강' then o := b.first_day; end if;
        if op in ('once','from','all') then r := public.lesson_room_cancel(b.id, op, o::text);
        else
          d := today + 1 + floor(random() * 12)::int; st := (13 + floor(random() * 8)::int) * 60 + floor(random() * 6)::int * 10;
          r := public.lesson_room_move(b.id, case when op = 'mvonce' then 'once' else 'from' end, o::text, d::text,
                 'A' || (1 + floor(random() * 4))::int, private.hhmm(st), 50);
        end if;
        insert into lg(op, ok, msg) values (op, (r->>'ok')::boolean, r->>'error');
      elsif op = 'offadd' then
        d := today + 1 + floor(random() * 12)::int;
        if random() < 0.3 then r := public.teacher_off_add(null, d::text, null, null, '시뮬');
        else st := (12 + floor(random() * 9)::int) * 60; r := public.teacher_off_add(null, d::text, private.hhmm(st), private.hhmm(st + 60 + floor(random() * 3)::int * 30), '시뮬'); end if;
        insert into lg(op, ok, msg) values (op, (r->>'ok')::boolean, r->>'error');
      elsif op = 'offdel' then
        select id into oid from public.teacher_offs where teacher_id = tid order by random() limit 1;
        if oid is null then continue; end if;
        r := public.teacher_off_delete(oid);
        insert into lg(op, ok, msg) values (op, (r->>'ok')::boolean, r->>'error');
      elsif op = 'hours' then
        -- 근무 시간 한 요일 바꾸기
        st := (11 + floor(random() * 6)::int) * 60;
        if random() < 0.5 then
          r := public.teacher_hours_save(null, jsonb_build_array(jsonb_build_object('wd', floor(random() * 7)::int, 's1', private.hhmm(st), 'e1', private.hhmm(st + 180))));
        else
          r := public.teacher_hours_save(null, jsonb_build_array(jsonb_build_object('wd', floor(random() * 7)::int,
                 's1', private.hhmm(st), 'e1', private.hhmm(st + 180), 's2', private.hhmm(st + 240), 'e2', private.hhmm(st + 420))));
        end if;
        insert into lg(op, ok, msg) values (op, (r->>'ok')::boolean, r->>'error');
      end if;
      mm := pg_temp.compare(i, op); checks := checks + 1;
    exception when others then
      insert into bad(kind, info) values ('exception_' || op, jsonb_build_object('i', i, 'err', sqlerrm));
    end;
  end loop;
  insert into lg(op, ok, msg) values ('checks', true, checks::text);
end $$;

select json_build_object(
  'ops', (select json_object_agg(op, json_build_object('n', n, 'ok', ok)) from (select op, count(*) n, count(*) filter (where ok) ok from lg where op <> 'checks' group by op) s),
  'checks', (select msg from lg where op = 'checks'),
  'fails', (select json_object_agg(msg, n) from (select regexp_replace(coalesce(msg, ''), ':.*', ':…') msg, count(*) n from lg where not ok group by 1 order by 2 desc limit 8) s),
  'bad', (select coalesce(json_agg(json_build_object('kind', kind, 'info', info) order by n), '[]') from bad));
rollback;
