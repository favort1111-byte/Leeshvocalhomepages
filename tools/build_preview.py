"""Build a 체험 모드 copy of the site: every page gets js/demo.js, so booking,
consult and admin work on fake data in the browser with no database.
    python3 tools/build_preview.py OUT_DIR
Used for private previews before launch; the real pages are never touched.
    python3 tools/build_preview.py OUT_DIR --explain
builds the 설명용 copy (원장님 2026-11-07): same fake data, but the bar only offers
학생 · 선생님 · 학부모 (no 관리자 link) so it can be shown to students and teachers."""
import os, re, shutil, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = ["interview.html", "schools.html", "index.html", "about.html", "contact.html", "consult.html", "booking.html", "games.html", "audition.html", "results.html", "tips.html", "post.html", "privacy.html", "apply.html", "teacher.html", "parent.html", "guide.html", "admin.html"]
API = '<script src="js/api.js"></script>\n'
BLOG_BASE = "https://raw.githubusercontent.com/favort1111-byte/Leeshvocalhomepages/claude/dazzling-bardeen-mw08yt/"

out = sys.argv[1]
EXPLAIN = "--explain" in sys.argv[2:]
os.makedirs(out, exist_ok=True)
for page in PAGES:
    html = open(os.path.join(REPO, page)).read()
    html = re.sub(r'((?:href|src)="(?:css|js)/[^"?]+)\?v=[0-9a-f]+"', r'\1"', html)  # the preview copy is always fresh
    assert API in html, page
    html = re.sub(r'<!-- naver analytics -->.*?<!-- /naver analytics -->\n', "", html, flags=re.S)  # 미리보기는 방문자 통계에 안 셈
    html = html.replace(API, API + '<script src="js/demo.js"></script>\n')
    # 800 moved blog posts + pictures don't fit in the preview: post.html and 내 폴더 read them from GitHub
    html = html.replace('<script src="js/config.js"></script>\n', '<script src="js/config.js"></script>\n<script>window.LEESH.blogBase = "' + BLOG_BASE + '";' + (' window.LEESH.demoExplain = true;' if EXPLAIN else '') + '</script>\n')
    if page == "index.html":  # names the preview in the artifact gallery
        html = html.replace("<title>이송희보컬레슨 | 강남 선릉역 1:1 보컬학원</title>", "<title>" + ("이송희보컬레슨 체험 (설명용)" if EXPLAIN else "이송희보컬레슨 작업 현황") + "</title>")
    open(os.path.join(out, page), "w").write(html)
for folder in ["css", "js", os.path.join("assets", "img"), os.path.join("assets", "fonts")]:  # (assets/blog-posts and data/blog stay on GitHub)
    shutil.copytree(os.path.join(REPO, folder), os.path.join(out, folder), dirs_exist_ok=True)
os.makedirs(os.path.join(out, "data"), exist_ok=True)
shutil.copy(os.path.join(REPO, "data", "schools.json"), os.path.join(out, "data", "schools.json"))  # 입시 학교 찾기
for f in ["favicon.ico"]:  # 탭 아이콘
    shutil.copy(os.path.join(REPO, f), os.path.join(out, f))
print("preview written to", out)
