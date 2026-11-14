# 연습실 예약 시뮬레이션 (2026-11-05 처음, 2026-11-14 오픈 전 다시)

실제 서버가 아니라 **로컬 시험용 Postgres**에서, 실제와 같은 표 · 겹침 막기 규칙 · 실제 서버 함수 그대로
가짜 학생(T001~)이 같은 순간 예약하게 해서 겹친 예약 · 오류 · 걸린 시간을 봅니다. 실제 예약은 건드리지 않습니다.

1. 로컬 Postgres 16을 127.0.0.1:55432에 띄우고 `create database sim`
2. `psql -d sim -f schema_copy.sql` (표 · 겹침 막기 · 매주 고정 막음 규칙 · 시계 `private.clock` · 로그인 확인과 알림은 간단히)
3. 실제 서버의 함수 정의를 그대로 넣기 (`pg_get_functiondef`):
   public `booking_create` · `booking_cancel` · `rooms_day` · `teacher_booking_create` · `teacher_booking_cancel` · `teacher_rooms`,
   private `fail` · `hhmm` · `day_label` · `to_min` · `member_status_cancel`(+ members 트리거) · `fixed_blocks_fill` · `booking_open_now`
4. `python rush.py 결과.json` (psycopg 3) → 여는 순간 · 0시 몰림 100명 · 같은 칸 100명 · 5번 연타 · 섞인 상황(취소 · 선생님 · 관리자 막음 · 종료 처리) · 200명
5. `python rules.py` → 예약 규칙 57가지를 시간대별로 (청소 · 댄스특강 칸, 오늘 · 내일, 1시간 전 취소, 자정 넘김, 빈 시간표 = 실제 예약되는 칸, 종료 자동 취소, 선생님)

예약 함수를 고치면 이 시험을 다시 돌립니다.

- 2026-11-05: 겹친 예약 0. 몰릴 때 2~3% deadlock → 같은 방 · 같은 날 잠금(`leesh_booking_room_lock`) 뒤 오류 0.
- 2026-11-14 (11/16 0시 오픈 전): 겹친 예약 0 · 오류 0 · 최대 0.33초(200명), 규칙 57가지 모두 맞음.
  찾은 것 하나: 학생이 예약하는 바로 그 순간(수 ms) 종료 · 휴원으로 바뀌면 그 예약 한 건이 자동 취소를 피해 남을 수 있음
  → `booking_create`가 학생 줄을 `for share`로 잡고 상태를 다시 확인하면 0건 (로컬에서 확인, 실제 서버 반영은 원장님 결정 뒤).
