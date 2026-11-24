// オフラインでも直近の画面を表示する Service Worker（通信優先、失敗時に保存済みを返す）。
const CACHE = "famcal-v2";
const CORE = ["./", "./index.html", "./styles.css", "./app.js", "./sync.js", "./ocr.js", "./config.js",
  "./manifest.webmanifest", "./icon.svg", "./icon-180.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("famcal-") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(async () => (await caches.match(e.request, { ignoreSearch: true }))
    || (e.request.mode === "navigate" ? caches.match("./index.html") : Response.error())));
});
