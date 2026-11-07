/* Themes + fonts + font size + tiny modal helper. Loaded in <head> so everything applies before first paint. */
(function () {
  var KEY = "cr:theme", FKEY = "cr:font", SKEY = "cr:fsize";
  var THEMES = [
    // dark
    {id: "silver", name: "نقره‌ای", sub: "مشکی و نقره (لوگو)", dark: 1, sw: ["#000000", "#C4C7CE", "#A6E9CF"], bar: "#000000"},
    {id: "noir", name: "سیاه", sub: "مشکی مطلق", dark: 1, sw: ["#000000", "#7C5CFF", "#5EEAD4"], bar: "#000000"},
    {id: "yalda", name: "یلدا", sub: "بنفش شبانه", dark: 1, sw: ["#1A1230", "#E5385E", "#B9DE82"], bar: "#1A1230"},
    {id: "firouzeh", name: "فیروزه", sub: "سبزآبی تیره", dark: 1, sw: ["#0C1B22", "#0E8F83", "#C5E86C"], bar: "#0C1B22"},
    {id: "shab", name: "شب آبی", sub: "آبی نیمه‌شب", dark: 1, sw: ["#0A1224", "#3B82F6", "#34D399"], bar: "#0A1224"},
    {id: "jangal", name: "جنگل", sub: "سبز تیره", dark: 1, sw: ["#07120D", "#22A45D", "#FDE68A"], bar: "#07120D"},
    {id: "ghoroob", name: "غروب", sub: "نارنجی و قهوه‌ای", dark: 1, sw: ["#1A0F14", "#E5541B", "#FFD166"], bar: "#1A0F14"},
    {id: "arghavan", name: "ارغوان", sub: "ارغوانی تیره", dark: 1, sw: ["#130A1F", "#C026D3", "#A3E635"], bar: "#130A1F"},
    {id: "ghahve", name: "قهوه", sub: "قهوه‌ای گرم", dark: 1, sw: ["#140E0A", "#A8642A", "#D9F99D"], bar: "#140E0A"},
    {id: "neon", name: "نئون", sub: "سایبر صورتی", dark: 1, sw: ["#05060F", "#FF2E93", "#00F5D4"], bar: "#05060F"},
    {id: "aghigh", name: "عقیق", sub: "قرمز تیره", dark: 1, sw: ["#14070B", "#DC2626", "#FCD34D"], bar: "#14070B"},
    {id: "tala", name: "طلایی", sub: "مشکی و طلا", dark: 1, sw: ["#0B0904", "#D4A017", "#9BE7A8"], bar: "#0B0904"},
    // light
    {id: "sobh", name: "صبح", sub: "روشن و خنک", sw: ["#F3EFFA", "#D12F55", "#3F7A0F"], bar: "#F3EFFA"},
    {id: "barf", name: "برف", sub: "سفید ساده", sw: ["#FAFAFA", "#0095F6", "#00A86B"], bar: "#FAFAFA"},
    {id: "nane", name: "نعناع", sub: "سبز روشن", sw: ["#EEF8F3", "#0F9D6B", "#2563EB"], bar: "#EEF8F3"},
    {id: "esfand", name: "اسطوخودوس", sub: "بنفش روشن", sw: ["#F5F1FF", "#7C3AED", "#0F766E"], bar: "#F5F1FF"},
    {id: "shen", name: "شن", sub: "کرم و کهربایی", sw: ["#F7F1E6", "#B45309", "#3F6212"], bar: "#F7F1E6"},
    {id: "gol", name: "گل رز", sub: "صورتی روشن", sw: ["#FFF1F4", "#E11D48", "#0E7490"], bar: "#FFF1F4"}
  ];
  var AUTO = {id: "auto", name: "خودکار", sub: "هماهنگ با دستگاه", sw: ["#000000", "#F3EFFA"]};

  // Google Fonts that support Persian/Arabic script. [id, label, google family, weights, css fallback, line-height]
  var FONTS = [
    ["vazir", "وزیرمتن", "Vazirmatn", "400;500;700", "sans-serif"],
    ["plex", "پلکس عربی", "IBM Plex Sans Arabic", "400;500;700", "sans-serif"],
    ["notosans", "نوتو سنس", "Noto Sans Arabic", "400;500;700", "sans-serif"],
    ["readex", "ریدکس", "Readex Pro", "400;500;700", "sans-serif"],
    ["alexandria", "الکساندریا", "Alexandria", "400;500;700", "sans-serif"],
    ["rubik", "روبیک", "Rubik", "400;500;700", "sans-serif"],
    ["cairo", "کایرو", "Cairo", "400;500;700", "sans-serif"],
    ["tajawal", "تجوال", "Tajawal", "400;500;700", "sans-serif"],
    ["almarai", "المرعی", "Almarai", "400;700", "sans-serif"],
    ["mada", "مدی", "Mada", "400;500;700", "sans-serif"],
    ["zain", "زین", "Zain", "400;700", "sans-serif"],
    ["changa", "چنگا", "Changa", "400;500;700", "sans-serif"],
    ["marhey", "مرحی", "Marhey", "400;500;700", "sans-serif"],
    ["baloo", "بالو", "Baloo Bhaijaan 2", "400;500;700", "sans-serif"],
    ["lemonada", "لیمونادا", "Lemonada", "400;500;700", "sans-serif"],
    ["naskh", "نسخ", "Noto Naskh Arabic", "400;500;700", "serif"],
    ["amiri", "امیری", "Amiri", "400;700", "serif"],
    ["scheherazade", "شهرزاد", "Scheherazade New", "400;500;700", "serif", 2.05],
    ["lateef", "لطیف", "Lateef", "400;700", "serif", 1.9],
    ["markazi", "مرکزی", "Markazi Text", "400;500;700", "serif", 1.95],
    ["harmattan", "هارماتان", "Harmattan", "400;500;700", "sans-serif", 1.9],
    ["mirza", "میرزا", "Mirza", "400;500;700", "serif", 1.9],
    ["elmessiri", "المسیری", "El Messiri", "400;500;700", "sans-serif"],
    ["kufam", "کوفام", "Kufam", "400;500;700", "sans-serif"],
    ["kufi", "کوفی", "Reem Kufi", "400;500;700", "sans-serif"],
    ["notokufi", "نوتو کوفی", "Noto Kufi Arabic", "400;500;700", "sans-serif"],
    ["ruqaa", "رقعه", "Aref Ruqaa", "400;700", "serif", 2],
    ["nastaliq", "نستعلیق", "Noto Nastaliq Urdu", "400;500;700", "serif", 2.6],
    ["gulzar", "گلزار", "Gulzar", "", "serif", 2.4],
    ["lalezar", "لاله‌زار", "Lalezar", "", "sans-serif"],
    ["rakkas", "رکاس", "Rakkas", "", "sans-serif"],
    ["katibeh", "کتیبه", "Katibeh", "", "serif", 2],
    ["blaka", "بلاکا", "Blaka", "", "sans-serif", 2],
    ["vibes", "ویبز", "Vibes", "", "sans-serif", 2]
  ];
  var FMAP = {}; FONTS.forEach(function (f) { FMAP[f[0]] = f; });
  var loaded = {};

  function stack(f) { return '"' + f[2] + '","Vazirmatn",Tahoma,' + f[4]; }
  function loadFont(f) {                       // one stylesheet per font; only the ones you use are downloaded
    if (loaded[f[0]]) return; loaded[f[0]] = 1;
    var l = document.createElement("link"); l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=" + f[2].replace(/ /g, "+") + (f[3] ? ":wght@" + f[3] : "") + "&display=swap";
    document.head.appendChild(l);
  }
  function fontPref() { try { var v = localStorage.getItem(FKEY); return FMAP[v] ? v : "vazir"; } catch (e) { return "vazir"; } }
  function sizePref() { try { return Math.min(20, Math.max(13, parseInt(localStorage.getItem(SKEY), 10) || 15)); } catch (e) { return 15; } }
  function applyFont() {
    var f = FMAP[fontPref()], r = document.documentElement;
    if (f[0] !== "vazir") loadFont(f);
    r.setAttribute("data-font", f[0]);
    r.style.setProperty("--font", stack(f));
    r.style.setProperty("--lh", String(f[5] || 1.7));
    r.style.setProperty("--fs", sizePref() + "px");
  }
  function setFont(id) { if (!FMAP[id]) return; try { localStorage.setItem(FKEY, id); } catch (e) {} applyFont(); }
  function setSize(n) { try { localStorage.setItem(SKEY, String(n)); } catch (e) {} applyFont(); }

  var mq = window.matchMedia ? matchMedia("(prefers-color-scheme: light)") : null;
  function pref() { try { return localStorage.getItem(KEY) || "auto"; } catch (e) { return "auto"; } }
  function resolve(p) {
    if (p === "auto") return mq && mq.matches ? "barf" : "silver";
    return THEMES.some(function (t) { return t.id === p; }) ? p : "silver";
  }
  function apply() {
    var id = resolve(pref());
    document.documentElement.setAttribute("data-theme", id);
    var m = document.querySelector('meta[name="theme-color"]');
    THEMES.forEach(function (t) { if (t.id === id && m) m.setAttribute("content", t.bar); });
    applyFont();
  }
  function set(p) { try { localStorage.setItem(KEY, p); } catch (e) {} apply(); }
  apply();
  if (mq) (mq.addEventListener ? mq.addEventListener("change", apply) : mq.addListener(apply));

  function modal(title, node) {
    var el = document.getElementById("cr-modal");
    if (!el) {
      el = document.createElement("div"); el.className = "modal"; el.id = "cr-modal";
      el.innerHTML = '<section class="card"><h2></h2><div class="cr-body"></div><div class="actions"><button type="button" class="key">بستن</button></div></section>';
      document.body.appendChild(el);
      el.addEventListener("click", function (e) { if (e.target === el || e.target.closest(".actions .key")) el.classList.remove("show"); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") el.classList.remove("show"); });
    }
    el.querySelector("h2").textContent = title;
    var body = el.querySelector(".cr-body"); body.innerHTML = ""; body.appendChild(node);
    el.classList.add("show");
  }

  function heading(t) { var h = document.createElement("div"); h.className = "side-sec"; h.textContent = t; return h; }
  function themeBtn(o, box) {
    var b = document.createElement("button"); b.type = "button";
    b.className = "pick theme-opt" + (pref() === o.id ? " on" : "");
    b.innerHTML = '<span class="sw">' + o.sw.map(function (c) { return '<i style="background:' + c + '"></i>'; }).join("") +
      '</span><span><strong>' + o.name + '</strong><small>' + o.sub + '</small></span>';
    b.onclick = function () { set(o.id); box.querySelectorAll(".theme-opt").forEach(function (x) { x.classList.toggle("on", x === b); }); };
    return b;
  }
  function openPicker() {
    var box = document.createElement("div");
    var auto = document.createElement("div"); auto.className = "pick-grid"; auto.appendChild(themeBtn(AUTO, box)); box.appendChild(auto);
    [["تم‌های تیره", 1], ["تم‌های روشن", 0]].forEach(function (g) {
      box.appendChild(heading(g[0]));
      var grid = document.createElement("div"); grid.className = "pick-grid";
      THEMES.filter(function (t) { return !!t.dark === !!g[1]; }).forEach(function (t) { grid.appendChild(themeBtn(t, box)); });
      box.appendChild(grid);
    });
    modal("تم برنامه", box);
  }
  function openFontPicker() {
    var box = document.createElement("div");
    var row = document.createElement("div"); row.className = "fsize";
    row.innerHTML = '<span>اندازه متن</span><input type="range" min="13" max="20" step="1" value="' + sizePref() + '" aria-label="اندازه متن"><b>' + sizePref() + '</b>';
    var rng = row.querySelector("input"), out = row.querySelector("b");
    rng.oninput = function () { out.textContent = rng.value; setSize(parseInt(rng.value, 10)); };
    box.appendChild(row);
    var grid = document.createElement("div"); grid.className = "pick-grid fonts"; box.appendChild(grid);
    FONTS.forEach(function (f) {
      loadFont(f);
      var b = document.createElement("button"); b.type = "button";
      b.className = "pick font-opt" + (fontPref() === f[0] ? " on" : "");
      b.style.fontFamily = stack(f);
      b.innerHTML = '<span><strong>' + f[1] + '</strong><small>سلام، این یک متن نمونه است ۱۲۳</small></span>';
      b.onclick = function () { setFont(f[0]); grid.querySelectorAll(".font-opt").forEach(function (x) { x.classList.toggle("on", x === b); }); };
      grid.appendChild(b);
    });
    modal("فونت برنامه", box);
  }
  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-theme-btn]")) openPicker();
    else if (e.target.closest("[data-font-btn]")) openFontPicker();
  });
  window.CRTheme = {fonts: FONTS, getFont: fontPref, setFont: setFont, set: set, get: pref, openPicker: openPicker,
                    openFontPicker: openFontPicker, themes: THEMES, setSize: setSize, getSize: sizePref};
  window.CRModal = modal;
})();
