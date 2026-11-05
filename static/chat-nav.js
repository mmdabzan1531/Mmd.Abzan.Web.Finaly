/* Chatroom — Telegram-style bottom bar: Chats / Contacts / Settings / Profile.
   Runs after chat.js (needs window.CRChat). Pages live inside #sidebar, the old .me / .side-nav blocks stay in the DOM (hidden by CSS)
   so every existing handler keeps working. */
(function () {
  "use strict";
  function boot() { if (window.CRChat) init(); else window.addEventListener("cr:ready", init, {once: true}); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  function init() {
    const C = window.CRChat, cfg = C.cfg, esc = C.esc, t = C.t || (x => x), toast = C.toast;
    const $ = id => document.getElementById(id), side = $("sidebar");
    if (!side || side.dataset.navReady) return; side.dataset.navReady = "1";

    const ICON = {
      chats: '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3 8.8 8.8 0 0 1-3.6-.8L3 21l1.6-4.9A8 8 0 0 1 3.5 11.5 8.5 8.5 0 0 1 12 3.2a8.4 8.4 0 0 1 9 8.3z"/></svg>',
      contacts: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="10" r="3.2"/><path d="M5.8 18.4c1.4-2.3 3.6-3.4 6.2-3.4s4.8 1.1 6.2 3.4"/></svg>',
      settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
      plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
      newchat: '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3 8.8 8.8 0 0 1-3.6-.8L3 21l1.6-4.9A8 8 0 0 1 3.5 11.5 8.5 8.5 0 0 1 12 3.2a8.4 8.4 0 0 1 9 8.3z"/><path d="M12 8v7M8.5 11.5h7"/></svg>',
      user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.2-4 4-6 8-6s6.8 2 8 6"/></svg>',
      phone: '<svg viewBox="0 0 24 24"><rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M11 18.5h2"/></svg>',
      camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.6"/></svg>',
      edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14.5 7.5l3 3"/></svg>',
      chat: '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3 8.8 8.8 0 0 1-3.6-.8L3 21l1.6-4.9A8 8 0 0 1 3.5 11.5 8.5 8.5 0 0 1 12 3.2a8.4 8.4 0 0 1 9 8.3z"/></svg>',
      lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
      globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c3 3.2 3 15.8 0 19M12 2.5c-3 3.2-3 15.8 0 19"/></svg>',
      help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/></svg>',
      info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v6M12 7.5h.01"/></svg>',
      out: '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
      sync: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5"/></svg>',
      trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
      info2: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v5.5M12 7.8h.01"/></svg>',
      close: '✕'
    };
    const store = {get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} }};
    const closeBtn = '<button type="button" class="key round small mobile-only" data-nav-close aria-label="' + esc(t("بستن")) + '">✕</button>';

    /* ---------- skeleton ---------- */
    side.insertAdjacentHTML("beforeend", `
      <section class="nav-page" id="page-contacts" aria-label="${esc(t("مخاطبین"))}">
        <div class="nav-top"><h2>${esc(t("مخاطبین"))}</h2><div style="display:flex;gap:6px;align-items:center"><button type="button" class="key small" id="c-sync" title="${esc(t("همگام‌سازی مخاطبین گوشی"))}">${ICON.sync.replace("<svg", '<svg width="18" height="18"')}</button>${closeBtn}</div></div>
        <div class="searchbox"><input id="c-search" placeholder="${esc(t("جستجوی مخاطبین…"))}" autocomplete="off" aria-label="${esc(t("جستجو"))}"></div>
        <button type="button" class="c-act" id="c-add"><span class="c-ico">${ICON.plus}</span><span>${esc(t("ایجاد مخاطب جدید"))}</span></button>
        <button type="button" class="c-act" id="c-phone"><span class="c-ico alt">${ICON.phone}</span><span>${esc(t("افزودن از مخاطبین گوشی"))}</span></button>
        <div class="side-sec" id="c-count"></div>
        <div id="c-list"></div>
      </section>
      <section class="nav-page" id="page-settings" aria-label="${esc(t("تنظیمات"))}">
        <div class="nav-top"><h2>${esc(t("تنظیمات"))}</h2>${closeBtn}</div>
        <div id="s-body"></div>
      </section>
      <section class="nav-page" id="page-profile" aria-label="${esc(t("پروفایل"))}">
        <div class="nav-top"><span></span>${closeBtn}</div>
        <div id="p-body"></div>
      </section>
      <button type="button" class="nav-fab" id="nav-fab" aria-label="${esc(t("گفتگوی جدید"))}">${ICON.newchat}</button>
      <nav class="nav-bar" id="nav-bar" aria-label="${esc(t("ناوبری"))}">
        <button type="button" data-tab="chats" class="on">${ICON.chats}<span>${esc(t("گفتگوها"))}</span><b class="nav-badge" id="nav-badge" hidden></b></button>
        <button type="button" data-tab="contacts">${ICON.contacts}<span>${esc(t("مخاطبین"))}</span></button>
        <button type="button" data-tab="settings">${ICON.settings}<span>${esc(t("تنظیمات"))}</span></button>
        <button type="button" data-tab="profile"><span class="nav-av" id="nav-av"></span><span>${esc(t("پروفایل"))}</span></button>
      </nav>`);
    side.dataset.tab = "chats";

    /* profile edit window: hide the theme / font / background / support / about rows (also when the page was not re-rendered) */
    ["theme-open", "font-open", "cb-open-me"].forEach(id => { const e = $(id); if (e && e.parentElement) e.parentElement.style.display = "none"; });
    document.querySelectorAll('#profile-modal a[href*="support"],#profile-modal a[href*="about"]').forEach(a => { a.style.display = "none"; if (a.parentElement && a.parentElement.classList.contains("row2")) a.parentElement.style.display = "none"; });

    /* ---------- Telegram-style top: status title, ⋮ menu, stories row ---------- */
    (function topBar() {
      const title = $("tg-title"), txt = $("tg-title-text"), conn = $("conn");
      const BRAND = "Chatroom";
      function syncTitle() {
        const st = conn ? conn.dataset.state : "on";
        title.dataset.state = st;
        txt.textContent = st === "connecting" ? t("در حال اتصال…") : st === "off" ? t("در انتظار شبکه…") : BRAND;
      }
      if (conn) { new MutationObserver(syncTitle).observe(conn, {attributes: true, attributeFilter: ["data-state"]}); }
      syncTitle();

      /* ⋮ menu: every action proxies to the original (now hidden) controls, so old handlers keep working */
      $("tg-more").addEventListener("click", () => {
        const box = document.createElement("div"); box.className = "tg-menu";
        const add = (label, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "key"; b.textContent = label; b.onclick = () => { C.hideModal("sheet"); setTimeout(fn, 60); }; box.appendChild(b); };
        add(t("گروه جدید"), () => C.showModal("create-group-modal"));
        const inst = document.querySelector("[data-install-btn]"); if (inst && !inst.hidden) add(t("نصب برنامه"), () => inst.click());
        add(t("پس‌زمینه من"), () => { const b = $("open-my-background"); b ? b.click() : window.CRTheme && window.CRTheme.openPicker && window.CRTheme.openPicker(); });
        const lo = document.querySelector('.side-nav a[href*="logout"]');
        add(t("زبان"), () => {   // medium in-page window instead of the separate language page
          const LANGS = [["fa", "فارسی"], ["en", "English"], ["ar", "العربية"], ["tr", "Türkçe"], ["ru", "Русский"], ["es", "Español"], ["fr", "Français"], ["zh", "中文"]];
          const cur = window.CR_LANG || (document.documentElement.lang || "fa").slice(0, 2), lb = document.createElement("div"); lb.className = "tg-menu";
          LANGS.forEach(([code, name]) => {
            const b = document.createElement("button"); b.type = "button"; b.className = "key" + (code === cur ? " hot" : ""); b.setAttribute("data-no-i18n", ""); b.textContent = (code === cur ? "✓  " : "") + name;
            b.onclick = async () => {
              if (code === cur) return C.hideModal("sheet");
              b.disabled = true;
              try { await fetch("/lang/" + code + "?next=%2Fchat", {credentials: "same-origin"}); } catch (_) {}
              location.reload();
            };
            lb.appendChild(b);
          });
          C.sheet("زبان", lb, [{label: "بستن"}]);
        });
        add(t("درباره ما"), () => { location.href = "/about#about"; });
        add(t("پشتیبانی"), () => { location.href = "/support#support"; });
        add(t("خروج"), () => C.confirmSheet("مطمئنی می‌خوای از حساب خارج بشی؟", "خروج", () => { location.href = lo ? lo.getAttribute("href") : "/logout"; }));
        const ver = document.createElement("small"); ver.textContent = "نسخه برنامه: r10"; ver.style.cssText = "opacity:.5;text-align:center;margin-top:4px"; box.appendChild(ver);
                C.sheet("منو", box, [{label: "بستن"}]);
      });

      /* stories row */
      const row = $("tg-stories"), me = (cfg && cfg.username) || (document.querySelector(".me-info span") || {}).textContent || "";
      const myName = String(me).replace(/^@/, "");
      const avatar = u => u && u.avatar_url ? '<img src="' + esc(u.avatar_url) + '" alt="">' : esc((u && u.avatar) || "🙂");
      const openStory = (g) => {
        const S = window.CRStories;
        if (S && typeof S.open === "function") return S.open(g.user.username, g);
        if (S && typeof S.openViewer === "function") return S.openViewer(g.user.username, g);
        window.dispatchEvent(new CustomEvent("cr:story-open", {detail: {username: g.user.username, group: g}}));
      };
      const addStory = () => {
        const S = window.CRStories;
        if (S && typeof S.compose === "function") return S.compose();
        if (S && typeof S.add === "function") return S.add();
        window.dispatchEvent(new CustomEvent("cr:story-add"));
      };
      async function loadStories() {
        let groups = [];
        try { const r = await fetch("/api/stories", {credentials: "same-origin"}); const d = await r.json(); if (r.ok && d.ok) groups = d.groups || []; } catch (_) {}
        const mine = groups.find(g => g.user.username === myName), others = groups.filter(g => g !== mine);
        row.innerHTML = "";
        const el = (cls, av, name, plus, fn) => {
          const d = document.createElement("div"); d.className = "tg-st " + cls; d.setAttribute("role", "button"); d.tabIndex = 0;
          d.innerHTML = '<span class="tg-ring"><span class="avatar">' + av + '</span>' + (plus ? '<i class="tg-plus">+</i>' : "") + '</span><span class="tg-name" data-no-i18n>' + esc(name) + '</span>';
          const pl = d.querySelector(".tg-plus"); if (pl && cls.indexOf("has") > -1) pl.addEventListener("click", e => { e.stopPropagation(); addStory(); });
          d.addEventListener("click", fn); d.addEventListener("keydown", e => { if (e.key === "Enter") fn(); }); row.appendChild(d);
        };
        const myAv = ($("my-avatar") || {}).innerHTML || "🙂";
        if (mine) {
          el("mine has " + (mine.unseen ? "unseen" : "seen"), avatar(mine.user), t("استوری من"), true, () => openStory(mine));
        } else el("mine", myAv, t("استوری من"), true, addStory);
        others.forEach(g => el(g.unseen ? "unseen" : "seen", avatar(g.user), g.user.display_name || g.user.username, false, () => openStory(g)));
      }
      loadStories();
      window.CRStoriesRefresh = loadStories;
      window.addEventListener("cr:stories-changed", loadStories);
      if (C.socket && C.socket.on) C.socket.on("stories_changed", loadStories);
      document.addEventListener("visibilitychange", () => { if (!document.hidden) loadStories(); });
      setInterval(() => { if (!document.hidden) loadStories(); }, 30000);
    })();
    side.querySelectorAll("[data-nav-close]").forEach(b => b.addEventListener("click", () => side.classList.remove("open")));

    /* ---------- home page: on phones the chat list (with the bottom bar) is the first screen, like Telegram ---------- */
    const phone = () => window.matchMedia("(max-width:860px)").matches;
    if (phone()) side.classList.add("open");   // on phones always start on the chat list, never on the (empty/black) room
    const back = $("open-sidebar");
    if (back) back.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';

    /* ---------- tabs ---------- */
    let seenContactsPrompt = !!store.get("cr_contacts_prompt_v1");
    function setTab(name) {
      side.dataset.tab = name;
      side.querySelectorAll("#nav-bar button").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
      if (name === "contacts") { loadContacts(); maybePrompt(); }
      if (name === "settings") renderSettings();
      if (name === "profile") loadProfile();
    }
    $("nav-bar").addEventListener("click", e => { const b = e.target.closest("button[data-tab]"); if (b) setTab(b.dataset.tab); });

    /* ---------- entering the app always lands on the chat list ---------- */
    const hasDeepLink = /[?&]group=/.test(location.search);          // invite links still go straight to their group
    function goHome() { setTab("chats"); if (phone()) side.classList.add("open"); }
    goHome();
    window.addEventListener("load", () => { if (!hasDeepLink) goHome(); });
    let touched = false; addEventListener("pointerdown", () => { touched = true; }, {once: true, capture: true});
    [300, 1200, 2500].forEach(ms => setTimeout(() => { if (!touched && !hasDeepLink) goHome(); }, ms));   // in case anything re-opens the last chat after load
    window.addEventListener("pageshow", e => { if (e.persisted) goHome(); });                  // coming back from the browser's back-forward cache
    let hiddenAt = 0;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 180000) { hiddenAt = 0; goHome(); }         // re-opening the app after 3+ minutes
    });
    window.addEventListener("cr:profile-saved", () => { if (side.dataset.tab === "profile") loadProfile(); else refreshMe(); });

    /* unread badge on "Chats" = sum of the badges in the chat list */
    const fa = s => String(s).replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x06F0).replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x0660);
    function updateBadge() {
      let n = 0; document.querySelectorAll("#group-list .group-item .badge").forEach(b => { n += parseInt(fa(b.textContent).replace(/[^\d]/g, ""), 10) || 0; });
      const el = $("nav-badge"); el.hidden = !n; el.textContent = n > 99 ? "99+" : String(n);
    }
    new MutationObserver(updateBadge).observe($("group-list"), {childList: true, subtree: true}); updateBadge();

    /* ---------- floating "new chat" button ---------- */
    $("nav-fab").addEventListener("click", () => {
      const box = document.createElement("div"); box.style.cssText = "display:flex;flex-direction:column;gap:10px";
      [[t("پیام جدید (از مخاطبین)"), () => setTab("contacts")], [t("گروه جدید"), () => { const b = $("open-create-group"); b && b.click(); }]].forEach(([label, fn]) => {
        const b = document.createElement("button"); b.type = "button"; b.className = "key"; b.textContent = label;
        b.onclick = () => { C.hideModal("sheet"); fn(); }; box.appendChild(b);
      });
      C.sheet("گفتگوی جدید", box, [{label: "بستن"}]);
    });

    /* ---------- contacts ---------- */
    let contacts = [], loaded = false;
    const nameOf = c => c.name || (c.user && c.user.display_name) || c.username;
    async function api(url, opts) {
      try {
        const r = await fetch(url, Object.assign({credentials: "same-origin"}, opts || {})), d = await r.json().catch(() => ({}));
        if (r.status === 401) { location.href = "/"; return null; }
        if (!r.ok) { toast(d.error || "عملیات انجام نشد."); return null; }
        return d;
      } catch (_) { toast("اتصال به سرور برقرار نشد. اینترنتت را بررسی کن."); return null; }
    }
    const jpost = (url, body, method) => api(url, {method: method || "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body || {})});
    async function loadContacts() {
      if (!loaded) renderContacts();
      const d = await api("/api/contacts"); if (!d) return;
      contacts = d.contacts || []; loaded = true; renderContacts();
    }
    function renderContacts() {
      const q = $("c-search").value.trim().toLowerCase().replace(/^@/, ""), list = $("c-list");
      const rows = contacts.filter(c => !q || nameOf(c).toLowerCase().includes(q) || c.username.toLowerCase().includes(q));
      $("c-count").textContent = contacts.length ? t("مخاطبین") + " (" + contacts.length.toLocaleString(window.CR_LANG === "fa" ? "fa-IR" : undefined) + ")" : "";
      list.innerHTML = "";
      if (!rows.length) {
        list.innerHTML = `<div class="nav-empty">${esc(q ? t("مخاطبی پیدا نشد.") : (loaded ? t("هنوز مخاطبی نداری.") : t("در حال بارگذاری…")))}${!q && loaded ? "<br>" + esc(t("با «ایجاد مخاطب جدید» یا «افزودن از مخاطبین گوشی» شروع کن.")) : ""}</div>`;
        return;
      }
      rows.forEach(c => {
        const u = c.user || {username: c.username}; C.users[u.username] = Object.assign(C.users[u.username] || {}, u);
        const row = document.createElement("div"); row.className = "c-row"; row.tabIndex = 0; row.setAttribute("role", "button");
        row.innerHTML = `<span class="avatar">${C.avatarHtml(u)}</span><span class="c-txt" data-no-i18n><strong>${esc(nameOf(c))}</strong><small>@${esc(c.username)}</small></span>` +
          `<button type="button" class="c-mini" data-act="info" aria-label="${esc(t("پروفایل"))}">${ICON.info2}</button><button type="button" class="c-mini" data-act="del" aria-label="${esc(t("حذف"))}">${ICON.trash}</button>`;
        row.addEventListener("click", e => {
          const a = e.target.closest("[data-act]");
          if (a && a.dataset.act === "info") return C.openUserProfile(c.username);
          if (a && a.dataset.act === "del") return C.confirmSheet("«" + nameOf(c) + "» از مخاطبین حذف شود؟", "حذف", async () => {
            const d = await api("/api/contacts/" + encodeURIComponent(c.username), {method: "DELETE"}); if (d) { contacts = d.contacts; renderContacts(); }
          });
          setTab("chats"); C.startDm(c.username);
        });
        row.addEventListener("keydown", e => { if (e.key === "Enter") row.click(); });
        list.appendChild(row);
      });
    }
    $("c-search").addEventListener("input", renderContacts);

    /* create contact (username or phone number) */
    document.body.insertAdjacentHTML("beforeend", `<div class="modal" id="add-contact-modal"><section class="card"><h2>${esc(t("مخاطب جدید"))}</h2>
      <label>${esc(t("نام (اختیاری)"))}</label><input id="ac-name" maxlength="60" autocomplete="off">
      <label>${esc(t("نام کاربری یا شماره موبایل"))}</label><input id="ac-ident" dir="ltr" maxlength="40" autocomplete="off" placeholder="@username / 09123456789">
      <div class="actions"><button type="button" class="key" id="ac-cancel">${esc(t("بستن"))}</button><button type="button" class="key hot" id="ac-save">${esc(t("ذخیره"))}</button></div><p class="status" id="ac-status"></p></section></div>`);
    const acModal = $("add-contact-modal");
    acModal.addEventListener("click", e => { if (e.target === acModal) C.hideModal("add-contact-modal"); });
    $("ac-cancel").addEventListener("click", () => C.hideModal("add-contact-modal"));
    $("c-add").addEventListener("click", () => { $("ac-name").value = ""; $("ac-ident").value = ""; $("ac-status").textContent = ""; C.showModal("add-contact-modal"); setTimeout(() => $("ac-ident").focus(), 50); });
    $("ac-save").addEventListener("click", async () => {
      const ident = $("ac-ident").value.trim(); if (!ident) { $("ac-status").textContent = t("نام کاربری یا شماره را وارد کن."); return; }
      $("ac-status").textContent = t("در حال ذخیره…");
      const d = await jpost("/api/contacts", {ident, name: $("ac-name").value.trim()});
      if (!d) { $("ac-status").textContent = t("کاربری با این نام کاربری یا شماره پیدا نشد."); return; }
      contacts = d.contacts; loaded = true; renderContacts(); C.hideModal("add-contact-modal"); toast("مخاطب اضافه شد.");
    });
    $("ac-ident").addEventListener("keydown", e => { if (e.key === "Enter") $("ac-save").click(); });

    /* phone address book — the browser shows its OWN permission/picker dialog (Contact Picker API: Chrome on Android, https only) */
    const canPick = () => "contacts" in navigator && "ContactsManager" in window;
    async function syncPhone() {
      if (!canPick()) { toast("مرورگر تو انتخاب مخاطبین گوشی را پشتیبانی نمی‌کند (کروم اندروید لازم است). می‌توانی مخاطب را با نام کاربری یا شماره اضافه کنی."); return; }
      let picked;
      try { picked = await navigator.contacts.select(["name", "tel"], {multiple: true}); }
      catch (e) { if (e && e.name !== "AbortError") toast("دسترسی به مخاطبین گوشی ممکن نشد."); return; }
      if (!picked || !picked.length) return;
      const items = picked.map(c => ({name: (c.name && c.name[0]) || "", phones: c.tel || []}));
      let found = 0, total = 0, last = null;
      for (let i = 0; i < items.length; i += 500) {
        const d = await jpost("/api/contacts/match", {items: items.slice(i, i + 500)}); if (!d) return;
        found += d.found; total += d.total; last = d.contacts;
      }
      if (last) { contacts = last; loaded = true; renderContacts(); }
      toast(found ? found.toLocaleString(window.CR_LANG === "fa" ? "fa-IR" : undefined) + " " + t("مخاطب از گوشی‌ات در چت‌روم پیدا و اضافه شد.") : t("هیچ‌کدام از مخاطبین انتخاب‌شده هنوز در چت‌روم نیستند."));
    }
    $("c-sync").addEventListener("click", syncPhone); $("c-phone").addEventListener("click", syncPhone);
    function maybePrompt() {
      if (seenContactsPrompt) return; seenContactsPrompt = true; store.set("cr_contacts_prompt_v1", "1");
      const p = document.createElement("p"); p.style.cssText = "line-height:1.9;margin:0"; p.textContent = t("برای پیدا کردن دوستانت، چت‌روم می‌خواهد به مخاطبین گوشی‌ات دسترسی داشته باشد. خودت مشخص می‌کنی کدام مخاطبین انتخاب شوند و شماره‌ها روی سرور ذخیره نمی‌شوند؛ فقط ثبت‌نام‌شده‌ها پیدا می‌شوند.");
      C.sheet("دسترسی به مخاطبین", p, [{label: "اجازه می‌دهم", cls: "hot", fn: syncPhone}, {label: "فعلاً نه"}]);
    }

    /* ---------- privacy (what other people can see) ---------- */
    const PRIV = [
      ["show_online", t("آنلاین بودن"), t("دیگران ببینند الان آنلاین هستی")],
      ["show_phone", t("شماره موبایل"), t("شماره‌ات در پروفایل نمایش داده شود")],
      ["show_email", t("ایمیل"), t("ایمیلت در پروفایل نمایش داده شود")],
      ["show_bio", t("بیو"), t("بیوی پروفایل برای دیگران دیده شود")],
      ["show_birthday", t("تاریخ تولد"), t("تاریخ تولدت در پروفایل نمایش داده شود")]
    ];
    document.body.insertAdjacentHTML("beforeend", `<div class="modal" id="privacy-modal"><section class="card"><h2>${esc(t("حریم خصوصی"))}</h2>
      <p class="status" style="margin:0 0 8px">${esc(t("انتخاب کن دیگران چه چیزهایی از تو ببینند. تغییرات همان لحظه ذخیره می‌شود."))}</p>
      <div id="priv-list"></div><div class="actions"><button type="button" class="key" id="priv-close">${esc(t("بستن"))}</button></div></section></div>`);
    const pm = $("privacy-modal");
    pm.addEventListener("click", e => { if (e.target === pm) C.hideModal("privacy-modal"); });
    $("priv-close").addEventListener("click", () => C.hideModal("privacy-modal"));
    async function openPrivacy() {
      C.showModal("privacy-modal");
      const u = (await refreshMe()) || cfg.me || {}, box = $("priv-list"); box.innerHTML = "";
      PRIV.forEach(([key, title, sub]) => {
        const row = document.createElement("label"); row.className = "priv-row";
        row.innerHTML = `<span class="s-txt"><strong>${esc(title)}</strong><small>${esc(sub)}</small></span><input type="checkbox" class="priv-sw" ${u[key] ? "checked" : ""}>`;
        const inp = row.querySelector("input");
        inp.addEventListener("change", async () => {
          const d = await jpost("/api/privacy", {[key]: inp.checked});
          if (d) { cfg.me = d.user; toast("ذخیره شد."); if (side.dataset.tab === "profile") renderProfile(d.user); } else inp.checked = !inp.checked;
        });
        box.appendChild(row);
      });
    }

    /* ---------- settings ---------- */
    let settingsDone = false;
    function renderSettings() {
      if (settingsDone) return; settingsDone = true;
      const logout = document.querySelector('.side-nav a[href*="logout"]'), logoutHref = logout ? logout.getAttribute("href") : "/logout";
      const item = (color, icon, title, sub, fn, cls) => ({color, icon, title, sub, fn, cls});
      const openModalAt = id => { C.showModal("profile-modal"); const el = $(id); if (el) setTimeout(() => el.scrollIntoView({block: "center"}), 60); };
      const chatSettings = () => {
        const box = document.createElement("div"); box.style.cssText = "display:flex;flex-direction:column;gap:10px";
        [[t("🎨 تم‌ها"), () => window.CRTheme && window.CRTheme.openPicker()], [t("🔤 فونت‌ها"), () => window.CRTheme && window.CRTheme.openFontPicker()], [t("🖼 پس‌زمینه چت"), () => { const b = $("open-my-background"); b && b.click(); }]].forEach(([label, fn]) => {
          const b = document.createElement("button"); b.type = "button"; b.className = "key"; b.textContent = label; b.onclick = () => { C.hideModal("sheet"); fn(); }; box.appendChild(b);
        });
        C.sheet("تنظیمات ظاهری گفتگو", box, [{label: "بستن"}]);
      };
      const groups = [
        [null, [
          item("#3a8ee6", ICON.user, t("حساب کاربری"), t("نام، بیو، عکس، تاریخ تولد"), () => C.showModal("profile-modal")),
          item("#e59a2e", ICON.chat, t("تنظیمات ظاهری گفتگو"), t("تم، فونت، پس‌زمینه"), chatSettings),
          item("#3fae5a", ICON.lock, t("حریم خصوصی"), t("نمایش شماره، ایمیل و تاریخ تولد"), openPrivacy),
          item("#f5b301", '<svg viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>', t("پریمیوم"), t("استوری ۴۸ و ۷۲ ساعته"), () => window.CRStories && window.CRStories.openPremium()),
          item("#8e5bd6", ICON.globe, t("زبان"), t("تغییر زبان برنامه"), () => { const a = $("open-lang"); a ? a.click() : (location.href = "/lang"); })
        ]],
        [t("راهنما"), [
          item("#e0a030", ICON.help, t("پشتیبانی"), "", () => { location.href = "/support#support"; }),
          item("#4aa3c7", ICON.info, t("درباره ما"), "", () => { location.href = "/about#about"; })
        ]],
        [null, [item("#e0483e", ICON.out, t("خروج"), "", () => { location.href = logoutHref; }, "danger")]]
      ];
      const body = $("s-body"); body.innerHTML = "";
      groups.forEach(([title, items]) => {
        if (title) { const h = document.createElement("div"); h.className = "s-title"; h.textContent = title; body.appendChild(h); }
        const g = document.createElement("div"); g.className = "s-group";
        items.forEach(it => {
          const b = document.createElement("button"); b.type = "button"; b.className = "s-item " + (it.cls || "");
          b.innerHTML = `<span class="s-ico" style="background:${it.color}">${it.icon}</span><span class="s-txt"><strong>${esc(it.title)}</strong>${it.sub ? "<small>" + esc(it.sub) + "</small>" : ""}</span>`;
          b.addEventListener("click", it.fn); g.appendChild(b);
        });
        body.appendChild(g);
      });
    }

    /* ---------- profile ---------- */
    const AGE = {fa: "ساله", en: "years old", ar: "سنة", tr: "yaşında", ru: "лет", es: "años", fr: "ans", zh: "岁"};
    function birthText(iso) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); if (!m) return "";
      const y = +m[1], mo = +m[2], d = +m[3], now = new Date(); let age = now.getFullYear() - y;
      if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age--;
      const loc = window.CR_LANG === "fa" ? "fa-IR" : (window.CR_LANG || "en");
      let ds; try { ds = new Date(y, mo - 1, d).toLocaleDateString(loc, {year: "numeric", month: "long", day: "numeric"}); } catch (_) { ds = iso; }
      return ds + (age >= 0 ? " (" + age.toLocaleString(loc) + " " + (AGE[window.CR_LANG] || AGE.en) + ")" : "");
    }
    function setNavAvatar(u) { $("nav-av").innerHTML = C.avatarHtml(u || cfg.me || {}); }
    setNavAvatar(cfg.me);
    async function refreshMe() { const d = await api("/api/me/profile"); if (d) { cfg.me = d.user; setNavAvatar(d.user); } return d && d.user; }
    let pTab = "posts";
    async function loadProfile() {
      renderProfile(cfg.me || {});
      const u = await refreshMe(); if (u && side.dataset.tab === "profile") renderProfile(u);
    }
    function renderProfile(u) {
      const field = (val, label, ltr) => val ? `<div class="p-field"><b${ltr ? ' dir="ltr" style="text-align:start"' : ""} data-no-i18n>${esc(val)}</b><small>${esc(label)}</small></div>` : "";
      $("p-body").innerHTML = `
        <div class="p-hero"><div class="avatar" id="p-avatar">${C.avatarHtml(u)}</div><h2 data-no-i18n>${esc(u.display_name || u.username || "")}${u.premium ? '<span class="p-prem" title="Premium">⭐</span>' : ""}</h2><div class="p-status">${esc(t("آنلاین"))}</div></div>
        <div class="p-btns">
          <button type="button" data-p="photo">${ICON.camera}<span>${esc(t("تغییر عکس"))}</span></button>
          <button type="button" data-p="edit">${ICON.edit}<span>${esc(t("ویرایش اطلاعات"))}</span></button>
          <button type="button" data-p="settings">${ICON.settings}<span>${esc(t("تنظیمات"))}</span></button>
        </div>
        <div class="p-card">${field(u.phone, t("موبایل"), true)}${field(u.bio, t("بیو"))}${field(u.username ? "@" + u.username : "", t("نام کاربری"), true)}${field(birthText(u.birthday), t("تاریخ تولد"))}</div>
        <div class="p-tabs"><button type="button" data-pt="posts" class="${pTab === "posts" ? "on" : ""}">${esc(t("پست‌ها"))}</button><button type="button" data-pt="archived" class="${pTab === "archived" ? "on" : ""}">${esc(t("پست‌های بایگانی‌شده"))}</button></div>
        <div id="p-posts"></div>`;
      if (window.CRStories) window.CRStories.renderPosts($("p-posts"), pTab);
    }
    $("p-body").addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.p === "photo") { C.showModal("profile-modal"); const f = $("profile-photo"); f && f.click(); }
      else if (b.dataset.p === "edit") C.showModal("profile-modal");
      else if (b.dataset.p === "settings") setTab("settings");
      else if (b.dataset.pt) { pTab = b.dataset.pt; renderProfile(cfg.me || {}); }
    });
  }
})();
