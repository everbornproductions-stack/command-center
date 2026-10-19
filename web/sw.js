// Offline shell for the browser / phone (PWA): static files cached, API always live. The server
// stamps the app version into CACHE, so each release gets its own cache and old caches are deleted.
// v0.3.2 reload-loop guard: a new worker does NOT take over on its own (no skipWaiting at install);
// it waits until the page asks with {type:"SKIP_WAITING"} after the person clicks Refresh. The
// desktop app does not use a service worker at all (app.js unregisters it there).
const CACHE = "cc-shell-__CC_VERSION__";
const SHELL = ["/styles.css", "/app.js", "/graph.js", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];
self.addEventListener("install", (e) => {
  // never precache the HTML: it carries a per-launch session token, a cached copy would be stale
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).catch(() => {}));
});
self.addEventListener("message", (e) => { if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("cc-shell-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname === "/ws") return;
  // HTML / navigations always come from the network (fresh token); offline falls back to the cached shell files only
  if (e.request.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith(".html")) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; }).catch(() => caches.match(e.request)));
});
