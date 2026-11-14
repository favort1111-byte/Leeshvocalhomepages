# 예약 규칙을 시간대별로 (로컬 시험용 DB, 실제 서버 함수 그대로)
import json, sys
import psycopg
DSN = "host=127.0.0.1 port=55432 user=postgres dbname=sim"
c = psycopg.connect(DSN, autocommit=True)
MON, TUE, WED = "2026-11-16", "2026-11-17", "2026-11-18"
def q(sql, a=None):
    cur = c.execute(sql, a); return cur.fetchall() if cur.description else None
def clock(ts): q("update private.clock set fixed_kst = %s", (ts,))
def book(mid, room, day, start, h): return q("select public.booking_create(%s,'',%s,%s,%s,%s)", (mid, room, day, start, h))[0][0]
def cancel(mid, bid): return q("select public.booking_cancel(%s,'',%s)", (mid, bid))[0][0]
rows = []
def expect(name, r, ok, has=None):
    good = (bool(r.get("ok")) == ok) and (has is None or has in (r.get("error") or ""))
    rows.append((("✅" if good else "❌"), name, "됨" if r.get("ok") else "막힘: " + (r.get("error") or "")))

q("truncate public.bookings restart identity"); q("truncate private.notify_queue, private.sent")
q("update public.members set status = '재원' where id like 'T%'")
q("update private.fixed_blocks_state set filled_until = date '2026-11-12'"); q("update public.settings set booking_open = true")
clock("2026-11-16 00:00:05"); q("select private.fixed_blocks_fill()")
q("insert into public.bookings (room_id, teacher_id, day, start_min, end_min, memo) values (6, 8, %s, 1140, 1260, '선생님')", (TUE,))

# --- 월요일 0시 5초 (막 열림)
expect("월 0시: 청소 시간(0~2시) B1 01:00", book("T001", "B1", MON, "01:00", 1), False, "다른 예약")
expect("월 0시: 청소 끝난 02:00 B1 2시간", book("T001", "B1", MON, "02:00", 2), True)
expect("월 0시: 01:00부터 2시간 (청소와 걸침)", book("T002", "B2", MON, "01:00", 2), False)
expect("월 0시: C hall 댄스특강(18~23시) 20:00", book("T002", "C hall", MON, "20:00", 1), False, "다른 예약")
expect("월 0시: C hall 17:00부터 2시간 (특강과 걸침)", book("T002", "C hall", MON, "17:00", 2), False)
expect("월 0시: C hall 16:00부터 2시간 (특강 직전까지)", book("T002", "C hall", MON, "16:00", 2), True)
expect("월 0시: C hall 23:00 1시간 (특강 끝난 뒤)", book("T003", "C hall", MON, "23:00", 1), True)
expect("월 0시: 내일(화) 예약", book("T003", "B3", TUE, "18:00", 2), True)
expect("월 0시: 모레(수) 예약", book("T003", "B3", WED, "18:00", 2), False, "오늘과 내일만")
expect("월 0시: 어제(일) 예약", book("T003", "B3", "2026-11-15", "18:00", 2), False, "지난 날짜")
expect("월 0시: 화 C hall 선생님 예약 시간(19~21시)", book("T004", "C hall", TUE, "20:00", 1), False, "다른 예약")
expect("3시간 예약", book("T004", "B4", MON, "10:00", 3), False, "최대 2시간")
expect("0시간 예약", book("T004", "B4", MON, "10:00", 0), False)
expect("30분 시작(10:30)", book("T004", "B4", MON, "10:30", 1), False, "60분 단위")
expect("23:00부터 2시간 (자정 넘김)", book("T004", "B4", MON, "23:00", 2), False, "운영 시간")
expect("23:00부터 1시간", book("T004", "B4", MON, "23:00", 1), True)
expect("없는 방", book("T004", "B9", MON, "10:00", 1), False, "찾을 수 없")
expect("이상한 날짜", book("T004", "B4", "내일", "10:00", 1), False, "날짜 형식")
expect("이상한 시간", book("T004", "B4", MON, "25:00", 1), False)
r1 = book("T005", "B5", MON, "18:00", 2); expect("같은 학생 18~20시 B5", r1, True)
expect("같은 학생 같은 시간 다른 방 (B4 19:00)", book("T005", "B4", MON, "19:00", 1), False, "이미 다른 연습실")
expect("같은 학생 이어서 20~22시 (횟수 제한 없음)", book("T005", "B5", MON, "20:00", 2), True)
expect("같은 학생 또 22~23시 + 낮 10~12시", book("T005", "B5", MON, "22:00", 1), True)
expect("다른 학생이 이미 찬 칸 (B5 19:00)", book("T006", "B5", MON, "19:00", 1), False, "다른 예약")
expect("휴원 학생", book("H001", "B1", MON, "10:00", 1), False, "이용 중인 수강 ID가 아닙니다")
expect("종료 학생", book("X001", "B1", MON, "10:00", 1), False, "이용 중인 수강 ID가 아닙니다")
expect("외부 손님(G)", book("G001", "B1", MON, "10:00", 1), True)
expect("연결 안 된 카카오 계정", book("ZZZ", "B1", MON, "10:00", 1), False, "승인 전")

