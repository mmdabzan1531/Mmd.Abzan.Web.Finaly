const CACHE = "chatroom-{{ ASSET_V }}";
const V = "?v={{ ASSET_V }}";
const SHELL = ["style.css", "extra.css", "themes.css", "auth.css", "attach.css", "chat-nav.css", "stories.css",
  "theme.js", "i18n-data.js", "i18n.js", "pwa.js", "auth.js", "chat.js", "chat-plus.js", "chat-bg.js", "chat-nav.js", "stories.js"]
  .map(f => "/static/" + f + V).concat(["/offline"]);
const CDN = ["fonts.googleapis.com", "fonts.gstatic.com", "cdn.socket.io", "cdn.jsdelivr.net", "cdnjs.cloudflare.com"];
self.addEventListener("install", e => {
  // one missing file must not abort the whole install (addAll is all-or-nothing)
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.pathname.startsWith("/socket.io") || url.pathname.startsWith("/api")) return;
  if (req.mode === "navigate") {  // pages: always live, offline fallback only
    e.respondWith(fetch(req).catch(() => caches.match("/offline")));
    return;
  }
  const same = url.origin === location.origin && (url.pathname.startsWith("/static/") || url.pathname.startsWith("/media/"));
  if (same || CDN.includes(url.hostname)) {  // assets: stale-while-revalidate
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r && (r.ok || r.type === "opaque")) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
  }
});
