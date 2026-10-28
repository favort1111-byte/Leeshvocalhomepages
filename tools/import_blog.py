"""Move the Naver blog (blog.naver.com/o_oa8) into the site, so the homepage no longer depends on it.
    python3 tools/import_blog.py CACHE_DIR
CACHE_DIR keeps the downloaded post pages (PostView html, one per post) between runs; posts already
there are not downloaded again. Writes:
    data/blog/index.json           every post: id, date, category, title, summary, first picture …
    data/blog/posts/<id>.json      one post as blocks (text, picture, YouTube, link, line)
    data/blog/images.json          picture url → assets/blog-posts/<id>/<n>.webp (tools/blog_images.js makes them)
Left out on purpose: the footer every post repeats (학원 소개 · 레슨 문의 · 전화 …), hashtag lines,
anything about lesson fees (수강료는 넣지 않음), and banner pictures that appear in many posts."""
import html, json, os, re, sys, time, urllib.parse, urllib.request
from collections import Counter

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "data", "blog")
BLOG = "o_oa8"
UA = {"User-Agent": "Mozilla/5.0 (leeshlesson.com blog import)"}
CATS = {"14": "audition", "24": "results", "30": "tips", "1": "curriculum",
        "26": "academy", "29": "academy", "12": "academy", "11": "academy", "25": "audition"}

FOOTER = re.compile(r"이송희\s*보컬레슨\s*(학원\s*소개|커리큘럼\s*안내)|24시간\s*(레슨\s*)?(상담|문의)|레슨\s*문의|카카오톡\s*채널|"
                    r"전화\s*/?\s*문자\s*상담|유튜브\s*(채널|링크)|바로가기|무료\s*방문\s*상담|궁금하신\s*점\s*있으시면")
FEES = re.compile(r"레슨비|수강료|수강비|교습비|가격|할인|\d+\s*만\s*원|\d[\d,]*\s*원\b")
NAME = re.compile(r"^[가-힣A-Za-z]{1,3}[○◯OoＯ0ㅇ]{1,3}$")


def get(url):
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=40).read().decode("utf-8")


def post_list():
    posts, page = {}, 1
    while True:
        raw = get(f"https://blog.naver.com/PostTitleListAsync.naver?blogId={BLOG}&viewdate=&currentPage={page}"
                  "&categoryNo=0&parentCategoryNo=0&countPerPage=30")
        data = json.loads(raw.replace("\\'", "'"))
        for p in data["postList"]:
            posts[p["logNo"]] = {"id": p["logNo"], "cat": p["categoryNo"], "title": urllib.parse.unquote_plus(p["title"]),
                                 "date": "-".join(f"{int(x):02d}" for x in re.findall(r"\d+", p["addDate"])[:3])}
        if page * 30 >= int(data["totalCount"]):
            return list(posts.values())
        page += 1


def clean(s):
    s = html.unescape(re.sub(r"<[^>]+>", "", s or ""))
    s = re.sub("[\u200b\ufeff\u2800]", "", s).replace("\xa0", " ")
    return re.sub(r"[ \t]+", " ", s).strip()


def short_title(t):
    t = clean(t).split(" | ")[0].split("| ")[0]
    t = re.split(r"\s*/(?=[^/\]]*,)", t)[0]           # "… AUDITION /웨이크원오디션,제베원/…" → keyword tail off
    t = re.sub(r"\s*\|.*$", "", t)
    return re.sub(r"\]\s*", "] ", t).strip()


def blocks(page):
    """The post body (SmartEditor ONE) as a list of blocks, in order, footer cut off."""
    out = []
    for part in page.split('<div class="se-component ')[1:]:
        kind = part.split(" ", 1)[0].split('"', 1)[0]
        if kind in ("se-documentTitle", "se-sticker"):
            continue
        if kind in ("se-text", "se-quotation", "se-sectionTitle"):
            lines = [clean(x) for x in re.findall(r'<p class="se-text-paragraph[^>]*>(.*?)</p>', part, re.S)]
            out.append({"t": "quote" if kind == "se-quotation" else "p", "lines": lines})
        elif kind in ("se-image", "se-imageStrip", "se-imageGroup", "se-imageStrip2"):
            for src in re.findall(r'data-lazy-src="([^"]+)"', part):
                out.append({"t": "img", "src": html.unescape(src).split("?")[0]})
        elif kind == "se-oembed":
            m = re.search(r"youtube\.com/embed/([\w-]{6,})", html.unescape(part)) or re.search(r"youtu\.be/([\w-]{6,})", html.unescape(part))
            if m:
                out.append({"t": "yt", "id": m.group(1)})
        elif kind == "se-oglink":
            m = re.search(r'class="se-oglink-info"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*class="se-oglink-info"', part)
            title = clean((re.search(r'class="se-oglink-title"[^>]*>(.*?)</', part, re.S) or [None, ""])[1])
            if m:
                out.append({"t": "link", "url": html.unescape(m.group(1) or m.group(2)), "title": title})
        elif kind in ("se-horizontalLine",):
            out.append({"t": "hr"})
        elif kind == "se-table":
            rows = []
            for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", part, re.S):
                rows.append([clean(td) for td in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)])
            if rows:
                out.append({"t": "table", "rows": rows})
    if not out:  # old editor (2020): plain paragraphs and pictures
        body = page.split('id="postViewArea"', 1)[-1].split("</div>\n</div>", 1)[0]
        for img in re.findall(r'<img[^>]+src="(https://postfiles[^"]+)"', body):
            out.append({"t": "img", "src": html.unescape(img).split("?")[0]})
        text = [clean(x) for x in re.split(r"<br\s*/?>|</p>", body)]
        out.insert(0, {"t": "p", "lines": text})
    # tidy: drop the repeated footer, fee lines, hashtag lines, empty lines
    tidy = []
    for b in out:
        if b["t"] in ("p", "quote"):
            keep = []
            for line in b["lines"]:
                if FOOTER.search(line):
                    return finish(tidy + ([{**b, "lines": keep}] if keep else []))
                words = line.split()
                if not line or FEES.search(line) or (words and sum(w.startswith("#") for w in words) >= max(2, len(words) / 2)):
                    keep.append("") if keep and keep[-1] else None
                    continue
                keep.append(line)
            while keep and not keep[-1]:
                keep.pop()
            if keep:
                tidy.append({**b, "lines": keep})
        elif b["t"] == "link" and re.search(r"pf\.kakao\.com|youtube\.com/@|instagram\.com|blog\.naver\.com/o_oa8/?$", b["url"]):
            continue
        else:
            tidy.append(b)
    return finish(tidy)


