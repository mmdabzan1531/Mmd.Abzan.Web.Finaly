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
  const fmtTime = iso => new Date(iso).toLocaleTimeString(LOC, {hour: "2-digit", minute: "2-digit"});
  const fmtDay = iso => new Date(iso).toLocaleDateString(LOC, {weekday: "long", day: "numeric", month: "long"});
  const dayKey = iso => new Date(iso).toDateString();

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
    const quote = m.reply_to ? `<button type="button" class="quote" data-no-i18n data-goto="${esc(m.reply_to)}"><b>${esc(m.reply_name || "")}</b><span>${m.reply_gone ? esc(t("پیام حذف شده")) : esc(m.reply_text)}</span></button>` : "";
    const fwd = m.forwarded_from ? `<div class="fwd" data-no-i18n>${esc(tf("فوروارد از {name}", {name: m.forwarded_from}))}</div>` : "";
    row.innerHTML = `<button type="button" class="avatar" data-profile="${esc(m.username)}" aria-label="${esc(t("پروفایل"))}">${avatarHtml(av)}</button><div class="bubble" tabindex="0"><div class="who" data-no-i18n>${esc(m.display_name || u.display_name || m.username)}</div>${fwd}${quote}<div class="txt" dir="auto" data-no-i18n></div><div class="foot"><span>${esc(t(m.pending ? "در حال ارسال…" : m.failed ? "ارسال نشد · برای تلاش دوباره بزن ↻" : (m.edited ? "ویرایش‌شده" : "")))}</span><time>${fmtTime(m.created_at)}</time></div></div>`;
    row.querySelector(".txt").textContent = m.text;
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
      const preview = last ? who + last.text : (peer ? "@" + peer : (g.description || t("گفت‌وگوی گروهی")));
      const b = document.createElement("button");
      b.className = "group-item" + (id === activeGroup ? " active" : ""); b.dataset.groupId = id;
      b.innerHTML = `<span class="avatar">${pu ? avatarHtml(pu) : esc([...(g.name || t("گروه"))][0])}${peer && online.has(peer) ? '<i class="on-dot"></i>' : ""}</span><span class="group-text" data-no-i18n><strong>${esc(titleOf(g))}</strong><small>${esc(preview)}</small></span><span class="group-meta">${last ? `<span>${fmtShort(last.created_at)}</span>` : ""}${n ? `<span class="badge">${n > 99 ? nf(99) + "+" : n.toLocaleString(LOC)}</span>` : ""}</span>`;
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
    const names = [...(g ? g.members : [])].sort((a, b) => (online.has(b) - online.has(a)) || a.localeCompare(b));
    names.forEach(name => {
      const u = profileOf(name), row = document.createElement("button");
      row.className = "member"; row.type = "button";
      row.innerHTML = `<span class="avatar">${avatarHtml(u)}</span><span class="member-info" data-no-i18n><strong>${esc(u.display_name || name)}</strong><span>@${esc(name)}</span></span><i class="dot ${online.has(name) ? "on" : ""}"></i>`;
      row.addEventListener("click", () => openUserProfile(name));
      list.appendChild(row);
    });
    $("member-count").textContent = names.length.toLocaleString(LOC);
    $("online-count").textContent = names.filter(n => online.has(n)).length.toLocaleString(LOC);
  }
  function updateHeader() {
    const g = groups[activeGroup], peer = dmPeer(g);
    document.body.dataset.kind = !g ? "none" : (peer ? "dm" : "group");
    if (!g) { $("group-name-head").textContent = "Chatroom"; $("group-description").textContent = ""; $("head-avatar").innerHTML = ""; return; }
    $("group-name-head").textContent = titleOf(g);
    $("group-description").textContent = peer ? (online.has(peer) ? t("آنلاین") : "@" + peer) : (g.description || t("گفت‌وگوی گروهی"));
    $("head-avatar").innerHTML = peer ? avatarHtml(profileOf(peer)) : esc([...(g.name || t("گروه"))][0]);
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
    $("sidebar").classList.remove("open"); $("people").classList.remove("open");
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
    groups[m.group_id].last = {username: m.username, text: m.text.slice(0, 60), created_at: m.created_at, seq: m.seq}; renderGroupList();
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
  socket.on("groups_snapshot", d => { Object.assign(users, d.users || {}); Object.assign(groups, d.groups || {}); renderGroupList(); updateHeader(); renderMembers(); });
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
    syncJump(); closeMenu();
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
    if (groups[m.group_id]) { groups[m.group_id].last = {username: m.username, text: m.text.slice(0, 60), created_at: m.created_at, seq: m.seq}; renderGroupList(); }
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
    deliver(m);
  }

  form.addEventListener("submit", e => {
    e.preventDefault();
    const text = input.value.trim(); if (!text) return;
    if (ctx && ctx.kind === "edit") { if (!live()) return toast(LIVE_MSG); socket.emit("edit_message", {id: ctx.id, text}); ctx = null; $("ctx-bar").hidden = true; input.value = ""; autosize(); return; }
    const cid = uid(), me = users[cfg.username] || cfg.me, reply = ctx && ctx.kind === "reply" ? ctx : null;
    const p = {id: "p-" + cid, cid, pending: true, group_id: activeGroup, username: cfg.username, display_name: me.display_name,
      avatar: me.avatar, avatar_url: me.avatar_url, text, created_at: new Date().toISOString(),
      reply_to: reply ? reply.id : "", reply_name: reply ? reply.name : "", reply_text: reply ? reply.text : ""};
    if (!msgs.length) feed.innerHTML = "";
    const prev = msgs[msgs.length - 1]; msgs.push(p); appendOne(p, prev); toBottom(true);
    deliver(p);
    burst(); ctx = null; $("ctx-bar").hidden = true; input.value = ""; autosize(); input.focus();
  });

  /* ---------- tap menu: tap = actions, double-tap = reply ---------- */
  const menu = $("msg-menu");
  function closeMenu() { menu.classList.remove("open"); document.querySelectorAll(".msg.picked").forEach(r => r.classList.remove("picked")); menuFor = null; }
  function openMenu(row, m) {
    closeMenu(); menuFor = m.id; row.classList.add("picked");
    const mine = m.username === cfg.username;
    menu.innerHTML = [["reply", "↩", "پاسخ"], ["copy", "⧉", "کپی"], ["forward", "➦", "فوروارد"]]
      .concat(mine ? [["edit", "✎", "ویرایش"], ["delete", "✕", "حذف"]] : [])
      .map(([a, i, l]) => `<button type="button" role="menuitem" data-act="${a}" class="${a === "delete" ? "del" : ""}"><i>${i}</i>${esc(t(l))}</button>`).join("");
    menu.classList.add("open");
    const r = row.querySelector(".bubble").getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight;
    let top = r.bottom + 6; if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
    const left = Math.min(Math.max(8, mine ? r.left : r.right - w), innerWidth - w - 8);
    menu.style.top = top + "px"; menu.style.left = left + "px";
    menu.querySelector("button").focus({preventScroll: true});
  }
  const msgOf = el => { const row = el.closest(".msg"); return row ? msgs.find(x => x.id === row.dataset.id) : null; };
  feed.addEventListener("click", e => {
    const prof = e.target.closest("[data-profile]"); if (prof) return openUserProfile(prof.dataset.profile);
    const go = e.target.closest("[data-goto]"); if (go) return gotoMsg(go.dataset.goto);
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
  document.addEventListener("click", e => { if (menuFor && !e.target.closest(".bubble") && !e.target.closest("#msg-menu")) closeMenu(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { closeMenu(); document.querySelectorAll(".modal.show").forEach(m => m.classList.remove("show")); } });
  menu.addEventListener("click", e => {
    const btn = e.target.closest("[data-act]"), m = msgs.find(x => x.id === menuFor); if (!btn || !m) return;
    closeMenu();
    ({reply: startReply, copy: copyMsg, forward: askForward, edit: startEdit, delete: askDelete})[btn.dataset.act](m);
  });
  function gotoMsg(id) {
    const row = feed.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!row) return toast("پیام اصلی در بخش بارگذاری‌شده نیست.");
    row.scrollIntoView({block: "center", behavior: "smooth"}); row.classList.add("flash"); setTimeout(() => row.classList.remove("flash"), 1200);
  }
  function startReply(m) { setCtx("reply", m.id, m.display_name || m.username, m.text); input.focus(); }
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
      b.innerHTML = `<span class="group-tile">${esc([...(g.name || t("گروه"))][0])}</span><strong data-no-i18n>${esc(titleOf(g))}</strong>`;
      b.onclick = () => { hideModal("sheet"); if (!live()) return toast(LIVE_MSG); socket.emit("forward_message", {id: m.id, target_group: id}); toast("فوروارد شد"); };
      box.appendChild(b);
    });
    sheet("فوروارد به…", box, [{label: "بستن"}]);
  }

  /* ---------- modals & API calls ---------- */
  document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => hideModal(b.dataset.close)));
  document.querySelectorAll(".modal").forEach(m => m.addEventListener("click", e => { if (e.target === m) m.classList.remove("show"); }));
  $("open-profile").addEventListener("click", () => showModal("profile-modal"));
  $("open-group").addEventListener("click", () => showModal("group-modal"));
  $("open-create-group").addEventListener("click", () => showModal("create-group-modal"));
  $("open-sidebar").addEventListener("click", () => $("sidebar").classList.add("open"));
  $("close-sidebar").addEventListener("click", () => $("sidebar").classList.remove("open"));
  $("open-members").addEventListener("click", () => $("people").classList.add("open"));
  $("close-members").addEventListener("click", () => $("people").classList.remove("open"));

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
  $("share-group").addEventListener("click", async () => {
    try {
      const r = await fetch(`/api/group/${encodeURIComponent(activeGroup)}/invite`, {method: "POST"}), d = await r.json();
      if (!r.ok) throw new Error(d.error || "ساخت لینک ناموفق بود");
      $("group-invite-url").value = d.invite_url;
      try { await navigator.clipboard.writeText(d.invite_url); toast("لینک دعوت کپی شد"); } catch (_) { showModal("group-modal"); }
    } catch (e) { toast(e.message); }
  });
  $("copy-invite").addEventListener("click", async () => {
    const el = $("group-invite-url"); if (!el.value) return;
    try { await navigator.clipboard.writeText(el.value); toast("لینک کپی شد"); } catch (_) { el.select(); document.execCommand("copy"); }
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
  const headClick = () => { const g = groups[activeGroup], p = dmPeer(g); if (p) openUserProfile(p); else if (g) $("people").classList.add("open"); };
  $("room-title").addEventListener("click", headClick); $("head-avatar").addEventListener("click", headClick);
  $("open-settings").addEventListener("click", () => { $("sidebar").classList.remove("open"); showModal("profile-modal"); });
  $("font-open").addEventListener("click", () => window.CRTheme.openFontPicker());
  $("theme-open").addEventListener("click", () => window.CRTheme.openPicker());
  const langLink = $("open-lang");   // language picker, comes back to this page afterwards
  if (langLink) langLink.href = "/lang?next=" + encodeURIComponent(location.pathname + location.search);
})();
