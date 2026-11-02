/* chat-bg.js — پس‌زمینه‌ی چت
 *  • تنظیمات ← «پس‌زمینه چت»      : فقط برای خود شخص (ذخیره در مرورگر)
 *  • تنظیمات گروه ← «پس‌زمینه گروه»: برای همه‌ی اعضا (فقط مالک/ادمین) — نیاز به endpoint /api/group/<id>/background
 * اولویت نمایش: انتخاب شخصی ← پس‌زمینه‌ی گروه ← پیش‌فرض
 * این فایل باید قبل از اسکریپت بارگذاری socket.io در chat.html قرار بگیرد.
 */
(function () {
  "use strict";

  var KEY = "cr_chat_bg_v1";
  var CR = window.CHATROOM || {};
  var ME = CR.username || "";
  function $(s, r) { return (r || document).querySelector(s); }

  /* ================= پیش‌فرض‌ها (بدون نیاز به عکس خارجی) ================= */
  function pat(op) {
    return 'url("data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140" viewBox="0 0 120 120" fill="none" stroke="#fff" stroke-opacity="' + op +
      '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="20" cy="22" r="7"/>' +
      '<path d="M70 14l4 8 9 1-6.5 6 1.7 9-8.2-4.4-8.2 4.4 1.7-9L57 23l9-1z"/>' +
      '<path d="M96 70c0-6 9-6 9 0 0 5-9 11-9 11s-9-6-9-11c0-6 9-6 9 0z"/>' +
      '<path d="M18 86h22M29 75v22"/><rect x="60" y="90" width="18" height="14" rx="4"/>' +
      '<path d="M100 20q8-8 16 0" /></svg>') + '")';
  }
  var PRESETS = [
    { id: "aurora", name: "شفق", color: "#0b0a1a", css: "radial-gradient(at 15% 8%,rgba(124,92,255,.6),transparent 55%),radial-gradient(at 88% 28%,rgba(0,214,180,.38),transparent 55%),radial-gradient(at 40% 98%,rgba(255,92,162,.38),transparent 55%)" },
    { id: "tgviolet", name: "دودل بنفش", color: "#2a1f6e", css: pat(".12") + ",linear-gradient(165deg,#2a1f6e,#5a3fd0 60%,#8a6bff)", size: "140px 140px,cover", repeat: "repeat,no-repeat" },
    { id: "tggreen", name: "دودل سبز", color: "#3f6b3a", css: pat(".14") + ",linear-gradient(165deg,#5b8f4f,#a8c56a 60%,#d7d98a)", size: "140px 140px,cover", repeat: "repeat,no-repeat" },
    { id: "tgdark", name: "دودل تیره", color: "#0d0d14", css: pat(".07") + ",linear-gradient(180deg,#0d0d14,#1a1a26)", size: "140px 140px,cover", repeat: "repeat,no-repeat" },
    { id: "sunset", name: "غروب", color: "#1f1147", css: "linear-gradient(170deg,#1f1147,#6b2d7a 45%,#e0566b 85%,#f7a25b)" },
    { id: "ocean", name: "اقیانوس", color: "#04121f", css: "linear-gradient(170deg,#04121f,#0b3a5b 55%,#127a8a)" },
    { id: "forest", name: "جنگل", color: "#07140d", css: "linear-gradient(170deg,#07140d,#0f3b25 55%,#3b7a4a)" },
    { id: "rose", name: "رز", color: "#2a0f24", css: "linear-gradient(160deg,#2a0f24,#7a2a58 60%,#d96a8f)" },
    { id: "midnight", name: "نیمه‌شب", color: "#0b1026", css: "linear-gradient(180deg,#0b1026,#1b1b3a 60%,#2a1f4d)" },
    { id: "graphite", name: "گرافیت", color: "#0e0e12", css: "linear-gradient(180deg,#0e0e12,#1c1c24)" },
    { id: "mint", name: "نعنا", color: "#cfeadb", css: "linear-gradient(160deg,#e3f6ec,#bfe3cf 55%,#a8d5c0)" },
    { id: "sand", name: "ماسه", color: "#efe3cf", css: "linear-gradient(160deg,#f6ecd9,#ead9bb 60%,#dcc49a)" }
  ];
  function presetById(id) { for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i]; return null; }

  /* ================= وضعیت ================= */
  var groups = {}, curGid = CR.initialGroup || "", previewOn = false, preview = null;
  (function seed() {
    var ig = CR.initialGroups || {};
    try {
      if (Array.isArray(ig)) ig.forEach(function (g) { if (g && g.id) groups[g.id] = g; });
      else Object.keys(ig).forEach(function (k) { groups[k] = ig[k]; });
    } catch (e) {}
  })();

  function loadMine() { try { var v = JSON.parse(localStorage.getItem(KEY) || "null"); return v && v.t ? v : null; } catch (e) { return null; } }
  function saveMine(v) {
    try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); return true; }
    catch (e) { toast("فضای مرورگر پر است؛ عکس کوچک‌تری انتخاب کن."); return false; }
  }
  function groupSpec(g) {
    var b = g && g.background; if (!b) return null;
    if (b.indexOf("p:") === 0) return { t: "p", id: b.slice(2) };
    if (b.indexOf("/media/") === 0) return { t: "i", url: b };
    return null;
  }
  function guessGid() {
    if (curGid && groups[curGid]) return curGid;
    var h = $("#group-name-head"), name = h ? h.textContent.replace(/\u00a0/g, " ").trim() : "";
    if (!name) return curGid;
    var hit = Object.keys(groups).filter(function (k) { return groups[k] && groups[k].type !== "dm" && groups[k].name === name; });
    return hit.length === 1 ? hit[0] : curGid;
  }

  /* ================= اعمال روی چت ================= */
  function applyTo(feed, spec) {
    var st = feed.style, P = ["background-image", "background-size", "background-repeat", "background-position", "background-color", "background-attachment"];
    if (!spec) { P.forEach(function (k) { st.removeProperty(k); }); feed.removeAttribute("data-cbg"); return; }
    var img, size, rep, pos = "center", col = "transparent";
    if (spec.t === "p") {
      var p = presetById(spec.id); if (!p) { applyTo(feed, null); return; }
      img = p.css; size = p.size || "auto"; rep = p.repeat || "no-repeat"; col = p.color;
    } else {
      img = "linear-gradient(rgba(0,0,0,.26),rgba(0,0,0,.26)),url(\"" + spec.url.replace(/"/g, "%22") + "\")"; size = "cover,cover"; rep = "no-repeat,no-repeat"; col = "#000";
    }
    st.setProperty("background-image", img, "important");
    st.setProperty("background-size", size, "important");
    st.setProperty("background-repeat", rep, "important");
    st.setProperty("background-position", pos, "important");
    st.setProperty("background-color", col, "important");
    st.setProperty("background-attachment", "scroll", "important");
    feed.setAttribute("data-cbg", spec.t);
  }
  function currentSpec() {
    if (previewOn) return preview;
    return loadMine() || groupSpec(groups[guessGid()]);
  }
  function apply() { var f = document.getElementById("messages"); if (f) applyTo(f, currentSpec()); }

  /* ================= toast + استایل ================= */
  function toast(t) { var d = document.createElement("div"); d.className = "cb-toast"; d.textContent = t; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 2400); }
  var css = document.createElement("style");
  css.textContent =
    ".cb-ov{position:fixed;inset:0;z-index:99990;background:rgba(5,4,12,.62);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);display:flex;align-items:flex-end;justify-content:center;animation:cbF .18s ease}" +
    "@media(min-width:640px){.cb-ov{align-items:center}}" +
    ".cb-card{width:min(520px,100%);max-height:88vh;overflow:auto;background:linear-gradient(180deg,#1d1b2e,#14131f);color:#f2f0ff;border:1px solid rgba(190,175,255,.22);" +
      "border-radius:22px 22px 0 0;padding:18px 16px calc(16px + env(safe-area-inset-bottom,0px));box-shadow:0 -10px 50px rgba(0,0,0,.55);animation:cbUp .24s cubic-bezier(.2,.9,.3,1);direction:rtl;font-family:inherit}" +
    "@media(min-width:640px){.cb-card{border-radius:22px}}" +
    ".cb-card h3{margin:0 0 4px;font-size:1.12rem}.cb-sub{margin:0 0 14px;font-size:.82rem;opacity:.7;line-height:1.7}" +
    ".cb-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}" +
    ".cb-th{position:relative;height:84px;border-radius:16px;border:2px solid transparent;cursor:pointer;overflow:hidden;padding:0;display:flex;align-items:flex-end;justify-content:center;" +
      "box-shadow:0 4px 14px rgba(0,0,0,.35);transition:transform .15s,border-color .15s;font-family:inherit}" +
    ".cb-th:active{transform:scale(.94)}.cb-th.on{border-color:#b9a9ff;box-shadow:0 0 0 3px rgba(155,140,255,.3),0 4px 14px rgba(0,0,0,.35)}" +
    ".cb-th span{width:100%;padding:3px 0;font-size:.72rem;font-weight:700;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.62))}" +
    ".cb-th.on::after{content:'✓';position:absolute;top:6px;left:6px;width:20px;height:20px;border-radius:50%;background:#7a68ff;color:#fff;display:grid;place-items:center;font-size:.78rem;font-weight:800}" +
    ".cb-th.cb-up{background:rgba(255,255,255,.07);border:2px dashed rgba(190,175,255,.45);align-items:center;flex-direction:column;gap:4px;color:#d8d0ff;font-size:.78rem;font-weight:700}" +
    ".cb-th.cb-up i{font-style:normal;font-size:1.5rem;line-height:1}" +
    ".cb-row{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}" +
    ".cb-btn{flex:1;min-width:110px;height:44px;border-radius:14px;border:1px solid rgba(190,175,255,.28);background:rgba(255,255,255,.07);color:#f2f0ff;font:inherit;font-weight:700;cursor:pointer}" +
    ".cb-btn:active{transform:scale(.96)}.cb-btn.hot{background:linear-gradient(135deg,#9a8bff,#5a44e8);border-color:transparent;box-shadow:0 6px 18px rgba(110,90,250,.4)}" +
    ".cb-btn[disabled]{opacity:.5;pointer-events:none}" +
    ".cb-toast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:99999;background:rgba(30,28,48,.96);color:#fff;padding:10px 18px;border-radius:999px;font-size:.88rem;box-shadow:0 8px 24px rgba(0,0,0,.5);animation:cbF .2s}" +
    "#messages[data-cbg]{transition:background .35s}" +
    "@keyframes cbF{from{opacity:0}to{opacity:1}}@keyframes cbUp{from{transform:translateY(40px);opacity:0}to{transform:none;opacity:1}}";
  document.head.appendChild(css);

  /* ================= کوچک کردن عکس ================= */
  function shrink(file, cb) {
    var u = URL.createObjectURL(file), im = new Image();
    im.onload = function () {
      var m = 1280, r = Math.min(1, m / Math.max(im.width, im.height)), c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(im.width * r)); c.height = Math.max(1, Math.round(im.height * r));
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
      c.toBlob(function (b) { cb(b, c.toDataURL("image/jpeg", 0.8)); }, "image/jpeg", 0.82);
    };
    im.onerror = function () { URL.revokeObjectURL(u); toast("تصویر معتبر نیست."); };
    im.src = u;
  }

  /* ================= پنجره‌ی انتخاب ================= */
  function openPicker(mode, gid) {
    if (document.querySelector(".cb-ov")) return;
    var isGroup = mode === "group", mine = loadMine(), g = groups[gid] || {};
    var sel = isGroup ? groupSpec(g) : mine;          // انتخاب فعلی
    var draftBlob = null, uploadedUrl = null, dirty = false;

    var ov = document.createElement("div"); ov.className = "cb-ov";
    var card = document.createElement("div"); card.className = "cb-card"; ov.appendChild(card);
    var h = document.createElement("h3"); h.textContent = isGroup ? "🖼 پس‌زمینه‌ی گروه" : "🖼 پس‌زمینه‌ی چت";
    var sub = document.createElement("p"); sub.className = "cb-sub";
    sub.textContent = isGroup ? "برای همه‌ی اعضای این گروه عوض می‌شود. اعضایی که برای خودشان پس‌زمینه‌ی شخصی انتخاب کرده‌اند، همان را می‌بینند."
                              : "فقط برای خودت عوض می‌شود و دیگران چیزی نمی‌بینند.";
    card.appendChild(h); card.appendChild(sub);
    var grid = document.createElement("div"); grid.className = "cb-grid"; card.appendChild(grid);

    function same(a, b) { return !!a && !!b && a.t === b.t && (a.t === "p" ? a.id === b.id : a.url === b.url); }
    function mark() {
      [].forEach.call(grid.querySelectorAll(".cb-th[data-k]"), function (b) {
        var k = b.getAttribute("data-k"), on = !!sel && ((sel.t === "p" && k === sel.id) || (sel.t === "i" && k === "img"));
        b.classList.toggle("on", on);
      });
    }
    function choose(spec) {
      sel = spec; dirty = true; mark();
      if (isGroup) { previewOn = true; preview = spec; apply(); }
      else { if (saveMine(spec)) apply(); }
    }

    PRESETS.forEach(function (p) {
      var b = document.createElement("button"); b.type = "button"; b.className = "cb-th"; b.setAttribute("data-k", p.id);
      b.style.backgroundColor = p.color; b.style.backgroundImage = p.css; b.style.backgroundSize = p.size ? "70px 70px,cover" : "auto"; b.style.backgroundRepeat = p.repeat || "no-repeat";
      var l = document.createElement("span"); l.textContent = p.name; b.appendChild(l);
      b.onclick = function () { choose({ t: "p", id: p.id }); }; grid.appendChild(b);
    });

    var up = document.createElement("button"); up.type = "button"; up.className = "cb-th cb-up"; up.setAttribute("data-k", "img");
    up.innerHTML = "<i>📷</i><span style='background:none'>عکس از گالری</span>";
    var fi = document.createElement("input"); fi.type = "file"; fi.accept = "image/png,image/jpeg,image/webp,image/gif"; fi.hidden = true;
    up.onclick = function () { fi.click(); };
    fi.onchange = function () {
      var f = fi.files && fi.files[0]; fi.value = ""; if (!f) return;
      shrink(f, function (blob, dataUrl) {
        if (isGroup) { draftBlob = blob; uploadedUrl = URL.createObjectURL(blob); choose({ t: "i", url: uploadedUrl }); }
        else choose({ t: "i", url: dataUrl });
      });
    };
    grid.appendChild(up); card.appendChild(fi);

    var row = document.createElement("div"); row.className = "cb-row"; card.appendChild(row);
    var reset = document.createElement("button"); reset.type = "button"; reset.className = "cb-btn";
    reset.textContent = isGroup ? "حذف پس‌زمینه‌ی گروه" : "بازنشانی (پیش‌فرض)";
    var close = document.createElement("button"); close.type = "button"; close.className = "cb-btn"; close.textContent = isGroup ? "انصراف" : "بستن";
    row.appendChild(reset);
    var save = null;
    if (isGroup) { save = document.createElement("button"); save.type = "button"; save.className = "cb-btn hot"; save.textContent = "ذخیره برای همه"; row.appendChild(save); }
    row.appendChild(close);

    function done() { previewOn = false; preview = null; if (uploadedUrl) URL.revokeObjectURL(uploadedUrl); ov.remove(); apply(); }
    close.onclick = done;
    ov.addEventListener("click", function (e) { if (e.target === ov) done(); });

    if (!isGroup) {
      reset.onclick = function () { sel = null; saveMine(null); mark(); apply(); toast("پس‌زمینه‌ی پیش‌فرض برگشت."); };
    } else {
      reset.onclick = function () { sel = null; dirty = true; draftBlob = null; mark(); previewOn = true; preview = null; apply(); };
      save.onclick = function () {
        if (!dirty) return done();
        var fd = new FormData();
        if (!sel) fd.append("remove", "1");
        else if (sel.t === "p") fd.append("preset", sel.id);
        else if (draftBlob) fd.append("photo", draftBlob, "bg.jpg");
        else return done();
        save.disabled = true; save.textContent = "در حال ذخیره…";
        fetch("/api/group/" + encodeURIComponent(gid) + "/background", { method: "POST", body: fd, credentials: "same-origin" })
          .then(function (r) { return r.json().catch(function () { return {}; }); })
          .then(function (d) {
            if (d && d.ok) { if (d.group) groups[gid] = d.group; toast("پس‌زمینه‌ی گروه برای همه تغییر کرد ✓"); done(); }
            else { toast((d && d.error) || "ذخیره نشد."); save.disabled = false; save.textContent = "ذخیره برای همه"; }
          }).catch(function () { toast("خطای اتصال."); save.disabled = false; save.textContent = "ذخیره برای همه"; });
      };
    }
    mark();
    document.body.appendChild(ov);
  }

  /* ================= دکمه‌ها داخل تنظیمات ================= */
  function amAdmin(g) { return !!g && g.type !== "dm" && (g.owner === ME || (g.admins || []).indexOf(ME) > -1); }

  function injectButtons() {
    // ۱) تنظیمات شخصی: کنار «تم‌ها / فونت‌ها»
    var themeBtn = $("#theme-open");
    if (themeBtn && !$("#cb-open-me")) {
      var b = document.createElement("button"); b.type = "button"; b.id = "cb-open-me"; b.className = themeBtn.className; b.textContent = "🖼 پس‌زمینه چت";
      b.onclick = function () { openPicker("me"); };
      themeBtn.parentNode.appendChild(b);
    }
    // ۲) تنظیمات گروه: فقط مالک/ادمین
    var gm = $("#group-modal .group-extra") || $("#group-modal .actions");
    if (gm && !$("#cb-open-group")) {
      var gb = document.createElement("button"); gb.type = "button"; gb.id = "cb-open-group"; gb.className = "key small"; gb.textContent = "🖼 پس‌زمینه گروه"; gb.hidden = true;
      gb.onclick = function () { openPicker("group", guessGid()); };
      if (gm.classList.contains("group-extra")) gm.insertBefore(gb, gm.firstChild);
      else gm.parentNode.insertBefore(gb, gm);
    }
  }
  function refreshGroupBtn() {
    var gb = $("#cb-open-group"); if (!gb) return;
    var g = groups[guessGid()]; gb.hidden = !amAdmin(g);
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("#open-group,#open-profile,#open-settings,[data-open-settings]");
    if (t) setTimeout(function () { injectButtons(); refreshGroupBtn(); }, 30);
  }, true);

  /* ================= دریافت اطلاعات گروه از سوکت (بدون دست زدن به chat.js) ================= */
  function hookSocket(s) {
    if (!s || s.__cbHooked || typeof s.on !== "function") return; s.__cbHooked = true;
    s.on("group_history", function (d) { if (d && d.group_id) { curGid = d.group_id; if (d.group) groups[d.group_id] = d.group; apply(); refreshGroupBtn(); } });
    s.on("group_updated", function (d) { if (d && d.id && d.group) { groups[d.id] = d.group; if (d.id === curGid || !curGid) apply(); refreshGroupBtn(); } });
  }
  function wrapIo(real) {
    var w = function () { var s = real.apply(this, arguments); try { hookSocket(s); } catch (e) {} return s; };
    try { for (var k in real) if (Object.prototype.hasOwnProperty.call(real, k)) w[k] = real[k]; } catch (e) {}
    w.connect = w; w.__cbReal = real; return w;
  }
  try {
    if (typeof window.io === "function") window.io = wrapIo(window.io);
    else {
      var held;
      Object.defineProperty(window, "io", {
        configurable: true, enumerable: true,
        get: function () { return held; },
        set: function (v) { held = (typeof v === "function" && !v.__cbReal) ? wrapIo(v) : v; }
      });
    }
  } catch (e) {}

  /* ================= شروع ================= */
  function init() {
    injectButtons(); apply();
    var last = JSON.stringify(currentSpec()) || "";
    setInterval(function () { var k = JSON.stringify(currentSpec()) || ""; if (k !== last) { last = k; apply(); } }, 3000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
