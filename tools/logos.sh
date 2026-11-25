#!/bin/bash
# 기획사 로고 PNG → assets/img/logos/<이름>.webp (여백 자르기 · 높이 최대 120px · 넓이 최대 360px)
#   bash tools/logos.sh <받은 PNG 폴더>   (원본 = 원장님 드라이브 "홈페이지 로고" 폴더, 파일 이름 = 회사 이름)
# 파일 이름 → 영어 이름은 아래 표. 새 로고는 표에 한 줄 + tools/blog_content.py LOGOS에 한 줄.
set -e
SRC="$1"; OUT="$(dirname "$0")/../assets/img/logos"; mkdir -p "$OUT"
while IFS='|' read -r name slug; do
  [ -z "$name" ] && continue
  f="$SRC/$name.png"; [ -f "$f" ] || { echo "없음: $name"; continue; }
  convert "$f" -background none -alpha on -fuzz 6% -trim +repage -resize '360x120>' -quality 90 -define webp:alpha-quality=100 "$OUT/$slug.webp"
done <<'MAP'
NEWKiT STUDIO|newkit
쏘스뮤직|sourcemusic
웨이크원|wakeone
위에화엔터테인먼트|yuehua
모드하우스|modhaus
하이햇|hihat
플레디스|pledis
하이업엔터테인먼트|highup
피네이션|pnation
젤리피쉬엔터테인먼트|jellyfish
판타지오|fantagio
어트랙트|attrakt
타이탄콘텐츠|titan
인코드(INKODE)|inkode
이닛엔터테인먼트|init
카카오엔터테인먼트|kakaoent
어비스컴퍼니|abyss
티오피미디어|topmedia
큐브엔터테인먼트|cube
어도어|ador
안테나|antenna
더블랙레이블|theblacklabel
F&F엔터테인먼트|fnf
디네이션엔터테인먼트|dnation
빅히트 뮤직|bighit
모어비전|morevision
빌리프랩|belift
FNC엔터테인먼트|fnc
더라이브레이블|thelivelabel
ATRP|atrp
KOZ엔터테인먼트|koz
쇼파르엔터테인먼트|shofar
MNH엔터테인먼트|mnh
IST엔터테인먼트|ist
S2엔터테인먼트|s2
MAP
ls "$OUT" | wc -l