def finish(bs):
    while bs and bs[-1]["t"] == "hr":
        bs.pop()
    out = []
    for b in bs:  # no two lines in a row
        if b["t"] == "hr" and (not out or out[-1]["t"] == "hr"):
            continue
        out.append(b)
    return out


def results_info(title, bs):
    """합격 posts: company, then 🏆stage🏆 and the initials under it."""
    company = re.search(r"🎖️?\s*(.+?)\s*🎖", title)
    company = clean(company.group(1)) if company else short_title(title).replace("[이송희보컬레슨]", "").split("합격")[0].strip()
    stages, cur = [], None
    for b in bs:
        for line in b.get("lines", []):
            t = re.sub(r"[🏆🎖️🥳🎉✨⭐️]", "", line).strip()
            if "🏆" in line or re.search(r"(최종|\d차)\s*합격|합격$", t) and len(t) < 30 and not NAME.match(t):
                if "축하" in t:
                    continue
                cur = {"stage": t, "names": []}
                stages.append(cur)
            elif NAME.match(t.replace(" ", "")) and cur is not None:
                cur["names"].append(t.replace(" ", ""))
    return {"company": company.replace("️", "").strip(), "stages": [s for s in stages if s["stage"]]}


def summary(bs):
    for b in bs:
        for line in b.get("lines", []):
            if len(line) >= 8 and not re.match(r"^[\W_]+$", line):
                return line[:90]
    return ""


def main():
    cache = sys.argv[1]
    os.makedirs(cache, exist_ok=True)
    posts = post_list()
    print(len(posts), "posts")
    for p in posts:
        f = os.path.join(cache, p["id"] + ".html")
        if not os.path.exists(f) or os.path.getsize(f) < 2000:
            open(f, "w", encoding="utf-8").write(get(f"https://blog.naver.com/PostView.naver?blogId={BLOG}&logNo={p['id']}"
                                                   "&redirect=Dlog&widgetTypeCall=true&directAccess=false"))
            time.sleep(0.3)
    parsed = {}
    for p in posts:
        parsed[p["id"]] = blocks(open(os.path.join(cache, p["id"] + ".html"), encoding="utf-8").read())
    # banners: the same picture file in many posts is decoration, not content
    seen = Counter(os.path.basename(b["src"]) for bs in parsed.values() for b in {x["src"]: x for x in bs if x["t"] == "img"}.values())
    banner = {name for name, n in seen.items() if n >= 4}
    sig = lambda b: "\n".join(b["lines"])
    said = Counter(s for bs in parsed.values() for s in {sig(b) for b in bs if b["t"] in ("p", "quote")})
    promo = {s for s, n in said.items() if n >= 5 and len(s) > 30}
    for k, bs in parsed.items():
        parsed[k] = finish([b for b in bs if not (b["t"] in ("p", "quote") and sig(b) in promo)])
    ids = {p["id"] for p in posts}
    images, index = {}, []
    os.makedirs(os.path.join(OUT, "posts"), exist_ok=True)
    for p in sorted(posts, key=lambda x: (x["date"], x["id"]), reverse=True):
        bs, n = [], 0
        for b in parsed[p["id"]]:
            if b["t"] == "img":
                if os.path.basename(b["src"]) in banner:
                    continue
                n += 1
                local = f"assets/blog-posts/{p['id']}/{n}.webp"
                images[b["src"]] = local
                b = {"t": "img", "src": local}
            elif b["t"] == "link":
                m = re.search(r"blog\.naver\.com/(?:o_oa8/|PostView\.naver\?blogId=o_oa8&logNo=)(\d+)", b["url"])
                if m and m.group(1) in ids:
                    b = {"t": "link", "url": "post.html?id=" + m.group(1), "title": b["title"] or "관련 글"}
                elif "blog.naver.com" in b["url"]:
                    continue
            bs.append(b)
        kind = CATS.get(p["cat"], "academy")
        title = short_title(p["title"])
        if kind == "audition" and "내방" in p["title"]:
            kind = "visit"
        entry = {"id": p["id"], "date": p["date"], "kind": kind, "title": title, "summary": summary(bs),
                 "pic": next((b["src"] for b in bs if b["t"] == "img"), None),
                 "yt": next((b["id"] for b in bs if b["t"] == "yt"), None)}
        if kind == "results":
            entry.update(results_info(p["title"], bs))
        index.append(entry)
        with open(os.path.join(OUT, "posts", p["id"] + ".json"), "w", encoding="utf-8") as f:
            json.dump({**entry, "blocks": bs}, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(OUT, "images.json"), "w", encoding="utf-8") as f:
        json.dump(images, f, ensure_ascii=False, indent=0)
    print(Counter(e["kind"] for e in index), len(images), "pictures,", len(banner), "banner files skipped")


if __name__ == "__main__":
    sys.exit(main())
