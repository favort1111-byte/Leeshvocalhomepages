# 작업 규칙 (Claude용)

## 미리보기 아티팩트 — 모든 변경마다 올리기
원장님은 배포 전에 혼자 아티팩트로 보면서 작업합니다. **요청받은 변경은 하나도 빠짐없이 아티팩트에 반영해서 올립니다.**

- 작업 현황 아티팩트: https://claude.ai/artifact/CE3wYoVrkMxH1DbmjR5cpS (비공개, "이송희보컬레슨 작업 현황")
- 올리는 순서:
  1. `python3 tools/build_pages.py` (페이지를 고쳤다면)
  2. `python3 tools/build_preview.py <스크래치 폴더>/preview` — 체험 모드 사본 (js/demo.js, 가짜 데이터)
  3. Artifact 도구로 `preview/index.html` 게시, `url`은 위 주소, `root`는 preview 폴더, `files`에 나머지 파일 전부
     (다른 html 5개, css/*, js/*, assets/img/*)
- 예전 레트로 시안 아티팩트(VLT52RjsQ56ofw8tPRwCiA)는 구버전이라 여기엔 쓰지 않습니다.
- 올린 뒤 링크를 알려주고 "새로고침하면 보여요"라고 말합니다.

## 배포·병합
- 지금은 운영 전입니다. 필요한 메뉴를 다 짠 뒤에 Supabase 연결 → 테스트 → 배포 순서로 갑니다.
- main 병합은 원장님이 말할 때만 합니다.
- 수강료 내용은 넣지 않습니다.

## 보관 자료
- `docs/menu-ideas.md`: 메뉴 아이디어 원본 기록 (GPT 기본표·특색 5개·해외 조사 5개, Claude 아이디어). **메뉴 구성을 논의할 때 먼저 꺼내서 보여줍니다.**
- 메뉴 아이디어 보드 아티팩트: https://claude.ai/artifact/XHhi3x4pqGu8mRmwUb2B3G (원본 `docs/menu-ideas.html`). 아이디어가 추가되면 md와 이 보드를 같이 고쳐서 다시 올립니다.

## 말투
- 설명은 이해하기 쉽고 간단하게, 한국어로.
