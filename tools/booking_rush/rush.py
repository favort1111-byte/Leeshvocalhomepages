# 연습실 예약 오픈 시뮬레이션 (로컬 시험용 DB, 실제 서버 함수 그대로)
import json, random, threading, time, statistics, sys
import psycopg
DSN = "host=127.0.0.1 port=55432 user=postgres dbname=sim"
ROOMS = ["B1", "B2", "B3", "B4", "B5", "C hall"]
MON, TUE, WED = "2026-11-16", "2026-11-17", "2026-11-18"
R = {}

def conn(timeout="8s"):
    c = psycopg.connect(DSN, autocommit=True)
    c.execute("set statement_timeout = '%s'" % timeout)
    return c
def q(sql, args=None, c=None):
    own = c is None
    c = c or conn()
    try:
        cur = c.execute(sql, args)
        return cur.fetchall() if cur.description else None
    finally:
        if own: c.close()
def clock(ts): q("update private.clock set fixed_kst = %s", (ts,))
def reset(ts, open_=True):
    q("truncate public.bookings restart identity")
    q("truncate private.notify_queue, private.sent")
    q("update public.members set status = '재원' where id like 'T%'")
    q("update private.fixed_blocks_state set filled_until = date '2026-11-12'")
    q("update public.settings set booking_open = %s", (open_,))
    clock(ts)
    q("select private.fixed_blocks_fill()")
    # 실제로 잡혀 있는 선생님 예약 (C hall 화 19~21, 수 15~16)
    q("insert into public.bookings (room_id, teacher_id, day, start_min, end_min, memo) values (6, 8, %s, 1140, 1260, '시험선생8 선생님'), (6, 8, %s, 900, 960, '시험선생8 선생님')", (TUE, WED))
def book(c, mid, room, day, start, hours):
    t = time.perf_counter()
    try:
        r = c.execute("select public.booking_create(%s,'',%s,%s,%s,%s)", (mid, room, day, start, hours)).fetchone()[0]
        return ("ok" if r.get("ok") else "refused"), (r.get("booking", {}).get("id") if r.get("ok") else r.get("error")), (time.perf_counter() - t) * 1000
    except Exception as e:
        return "error", str(e).split("\n")[0][:140], (time.perf_counter() - t) * 1000
def invariants():
    c = conn("60s")
    room_dup = c.execute("""select count(*) from public.bookings a join public.bookings b on a.id < b.id and a.room_id = b.room_id and a.day = b.day
        and a.status = '확정' and b.status = '확정' and a.start_min < b.end_min and b.start_min < a.end_min""").fetchone()[0]
    mem_dup = c.execute("""select count(*) from public.bookings a join public.bookings b on a.id < b.id and a.member_id = b.member_id and a.day = b.day
        and a.status = '확정' and b.status = '확정' and a.start_min < b.end_min and b.start_min < a.end_min""").fetchone()[0]
    t_dup = c.execute("""select count(*) from public.bookings a join public.bookings b on a.id < b.id and a.teacher_id = b.teacher_id and a.day = b.day
        and a.status = '확정' and b.status = '확정' and a.start_min < b.end_min and b.start_min < a.end_min""").fetchone()[0]
    # 학생 예약이 규칙 밖에 있는지: 2시간 넘음 · 자정 넘김 · 30분 단위 · 예약 가능 날 밖
    bad = c.execute("""select count(*) from public.bookings where member_id is not null and status = '확정'
        and (end_min - start_min > 120 or end_min > 1440 or start_min % 60 <> 0 or (end_min - start_min) % 60 <> 0)""").fetchone()[0]
    gone = c.execute("""select count(*) from public.bookings b join public.members m on m.id = b.member_id
        where b.status = '확정' and m.status not in ('재원','외부') and (b.day > private.now_kst()::date or (b.day = private.now_kst()::date and b.start_min > extract(hour from private.now_kst())*60 + extract(minute from private.now_kst())))""").fetchone()[0]
    c.close()
    return {"방 겹침": room_dup, "학생 겹침": mem_dup, "선생님 겹침": t_dup, "규칙 밖 예약": bad, "그만둔 학생의 남은 예약": gone}