# --- 월요일 17:05 (운영 중)
clock("2026-11-16 17:05:00")
expect("월 17:05: 이미 시작한 17:00", book("T010", "B1", MON, "17:00", 1), False, "이미 시작한")
expect("월 17:05: 지난 09:00", book("T010", "B1", MON, "09:00", 1), False, "이미 시작한")
b18 = book("T010", "B1", MON, "18:00", 1); expect("월 17:05: 다음 시간 18:00", b18, True)
b19 = book("T011", "B2", MON, "19:00", 2); expect("월 17:05: 19:00 2시간", b19, True)
expect("월 17:05: 18:00 예약 취소 (55분 전)", cancel("T010", b18["booking"]["id"]), False, "1시간 전이 지나")
expect("월 17:05: 19:00 예약 취소 (1시간 55분 전)", cancel("T011", b19["booking"]["id"]), True)
expect("월 17:05: 취소한 칸을 다른 학생이 다시 예약", book("T012", "B2", MON, "19:00", 2), True)
expect("월 17:05: 이미 취소한 예약 또 취소", cancel("T011", b19["booking"]["id"]), False, "찾을 수 없")
expect("월 17:05: 남의 예약 취소", cancel("T013", b18["booking"]["id"]), False, "찾을 수 없")
clock("2026-11-16 18:00:00")
b19b = book("T014", "B3", MON, "19:00", 1)
expect("월 18:00 정각: 19:00 예약 취소 (정확히 1시간 전)", cancel("T014", b19b["booking"]["id"]), True)
clock("2026-11-16 18:01:00")
b19c = book("T014", "B3", MON, "19:00", 1)
expect("월 18:01: 19:00 예약 취소 (59분 전)", cancel("T014", b19c["booking"]["id"]), False, "1시간 전이 지나")

# --- 월요일 23:59 → 화요일 0시 (다음 날 열림)
clock("2026-11-16 23:59:30")
expect("월 23:59: 수요일 예약 (아직)", book("T020", "B1", WED, "18:00", 2), False, "오늘과 내일만")
expect("월 23:59: 오늘 남은 시간 없음 (23:00)", book("T020", "B1", MON, "23:00", 1), False, "이미 시작한")
clock("2026-11-17 00:00:01")
expect("화 0시 1초: 수요일 예약 (열림)", book("T020", "B1", WED, "18:00", 2), True)
expect("화 0시 1초: 수 C hall 댄스특강(18~23시)", book("T021", "C hall", WED, "19:00", 1), False, "다른 예약")
expect("화 0시 1초: 화 00:00 (이미 시작)", book("T021", "B1", TUE, "00:00", 1), False, "이미 시작한")
expect("화 0시 1초: 화 01:00 (청소는 월요일만)", book("T021", "B1", TUE, "01:00", 1), True)

# --- 빈 시간표가 예약과 맞는지 (모든 방 · 오늘 · 내일: free로 나온 칸은 예약되고, 안 나온 칸은 막히는지)
q("select set_config('sim.admin','1',false)")
bad = 0; checked = 0
for day in (TUE, WED):
    rd = q("select public.rooms_day(%s)", (day,))[0][0]
    for room in rd["rooms"]:
        free = set(room["free"])
        for h in range(24):
            hh = "%02d:00" % h
            c.execute("begin")
            r = q("select public.booking_create('T099','',%s,%s,%s,1)", (room["name"], day, hh))[0][0]
            c.execute("rollback")
            checked += 1
            if bool(r.get("ok")) != (hh in free): bad += 1; rows.append(("❌", "빈 시간표와 다름 %s %s %s" % (day, room["name"], hh), str(r)))
