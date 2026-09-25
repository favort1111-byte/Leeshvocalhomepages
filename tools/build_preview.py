"""Build a 체험 모드 copy of the site: every page gets js/demo.js, so booking,
consult and admin work on fake data in the browser with no database.
    python3 tools/build_preview.py OUT_DIR
Used for private previews before launch; the real pages are never touched."""
import os, shutil, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = ["index.html", "about.html", "contact.html", "consult.html", "booking.html", "admin.html"]
API = '<script src="js/api.js"></script>\n'

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
for page in PAGES:
    html = open(os.path.join(REPO, page)).read()
    assert API in html, page
    html = html.replace(API, API + '<script src="js/demo.js"></script>\n')
    if page == "index.html":  # names the preview in the artifact gallery
        html = html.replace("<title>이송희보컬레슨 | 강남 선릉역 1:1 보컬학원</title>", "<title>이송희보컬레슨 작업 현황</title>")
    open(os.path.join(out, page), "w").write(html)
for folder in ["css", "js", os.path.join("assets", "img")]:
    shutil.copytree(os.path.join(REPO, folder), os.path.join(out, folder), dirs_exist_ok=True)
print("preview written to", out)