def rush(plans, extra=None):
    """plans: [(학생, [(방, 날, 시작, 시간), …])] 안 되면 다음 것으로. extra: 같이 돌릴 함수들"""
    conns = [conn() for _ in plans]
    n = len(plans) + (len(extra) if extra else 0)
    gate = threading.Barrier(n)
    out = []; lock = threading.Lock()
    def person(i, mid, wants):
        c = conns[i]; gate.wait()
        for (room, day, start, hours) in wants:
            kind, msg, ms = book(c, mid, room, day, start, hours)
            with lock: out.append((kind, msg, ms, mid))
            if kind == "ok": break
            time.sleep(random.uniform(0.05, 0.3))
    ths = [threading.Thread(target=person, args=(i, m, w)) for i, (m, w) in enumerate(plans)]
    def wrap(f):
        def g():
            gate.wait(); f(out, lock)
        return g
    ths += [threading.Thread(target=wrap(f)) for f in (extra or [])]
    for t in ths: t.start()
    for t in ths: t.join()
    for c in conns: c.close()
    return out
def summ(outs):
    ms = [o[2] for o in outs]
    return {"요청": len(outs), "성공": sum(o[0] == "ok" for o in outs), "거절": sum(o[0] == "refused" for o in outs),
            "오류": sum(o[0] == "error" for o in outs), "오류 예": sorted({o[1] for o in outs if o[0] == "error"})[:4],
            "거절 문구": sorted({o[1] for o in outs if o[0] == "refused"}),
            "중간(ms)": round(statistics.median(ms), 1), "95%(ms)": round(sorted(ms)[int(len(ms) * .95)], 1), "최대(ms)": round(max(ms), 1)}
def add(inv, x):
    for k, v in x.items(): inv[k] = inv.get(k, 0) + v

random.seed(11)
P100 = ["T%03d" % i for i in range(1, 101)]
P200 = ["T%03d" % i for i in range(1, 201)]
HOT = ["16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00"]
def want(k=4):
    return [(random.choice(ROOMS), random.choice([MON, MON, TUE]), random.choice(HOT), random.choice([1, 2, 2])) for _ in range(k)]

# ---------- 0. 여는 순간 ----------
reset("2026-11-15 23:59:30", open_=False)
o = rush([(m, [("B1", MON, "20:00", 2)]) for m in P100])
r0 = {"열기 전 (23:59:30) 100명": summ(o)}
q("select private.booking_open_now()")
r0["일찍 돈 열기 작업 뒤 예약 열림"] = q("select booking_open from public.settings")[0][0]
clock("2026-11-16 00:00:00"); q("select private.booking_open_now()")
r0["0시 열기 작업 뒤 예약 열림"] = q("select booking_open from public.settings")[0][0]
r0["열렸다는 알림"] = [x[0][:30] for x in q("select msg from private.sent")]
# 알림 · 작업 지우기가 실패해도 열리는지
q("update public.settings set booking_open = false")
q("create or replace function cron.unschedule(j text) returns boolean language plpgsql as $$ begin raise exception 'boom'; end $$")
q("select private.booking_open_now()")
r0["작업 지우기가 실패해도 열림"] = q("select booking_open from public.settings")[0][0]
q("create or replace function cron.unschedule(j text) returns boolean language sql as $$ select true $$")
R["0. 여는 순간"] = r0

# ---------- 1. 0시 몰림: 100명이 원하는 방 · 시간, 안 되면 4번까지 ----------
tot = []; inv = {}; okrun = []
for k in range(20):
    reset("2026-11-16 00:00:05")
    o = rush([(m, want()) for m in P100]); tot += o; add(inv, invariants()); okrun.append(len({x[3] for x in o if x[0] == "ok"}))
R["1. 0시 몰림 (100명 × 20판)"] = dict(summ(tot), **inv, **{"판마다 예약에 성공한 학생 수": okrun})

# ---------- 2. 100명이 똑같은 칸 ----------
tot = []; inv = {}; oks = []
for k in range(20):
    reset("2026-11-16 00:00:05")
    o = rush([(m, [("B1", MON, "20:00", 2)]) for m in P100]); tot += o; add(inv, invariants()); oks.append(sum(x[0] == "ok" for x in o))
