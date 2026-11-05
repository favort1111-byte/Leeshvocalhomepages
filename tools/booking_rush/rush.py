# 연습실 예약 동시 접속 시험: 실제와 같은 booking_create를 여러 사람이 "동시에" 부름
import json, random, threading, time, psycopg, statistics, sys
DSN = "host=127.0.0.1 port=55432 user=postgres dbname=sim"
ROOMS = ["B1", "B2", "B3", "B4", "B5", "C hall"]
def conn():
    c = psycopg.connect(DSN, autocommit=True)
    c.execute("set statement_timeout = '8s'")  # 실제 서버의 로그인 사용자 제한과 같게
    return c
def reset():
    with conn() as c:
        c.execute("truncate public.bookings restart identity")
        return c.execute("select to_char(private.now_kst()::date,'YYYY-MM-DD')").fetchone()[0]
def call(c, mid, room, day, start, hours):
    t = time.perf_counter()
    try:
        r = c.execute("select public.booking_create(%s,'',%s,%s,%s,%s)", (mid, room, day, start, hours)).fetchone()[0]
        kind = "ok" if r.get("ok") else "refused"
        msg = None if r.get("ok") else r.get("error")
    except Exception as e:
        kind, msg = "error", str(e).split("\n")[0][:120]
    return kind, msg, (time.perf_counter() - t) * 1000
def check(day):
    with conn() as c:
        room_dup = c.execute("""select count(*) from public.bookings a join public.bookings b on a.id < b.id and a.room_id = b.room_id and a.day = b.day
            and a.status = '확정' and b.status = '확정' and int4range(a.start_min, a.end_min) && int4range(b.start_min, b.end_min)""").fetchone()[0]
        mem_dup = c.execute("""select count(*) from public.bookings a join public.bookings b on a.id < b.id and a.member_id = b.member_id and a.day = b.day
            and a.status = '확정' and b.status = '확정' and int4range(a.start_min, a.end_min) && int4range(b.start_min, b.end_min)""").fetchone()[0]
        n = c.execute("select count(*) from public.bookings").fetchone()[0]
        rows = c.execute("select b.member_id, r.name, b.start_min/60, (b.end_min-b.start_min)/60 from public.bookings b join public.rooms r on r.id=b.room_id order by b.id").fetchall()
    return room_dup, mem_dup, n, rows
def run(plans, record=False):
    """plans: 사람마다 [(room, start, hours), …] 원하는 순서 (안 되면 다음 것으로, 진짜 사람처럼)"""
    day = reset()
    conns = [conn() for _ in plans]
    gate = threading.Barrier(len(plans))
    out, log, t0 = [], [], [None]
    lock = threading.Lock()
    def person(i, mid, wants):
        c = conns[i]
        gate.wait()
        if t0[0] is None: t0[0] = time.perf_counter()
        for k, (room, start, hours) in enumerate(wants):
            kind, msg, ms = call(c, mid, room, day, start, hours)
            with lock:
                out.append((kind, msg, ms))
                log.append({"t": round((time.perf_counter() - t0[0]) * 1000, 1), "who": mid, "room": room, "start": start, "h": hours, "try": k + 1, "res": kind, "msg": msg, "ms": round(ms, 1)})
            if kind == "ok": break
            time.sleep(random.uniform(0.05, 0.3))  # 다른 시간을 고르는 사이
    ths = [threading.Thread(target=person, args=(i, mid, w)) for i, (mid, w) in enumerate(plans)]
    for t in ths: t.start()
    for t in ths: t.join()
    for c in conns: c.close()
    rd, md, n, rows = check(day)
    return {"calls": len(out), "ok": sum(1 for o in out if o[0] == "ok"), "refused": sum(1 for o in out if o[0] == "refused"),
            "errors": [o[1] for o in out if o[0] == "error"], "room_dup": rd, "member_dup": md, "bookings": n,
            "msgs": sorted({o[1] for o in out if o[0] == "refused"}), "ms": [o[2] for o in out], "log": log if record else None, "rows": rows if record else None}

random.seed(7)
people = ["T%03d" % i for i in range(1, 81)]
hot = ["18:00", "19:00", "20:00", "21:00"]
results = {}
# A) 80명이 같은 순간 같은 시간대(20시, 2시간)로 — 방 6개 중 아무 데나
results["A"] = [run([(m, [(random.choice(ROOMS), "20:00", 2)]) for m in people]) for _ in range(20)]
# B) 80명이 동시에 원하는 방 · 인기 시간으로, 안 되면 다른 방 · 시간으로 3번까지 (실제 사람처럼)
def wants():
    return [(random.choice(ROOMS), random.choice(hot), random.choice([1, 2])) for _ in range(3)]
results["B"] = [run([(m, wants()) for m in people], record=(k == 0)) for k in range(20)]
# C) 한 사람이 같은 예약 버튼을 5번 연타 (5개가 동시에 들어감) + 다른 79명
results["C"] = [run([("T001", [("B2", "19:00", 2)])] * 5 + [(m, [(random.choice(ROOMS), random.choice(hot), 2)]) for m in people[1:]]) for _ in range(20)]
summ = {}
for k, rs in results.items():
    ms = [x for r in rs for x in r["ms"]]
    summ[k] = {"runs": len(rs), "calls": sum(r["calls"] for r in rs), "ok": sum(r["ok"] for r in rs), "refused": sum(r["refused"] for r in rs),
               "errors": sum(len(r["errors"]) for r in rs), "error_samples": [e for r in rs for e in r["errors"]][:5],
               "room_dup": sum(r["room_dup"] for r in rs), "member_dup": sum(r["member_dup"] for r in rs),
               "ok_per_run": [r["ok"] for r in rs], "msgs": sorted({m for r in rs for m in r["msgs"]}),
               "ms_median": round(statistics.median(ms), 1), "ms_p95": round(sorted(ms)[int(len(ms) * .95)], 1), "ms_max": round(max(ms), 1)}
if "C" in results:
    summ["C"]["T001_ok_per_run"] = None
print(json.dumps(summ, ensure_ascii=False, indent=1))
json.dump({"summary": summ, "replay": {"log": results["B"][0]["log"], "rows": results["B"][0]["rows"]}}, open("pgsim_result.json", "w"), ensure_ascii=False)
