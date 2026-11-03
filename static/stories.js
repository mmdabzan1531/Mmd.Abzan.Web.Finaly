/* Chatroom stories: gallery-first composer (photo + text with themed / gallery backgrounds), viewer, profile grid.
   Replaces the old stories.js. Exposes window.CRStories {open, compose, openPremium, renderPosts, refresh}. */
(function () {
  "use strict";
  function boot() { if (window.CRChat) init(); else window.addEventListener("cr:ready", init, {once: true}); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  function init() {
    const C = window.CRChat, cfg = C.cfg, esc = C.esc, t = C.t || (x => x), toast = C.toast;
    const LOC = window.CR_LANG === "fa" ? "fa-IR" : (window.CR_LANG || "en");
    const BGS = Array.from({length: 12}, (_, i) => "g" + (i + 1));
    const DUR = [[6, false], [12, false], [24, false], [48, true], [72, true]];
    const IC = {
      x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
      img: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M4 18l5-5 4 4 3-3 4 4"/></svg>',
      eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
      trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>'
    };
    const isPrem = () => !!(cfg.me && cfg.me.premium);
    const me = () => (cfg && cfg.username) || "";
    let cache = [];

    async function load() {
      try { const r = await fetch("/api/stories", {credentials: "same-origin"}); const d = await r.json(); if (r.ok && d.ok) cache = d.groups || []; } catch (_) {}
      return cache;
    }
    const changed = () => { load(); window.dispatchEvent(new Event("cr:stories-changed")); };
    const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
    const hhmm = ts => new Date(ts * 1000).toLocaleTimeString(LOC, {hour: "2-digit", minute: "2-digit"});

    /* ---------- dialog (always above the viewer / composer) ---------- */
    function dlg(title, body, actions, sheet) {
      const w = el("div", "st-dlg" + (sheet ? " sheet" : "")), c = el("div", "st-card");
      c.appendChild(el("h3", "", esc(t(title)))); if (body) c.appendChild(body);
      const a = el("div", "st-acts");
      (actions || [{label: "بستن"}]).forEach(x => { const b = el("button", x.cls || "", esc(t(x.label))); b.type = "button"; b.onclick = () => { w.remove(); x.fn && x.fn(); }; a.appendChild(b); });
      c.appendChild(a); w.appendChild(c); w.addEventListener("click", e => { if (e.target === w) w.remove(); }); document.body.appendChild(w); return w;
    }
    function openPremium() {
      const b = el("div"); b.innerHTML = '<div class="st-star">⭐</div><p>' + esc(t("نمایش ۴۸ و ۷۲ ساعته فقط برای کاربران پریمیوم است.")) + "\n" + esc(t("برای فعال‌سازی پریمیوم با پشتیبانی در ارتباط باش.")) + "</p>";
      dlg("پریمیوم", b, [{label: "پشتیبانی", cls: "hot", fn: () => { location.href = "/support#support"; }}, {label: "بستن"}]);
    }

    /* ---------- viewer ---------- */
    function open(a, b) {
      let g = b && b.stories ? b : (a && a.stories ? a : cache.find(x => x.user.username === a));
      if (!g || !g.stories.length) return;
      viewer(g, true);
    }
    function viewer(g, chain, startAt) {
      document.querySelectorAll(".st-ov.st-viewer").forEach(n => n._stop && n._stop());
      const ov = el("div", "st-ov st-viewer"), mine = g.user.username === me();
      let curVid = null, i = typeof startAt === "number" ? startAt : Math.max(0, g.stories.findIndex(s => !s.viewed && !mine)), elapsed = 0, dur = 5000, paused = false, loading = false, timer = 0, down = 0, panel = false;
      const stop = () => { clearInterval(timer); if (curVid) curVid.pause(); ov.remove(); };
      ov._stop = stop;
      const close = () => { stop(); changed(); };
      function nextGroup() {
        stop();
        if (chain) { const k = cache.findIndex(x => x.user.username === g.user.username), n = cache[k + 1]; if (n && n.stories.length) return viewer(n, true); }
        changed();
      }
      function show() {
        const s = g.stories[i]; elapsed = 0; dur = s.kind === "text" ? 6000 : 5000; curVid = null;
        ov.innerHTML = "";
        const v = el("div", "st-view"); ov.appendChild(v);
        const bars = el("div", "st-bars"); g.stories.forEach((_, k) => bars.appendChild(el("i", k < i ? "done" : "", "<b></b>"))); v.appendChild(bars);
        const body = el("div", "st-body" + (s.kind === "text" ? " st-" + (s.bg || "g1") : "")); v.appendChild(body);
        if (s.kind === "text") body.appendChild(el("div", "st-txt", "<span>" + esc(s.text || "") + "</span>"));
        else if (s.kind === "video") {
          loading = true; const vd = document.createElement("video"); vd.playsInline = true; vd.autoplay = true; vd.preload = "auto"; vd.src = s.media_url; curVid = vd;
          vd.onloadedmetadata = () => { if (isFinite(vd.duration)) dur = Math.min(Math.max(vd.duration * 1000, 2000), 60000); loading = false; };
          vd.onerror = () => { loading = false; }; vd.onended = () => { elapsed = dur; };
          body.appendChild(vd); vd.play().catch(() => { vd.muted = true; vd.play().catch(() => {}); });
        }
        else { loading = true; const im = new Image(); im.alt = ""; im.onload = im.onerror = () => { loading = false; }; im.src = s.media_url; body.appendChild(im); }
        if (s.caption) v.appendChild(el("div", "st-cap", esc(s.caption)));
        const top = el("div", "st-top", '<span class="avatar">' + C.avatarHtml(g.user) + '</span><span class="who"><strong data-no-i18n>' + esc(g.user.display_name || g.user.username) + "</strong><small>" + hhmm(s.created_at) + "</small></span>");
        const x = el("button", "st-ico", IC.x); x.type = "button"; x.setAttribute("aria-label", t("بستن")); x.onclick = close; top.appendChild(x); v.appendChild(top);
        const hit = el("div", "st-hit"); const zl = el("div"), zr = el("div"); hit.append(zl, zr); v.appendChild(hit);
        const rtl = getComputedStyle(document.documentElement).direction === "rtl";
        hit.addEventListener("pointerdown", () => { paused = true; down = Date.now(); });
        const up = e => {
          paused = false; if (e.type !== "pointerup" || Date.now() - down > 250) return;
          const r = hit.getBoundingClientRect(), f = (e.clientX - r.left) / r.width, prev = rtl ? f > 0.65 : f < 0.35;
          prev ? back() : next();
        };
        hit.addEventListener("pointerup", up); hit.addEventListener("pointerleave", up); hit.addEventListener("pointercancel", up);
        if (mine) {
          const own = el("div", "st-own");
          const eye = el("button", "st-eye", IC.eye + "<span>" + (s.views_count || 0).toLocaleString(LOC) + "</span>"); eye.type = "button"; eye.onclick = () => showViews(s);
          const del = el("button", "st-ico", IC.trash); del.type = "button"; del.setAttribute("aria-label", t("حذف")); del.onclick = () => remove(s);
          own.append(eye, del); v.appendChild(own);
        } else if (!s.viewed) { s.viewed = true; fetch("/api/stories/" + encodeURIComponent(s.id) + "/view", {method: "POST", credentials: "same-origin"}).catch(() => {}); }
        v._bars = bars;
      }
      function tick() {
        if (curVid) { const hold = paused || panel; if (hold && !curVid.paused) curVid.pause(); else if (!hold && curVid.paused && !loading && !curVid.ended) curVid.play().catch(() => {}); }
        if (paused || loading || panel) return;
        elapsed += 40; const b = ov.querySelector(".st-bars i:nth-child(" + (i + 1) + ") b"); if (b) b.style.width = Math.min(100, elapsed / dur * 100) + "%";
        if (elapsed >= dur) next();
      }
      function next() { if (i < g.stories.length - 1) { i++; show(); } else { g.unseen = false; nextGroup(); } }
      function back() { if (i > 0) { i--; show(); } else show(); }
      async function showViews(s) {
        panel = true; const body = el("div"); body.innerHTML = '<p class="st-empty">…</p>';
        const w = dlg("بازدیدکنندگان", body, [{label: "بستن", fn: () => { panel = false; }}], true);
        try {
          const r = await fetch("/api/stories/" + encodeURIComponent(s.id) + "/views", {credentials: "same-origin"}), d = await r.json();
          body.innerHTML = ""; if (!d.views || !d.views.length) body.innerHTML = '<p class="st-empty">' + esc(t("هنوز کسی ندیده است.")) + "</p>";
          (d.views || []).forEach(x => body.appendChild(el("div", "st-vrow", '<span class="avatar">' + C.avatarHtml(x.user) + '</span><span data-no-i18n>' + esc(x.user.display_name || x.user.username) + "</span><small>" + hhmm(x.at) + "</small>")));
        } catch (_) { body.innerHTML = '<p class="st-empty">' + esc(t("خطا در دریافت.")) + "</p>"; }
        w.addEventListener("click", e => { if (e.target === w) panel = false; });
      }
      async function remove(s) {
        if (!confirm(t("این استوری حذف شود؟"))) return;
        try { const r = await fetch("/api/stories/" + encodeURIComponent(s.id), {method: "DELETE", credentials: "same-origin"}); if (!r.ok) throw 0; } catch (_) { return toast(t("حذف انجام نشد.")); }
        g.stories.splice(i, 1); changed();
        if (!g.stories.length) return stop();
        if (i >= g.stories.length) i = g.stories.length - 1; show();
      }
      document.body.appendChild(ov); show(); timer = setInterval(tick, 40);
      ov.tabIndex = -1; ov.addEventListener("keydown", e => { if (e.key === "Escape") close(); }); ov.focus();
    }

    /* ---------- composer: opens the gallery first; cancelling the picker opens the text page ---------- */
    function pickImage(onFile, onCancel, accept) {
      const inp = el("input"); inp.type = "file"; inp.accept = accept || "image/*"; inp.style.display = "none"; document.body.appendChild(inp);
      let done = false; const fin = () => setTimeout(() => inp.remove(), 1500);
      inp.addEventListener("change", () => { if (done) return; done = true; const f = inp.files && inp.files[0]; f ? onFile(f) : onCancel && onCancel(); fin(); });
      inp.addEventListener("cancel", () => { if (done) return; done = true; onCancel && onCancel(); fin(); });
      window.addEventListener("focus", () => setTimeout(() => { if (!done && !(inp.files && inp.files.length)) { done = true; onCancel && onCancel(); fin(); } }, 1200), {once: true});
      inp.click();
    }
    const MEDIA = "image/*,video/*", isVid = f => !!f && (/^video\//.test(f.type) || /\.(mp4|m4v|webm|mov)$/i.test(f.name || ""));
    const MAX_VID = 14.5 * 1024 * 1024;
    function compose() { pickImage(f => composer({file: f}), () => composer({mode: "text"}), MEDIA); }

    const loadImg = f => new Promise((res, rej) => { const u = URL.createObjectURL(f), im = new Image(); im.onload = () => { URL.revokeObjectURL(u); res(im); }; im.onerror = rej; im.src = u; });
    const toBlob = (cv, q) => new Promise(r => cv.toBlob(r, "image/jpeg", q));
    async function shrink(cv) { let q = 0.9, b = await toBlob(cv, q); while (b && b.size > 3.8 * 1024 * 1024 && q > 0.4) { q -= 0.15; b = await toBlob(cv, q); } return b; }
    async function prep(f) {
      if (f.size <= 3.8 * 1024 * 1024 && /^image\/(png|jpe?g|webp|gif)$/.test(f.type)) return f;
      const im = await loadImg(f), k = Math.min(1, 1920 / Math.max(im.width, im.height)), cv = document.createElement("canvas");
      cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k); cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height); return shrink(cv);
    }
    async function textOnImage(text, bgFile) {
      const W = 1080, H = 1920, cv = document.createElement("canvas"); cv.width = W; cv.height = H; const x = cv.getContext("2d"), im = await loadImg(bgFile);
      const k = Math.max(W / im.width, H / im.height), w = im.width * k, h = im.height * k; x.drawImage(im, (W - w) / 2, (H - h) / 2, w, h);
      x.fillStyle = "rgba(0,0,0,.35)"; x.fillRect(0, 0, W, H);
      x.font = "800 74px " + (getComputedStyle(document.body).fontFamily || "sans-serif"); x.fillStyle = "#fff"; x.textAlign = "center"; x.textBaseline = "middle";
      if (/[\u0600-\u06FF]/.test(text)) x.direction = "rtl";
      const lines = []; text.split("\n").forEach(par => { let cur = ""; par.split(/\s+/).forEach(wd => { const tr = cur ? cur + " " + wd : wd; if (x.measureText(tr).width > 900 && cur) { lines.push(cur); cur = wd; } else cur = tr; }); lines.push(cur); });
      const lh = 118, y0 = H / 2 - (lines.length - 1) * lh / 2; x.shadowColor = "rgba(0,0,0,.45)"; x.shadowBlur = 12; lines.forEach((l, n) => x.fillText(l, W / 2, y0 + n * lh));
      return shrink(cv);
    }

    function upload(fd, onp) {
      return new Promise(res => {
        const x = new XMLHttpRequest(); x.open("POST", "/api/stories"); x.withCredentials = true;
        x.upload.onprogress = e => { if (e.lengthComputable) onp(e.loaded / e.total); };
        x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch (_) {} res({status: x.status, ok: x.status >= 200 && x.status < 300, d}); };
        x.onerror = x.ontimeout = () => res({status: 0, ok: false, d: {}});
        x.send(fd);
      });
    }
    function composer(init0) {
      const S = {mode: init0.mode || (init0.file ? "photo" : "text"), file: init0.file || null, bg: "g1", bgFile: null, dur: 24, aud: "everyone"};
      let urls = [];
      const url = f => { const u = URL.createObjectURL(f); urls.push(u); return u; };
      const ov = el("div", "st-ov st-comp"); document.body.appendChild(ov);
      const closeAll = () => { urls.forEach(URL.revokeObjectURL); ov.remove(); };
      const top = el("div", "st-ctop"), cls = el("button", "st-ico", IC.x); cls.type = "button"; cls.onclick = closeAll; cls.setAttribute("aria-label", t("بستن"));
      const tabs = el("div", "st-tabs"), tP = el("button", "", esc(t("عکس / ویدیو"))), tT = el("button", "", esc(t("متن"))); tP.type = tT.type = "button"; tabs.append(tP, tT);
      top.append(cls, tabs, el("span", "st-ico", "")); top.lastChild.style.visibility = "hidden"; ov.appendChild(top);
      const wrap = el("div", "st-stage-wrap"), stage = el("div", "st-stage"); wrap.appendChild(stage); ov.appendChild(wrap);
      const bot = el("div", "st-cbot"), pal = el("div", "st-pal"), opts = el("div", "st-opts"), send = el("div", "st-send"); bot.append(pal, opts, send); ov.appendChild(bot);
      const post = el("button", "st-post", esc(t("انتشار"))); post.type = "button"; send.appendChild(post);
      let ta = null, capin = null, taVal = "", capVal = "";

      function drawStage() {
        if (ta) taVal = ta.value; if (capin) capVal = capin.value;
        stage.innerHTML = ""; stage.className = "st-stage"; stage.style.backgroundImage = "";
        if (S.mode === "photo") {
          if (S.file && isVid(S.file)) { const vd = el("video", "st-pic"); vd.src = url(S.file); vd.muted = true; vd.loop = true; vd.autoplay = true; vd.playsInline = true; vd.controls = true; stage.appendChild(vd); }
          else if (S.file) { const im = el("img", "st-pic"); im.src = url(S.file); im.alt = ""; stage.appendChild(im); }
          else stage.appendChild(el("div", "st-empty", esc(t("یک عکس یا ویدیو از گالری انتخاب کن"))));
          capin = el("input", "st-capin"); capin.placeholder = t("توضیح (اختیاری)"); capin.maxLength = 200; capin.value = capVal; stage.appendChild(capin); ta = null;
        } else {
          if (S.bgFile) { stage.classList.add("has-img"); stage.style.backgroundImage = "url(" + url(S.bgFile) + ")"; } else stage.classList.add("st-" + S.bg);
          ta = el("textarea"); ta.placeholder = t("چیزی بنویس…"); ta.maxLength = 300; ta.value = taVal; ta.dir = "auto"; stage.appendChild(ta); capin = null;
        }
      }
      function drawPal() {
        pal.innerHTML = "";
        if (S.mode === "photo") { const c = el("button", "st-chip", esc(t("تغییر فایل از گالری"))); c.type = "button"; c.onclick = () => pickImage(f => { S.file = f; drawStage(); }, null, MEDIA); pal.appendChild(c); return; }
        const gal = el("button", "st-sw gal" + (S.bgFile ? " on" : ""), IC.img); gal.type = "button"; gal.setAttribute("aria-label", t("پس‌زمینه از گالری"));
        gal.onclick = () => pickImage(f => { S.bgFile = f; drawStage(); drawPal(); }); pal.appendChild(gal);
        BGS.forEach(k => { const b = el("button", "st-sw st-" + k + (!S.bgFile && S.bg === k ? " on" : "")); b.type = "button"; b.onclick = () => { S.bg = k; S.bgFile = null; drawStage(); drawPal(); }; pal.appendChild(b); });
      }
      function drawOpts() {
        opts.innerHTML = "";
        DUR.forEach(([h, p]) => { const c = el("button", "st-chip" + (S.dur === h ? " on" : ""), (p ? "⭐ " : "") + h.toLocaleString(LOC) + " " + esc(t("ساعت"))); c.type = "button";
          c.onclick = () => { if (p && !isPrem()) return openPremium(); S.dur = h; drawOpts(); }; opts.appendChild(c); });
        const a = el("button", "st-chip", esc(t(S.aud === "contacts" ? "فقط مخاطبین" : "همه"))); a.type = "button"; a.onclick = () => { S.aud = S.aud === "contacts" ? "everyone" : "contacts"; drawOpts(); }; opts.appendChild(a);
      }
      function setMode(m) {
        if (m === "photo" && !S.file) { return pickImage(f => { S.file = f; S.mode = "photo"; refresh(); }, null, MEDIA); }
        S.mode = m; refresh();
      }
      function refresh() { tP.classList.toggle("on", S.mode === "photo"); tT.classList.toggle("on", S.mode === "text"); drawStage(); drawPal(); }
      tP.onclick = () => setMode("photo"); tT.onclick = () => setMode("text");

      post.onclick = async () => {
        if (ta) taVal = ta.value; if (capin) capVal = capin.value;
        const fd = new FormData(); fd.set("duration", S.dur); fd.set("audience", S.aud); fd.set("save_profile", "1");
        post.disabled = true;
        try {
          if (S.mode === "photo") {
            if (!S.file) { toast(t("یک عکس یا ویدیو انتخاب کن.")); post.disabled = false; return; }
            if (isVid(S.file)) {
              if (S.file.size > MAX_VID) { toast(t("حجم ویدیو باید کمتر از ۱۵ مگابایت باشد.")); post.disabled = false; return; }
              const ve = (/\.(mp4|m4v|webm|mov)$/i.exec(S.file.name || "") || [])[0] || (S.file.type === "video/webm" ? ".webm" : S.file.type === "video/quicktime" ? ".mov" : ".mp4");
              fd.set("kind", "video"); fd.set("image", S.file, "story" + ve.toLowerCase()); fd.set("caption", capVal.trim());
            } else {
            const b = await prep(S.file); fd.set("kind", "image"); fd.set("image", b, "story." + (b.type === "image/png" ? "png" : b.type === "image/webp" ? "webp" : b.type === "image/gif" ? "gif" : "jpg")); fd.set("caption", capVal.trim());
            }
          } else {
            const txt = taVal.trim(); if (!txt) { toast(t("متن استوری را بنویس.")); post.disabled = false; return; }
            if (S.bgFile) { const b = await textOnImage(txt, S.bgFile); fd.set("kind", "image"); fd.set("image", b, "story.jpg"); }
            else { fd.set("kind", "text"); fd.set("text", txt); fd.set("bg", S.bg); }
          }
          const label = t("در حال آپلود…");
          post.textContent = label;
          const res = await upload(fd, p => { const n = Math.round(p * 100); post.textContent = label + " " + n.toLocaleString(LOC) + "٪"; post.style.background = "linear-gradient(90deg,var(--aril,#3d9b6a) " + n + "%,rgba(255,255,255,.18) " + n + "%)"; });
          const d = res.d || {};
          if (res.status === 401) return void (location.href = "/");
          if (res.ok && d.ok) { closeAll(); toast(t("استوری منتشر شد و برای بقیه نمایش داده می‌شود.")); changed(); }
          else {
            if (d.code === "premium_required") openPremium(); else toast(d.error || (res.status === 413 ? t("حجم فایل زیاد است.") : t("آپلود انجام نشد؛ دوباره تلاش کن.")));
            post.disabled = false; post.style.background = ""; post.textContent = t("انتشار");
          }
        } catch (_) { toast(t("انتشار انجام نشد.")); post.disabled = false; post.style.background = ""; post.textContent = t("انتشار"); }
      };
      drawOpts(); refresh();
    }

    /* ---------- profile grid (posts / archived) ---------- */
    async function renderPosts(box, tab) {
      if (!box) return; box.innerHTML = '<div class="st-empty">…</div>';
      let list = [];
      try { const r = await fetch("/api/stories/mine", {credentials: "same-origin"}), d = await r.json(); if (r.ok && d.ok) list = d.stories || []; } catch (_) {}
      list = list.filter(s => tab === "archived" ? s.archived : (!s.archived && s.in_profile !== false));
      box.innerHTML = ""; if (!list.length) return void (box.innerHTML = '<div class="st-empty">' + esc(t(tab === "archived" ? "پست بایگانی‌شده‌ای نیست." : "هنوز پستی نیست.")) + "</div>");
      const grid = el("div", "st-grid"); box.appendChild(grid);
      list.forEach((s, n) => {
        const c = el("div", "st-cell" + (s.kind === "text" ? " st-" + (s.bg || "g1") : ""), s.kind === "text" ? "<span>" + esc((s.text || "").slice(0, 60)) + "</span>" : s.kind === "video" ? '<video src="' + esc(s.media_url) + '#t=0.1" muted playsinline preload="metadata"></video>' : '<img src="' + esc(s.media_url) + '" alt="" loading="lazy">');
        c.appendChild(el("em", "", "<span>" + hhmm(s.created_at) + "</span><span>👁 " + (s.views_count || 0).toLocaleString(LOC) + "</span>"));
        const a = el("button", "st-arch", tab === "archived" ? "↩" : "🗂"); a.type = "button"; a.title = t(tab === "archived" ? "بازگردانی" : "بایگانی");
        a.onclick = async e => { e.stopPropagation(); try { await fetch("/api/stories/" + encodeURIComponent(s.id) + "/archive", {method: "POST", credentials: "same-origin", headers: {"Content-Type": "application/json"}, body: JSON.stringify({archived: tab !== "archived"})}); } catch (_) {} renderPosts(box, tab); changed(); };
        c.appendChild(a); c.onclick = () => viewer({user: Object.assign({}, cfg.me || {}, {username: me()}), stories: list}, false, n); grid.appendChild(c);
      });
    }

    window.CRStories = {open, compose, add: compose, openViewer: open, openPremium, renderPosts, refresh: changed};
    load().then(() => window.dispatchEvent(new Event("cr:stories-changed")));
    window.addEventListener("cr:story-add", compose);
    if (C.socket && C.socket.on) C.socket.on("stories_changed", () => { load(); window.dispatchEvent(new Event("cr:stories-changed")); });
  }
})();
