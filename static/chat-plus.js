(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var ME = (window.CHATROOM && window.CHATROOM.username) || "";
  var QUICK = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥"];
  var CATS = [
    ["😀", "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 ☹️ 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👹 👺 👻 👽 👾 🤖"],
    ["👋", "👋 🤚 🖐 ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🧠 👀 👁 👅 👄 👶 🧒 👦 👧 🧑 👨 👩 🧔 👴 👵 🙍 🙎 🙅 🙆 💁 🙋 🙇 🤦 🤷 💃 🕺 🏃 🚶"],
    ["🐶", "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🐢 🐍 🦎 🐙 🦑 🦀 🐠 🐟 🐬 🐳 🦈 🐊 🐘 🦒 🐪 🌵 🌲 🌳 🌴 🌱 🍀 🌷 🌹 🌺 🌸 🌼 🌻 🌞 🌝 🌙 ⭐ 🌟 ✨ ⚡ 🔥 🌈 ☀️ ⛅ ☁️ 🌧 ❄️ ☃️ 💧 🌊"],
    ["🍔", "🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🥦 🥕 🌽 🌶 🥔 🍞 🥐 🧀 🥚 🍳 🥞 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🌮 🌯 🍝 🍜 🍲 🍛 🍣 🍱 🍤 🍙 🍚 🍦 🍩 🍪 🎂 🍰 🧁 🍫 🍬 🍭 🍿 ☕ 🍵 🥤 🍺 🍻 🥂 🍷 🍸 🍹"],
    ["⚽", "⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🏸 🥊 🥋 ⛳ 🎣 🎽 ⛸ 🎿 🏂 🏋️ 🤸 🏆 🥇 🥈 🥉 🎮 🕹 🎲 🎯 🎳 🎰 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🎸 🎻 🚗 🚕 🚌 🏎 🚓 🚑 🚒 🏍 🚲 ✈️ 🚀 🛸 🚁 ⛵ 🚢 🏠 🏰 🗼 🗽 ⛰ 🌋 🏖 🏝 🎡 🎢"],
    ["💡", "⌚ 📱 💻 ⌨️ 🖥 🖨 🖱 💽 💾 📷 📸 📹 🎥 📞 ☎️ 📺 📻 ⏰ 🔋 🔌 💡 🔦 💰 💵 💳 💎 🔧 🔨 🔑 🗝 🔒 🔓 📦 ✉️ 📧 📝 📁 📅 📌 📎 ✂️ 📚 📖 🔔 🎁 🎈 🎉 🎊 🛒 🧸 🕯 🧿"],
    ["❤️", "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☯️ ✡️ ♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓ ✅ ❌ ❎ ⭕ ❗ ❓ ‼️ ⁉️ 💯 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ ▶️ ⏸ ⏹ 🔁 🔀 ➕ ➖ ✔️ ➡️ ⬅️ ⬆️ ⬇️ 🆗 🆒 🆕 🔞"]
  ];
  function toast(t) { var d = document.createElement("div"); d.className = "pp-toast"; d.textContent = t; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 2200); }
  function recents() { try { return JSON.parse(localStorage.getItem("pp_recent_emoji") || "[]"); } catch (e) { return []; } }
  function pushRecent(e) { try { var r = recents().filter(function (x) { return x !== e; }); r.unshift(e); localStorage.setItem("pp_recent_emoji", JSON.stringify(r.slice(0, 24))); } catch (e2) {} }

  /* ---------- popups ---------- */
  var openPop = null;
  function closePop() { if (openPop) { openPop.remove(); openPop = null; } }
  function place(pop, anchor, above) {
    document.body.appendChild(pop);
    var a = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    var x = Math.min(Math.max(8, a.left + a.width / 2 - w / 2), innerWidth - w - 8);
    var y = above ? a.top - h - 8 : a.bottom + 8;
    if (y < 8) y = a.bottom + 8;
    if (y + h > innerHeight - 8) y = Math.max(8, a.top - h - 8);
    pop.style.left = x + "px"; pop.style.top = y + "px";
  }
  function show(pop, anchor, above) { closePop(); openPop = pop; place(pop, anchor, above); }
  document.addEventListener("pointerdown", function (e) {
    if (openPop && !openPop.contains(e.target) && !e.target.closest("[data-pp-toggle]")) closePop();
  }, true);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closePop(); setPeople(false); } });
  addEventListener("resize", closePop);

  function dock(p) {
    var c = ($(".composer") || emojiBtn).getBoundingClientRect(), w = Math.min(c.width, 480);
    p.classList.add("dock"); p.style.width = w + "px"; p.style.left = Math.max(8, c.left + (c.width - w) / 2) + "px";
    p.style.top = Math.max(8, c.top - p.offsetHeight - 8) + "px";
  }
  function emojiPicker(onPick, keepOpen) {
    var el = document.createElement("div"); el.className = "pp-pop ep"; el.dir = "ltr";
    var tabs = document.createElement("div"); tabs.className = "ep-tabs";
    var grid = document.createElement("div"); grid.className = "ep-grid";
    el.appendChild(tabs); el.appendChild(grid);
    var all = [["🕘", null]].concat(CATS.map(function (c) { return [c[0], c[1].split(" ")]; }));
    function fill(i) {
      var list = i === 0 ? recents() : all[i][1];
      grid.innerHTML = ""; grid.scrollTop = 0;
      if (!list.length) { grid.innerHTML = '<div class="ep-empty">هنوز ایموجی‌ای استفاده نکرده‌ای</div>'; }
      list.forEach(function (e) {
        var b = document.createElement("button"); b.type = "button"; b.textContent = e;
        b.onclick = function () { pushRecent(e); onPick(e); if (!keepOpen) closePop(); };
        grid.appendChild(b);
      });
      Array.prototype.forEach.call(tabs.children, function (t, k) { t.classList.toggle("on", k === i); });
    }
    all.forEach(function (c, i) {
      var b = document.createElement("button"); b.type = "button"; b.textContent = c[0]; b.onclick = function () { fill(i); }; tabs.appendChild(b);
    });
    fill(recents().length ? 0 : 1);
    return el;
  }

  /* ---------- اعضا ---------- */
  var people = $("#people"), backdrop = document.createElement("div");
  backdrop.id = "pp-backdrop"; document.body.appendChild(backdrop);
  function setPeople(on) {
    if (!people) return;
    ["open", "show", "active", "opened"].forEach(function (c) { people.classList.remove(c); });
    people.classList.toggle("pp-open", !!on); backdrop.classList.toggle("show", !!on);
  }
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("#open-members,#close-members");
    if (!t) return;
    e.preventDefault(); e.stopImmediatePropagation();
    setPeople(t.id === "open-members" ? !people.classList.contains("pp-open") : false);
  }, true);
  backdrop.addEventListener("click", function () { setPeople(false); });
  function fixGrid() {
    var app = $(".app"); if (!app) return;
    app.classList.remove("pp-grid");
    if (innerWidth <= 900) return;
    var cols = getComputedStyle(app).gridTemplateColumns.split(" ");
    if (cols.length >= 3) { app.style.setProperty("--pp-side", cols[0]); app.classList.add("pp-grid"); }
  }
  fixGrid(); addEventListener("resize", fixGrid);

  /* ---------- ایموجی + پیوست در نوار پیام ---------- */
  var input = $("#message-input"), emojiBtn = $("#emoji-btn"), attachBtn = $("#attach-btn"), fileIn = $("#attach-input");
  function insertAtCursor(t) {
    var s = input.selectionStart == null ? input.value.length : input.selectionStart, e2 = input.selectionEnd == null ? s : input.selectionEnd;
    input.value = input.value.slice(0, s) + t + input.value.slice(e2);
    var p = s + t.length; input.setSelectionRange(p, p);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (emojiBtn) emojiBtn.addEventListener("click", function (e) {
    e.preventDefault();
    if (openPop && openPop.classList.contains("ep") && openPop._for === "composer") return closePop();
    var p = emojiPicker(function (em) { insertAtCursor(em); }, true); p._for = "composer";
    show(p, emojiBtn, true); dock(p);
  });
  var form = $("#message-form");
  function sendText(t) {
    var prev = input.value;
    input.value = t; input.dispatchEvent(new Event("input", { bubbles: true }));
    if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    setTimeout(function () { if (input.value === t || input.value === "") { input.value = prev; input.dispatchEvent(new Event("input", { bubbles: true })); } }, 80);
  }
  function modal(title, build, ok, okText) {
    var bg = document.createElement("div"); bg.className = "pp-modal-bg";
    var card = document.createElement("div"); card.className = "pp-modal"; card.dir = "rtl";
    var h = document.createElement("h3"); h.textContent = title; card.appendChild(h);
    var body = build(); card.appendChild(body);
    var act = document.createElement("div"); act.className = "pp-actions";
    var c = document.createElement("button"); c.type = "button"; c.className = "pp-btn"; c.textContent = "انصراف";
    var o = document.createElement("button"); o.type = "button"; o.className = "pp-btn hot"; o.textContent = okText || "ارسال";
    function close() { bg.remove(); }
    c.onclick = close; o.onclick = function () { if (ok(body) !== false) close(); };
    bg.addEventListener("pointerdown", function (e) { if (e.target === bg) close(); });
    act.appendChild(c); act.appendChild(o); card.appendChild(act); bg.appendChild(card); document.body.appendChild(bg);
    var f = card.querySelector("input"); if (f) setTimeout(function () { f.focus(); }, 50);
  }
  function field(label, attrs) {
    var w = document.createElement("label"); w.className = "pp-field"; var s = document.createElement("span"); s.textContent = label;
    var i = document.createElement("input"); Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); });
    w.appendChild(s); w.appendChild(i); return w;
  }
  function sendLocation() {
    if (!navigator.geolocation) return toast("مرورگر از موقعیت مکانی پشتیبانی نمی‌کند");
    toast("در حال دریافت موقعیت…");
    navigator.geolocation.getCurrentPosition(function (p) {
      sendText("\u27e6loc\u27e7" + JSON.stringify({ lat: +p.coords.latitude.toFixed(6), lon: +p.coords.longitude.toFixed(6) }));
    }, function () { toast("دسترسی به موقعیت مکانی داده نشد"); }, { enableHighAccuracy: true, timeout: 15000 });
  }
  function pollDialog() {
    modal("نظرسنجی جدید", function () {
      var box = document.createElement("div");
      box.appendChild(field("سؤال", { maxlength: 120, placeholder: "سؤالت را بنویس…" }));
      var opts = document.createElement("div"); box.appendChild(opts);
      function add() { if (opts.children.length >= 6) return; opts.appendChild(field("گزینه " + (opts.children.length + 1), { maxlength: 50 })); }
      add(); add();
      var more = document.createElement("button"); more.type = "button"; more.className = "pp-btn"; more.textContent = "＋ افزودن گزینه"; more.onclick = add; box.appendChild(more);
      box._opts = opts; return box;
    }, function (box) {
      var qn = box.querySelector("input").value.trim();
      var o = [].map.call(box._opts.querySelectorAll("input"), function (i) { return i.value.trim(); }).filter(Boolean);
      if (!qn) { toast("سؤال را بنویس"); return false; }
      if (o.length < 2) { toast("حداقل دو گزینه لازم است"); return false; }
      sendText("\u27e6poll\u27e7" + JSON.stringify({ q: qn, o: o }));
    });
  }
  function contactDialog() {
    modal("ارسال مخاطب", function () {
      var box = document.createElement("div");
      var n = field("نام", { maxlength: 60 }), p = field("شماره تلفن", { maxlength: 30, type: "tel", dir: "ltr", inputmode: "tel" });
      box.appendChild(n); box.appendChild(p);
      if (navigator.contacts && navigator.contacts.select) {
        var b = document.createElement("button"); b.type = "button"; b.className = "pp-btn"; b.textContent = "📒 انتخاب از مخاطبین گوشی";
        b.onclick = function () {
          navigator.contacts.select(["name", "tel"], { multiple: false }).then(function (r) {
            if (r && r[0]) { n.querySelector("input").value = (r[0].name || [])[0] || ""; p.querySelector("input").value = (r[0].tel || [])[0] || ""; }
          }).catch(function () {});
        };
        box.appendChild(b);
      }
      box._n = n.querySelector("input"); box._p = p.querySelector("input"); return box;
    }, function (box) {
      var name = box._n.value.trim(), phone = box._p.value.trim();
      if (!name) { toast("نام را بنویس"); return false; }
      if (!/^[+\d\s()\-]{3,30}$/.test(phone)) { toast("شماره تلفن معتبر نیست"); return false; }
      sendText("\u27e6contact\u27e7" + JSON.stringify({ name: name, phone: phone }));
    });
  }
  var ATT = [["🖼", "عکس", "image/*", null], ["🎬", "ویدیو", "video/*", null], ["📷", "دوربین", "image/*", "environment"], ["🎵", "موزیک", "audio/*", null],
    ["📁", "فایل", "", null], ["📍", "موقعیت مکانی", "@loc"], ["📊", "نظرسنجی", "@poll"], ["👤", "مخاطب", "@contact"]];
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("#attach-btn");
    if (!b) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (openPop && openPop.classList.contains("am")) return closePop();
    var m = document.createElement("div"); m.className = "pp-pop am";
    ATT.forEach(function (a) {
      var it = document.createElement("button"); it.type = "button"; it.innerHTML = "<i>" + a[0] + "</i><span>" + a[1] + "</span>";
      it.onclick = function () {
        closePop();
        if (a[2] === "@loc") return sendLocation();
        if (a[2] === "@poll") return pollDialog();
        if (a[2] === "@contact") return contactDialog();
        if (a[2]) fileIn.setAttribute("accept", a[2]); else fileIn.removeAttribute("accept");
        if (a[3]) fileIn.setAttribute("capture", a[3]); else fileIn.removeAttribute("capture");
        fileIn.click();
      };
      m.appendChild(it);
    });
    show(m, attachBtn, true);
  }, true);

  /* ---------- واکنش به پیام‌ها ---------- */
  var cache = {}, hosts = {}, pending = {}, timer = null;
  var IDRE = /^(?:[a-z_:-]*[-_:])?([0-9a-f]{32})$/i, SKIP = /^(src|href|srcset|style|poster|download|action|data-rx.*)$/i, SKIPTAG = /^(IMG|A|VIDEO|AUDIO|SOURCE|SVG|USE)$/i;
  function idOf(el) {
    if (SKIPTAG.test(el.tagName)) return null;
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i]; if (SKIP.test(a.name)) continue;
      var m = IDRE.exec(a.value); if (m) return m[1].toLowerCase();
    }
    return null;
  }
  function api(url, opt) {
    return fetch(url, Object.assign({ credentials: "same-origin" }, opt || {})).then(function (r) { return r.json().catch(function () { return {}; }); });
  }
  function queue(id) { if (!(id in cache)) { pending[id] = 1; clearTimeout(timer); timer = setTimeout(flush, 150); } }
  function flush() {
    var ids = Object.keys(pending); pending = {};
    for (var i = 0; i < ids.length; i += 100) (function (chunk) {
      api("/api/reactions?ids=" + chunk.join(",")).then(function (d) {
        var r = d.reactions || {};
        chunk.forEach(function (id) { cache[id] = r[id] || []; renderId(id); });
      }).catch(function () {});
    })(ids.slice(i, i + 100));
  }
  function react(id, emoji) {
    api("/api/react", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: id, emoji: emoji }) })
      .then(function (d) { if (d.ok) { cache[id] = d.reactions; renderId(id); } else toast(d.error || "خطا در ثبت واکنش"); })
      .catch(function () { toast("اتصال برقرار نیست"); });
  }
  function renderId(id) {
    (hosts[id] || []).slice().forEach(function (h) {
      if (!h.isConnected) { hosts[id] = hosts[id].filter(function (x) { return x !== h; }); return; }
      render(h, id);
    });
  }
  function render(h, id) {
    var row = h.querySelector(":scope > .rx-row");
    if (!row) { row = document.createElement("div"); row.className = "rx-row"; h.appendChild(row); }
    var list = cache[id] || [];
    row.innerHTML = "";
    list.forEach(function (r) {
      var mine = r.users.indexOf(ME) > -1, c = document.createElement("button");
      c.type = "button"; c.className = "rx-chip" + (mine ? " mine" : ""); c.title = r.users.join("، ");
      c.innerHTML = "<span></span><b>" + r.users.length + "</b>"; c.firstChild.textContent = r.emoji;
      c.onclick = function (e) { e.stopPropagation(); react(id, r.emoji); };
      row.appendChild(c);
    });
  }
  function ensureHost(el, id) {
    if (el.__rx === id && el.querySelector(":scope > .rx-add")) { if (!el.querySelector(":scope > .rx-row")) render(el, id); return; }
    el.__rx = id; el.classList.add("rx-host");
    (hosts[id] = hosts[id] || []);
    if (hosts[id].indexOf(el) < 0) hosts[id].push(el);
    if (!el.querySelector(":scope > .rx-add")) {
      var b = document.createElement("button"); b.type = "button"; b.className = "rx-add"; b.setAttribute("data-pp-toggle", ""); b.title = "واکنش"; b.textContent = "☺";
      b.onclick = function (e) { e.stopPropagation(); e.preventDefault(); quickBar(b, id); };
      el.appendChild(b);
    }
    render(el, id); queue(id);
  }
  function quickBar(anchor, id) {
    if (openPop && openPop._for === id) return closePop();
    var bar = document.createElement("div"); bar.className = "pp-pop rq"; bar._for = id;
    QUICK.forEach(function (em) {
      var b = document.createElement("button"); b.type = "button"; b.textContent = em;
      b.onclick = function () { closePop(); react(id, em); }; bar.appendChild(b);
    });
    var more = document.createElement("button"); more.type = "button"; more.textContent = "➕"; more.style.fontSize = "1.1rem";
    more.onclick = function () { var p = emojiPicker(function (em) { closePop(); react(id, em); }); show(p, anchor, false); };
    bar.appendChild(more);
    show(bar, anchor, false);
  }
  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.closest && root.closest(".rx-row,.rx-add")) return;
    var list = [root].concat([].slice.call(root.querySelectorAll("*")));
    list.forEach(function (el) {
      if (el.classList.contains("rx-row") || el.classList.contains("rx-add") || el.closest(".rx-row")) return;
      var id = idOf(el); if (!id) return;
      var p = el.parentElement; if (p && p.closest(".rx-host") && p.closest(".rx-host") !== el) return;
      ensureHost(el, id);
    });
  }
  var feed = $("#messages"), raf = 0;
  if (feed) {
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        if (m.target.closest && m.target.closest(".rx-row")) return;
        [].forEach.call(m.addedNodes, function (n) {
          if (n.nodeType === 1 && !(n.classList.contains("rx-row") || n.classList.contains("rx-add"))) scan(n);
        });
      });
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () {
        [].forEach.call(feed.querySelectorAll(".rx-host"), function (h) { if (h.__rx) ensureHost(h, h.__rx); });
      });
    }).observe(feed, { childList: true, subtree: true });
    scan(feed);
  }
  if (typeof io === "function") {
    try { var s = io(); s.on("reaction_update", function (d) { if (d && d.id) { cache[d.id] = d.reactions || []; renderId(d.id); } }); } catch (e) {}
  }
  setInterval(function () {
    if (document.hidden) return;
    var ids = Object.keys(hosts).filter(function (id) { return (hosts[id] || []).some(function (h) { return h.isConnected; }); }).slice(-100);
    if (!ids.length) return;
    api("/api/reactions?ids=" + ids.join(",")).then(function (d) {
      var r = d.reactions || {}; ids.forEach(function (id) { if (id in r) { cache[id] = r[id]; renderId(id); } });
    }).catch(function () {});
  }, 8000);


  /* ---------- پیام‌های ویژه: موقعیت / مخاطب / نظرسنجی ---------- */
  var MARK = /^\u27e6(loc|contact|poll)\u27e7([\s\S]*)$/, pollCache = {}, pollCards = {}, pollPending = {}, pollTimer = null;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function msgIdFor(node) {
    for (var e = node.nodeType === 1 ? node : node.parentElement; e && e !== feed; e = e.parentElement) { var id = idOf(e); if (id) return id; }
    return null;
  }
  function locCard(d) {
    var c = el("div", "pp-card pp-loc"), top = el("div", "pp-card-top");
    top.appendChild(el("span", "pp-ico", "📍"));
    var t = el("div"); t.appendChild(el("b", null, "موقعیت مکانی")); var s = el("small", null, d.lat + ", " + d.lon); s.dir = "ltr"; t.appendChild(s);
    top.appendChild(t); c.appendChild(top);
    var row = el("div", "pp-card-actions");
    var a = el("a", "pp-btn", "نقشه"); a.href = "https://www.openstreetmap.org/?mlat=" + d.lat + "&mlon=" + d.lon + "#map=16/" + d.lat + "/" + d.lon; a.target = "_blank"; a.rel = "noopener";
    var g = el("a", "pp-btn", "Google Maps"); g.href = "https://www.google.com/maps?q=" + d.lat + "," + d.lon; g.target = "_blank"; g.rel = "noopener";
    row.appendChild(a); row.appendChild(g); c.appendChild(row); return c;
  }
  function contactCard(d) {
    var c = el("div", "pp-card pp-contact"), top = el("div", "pp-card-top");
    top.appendChild(el("span", "pp-ico", "👤"));
    var t = el("div"); t.appendChild(el("b", null, d.name)); var s = el("small", null, d.phone); s.dir = "ltr"; t.appendChild(s);
    top.appendChild(t); c.appendChild(top);
    var row = el("div", "pp-card-actions");
    var call = el("a", "pp-btn", "📞 تماس"); call.href = "tel:" + String(d.phone).replace(/[^\d+]/g, "");
    var cp = el("button", "pp-btn", "کپی شماره"); cp.type = "button";
    cp.onclick = function () { (navigator.clipboard ? navigator.clipboard.writeText(d.phone) : Promise.reject()).then(function () { toast("شماره کپی شد"); }).catch(function () { toast(d.phone); }); };
    row.appendChild(call); row.appendChild(cp); c.appendChild(row); return c;
  }
  function pollCard(d, id) {
    var c = el("div", "pp-card pp-poll"); c.__poll = d; c.__id = id;
    (pollCards[id] = pollCards[id] || []).push(c);
    renderPoll(c); if (id && !(id in pollCache)) { pollPending[id] = 1; clearTimeout(pollTimer); pollTimer = setTimeout(flushPolls, 150); }
    return c;
  }
  function renderPoll(c) {
    var d = c.__poll, votes = pollCache[c.__id] || [], counts = d.o.map(function () { return 0; }), mine = -1;
    votes.forEach(function (v) { if (counts[v[1]] != null) counts[v[1]]++; if (v[0] === ME) mine = v[1]; });
    var total = votes.length; c.innerHTML = "";
    c.appendChild(el("div", "pp-poll-q", "📊 " + d.q));
    c.appendChild(el("small", "pp-poll-hint", "نظرسنجی"));
    d.o.forEach(function (o, i) {
      var b = el("button", "pp-opt" + (mine === i ? " mine" : "")); b.type = "button";
      var pct = total ? Math.round(counts[i] * 100 / total) : 0;
      var bar = el("span", "pp-bar"); bar.style.width = pct + "%";
      b.appendChild(bar); b.appendChild(el("span", "pp-opt-t", (mine === i ? "✔ " : "") + o)); b.appendChild(el("span", "pp-opt-n", counts[i] ? pct + "٪ · " + counts[i] : ""));
      b.onclick = function (e) { e.stopPropagation(); if (!c.__id) return; vote(c.__id, i); };
      c.appendChild(b);
    });
    c.appendChild(el("small", "pp-poll-total", total + " رأی"));
  }
  function setVotes(id, votes) { pollCache[id] = votes || []; (pollCards[id] || []).forEach(function (c) { if (c.isConnected) renderPoll(c); }); }
  function vote(id, opt) {
    api("/api/poll/vote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: id, option: opt }) })
      .then(function (d) { if (d.ok) setVotes(id, d.votes); else toast(d.error || "خطا در ثبت رأی"); }).catch(function () { toast("اتصال برقرار نیست"); });
  }
  function flushPolls() {
    var ids = Object.keys(pollPending); pollPending = {};
    for (var i = 0; i < ids.length; i += 100) (function (ch) {
      api("/api/polls?ids=" + ch.join(",")).then(function (d) { var r = d.polls || {}; ch.forEach(function (id) { setVotes(id, r[id] || []); }); }).catch(function () {});
    })(ids.slice(i, i + 100));
  }
  function cards(root) {
    if (!root || !feed) return;
    var start = root.nodeType === 1 ? root : root.parentNode; if (!start) return;
    var list = [];
    if (root.nodeType === 3) list.push(root);
    else { var w = document.createTreeWalker(start, NodeFilter.SHOW_TEXT), n; while ((n = w.nextNode())) list.push(n); }
    list.forEach(function (n) {
      var v = n.nodeValue; if (!v || v.indexOf("\u27e6") < 0 || !n.parentElement || n.parentElement.closest(".pp-card,.rx-row")) return;
      var m = MARK.exec(v.trim()); if (!m) return;
      var d; try { d = JSON.parse(m[2]); } catch (e) { return; }
      var card;
      try {
        if (m[1] === "loc") card = locCard({ lat: +d.lat, lon: +d.lon });
        else if (m[1] === "contact") card = contactCard({ name: String(d.name || ""), phone: String(d.phone || "") });
        else card = pollCard({ q: String(d.q || ""), o: (d.o || []).map(String) }, msgIdFor(n));
      } catch (e) { return; }
      n.parentNode.replaceChild(card, n);
    });
  }
  if (feed) {
    new MutationObserver(function (muts) { muts.forEach(function (m) { [].forEach.call(m.addedNodes, function (n) { if (n.nodeType === 3 || (n.nodeType === 1 && !n.closest(".pp-card"))) cards(n); }); }); })
      .observe(feed, { childList: true, subtree: true });
    cards(feed);
    if (typeof io === "function") { try { io().on("poll_update", function (d) { if (d && d.id) setVotes(d.id, d.votes); }); } catch (e) {} }
    setInterval(function () {
      if (document.hidden) return;
      var ids = Object.keys(pollCards).filter(function (id) { return pollCards[id].some(function (c) { return c.isConnected; }); }).slice(-100);
      if (!ids.length) return;
      api("/api/polls?ids=" + ids.join(",")).then(function (d) { var r = d.polls || {}; ids.forEach(function (id) { if (id in r) setVotes(id, r[id]); }); }).catch(function () {});
    }, 8000);
  }

  /* ---------- ایموجی‌های آیفون (Apple) ---------- */
  (function () {
    if (/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)) return;   // روی دستگاه‌های اپل خودش آیفونی است
    var BASE = "https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.0.1/img/apple/64/";
    var RE;
    try { RE = new RegExp("(?:\\p{RI}\\p{RI}|[#*0-9]\\uFE0F?\\u20E3|\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?)*)", "gu"); } catch (e) { return; }
    var SKIPT = /^(SCRIPT|STYLE|TEXTAREA|INPUT|NOSCRIPT|IMG)$/;
    function cps(str) { var o = []; for (var ch of str) o.push(ch.codePointAt(0).toString(16)); return o; }
    function mk(str) {
      var img = document.createElement("img"), list = cps(str), tried = 0;
      img.className = "ap-emoji"; img.alt = str; img.draggable = false; img.loading = "lazy";
      var variants = [list.join("-")];
      var noFe = list.filter(function (c) { return c !== "fe0f"; }).join("-");
      if (noFe !== variants[0]) variants.push(noFe);
      else variants.push(list.concat("fe0f").join("-"));
      img.src = BASE + variants[0] + ".png";
      img.onerror = function () {
        tried++;
        if (tried < variants.length) img.src = BASE + variants[tried] + ".png";
        else img.replaceWith(document.createTextNode(str));
      };
      return img;
    }
    function textNodes(root, out) {
      if (root.nodeType === 3) { out.push(root); return; }
      if (root.nodeType !== 1 || SKIPT.test(root.tagName) || root.isContentEditable || (root.closest && root.closest("[data-no-emoji]"))) return;
      for (var c = root.firstChild; c; c = c.nextSibling) textNodes(c, out);
    }
    function conv(root) {
      var nodes = []; textNodes(root, nodes);
      nodes.forEach(function (n) {
        var t = n.nodeValue; RE.lastIndex = 0;
        if (!t || !RE.test(t)) return;
        RE.lastIndex = 0;
        var frag = document.createDocumentFragment(), last = 0, m;
        while ((m = RE.exec(t))) {
          if (m.index > last) frag.appendChild(document.createTextNode(t.slice(last, m.index)));
          if (/^[#*0-9]\uFE0F?$/.test(m[0])) frag.appendChild(document.createTextNode(m[0]));
          else frag.appendChild(mk(m[0]));
          last = m.index + m[0].length;
        }
        if (last < t.length) frag.appendChild(document.createTextNode(t.slice(last)));
        if (n.parentNode) n.parentNode.replaceChild(frag, n);
      });
    }
    var q = [], sched = 0;
    function later(n) { q.push(n); if (!sched) sched = requestAnimationFrame(function () { sched = 0; var l = q; q = []; l.forEach(function (x) { if (x.isConnected) conv(x); }); }); }
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        if (m.type === "characterData") { if (m.target.parentNode) later(m.target.parentNode); return; }
        [].forEach.call(m.addedNodes, function (n) { if (!(n.nodeType === 1 && n.classList.contains("ap-emoji"))) later(n); });
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    conv(document.body);
  })();
})();
