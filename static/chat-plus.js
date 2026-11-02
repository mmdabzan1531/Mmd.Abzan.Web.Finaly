(function () {
  "use strict";
  /* استایل‌ها داخل همین فایل هستند تا به فایل CSS جدا وابسته نباشد */
  (function () { var s = document.createElement("style"); s.id = "pp-style"; s.textContent = "/* ===== اعضا: پنل کشویی از سمت راست ===== */\n#people.people{position:fixed!important;top:0;bottom:0;right:0;left:auto!important;width:min(340px,88vw)!important;max-width:100vw;height:100dvh;margin:0!important;\n  transform:translateX(105%)!important;visibility:hidden;transition:transform .26s ease,visibility .26s;z-index:80;display:flex!important;flex-direction:column;\n  background:var(--panel,var(--night,#0d0d14));color:inherit;border-left:1px solid rgba(255,255,255,.12);box-shadow:-8px 0 30px rgba(0,0,0,.45);overflow:hidden}\n#people.people.pp-open{transform:none!important;visibility:visible}\n#people .members{flex:1;overflow-y:auto;min-height:0}\n#people .people-head{display:flex;align-items:center;gap:8px}\n#people #close-members{display:inline-flex!important;margin-inline-start:auto}\n#pp-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:79;opacity:0;pointer-events:none;transition:opacity .25s}\n#pp-backdrop.show{opacity:1;pointer-events:auto}\n.app.pp-grid{grid-template-columns:var(--pp-side) minmax(0,1fr)!important}\n\n/* ===== نوار پیام ===== */\n.composer{align-items:flex-end}\n.composer .emoji-btn,.composer .attach-btn{flex:0 0 auto;font-size:1.15rem}\n.composer textarea{flex:1;min-width:0}\n\n/* ===== پنل ایموجی ===== */\n.pp-pop{position:fixed;z-index:2147483000;background:var(--panel,var(--night,#14141c));color:inherit;border:1px solid rgba(255,255,255,.14);\n  border-radius:16px;box-shadow:0 10px 36px rgba(0,0,0,.5);animation:ppIn .14s ease}\n@keyframes ppIn{from{opacity:0;transform:translateY(6px) scale(.97)}to{opacity:1;transform:none}}\n.ep{width:min(340px,94vw);display:flex;flex-direction:column;overflow:hidden}\n.ep-tabs{display:flex;gap:2px;padding:6px;border-bottom:1px solid rgba(255,255,255,.1);overflow-x:auto}\n.ep-tabs button{flex:1 0 auto;background:none;border:0;border-radius:10px;padding:6px 8px;font-size:1.15rem;cursor:pointer;opacity:.6;color:inherit}\n.ep-tabs button.on{opacity:1;background:rgba(255,255,255,.12)}\n.ep-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:2px;padding:8px;height:230px;overflow-y:auto;align-content:start}\n.ep-grid button{background:none;border:0;border-radius:8px;font-size:1.45rem;line-height:1;padding:6px 0;cursor:pointer}\n.ep-grid button:hover,.ep-grid button:active{background:rgba(255,255,255,.14)}\n.ep-empty{grid-column:1/-1;text-align:center;opacity:.6;padding:30px 0;font-size:.9rem}\n\n/* ===== منوی پیوست ===== */\n.am{min-width:210px;padding:6px;display:flex;flex-direction:column}\n.am button{display:flex;align-items:center;gap:12px;background:none;border:0;color:inherit;font:inherit;text-align:start;padding:10px 12px;border-radius:12px;cursor:pointer}\n.am button:hover,.am button:active{background:rgba(255,255,255,.12)}\n.am button i{font-style:normal;font-size:1.3rem;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.1)}\n\n.pp-toast{position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#222;color:#fff;padding:8px 16px;border-radius:999px;z-index:2147483200;font-size:.9rem}\n\n/* ایموجی‌های آیفون (اندازه قفل‌شده تا هیچ استایل دیگری خرابش نکند) */\nimg.ap-emoji{display:inline-block!important;width:min(1.2em,32px)!important;height:min(1.2em,32px)!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;\n  margin:0 .04em!important;padding:0!important;border:0!important;border-radius:0!important;background:none!important;box-shadow:none!important;\n  vertical-align:-.2em!important;object-fit:contain!important;aspect-ratio:1/1;-webkit-user-drag:none;user-select:none;pointer-events:none;flex:none}\n.ep-grid button img.ap-emoji,.ep-tabs button img.ap-emoji{width:1.5rem!important;height:1.5rem!important;vertical-align:middle!important;margin:0!important}\n.side-nav i img.ap-emoji{width:1.25em!important;height:1.25em!important}\n\n/* دکمه‌های ایموجی و سنجاق: آیکن خطی ساده */\n.emoji-btn,.attach-btn{display:inline-grid;place-items:center;padding:0;color:inherit;opacity:.82;transition:color .15s,opacity .15s,transform .15s}\n.emoji-btn svg,.attach-btn svg{width:22px;height:22px;display:block;pointer-events:none}\n.emoji-btn:hover,.attach-btn:hover,.emoji-btn:focus-visible,.attach-btn:focus-visible{opacity:1;color:#9b8cff}\n.emoji-btn:active,.attach-btn:active{transform:scale(.92)}\n\n/* پنل ایموجی چسبیده بالای نوار پیام */\n.ep.dock{max-width:none;border-radius:16px}\n.ep.dock .ep-grid{height:min(300px,38vh);grid-template-columns:repeat(auto-fill,minmax(40px,1fr))}\n.am{max-height:72vh;overflow-y:auto}\n\n/* کارت‌های موقعیت / مخاطب / نظرسنجی */\n.pp-card{display:block;min-width:220px;max-width:100%;padding:8px;border-radius:14px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);text-align:start}\n.pp-card-top{display:flex;align-items:center;gap:10px}\n.pp-card-top b{display:block}.pp-card-top small{opacity:.75}\n.pp-ico{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;font-size:1.4rem;background:rgba(255,255,255,.12);flex:0 0 auto}\n.pp-card-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}\n.pp-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:6px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:inherit;font:inherit;font-size:.88rem;cursor:pointer;text-decoration:none}\n.pp-btn:hover{background:rgba(255,255,255,.16)}\n.pp-btn.hot{background:#f5b82e;color:#111;border-color:#f5b82e;font-weight:600}\n.pp-poll-q{font-weight:700;margin-bottom:2px}\n.pp-poll-hint,.pp-poll-total{display:block;opacity:.65;font-size:.78rem;margin:2px 0 6px}\n.pp-opt{position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;margin:4px 0;padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.05);color:inherit;font:inherit;text-align:start;cursor:pointer;overflow:hidden}\n.pp-opt.mine{border-color:#f5b82e}\n.pp-bar{position:absolute;inset-block:0;inset-inline-start:0;background:rgba(245,184,46,.28);transition:width .3s;z-index:0}\n.pp-opt-t,.pp-opt-n{position:relative;z-index:1}.pp-opt-n{font-size:.78rem;opacity:.85;white-space:nowrap}\n\n/* پنجره‌ی ورودی (نظرسنجی / مخاطب) */\n.pp-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:110;display:grid;place-items:center;padding:16px}\n.pp-modal{width:min(380px,100%);max-height:88vh;overflow:auto;background:var(--panel,var(--night,#14141c));color:inherit;border:1px solid rgba(255,255,255,.16);border-radius:18px;padding:16px;box-shadow:0 14px 50px rgba(0,0,0,.6)}\n.pp-modal h3{margin:0 0 10px}\n.pp-field{display:block;margin:8px 0}\n.pp-field span{display:block;font-size:.82rem;opacity:.75;margin-bottom:4px}\n.pp-field input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.07);color:inherit;font:inherit}\n.pp-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}\n.pp-modal .pp-btn{margin-top:6px}.pp-actions .pp-btn{margin-top:0}\n\n/* ===== پنل ایموجی (سبک تلگرام) ===== */\n.ep.dock{display:flex;flex-direction:column;border-radius:18px 18px 14px 14px;background:var(--panel,var(--night,#15151d))}\n.ep.dock .ep-grid{height:min(290px,40vh);grid-template-columns:repeat(auto-fill,minmax(42px,1fr));gap:0;padding:8px 6px}\n.ep.dock .ep-grid button{font-size:1.7rem;padding:7px 0;border-radius:12px}\n.ep.dock .ep-tabs{border-bottom:0;border-top:1px solid rgba(255,255,255,.1);justify-content:space-around;padding:4px 6px}\n.ep.dock .ep-tabs button{font-size:1.25rem;flex:1;opacity:.5}\n.ep.dock .ep-tabs button.on{opacity:1;background:rgba(155,140,255,.2)}\n\n/* ===== شیت پیوست (سبک تلگرام / بله) ===== */\n.pp-sheet-bg{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center;animation:ppFade .18s ease}\n@keyframes ppFade{from{opacity:0}to{opacity:1}}\n@keyframes ppUp{from{transform:translateY(100%)}to{transform:none}}\n.pp-sheet{width:min(520px,100%);background:var(--panel,var(--night,#15151d));color:inherit;border-radius:22px 22px 0 0;padding:8px 14px calc(20px + env(safe-area-inset-bottom,0px));\n  box-shadow:0 -10px 40px rgba(0,0,0,.5);animation:ppUp .24s cubic-bezier(.2,.8,.2,1)}\n.pp-grab{width:42px;height:4px;border-radius:4px;background:rgba(255,255,255,.28);margin:4px auto 14px}\n.pp-attach-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px 6px}\n.pp-att{display:flex;flex-direction:column;align-items:center;gap:7px;background:none;border:0;color:inherit;font:inherit;cursor:pointer;padding:2px 0}\n.pp-att-ic{width:58px;height:58px;border-radius:50%;display:grid;place-items:center;box-shadow:0 4px 14px rgba(0,0,0,.35);transition:transform .12s}\n.pp-att:active .pp-att-ic{transform:scale(.9)}\n.pp-att-ic svg{width:27px;height:27px}\n.pp-att-t{font-size:.8rem;opacity:.85}\n.pp-modal-bg{z-index:2147483100}\n"; (document.head || document.documentElement).appendChild(s); })();

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
    var c = ($(".composer") || emojiBtn).getBoundingClientRect(), w = Math.min(Math.max(c.width, 280), 520);
    p.classList.add("dock"); p.style.width = w + "px"; p.style.left = Math.max(0, c.left + (c.width - w) / 2) + "px";
    p.style.top = "auto"; p.style.bottom = Math.max(0, innerHeight - c.top + 6) + "px";
  }
  function emojiPicker(onPick, keepOpen) {
    var el = document.createElement("div"); el.className = "pp-pop ep"; el.dir = "ltr";
    var tabs = document.createElement("div"); tabs.className = "ep-tabs";
    var grid = document.createElement("div"); grid.className = "ep-grid";
    el.appendChild(grid); el.appendChild(tabs);
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
  var ICON = {
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
    video: '<rect x="2" y="6" width="14" height="12" rx="3"/><path d="M22 8l-6 4 6 4z"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    pin: '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    poll: '<path d="M18 20V10M12 20V4M6 20v-6"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'
  };
  var ATT = [["image", "عکس", "image/*", null, "#8e63f0"], ["video", "ویدیو", "video/*", null, "#f0556a"], ["camera", "دوربین", "image/*", "environment", "#ff8a3d"],
    ["file", "فایل", "", null, "#3b8cf0"], ["music", "موزیک", "audio/*", null, "#ee5a9b"], ["pin", "موقعیت", "@loc", null, "#2cb67d"],
    ["poll", "نظرسنجی", "@poll", null, "#e9a916"], ["user", "مخاطب", "@contact", null, "#20a9c4"]];
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("#attach-btn");
    if (!b) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (openPop && openPop.classList.contains("pp-sheet-bg")) return closePop();
    closePop();
    var bg = document.createElement("div"); bg.className = "pp-sheet-bg";
    var sh = document.createElement("div"); sh.className = "pp-sheet"; sh.dir = "rtl";
    sh.appendChild(el("div", "pp-grab"));
    var grid = el("div", "pp-attach-grid");
    ATT.forEach(function (a) {
      var it = el("button", "pp-att"); it.type = "button";
      var ic = el("span", "pp-att-ic"); ic.style.background = a[4];
      ic.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + ICON[a[0]] + "</svg>";
      it.appendChild(ic); it.appendChild(el("span", "pp-att-t", a[1]));
      it.onclick = function () {
        closePop();
        if (a[2] === "@loc") return sendLocation();
        if (a[2] === "@poll") return pollDialog();
        if (a[2] === "@contact") return contactDialog();
        if (a[2]) fileIn.setAttribute("accept", a[2]); else fileIn.removeAttribute("accept");
        if (a[3]) fileIn.setAttribute("capture", a[3]); else fileIn.removeAttribute("capture");
        fileIn.click();
      };
      grid.appendChild(it);
    });
    sh.appendChild(grid); bg.appendChild(sh);
    bg.addEventListener("pointerdown", function (ev) { if (ev.target === bg) closePop(); });
    document.body.appendChild(bg); openPop = bg;
  }, true);

  /* ---------- کمک‌ها (ری‌اکشن‌ها حالا داخل chat.js هستند) ---------- */
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
  var feed = $("#messages");
  /* آپدیت لحظه‌ای نظرسنجی از همان اتصال chat.js (اتصال دوم باز نمی‌شود) */
  function hookPolls(C) {
    var s = C && C.socket;
    if (s && s.on) s.on("poll_update", function (d) { if (d && d.id && window.__ppSetVotes) window.__ppSetVotes(d.id, d.votes); });
  }
  if (window.CRChat) hookPolls(window.CRChat); else addEventListener("cr:ready", function () { hookPolls(window.CRChat); }, { once: true });
  /* پنل ایموجی و پاپ‌آپ‌ها برای منوی پیام (chat.js) */
  window.CRPlus = { emojiPicker: emojiPicker, show: show, closePop: closePop };

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
    window.__ppSetVotes = setVotes;
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
      if (root.nodeType !== 1 || SKIPT.test(root.tagName) || root.isContentEditable || (root.closest && root.closest("[data-no-emoji],#msg-menu"))) return;
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
