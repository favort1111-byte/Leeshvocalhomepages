"""홈페이지 매일 점검 (원장님 2026-11-05 "매일매일 시스템에 이슈 있는지").

    python3 tools/daily_check.py          → 사람이 읽는 요약 (한국어) + 맨 끝 JSON 한 줄
    종료 코드 0 = 이상 없음, 1 = 확인할 것 있음, 2 = 점검 자체를 못 함

읽기만 합니다 (데이터를 바꾸지 않음). Supabase Management API를 curl로 부르고, 토큰은 이 환경의
Network secrets가 붙여 줍니다 (스크립트는 토큰을 보지도 출력하지도 않음).
학생 이름 · 이메일 · 연락처는 출력하지 않고 개수와 시각만 보여줍니다.
"""
import json, subprocess, sys
from datetime import datetime, timezone, timedelta

REF = "lsdmokkecmymtxpmiwbm"
API = "https://api.supabase.com/v1/projects/" + REF
KST = timezone(timedelta(hours=9))


def curl(url, body=None):
    cmd = ["curl", "-s", "--max-time", "60", url, "-H", "Content-Type: application/json"]
    if body is not None:
        cmd += ["--data-binary", "@-"]
    for _ in range(4):
        out = subprocess.run(cmd, input=json.dumps(body) if body is not None else None, capture_output=True, text=True).stdout
        if out and not out.lstrip().startswith("<"):
            return json.loads(out)
    raise RuntimeError("Supabase에 연결하지 못했어요: " + url)


def sql(q):
    r = curl(API + "/database/query", {"query": q})
    if isinstance(r, dict) and r.get("message"):
        raise RuntimeError(r["message"][:300])
    return r


