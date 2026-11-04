// node tools/test_lesson_sync.js — tools/lesson_sync.gs의 날짜 읽기 · 시트 → 표 바꾸기 시험 (구글 없이)
const fs = require("fs"), path = require("path"), vm = require("vm");
const ctx = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "lesson_sync.gs"), "utf8"), ctx);
const L = ctx.module.exports;
let bad = 0;
function eq(a, b, what) { if (JSON.stringify(a) !== JSON.stringify(b)) { bad++; console.log("✗", what, "→", JSON.stringify(a), "기대", JSON.stringify(b)); } }
const T = "2026-11-03";
const dates = {
  "2026-10-27(1회차)": "2026-10-27", "2026-04-15(3회차/당결)": "2026-04-15", "2025 3-24 ": "2025-03-24", "2025-421 월": "2025-04-21",
  "2025 6/2 월": "2025-06-02", "2026-1- 5 월": "2026-01-05", "2025-10- 13 월": "2025-10-13", "2025-11-10- 월": "2025-11-10",
  "2026-9-4 금 (보강)3": "2026-09-04", "2026-10-20 화 (2) x": "2026-10-20", "2026-11-3 화 (3) x": "2026-11-03",
  "2026-06-13 (2회차)/ 달라달라": "2026-06-13", "2026-09-08 (1회차) driver": "2026-09-08", "2026-11-1 일 (3회차)": "2026-11-01",
  "2026-3-16 월 +리스트+자기소개 정리": "2026-03-16", "2025 4-28 월x": "2025-04-28", "2026-2- 23 월": "2026-02-23",
  "2027-7-21 화 (4)": "2026-07-21", "2026-9-23 목 (4)": "2026-09-23", "2025-3-4 수": "2025-03-04", "2026-10-13 화 (1)": "2026-10-13", "2026-9-28월 (3)": "2026-09-28", "2026-7-6 월 ": "2026-07-06",
  "10/27": "2026-10-27", "12/30 (1회차)": "2025-12-30", "10월 13일": "2026-10-13",
  "OT": null, "발성": null, "아틀란티스 소녀 /  Pretty girl": null, "Curtain call": null, "알림장 📋": null, "학생 이름": null,
  "1.기다리다-윤하": null, "i do me": null, "2026-02-30": null, "오디션 곡 ": null,
};
for (const [t, want] of Object.entries(dates)) eq(L.tabDate_(t, T), want, "날짜 " + t);
const C = (txt, tf, extra) => Object.assign({ formattedValue: txt, effectiveFormat: { backgroundColor: { red: 1, green: 1, blue: 1 }, textFormat: Object.assign({ fontFamily: "Arial", fontSize: 10, foregroundColor: {}, foregroundColorStyle: { rgbColor: {} }, bold: false, italic: false, underline: false, strikethrough: false }, tf || {}) } }, extra || {});
const grid = {
  columnMetadata: [{ pixelSize: 100 }, { pixelSize: 100 }, { pixelSize: 240 }],
  rowMetadata: [{ pixelSize: 21 }, { pixelSize: 21 }, { pixelSize: 40 }],
  rowData: [
    { values: [C(""), C(""), C("*노래 피드백", { fontSize: 22, bold: true })] },
    { values: [C(""), { formattedValue: undefined, effectiveFormat: { backgroundColor: { red: 1, green: 0.9, blue: 0 } } }, C("피치 <연습> & 호흡\n다음 줄", { foregroundColorStyle: { rgbColor: { red: 1 } } })] },
    { values: [C(""), C("줄바꿈 칸", {}, { effectiveFormat: { wrapStrategy: "WRAP", textFormat: { fontSize: 10 } } }), C("빨간 글씨 일부", {}, { textFormatRuns: [{ format: {} }, { startIndex: 3, format: { foregroundColorStyle: { rgbColor: { red: 1 } }, bold: true } }, { startIndex: 5, format: {} }] })] },
  ],
};
const sh = L.toSheet_(grid);
eq(sh.c["0,2"], { t: "*노래 피드백", s: { b: 1, z: 29 } }, "큰 굵은 글씨");
eq(sh.c["1,1"], { s: { g: "#ffe600" } }, "빈 칸 채우기 색");
eq(sh.c["1,2"], { t: "피치 &lt;연습&gt; &amp; 호흡<br>다음 줄", s: { f: "#ff0000" } }, "글자색 · 특수문자 · 줄바꿈");
eq(sh.c["2,2"].t, '빨간 <span style="color:#ff0000;font-weight:bold">글씨</span> 일부', "글자 일부 서식");
eq(sh.c["2,1"], { t: "줄바꿈 칸", s: { wr: 1 } }, "칸 안 줄바꿈");
eq(sh.w, { 2: 240 }, "열 너비"); eq(sh.h, { 2: 40 }, "줄 높이"); eq(sh.n, 100, "줄 수");
eq(L.toSheet_({ rowData: [{ values: [C("")] }] }), null, "빈 탭");
fs.writeFileSync(process.argv[2] || "/dev/null", JSON.stringify(sh));
console.log(bad ? bad + "개 틀림" : "모두 맞음 (" + Object.keys(dates).length + "개 날짜 + 표 바꾸기)");
process.exit(bad ? 1 : 0);
