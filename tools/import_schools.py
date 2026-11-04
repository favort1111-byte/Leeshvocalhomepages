"""입시 학교 찾기 (schools.html) 자료 만들기 — 원장님 2026-11-04.

원본: 구글시트 "입시반 음악 관련 학과 학교 목록" → '학교 목록' 탭 (읽기만).
시트 도구로 읽은 그대로를 폴더 하나에 넣고 돌려요:
    a_j.json  = '학교 목록'!A4:J  (구분 · 시도 · 시군구 · 학교명 · 설립 · 단과대 · 학과 · 학과 종류 · 보컬 실기 · 상태)
    m.json    = M4:M (학원 합격 이력)    o.json = O4:O (학교·학과 홈페이지)    qr.json = Q4:R (2027 원서 기간 · 실기 내용)
    python3 tools/import_schools.py <그 폴더>   → data/schools.json

원장님이 정한 것: 누구나 보는 페이지 · 모집구분 3개(4년제 대학 / 전문대학 / 고등학교, 학점은행은 4년제·2년제 과정으로 나눠
그 칸에 "학점은행"으로 표시) · 지역은 권역 7개 · 보컬 실기 '예'인 학과만 · 모집 없는 학과는 뺌.
학교 이름 · 학과 · 원서 기간 · 실기 내용 · 홈페이지 · 학원 합격 이력만 보여줌 (확인 정도 · 근거 자료 · 메모 같은 학원 안쪽 칸은 안 씀).
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
SRC = sys.argv[1]

REGIONS = [
    ("seoul", "서울", ["서울"]),
    ("gyeonggi", "경기 · 인천", ["경기", "인천"]),
    ("gangwon", "강원", ["강원"]),
    ("chung", "충청", ["대전", "세종", "충북", "충남"]),
    ("jeolla", "전라", ["광주", "전북", "전남"]),
    ("gyeong", "경상", ["대구", "경북", "부산", "울산", "경남"]),
    ("jeju", "제주", ["제주"]),
]
REGION_OF = {s: key for key, _, ss in REGIONS for s in ss}
CATS = [("univ", "4년제 대학"), ("college", "전문대학"), ("high", "고등학교")]
# 학점은행: 학사(4년제) 과정이면 4년제 칸, 전문학사(2년제) 과정이면 전문대학 칸 (원장님 2026-11-04 "명확히 표기").
# 시트에 과정 길이가 없어서 학교마다 정함. 모르는 곳은 원장님 확인 전까지 안 보여줌.
CREDIT_BANK = {
    "국민대학교 평생교육원 KMA": "univ",
    "서경대학교 예술교육원": "univ",
    "한양대학교 미래인재교육원": "univ",
    "명지대학교 미래교육원": "univ",
    # 원장님 2026-11-04 "4군데 모두 학점은행제": 과정 길이는 안 정해서 4년제 · 전문대학 두 칸에 다 보이고 "학교에 확인"으로
    "서울종합예술실용학교(SAC)": "both",
    "서울호서예술실용전문학교": "both",
    "한국방송예술진흥원": "both",
    "백석예술대학교 평생교육원": "both",
}
HIGH = {"예술고": "예술고", "특성화고": "특성화고", "대안학교": "대안학교"}
FIX = {"수뉥": "수능"}  # 시트의 글자 오타


DAY = r"(\d{4})-(\d{1,2})-(\d{1,2})"
YEAR = "2026"  # 실기 · 발표 날짜에 연도가 없으면 (10/24, 11-04) 2027학년도 입시라 2026년


def ymd(y, m, d):
    return "%s-%02d-%02d" % (y, int(m), int(d))


def rounds_of(text):
    """원서 기간 글 → [{t: 수시1차, a: 시작, b: 끝, n: 덧붙인 말}] (한 줄에 ' / '로 여러 전형)."""
    out = []
    for part in [x.strip() for x in (text or "").split(" / ") if x.strip()]:
        m = re.search(DAY + r"\s*~\s*(?:(\d{4})-)?(\d{1,2})-(\d{1,2})", part)
        if not m:
            continue
        y, mo, d, y2, mo2, d2 = m.groups()
        out.append({"t": part[:m.start()].strip(), "a": ymd(y, mo, d), "b": ymd(y2 or y, mo2, d2),
                    "n": part[m.end():].strip()})
    return out


def date_after(text, words):
    """'실기 2026-10-18' · '실기 10/24' · '합격 발표 11-04' 같은 날짜 하나."""
    m = re.search("(?:" + words + r")\s*(?:" + DAY + r"|(\d{1,2})[/-](\d{1,2}))(?![\d~])", text or "")
    if not m:
        return ""
    y, mo, d, mo2, d2 = m.groups()
    return ymd(y, mo, d) if y else ymd(YEAR, mo2, d2)


def load(name):
    with open(os.path.join(SRC, name), encoding="utf-8") as f:
        return json.load(f)


def cell(rows, i, k=0):
    return (rows[i][k] if i < len(rows) and k < len(rows[i]) else "").strip()


def clean(v):
    v = (v or "").strip()
    for a, b in FIX.items():
        v = v.replace(a, b)
    return "" if "(확인 필요)" == v else re.sub(r"\(확인 필요\)", "", v).strip()


rows, m, o, qr = load("a_j.json"), load("m.json"), load("o.json"), load("qr.json")
out, held, skipped = [], [], 0
for i, r in enumerate(rows):
    kind, sido, sigungu, school, found, college, major, mkind, vocal, state = [x.strip() for x in r]
    if vocal != "예" or state == "모집 없음":
        skipped += 1
        continue
    sub = ""
    if kind == "4년제 대학":
        cat = "univ"
    elif kind == "전문대학":
        cat = "college"
    elif kind in HIGH:
        cat, sub = "high", HIGH[kind]
    elif "학점은행" in kind:
        cat = CREDIT_BANK.get(school)
        if not cat:
            held.append(school)
            continue
        sub = {"univ": "학점은행 · 4년제(학사) 과정", "college": "학점은행 · 2년제(전문학사) 과정",
               "both": "학점은행제 · 2년·4년 과정은 학교에 확인"}[cat]
    else:
        held.append(school)
        continue
    region = REGION_OF.get(sido)
    if not region and cat != "both":
        held.append(school)
        continue
    pas = cell(m, i)
    for one in (["univ", "college"] if cat == "both" else [cat]):
      out.append({
        "cat": one, "sub": sub, "region": region or "", "sido": clean(sido), "sigungu": clean(sigungu),
        "school": school, "found": clean(found), "college": clean(college), "major": major, "kind": mkind,
        "apply": clean(cell(qr, i, 0)), "audition": clean(cell(qr, i, 1)), "home": cell(o, i),
        # 일정 칸 (원서접수 · 실기 · 합격 발표): 날짜가 적힌 것만, 화면이 오늘과 견줘 종료 · 접수 중 · D-n을 붙임
        "rounds": rounds_of(clean(cell(qr, i, 0))),
        "exam": date_after(clean(cell(qr, i, 1)), r"실기고사|실기·면접|실기"),
        "result": date_after(clean(cell(qr, i, 1)), r"합격\s*발표"),
        # 학원 합격 이력: 학과·캠퍼스가 확실한 것만 (시트에 "확인 필요"가 붙은 건 안 보여줌)
        "pass": "" if "확인 필요" in pas else pas,
        "check": state == "확인 필요",
    })

data = {
    "updated": "2026-11-03",
    "year": "2027학년도",
    "cats": [{"key": k, "name": n} for k, n in CATS],
    "regions": [{"key": k, "name": n, "sido": ss} for k, n, ss in REGIONS],
    "items": out,
}
os.makedirs(os.path.join(REPO, "data"), exist_ok=True)
with open(os.path.join(REPO, "data", "schools.json"), "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
from collections import Counter
print("학과", len(out), "· 뺀 줄", skipped, "· 확인 전이라 안 보임:", held)
print(Counter((x["cat"]) for x in out))
print("원서 일정", sum(1 for x in out if x["rounds"]), "· 실기 날짜", sum(1 for x in out if x["exam"]), "· 발표", sum(1 for x in out if x["result"]))
print(Counter((x["cat"], x["region"]) for x in out))
