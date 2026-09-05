/* Network-first for HTML/JS so buy-path fixes ship; cache as fallback offline */
const CACHE = "gnomemepad-v11-trades-lp-pnl";
const PRECACHE = ["/manifest.webmanifest", "/icon.svg", "/favicon.svg"];

self.addEventListener("install", (e) => {
  // Activate immediately so Buy path fixes ship without a second reload
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener("message", (e) => {
  if (e?.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  // Always network for API / functions
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/.netlify/")) {
    return;
  }

  // Network-first for navigations + JS/CSS (critical app shell — never stick on old buy path)
  const isNav = e.request.mode === "navigate";
  const isAsset =
    url.pathname.startsWith("/assets/") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname === "/" ||
    url.pathname.endsWith(".html");

  if (isNav || isAsset) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res && res.ok && url.origin === self.location.origin) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request)),
    );
    return;
  }

  // Other static: cache-first
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        if (res && res.ok && url.origin === self.location.origin) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      });
    }),
  );
});
