# 연습실 예약 몰림 시험 (2026-11-05)

실제 서버가 아니라 **로컬 시험용 Postgres**에서, 실제와 같은 표 · 겹침 막기 규칙 · `booking_create` 함수로
가짜 학생(T001~)이 같은 순간 예약하게 해서 겹친 예약 · 오류 · 걸린 시간을 봅니다. 실제 예약은 건드리지 않습니다.

1. 로컬 Postgres 16을 127.0.0.1:55432에 띄우고 `create database sim`
2. `psql -d sim -f schema_copy.sql` (표 · 규칙 · 도우미, 로그인 확인은 간단히, 알림은 안 보냄)
3. 실제 서버의 `booking_create` 정의를 그대로 넣기 (`pg_get_functiondef('public.booking_create'::regproc)`)
4. `python rush.py` (psycopg 3 필요) → 시험 A(모두 같은 시간) · B(원하는 시간, 안 되면 3번까지) · C(버튼 5번 연타) 각 20판

2026-11-05 결과: 겹친 예약 0. 고치기 전엔 몰릴 때 2~3%가 deadlock("연결이 원활하지 않습니다"), 최대 8초 →
같은 방 · 같은 날을 한 줄로 세우는 잠금(마이그레이션 `leesh_booking_room_lock`) 뒤 오류 0, 최대 0.2초 (200명도 오류 0, 최대 1초).
