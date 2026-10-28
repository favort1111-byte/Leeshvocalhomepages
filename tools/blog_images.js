// Blog pictures for the posts moved into the site (tools/import_blog.py writes data/blog/images.json).
//   node tools/blog_images.js CACHE_DIR
// CACHE_DIR holds the downloaded originals (fetched with curl, which goes through the proxy);
// each one is turned into a WebP at most 800px wide in assets/blog-posts/<post>/<n>.webp by Chromium.
// Pictures already converted are skipped, so it can be run again after a new import.
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REPO = path.dirname(__dirname);
const cache = process.argv[2];
if (!cache) { console.error("usage: node tools/blog_images.js CACHE_DIR"); process.exit(1); }
fs.mkdirSync(cache, { recursive: true });
const images = JSON.parse(fs.readFileSync(path.join(REPO, "data/blog/images.json"), "utf8"));

function download(url) {
  const file = path.join(cache, crypto.createHash("sha1").update(url).digest("hex"));
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
  try {
    execFileSync("curl", ["-sS", "-f", "-m", "60", "-H", "Referer: https://blog.naver.com/", "-o", file, url + "?type=w966"]);
    return file;
  } catch (e) {
    try { fs.unlinkSync(file); } catch (x) { /* none */ }
    return null;
  }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<html><body></body></html>");
  let made = 0, skipped = 0, failed = [];
  for (const [url, local] of Object.entries(images)) {
    const out = path.join(REPO, local);
    if (fs.existsSync(out)) { skipped++; continue; }
    const file = download(url);
    if (!file) { failed.push(url); continue; }
    const b64 = fs.readFileSync(file).toString("base64");
    const webp = await page.evaluate(async (data) => {
      const img = new Image();
      img.src = "data:image/*;base64," + data;
      try { await img.decode(); } catch (e) { return null; }
      const w = Math.min(800, img.naturalWidth), h = Math.round(img.naturalHeight * w / img.naturalWidth);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const url = c.toDataURL("image/webp", 0.74);
      return url.startsWith("data:image/webp") ? url.split(",")[1] : null;
    }, b64);
    if (!webp) { failed.push(url); continue; }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(webp, "base64"));
    if (++made % 100 === 0) console.log(made, "made");
  }
  await browser.close();
  console.log({ made, skipped, failed: failed.length });
  if (failed.length) fs.writeFileSync(path.join(cache, "failed.txt"), failed.join("\n"));
})();
