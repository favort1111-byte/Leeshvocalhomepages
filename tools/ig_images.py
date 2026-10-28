"""Copy the academy Instagram's pictures into the site (assets/ig/<post id>/<n>.webp).

Instagram's own picture links stop working after a while, so the pictures of every post the
database has (public.ig_posts, filled by private.ig_sync) are saved here as 800px WebP.
Pictures already copied are skipped. Each picture also gets a fingerprint (difference hash) in
data/ig_hashes.json: the academy often posts the same poster several times, and post.html shows it once.
Run by .github/workflows/instagram-pictures.yml.
    python3 tools/ig_images.py
"""
import io, json, os, re, sys, urllib.request

from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = open(os.path.join(REPO, "js", "config.js"), encoding="utf-8").read()
URL = re.search(r'supabaseUrl:\s*"([^"]+)"', CONFIG).group(1).rstrip("/")
KEY = re.search(r'supabaseKey:\s*"([^"]+)"', CONFIG).group(1)  # the publishable key: ig_posts is public


def get(url, headers=None):
    req = urllib.request.Request(url, headers=dict({"User-Agent": "leesh-ig-pictures"}, **(headers or {})))
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


posts = json.loads(get(URL + "/rest/v1/ig_posts?select=id,images&order=posted_at.desc&limit=1000",
                       {"apikey": KEY}))
made = failed = 0
for p in posts:
    for n, src in enumerate(p.get("images") or [], 1):
        out = os.path.join(REPO, "assets", "ig", p["id"], f"{n}.webp")
        if os.path.exists(out) or not src:
            continue
        try:
            img = Image.open(io.BytesIO(get(src)))
            img = img.convert("RGB")
            if img.width > 800:
                img = img.resize((800, round(img.height * 800 / img.width)), Image.LANCZOS)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            img.save(out, "WEBP", quality=78)
            made += 1
        except Exception as e:  # an expired link: the next run after a fresh sync gets it
            failed += 1
            print("skip", p["id"], n, type(e).__name__, file=sys.stderr)


def dhash(path, size=16):
    """256-bit difference hash: the same poster saved twice differs by ~0 bits, two different posters by 80+."""
    im = Image.open(path).convert("L").resize((size + 1, size), Image.LANCZOS)
    px = list(im.getdata())
    bits = 0
    for y in range(size):
        for x in range(size):
            bits = (bits << 1) | (px[y * (size + 1) + x] > px[y * (size + 1) + x + 1])
    return format(bits, "064x")


HASHES = os.path.join(REPO, "data", "ig_hashes.json")
hashes = json.load(open(HASHES)) if os.path.exists(HASHES) else {}
root = os.path.join(REPO, "assets", "ig")
for post in sorted(os.listdir(root)) if os.path.isdir(root) else []:
    for f in sorted(os.listdir(os.path.join(root, post))):
        key = post + "/" + f.split(".")[0]
        if key not in hashes:
            hashes[key] = dhash(os.path.join(root, post, f))
os.makedirs(os.path.dirname(HASHES), exist_ok=True)
with open(HASHES, "w") as f:
    json.dump(dict(sorted(hashes.items())), f, separators=(",", ":"))
print(f"copied {made}, could not {failed}, posts {len(posts)}, fingerprints {len(hashes)}")
