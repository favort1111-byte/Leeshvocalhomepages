"""오디션 소식: read the Naver blog's RSS and keep the 오디션 정보 / 합격자 현황 posts in data/auditions.json.
    python3 tools/fetch_auditions.py      (then python3 tools/build_pages.py)
The RSS only holds the latest posts, so older ones already in the file are kept (newest first, capped)."""
import html, json, os, re, sys, urllib.request
from datetime import datetime, timedelta, timezone

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "data", "auditions.json")
RSS = "https://rss.blog.naver.com/o_oa8.xml"
KEEP = {"내방": 24, "오디션": 60, "합격": 60}
KST = timezone(timedelta(hours=9))


def text(s):
    s = re.sub(r"<!\[CDATA\[|\]\]>", "", s or "")
    s = html.unescape(s)
    s = re.sub(r"[️​☀-➿\U0001F000-\U0001FAFF]", "", s)  # emoji & variation marks in titles
    return re.sub(r"\s+", " ", s).strip()


def short(s):
    """Blog titles end in search keywords ("/랩,댄스,보컬/…", "| 하이헷오디션, …"): keep the first part."""
    return re.split(r"\s*[/|,(]\s*", s, maxsplit=1)[0].strip()


def parse(item):
    title = text(re.search(r"<title>(.*?)</title>", item, re.S).group(1))
    cat = text((re.search(r"<category>(.*?)</category>", item, re.S) or [None, ""])[1])
    link = text(re.search(r"<link>(.*?)</link>", item, re.S).group(1)).split("?")[0]
    when = datetime.strptime(text(re.search(r"<pubDate>(.*?)</pubDate>", item, re.S).group(1)), "%a, %d %b %Y %H:%M:%S %z")
    post = link.rstrip("/").rsplit("/", 1)[-1]
    bracket = re.match(r"\[([^\]]*)\]\s*(.*)", title)
    head, rest = (bracket.group(1).strip(), bracket.group(2).strip()) if bracket else ("", title)
    if "합격" in cat:
        kind = "합격"
        company = re.sub(r"\s*합격을?\s*축하합니다.*$", "", rest.split("|")[0]).strip()
        name = company + " 합격"
    elif "내방" in title:
        kind = "내방"
        if "이송희" in head and rest and "일정" not in rest:   # [이송희 보컬레슨 2월 기획사 내방오디션 일정] 타이탄콘텐츠 | …
            company, name = short(rest), re.sub(r"이송희\s*보컬레슨\s*", "", head).strip()
        else:                                                    # [2026 이송희 보컬레슨] 2월 내방 오디션 일정 안내
            company, name = "", short(rest) or head
    elif "오디션" in cat:
        kind = "오디션"
        # [하이헷 상시 오디션] 하이헷 | … → 하이헷 · 상시 오디션 / [YG 엔터테인먼트]YG AUDITION /… → YG 엔터테인먼트 · YG AUDITION
        base = head.split("/")[0].strip() or short(rest)
        m = re.search(r"\s*((?:상시|온라인|공개|\d+월)?\s*오디션)$", base)
        company = base[:m.start()].strip() if m and base[:m.start()].strip() else base
        name = short(rest)
        flat = lambda t: re.sub(r"\s|엔터테인먼트", "", t).lower()
        if not name or flat(name) in flat(company):
            name = m.group(1).strip() if m else "오디션"
    else:
        return None
    return {"id": post, "kind": kind, "date": when.astimezone(KST).strftime("%Y-%m-%d"),
            "company": company, "title": name or company, "link": link}


def main():
    req = urllib.request.Request(RSS, headers={"User-Agent": "Mozilla/5.0 (leeshlesson.com audition news)"})
    xml = urllib.request.urlopen(req, timeout=30).read().decode("utf-8")
    fresh = [p for p in (parse(m) for m in re.findall(r"<item>(.*?)</item>", xml, re.S)) if p]
    old = []
    if os.path.exists(OUT):
        old = json.load(open(OUT, encoding="utf-8")).get("items", [])
    seen, items = set(), []
    for p in fresh + old:  # fresh first so a fixed title replaces the stored one
        key = p["id"] if p["kind"] != "합격" else (p["kind"], p["company"], p["date"])
        if key in seen:
            continue
        seen.add(key)
        items.append(p)
    items.sort(key=lambda p: (p["date"], p["id"]), reverse=True)
    out, count = [], {}
    for p in items:
        count[p["kind"]] = count.get(p["kind"], 0) + 1
        if count[p["kind"]] <= KEEP[p["kind"]]:
            out.append(p)
    data = {"source": "https://blog.naver.com/o_oa8", "items": out}
    if old == out:
        print("no new posts")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("wrote", OUT, {k: min(v, KEEP[k]) for k, v in count.items()})


if __name__ == "__main__":
    sys.exit(main())
