/* 홈 화면 앱 (원장님 2026-11-25): 안드로이드 크롬이 "앱 설치" 버튼을 보여 주려면 필요한 작은 파일.
   아무것도 저장(캐시)하지 않음 — 늘 인터넷에서 새로 받고, 인터넷이 끊겼을 때만 안내 한 장을 보여 줌. */
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", function (e) {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(function () {
    return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<title>이송희보컬레슨</title><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;'
      + 'background:#1D4948;color:#fff;font-family:sans-serif;text-align:center;padding:24px;box-sizing:border-box">'
      + '<div><p style="font-size:20px;font-weight:700">인터넷 연결이 끊겼어요</p><p>연결된 뒤 다시 열어 주세요.</p>'
      + '<p><button onclick="location.reload()" style="font-size:16px;padding:10px 18px;border-radius:99px;border:0">다시 시도</button></p></div>',
      { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }));
});
