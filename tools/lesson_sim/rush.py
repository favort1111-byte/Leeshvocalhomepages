"""레슨실 동시 접속 시험 (로컬 Postgres, 실제 서버 함수 그대로). 실제 서버는 안 건드림."""
import psycopg, threading, random, time, json, sys, datetime as dt
DSN = "host=127.0.0.1 port=55432 user=postgres dbname=lr"
T = 6

def conn(tid=None, admin=False):
    c = psycopg.connect(DSN, autocommit=True)
    c.execute("set statement_timeout = '8s'")
    if admin: c.execute("set sim.admin = '1'")
    if tid: c.execute("select set_config('sim.tid', %s, false)", (str(tid),))
    return c

def reset():
    with conn() as c:
        c.execute("truncate public.lesson_skips, public.lesson_bookings restart identity cascade")
        c.execute("delete from public.members; delete from public.teachers")
        c.execute("update public.settings set lesson_rooms_open = true")
        for i in range(1, T + 1):
            c.execute("insert into public.teachers (id, name) values (%s, %s)", (i, f"선생{i}"))
        for i in range(1, 121):
            c.execute("insert into public.members (id, name, memo) values (%s, %s, %s)", (f"S{i:03d}", f"학생{i}", f"담당 선생{(i - 1) % T + 1}"))

def clashes():
    with conn() as c:
        return c.execute("""
          with o as (select b.id, b.room_id room, b.member_id member, b.teacher_id teacher, g.d::date d, b.start_min st, b.end_min en
            from generate_series(private.now_kst()::date, private.now_kst()::date + 120, interval '1 day') g(d)
            join public.lesson_bookings b on b.status = '확정' and b.weekday = extract(dow from g.d)::int
             and b.first_day <= g.d::date and coalesce(b.last_day, 'infinity'::date) >= g.d::date
           where not exists (select 1 from public.lesson_skips k where k.booking_id = b.id and k.day = g.d::date))
          select count(*) from o a join o b on a.id < b.id and a.d = b.d and a.st < b.en and b.st < a.en
            and (a.room = b.room or a.member = b.member or a.teacher = b.teacher)""").fetchone()[0]

def students(tid):
    return [f"S{i:03d}" for i in range(1, 121) if (i - 1) % T + 1 == tid]

def call(c, fn, *a):
    t0 = time.time()
    try:
        r = c.execute(f"select public.{fn}({', '.join(['%s'] * len(a))})", a).fetchone()[0]
        return r, time.time() - t0, None
    except Exception as e:
        return None, time.time() - t0, f"{type(e).__name__}: {str(e).splitlines()[0]}"

def burst(name, jobs):
    """jobs = [(tid|None, fn, args)] → 모두 같은 순간에"""
    conns = [conn(tid=j[0], admin=j[0] is None) for j in jobs]
    out = [None] * len(jobs); bar = threading.Barrier(len(jobs))
    def run(i):
        bar.wait(); out[i] = call(conns[i], jobs[i][1], *jobs[i][2])
    ths = [threading.Thread(target=run, args=(i,)) for i in range(len(jobs))]
    [t.start() for t in ths]; [t.join() for t in ths]; [c.close() for c in conns]
    ok = sum(1 for r, _, e in out if r and r.get("ok")); errs = [e for _, _, e in out if e]
    msgs = {}
    for r, _, e in out:
        if r and not r.get("ok"): k = r["error"].split(":")[0]; msgs[k] = msgs.get(k, 0) + 1
    return {"name": name, "n": len(jobs), "ok": ok, "errors": errs[:3], "err_n": len(errs), "fails": msgs,
            "max_s": round(max(t for _, t, _ in out), 3), "clash": clashes()}

def day(n):  # 오늘에서 n일 뒤
    return (dt.date.today() + dt.timedelta(days=n)).isoformat()

res = []
reset()
D = day(14)
# 1) 같은 방 · 같은 시간에 6명 선생님 + 관리자 30명이 동시에 (서로 다른 학생)
jobs = []
for k in range(36):
    tid = (k % T) + 1 if k < 30 else None
    st = students(tid or 1)[k % 20]
    jobs.append((tid, "lesson_room_book", ("A1", st, "정규", D, "15:00", 50, None, None)))
