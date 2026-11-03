/* Chatroom — Stories: bar above the chat list, composer (duration / audience / save to profile), viewer, profile "Posts" grid.
   24 h max for everyone (6/12/24 h); 48 h and 72 h are Premium. Needs window.CRChat. */
(function () {
  "use strict";
  function boot() { if (window.CRChat) init(); else window.addEventListener("cr:ready", init, {once: true}); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  function init() {
    const C = window.CRChat, cfg = C.cfg, esc = C.esc, t = C.t || (x => x), toast = C.toast, $ = id => document.getElementById(id);
    const side = $("sidebar"); if (!side || window.CRStories) return;
    const LOC = window.CR_LANG === "fa" ? "fa-IR" : undefined, nf = n => Number(n).toLocaleString(LOC);
    const BG = {g1: "linear-gradient(135deg,#ff6a88,#ff99ac)", g2: "linear-gradient(135deg,#4facfe,#00f2fe)", g3: "linear-gradient(135deg,#43e97b,#38f9d7)",
                g4: "linear-gradient(135deg,#a18cd1,#fbc2eb)", g5: "linear-gradient(135deg,#f6d365,#fda085)", g6: "linear-gradient(135deg,#232526,#414345)"};
    const HOURS = [6, 12, 24, 48, 72], FREE = [6, 12, 24];
    let me = Object.assign({}, cfg.me || {}), feed = [], mine = null;

    async function api(url, opts, quiet) {
      try {
        const r = await fetch(url, Object.assign({credentials: "same-origin"}, opts || {})), d = await r.json().catch(() => ({}));
        if (r.status === 401) { location.href = "/"; return null; }
        if (!r.ok) { if (!quiet) toast(d.error || "عملیات انجام نشد."); return Object.assign({_err: true}, d); }
        return d;
      } catch (_) { if (!quiet) toast("اتصال به سرور برقرار نشد. اینترنتت را بررسی کن."); return null; }
    }
    const ok = d => d && !d._err;
    const jpost = (url, body, method) => api(url, {method: method || "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body || {})});
    async function refreshMe() { const d = await api("/api/me/profile", null, true); if (ok(d)) { me = d.user; cfg.me = d.user; } return me; }
    const ago = ts => {
      const m = Math.max(0, Math.round((Date.now() / 1000 - ts) / 60));
      return m < 1 ? t("همین الان") : m < 60 ? nf(m) + " " + t("دقیقه پیش") : nf(Math.floor(m / 60)) + " " + t("ساعت پیش");
    };
    const left = ts => { const h = Math.max(0, (ts - Date.now() / 1000) / 3600); return h < 1 ? nf(Math.max(1, Math.round(h * 60))) + " " + t("دقیقه مانده") : nf(Math.ceil(h)) + " " + t("ساعت مانده"); };
    const hoursLabel = h => nf(h) + " " + t("ساعت");

    /* ---------- bar above the chat list ---------- */
    const bar = document.createElement("div"); bar.className = "st-bar"; bar.id = "stories-bar";
    const sb = side.querySelector(".searchbox"); if (sb) sb.insertAdjacentElement("afterend", bar); else side.prepend(bar);
    const avOf = u => C.avatarHtml(u || {});
    async function loadFeed() {
      const d = await api("/api/stories", null, true); if (!ok(d)) return;
      feed = d.groups || []; renderBar();
    }
    function renderBar() {
      const mineG = feed.find(g => g.user.username === cfg.username), others = feed.filter(g => g.user.username !== cfg.username);
      let h = `<button type="button" class="st-item" data-me="1"><span class="st-ring ${mineG ? "mine" : "none"}"><span class="avatar">${avOf(me)}</span></span><i class="st-plus" data-add="1">+</i><small data-no-i18n>${esc(mineG ? t("استوری من") : t("افزودن استوری"))}</small></button>`;
      others.forEach(g => {
        C.users[g.user.username] = Object.assign(C.users[g.user.username] || {}, g.user);
        h += `<button type="button" class="st-item" data-u="${esc(g.user.username)}"><span class="st-ring ${g.unseen ? "new" : ""}"><span class="avatar">${avOf(g.user)}</span></span><small data-no-i18n>${esc(g.user.display_name || g.user.username)}</small></button>`;
      });
      bar.innerHTML = h;
    }
    bar.addEventListener("click", e => {
      const b = e.target.closest(".st-item"); if (!b) return;
      if (b.dataset.me) {
        const idx = feed.findIndex(g => g.user.username === cfg.username);
        if (e.target.closest("[data-add]") || idx < 0) return openComposer();
        return openViewer(feed, idx, 0);
      }
      const idx = feed.findIndex(g => g.user.username === b.dataset.u); if (idx >= 0) openViewer(feed, idx, 0);
    });
    refreshMe().then(renderBar); loadFeed();
    setInterval(() => { if (!document.hidden) loadFeed(); }, 60000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) loadFeed(); });

    /* ---------- composer ---------- */
    document.body.insertAdjacentHTML("beforeend", `<div class="modal" id="story-modal"><section class="card st-card"><h2>${esc(t("استوری جدید"))}</h2>
      <div class="st-tabs"><button type="button" data-k="image" class="on">🖼 ${esc(t("عکس"))}</button><button type="button" data-k="text">Aa ${esc(t("متن"))}</button></div>
      <div id="st-img-wrap"><input id="st-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif"><small>${esc(t("PNG، JPG، WEBP یا GIF تا ۴ مگابایت"))}</small><div class="st-preview" id="st-preview" hidden></div></div>
      <div id="st-text-wrap" hidden><div class="st-textprev" id="st-textprev"><textarea id="st-text" maxlength="300" dir="auto" placeholder="${esc(t("چیزی بنویس…"))}"></textarea></div><div class="st-bgs" id="st-bgs"></div></div>
      <div id="st-cap-wrap"><label>${esc(t("توضیح (اختیاری)"))}</label><input id="st-caption" maxlength="200" dir="auto"></div>
      <label>${esc(t("مدت نمایش"))}</label><div class="st-chips" id="st-durs"></div>
      <small id="st-dur-hint"></small>
      <label>${esc(t("چه کسانی ببینند"))}</label><div class="st-chips" id="st-aud"></div>
      <div class="row2"><input type="checkbox" id="st-save" checked><label for="st-save">${esc(t("ذخیره در پروفایل (بخش پست‌ها)"))}</label></div>
      <div class="actions"><button type="button" class="key" id="st-cancel">${esc(t("بستن"))}</button><button type="button" class="key hot" id="st-post">${esc(t("انتشار"))}</button></div><p class="status" id="st-status"></p></section></div>`);
    const sm = $("story-modal"); let kind = "image", bg = "g1", dur = 24, aud = "everyone";
    sm.addEventListener("click", e => { if (e.target === sm) C.hideModal("story-modal"); });
    $("st-cancel").addEventListener("click", () => C.hideModal("story-modal"));
    sm.querySelectorAll(".st-tabs button").forEach(b => b.addEventListener("click", () => { kind = b.dataset.k; paintComposer(); }));
    $("st-bgs").innerHTML = Object.keys(BG).map(k => `<button type="button" data-bg="${k}" style="background:${BG[k]}" aria-label="${k}"></button>`).join("");
    $("st-bgs").addEventListener("click", e => { const b = e.target.closest("[data-bg]"); if (b) { bg = b.dataset.bg; paintComposer(); } });
    $("st-file").addEventListener("change", () => {
      const f = $("st-file").files[0], pv = $("st-preview");
      if (!f) { pv.hidden = true; pv.innerHTML = ""; return; }
      pv.hidden = false; pv.innerHTML = ""; const im = document.createElement("img"); im.src = URL.createObjectURL(f); pv.appendChild(im);
    });
    $("st-aud").innerHTML = `<button type="button" data-a="everyone">🌍 ${esc(t("همه"))}</button><button type="button" data-a="contacts">👥 ${esc(t("فقط مخاطبین من"))}</button>`;
    $("st-aud").addEventListener("click", e => { const b = e.target.closest("[data-a]"); if (b) { aud = b.dataset.a; paintComposer(); } });
    $("st-durs").addEventListener("click", e => {
      const b = e.target.closest("[data-h]"); if (!b) return; const h = +b.dataset.h;
      if (!FREE.includes(h) && !me.premium) return premiumSheet(true);
      dur = h; paintComposer();
    });
    function paintComposer() {
      sm.querySelectorAll(".st-tabs button").forEach(b => b.classList.toggle("on", b.dataset.k === kind));
      $("st-img-wrap").hidden = kind !== "image"; $("st-text-wrap").hidden = kind !== "text"; $("st-cap-wrap").hidden = kind !== "image";
      $("st-textprev").style.background = BG[bg]; sm.querySelectorAll("#st-bgs button").forEach(b => b.classList.toggle("on", b.dataset.bg === bg));
      $("st-durs").innerHTML = HOURS.map(h => { const lock = !FREE.includes(h) && !me.premium; return `<button type="button" data-h="${h}" class="${h === dur ? "on" : ""} ${lock ? "lock" : ""}">${lock ? "🔒 " : (h > 24 ? "⭐ " : "")}${esc(hoursLabel(h))}</button>`; }).join("");
      $("st-dur-hint").textContent = me.premium ? t("به‌عنوان کاربر پریمیوم می‌توانی ۴۸ یا ۷۲ ساعته هم بگذاری.") : t("بیشترین مدت برای همه ۲۴ ساعت است؛ ۴۸ و ۷۲ ساعت فقط برای پریمیوم.");
      sm.querySelectorAll("#st-aud button").forEach(b => b.classList.toggle("on", b.dataset.a === aud));
    }
    async function openComposer() {
      $("st-file").value = ""; $("st-preview").hidden = true; $("st-preview").innerHTML = ""; $("st-text").value = ""; $("st-caption").value = ""; $("st-status").textContent = "";
      kind = "image"; dur = 24; aud = "everyone"; $("st-save").checked = true; paintComposer(); C.showModal("story-modal");
      await refreshMe(); paintComposer();
    }
    $("st-post").addEventListener("click", async () => {
      const fd = new FormData(); fd.append("kind", kind); fd.append("duration", String(dur)); fd.append("audience", aud); fd.append("save_profile", $("st-save").checked ? "1" : "0");
      if (kind === "image") {
        const f = $("st-file").files[0]; if (!f) { $("st-status").textContent = t("یک عکس انتخاب کن."); return; }
        fd.append("image", f); fd.append("caption", $("st-caption").value);
      } else {
        const tx = $("st-text").value.trim(); if (!tx) { $("st-status").textContent = t("متن استوری را بنویس."); return; }
        fd.append("text", tx); fd.append("bg", bg);
      }
      $("st-status").textContent = t("در حال انتشار…"); $("st-post").disabled = true;
      const d = await api("/api/stories", {method: "POST", body: fd}, true); $("st-post").disabled = false;
      if (!ok(d)) {
        $("st-status").textContent = (d && d.error) || t("اتصال به سرور برقرار نشد. اینترنتت را بررسی کن.");
        if (d && d.code === "premium_required") premiumSheet(true);
        return;
      }
      C.hideModal("story-modal"); toast("استوری منتشر شد."); mine = null; await loadFeed(); window.dispatchEvent(new Event("cr:stories-changed"));
    });

    /* ---------- premium info ---------- */
    async function premiumSheet(needed) {
      await refreshMe();
      const box = document.createElement("div"); box.style.cssText = "line-height:1.9;text-align:center";
      box.innerHTML = `<div class="prem-hero">⭐</div>` + (me.premium
        ? `<p><b>${esc(t("پریمیوم فعال است."))}</b></p><p>${esc(t("می‌توانی استوری را ۴۸ یا ۷۲ ساعته منتشر کنی."))}</p>`
        : `<p>${esc(needed ? t("نمایش ۴۸ و ۷۲ ساعته فقط برای کاربران پریمیوم است.") : t("با پریمیوم استوری‌هایت را ۴۸ یا ۷۲ ساعت نگه دار."))}</p><p>${esc(t("برای فعال‌سازی پریمیوم با پشتیبانی در ارتباط باش."))}</p>`);
      C.sheet("پریمیوم", box, me.premium ? [{label: "بستن"}] : [{label: "پشتیبانی", cls: "hot", fn: () => { location.href = "/support#support"; }}, {label: "بستن"}]);
    }

    /* ---------- viewer ---------- */
    document.body.insertAdjacentHTML("beforeend", `<div class="st-view" id="st-view" hidden role="dialog" aria-label="${esc(t("استوری"))}"><div class="st-box" id="st-box">
      <div class="st-bars" id="st-bars"></div>
      <div class="st-head"><span class="avatar" id="st-av"></span><div class="st-who"><b id="st-name" data-no-i18n></b><small id="st-time"></small></div>
        <button type="button" id="st-arch" hidden title="${esc(t("بایگانی"))}">🗂</button><button type="button" id="st-del" hidden title="${esc(t("حذف"))}">🗑</button><button type="button" id="st-x" aria-label="${esc(t("بستن"))}">✕</button></div>
      <div class="st-stage" id="st-stage"></div><div class="st-cap" id="st-cap" data-no-i18n></div>
      <div class="st-foot" id="st-foot" hidden></div>
      <button type="button" class="st-tap prev" id="st-prev" aria-label="prev"></button><button type="button" class="st-tap mid" id="st-mid" aria-label="pause"></button><button type="button" class="st-tap next" id="st-next" aria-label="next"></button>
    </div></div>`);
    const V = $("st-view"), box = $("st-box"); let G = [], gi = 0, si = 0, sheetPause = false, onClose = null;
    const cur = () => (G[gi] && G[gi].stories[si]) || null;
    function openViewer(groups, g, s, cb) { G = groups; gi = g; si = s || 0; onClose = cb || null; V.hidden = false; document.body.style.overflow = "hidden"; show(); }
    function closeViewer() { V.hidden = true; document.body.style.overflow = ""; $("st-stage").innerHTML = ""; G = []; renderBar(); if (onClose) onClose(); }
    function show() {
      const g = G[gi], s = cur(); if (!s) return closeViewer();
      const own = g.user.username === cfg.username;
      $("st-bars").innerHTML = g.stories.map((_, i) => `<span class="${i < si ? "done" : i === si ? "cur" : ""}"><i></i></span>`).join("");
      $("st-av").innerHTML = avOf(g.user); $("st-name").textContent = g.user.display_name || g.user.username;
      $("st-time").textContent = ago(s.created_at) + (own && s.active !== false ? " · " + left(s.expires_at) : "") + (own ? " · " + hoursLabel(s.duration_h) : "");
      $("st-cap").textContent = s.caption || ""; box.classList.remove("paused");
      const st = $("st-stage"); st.innerHTML = "";
      const bars = $("st-bars"), curBar = bars.querySelector(".cur");
      if (curBar) { curBar.classList.remove("cur"); }
      const start = () => { if (cur() === s && curBar) { curBar.classList.add("cur"); } };
      if (s.kind === "text") {
        const d = document.createElement("div"); d.className = "st-t"; d.style.background = BG[s.bg] || BG.g1; d.textContent = s.text; d.dir = "auto"; st.appendChild(d); start();
      } else {
        const im = document.createElement("img"); im.alt = ""; im.onload = im.onerror = start; im.src = s.media_url; st.appendChild(im); setTimeout(start, 1500);
      }
      if (curBar) curBar.addEventListener("animationend", () => { if (cur() === s) next(); }, {once: true});
      $("st-del").hidden = !own; $("st-arch").hidden = !(own && s.in_profile); if (own && s.in_profile) $("st-arch").textContent = s.archived ? "📤" : "🗂";
      const foot = $("st-foot"); foot.hidden = !own;
      if (own) foot.innerHTML = `<button type="button" id="st-views">👁 ${esc(nf(s.views_count || 0))}</button><small>${esc(s.audience === "contacts" ? "👥 " + t("فقط مخاطبین") : "🌍 " + t("همه"))}</small>`;
      else if (!s.viewed) { s.viewed = true; jpost("/api/stories/" + encodeURIComponent(s.id) + "/view", {}); }
    }
    function next() { if (si + 1 < G[gi].stories.length) { si++; show(); } else if (gi + 1 < G.length) { gi++; si = 0; show(); } else closeViewer(); }
    function prev() { if (si > 0) { si--; show(); } else if (gi > 0) { gi--; si = 0; show(); } else show(); }
    $("st-next").addEventListener("click", next); $("st-prev").addEventListener("click", prev);
    $("st-mid").addEventListener("click", () => box.classList.toggle("paused"));
    $("st-x").addEventListener("click", closeViewer);
    document.addEventListener("keydown", e => { if (V.hidden) return; if (e.key === "Escape") closeViewer(); else if (e.key === "ArrowRight" || e.key === "ArrowLeft") (e.key === "ArrowRight") === (document.documentElement.dir !== "rtl") ? next() : prev(); });
    $("st-del").addEventListener("click", () => { const s = cur(); if (!s) return; box.classList.add("paused");
      C.confirmSheet("این استوری برای همیشه حذف شود؟", "حذف", async () => {
        const d = await api("/api/stories/" + encodeURIComponent(s.id), {method: "DELETE"}); if (!ok(d)) return;
        G[gi].stories.splice(si, 1); mine = null; loadFeed(); window.dispatchEvent(new Event("cr:stories-changed"));
        if (!G[gi].stories.length) { G.splice(gi, 1); if (gi >= G.length) return closeViewer(); si = 0; } else if (si >= G[gi].stories.length) si = G[gi].stories.length - 1;
        show();
      }); });
    $("st-arch").addEventListener("click", async () => {
      const s = cur(); if (!s) return; const d = await jpost("/api/stories/" + encodeURIComponent(s.id) + "/archive", {archived: !s.archived}); if (!ok(d)) return;
      s.archived = d.archived; mine = null; toast(s.archived ? "به بایگانی رفت." : "به پست‌های پروفایل برگشت."); $("st-arch").textContent = s.archived ? "📤" : "🗂"; window.dispatchEvent(new Event("cr:stories-changed"));
    });
    $("st-foot").addEventListener("click", async e => {
      if (!e.target.closest("#st-views")) return; const s = cur(); if (!s) return; box.classList.add("paused"); sheetPause = true;
      const d = await api("/api/stories/" + encodeURIComponent(s.id) + "/views"); if (!ok(d)) return;
      const list = document.createElement("div"); list.style.cssText = "display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow:auto";
      list.innerHTML = d.views.length ? d.views.map(v => `<div class="c-row" style="cursor:default"><span class="avatar">${avOf(v.user)}</span><span class="c-txt" data-no-i18n><strong>${esc(v.user.display_name || v.user.username)}</strong><small>${esc(ago(v.at))}</small></span></div>`).join("") : `<p class="status">${esc(t("هنوز کسی ندیده."))}</p>`;
      C.sheet("بازدیدها", list, [{label: "بستن"}]);
    });
    new MutationObserver(() => { const sh = $("sheet"); if (sheetPause && sh && !sh.classList.contains("show")) { sheetPause = false; if (!V.hidden) box.classList.remove("paused"); } })
      .observe($("sheet"), {attributes: true, attributeFilter: ["class"]});

    /* ---------- profile posts (Posts / Archived Posts) ---------- */
    async function loadMine() { const d = await api("/api/stories/mine", null, true); if (ok(d)) mine = d.stories; return mine; }
    function paintPosts(box, tab) {
      const want = tab === "archived", list = (mine || []).filter(s => s.in_profile && !!s.archived === want);
      if (!list.length) { box.innerHTML = `<div class="nav-empty">${esc(want ? t("پست بایگانی‌شده‌ای نداری.") : t("هنوز پستی نداری. با افزودن استوری، اینجا ذخیره می‌شود."))}</div>`; return; }
      box.innerHTML = `<div class="p-grid">` + list.map((s, i) => `<button type="button" class="p-tile" data-i="${i}">` +
        (s.kind === "text" ? `<div class="tt" style="background:${BG[s.bg] || BG.g1};width:100%;height:100%;display:grid;place-items:center" data-no-i18n>${esc(s.text.slice(0, 80))}</div>` : `<img src="${esc(s.media_url)}" alt="" loading="lazy">`) +
        `<span class="tag ${s.active ? "live" : ""}">${esc(s.active ? t("فعال") : hoursLabel(s.duration_h))}</span><span class="vc">👁 ${esc(nf(s.views_count || 0))}</span></button>`).join("") + `</div>`;
      box.onclick = e => { const b = e.target.closest(".p-tile"); if (!b) return;
        openViewer([{user: me, stories: list}], 0, +b.dataset.i, () => { if (box.isConnected) paintPosts(box, box.dataset.tab || tab); }); };
    }
    async function renderPosts(box, tab) {
      if (!box) return; box.dataset.tab = tab;
      if (mine) paintPosts(box, tab); else box.innerHTML = `<div class="nav-empty">${esc(t("در حال بارگذاری…"))}</div>`;
      await loadMine(); if (box.isConnected && box.dataset.tab === tab) paintPosts(box, tab);
    }
    window.addEventListener("cr:stories-changed", () => { const b = $("p-posts"); if (b) { mine = null; renderPosts(b, b.dataset.tab || "posts"); } });

    window.CRStories = {renderPosts, openComposer, openPremium: () => premiumSheet(false), reload: loadFeed};
  }
})();
