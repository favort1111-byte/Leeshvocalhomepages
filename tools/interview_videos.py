"""합격생 인터뷰 영상 (원장님 2026-11-04, 드라이브 "인터뷰영상모음" 폴더) → 홈페이지 assets/interviews/.

data/interview_videos.json 의 videos 목록에서 아직 파일이 없는 것만:
  드라이브(링크 있는 사람 누구나 보기)에서 받기 → ffmpeg로 줄이기(긴 쪽 1280px · 30fps · H.264 · 빠른 시작)
  → assets/interviews/<key>.mp4 + 표지 <key>.jpg, 목록에 file · poster · w · h · sec 적기.
드라이브 파일 이름(제목)은 어디에도 남기지 않아요 (원장님 "파일 제목은 안 나오고").
GitHub Action interview-videos.yml 이 돌려요 (이 클라우드 환경에선 드라이브가 막혀 있어서).
"""
import json
import os
import subprocess
import sys
import tempfile
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIST = os.path.join(REPO, "data", "interview_videos.json")
OUT = os.path.join(REPO, "assets", "interviews")
MAX_MB = 45  # GitHub 파일 한 개 50MB 경고 아래로


def download(drive_id, path):
    url = "https://drive.usercontent.google.com/download?id=" + drive_id + "&export=download&confirm=t"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (homepage video copy)"})
    with urllib.request.urlopen(req, timeout=300) as r, open(path, "wb") as f:
        kind = r.headers.get("Content-Type", "")
        if "text/html" in kind:
            raise RuntimeError("드라이브가 영상 대신 안내 화면을 보냈어요 (공유 설정 확인)")
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)


def probe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=width,height:stream_tags=rotate:format=duration", "-of", "json", path],
                         check=True, capture_output=True, text=True).stdout
    d = json.loads(out)
    s = d["streams"][0]
    return int(s["width"]), int(s["height"]), float(d["format"].get("duration") or 0)


def encode(src, dst, crf):
    scale = "scale='if(gte(iw,ih),min(1280,iw),-2)':'if(gte(iw,ih),-2,min(1280,ih))'"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", src, "-vf", scale + ",fps=30", "-c:v", "libx264",
                    "-preset", "slow", "-crf", str(crf), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k",
                    "-ac", "2", "-movflags", "+faststart", "-map_metadata", "-1", dst], check=True)


def main():
    data = json.load(open(LIST, encoding="utf-8"))
    os.makedirs(OUT, exist_ok=True)
    changed = False
    for v in data["videos"]:
        key = v["key"]
        mp4, jpg = os.path.join(OUT, key + ".mp4"), os.path.join(OUT, key + ".jpg")
        if v.get("file") and os.path.exists(os.path.join(REPO, v["file"])):
            continue
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "src")
            print("받는 중", key, flush=True)
            download(v["drive"], src)
            for crf in (26, 29, 32):
                encode(src, mp4, crf)
                if os.path.getsize(mp4) < MAX_MB * 1024 * 1024:
                    break
            w, h, sec = probe(mp4)
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", str(min(1.5, sec / 3)), "-i", mp4, "-frames:v", "1",
                            "-vf", "scale='if(gte(iw,ih),min(720,iw),-2)':'if(gte(iw,ih),-2,min(720,ih))'",
                            "-q:v", "4", jpg], check=True)
        v.update({"file": "assets/interviews/" + key + ".mp4", "poster": "assets/interviews/" + key + ".jpg",
                  "w": w, "h": h, "sec": round(sec)})
        changed = True
        print("끝", key, w, h, round(sec), "초", round(os.path.getsize(mp4) / 1e6, 1), "MB", flush=True)
    if changed:
        with open(LIST, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
            f.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