CHECK = r"""
select jsonb_build_object(
  'now_kst', to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'),
  'cron', (select jsonb_build_object('runs', count(*), 'failed', count(*) filter (where status <> 'succeeded'),
            'last', max(start_time)) from cron.job_run_details where start_time > now() - interval '24 hours'),
  'cron_jobs', (select jsonb_agg(jsonb_build_object('name', jobname, 'active', active)) from cron.job),
  'lesson_sync', (select jsonb_build_object('connected', key_hash is not null, 'last_at', last_at,
            'ok', coalesce((last_result ->> 'ok')::boolean, false),
            'errors', coalesce(jsonb_array_length(case when jsonb_typeof(last_result -> 'errors') = 'array' then last_result -> 'errors' end), 0),
            'error_sample', left(coalesce(last_result -> 'errors' ->> 0, last_result ->> 'error', ''), 200)) from private.lesson_sync where id = 1),
  'consult_sync', (select jsonb_build_object('last_at', last_at, 'ok', coalesce(last_ok, false), 'note', last_note) from private.consult_sheet where id = 1),
  'sheet_sync', (select jsonb_build_object('connected', key_hash is not null, 'last_at', last_at,
            'ok', coalesce((last_result ->> 'ok')::boolean, false), 'error', left(coalesce(last_result ->> 'error', ''), 200)) from private.sheet_sync where id = 1),
  'backup', (select jsonb_build_object('connected', key_hash is not null, 'last_at', last_at,
            'ok', coalesce((last_result ->> 'ok')::boolean, false), 'error', left(coalesce(last_result ->> 'error', ''), 200),
            'tables', last_result -> 'tables', 'bytes', last_result -> 'bytes',
            'files_ok', last_result -> 'files' -> 'ok', 'files_failed', last_result -> 'files' -> 'failed',
            'files_left', last_result -> 'files' -> 'left', 'files_note', left(coalesce(last_result -> 'files' ->> 'note', ''), 200),
            'warnings', coalesce(jsonb_array_length(case when jsonb_typeof(last_result -> 'warnings') = 'array' then last_result -> 'warnings' end), 0))
            from private.backup_sync where id = 1),
  'instagram', (select jsonb_build_object('connected', token is not null, 'last_sync', last_sync, 'refreshed_at', coalesce(refreshed_at, token_set_at),
            'last_error', left(coalesce(last_error, ''), 200)) from private.instagram where id = 1),
  'telegram', (select jsonb_build_object('on', bot_token is not null, 'chats', coalesce(cardinality(chat_ids), 0) + (case when chat_id is not null then 1 else 0 end))
            from private.telegram where id = 1),
  'outbound', (select jsonb_build_object('total', count(*), 'bad', count(*) filter (where status_code >= 400 or error_msg is not null or timed_out))
            from net._http_response where created > now() - interval '24 hours'),
  'waiting', jsonb_build_object(
     'kakao_link', (select jsonb_build_object('n', count(*), 'oldest', min(created_at)) from public.link_requests where status = '대기'),
     'teacher_link', (select jsonb_build_object('n', count(*), 'oldest', min(created_at)) from public.teacher_requests where status = '대기'),
     'parent_link', (select jsonb_build_object('n', count(*), 'oldest', min(created_at)) from public.parent_requests where status = '대기'),
     'consult', (select jsonb_build_object('n', count(*), 'oldest', min(created_at)) from public.consults where status = '접수'),
     'partner', (select jsonb_build_object('n', count(*), 'oldest', min(created_at)) from public.partner_requests where status = '접수'),
     'song', (select jsonb_build_object('n', count(*), 'oldest', min(created_at)) from public.song_requests where status = '접수')),
  'new24', jsonb_build_object(
     'bookings', (select count(*) from public.bookings where created_at > now() - interval '24 hours'),
     'cancels', (select count(*) from public.bookings where cancelled_at > now() - interval '24 hours'),
     'visit_apps', (select count(*) from public.visit_applications where created_at > now() - interval '24 hours'),
     'practice_logs', (select count(*) from public.practice_logs where created_at > now() - interval '24 hours'),
     'lesson_notes_site', (select count(*) from public.lesson_notes where src_file is null and updated_at > now() - interval '24 hours'),
     'auth_users', (select count(*) from auth.users where created_at > now() - interval '24 hours'),
     'login_fails', (select count(*) from private.login_fails where at > now() - interval '24 hours')),
  'bookings', jsonb_build_object(
     'room_overlap', (select count(*) from public.bookings a join public.bookings b on a.id < b.id and a.room_id = b.room_id and a.day = b.day
            and a.status = '확정' and b.status = '확정' and int4range(a.start_min, a.end_min) && int4range(b.start_min, b.end_min)),
     'member_overlap', (select count(*) from public.bookings a join public.bookings b on a.id < b.id and a.member_id = b.member_id and a.day = b.day
            and a.status = '확정' and b.status = '확정' and int4range(a.start_min, a.end_min) && int4range(b.start_min, b.end_min)),
     'today', (select count(*) from public.bookings where status = '확정' and day = (now() at time zone 'Asia/Seoul')::date),
     'tomorrow', (select count(*) from public.bookings where status = '확정' and day = (now() at time zone 'Asia/Seoul')::date + 1),
     'has_room_lock', (select pg_get_functiondef('public.booking_create'::regproc) ~ 'room:')),
  'settings', (select jsonb_build_object('max_minutes', max_minutes, 'max_days', max_days, 'cancel_minutes', cancel_minutes,
            'daily_max_minutes', daily_max_minutes, 'pin_login', pin_login, 'student_notes', student_notes, 'song_recs', song_recs,
            'booking_open', booking_open)
            from public.settings where id = 1),
  'people', jsonb_build_object(
     'members_active', (select count(*) from public.members where status = '재원' and id <> 'DEMO'),
     'kakao_linked', (select count(*) from public.members where kakao_user is not null and id <> 'DEMO'),
     'teachers_linked', (select count(*) from public.teachers where kakao_user is not null and active),
     'admins', (select count(*) from public.admins),
     -- 카카오로 로그인만 하고 연결 요청을 안 보낸 계정 (첫 단계에서 막힌 학생 · 만 14세 미만 등)
     'stuck', (select count(*) from auth.users u where u.raw_app_meta_data ->> 'provider' = 'kakao'
            and not exists (select 1 from public.members m where m.kakao_user = u.id)
            and not exists (select 1 from public.teachers t where t.kakao_user = u.id)
            and not exists (select 1 from public.link_requests r where r.user_id = u.id)
            and not exists (select 1 from public.teacher_requests r where r.user_id = u.id)
            and not exists (select 1 from public.parents p where p.kakao_user = u.id)
            and not exists (select 1 from public.parent_requests r where r.user_id = u.id)
            and u.created_at > now() - interval '14 days')),
  'data', jsonb_build_object(
     'bad_note_sheets', (select count(*) from public.lesson_notes where sheet is not null and not private.sheet_ok(sheet)),
     'bad_lesson_sheets', (select count(*) from public.lesson_sheets where not private.sheet_ok(sheet)),
     'private_sheets', (select count(*) from public.lesson_notes where sheet is not null and private.lesson_private(sheet)),
     'no_log_tables', (select coalesce(string_agg(c.relname, ', '), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
                        where n.nspname = 'public' and c.relkind = 'r'
                          and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'zz_admin_log'))),
  'size', jsonb_build_object(
     'db_mb', round(pg_database_size(current_database()) / 1048576.0, 1),
     'storage_mb', (select round(coalesce(sum((metadata ->> 'size')::bigint), 0) / 1048576.0, 1) from storage.objects))
) as r
"""


