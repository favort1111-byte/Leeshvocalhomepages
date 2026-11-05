"""새 가입(연결) 신청 확인 (학생 · 선생님 · 학부모) (원장님 2026-11-05 "30분마다 학생들 회원가입 신청 들어온 거 있으면 알려줘").

    python3 tools/signup_check.py [분]     → 최근 [분](기본 30분) 안에 들어온 신청 + 아직 기다리는 신청
    종료 코드 0 = 새 신청 없음, 1 = 새 신청 있음, 2 = 확인을 못 함

읽기만 합니다 (승인 · 거절은 사람이 관리자 화면에서). 토큰은 이 환경의 Network secrets가 붙여 줍니다.
신청 이름은 화면(예약 세션 알림)에만 나오고 저장소에는 남지 않습니다.
"""
import json, sys
from daily_check import sql

MIN = int(sys.argv[1]) if len(sys.argv) > 1 else 30

Q = r"""
select jsonb_build_object(
  'now_kst', to_char(now() at time zone 'Asia/Seoul', 'MM/DD HH24:MI'),
  'students', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'teacher', teacher, 'guardian', coalesce(guardian, false),
        'at', to_char(created_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI'), 'new', created_at > now() - make_interval(mins => %(m)s))
        order by created_at) from public.link_requests where status = '대기'), '[]'::jsonb),
  'teachers', coalesce((select jsonb_agg(jsonb_build_object('name', name,
        'at', to_char(created_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI'), 'new', created_at > now() - make_interval(mins => %(m)s))
        order by created_at) from public.teacher_requests where status = '대기'), '[]'::jsonb),
  'parents', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'children', children,
        'at', to_char(created_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI'), 'new', created_at > now() - make_interval(mins => %(m)s))
        order by created_at) from public.parent_requests where status = '대기'), '[]'::jsonb),
  -- 카카오로 로그인만 하고 이름을 안 보낸 계정 (첫 단계에서 막혔을 수 있음)
  'stuck_new', (select count(*) from auth.users u
        where u.created_at > now() - make_interval(mins => %(m)s)
          and coalesce(u.raw_app_meta_data ->> 'provider', '') = 'kakao'
          and not exists (select 1 from public.link_requests r where r.user_id = u.id)
          and not exists (select 1 from public.teacher_requests t where t.user_id = u.id)
          and not exists (select 1 from public.parent_requests q where q.user_id = u.id))
) as r
""" % {"m": MIN}


def main():
    try:
        d = sql(Q)[0]["r"]
    except Exception as e:  # noqa: BLE001
        print("[새 가입 신청 확인] 확인을 못 했어요: %s" % e)
        return 2
    st, te, pa = d["students"], d["teachers"], d["parents"]
    new_st = [x for x in st if x["new"]]
    new_te = [x for x in te if x["new"]]
    new_pa = [x for x in pa if x["new"]]
    print("[새 가입 신청 확인] %s (한국 시간) · 최근 %d분" % (d["now_kst"], MIN))
    if not (new_st or new_te or new_pa):
        print("새 신청 없음 · 기다리는 신청: 학생 %d · 선생님 %d · 학부모 %d" % (len(st), len(te), len(pa)))
        if d["stuck_new"]:
            print("(카카오 로그인만 하고 이름을 안 보낸 새 계정 %d개)" % d["stuck_new"])
        return 0
    for x in new_st:
        print("● 학생 %s · 담당 %s%s · %s" % (x["name"], x["teacher"] or "-", " · 부모님 계정(만 14세 미만)" if x["guardian"] else "", x["at"]))
    for x in new_te:
        print("● 선생님 %s · %s" % (x["name"], x["at"]))
    for x in new_pa:
        print("● 학부모 %s · 자녀 %s · %s" % (x["name"], x["children"], x["at"]))
    print("기다리는 신청 전체: 학생 %d · 선생님 %d · 학부모 %d → 관리자 화면 https://leeshlesson.com/admin.html (수강 ID · 선생님 · 학부모 탭)" % (len(st), len(te), len(pa)))
    if d["stuck_new"]:
        print("(카카오 로그인만 하고 이름을 안 보낸 새 계정 %d개)" % d["stuck_new"])
    print(json.dumps({"new_students": len(new_st), "new_teachers": len(new_te), "new_parents": len(new_pa)}))
    return 1


if __name__ == "__main__":
    sys.exit(main())
