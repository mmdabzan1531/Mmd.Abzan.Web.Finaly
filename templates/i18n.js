/* Chatroom i18n — translates the (Persian) UI on the client. Dictionary: i18n-data.js
   Language is read from the "lang" cookie that the server sets on /lang/<code>. */
(function () {
  "use strict";
  var root = document.documentElement;
  var DIRS = { fa: "rtl", ar: "rtl", en: "ltr", tr: "ltr", ru: "ltr", es: "ltr", fr: "ltr", zh: "ltr" };
  var ORDER = ["en", "ar", "tr", "ru", "es", "fr", "zh"];          // column order of every row in i18n-data.js
  var m = document.cookie.match(/(?:^|;\s*)lang=([a-z]{2})/);
  var lang = m && DIRS[m[1]] ? m[1] : "fa";
  window.CR_LANG = lang;
  window.t = function (s) { return s; };
  if (root.hasAttribute("data-keep-dir")) return;                     // the language picker page itself
  root.lang = lang;
  root.dir = DIRS[lang];
  if (lang === "fa" || !window.I18N) return;

  var idx = ORDER.indexOf(lang);
  var EX = {}, PX = [];

  function norm(s) {
    return String(s)
      .replace(/[\u200c\u200b\u200e\u200f]/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/ي/g, "ی").replace(/ك/g, "ک")
      .replace(/[\u0660-\u0669]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) + 0x90); })
      .replace(/\s+/g, " ").trim();
  }
  Object.keys(window.I18N).forEach(function (k) { EX[norm(k)] = window.I18N[k]; });
  (window.I18N_PREFIX || []).forEach(function (p) { PX.push([norm(p[0]), p[1]]); });

  function dg(s) {                                                   // Persian digits -> Latin (except Arabic UI)
    return lang === "ar" ? s : s.replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); });
  }

  function one(n) {
    var h = EX[n];
    if (h && h[idx]) return h[idx];
    for (var i = 0; i < PX.length; i++) {
      var p = PX[i];
      if (p[1][idx] && n.indexOf(p[0]) === 0) return p[1][idx] + dg(n.slice(p[0].length));
    }
    if (lang !== "ar") {
      var c = n.match(/^(\d+ \+ \d+ = )؟$/);                          // captcha question
      if (c) return c[1] + "?";
    }
    var k = n.match(/^((?:[۰-۹]+ ?ـ|[۰-۹]+\.|[^\u0600-\u06FFA-Za-z0-9]+) ?)(.+)$/);   // "🎨 text", "۱ ـ text", "• text"
    if (k) {
      var r = EX[k[2]];
      if (r && r[idx]) return dg(k[1].replace("ـ", "-")) + r[idx];
    }
    return null;
  }

  function keepWs(s, h) {
    var lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0];
    if (/^[.,;:!?。！？，、]/.test(h)) lead = "";
    return lead + h + trail;
  }

  function tr(s) {
    var n = norm(s);
    if (!n || !/[\u0600-\u06FF]|\d \+ \d/.test(n)) return s;
    var h = one(n);
    if (h !== null) return keepWs(s, h);
    if (s.indexOf("\n") > -1) {                                       // multi-line text (bot messages)
      var changed = false;
      var out = s.split("\n").map(function (l) {
        var nl = norm(l);
        if (!nl) return l;
        var hh = one(nl);
        if (hh === null) return l;
        changed = true;
        return keepWs(l, hh);
      }).join("\n");
      return changed ? out : s;
    }
    if (n.indexOf(" | ") > -1) {                                      // page titles: "<text> | Chatroom"
      var ch = false;
      var parts = n.split(" | ").map(function (p) {
        var x = one(p);
        if (x === null) return p;
        ch = true;
        return x;
      });
      return ch ? parts.join(" | ") : s;
    }
    return s;
  }
  window.t = function (s) { return typeof s === "string" ? tr(s) : s; };

  ["alert", "confirm", "prompt"].forEach(function (f) {
    var orig = window[f];
    window[f] = function (msg) {
      var a = [].slice.call(arguments);
      if (typeof msg === "string") a[0] = tr(msg);
      return orig.apply(window, a);
    };
  });

  var ATTRS = ["placeholder", "title", "aria-label", "alt"];
  var done = new WeakMap();

  function skipped(el) {
    for (; el && el.nodeType === 1; el = el.parentNode) {
      if (el.nodeName === "SCRIPT" || el.nodeName === "STYLE" || el.nodeName === "TEXTAREA" ||
          el.hasAttribute("data-no-i18n") || el.isContentEditable) return true;
    }
    return false;
  }
  function doText(node) {
    var v = node.nodeValue;
    if (done.get(node) === v) return;
    var o = tr(v);
    if (o !== v && !skipped(node.parentNode)) { node.nodeValue = o; done.set(node, o); }
  }
  function doEl(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var v = el.getAttribute(ATTRS[i]);
      if (!v) continue;
      var o = tr(v);
      if (o !== v && !skipped(el)) el.setAttribute(ATTRS[i], o);
    }
  }
  function walk(node) {
    if (node.nodeType === 3) return doText(node);
    if (node.nodeType === 1) {
      if (node.nodeName === "SCRIPT" || node.nodeName === "STYLE") return;
      doEl(node);
    } else if (node.nodeType !== 9 && node.nodeType !== 11) return;
    for (var c = node.firstChild; c; c = c.nextSibling) walk(c);
  }

  var obs = new MutationObserver(function (recs) {
    recs.forEach(function (r) {
      if (r.type === "characterData") doText(r.target);
      else if (r.type === "attributes") doEl(r.target);
      else for (var i = 0; i < r.addedNodes.length; i++) walk(r.addedNodes[i]);
    });
    obs.takeRecords();                                                // ignore our own changes
  });
  obs.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });

  // hide the page for a split second so the Persian text never flashes
  var st = document.createElement("style");
  st.id = "i18n-hide";
  st.textContent = "body{visibility:hidden}";
  (document.head || root).appendChild(st);
  function reveal() { var s = document.getElementById("i18n-hide"); if (s) s.remove(); }
  document.addEventListener("DOMContentLoaded", function () { walk(root); obs.takeRecords(); reveal(); });
  setTimeout(reveal, 2500);
})();
