// オフラインでも直近のデータを表示するための Service Worker。
// データと画面は通信を優先し、失敗したときだけ保存済みの内容を返します。
const CACHE = "samurai-watch-v3";
const CORE = [
  "./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest",
  "./assets/favicon.svg", "./assets/hero.webp", "./assets/editorial.webp",
  "./assets/icon-192.png", "./assets/icon-512.png", "./assets/apple-touch-icon.png",
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.includes("/__local/")) return;
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        if (request.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      }),
  );
});