R["2. 100명이 같은 방 같은 시간 (20판)"] = dict(summ(tot), **inv, **{"판마다 성공 수 (1이어야)": sorted(set(oks))})

# ---------- 3. 버튼 5번 연타 + 나머지 99명 ----------
tot = []; inv = {}; one = []
for k in range(20):
    reset("2026-11-16 00:00:05")
    o = rush([("T001", [("B2", MON, "19:00", 2)])] * 5 + [(m, want(1)) for m in P100[1:]]); tot += o; add(inv, invariants())
    one.append(q("select count(*) from public.bookings where member_id = 'T001' and status = '확정'")[0][0])
R["3. 한 학생이 5번 연타 (20판)"] = dict(summ(tot), **inv, **{"그 학생 예약 수 (1이어야)": sorted(set(one))})

# ---------- 4. 섞인 상황: 학생 예약 + 취소 + 선생님 8명 + 관리자 막음 + 종료 처리 ----------
tot = []; inv = {}; terr = []; cerr = []
for k in range(15):
    reset("2026-11-16 00:00:05")
    # 먼저 30명이 예약해 둠
    pre = rush([(m, want()) for m in P100[:30]])
    mine = {x[3]: x[1] for x in pre if x[0] == "ok"}
    def teacher(i):
        def f(out, lock):
            c = conn(); c.execute("select set_config('sim.teacher', %s, false)", (str(i),))
            for _ in range(3):
                try:
                    r = c.execute("select public.teacher_booking_create(%s,%s,%s,%s)", (random.choice(ROOMS), random.choice([MON, TUE, "2026-11-25"]), random.choice(HOT), 2)).fetchone()[0]
                    if not r.get("ok") and "이미" not in r.get("error", "") and "같은 시간" not in r.get("error", ""): terr.append(r.get("error"))
                except Exception as e: terr.append("ERR " + str(e)[:100])
            c.close()
        return f
    def canceller(mid, bid):
        def f(out, lock):
            c = conn()
            try:
                r = c.execute("select public.booking_cancel(%s,'',%s)", (mid, bid)).fetchone()[0]
                if not r.get("ok"): cerr.append(r.get("error"))
            except Exception as e: cerr.append("ERR " + str(e)[:100])
            c.close()
        return f
    def admin(out, lock):
        c = conn()
        for rm in (1, 2, 3):
            try: c.execute("insert into public.bookings (room_id, day, start_min, end_min, memo) values (%s, %s, 840, 960, '학원 사용')", (rm, TUE))
            except psycopg.errors.ExclusionViolation: pass
            except Exception as e: cerr.append("ADMIN " + str(e)[:100])
        c.close()
    def leaver(mid):
        def f(out, lock):
            c = conn()
            try: c.execute("update public.members set status = '종료' where id = %s", (mid,))
            except Exception as e: cerr.append("LEAVE " + str(e)[:100])
            c.close()
        return f
    cancels = list(mine.items())[:10]
    leavers = [m for m in P100[10:30]][:5] + P100[30:33]
    extra = [teacher(i) for i in range(1, 9)] + [canceller(m, b) for m, b in cancels] + [admin] + [leaver(m) for m in leavers]
    o = rush([(m, want()) for m in P100[30:]], extra); tot += o; add(inv, invariants())
R["4. 섞인 상황 (예약 70명 + 취소 10 + 선생님 8 + 관리자 막음 + 종료 처리 8, 15판)"] = dict(summ(tot), **inv,
    **{"선생님 쪽 이상": sorted(set(terr))[:5], "취소 · 관리자 · 종료 쪽 이상": sorted(set(cerr))[:5]})

# ---------- 5. 200명 (혹시 더 몰려도) ----------
tot = []; inv = {}
for k in range(10):
    reset("2026-11-16 00:00:05")
    o = rush([(m, want()) for m in P200]); tot += o; add(inv, invariants())
R["5. 200명이 한꺼번에 (10판)"] = dict(summ(tot), **inv)

print(json.dumps(R, ensure_ascii=False, indent=1))
json.dump(R, open(sys.argv[1], "w"), ensure_ascii=False, indent=1)