rows.append(("✅" if bad == 0 else "❌", "빈 시간표에 보이는 칸 = 실제로 예약되는 칸 (%d칸 확인)" % checked, "다른 칸 %d" % bad))

# --- 학생이 종료 · 휴원으로 바뀌면 남은 예약 자동 취소, 지난 예약은 그대로
clock("2026-11-17 12:00:00")
b = book("T030", "B4", TUE, "15:00", 2); b2 = book("T030", "B4", WED, "10:00", 1)
q("insert into public.bookings (room_id, member_id, day, start_min, end_min) values (4, 'T030', %s, 600, 660)", (MON,))  # 어제 쓴 것
q("update public.members set status = '종료' where id = 'T030'")
st = q("select day::text, status, memo from public.bookings where member_id = 'T030' order by day, start_min")
good = [s[1] for s in st] == ["확정", "취소", "취소"]
rows.append(("✅" if good else "❌", "종료로 바뀜 → 남은 예약 2건 자동 취소 · 지난 예약은 그대로", str([s[1] for s in st])))
expect("자동 취소된 칸을 다른 학생이 예약", book("T031", "B4", TUE, "15:00", 2), True)
q("update public.members set status = '재원' where id = 'T030'")
rows.append(("✅" if q("select count(*) from public.bookings where member_id='T030' and status='확정' and day >= %s", (TUE,))[0][0] == 0 else "❌", "다시 재원이 돼도 취소된 예약은 안 살아남", ""))

# --- 선생님
q("select set_config('sim.admin','',false)"); q("select set_config('sim.teacher','1',false)")
def tbook(room, day, start, h): return q("select public.teacher_booking_create(%s,%s,%s,%s)", (room, day, start, h))[0][0]
expect("선생님: 한 달 뒤 C hall", tbook("C hall", "2026-12-15", "14:00", 2), True)
expect("선생님: 학생이 잡은 칸 (B4 화 15:00)", tbook("B4", TUE, "15:00", 1), False, "이미 예약")
expect("선생님: 고정 막음 칸 (수 C hall 19:00)", tbook("C hall", WED, "19:00", 1), False, "이미 예약")
expect("선생님: 같은 시간 다른 방", tbook("B1", "2026-12-15", "15:00", 1), False, "이미 다른 방")
tb = tbook("B2", TUE, "20:00", 2); expect("선생님: 화 B2 20~22시", tb, True)
q("select set_config('sim.teacher','',false)")
expect("학생: 선생님이 잡은 칸 (B2 화 21:00)", book("T040", "B2", TUE, "21:00", 1), False, "다른 예약")
expect("승인 안 된 사람이 선생님 예약", tbook("B1", TUE, "22:00", 1), False, "승인된 선생님만")

# --- 매일 0시 1분 고정 막음 채우기: 하루 지나면 365일 뒤 하루가 더 채워지고, 이미 있는 것은 다시 안 넣음
n0 = q("select count(*) from public.bookings where memo like '%%(매주 고정)'")[0][0]
clock("2026-11-18 00:01:00"); a1 = q("select private.fixed_blocks_fill()")[0][0]; a2 = q("select private.fixed_blocks_fill()")[0][0]
n1 = q("select count(*) from public.bookings where memo like '%%(매주 고정)'")[0][0]
dup = q("select count(*) from (select room_id, day, start_min from public.bookings where memo like '%%(매주 고정)' and status='확정' group by 1,2,3 having count(*) > 1) x")[0][0]
rows.append(("✅" if (n1 - n0 == a1 and a2 == 0 and dup == 0) else "❌", "고정 막음 매일 채우기 (하루 뒤 +%d건, 두 번 돌려도 +%d, 겹친 것 %d)" % (a1, a2, dup), ""))
for r in rows: print(r[0], r[1], "→", r[2])
print("합계", len(rows), "· 다름", sum(r[0] == "❌" for r in rows))
print("알림 줄에 쌓인 것", q("select count(*) from private.notify_queue")[0][0])