res.append(burst("같은 방 · 같은 시간 36명 (정규)", jobs))
# 2) 같은 학생을 서로 다른 방 4개에 관리자 4명 + 담당 선생님이 동시에
jobs = [(None, "lesson_room_book", (f"A{r}", "S010", "보강", D, "18:00", 50, None, None)) for r in range(1, 5)]
jobs += [(4, "lesson_room_book", ("A2", "S010", "정규", D, "18:20", 50, None, None))]
res.append(burst("같은 학생 · 다른 방 5명", jobs))
# 3) 같은 선생님이 두 기기에서 서로 다른 학생을 다른 방 같은 시간에
jobs = [(2, "lesson_room_book", (f"A{r}", students(2)[r], "정규", D, "20:00", 50, None, None)) for r in range(1, 5)] * 2
jobs = [(t, f, (a[0], students(2)[i], *a[2:])) for i, (t, f, a) in enumerate(jobs)]
res.append(burst("같은 선생님 · 다른 방 · 다른 학생 8곳", jobs))
# 4) 같은 버튼 5번 연타 (같은 선생님 · 같은 학생 · 같은 칸)
jobs = [(3, "lesson_room_book", ("A3", students(3)[0], "정규", D, "11:00", 50, None, None))] * 5
res.append(burst("같은 예약 5번 연타", jobs))
# 5) 한 번 빼기 + 그 칸 예약이 동시에 (빼기 전이면 겹침으로 막혀야, 뒤면 들어가야 — 겹침은 0이어야)
with conn(tid=5) as c:
    rid = c.execute("select public.lesson_room_book('A4', %s, '정규', %s, '13:00', 50, null, null)", (students(5)[0], D)).fetchone()[0]["id"]
jobs = [(5, "lesson_room_cancel", (rid, "once", D))] + [(None, "lesson_room_book", ("A4", students(k)[3], "보강", D, "13:00", 50, None, None)) for k in range(1, 7)]
res.append(burst("한 번 빼기 + 같은 칸 보강 6명", jobs))
# 6) 정규 변경(옮기기)과 그 자리 예약이 동시에
with conn(tid=6) as c:
    mid = c.execute("select public.lesson_room_book('A2', %s, '정규', %s, '09:00', 50, null, null)", (students(6)[0], D)).fetchone()[0]["id"]
jobs = [(6, "lesson_room_move", (mid, "from", D, D, "A3", "09:00", 50))] + [(None, "lesson_room_book", ("A3", students(k)[5], "정규", D, "09:10", 50, None, None)) for k in range(1, 6)] \
     + [(None, "lesson_room_book", ("A2", students(k)[6], "정규", D, "09:00", 50, None, None)) for k in range(1, 4)]
res.append(burst("정규 변경 + 옮길 자리 · 빈 자리 예약 9명", jobs))

# 7) 섞어서: 24개 연결이 300번씩 아무거나 (예약 · 빼기 · 끝내기 · 옮기기), 앞으로 6주 · 오후 시간대에 몰리게
def mixed(seed, workers=24, per=300):
    random.seed(seed)
    stats = {"ok": 0, "fail": 0, "err": [], "max": 0.0}
    lock = threading.Lock()
    def worker(w):
        rnd = random.Random(seed * 100 + w)
        tid = None if w % 5 == 0 else (w % T) + 1
        c = conn(tid=tid, admin=tid is None)
        for _ in range(per):
            op = rnd.choice(["book"] * 4 + ["once", "from", "all", "mvonce", "mvfrom"])
            room = f"A{rnd.randint(1, 4)}"; d = day(rnd.randint(0, 42)); st = f"{rnd.randint(14, 21):02d}:{rnd.choice(['00', '10', '20', '30', '40', '50'])}"
            mins = rnd.choice([30, 50, 50, 60, 100, 120])
            if op == "book":
                who = rnd.choice(students(tid) if tid else [f"S{i:03d}" for i in range(1, 121)])
                r, t, e = call(c, "lesson_room_book", room, who, rnd.choice(["정규", "보강"]), d, st, mins, None, None)
            else:
                row = c.execute("select id, kind, first_day, weekday from public.lesson_bookings where status = '확정' order by random() limit 1").fetchone()
                if not row: continue
                bid, kind, first, wd = row
                base = max(first, dt.date.today()); on = base + dt.timedelta(days=(wd - (base.isoweekday() % 7)) % 7 + 7 * rnd.randint(0, 4))
                if kind == "보강": on = first
                if op in ("once", "from", "all"): r, t, e = call(c, "lesson_room_cancel", bid, op, on.isoformat())
                else: r, t, e = call(c, "lesson_room_move", bid, "once" if op == "mvonce" else "from", on.isoformat(), d, room, st, mins)
            with lock:
                stats["max"] = max(stats["max"], t)
                if e: stats["err"].append(e)
                elif r.get("ok"): stats["ok"] += 1
                else: stats["fail"] += 1
        c.close()
    ths = [threading.Thread(target=worker, args=(w,)) for w in range(workers)]
    t0 = time.time(); [t.start() for t in ths]; [t.join() for t in ths]
    return {"name": f"섞어서 {workers}명 × {per}번 (seed {seed})", "ok": stats["ok"], "fail": stats["fail"], "err_n": len(stats["err"]),
            "errors": sorted(set(stats["err"]))[:5], "max_s": round(stats["max"], 3), "secs": round(time.time() - t0, 1), "clash": clashes()}

for s in (1, 2, 3):
    reset(); res.append(mixed(s))
for r in res: print(json.dumps(r, ensure_ascii=False))
