/* 曙光教育 PWA Service Worker */
const CACHE = "dawn-edu-v3";
const CORE = [
  "/desktop.html",
  "/mobile.html",
  "/manifest.webmanifest",
  "/assets/css/base.css",
  "/assets/css/pages/home.css",
  "/assets/js/pages/home.js",
  "/assets/js/core/api.js",
  "/assets/js/core/auth.js",
  "/assets/js/core/a11y.js",
  "/assets/js/core/config.js",
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  // 只處理同源 GET
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // API 不走快取（永遠要最新）
  if (url.pathname.startsWith("/api/")) return;
  e.respondWith(
    caches.match(e.request).then(hit => {
      // 有快取先回，同時背景更新
      const net = fetch(e.request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