def age_h(ts):
    if not ts:
        return None
    t = datetime.fromisoformat(str(ts).replace("Z", "+00:00").replace(" ", "T"))
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - t).total_seconds() / 3600


def kst(ts):
    if not ts:
        return "기록 없음"
    t = datetime.fromisoformat(str(ts).replace("Z", "+00:00").replace(" ", "T"))
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return t.astimezone(KST).strftime("%m/%d %H:%M")


def main():
    try:
        d = sql(CHECK)[0]["r"]
        adv = curl(API + "/advisors/security")
    except Exception as e:  # 점검 자체를 못 함
        print("점검을 못 했어요:", e)
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        return 2
    # GitHub Actions (저장소가 공개라 로그인 없이 읽힘): 지난 24시간 실패
    try:
        runs = curl("https://api.github.com/repos/favort1111-byte/Leeshvocalhomepages/actions/runs?per_page=60").get("workflow_runs", [])
    except Exception as e:
        runs = None
    lints = adv.get("lints", []) if isinstance(adv, dict) else []
    sec_err = [l.get("name") for l in lints if l.get("level") == "ERROR"]
    sec_warn = len([l for l in lints if l.get("level") == "WARN"])

    bad, ok = [], []   # 확인할 것 / 정상
    def chk(cond_bad, bad_text, ok_text):
        (bad if cond_bad else ok).append(bad_text if cond_bad else ok_text)

    # 1) 서버 보안
    chk(bool(sec_err), "보안 점검 ERROR %d개: %s" % (len(sec_err), ", ".join(sorted(set(sec_err)))[:200]),
        "보안 점검 ERROR 0 (WARN %d개는 의도된 것)" % sec_warn)
    # 2) 예약
    b = d["bookings"]
    chk(b["room_overlap"] or b["member_overlap"], "겹친 예약 발견 (방 %s · 사람 %s)" % (b["room_overlap"], b["member_overlap"]),
        "겹친 예약 0 · 오늘 %s건 · 내일 %s건" % (b["today"], b["tomorrow"]))
    chk(not b["has_room_lock"], "예약 함수에 몰림 대비 잠금이 빠졌어요 (leesh_booking_room_lock 확인)", "예약 몰림 대비 잠금 그대로")
    s = d["settings"] or {}
    expect = {"max_minutes": 120, "max_days": 1, "cancel_minutes": 60, "daily_max_minutes": 1440, "pin_login": False, "student_notes": True, "song_recs": False}
    diff = {k: s.get(k) for k, v in expect.items() if s.get(k) != v}
    chk(bool(diff), "예약 · 기능 설정이 정해둔 값과 달라요: %s (원장님이 바꾼 거면 CLAUDE.md도 고치기)" % json.dumps(diff, ensure_ascii=False),
        "예약 규칙 그대로 (한 번에 2시간 · 오늘·내일 · 1시간 전 취소)")
    # 연습실 예약 멈춤 (원장님 2026-11-05 "준비 중"): 서버 settings.booking_open과 화면 js/config.js bookingOpen이 같아야 함
    import os, re
    try:
        cfg = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "js", "config.js"), encoding="utf-8").read()
        m = re.search(r"^\s*bookingOpen:\s*(true|false)", cfg, re.M)
        front = (m.group(1) == "true") if m else True
        # 여는 시각(bookingOpenAt)이 지났으면 화면은 열린 것 (원장님 2026-11-12)
        at = re.search(r'^\s*bookingOpenAt:\s*"([^"]+)"', cfg, re.M)
        if not front and at:
            from datetime import datetime, timezone
            if datetime.now(timezone.utc) >= datetime.fromisoformat(at.group(1)):
                front = True
    except OSError:
        front = None
    server = s.get("booking_open", True)
    chk(front is not None and front != server,
        "연습실 예약 켜짐이 서버(%s)와 화면(%s)이 달라요" % ("열림" if server else "멈춤", "열림" if front else "멈춤"),
        "연습실 예약: " + ("열림" if server else "잠깐 멈춤 (화면 \"준비 중\", 원장님 2026-11-05)"))
    # 3) 자동 작업
    c = d["cron"] or {}
    chk((c.get("failed") or 0) > 0 or (c.get("runs") or 0) == 0,
        "인스타 자동 가져오기(서버 예약 실행) 24시간 %s번 중 실패 %s번" % (c.get("runs"), c.get("failed")),
        "인스타 자동 가져오기 24시간 %s번 모두 성공" % c.get("runs"))
    ig = d["instagram"] or {}
    if ig.get("connected"):
        chk(bool(ig.get("last_error")) or (age_h(ig.get("last_sync")) or 99) > 6,
            "인스타그램 가져오기 문제: 마지막 %s · %s" % (kst(ig.get("last_sync")), ig.get("last_error") or "6시간 넘게 안 돎"),
            "인스타그램 마지막 가져오기 %s" % kst(ig.get("last_sync")))
        chk((age_h(ig.get("refreshed_at")) or 0) > 24 * 45, "인스타그램 열쇠 갱신이 45일 넘게 안 됐어요 (60일이면 끊김)",
            "인스타그램 열쇠 갱신 %s" % kst(ig.get("refreshed_at")))
    ls = d["lesson_sync"] or {}
    chk(not ls.get("ok") or (age_h(ls.get("last_at")) or 99) > 3 or ls.get("errors"),
        "선생님 레슨 시트 가져오기 문제: 마지막 %s · ok=%s · 오류 %s개 %s" % (kst(ls.get("last_at")), ls.get("ok"), ls.get("errors"), (ls.get("error_sample") or "").split(":", 1)[-1].strip()),
        "레슨 시트 가져오기 마지막 %s · 오류 0" % kst(ls.get("last_at")))
    cs = d.get("consult_sync") or {}
    chk(not cs.get("ok") or (age_h(cs.get("last_at")) or 99) > 3,
        "원장 컨설팅 시트 가져오기 문제: 마지막 %s · %s" % (kst(cs.get("last_at")), cs.get("note") or ""),
        "원장 컨설팅 시트 가져오기 마지막 %s · %s" % (kst(cs.get("last_at")), cs.get("note") or ""))
    ss = d["sheet_sync"] or {}
    chk(not ss.get("ok"), "수강ID 시트 → 명단 맞추기 마지막 결과가 실패: %s" % (ss.get("error") or ""),
        "수강ID 시트 맞추기 마지막 %s ok (시트가 바뀐 날에만 돎)" % kst(ss.get("last_at")))
    bk = d["backup"] or {}
    chk(not bk.get("ok") or (age_h(bk.get("last_at")) or 99) > 26,
        "백업 문제: 마지막 %s · ok=%s %s" % (kst(bk.get("last_at")), bk.get("ok"), bk.get("error") or ""),
        "백업 마지막 %s · 표 %s개 · %s KB" % (kst(bk.get("last_at")), bk.get("tables"), round((bk.get("bytes") or 0) / 1024)))
    chk(bk.get("files_ok") is False or (bk.get("files_failed") or 0) > 0,
        "파일 백업 문제: 실패 %s · %s" % (bk.get("files_failed"), bk.get("files_note") or ""), "파일 백업 ok (남은 것 %s)" % (bk.get("files_left") or 0))
    tg = d["telegram"] or {}
    chk(not tg.get("on") or not tg.get("chats"), "텔레그램 알림이 꺼져 있거나 받는 사람이 없어요", "텔레그램 알림 켜짐 (받는 곳 %s)" % tg.get("chats"))
    ob = d["outbound"] or {}
    chk((ob.get("bad") or 0) > 0, "바깥으로 보낸 요청(텔레그램 · 인스타) 24시간 %s개 중 실패 %s개" % (ob.get("total"), ob.get("bad")),
        "바깥 요청 24시간 %s개 실패 0" % ob.get("total"))
    if runs is None:
        bad.append("GitHub Actions 상태를 못 읽었어요 (github.com 연결)")
    else:
        day = [r for r in runs if (age_h(r.get("created_at")) or 99) <= 24]
        fail = [r for r in day if r.get("conclusion") in ("failure", "timed_out", "startup_failure")]
        names2 = sorted({r.get("name") for r in fail})
        chk(bool(fail), "GitHub Actions 24시간 %d번 중 실패 %d번: %s (페이지 배포 실패면 새 수정이 홈페이지에 안 보임)" % (len(day), len(fail), ", ".join(names2)),
            "GitHub Actions 24시간 %d번 실패 0 (페이지 배포 · 인스타 사진 · 인터뷰 영상)" % len(day))
    # 4) 처리 기다리는 것 (하루 넘게 밀린 것만 확인할 것으로)
    names = {"kakao_link": "학생 카카오 연결 요청", "teacher_link": "선생님 연결 요청", "parent_link": "학부모 연결 요청", "consult": "상담 신청", "partner": "제휴 업체 신청", "song": "노래 추천 신청"}
    for k, label in names.items():
        w = d["waiting"][k] or {}
        n, h = w.get("n") or 0, age_h(w.get("oldest"))
        if n and h is not None and h > 24:
            bad.append("%s %s건 대기 (가장 오래된 것 %d시간째) → 관리자 화면에서 처리" % (label, n, h))
        elif n:
            ok.append("%s %s건 대기 (하루 안 된 것)" % (label, n))
    # 5) 데이터 · 크기
    dt = d["data"]
    chk(dt["bad_note_sheets"] or dt["bad_lesson_sheets"], "검사에 안 맞는 표가 있어요 (일지 %s · 곡·자료 %s)" % (dt["bad_note_sheets"], dt["bad_lesson_sheets"]), "일지 · 곡·자료 표 모두 정상")
    chk(dt["no_log_tables"], "관리자 작업 기록이 안 붙은 표: %s (zz_admin_log 트리거 붙이기)" % dt["no_log_tables"], "관리자 작업 기록: 모든 표에 붙어 있음")
    chk(dt["private_sheets"], "레슨 노트(학생도 봄)에 생년월일 + 주소 같은 개인정보로 보이는 일지 %s개" % dt["private_sheets"], "레슨 노트에 개인정보 일지 0 (OT 등 곡·자료는 담당 선생님 · 관리자만 봄)")
    sz = d["size"]
    chk(sz["db_mb"] > 300 or sz["storage_mb"] > 614, "용량 60% 넘음: DB %s MB / 500 · 파일 %s MB / 1024" % (sz["db_mb"], sz["storage_mb"]),
        "용량 DB %s MB / 500 · 파일 %s MB / 1024" % (sz["db_mb"], sz["storage_mb"]))
    n24 = d["new24"]
    chk(n24["login_fails"] > 50, "로그인 실패가 24시간 %s번 (누가 계속 시도하는지 확인)" % n24["login_fails"], "로그인 실패 24시간 %s번" % n24["login_fails"])

    p = d["people"]
    if p["stuck"]:
        ok.append("카카오로 로그인만 하고 연결 요청을 안 보낸 계정 %s개 (최근 14일, 첫 단계에서 막혔을 수 있음)" % p["stuck"])
    print("[홈페이지 매일 점검] %s (한국 시간)" % d["now_kst"])
    print("결과:", "확인할 것 %d개" % len(bad) if bad else "이상 없음")
    for x in bad:
        print("  ⚠", x)
    print("정상:")
    for x in ok:
        print("  ·", x)
    print("어제 하루: 예약 %s · 취소 %s · 내방 신청 %s · 연습 일지 %s · 홈페이지에서 쓴 레슨 일지 %s · 새 카카오 계정 %s" % (
        n24["bookings"], n24["cancels"], n24["visit_apps"], n24["practice_logs"], n24["lesson_notes_site"], n24["auth_users"]))
    print("사람: 재원 %s · 카카오 연결 학생 %s · 선생님 연결 %s · 관리자 %s" % (p["members_active"], p["kakao_linked"], p["teachers_linked"], p["admins"]))
    print(json.dumps({"ok": not bad, "issues": bad}, ensure_ascii=False))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
