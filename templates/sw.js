const CACHE = "chatroom-{{ ASSET_V }}-r5"; // bump the suffix to force every phone to drop old cached files
const MEDIA_CACHE = "chatroom-media-r1";    // user media lives apart so it can be trimmed without touching the app shell
const MEDIA_MAX = 80;                       // keep at most this many media files offline
const NET_TIMEOUT = 4000;                   // ms to wait for the network before falling back to cache (flaky mobile data)
const V = "?v={{ ASSET_V }}";
const SHELL = ["style.css", "extra.css", "themes.css", "ui-pro.css", "auth.css", "luxe.css", "luxe.js", "attach.css", "chat-nav.css", "stories.css",
  "theme.js", "i18n-data.js", "i18n.js", "pwa.js", "auth.js", "chat.js", "chat-plus.js", "chat-bg.js", "chat-nav.js", "stories.js"]
  .map(f => "/static/" + f + V).concat(["/offline"]);
const CDN = ["fonts.googleapis.com", "fonts.gstatic.com", "cdn.socket.io", "cdn.jsdelivr.net", "cdnjs.cloudflare.com"];

const OFFLINE_FALLBACK = () => new Response(
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<body style="font-family:sans-serif;text-align:center;padding:48px" dir="rtl"><h2>آفلاین هستی</h2><p>اتصال اینترنت را بررسی کن و دوباره تلاش کن.</p></body>',
  {status: 503, headers: {"Content-Type": "text/html; charset=utf-8"}});

// only complete, same-origin-safe responses can be stored (cache.put rejects 206 partials and throws on opaque errors)
const cacheable = r => r && (r.status === 200 || r.type === "opaque");

const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("timeout")), ms);
  promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
});

async function trim(name, max) {
  const c = await caches.open(name), keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]); // oldest first
}

self.addEventListener("install", e => {
  // one missing file must not abort the whole install (addAll is all-or-nothing)
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keep = [CACHE, MEDIA_CACHE];
    await Promise.all((await caches.keys()).filter(k => !keep.includes(k)).map(k => caches.delete(k)));
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.enable(); } catch (_) {} }
    await self.clients.claim();
  })());
});

// lets pwa.js do:  reg.waiting.postMessage("SKIP_WAITING")  to apply an update immediately
self.addEventListener("message", e => { if (e.data === "SKIP_WAITING" || (e.data && e.data.type === "SKIP_WAITING")) self.skipWaiting(); });

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.pathname.startsWith("/socket.io") || url.pathname.startsWith("/api")) return;
  if (req.headers.has("range")) return;   // audio/video seeking: let the browser talk to the server directly

  if (req.mode === "navigate") {  // pages: always live, offline fallback only
    e.respondWith((async () => {
      try {
        const pre = await e.preloadResponse;
        return pre || await fetch(req);
      } catch (_) {
        return (await caches.match("/offline")) || OFFLINE_FALLBACK();
      }
    })());
    return;
  }

  const sameOrigin = url.origin === location.origin;
  const isMedia = sameOrigin && url.pathname.startsWith("/media/");
  const isStatic = sameOrigin && url.pathname.startsWith("/static/");

  if (isStatic || isMedia) {  // our own css/js/media: network-first, so a bad or old cached file can never stick again
    const store = isMedia ? MEDIA_CACHE : CACHE;
    e.respondWith((async () => {
      try {
        const r = await withTimeout(fetch(req), NET_TIMEOUT);
        if (cacheable(r) && r.ok) {
          const cp = r.clone();
          e.waitUntil(caches.open(store).then(c => c.put(req, cp)).then(() => isMedia ? trim(MEDIA_CACHE, MEDIA_MAX) : null).catch(() => {}));
        }
        return r;
      } catch (_) {
        const hit = await caches.match(req);
        if (hit) return hit;
        return Response.error();
      }
    })());
    return;
  }

  if (CDN.includes(url.hostname)) {  // third-party fonts/libs: stale-while-revalidate
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (cacheable(r)) c.put(req, r.clone()).catch(() => {}); return r; }).catch(() => hit || Response.error());
      if (hit) { e.waitUntil(net); return hit; }
      return net;
    }));
  }
});
