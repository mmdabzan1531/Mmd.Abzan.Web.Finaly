(() => {
  "use strict";
  const cfg = window.CHATROOM;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const coarse = matchMedia("(pointer:coarse)").matches;
  /* i18n helpers (from i18n.js): t = translate, tf = translate a {template}, nf = number in the UI language */
  const LOC = window.CR_LOCALE || "fa-IR";
  const t = window.t || (s => s);
  const tf = window.tf || ((s, v) => t(s).replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m)));
  const nf = n => Number(n).toLocaleString(LOC);
  ["group-name-head", "group-description", "ctx-text", "view-user-name", "view-user-id", "view-user-bio", "my-display"]
    .forEach(id => { const e = $(id); if (e) e.setAttribute("data-no-i18n", ""); });   // user-written text is never translated
  const BASE_TITLE = "Chatroom | محمد مهدی آبزن";
  const BOT_USER = "chatroom_bot";                       // its messages come from the server in Persian and are translated
  const MAX_MB = (cfg && cfg.maxFileMb) || 15;           // must match CHATROOM_MAX_FILE_MB on the server

  const noop = () => {};
  const socket = typeof io === "function" ? io({reconnectionDelayMax: 4000}) : {connected: false, on: noop, emit: noop, io: {on: noop}};
  const live = () => !!socket.connected;
  const LIVE_MSG = "اتصال لحظه‌ای برقرار نیست؛ کمی بعد دوباره تلاش کن.";
  const feed = $("messages"), input = $("message-input"), form = $("message-form");
  const users = {...cfg.initialUsers};
  const groups = {...cfg.initialGroups};
  const unread = {}, maxSeq = {};
  const LR_KEY = "cr:lr:" + cfg.username, LAST_KEY = "cr:group:" + cfg.username;
  let lastRead = {};
  try { lastRead = JSON.parse(localStorage.getItem(LR_KEY) || "{}"); } catch (_) {}
  const saveLR = () => { try { localStorage.setItem(LR_KEY, JSON.stringify(lastRead)); } catch (_) {} };

  let stored = ""; try { stored = localStorage.getItem(LAST_KEY) || ""; } catch (_) {}
  let activeGroup = groups[cfg.initialGroup] ? cfg.initialGroup : (groups[stored] ? stored : "");
  let online = new Set(), msgs = [], hasMore = false, loadingOlder = false, ctx = null;
  let menuFor = null, lastTap = {}, awayCount = 0, failures = 0;
  const typers = new Map();

  const profileOf = n => users[n] || {username: n, display_name: n, avatar: "🙂", bio: ""};
  const avatarHtml = u => u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="">` : esc(u.avatar || "🙂");
  const groupAvatarHtml = g => g && g.avatar_url ? `<img src="${esc(g.avatar_url)}" alt="">` : esc([...((g && g.name) || t("گروه"))][0]);
  const fmtTime = iso => new Date(iso).toLocaleTimeString(LOC, {hour: "2-digit", minute: "2-digit"});
  const fmtDay = iso => new Date(iso).toLocaleDateString(LOC, {weekday: "long", day: "numeric", month: "long"});
  const dayKey = iso => new Date(iso).toDateString();
  const fmtSize = n => n >= 1048576 ? (n / 1048576).toLocaleString(LOC, {maximumFractionDigits: 1}) + " MB" : Math.max(1, Math.round(n / 1024)).toLocaleString(LOC) + " KB";

  /* roles: owner > admin > member (the server decides; this only shows / hides buttons) */
  const roleOf = (g, n) => !g ? null : g.type === "dm" ? "member" : g.owner === n ? "owner" : (g.admins || []).includes(n) ? "admin" : (g.members || []).includes(n) ? "member" : null;
  const iAmAdmin = g => ["owner", "admin"].includes(roleOf(g, cfg.username));

  /* ---------- members drawer: closed by default, opened only by the "اعضا" button ---------- */
  const peopleEl = $("people");
  const drawerMode = () => getComputedStyle($("close-members")).display !== "none";   // the ✕ button only exists in the mobile drawer layout
  let peopleTimer;
  function setPeople(open) {
    clearTimeout(peopleTimer);
    if (open) {
      peopleEl.style.visibility = ""; peopleEl.style.pointerEvents = "";
      void peopleEl.offsetWidth;                                  // let the slide-in transition start from the closed position
      peopleEl.classList.add("open"); return;
    }
    peopleEl.classList.remove("open");
    if (drawerMode()) {
      peopleEl.style.pointerEvents = "none";
      peopleTimer = setTimeout(() => { if (!peopleEl.classList.contains("open")) peopleEl.style.visibility = "hidden"; }, 350);   // after the slide-out ends
    } else { peopleEl.style.visibility = ""; peopleEl.style.pointerEvents = ""; }
  }
  setPeople(false);
  if (drawerMode()) { peopleEl.style.visibility = "hidden"; peopleEl.style.pointerEvents = "none"; }
  addEventListener("resize", () => setPeople(peopleEl.classList.contains("open")));

  /* attachments */
  const PV = ["📷 عکس", "🎞 ویدیو", "🎵 صوت"], pv = x => PV.includes(x) ? t(x) : x;     // translate only the built-in preview labels
  const previewOf = m => m.text ? m.text.slice(0, 60) : (m.attach ? ({image: "📷 عکس", video: "🎞 ویدیو", audio: "🎵 صوت"}[m.attach.kind] || "📎 " + (m.attach.name || "")).slice(0, 60) : (m.up ? "📎 " + m.up.name : ""));
  const kindOf = f => /^image\//.test(f.type) ? "image" : /^video\//.test(f.type) ? "video" : /^audio\//.test(f.type) ? "audio" : "file";
  const kindIcon = f => ({image: "🖼", video: "🎞", audio: "🎵", file: "📎"})[kindOf(f)];
  function attachHtml(a) {
    if (!a || !a.url) return "";
    const url = esc(a.url), name = esc(a.name || "");
    if (a.kind === "image") return `<a class="att att-img" href="${url}" data-lightbox="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${name}" loading="lazy"></a>`;
    if (a.kind === "video") return `<div class="att"><video src="${url}" controls preload="metadata" playsinline></video></div>`;
    if (a.kind === "audio") return `<div class="att"><audio src="${url}" controls preload="none"></audio></div>`;
    return `<a class="att att-file" href="${url}" download="${name}" data-no-i18n><i>📎</i><span><b>${name}</b><small>${esc(fmtSize(a.size || 0))}</small></span></a>`;
  }
  const upHtml = m => `<div class="att att-file up" data-no-i18n><i>⏳</i><span><b>${esc(m.up.name)}</b><small class="up-pct">${esc(nf(m.up.pct || 0))}%</small><span class="up-bar"><i style="width:${m.up.pct || 0}%"></i></span></span></div>`;
  function updateProgress(cid, pct) {
    const row = feed.querySelector(`[data-id="p-${CSS.escape(cid)}"]`); if (!row) return;
    const a = row.querySelector(".up-pct"), b = row.querySelector(".up-bar i");
    if (a) a.textContent = nf(pct) + "%"; if (b) b.style.width = pct + "%";
  }

  function toast(text) {
    const el = $("toast"); el.textContent = t(text); el.classList.add("show");
    clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 2400);
  }
  const showModal = id => $(id).classList.add("show");
  const hideModal = id => $(id).classList.remove("show");
  function sheet(title, bodyNode, actions) {
    $("sheet-title").textContent = t(title);
    const body = $("sheet-body"); body.innerHTML = ""; if (bodyNode) body.appendChild(bodyNode);
    const act = $("sheet-actions"); act.innerHTML = "";
    actions.forEach(a => { const b = document.createElement("button"); b.className = "key " + (a.cls || ""); b.textContent = t(a.label); b.onclick = () => { hideModal("sheet"); a.fn && a.fn(); }; act.appendChild(b); });
    showModal("sheet");
  }

  /* ---------- connection ---------- */
  function setConn(state) {
    const el = $("conn"); el.dataset.state = state;
    el.textContent = t(state === "off" ? "اتصال لحظه‌ای قطع است؛ پیام‌ها با روش جایگزین ارسال می‌شوند…" : "در حال اتصال…");
  }
  /* HTTP fallback: while the socket is down we poll every 3 s, so the chat never freezes. */
  let httpLoaded = "", polling = false;
  async function pollHttp() {
    if (polling || live() || !activeGroup || document.hidden) return;
    polling = true;
    try {
      const gid = activeGroup, first = httpLoaded !== gid;
      const r = await fetch("/api/messages?group_id=" + encodeURIComponent(gid) + (first ? "" : "&after=" + (maxSeq[gid] || 0)), {credentials: "same-origin"});
      if (r.status === 401) return void (location.href = "/");
      const d = await r.json();
      if (!r.ok || gid !== activeGroup) return;
      if (first) {
        httpLoaded = gid;
        if (live()) return;
        const pend = msgs.filter(x => x.pending || x.failed);
        msgs = d.messages.concat(pend); hasMore = d.has_more; setMax(d.messages);
        renderAll(); toBottom(); updateHeader(); markRead();
      }
      else d.messages.forEach(onNewMessage);
    } catch (_) {} finally { polling = false; }
  }
  setInterval(pollHttp, 3000); setTimeout(pollHttp, 2500);
  socket.on("connect", () => {
    failures = 0; setConn("on"); httpLoaded = "";
    socket.emit("sync", {last_read: lastRead});
    if (activeGroup) socket.emit("select_group", {group_id: activeGroup});   // reload history after every (re)connect
  });
  socket.on("disconnect", () => setConn("off"));
  socket.on("connect_error", async () => {
    setConn("off"); failures++;
    if (failures === 3) { try { const r = await fetch("/api/me"); if (r.status === 401) location.href = "/"; } catch (_) {} }
  });
  socket.io.on("reconnect_attempt", () => setConn("connecting"));

  /* ---------- rendering ---------- */
  const nearBottom = () => feed.scrollHeight - feed.scrollTop - feed.clientHeight < 140;
  const toBottom = smooth => feed.scrollTo({top: feed.scrollHeight, behavior: smooth ? "smooth" : "auto"});
  function keepScroll(fn) { const nb = nearBottom(), st = feed.scrollTop; fn(); if (nb) toBottom(); else feed.scrollTop = st; }

  function buildMessage(m, cont) {
    const mine = m.username === cfg.username, u = profileOf(m.username);
    const row = document.createElement("article");
    row.className = "msg" + (mine ? " mine" : "") + (cont ? " cont" : "") + (m.pending ? " pending" : "") + (m.failed ? " failed" : "");
    row.dataset.id = m.id;
    const av = {avatar: m.avatar || u.avatar, avatar_url: m.avatar_url || u.avatar_url};
    const quote = m.reply_to ? `<button type="button" class="quote" data-no-i18n data-goto="${esc(m.reply_to)}"><b>${esc(m.reply_name || "")}</b><span>${m.reply_gone ? esc(t("پیام حذف شده")) : esc(m.reply_text === "📎 پیوست" ? t("📎 پیوست") : m.reply_text)}</span></button>` : "";
    const fwd = m.forwarded_from ? `<div class="fwd" data-no-i18n>${esc(tf("فوروارد از {name}", {name: m.forwarded_from}))}</div>` : "";
    row.innerHTML = `<button type="button" class="avatar" data-profile="${esc(m.username)}" aria-label="${esc(t("پروفایل"))}">${avatarHtml(av)}</button><div class="bubble" tabindex="0"><div class="who" data-no-i18n>${esc(m.display_name || u.display_name || m.username)}</div>${fwd}${quote}${m.up ? upHtml(m) : attachHtml(m.attach)}<div class="txt" dir="auto" data-no-i18n></div><div class="foot"><div class="rx-row" data-no-i18n>${chipsHtml(m)}</div><span class="meta"><span>${esc(t(m.pending ? "در حال ارسال…" : m.failed ? "ارسال نشد · برای تلاش دوباره بزن ↻" : (m.edited ? "ویرایش‌شده" : "")))}</span><time>${fmtTime(m.created_at)}</time></span></div></div>`;
    const txt = row.querySelector(".txt");
    if (m.username === BOT_USER) txt.removeAttribute("data-no-i18n");     // bot messages are translated, people's messages never
    txt.textContent = m.text || ""; if (!m.text) txt.hidden = true;
    return row;
  }
  function appendOne(m, prev) {
    const sameDay = prev && dayKey(prev.created_at) === dayKey(m.created_at);
    if (!sameDay) { const d = document.createElement("div"); d.className = "day"; d.textContent = fmtDay(m.created_at); feed.appendChild(d); }
    const cont = sameDay && prev.username === m.username && !m.forwarded_from && (new Date(m.created_at) - new Date(prev.created_at)) < 300000;
    feed.appendChild(buildMessage(m, cont));
  }
  function renderAll() {
    feed.innerHTML = "";
    if (!activeGroup) { feed.innerHTML = `<div class="welcome"><svg class="mark"><use href="#star"/></svg><h3>${esc(t("به Chatroom خوش آمدی"))}</h3><p>${esc(t("یک گفتگو را از لیست انتخاب کن یا با جستجوی نام کاربری، پیام جدید شروع کن."))}</p></div>`; return; }
    if (!msgs.length) {
      const g = groups[activeGroup] || {name: t("گروه")};
      feed.innerHTML = `<div class="empty"><svg class="mark"><use href="#star"/></svg><h3 data-no-i18n>${esc(titleOf(g))}</h3><p>${esc(t("هنوز پیامی نیست. اولین پیام را تو بفرست."))}</p></div>`;
      return;
    }
    let prev = null; msgs.forEach(m => { appendOne(m, prev); prev = m; });
  }
  const setMax = list => list.forEach(m => { if (m.seq) maxSeq[m.group_id] = Math.max(maxSeq[m.group_id] || 0, m.seq); });

  function markRead() {
    if (document.hidden) return;
    if (maxSeq[activeGroup] && lastRead[activeGroup] !== maxSeq[activeGroup]) { lastRead[activeGroup] = maxSeq[activeGroup]; saveLR(); }
    if (unread[activeGroup]) { unread[activeGroup] = 0; renderGroupList(); }
    updateTitle();
  }
  function updateTitle() {
    const n = Object.values(unread).reduce((a, b) => a + b, 0);
    document.title = (n ? `(${n.toLocaleString(LOC)}) ` : "") + BASE_TITLE;
  }
  document.addEventListener("visibilitychange", markRead);

  /* ---------- groups / members ---------- */
  const dmPeer = g => g && g.type === "dm" ? (g.members.find(n => n !== cfg.username) || cfg.username) : null;
  const titleOf = g => { const p = dmPeer(g); return p ? (profileOf(p).display_name || p) : (g.name || t("گروه")); };
  const fmtShort = iso => new Date(iso).toDateString() === new Date().toDateString() ? fmtTime(iso) : new Date(iso).toLocaleDateString(LOC, {month: "short", day: "numeric"});
  let searchQ = "", searchRes = [];
  function renderGroupList() {
    const list = $("group-list"); list.innerHTML = "";
    const q = searchQ.trim().toLowerCase().replace(/^@/, "");
    const items = Object.entries(groups)
      .filter(([id, g]) => !q || titleOf(g).toLowerCase().includes(q) || (dmPeer(g) || "").toLowerCase().includes(q))
      .sort((a, b) => ((b[1].last && b[1].last.created_at) || "9").localeCompare((a[1].last && a[1].last.created_at) || "9"));
    items.forEach(([id, g]) => {
      const peer = dmPeer(g), pu = peer ? profileOf(peer) : null, last = g.last, n = unread[id] || 0;
      const who = last ? (last.username === cfg.username ? t("تو:") + " " : (peer ? "" : (profileOf(last.username).display_name || last.username) + ": ")) : "";
      const preview = last ? who + pv(last.text) : (peer ? "@" + peer : (g.description || t("گفت‌وگوی گروهی")));
      const b = document.createElement("button");
      b.className = "group-item" + (id === activeGroup ? " active" : ""); b.dataset.groupId = id;
      b.innerHTML = `<span class="avatar">${pu ? avatarHtml(pu) : groupAvatarHtml(g)}${peer && online.has(peer) ? '<i class="on-dot"></i>' : ""}</span><span class="group-text" data-no-i18n><strong>${esc(titleOf(g))}</strong><small>${esc(preview)}</small></span><span class="group-meta">${last ? `<span>${fmtShort(last.created_at)}</span>` : ""}${n ? `<span class="badge">${n > 99 ? nf(99) + "+" : n.toLocaleString(LOC)}</span>` : ""}</span>`;
      b.addEventListener("click", () => selectGroup(id));
      list.appendChild(b);
    });
    if (!items.length && !searchRes.length) list.innerHTML = `<div class="welcome"><p>${q ? esc(t("گفتگویی پیدا نشد.")) : esc(t("هنوز گفتگویی نداری.")) + "<br>" + esc(t("نام کاربری کسی را بالا جستجو کن و پیام بده."))}</p></div>`;
    if (searchRes.length) {
      const h = document.createElement("div"); h.className = "side-sec"; h.textContent = t("کاربران"); list.appendChild(h);
      searchRes.forEach(u => {
        users[u.username] = Object.assign(users[u.username] || {}, u);
        const b = document.createElement("button"); b.className = "group-item";
        b.innerHTML = `<span class="avatar">${avatarHtml(u)}</span><span class="group-text" data-no-i18n><strong>${esc(u.display_name || u.username)}</strong><small>@${esc(u.username)}</small></span>`;
        b.addEventListener("click", () => startDm(u.username)); list.appendChild(b);
      });
    }
  }
  function renderMembers() {
    const g = groups[activeGroup], list = $("members-list"); list.innerHTML = "";
    const rank = {owner: 0, admin: 1, member: 2};
    const names = [...(g ? g.members : [])].sort((x, y) => (rank[roleOf(g, x)] - rank[roleOf(g, y)]) || (online.has(y) - online.has(x)) || x.localeCompare(y));
    names.forEach(name => {
      const u = profileOf(name), role = roleOf(g, name), row = document.createElement("button");
      row.className = "member"; row.type = "button";
      const badge = g && g.type !== "dm" && role !== "member" ? `<em class="role ${role}">${esc(t(role === "owner" ? "مالک" : "ادمین"))}</em>` : "";
      row.innerHTML = `<span class="avatar">${avatarHtml(u)}</span><span class="member-info" data-no-i18n><strong>${esc(u.display_name || name)}</strong><span>@${esc(name)}</span></span>${badge}<i class="dot ${online.has(name) ? "on" : ""}"></i>`;
      row.addEventListener("click", () => name === cfg.username || !g || g.type === "dm" ? openUserProfile(name) : openMemberSheet(name));
      list.appendChild(row);
    });
    $("member-count").textContent = names.length.toLocaleString(LOC);
    $("online-count").textContent = names.filter(n => online.has(n)).length.toLocaleString(LOC);
    document.dispatchEvent(new CustomEvent("cr:members"));
  }
  function updateHeaderCore() {
    const g = groups[activeGroup], peer = dmPeer(g);
    document.body.dataset.kind = !g ? "none" : (peer ? "dm" : "group");
    if (!g) { $("group-name-head").textContent = "Chatroom"; $("group-description").textContent = ""; $("head-avatar").innerHTML = ""; return; }
    $("group-name-head").textContent = titleOf(g);
    $("group-description").textContent = peer ? (online.has(peer) ? t("آنلاین") : "@" + peer) : (g.description || t("گفت‌وگوی گروهی"));
    $("head-avatar").innerHTML = peer ? avatarHtml(profileOf(peer)) : groupAvatarHtml(g);
    $("edit-group-name").value = g.name || ""; $("edit-group-description").value = g.description || "";
  }
  function selectGroup(id) {
    if (!groups[id]) return;
    activeGroup = id; httpLoaded = ""; msgs = []; hasMore = false; clearCtx(); closeMenu(); typers.clear(); renderTyping();
    try { localStorage.setItem(LAST_KEY, id); } catch (_) {}
    history.replaceState(null, "", "?group=" + encodeURIComponent(id));
    feed.innerHTML = `<div class="empty"><p>${esc(t("در حال بارگذاری…"))}</p></div>`;
    updateHeader(); renderGroupList(); renderMembers();
    socket.emit("select_group", {group_id: id}); if (!live()) setTimeout(pollHttp, 50);
    $("sidebar").classList.remove("open"); setPeople(false);
  }

  /* ---------- socket events ---------- */
  socket.on("group_history", d => {
    if (d.group) groups[d.group_id] = Object.assign({}, groups[d.group_id], d.group);
    if (d.group_id !== activeGroup) return;
    const pend = msgs.filter(x => (x.pending || x.failed) && x.group_id === d.group_id && !d.messages.some(y => y.cid && y.cid === x.cid));
    msgs = d.messages.concat(pend); hasMore = d.has_more; setMax(d.messages);
    renderAll(); toBottom(); updateHeader(); renderMembers(); renderGroupList(); markRead();
  });
  socket.on("older_messages", d => {
    loadingOlder = false;
    if (d.group_id !== activeGroup) return;
    const h = feed.scrollHeight; msgs = d.messages.concat(msgs); hasMore = d.has_more;
    renderAll(); feed.scrollTop = feed.scrollHeight - h;
  });
  socket.on("unread", d => { Object.entries(d.counts || {}).forEach(([g, n]) => { if (g !== activeGroup) unread[g] = n; }); renderGroupList(); updateTitle(); });
  function onNewMessage(m) {
    setMax([m]);
    if (!groups[m.group_id]) return;
    groups[m.group_id].last = {username: m.username, text: previewOf(m), created_at: m.created_at, seq: m.seq}; renderGroupList();
    if (m.group_id !== activeGroup) {
      if (m.username !== cfg.username) { unread[m.group_id] = (unread[m.group_id] || 0) + 1; renderGroupList(); updateTitle(); }
      return;
    }
    const i = m.cid ? msgs.findIndex(x => (x.pending || x.failed) && x.cid === m.cid) : -1;
    if (i >= 0) { msgs[i] = m; keepScroll(renderAll); }
    else if (!msgs.some(x => x.id === m.id)) {
      const stick = nearBottom() || m.username === cfg.username, prev = msgs[msgs.length - 1];
      if (!msgs.length) feed.innerHTML = "";
      msgs.push(m); appendOne(m, prev);
      if (stick) toBottom(true); else { awayCount++; syncJump(); }
    }
    typers.delete(m.username); renderTyping();
    if (document.hidden && m.username !== cfg.username) { unread[m.group_id] = (unread[m.group_id] || 0) + 1; updateTitle(); } else markRead();
  }
  socket.on("new_message", onNewMessage);
  socket.on("message_updated", m => {
    const i = msgs.findIndex(x => x.id === m.id); if (i < 0) return;
    msgs[i] = m; keepScroll(renderAll);
  });
  socket.on("message_deleted", d => {
    if (d.group_id !== activeGroup) return;
    msgs = msgs.filter(x => x.id !== d.id); closeMenu(); keepScroll(renderAll);
  });
  socket.on("action_error", d => toast(d.error || "عملیات انجام نشد."));
  socket.on("presence", d => { online = new Set(d.online || []); renderMembers(); renderGroupList(); updateHeader(); });
  function dropGroup(id) {                         // left, kicked out or deleted
    if (!groups[id]) return;
    delete groups[id]; delete unread[id];
    if (activeGroup === id) {
      activeGroup = ""; msgs = []; hasMore = false; ctx = null; $("ctx-bar").hidden = true; closeMenu(); typers.clear(); renderTyping();
      try { localStorage.removeItem(LAST_KEY); } catch (_) {}
      history.replaceState(null, "", location.pathname); $("sidebar").classList.add("open"); setPeople(false);
    }
    renderAll(); updateHeader(); renderGroupList(); renderMembers(); updateTitle();
  }
  socket.on("groups_snapshot", d => {
    Object.assign(users, d.users || {});
    const fresh = d.groups || {};
    Object.keys(groups).forEach(id => { if (!fresh[id]) dropGroup(id); });
    Object.keys(fresh).forEach(id => { groups[id] = Object.assign({}, groups[id], fresh[id]); });
    renderGroupList(); updateHeader(); renderMembers();
  });
  socket.on("removed_from_group", d => { if (d && groups[d.id]) { dropGroup(d.id); toast("از این گروه حذف شدی."); } });
  socket.on("group_deleted", d => { if (d && groups[d.id]) { dropGroup(d.id); toast("گروه حذف شد."); } });
  socket.on("group_updated", d => {
    if (!d || !d.group) return; groups[d.id] = Object.assign({}, groups[d.id], d.group); renderGroupList();
    if (d.id === activeGroup) { updateHeader(); renderMembers(); }
  });
  socket.on("profile_updated", u => {
    users[u.username] = u;
    if (u.username === cfg.username) { $("my-avatar").innerHTML = avatarHtml(u); $("my-display").textContent = u.display_name; }
    msgs.forEach(m => { if (m.username === u.username) Object.assign(m, {display_name: u.display_name, avatar: u.avatar, avatar_url: u.avatar_url}); });
    keepScroll(renderAll); renderMembers(); renderGroupList(); updateHeader();
  });
  socket.on("typing", d => {
    if (d.group_id !== activeGroup || d.username === cfg.username) return;
    clearTimeout(typers.get(d.username)); typers.delete(d.username);
    if (d.typing) typers.set(d.username, setTimeout(() => { typers.delete(d.username); renderTyping(); }, 5000));
    renderTyping();
  });
  function renderTyping() {
    const names = [...typers.keys()].map(n => profileOf(n).display_name || n), el = $("typing");
    el.textContent = !names.length ? "" : names.length > 2 ? t("چند نفر در حال نوشتن‌اند…") :
      names.length === 2 ? tf("{a} و {b} در حال نوشتن…", {a: names[0], b: names[1]}) : tf("{a} در حال نوشتن…", {a: names[0]});
    el.classList.toggle("on", names.length > 0);
  }

  /* ---------- scroll: older history + jump button ---------- */
  function syncJump() {
    const away = !nearBottom(); $("jump").hidden = !away;
    if (!away) awayCount = 0;
    const b = $("jump-n"); b.hidden = !awayCount; b.textContent = awayCount.toLocaleString(LOC);
  }
  feed.addEventListener("scroll", () => {
    syncJump(); if (Date.now() > popLock) closeMenu();
    if (feed.scrollTop < 80 && hasMore && !loadingOlder && msgs.length) {
      const first = msgs.find(m => m.seq); if (!first) return;
      loadingOlder = true; setTimeout(() => { loadingOlder = false; }, 6000);
      socket.emit("load_older", {group_id: activeGroup, before: first.seq});
    }
  });
  $("jump").addEventListener("click", () => toBottom(true));

  /* ---------- composer ---------- */
  function autosize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 140) + "px"; }
  function setCtx(kind, id, name, text) {
    ctx = {kind, id, name, text};
    $("ctx-kind").textContent = kind === "edit" ? t("ویرایش پیام") : tf("پاسخ به {name}", {name});
    $("ctx-text").textContent = text.slice(0, 80); $("ctx-bar").hidden = false;
  }
  function clearCtx() { if (ctx && ctx.kind === "edit") { input.value = ""; autosize(); } ctx = null; $("ctx-bar").hidden = true; }
  $("cancel-ctx").addEventListener("click", clearCtx);
  /* ---- attachments: pick a file (or paste an image), optional caption, upload with progress ---- */
  let pendingFile = null;
  const uploads = new Map();                       // cid -> {file}  (kept so a failed upload can be retried)
  const attachInput = $("attach-input"), attachBar = $("attach-bar");
  function setAttach(f) {
    pendingFile = f || null; attachBar.hidden = !f;
    if (f) { $("attach-name").textContent = f.name; $("attach-size").textContent = fmtSize(f.size); $("attach-ico").textContent = kindIcon(f); }
    else attachInput.value = "";
  }
  function pickFile(f) {
    if (!f) return;
    if (!activeGroup) return void toast("یک گفتگو را از لیست انتخاب کن یا با جستجوی نام کاربری، پیام جدید شروع کن.");
    if (!f.size) return void toast("فایل خالی است.");
    if (f.size > MAX_MB * 1048576) return void toast("حجم فایل بیشتر از " + MAX_MB + " مگابایت است.");
    setAttach(f); input.focus();
  }
  $("attach-btn").addEventListener("click", () => attachInput.click());
  attachInput.addEventListener("change", () => pickFile(attachInput.files[0]));
  $("attach-cancel").addEventListener("click", () => setAttach(null));
  input.addEventListener("paste", e => { const f = e.clipboardData && e.clipboardData.files && e.clipboardData.files[0]; if (f) { e.preventDefault(); pickFile(f); } });
  function startUpload(p) {
    const u = uploads.get(p.cid); if (!u) return;
    const fd = new FormData();
    fd.append("file", u.file); fd.append("group_id", p.group_id); fd.append("text", p.text || ""); fd.append("reply_to", p.reply_to || ""); fd.append("cid", p.cid);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload"); xhr.withCredentials = true; xhr.timeout = 300000;
    xhr.upload.onprogress = e => { if (e.lengthComputable) { p.up.pct = Math.round(e.loaded / e.total * 100); updateProgress(p.cid, p.up.pct); } };
    const fail = err => {
      const i = msgs.findIndex(x => x.cid === p.cid);
      if (i >= 0 && msgs[i].pending) { msgs[i].pending = false; msgs[i].failed = true; keepScroll(renderAll); }
      toast(err || "پیام ارسال نشد؛ اینترنتت را بررسی کن و روی پیام بزن.");
    };
    xhr.onerror = () => fail(); xhr.ontimeout = () => fail();
    xhr.onload = () => {
      if (xhr.status === 401) return void (location.href = "/");
      let d = null; try { d = JSON.parse(xhr.responseText); } catch (_) {}
      if (xhr.status >= 200 && xhr.status < 300 && d && d.ok && d.message) { uploads.delete(p.cid); settle(p.cid, d.message); }
      else fail(d && d.error);
    };
    xhr.send(fd);
  }
  let lastTyping = 0;
  input.addEventListener("input", () => {
    autosize();
    if (input.value && Date.now() - lastTyping > 2500) { lastTyping = Date.now(); socket.emit("typing", {group_id: activeGroup, typing: true}); }
  });
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && !coarse && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
    if (e.key === "Escape") clearCtx();
  });
  function burst() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = $("send-button").getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    for (let i = 0; i < 9; i++) {
      const s = document.createElement("i"), a = (i / 9) * Math.PI * 2 + Math.random() * .5, d = 34 + Math.random() * 32;
      s.className = "seed";
      s.style.cssText = `left:${x}px;top:${y}px;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 10}px;--r:${Math.random() * 200}deg`;
      document.body.appendChild(s); setTimeout(() => s.remove(), 700);
    }
  }
  /* ---- delivery: 1) Socket.IO ack  2) HTTP POST fallback  3) "failed" state with tap-to-retry ---- */
  function viaSocket(p) {
    return new Promise(res => {
      if (!live()) return res(null);
      let done = false; const tm = setTimeout(() => { if (!done) res(null); }, 5000);
      socket.emit("send_message", p, r => { done = true; clearTimeout(tm); res(r || null); });
    });
  }
  async function viaHttp(p) {
    try {
      const r = await fetch("/api/messages", {method: "POST", headers: {"Content-Type": "application/json"}, credentials: "same-origin", body: JSON.stringify(p)});
      if (r.status === 401) { location.href = "/"; return {ok: false, error: "نشست تمام شد؛ دوباره وارد شو."}; }
      const d = await r.json().catch(() => null);
      return d && (d.ok || d.error) ? d : null;
    } catch (_) { return null; }
  }
  function settle(cid, m) {                       // replace the pending bubble with the server's message
    const i = msgs.findIndex(x => x.cid === cid && (x.pending || x.failed));
    if (i < 0) return;                            // the live broadcast already did it
    if (msgs.some(x => x.id === m.id)) msgs.splice(i, 1); else msgs[i] = m;
    setMax([m]); keepScroll(renderAll);
    if (groups[m.group_id]) { groups[m.group_id].last = {username: m.username, text: previewOf(m), created_at: m.created_at, seq: m.seq}; renderGroupList(); }
  }
  async function deliver(p) {
    const payload = {text: p.text, group_id: p.group_id, reply_to: p.reply_to, cid: p.cid};
    let r = await viaSocket(payload);
    if (!r) r = await viaHttp(payload);
    const i = msgs.findIndex(x => x.cid === p.cid);
    if (r && r.ok && r.message) return settle(p.cid, r.message);
    if (r && r.ok) return;
    if (i >= 0 && msgs[i].pending) { msgs[i].pending = false; msgs[i].failed = true; keepScroll(renderAll); }
    toast(r && r.error ? r.error : "پیام ارسال نشد؛ اینترنتت را بررسی کن و روی پیام بزن.");
  }
  function retry(m) {
    m.failed = false; m.pending = true; keepScroll(renderAll);
    if (uploads.has(m.cid)) { if (m.up) m.up.pct = 0; return startUpload(m); }
    deliver(m);
  }

  form.addEventListener("submit", e => {
    e.preventDefault();
    const text = input.value.trim(); if (!text && !pendingFile) return;
    if (ctx && ctx.kind === "edit") { if (!text) return; if (!live()) return toast(LIVE_MSG); socket.emit("edit_message", {id: ctx.id, text}); ctx = null; $("ctx-bar").hidden = true; input.value = ""; autosize(); return; }
    const cid = uid(), me = users[cfg.username] || cfg.me, reply = ctx && ctx.kind === "reply" ? ctx : null;
    const p = {id: "p-" + cid, cid, pending: true, group_id: activeGroup, username: cfg.username, display_name: me.display_name,
      avatar: me.avatar, avatar_url: me.avatar_url, text, created_at: new Date().toISOString(),
      reply_to: reply ? reply.id : "", reply_name: reply ? reply.name : "", reply_text: reply ? reply.text : ""};
    if (pendingFile) { p.up = {name: pendingFile.name, size: pendingFile.size, pct: 0}; uploads.set(cid, {file: pendingFile}); }
    if (!msgs.length) feed.innerHTML = "";
    const prev = msgs[msgs.length - 1]; msgs.push(p); appendOne(p, prev); toBottom(true);
    if (p.up) { setAttach(null); startUpload(p); } else deliver(p);
    burst(); ctx = null; $("ctx-bar").hidden = true; input.value = ""; autosize(); input.focus();
  });

  /* =====================================================================
   *  منوی پیام به سبک تلگرام:  نوار ری‌اکشن بالا + منوی عملیات پایین
   *  ری‌اکشن‌ها داخل خود حباب، زیر متن و کنار ساعت نشان داده می‌شوند.
   * ===================================================================== */
  const QUICK = ["🤣", "😄", "🤪", "❤️", "👍", "👎", "🔥"];
  const ICO = {
    reply: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v3"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/>',
    forward: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0-6 6v3"/>',
    pin: '<path d="M12 17v5"/><path d="M8.5 3h7l-1 6.2 2.5 2.8v2H7v-2l2.5-2.8z"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    delete: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
    chev: '<path d="M6 9l6 6 6-6"/>'
  };
  const svg = k => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[k]}</svg>`;
  const myReaction = m => ((m.reactions || []).find(r => r.users.includes(cfg.username)) || {}).emoji;
  const miniAv = n => { const u = profileOf(n); return u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="">` : esc([...(u.display_name || n || "?")][0] || "?"); };
  function chipsHtml(m) {
    return (m.reactions || []).map(r => {
      const mine = r.users.includes(cfg.username);
      const who = r.users.length <= 3 ? `<span class="rx-avs">${r.users.map(n => `<span class="rx-av">${miniAv(n)}</span>`).join("")}</span>` : `<b class="rx-n">${nf(r.users.length)}</b>`;
      return `<button type="button" class="rx-chip${mine ? " mine" : ""}" data-rx="${esc(r.emoji)}"><span class="rx-e">${esc(r.emoji)}</span>${who}</button>`;
    }).join("");
  }
  function setReactions(id, list) {
    const m = msgs.find(x => x.id === id); if (!m) return;
    m.reactions = list || [];
    const row = feed.querySelector(`[data-id="${CSS.escape(id)}"] .rx-row`); if (row) row.innerHTML = chipsHtml(m);
  }
  async function react(id, emoji) {
    const d = await apiPost("/api/react", {id, emoji});
    if (d && d.ok) setReactions(id, d.reactions);
  }
  socket.on("reaction_update", d => { if (d && d.id) setReactions(d.id, d.reactions); });

  const css = document.createElement("style"); css.id = "cr-msg-style";
  css.textContent = `
.msg .bubble .foot{display:flex!important;flex-wrap:wrap;align-items:center;gap:2px 10px}
.msg .bubble .foot .meta{display:inline-flex;align-items:center;gap:6px;margin-inline-start:auto;white-space:nowrap}
.rx-row{display:flex;flex-wrap:wrap;gap:5px;direction:ltr;margin:5px 0 2px;max-width:100%}
.rx-row:empty{display:none}
.rx-chip{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 9px 0 7px;border:0;border-radius:999px;color:inherit;background:rgba(255,255,255,.17);font:inherit;cursor:pointer;animation:rxIn .28s cubic-bezier(.2,1.5,.4,1);transition:transform .15s}
.rx-chip:active{transform:scale(.92)}
.rx-chip.mine{background:linear-gradient(135deg,#8f80ff,#5a44e8);color:#fff;box-shadow:0 3px 12px rgba(110,90,250,.4)}
.rx-chip .rx-e{font-size:1.1rem!important;line-height:1;opacity:1!important}
.rx-chip .rx-n{font-size:.8rem!important;font-weight:700;opacity:1!important}
.rx-chip img.ap-emoji{width:1.2rem!important;height:1.2rem!important;vertical-align:middle!important;margin:0!important}
.rx-avs{display:inline-flex;direction:ltr;align-items:center}
.rx-av{width:20px;height:20px;border-radius:50%;margin-left:-6px;display:grid;place-items:center;overflow:hidden;font-size:.62rem!important;font-weight:700;line-height:1;color:#fff!important;opacity:1!important;background:linear-gradient(135deg,#6b5bd6,#3b2f8f);border:1.5px solid rgba(20,18,38,.75)}
.rx-av:first-child{margin-left:0}.rx-av img{width:100%;height:100%;object-fit:cover;display:block}
@keyframes rxIn{from{transform:scale(.55);opacity:0}to{transform:none;opacity:1}}
.msg.picked .bubble{outline:2px solid rgba(155,140,255,.75);outline-offset:2px}
#mp-bar,#mp-menu{position:fixed;z-index:2147482000;opacity:0;pointer-events:none;transform:scale(.92);transform-origin:center top;transition:opacity .14s,transform .16s cubic-bezier(.2,.9,.3,1.1);
  background:var(--panel,var(--night,#1c1b2b));color:inherit;border:1px solid rgba(255,255,255,.12);box-shadow:0 10px 34px rgba(0,0,0,.5)}
#mp-bar.open,#mp-menu.open{opacity:1;pointer-events:auto;transform:none}
#mp-bar{display:flex;align-items:center;gap:1px;padding:6px 8px;border-radius:999px;direction:ltr}
#mp-bar button{background:none;border:0;font-size:1.7rem;line-height:1;padding:3px 4px;border-radius:50%;cursor:pointer;color:inherit;transition:transform .12s}
#mp-bar button:active{transform:scale(1.25)}
#mp-bar button.mine{background:rgba(155,140,255,.32)}
#mp-bar img.ap-emoji{width:1.8rem!important;height:1.8rem!important;vertical-align:middle!important;margin:0!important}
#mp-bar .mp-more{width:34px;height:34px;display:grid;place-items:center;padding:0;margin-inline-start:3px;font-size:1rem;background:rgba(255,255,255,.16);border-radius:50%}
#mp-menu{min-width:214px;padding:6px;border-radius:18px;direction:rtl}
#mp-menu button{display:flex;align-items:center;gap:16px;width:100%;padding:12px 14px;border:0;background:none;color:inherit;font:inherit;font-size:1.02rem;border-radius:12px;text-align:start;cursor:pointer}
#mp-menu button:hover,#mp-menu button:active{background:rgba(255,255,255,.1)}
#mp-menu button.del{color:#ff6b6b}
.pinbar{display:flex;align-items:center;gap:10px;padding:7px 12px;background:var(--panel,rgba(30,28,48,.92));border-bottom:1px solid rgba(255,255,255,.1);cursor:pointer}
.pinbar[hidden]{display:none}
.pinbar .pb-line{display:flex;flex-direction:column;gap:2px;height:30px;width:3px;flex:none}
.pinbar .pb-line i{flex:1;border-radius:2px;background:rgba(155,140,255,.35)}.pinbar .pb-line i.on{background:#9b8cff}
.pinbar .pb-txt{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.35}
.pinbar .pb-txt b{font-size:.78rem;color:#b9a9ff}.pinbar .pb-txt span{font-size:.88rem;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pinbar .pb-x{border:0;background:none;color:inherit;opacity:.65;font-size:1rem;padding:6px;cursor:pointer}
.composer.locked{opacity:.55;pointer-events:none}`;
  document.head.appendChild(css);

  let popLock = 0;
  const popBar = document.createElement("div"), popMenu = document.createElement("div");
  popBar.id = "mp-bar"; popMenu.id = "mp-menu"; popBar.setAttribute("role", "toolbar"); popMenu.setAttribute("role", "menu");
  document.body.append(popBar, popMenu);
  function closeMenu() {
    popBar.classList.remove("open"); popMenu.classList.remove("open");
    document.querySelectorAll(".msg.picked").forEach(r => r.classList.remove("picked")); menuFor = null;
    if (window.CRPlus) window.CRPlus.closePop();
  }
  function openMenu(row, m) {
    closeMenu(); menuFor = m.id; row.classList.add("picked");
    const g = groups[m.group_id], mine = m.username === cfg.username, special = /^\u27e6/.test(m.text || "");
    const canDel = mine || iAmAdmin(g), canPin = !!g && (g.type === "dm" || iAmAdmin(g)), pinned = !!g && (g.pins || []).some(p => p.id === m.id), cur = myReaction(m);
    popBar.innerHTML = QUICK.map(e => `<button type="button" data-rx="${esc(e)}" class="${e === cur ? "mine" : ""}">${e}</button>`).join("")
      + `<button type="button" class="mp-more" data-more aria-label="${esc(t("ایموجی بیشتر"))}">${svg("chev")}</button>`;
    const items = [["reply", "پاسخ"]];
    if (m.text && !special) items.push(["copy", "کپی"]);
    items.push(["forward", "فوروارد"]);
    if (canPin) items.push([pinned ? "unpin" : "pin", pinned ? "برداشتن سنجاق" : "سنجاق"]);
    if (mine && m.text && !special) items.push(["edit", "ویرایش"]);
    if (canDel) items.push(["delete", "حذف"]);
    popMenu.innerHTML = items.map(([a, l]) => `<button type="button" role="menuitem" data-act="${a}" class="${a === "delete" ? "del" : ""}">${svg(a === "unpin" ? "pin" : a)}<span>${esc(t(l))}</span></button>`).join("");
    popBar.classList.add("open"); popMenu.classList.add("open"); popLock = Date.now() + 350;
    const r = row.querySelector(".bubble").getBoundingClientRect(), bw = popBar.offsetWidth, bh = popBar.offsetHeight, mw = popMenu.offsetWidth, mh = popMenu.offsetHeight;
    const head = document.querySelector(".room-head"), topLimit = Math.max(8, (head ? head.getBoundingClientRect().bottom : 0) + 6);
    const bt = Math.max(topLimit, r.top - bh - 8);
    let mt = r.bottom + 8; if (mt + mh > innerHeight - 8) mt = Math.max(bt + bh + 8, innerHeight - mh - 8);
    popBar.style.top = bt + "px"; popBar.style.left = Math.min(Math.max(8, r.left + r.width / 2 - bw / 2), innerWidth - bw - 8) + "px";
    popMenu.style.top = mt + "px"; popMenu.style.left = Math.min(Math.max(8, mine ? r.left : r.right - mw), innerWidth - mw - 8) + "px";
  }
  const msgOf = el => { const row = el.closest(".msg"); return row ? msgs.find(x => x.id === row.dataset.id) : null; };
  feed.addEventListener("click", e => {
    const prof = e.target.closest("[data-profile]"); if (prof) return openUserProfile(prof.dataset.profile);
    const go = e.target.closest("[data-goto]"); if (go) return gotoMsg(go.dataset.goto);
    const lb = e.target.closest("[data-lightbox]"); if (lb) { e.preventDefault(); return openLightbox(lb.dataset.lightbox); }
    const chip = e.target.closest(".rx-chip"); if (chip) { const cm = msgOf(chip); if (cm && !cm.pending) react(cm.id, chip.dataset.rx); return; }
    if (e.target.closest("video, audio, a.att-file, .pp-card, a[href]")) return;      // media controls, downloads, location / poll cards
    const bubble = e.target.closest(".bubble"); if (!bubble || String(getSelection())) return;
    const m = msgOf(bubble); if (!m) return;
    if (m.failed) return retry(m);
    if (m.pending) return;
    const now = Date.now();
    if (lastTap.id === m.id && now - lastTap.t < 320) { lastTap = {}; closeMenu(); return startReply(m); }
    lastTap = {id: m.id, t: now};
    menuFor === m.id ? closeMenu() : openMenu(bubble.closest(".msg"), m);
  });
  feed.addEventListener("contextmenu", e => {
    const b = e.target.closest(".bubble"), m = b && msgOf(b);
    if (m && !m.pending) { e.preventDefault(); openMenu(b.closest(".msg"), m); }
  });
  document.addEventListener("click", e => { if (menuFor && !e.target.closest(".bubble") && !e.target.closest("#mp-bar,#mp-menu,.pp-pop")) closeMenu(); });
  /* tapping anywhere outside the members drawer closes it (mobile) */
  document.addEventListener("click", e => {
    if (peopleEl.classList.contains("open") && drawerMode() && !e.target.closest("#people") && !e.target.closest("#open-members") && !e.target.closest(".modal") && !e.target.closest("#mp-bar,#mp-menu")) setPeople(false);
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { closeMenu(); setPeople(false); document.querySelectorAll(".modal.show").forEach(m => m.classList.remove("show")); $("lightbox").hidden = true; } });
  popBar.addEventListener("click", e => {
    const b = e.target.closest("button"), m = msgs.find(x => x.id === menuFor); if (!b || !m) return;
    if (b.hasAttribute("data-more")) {
      const P = window.CRPlus; if (!P) return toast("پنل ایموجی هنوز آماده نیست.");
      const id = m.id, r = popBar.getBoundingClientRect();
      P.show(P.emojiPicker(em => { closeMenu(); react(id, em); }), {getBoundingClientRect: () => r}, false);
      return;
    }
    if (b.dataset.rx) { const id = m.id; closeMenu(); react(id, b.dataset.rx); }
  });
  const pinMsg = (m, pin) => live() ? (socket.emit("pin_message", {id: m.id, pin}), toast(pin ? "پیام سنجاق شد." : "سنجاق برداشته شد.")) : toast(LIVE_MSG);
  const ACT = {reply: m => startReply(m), copy: m => copyMsg(m), forward: m => askForward(m), edit: m => startEdit(m), delete: m => askDelete(m), pin: m => pinMsg(m, true), unpin: m => pinMsg(m, false)};
  popMenu.addEventListener("click", e => {
    const b = e.target.closest("[data-act]"), m = msgs.find(x => x.id === menuFor); if (!b || !m) return;
    closeMenu(); ACT[b.dataset.act](m);
  });

  /* ---------- پیام سنجاق‌شده (نوار زیر هدر) ---------- */
  const pinBar = $("pin-bar"); let pinIdx = 0, pinSig = "";
  function renderPin() {
    if (!pinBar) return;
    const g = groups[activeGroup], pins = (g && g.pins) || [];
    if (!pins.length) { pinBar.hidden = true; pinSig = ""; return; }
    const sig = pins.map(p => p.id).join(",");
    if (sig !== pinSig) { pinSig = sig; pinIdx = pins.length - 1; }
    pinIdx = Math.min(Math.max(pinIdx, 0), pins.length - 1);
    const p = pins[pinIdx], canUnpin = g.type === "dm" || iAmAdmin(g);
    pinBar.hidden = false;
    pinBar.innerHTML = `<span class="pb-line">${pins.map((_, i) => `<i class="${i === pinIdx ? "on" : ""}"></i>`).join("")}</span>`
      + `<span class="pb-txt" data-no-i18n><b>${esc(pins.length > 1 ? tf("پیام سنجاق‌شده #{n}", {n: nf(pinIdx + 1)}) : t("پیام سنجاق‌شده"))}</b><span>${esc(pv(p.text) || "…")}</span></span>`
      + (canUnpin ? `<button type="button" class="pb-x" data-unpin="${esc(p.id)}" aria-label="${esc(t("برداشتن سنجاق"))}">✕</button>` : "");
  }
  if (pinBar) pinBar.addEventListener("click", e => {
    const x = e.target.closest("[data-unpin]");
    if (x) return void (live() ? socket.emit("pin_message", {id: x.dataset.unpin, pin: false}) : toast(LIVE_MSG));
    const g = groups[activeGroup], pins = (g && g.pins) || []; if (!pins.length) return;
    gotoMsg(pins[pinIdx].id); pinIdx = (pinIdx - 1 + pins.length) % pins.length; renderPin();
  });
  /* گروه «فقط ادمین‌ها پیام بدهند»: نوار پیام برای اعضای عادی قفل می‌شود */
  function updateComposer() {
    const g = groups[activeGroup], locked = !!g && g.type !== "dm" && !!g.only_admins_post && !iAmAdmin(g);
    form.classList.toggle("locked", locked); input.disabled = locked;
    input.placeholder = t(locked ? "فقط ادمین‌ها می‌توانند پیام بفرستند" : "پیامت را بنویس…");
  }
  function updateHeader() {
    updateHeaderCore(); renderPin(); updateComposer();
    document.dispatchEvent(new CustomEvent("cr:group", {detail: {id: activeGroup}}));
  }
  function openGroupInfo() { if (!(window.CRGroupInfo && window.CRGroupInfo.open())) openGroupSettings(); }

  function openLightbox(url) { $("lightbox-img").src = url; $("lightbox").hidden = false; }
  $("lightbox").addEventListener("click", () => { $("lightbox").hidden = true; $("lightbox-img").removeAttribute("src"); });
  function gotoMsg(id) {
    const row = feed.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!row) return toast("پیام اصلی در بخش بارگذاری‌شده نیست.");
    row.scrollIntoView({block: "center", behavior: "smooth"}); row.classList.add("flash"); setTimeout(() => row.classList.remove("flash"), 1200);
  }
  function startReply(m) { setCtx("reply", m.id, m.display_name || m.username, m.text || pv(previewOf(m))); input.focus(); }
  function startEdit(m) { setCtx("edit", m.id, "", m.text); input.value = m.text; autosize(); input.focus(); }
  async function copyMsg(m) {
    try { await navigator.clipboard.writeText(m.text); toast("کپی شد"); }
    catch (_) { const ta = document.createElement("textarea"); ta.value = m.text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); toast("کپی شد"); }
  }
  function askDelete(m) { sheet("این پیام حذف شود؟", null, [{label: "نه", fn: null}, {label: "حذف", cls: "hot", fn: () => live() ? socket.emit("delete_message", {id: m.id}) : toast(LIVE_MSG)}]); }
  function askForward(m) {
    const others = Object.entries(groups).filter(([id]) => id !== activeGroup);
    const box = document.createElement("div");
    if (!others.length) box.textContent = t("برای فوروارد باید عضو گروه دیگری هم باشی.");
    others.forEach(([id, g]) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "pick";
      b.innerHTML = `<span class="group-tile">${groupAvatarHtml(g)}</span><strong data-no-i18n>${esc(titleOf(g))}</strong>`;
      b.onclick = () => { hideModal("sheet"); if (!live()) return toast(LIVE_MSG); socket.emit("forward_message", {id: m.id, target_group: id}); toast("فوروارد شد"); };
      box.appendChild(b);
    });
    sheet("فوروارد به…", box, [{label: "بستن"}]);
  }

  /* ---------- modals & API calls ---------- */
  document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => hideModal(b.dataset.close)));
  document.querySelectorAll(".modal").forEach(m => m.addEventListener("click", e => { if (e.target === m) m.classList.remove("show"); }));
  $("open-profile").addEventListener("click", () => showModal("profile-modal"));
  $("open-group").addEventListener("click", () => openGroupInfo());
  $("open-create-group").addEventListener("click", () => showModal("create-group-modal"));
  $("open-sidebar").addEventListener("click", () => $("sidebar").classList.add("open"));
  $("close-sidebar").addEventListener("click", () => $("sidebar").classList.remove("open"));
  $("open-members").addEventListener("click", () => setPeople(true));
  $("close-members").addEventListener("click", () => setPeople(false));

  async function post(url, opts, statusEl, okText, modal) {
    statusEl.textContent = t("در حال ذخیره…");
    try {
      const r = await fetch(url, opts), d = await r.json();
      if (!r.ok) throw new Error(d.error || "خطا");
      statusEl.textContent = t(okText); if (modal) setTimeout(() => hideModal(modal), 600);
      return d;
    } catch (err) { statusEl.textContent = t(err instanceof TypeError ? "اتصال به سرور برقرار نشد. اینترنتت را بررسی کن." : err.message); return null; }
  }
  $("save-profile").addEventListener("click", async () => {
    const fd = new FormData();
    fd.append("avatar", $("profile-avatar").value); fd.append("display_name", $("profile-name").value); fd.append("bio", $("profile-bio").value);
    fd.append("show_phone", $("profile-show-phone").checked ? "1" : "0"); fd.append("show_email", $("profile-show-email").checked ? "1" : "0");
    const photo = $("profile-photo").files[0]; if (photo) fd.append("avatar_photo", photo);
    const d = await post("/api/profile", {method: "POST", body: fd}, $("profile-status"), "پروفایل ذخیره شد.", "profile-modal");
    if (d) users[d.user.username] = d.user;
  });
  $("save-group").addEventListener("click", () => post(`/api/group/${encodeURIComponent(activeGroup)}`,
    {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({name: $("edit-group-name").value, description: $("edit-group-description").value})},
    $("group-status"), "تنظیمات ذخیره شد.", "group-modal"));
  $("create-group-submit").addEventListener("click", async () => {
    const d = await post("/api/groups", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({name: $("new-group-name").value, description: $("new-group-description").value})},
      $("create-group-status"), "گروه ساخته شد.", "create-group-modal");
    if (!d) return;
    groups[d.id] = d.group; $("new-group-name").value = ""; $("new-group-description").value = ""; selectGroup(d.id);
  });
  async function openUserProfile(name) {
    try {
      const r = await fetch(`/api/user/${encodeURIComponent(name)}`), d = await r.json(); if (!r.ok) throw 0;
      const u = d.user; users[u.username] = u;
      $("view-user-avatar").innerHTML = avatarHtml(u); $("view-user-name").textContent = u.display_name || u.username;
      $("view-user-id").textContent = "@" + u.username; $("view-user-bio").textContent = u.bio || t("هنوز بیویی ننوشته.");
      const c = []; if (u.phone) c.push(`<div><b>${esc(t("موبایل:"))}</b><span dir="ltr">${esc(u.phone)}</span></div>`); if (u.email) c.push(`<div><b>${esc(t("ایمیل:"))}</b><span dir="ltr">${esc(u.email)}</span></div>`);
      $("view-contact").innerHTML = c.join(""); $("view-dm").hidden = name === cfg.username; $("view-dm").onclick = () => startDm(name);
      showModal("user-view-modal");
    } catch (_) { toast("پروفایل باز نشد."); }
  }
  /* "لینک دعوت": only copies the link (never shown anywhere) */
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (_) {
      try {
        const ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;top:0;left:0;opacity:0"; document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
        const ok = document.execCommand("copy"); ta.remove(); return ok;
      } catch (__) { return false; }
    }
  }
  $("share-group").addEventListener("click", async () => {
    try {
      const r = await fetch(`/api/group/${encodeURIComponent(activeGroup)}/invite`, {method: "POST", credentials: "same-origin"}), d = await r.json();
      if (!r.ok) throw new Error(d.error || "ساخت لینک ناموفق بود");
      if (await copyText(d.invite_url)) toast("لینک دعوت کپی شد");
      else if (navigator.share) navigator.share({url: d.invite_url}).catch(noop);
      else toast("کپی انجام نشد؛ اجازه‌ی کلیپ‌بورد را بررسی کن.");
    } catch (e) { toast(e.message); }
  });

  updateHeader(); renderGroupList(); renderMembers(); renderAll();
  if (!activeGroup) { renderAll(); $("sidebar").classList.add("open"); } else feed.innerHTML = `<div class="empty"><p>${esc(t("در حال بارگذاری…"))}</p></div>`;

  /* ---------- search, DMs, settings ---------- */
  async function startDm(name) {
    try {
      const r = await fetch("/api/dm", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({username: name})}), d = await r.json();
      if (!r.ok) throw new Error(d.error || "گفتگو باز نشد");
      users[d.user.username] = d.user; groups[d.id] = Object.assign({}, groups[d.id], d.group);
      searchQ = ""; searchRes = []; $("chat-search").value = ""; hideModal("user-view-modal"); selectGroup(d.id);
    } catch (e) { toast(e.message); }
  }
  let searchT;
  $("chat-search").addEventListener("input", e => {
    searchQ = e.target.value; const v = searchQ.trim().replace(/^@/, ""); clearTimeout(searchT);
    if (v.length < 2) { searchRes = []; return renderGroupList(); }
    renderGroupList();
    searchT = setTimeout(async () => {
      try { const d = await (await fetch("/api/users/search?q=" + encodeURIComponent(v))).json(); if (searchQ.trim().replace(/^@/, "") === v) { searchRes = d.users || []; renderGroupList(); } } catch (_) {}
    }, 250);
  });
  /* tapping the header opens a DM partner's profile; the members list opens ONLY from the "اعضا" button */
  const headClick = () => { const g = groups[activeGroup], p = dmPeer(g); if (p) openUserProfile(p); else if (g && g.type !== "dm") openGroupInfo(); };
  $("room-title").addEventListener("click", headClick); $("head-avatar").addEventListener("click", headClick);
  $("open-settings").addEventListener("click", () => { $("sidebar").classList.remove("open"); showModal("profile-modal"); });
  $("font-open").addEventListener("click", () => window.CRTheme.openFontPicker());
  $("theme-open").addEventListener("click", () => window.CRTheme.openPicker());
  /* ---------- group management (owner / admins) ---------- */
  async function apiPost(url, body) {
    try {
      const r = await fetch(url, {method: "POST", headers: {"Content-Type": "application/json"}, credentials: "same-origin", body: JSON.stringify(body || {})});
      if (r.status === 401) return void (location.href = "/");
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d.error || "عملیات انجام نشد."); return null; }
      return d;
    } catch (_) { toast("اتصال به سرور برقرار نشد. اینترنتت را بررسی کن."); return null; }
  }
  async function groupApi(action, body, okMsg) {
    const gid = activeGroup, d = await apiPost(`/api/group/${encodeURIComponent(gid)}/${action}`, body);
    if (!d) return null;
    if (d.group && groups[gid]) groups[gid] = Object.assign({}, groups[gid], d.group);
    if (okMsg) toast(okMsg);
    renderMembers(); renderGroupList(); updateHeader();
    return d;
  }
  const confirmSheet = (title, label, fn) => sheet(title, null, [{label: "نه"}, {label, cls: "hot", fn}]);
  function openMemberSheet(name) {
    const g = groups[activeGroup]; if (!g) return;
    const me = roleOf(g, cfg.username), they = roleOf(g, name), u = profileOf(name), shown = u.display_name || name, box = document.createElement("div");
    const head = document.createElement("div"); head.className = "sheet-user"; head.setAttribute("data-no-i18n", "");
    head.innerHTML = `<span class="avatar">${avatarHtml(u)}</span><span><strong>${esc(shown)}</strong><small>@${esc(name)}</small></span>`; box.appendChild(head);
    const add = (label, fn, cls) => { const b = document.createElement("button"); b.type = "button"; b.className = "pick " + (cls || ""); b.textContent = t(label); b.onclick = () => { hideModal("sheet"); fn(); }; box.appendChild(b); };
    add("مشاهده‌ی پروفایل", () => openUserProfile(name));
    if (me === "owner" && they === "member") add("ارتقا به ادمین", () => groupApi("role", {username: name, role: "admin"}, "نقش تغییر کرد."));
    if (me === "owner" && they === "admin") add("برگرداندن به عضو عادی", () => groupApi("role", {username: name, role: "member"}, "نقش تغییر کرد."));
    if (me === "owner") add("انتقال مالکیت", () => confirmSheet(tf("مالکیت گروه به «{name}» منتقل شود؟", {name: shown}), "انتقال مالکیت", () => groupApi("transfer", {username: name}, "مالکیت منتقل شد.")));
    if (they !== "owner" && (me === "owner" || (me === "admin" && they === "member"))) {
      add("حذف از گروه", () => confirmSheet(tf("«{name}» از گروه حذف شود؟", {name: shown}), "حذف", () => groupApi("kick", {username: name, ban: false}, "از گروه حذف شد.")));
      add("حذف و مسدود کردن", () => confirmSheet(tf("«{name}» از گروه حذف و مسدود شود؟", {name: shown}), "حذف", () => groupApi("kick", {username: name, ban: true}, "از گروه حذف شد.")), "del");
    }
    sheet("مدیریت عضو", box, [{label: "بستن"}]);
  }
  async function loadBanned() {
    const gid = activeGroup;
    try {
      const r = await fetch(`/api/group/${encodeURIComponent(gid)}/members`, {credentials: "same-origin"}), d = await r.json();
      if (!r.ok || gid !== activeGroup) return;
      const list = $("banned-list"); list.innerHTML = "";
      (d.banned || []).forEach(n => {
        const row = document.createElement("div"); row.className = "ban-row";
        row.innerHTML = `<span data-no-i18n>@${esc(n)}</span>`;
        const b = document.createElement("button"); b.type = "button"; b.className = "key small"; b.textContent = t("رفع مسدودی");
        b.onclick = async () => { if (await apiPost(`/api/group/${encodeURIComponent(gid)}/unban`, {username: n})) { row.remove(); toast("مسدودی برداشته شد."); $("banned-wrap").hidden = !list.children.length; } };
        row.appendChild(b); list.appendChild(row);
      });
      $("banned-wrap").hidden = !(d.banned || []).length;
    } catch (_) {}
  }
  function openGroupSettings() {
    const g = groups[activeGroup]; if (!g || g.type === "dm") return;
    const role = roleOf(g, cfg.username), admin = role === "owner" || role === "admin";
    $("edit-group-name").readOnly = !admin; $("edit-group-description").readOnly = !admin;
    $("save-group").hidden = !admin; $("reset-invite").hidden = !admin; $("delete-group").hidden = role !== "owner";
    $("group-photo-preview").innerHTML = groupAvatarHtml(g);
    $("group-photo-wrap").hidden = !admin; $("group-photo").value = "";
    $("group-photo-remove").hidden = !admin || !g.avatar_url;
    $("banned-wrap").hidden = true; $("group-status").textContent = "";
    showModal("group-modal");
    if (admin) loadBanned();
  }
  async function sendGroupPhoto(fd) {
    const gid = activeGroup, st = $("group-status"); st.textContent = t("در حال ذخیره…");
    try {
      const r = await fetch(`/api/group/${encodeURIComponent(gid)}/photo`, {method: "POST", body: fd, credentials: "same-origin"});
      if (r.status === 401) return void (location.href = "/");
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { st.textContent = t(d.error || "عملیات انجام نشد."); return; }
      groups[gid] = Object.assign({}, groups[gid], d.group);
      if (gid === activeGroup) { $("group-photo-preview").innerHTML = groupAvatarHtml(groups[gid]); $("group-photo-remove").hidden = !groups[gid].avatar_url; }
      updateHeader(); renderGroupList(); st.textContent = t("ذخیره شد.");
    } catch (_) { st.textContent = t("اتصال به سرور برقرار نشد. اینترنتت را بررسی کن."); }
  }
  $("group-photo").addEventListener("change", e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    if (f.size > 4 * 1048576) return void ($("group-status").textContent = t("حجم عکس باید کمتر از ۴ مگابایت باشد."));
    const fd = new FormData(); fd.append("photo", f); sendGroupPhoto(fd);
  });
  $("group-photo-remove").addEventListener("click", () => { const fd = new FormData(); fd.append("remove", "1"); sendGroupPhoto(fd); });
  $("reset-invite").addEventListener("click", async () => {
    const d = await apiPost(`/api/group/${encodeURIComponent(activeGroup)}/invite/reset`); if (!d) return;
    toast((await copyText(d.invite_url)) ? "لینک دعوت جدید ساخته و کپی شد" : "لینک دعوت جدید ساخته شد");
  });
  $("leave-group").addEventListener("click", () => confirmSheet("از گروه خارج می‌شوی؟", "ترک گروه", async () => {
    const gid = activeGroup, d = await apiPost(`/api/group/${encodeURIComponent(gid)}/leave`);
    if (d) { hideModal("group-modal"); dropGroup(gid); toast("از گروه خارج شدی."); }
  }));
  $("delete-group").addEventListener("click", () => confirmSheet("گروه و همه‌ی پیام‌هایش برای همیشه حذف شود؟", "حذف گروه", async () => {
    const gid = activeGroup, d = await apiPost(`/api/group/${encodeURIComponent(gid)}/delete`);
    if (d) { hideModal("group-modal"); dropGroup(gid); toast("گروه حذف شد."); }
  }));
  const langLink = $("open-lang");   // language picker, comes back to this page afterwards
  if (langLink) langLink.href = "/lang?next=" + encodeURIComponent(location.pathname + location.search);

  /* ---------- API برای فایل‌های دیگر (chat-bg.js, chat-plus.js, group-info.js) ---------- */
  window.CRChat = {
    cfg, socket, groups, users, esc, t, tf, nf, toast, sheet, showModal, hideModal, apiPost, groupApi, confirmSheet, copyText,
    profileOf, avatarHtml, groupAvatarHtml, titleOf, roleOf, iAmAdmin, openMemberSheet, openUserProfile, startDm, dropGroup, live, LIVE_MSG,
    get activeGroup() { return activeGroup; }, get online() { return online; },
    refresh() { renderGroupList(); updateHeader(); renderMembers(); }
  };
  window.dispatchEvent(new Event("cr:ready"));
})();
