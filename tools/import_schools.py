"""입시 학교 찾기 (schools.html) 자료 만들기 — 원장님 2026-11-04.

원본: 구글시트 "입시반 음악 관련 학과 학교 목록" → '학교 목록' 탭 (읽기만).
시트 도구로 읽은 그대로를 폴더 하나에 넣고 돌려요:
    a_j.json  = '학교 목록'!A4:J  (구분 · 시도 · 시군구 · 학교명 · 설립 · 단과대 · 학과 · 학과 종류 · 보컬 실기 · 상태)
    m.json    = M4:M (학원 합격 이력)    o.json = O4:O (학교·학과 홈페이지)    qr.json = Q4:R (2027 원서 기간 · 실기 내용)
    auto.json = '자동 확인'!A4:C (학교명 · 구분 · 입학처 공지·모집요강 주소)   news.json = '새 소식'!A4:E (자동 확인이 찾은 공지)
    guide.json (있으면) = '모집요강 요약'!A4:L (학교명 · 학과 · 모집인원 · 전형 · 원서 기간 · 실기 일정 · 합격 발표 · 실기 내용 · 반영 비율 · 모집요강 링크 · 확인한 날 · 메모)
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
# 시트의 홈페이지 주소가 학과가 아닌 곳으로 가는 것 (시트는 읽기만이라 여기서 바꿈). 학과 공식 주소는 네이버 교육 학과 정보로 확인
HOME_FIX = {
    # 원장님 2026-11-04: 학생회 소개 페이지로 감 → 실용음악전공 공식 홈페이지
    "https://www.hongik.ac.kr/kr/life/seoul-performing-arts.do": "https://music.hongik.ac.kr/",
    # 같은 날 네이버 교육 학과 정보의 '공식 홈페이지'와 맞춰 본 것: 교수 목록 · 다른 쪽 → 학과 공식 주소
    "https://academics.cu.ac.kr/home/professor/art/music/list/": "https://academics.cu.ac.kr/home/detail/art/music/",
    "https://dept.kmu.ac.kr/dept/10636/subview.do": "https://music.kmu.ac.kr",
    "https://www.bu.ac.kr/web/3809/subview.do": "https://community.bu.ac.kr/art2/1655/subview.do",
}


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


# 실기 날짜 (원장님 2026-11-04 "입시일자 언제부터 언제까지"): 요약 F칸은 첫날만이라, 메모 · 실기 내용에서 기간 · 2차 · 정시 실기를 찾음
_MD = r"(?:(\d{4})-)?(\d{1,2})[-./](\d{1,2})"
_RANGE = re.compile(_MD + r"\s*~\s*(?:(?:(\d{4})-)?(\d{1,2})[-./])?(\d{1,2})(?!\d)")


def _ymd(y, mo, d, base):
    """연도가 없으면 기준 날짜의 해 (기준이 가을인데 1~3월이면 다음 해)."""
    if y:
        return ymd(y, mo, d)
    by, bm = int(base[:4]), int(base[5:7])
    yy = by + 1 if bm >= 8 and int(mo) <= 3 else by
    return ymd(str(yy), mo, d)


def exam_plan(first, memo, prep):
    """[{t: 1차/2차/정시/'', a, b}] — 실기 시험 날짜들."""
    out, text = [], (memo or "") + " " + (prep or "")
    base = first or "2026-10-01"
    if first:
        end = ""
        for m in _RANGE.finditer(text):
            y, mo, d, y2, mo2, d2 = m.groups()
            if _ymd(y, mo, d, base) == first:
                end = _ymd(y2 or y, mo2 or mo, d2, first)
                break
        out.append({"t": "", "a": first, "b": end if end and end > first else ""})
    m = re.search(r"(2차|2단계)(?:[^0-9,.;)]{0,12}?)" + _MD + r"(?:\s*~\s*(?:(?:(\d{4})-)?(\d{1,2})[-./])?(\d{1,2})(?!\d))?", text)
    if m and "발표" not in text[m.start():m.start(2) if m.group(2) else m.start(3)]:
        lab, y, mo, d, y2, mo2, d2 = m.groups()
        a = _ymd(y, mo, d, base)
        b = _ymd(y2 or y, mo2 or mo, d2, a) if d2 else ""
        if a != first and (not out or a > out[0]["a"]):
            two = text[max(0, m.start() - 2):m.start()] == "수시"   # "수시2차 실기 12-02" = 두 번째 모집 (2단계 시험이 아님)
            if out:
                out[0]["t"] = "수시1차" if two else "1차"
            out.append({"t": "수시2차" if two else "2차", "a": a, "b": b if b > a else ""})
    m = re.search(r"정시[^.;/]{0,30}?실기\s*" + _MD + r"(?:\s*~\s*(?:(?:(\d{4})-)?(\d{1,2})[-./])?(\d{1,2})(?!\d))?", text)
    if m:
        y, mo, d, y2, mo2, d2 = m.groups()
        a = _ymd(y, mo, d, "2027-01-01" if not y else y + "-01-01")
        b = _ymd(y2 or y, mo2 or mo, d2, a) if d2 else ""
        if out and not out[0]["t"]:
            out[0]["t"] = "수시"
        out.append({"t": "정시", "a": a, "b": b if b > a else ""})
    return out


def prep_list(text):
    """실기 내용 → 짧은 줄 여러 개 (' / ' · '; ' · 문장 끝 '. '에서 나눔)."""
    parts = re.split(r"\s+/\s+|;\s*|(?<=[^\d\s])\.\s+", (text or "").strip())
    return [x.strip().rstrip(".").strip() for x in parts if x.strip().rstrip(".").strip()]


NO_VOCAL = re.compile(r"보컬 실기 없음|학과\s*폐지|모집\s*중지|폐지|모집단위에[^.]*없음|보컬 전공 없음|모집 없음")
NOT_YET = re.compile(r"미게시|요강 못 찾음")


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

# 입학처 (원장님 2026-11-04 "카드에 바로 입시요강"): '자동 확인' 탭의 학교별 입학처 공지·모집요강 주소 (로컬에서 확인한 공식 주소)
ADMIT = {r[0].strip(): r[2].strip() for r in load("auto.json") if len(r) > 2 and r[2].strip().startswith("http")}
# 2027 모집요강 글: '새 소식' 탭에서 제목에 2027(27학년도)과 모집요강이 같이 있는 것 (정오표 · 전년도 빼고), 없으면 "모집요강" 메뉴 주소
GUIDE = {}
for r in load("news.json"):
    if len(r) < 5:
        continue
    school, title, link = r[1].strip(), r[3].strip(), r[4].strip()
    t = title.replace(" ", "")
    if not link.startswith("http") or "정오" in t or "전년도" in t:
        continue
    if ("2027" in t or "27학년도" in t) and "모집요강" in t:
        GUIDE.setdefault(school, (title, link))
for r in load("news.json"):
    if len(r) >= 5 and r[3].strip() == "모집요강" and r[4].startswith("http"):
        GUIDE.setdefault(r[1].strip(), ("모집요강", r[4].strip()))
# 모집요강 요약 (학과마다, 로컬 세션이 모집요강을 읽고 채우는 탭) — 아직 없으면 빈 것
SUMMARY = {}
if os.path.exists(os.path.join(SRC, "guide.json")):
    for r in load("guide.json"):
        r = [x.strip() for x in r] + [""] * 12
        if r[0] and r[1]:
            SUMMARY[(r[0], r[1])] = {"seats": r[2], "track": r[3], "apply": r[4], "exam": r[5], "result": r[6],
                                    "audition": r[7], "ratio": r[8], "link": r[9], "checked": r[10], "memo": r[11]}
out, held, skipped, dropped = [], [], 0, []
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
        "apply": clean(cell(qr, i, 0)), "audition": clean(cell(qr, i, 1)), "home": HOME_FIX.get(cell(o, i), cell(o, i)),
        # 일정 칸 (원서접수 · 실기 · 합격 발표): 날짜가 적힌 것만, 화면이 오늘과 견줘 종료 · 접수 중 · D-n을 붙임
        "rounds": rounds_of(clean(cell(qr, i, 0))),
        "exam": date_after(clean(cell(qr, i, 1)), r"실기고사|실기·면접|실기"),
        "result": date_after(clean(cell(qr, i, 1)), r"합격\s*발표"),
        # 학원 합격 이력: 학과·캠퍼스가 확실한 것만 (시트에 "확인 필요"가 붙은 건 안 보여줌)
        "pass": "" if "확인 필요" in pas else pas,
        "check": state == "확인 필요",
        "admit": ADMIT.get(school, ""),
        "guide": GUIDE.get(school, ("", ""))[1],
        "guide_title": GUIDE.get(school, ("", ""))[0],
    })
    sm = SUMMARY.get((school, major))
    if sm and not sm["audition"] and NO_VOCAL.search(sm["memo"]):
        # 2027 모집요강에 보컬 실기가 없음 (학과 폐지 · 모집 중지 · 보컬 전공 없음) → "모집 없음"처럼 안 보임
        dropped.append(school + " " + major)
        del out[-(2 if cat == "both" else 1):]
        continue
    if sm:  # 모집요강 요약이 있으면 그 값을 먼저 (원서 기간 · 실기 일정은 일정 칸으로)
        it = out[-1] if cat != "both" else None
        for x in ([it] if it else out[-2:]):
            x.update({"seats": sm["seats"], "track": sm["track"], "ratio": sm["ratio"], "checked": sm["checked"]})
            if sm["audition"]: x["audition"] = sm["audition"]
            if sm["link"]: x["guide"], x["guide_title"] = sm["link"], "2027 모집요강"
            if sm["apply"]:
                x["apply"], x["rounds"] = sm["apply"], rounds_of(sm["apply"])
            if sm["exam"]: x["exam"] = date_after("실기 " + sm["exam"], "실기") or x["exam"]
            if sm["result"]: x["result"] = date_after("합격 발표 " + sm["result"], r"합격\s*발표") or x["result"]
            # 한눈에 (원장님 2026-11-04 "접수일자 · 입시일자 · 어떤 거 준비해야 하는지 딱"): 실기 날짜들 · 준비할 것 줄
            x["exams"] = exam_plan(x["exam"], sm["memo"], sm["audition"])
            x["prep"] = prep_list(sm["audition"])
            if not sm["audition"] and not sm["apply"] and NOT_YET.search(sm["memo"]):
                x["wait"] = True

data = {
    "updated": "2026-11-04",
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
print("2027 보컬 실기 없음이라 뺀 학과", len(dropped), dropped)
print(Counter((x["cat"]) for x in out))
print("입학처 링크", sum(1 for x in out if x["admit"]), "· 2027 모집요강 글", sum(1 for x in out if x["guide"]), "· 요약", len(SUMMARY))
print("원서 일정", sum(1 for x in out if x["rounds"]), "· 실기 날짜", sum(1 for x in out if x["exam"]), "· 발표", sum(1 for x in out if x["result"]))
print(Counter((x["cat"], x["region"]) for x in out))
