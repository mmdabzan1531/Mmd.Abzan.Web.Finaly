/* Insta Mode — home feed, stories, reels, explore, messages (uses the existing DM system), profile, activity */
(function () {
  "use strict";
  var ME = window.IG.me, PARAMS = window.IG.params || {};
  var root = document.getElementById("ig-root"), main = document.getElementById("ig-main"),
      nav = document.getElementById("ig-nav"), layer = document.getElementById("ig-layer"), toastEl = document.getElementById("ig-toast");

  /* ---------- tiny helpers ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function el(html) { var t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function fa(n) { return Number(n || 0).toLocaleString("fa-IR"); }
  function compact(n) { n = +n || 0; if (n >= 1e6) return fa(Math.round(n / 1e5) / 10) + "M"; if (n >= 1e3) return fa(Math.round(n / 100) / 10) + "K"; return fa(n); }
  function ago(ts) {
    var s = Math.max(0, Date.now() / 1000 - ts);
    if (s < 60) return "همین حالا";
    if (s < 3600) return fa(Math.floor(s / 60)) + " دقیقه پیش";
    if (s < 86400) return fa(Math.floor(s / 3600)) + " ساعت پیش";
    if (s < 604800) return fa(Math.floor(s / 86400)) + " روز پیش";
    return new Date(ts * 1000).toLocaleDateString("fa-IR");
  }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  var toastT;
  function toast(msg) { toastEl.textContent = msg; toastEl.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove("on"); }, 2600); }
  function api(url, opt) {
    opt = opt || {};
    var o = { credentials: "same-origin", method: opt.method || "GET", headers: {} };
    if (opt.json !== undefined) { o.method = opt.method || "POST"; o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(opt.json); }
    if (opt.form) { o.method = "POST"; o.body = opt.form; }
    return fetch(url, o).then(function (r) {
      if (r.status === 401) { location.href = "/"; throw new Error("auth"); }
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok || d.ok === false) throw new Error(d.error || "خطایی رخ داد؛ دوباره تلاش کن.");
        return d;
      });
    });
  }
  function fail(e) { if (e && e.message !== "auth") toast(e.message); }

  /* ---------- icons ---------- */
  var IC = {
    home: '<path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    reels: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M3 9h18M9 3l3 6M15 3l3 6"/><path d="M10.5 13l4 2.3-4 2.3z"/>',
    send: '<path d="M22 3L9.5 13.5M22 3l-7 18-5.5-7.5L2 9.5z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    plusq: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 8v8M8 12h8"/>',
    heart: '<path d="M12 21s-8-5.2-8-11a4.6 4.6 0 0 1 8-3 4.6 4.6 0 0 1 8 3c0 5.8-8 11-8 11z"/>',
    comment: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12z"/>',
    save: '<path d="M6 3h12v18l-6-4.5L6 21z"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    dots: '<circle cx="5" cy="12" r="1.4" class="f"/><circle cx="12" cy="12" r="1.4" class="f"/><circle cx="19" cy="12" r="1.4" class="f"/>',
    grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    vol: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>',
    mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>',
    play: '<path d="M8 5l11 7-11 7z"/>',
    clip: '<path d="M21.4 11l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    cam: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'
  };
  function ic(n, cls) { return '<svg viewBox="0 0 24 24"' + (cls ? ' class="' + cls + '"' : "") + ' aria-hidden="true">' + IC[n].replace(/class="f"/g, 'fill="currentColor" stroke="none"') + "</svg>"; }
  function avatar(u, s) {
    s = s || 44;
    var inner = u && u.avatar_url ? '<img src="' + esc(u.avatar_url) + '" alt="" loading="lazy">' : esc((u && u.avatar) || "🙂");
    return '<span class="ig-av" style="--s:' + s + 'px">' + inner + "</span>";
  }

  /* ---------- theme ---------- */
  function applyTheme() { root.dataset.theme = store("ig_theme") || "auto"; }
  applyTheme();

  /* ---------- layers (pages, sheets, story viewer) with Android back button support ---------- */
  var stack = [];
  function openLayer(node, onClose) {
    layer.appendChild(node);
    stack.push({ node: node, onClose: onClose });
    history.pushState({ ig: stack.length }, "");
    pauseVideos();
    requestAnimationFrame(function () { requestAnimationFrame(function () { node.classList.add("on"); }); });
  }
  function removeTop() {
    var t = stack.pop();
    if (!t) return;
    t.node.classList.remove("on");
    if (t.onClose) { try { t.onClose(); } catch (e) { /* ignore */ } }
    setTimeout(function () { t.node.remove(); }, 230);
    if (!stack.length) refreshVideos();
  }
  function closeNode(node) {
    var i = -1;
    stack.forEach(function (s, k) { if (s.node === node) i = k; });
    if (i < 0) return;
    if (i === stack.length - 1) history.back();
    else { var t = stack.splice(i, 1)[0]; t.node.remove(); if (t.onClose) t.onClose(); }
  }
  window.addEventListener("popstate", function () { if (stack.length) removeTop(); });

  function sheet(title, build) {
    var back = el('<div class="ig-sheet-back"><div class="ig-sheet"><div class="grab"></div><div class="st"></div><div class="sb"></div></div></div>');
    $(".st", back).textContent = title;
    if (!title) $(".st", back).style.display = "none";
    var body = $(".sb", back), sh = $(".ig-sheet", back);
    var api_ = { body: body, close: function () { closeNode(back); } };
    back.addEventListener("click", function (e) { if (e.target === back) api_.close(); });
    var foot = build(body, api_.close);
    if (foot) sh.appendChild(foot);
    openLayer(back);
    return api_;
  }
  function page(opts) {
    opts = opts || {};
    var n = el('<div class="ig-page"><div class="ig-page-h"><button class="bk" type="button" aria-label="بازگشت">' + ic("back") + '</button><div class="tt"></div><div class="ex"></div></div><div class="ig-page-b"></div></div>');
    var tt = $(".tt", n);
    if (opts.user) tt.innerHTML = avatar(opts.user, 34) + "<span>" + esc(opts.user.display_name || opts.user.username) + "</span>";
    else tt.innerHTML = "<span>" + esc(opts.title || "") + "</span>";
    $(".bk", n).onclick = function () { closeNode(n); };
    openLayer(n, opts.onClose);
    return { node: n, body: $(".ig-page-b", n), head: tt, ex: $(".ex", n), close: function () { closeNode(n); } };
  }

  /* ---------- videos: autoplay when visible ---------- */
  var soundOn = false;
  var vidObs = "IntersectionObserver" in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      var v = e.target;
      if (e.isIntersecting && e.intersectionRatio >= 0.6 && !stack.some(function (s) { return s.node.classList.contains("ig-page") && !s.node.contains(v); })) {
        v.muted = !soundOn;
        var p = v.play();
        if (p && p.catch) p.catch(function () { v.muted = true; v.play().catch(function () {}); });
      } else v.pause();
    });
  }, { threshold: [0, 0.6, 1] }) : null;
  function watchVideo(v) { if (vidObs) vidObs.observe(v); }
  function pauseVideos() { $$("video").forEach(function (v) { if (!v.closest(".ig-story")) v.pause(); }); }
  function refreshVideos() { if (!vidObs) return; $$("video[data-w]").forEach(function (v) { vidObs.unobserve(v); vidObs.observe(v); }); }
  function applySound() {
    $$("video[data-w]").forEach(function (v) { v.muted = !soundOn; });
    $$(".ig-snd").forEach(function (s) { s.innerHTML = ic(soundOn ? "vol" : "mute"); });
  }

  /* ---------- post model / painting ---------- */
  var P = {};
  function paint(p) {
    $$('[data-pid="' + p.id + '"]').forEach(function (c) {
      var l = $(".like", c), s = $(".save", c), lc = $(".lc", c), cc = $(".cc", c);
      if (l) l.classList.toggle("on", !!p.liked);
      if (s) s.classList.toggle("on", !!p.saved);
      if (lc) lc.textContent = p.likes ? (c.classList.contains("ig-reel") ? compact(p.likes) : fa(p.likes) + " لایک") : (c.classList.contains("ig-reel") ? "" : "اولین لایک را تو بزن");
      if (cc) cc.textContent = c.classList.contains("ig-reel") ? (p.comments ? compact(p.comments) : "") : (p.comments ? "مشاهده همه " + fa(p.comments) + " نظر" : "نظر بده…");
    });
  }
  function setLike(p, on) {
    if (p.liked === on) return;
    var pl = p.liked, pn = p.likes;
    p.liked = on; p.likes = Math.max(0, p.likes + (on ? 1 : -1)); paint(p);
    api("/api/insta/posts/" + p.id + "/like", { json: { on: on } }).then(function (d) { p.liked = d.liked; p.likes = d.likes; paint(p); })
      .catch(function (e) { p.liked = pl; p.likes = pn; paint(p); fail(e); });
  }
  function setSave(p) {
    var on = !p.saved;
    p.saved = on; paint(p);
    api("/api/insta/posts/" + p.id + "/save", { json: { on: on } }).then(function (d) { p.saved = d.saved; paint(p); if (d.saved) toast("در ذخیره‌شده‌ها ذخیره شد"); })
      .catch(function (e) { p.saved = !on; paint(p); fail(e); });
  }
  function burst(box) {
    var b = $(".ig-burst", box); if (!b) return;
    b.classList.remove("go"); void b.offsetWidth; b.classList.add("go");
  }
  function mediaHTML(p, cls) {
    if (p.media_type === "video")
      return '<video src="' + esc(p.media_url) + '" playsinline muted loop preload="metadata" data-w="1"></video><span class="ig-snd">' + ic(soundOn ? "vol" : "mute") + "</span>";
    return '<img src="' + esc(p.media_url) + '" alt="" loading="lazy" draggable="false">';
  }
  function bindDoubleTap(box, p) {
    var last = 0, t = null, v = $("video", box);
    box.addEventListener("click", function () {
      var now = Date.now();
      if (now - last < 320) { clearTimeout(t); last = 0; if (!p.liked) setLike(p, true); burst(box); }
      else {
        last = now;
        if (v) t = setTimeout(function () { soundOn = !soundOn; applySound(); }, 320);
      }
    });
    if (v) watchVideo(v);
  }

  /* ---------- post card (feed + post viewer) ---------- */
  function postCard(p) {
    P[p.id] = p;
    var card = el('<article class="ig-post" data-pid="' + p.id + '">' +
      '<header class="ig-post-h"><a class="ig-user" data-u="' + esc(p.user.username) + '">' + avatar(p.user, 34) + "<b>" + esc(p.user.username) + '</b></a><button class="ig-more" type="button" aria-label="بیشتر">' + ic("dots") + "</button></header>" +
      '<div class="ig-media">' + mediaHTML(p) + '<div class="ig-burst">❤</div></div>' +
      '<div class="ig-actions"><button class="like" type="button" aria-label="لایک">' + ic("heart") + '</button><button class="cm" type="button" aria-label="نظر">' + ic("comment") + '</button><button class="sh" type="button" aria-label="ارسال">' + ic("send") + '</button><span class="sp"></span><button class="save" type="button" aria-label="ذخیره">' + ic("save") + "</button></div>" +
      '<div class="ig-meta"><div class="ig-likes lc"></div>' + capHTML(p) + '<a class="ig-viewc cc"></a><div class="ig-when">' + ago(p.created_at) + "</div></div></article>");
    bindDoubleTap($(".ig-media", card), p);
    $(".like", card).onclick = function () { setLike(p, !p.liked); };
    $(".cm", card).onclick = $(".cc", card).onclick = function () { openComments(p); };
    $(".sh", card).onclick = function () { openShare(p); };
    $(".save", card).onclick = function () { setSave(p); };
    $(".ig-more", card).onclick = function () { openPostMenu(p, card); };
    $(".ig-user", card).onclick = function () { openProfile(p.user.username); };
    var more = $(".more", card);
    if (more) more.onclick = function () { $(".ig-cap span", card).textContent = p.caption; more.remove(); };
    paint(p);
    return card;
  }
  function capHTML(p) {
    if (!p.caption) return "";
    var long = p.caption.length > 110;
    return '<div class="ig-cap"><b>' + esc(p.user.username) + "</b><span>" + esc(long ? p.caption.slice(0, 110) + "…" : p.caption) + "</span>" + (long ? ' <a class="more">بیشتر</a>' : "") + "</div>";
  }

  /* ---------- comments ---------- */
  function openComments(p) {
    sheet("نظرها", function (body, close) {
      body.innerHTML = '<div class="ig-spin"></div>';
      var foot = el('<form class="ig-compose">' + avatar(ME, 34) + '<input maxlength="500" placeholder="نظرت را بنویس…" aria-label="نظر"><button class="send" type="submit" disabled>ارسال</button></form>');
      var inp = $("input", foot), btn = $(".send", foot);
      inp.addEventListener("input", function () { btn.disabled = !inp.value.trim(); });
      function draw(list) {
        if (!list.length) { body.innerHTML = '<div class="ig-empty"><div class="big">💬</div><h3>هنوز نظری نیست</h3>اولین نفر باش.</div>'; return; }
        body.innerHTML = "";
        list.forEach(function (c) {
          var row = el('<div class="ig-com">' + avatar(c.user, 34) + '<div class="c"><b>' + esc(c.user.username) + "</b>" + esc(c.text) + "<small>" + ago(c.created_at) + (c.can_delete ? ' <a class="del">حذف</a>' : "") + "</small></div></div>");
          $(".ig-av", row).onclick = function () { close(); openProfile(c.user.username); };
          var d = $(".del", row);
          if (d) d.onclick = function () {
            api("/api/insta/comments/" + c.id, { method: "DELETE" }).then(function () { row.remove(); p.comments = Math.max(0, p.comments - 1); paint(p); }).catch(fail);
          };
          body.appendChild(row);
        });
      }
      api("/api/insta/posts/" + p.id + "/comments").then(function (d) { draw(d.comments); }).catch(function (e) { body.innerHTML = '<div class="ig-empty">' + esc(e.message) + "</div>"; });
      foot.addEventListener("submit", function (e) {
        e.preventDefault();
        var t = inp.value.trim(); if (!t) return;
        btn.disabled = true;
        api("/api/insta/posts/" + p.id + "/comments", { json: { text: t } }).then(function (d) {
          inp.value = ""; p.comments = d.comments.length; paint(p); draw(d.comments); body.scrollTop = body.scrollHeight;
        }).catch(function (er) { fail(er); btn.disabled = false; });
      });
      return foot;
    });
  }

  /* ---------- post menu ---------- */
  function openPostMenu(p, card) {
    sheet("", function (body, close) {
      function opt(icon, text, fn, danger) {
        var b = el('<button class="ig-opt' + (danger ? " danger" : "") + '" type="button">' + ic(icon) + "<span>" + text + "</span></button>");
        b.onclick = function () { close(); setTimeout(fn, 60); };
        body.appendChild(b);
      }
      opt("link", "کپی لینک پست", function () { copyText(location.origin + "/insta?post=" + p.id); toast("لینک کپی شد"); });
      opt("send", "ارسال در پیام", function () { openShare(p); });
      if (p.mine) {
        opt("edit", "ویرایش توضیحات", function () { editCaption(p); });
        opt("trash", "حذف پست", function () {
          if (!confirm("این پست برای همیشه حذف شود؟")) return;
          api("/api/insta/posts/" + p.id, { method: "DELETE" }).then(function () {
            $$('[data-pid="' + p.id + '"]').forEach(function (n) { n.remove(); }); $$('.ig-cell[data-pid="' + p.id + '"]').forEach(function (n) { n.remove(); });
            toast("پست حذف شد");
          }).catch(fail);
        }, true);
      } else opt("user", "مشاهده پروفایل", function () { openProfile(p.user.username); });
    });
  }
  function editCaption(p) {
    sheet("ویرایش توضیحات", function (body, close) {
      var f = el('<div class="ig-field" style="margin-top:12px"><textarea maxlength="2200"></textarea></div>');
      $("textarea", f).value = p.caption; body.appendChild(f);
      var foot = el('<div class="ig-compose"><button class="ig-btn full" type="button">ذخیره</button></div>');
      $("button", foot).onclick = function () {
        api("/api/insta/posts/" + p.id + "/caption", { json: { caption: $("textarea", f).value } }).then(function (d) {
          p.caption = d.caption; close(); toast("ذخیره شد");
          $$('[data-pid="' + p.id + '"] .ig-cap').forEach(function (c) { c.remove(); });
          $$('article[data-pid="' + p.id + '"] .ig-meta').forEach(function (m) { var h = el(capHTML(p) || "<span></span>"); m.insertBefore(h, $(".cc", m)); });
        }).catch(fail);
      };
      return foot;
    });
  }
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t).catch(function () {}); return; }
    var a = document.createElement("textarea"); a.value = t; document.body.appendChild(a); a.select();
    try { document.execCommand("copy"); } catch (e) { /* ignore */ } a.remove();
  }

  /* ---------- share a post into a DM ---------- */
  function sendText(gid, text) {
    return api("/api/messages", { json: { group_id: gid, text: text, cid: Math.random().toString(36).slice(2) } });
  }
  function openShare(p) {
    var link = location.origin + "/insta?post=" + p.id;
    sheet("ارسال به…", function (body, close) {
      var s = el('<div class="ig-search" style="position:static"><input placeholder="جستجوی کاربر…" autocomplete="off"></div>'), list = el("<div></div>");
      body.appendChild(s); body.appendChild(list);
      function row(u, gid) {
        var r = el('<div class="ig-row">' + avatar(u, 44) + '<div class="t"><b>' + esc(u.display_name || u.username) + "</b><small>@" + esc(u.username) + '</small></div><button class="ig-btn sm" type="button">ارسال</button></div>');
        var b = $("button", r);
        b.onclick = function (e) {
          e.stopPropagation(); b.disabled = true;
          (gid ? Promise.resolve({ id: gid }) : api("/api/dm", { json: { username: u.username } }))
            .then(function (d) { return sendText(d.id, link); })
            .then(function () { b.textContent = "ارسال شد ✓"; b.classList.add("alt"); })
            .catch(function (er) { fail(er); b.disabled = false; });
        };
        return r;
      }
      api("/api/insta/inbox").then(function (d) {
        list.innerHTML = "";
        d.chats.slice(0, 30).forEach(function (c) { list.appendChild(row(c.user, c.id)); });
        var cp = el('<button class="ig-opt" type="button">' + ic("link") + "<span>کپی لینک</span></button>");
        cp.onclick = function () { copyText(link); toast("لینک کپی شد"); };
        list.appendChild(cp);
      }).catch(fail);
      var t;
      $("input", s).addEventListener("input", function (e) {
        clearTimeout(t); var v = e.target.value.trim();
        t = setTimeout(function () {
          if (!v) { api("/api/insta/inbox").then(function (d) { list.innerHTML = ""; d.chats.slice(0, 30).forEach(function (c) { list.appendChild(row(c.user, c.id)); }); }); return; }
          api("/api/insta/search?q=" + encodeURIComponent(v)).then(function (d) { list.innerHTML = ""; d.users.forEach(function (u) { list.appendChild(row(u, null)); }); });
        }, 250);
      });
    });
  }

  /* ---------- infinite list helper ---------- */
  function infinite(container, scroller, loader) {
    var busy = false, done = false, cursor = null, sentinel = el('<div style="height:1px"></div>'), spin = el('<div class="ig-spin"></div>');
    container.appendChild(sentinel);
    function more() {
      if (busy || done) return; busy = true; container.insertBefore(spin, sentinel);
      loader(cursor).then(function (d) {
        spin.remove(); busy = false; cursor = d.next; if (!d.has_more) done = true;
      }).catch(function (e) { spin.remove(); busy = false; done = true; fail(e); });
    }
    if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { if (es[0].isIntersecting) more(); }, { root: scroller, rootMargin: "600px" }).observe(sentinel);
    more();
    return { more: more };
  }

  /* ---------- stories ---------- */
  var storyGroups = [];
  var BG = ["#6a11cb,#2575fc", "#f12711,#f5af19", "#11998e,#38ef7d", "#ee0979,#ff6a00", "#4568dc,#b06ab3", "#0f2027,#2c5364", "#fc466b,#3f5efb", "#00c6ff,#0072ff", "#f7971e,#ffd200", "#7f00ff,#e100ff", "#1d976c,#93f9b9", "#232526,#414345"];
  function loadStories() {
    return api("/api/stories").then(function (d) { storyGroups = d.groups || []; drawStories(); }).catch(function () {});
  }
  function drawStories() {
    var bar = $("#ig-stories"); if (!bar) return;
    bar.innerHTML = "";
    var mineIdx = -1;
    storyGroups.forEach(function (g, i) { if (g.user.username === ME.username) mineIdx = i; });
    var mine = el('<div class="ig-st mine"><div class="ig-ring seen" style="background:none">' + avatar(ME, 66) + '</div><i class="plus">' + ic("plus") + "</i><span>استوری تو</span></div>");
    if (mineIdx >= 0) { var rg = $(".ig-ring", mine); rg.className = "ig-ring"; rg.removeAttribute("style"); }
    $(".plus", mine).onclick = function (e) { e.stopPropagation(); openComposer("story"); };
    mine.onclick = function () { mineIdx >= 0 ? openStories(mineIdx) : openComposer("story"); };
    bar.appendChild(mine);
    storyGroups.forEach(function (g, i) {
      if (i === mineIdx) return;
      var s = el('<div class="ig-st"><div class="ig-ring' + (g.unseen ? "" : " seen") + '">' + avatar(g.user, 66) + "</div><span>" + esc(g.user.username) + "</span></div>");
      s.onclick = function () { openStories(i); };
      bar.appendChild(s);
    });
  }
  function openStories(gi) {
    var groups = storyGroups, si = 0, tm = null, node = el('<div class="ig-story"><div class="stage"></div><div class="bars"></div><div class="who"></div><div class="tap l"></div><div class="tap r"></div><div class="cap"></div><div class="foot"></div></div>');
    function firstUnseen(g) { for (var i = 0; i < g.stories.length; i++) if (!g.stories[i].viewed) return i; return 0; }
    si = firstUnseen(groups[gi]);
    function clear() { clearTimeout(tm); }
    function close() { clear(); closeNode(node); }
    function nextS() { var g = groups[gi]; if (si < g.stories.length - 1) { si++; show(); } else if (gi < groups.length - 1) { gi++; si = firstUnseen(groups[gi]); show(); } else close(); }
    function prevS() { if (si > 0) { si--; show(); } else if (gi > 0) { gi--; si = 0; show(); } else show(); }
    function animate(b, ms) { b.style.transition = "none"; b.style.width = "0"; void b.offsetWidth; b.style.transition = "width " + ms + "ms linear"; b.style.width = "100%"; }
    function show() {
      clear();
      var g = groups[gi], s = g.stories[si], mineS = g.user.username === ME.username;
      $(".bars", node).innerHTML = g.stories.map(function (x, i) { return '<i class="' + (i < si ? "done" : "") + '"><b></b></i>'; }).join("");
      var bar = $$(".bars i b", node)[si];
      $(".who", node).innerHTML = avatar(g.user, 36) + "<span>" + esc(g.user.username) + "</span><small>" + ago(s.created_at) + '</small><span class="sp"></span>' + (mineS ? '<button type="button" data-del aria-label="حذف">' + ic("trash") + "</button>" : "") + '<button type="button" data-x aria-label="بستن">' + ic("close") + "</button>";
      $("[data-x]", node).onclick = close;
      var del = $("[data-del]", node);
      if (del) del.onclick = function () {
        if (!confirm("این استوری حذف شود؟")) return;
        api("/api/stories/" + s.id, { method: "DELETE" }).then(function () {
          g.stories.splice(si, 1);
          if (!g.stories.length) { groups.splice(gi, 1); if (!groups.length) { close(); loadStories(); return; } if (gi >= groups.length) gi = groups.length - 1; si = 0; }
          else if (si >= g.stories.length) si = g.stories.length - 1;
          show(); loadStories();
        }).catch(fail);
      };
      var stage = $(".stage", node), dur = 5000;
      if (s.kind === "video") {
        stage.innerHTML = '<video playsinline autoplay></video>';
        var v = $("video", stage); v.src = s.media_url; v.muted = false;
        v.onloadedmetadata = function () { animate(bar, (v.duration || 5) * 1000); };
        v.onended = nextS;
        v.onerror = function () { tm = setTimeout(nextS, 2000); };
        var pr = v.play(); if (pr && pr.catch) pr.catch(function () { v.muted = true; v.play().catch(function () {}); });
      } else if (s.kind === "text") {
        var c = (BG[(parseInt(String(s.bg || "g1").slice(1), 10) || 1) - 1] || BG[0]).split(",");
        stage.innerHTML = '<div class="txt" style="background:linear-gradient(135deg,' + c[0] + "," + c[1] + ')">' + esc(s.text) + "</div>";
        animate(bar, dur); tm = setTimeout(nextS, dur);
      } else {
        stage.innerHTML = '<img alt="" src="' + esc(s.media_url) + '">';
        animate(bar, dur); tm = setTimeout(nextS, dur);
      }
      $(".cap", node).textContent = s.caption || "";
      $(".foot", node).textContent = mineS ? "👁 " + fa(s.views_count || 0) + " بازدید" : "";
      if (!s.viewed && !mineS) { s.viewed = true; api("/api/stories/" + s.id + "/view", { method: "POST", json: {} }).catch(function () {}); }
    }
    $(".tap.l", node).onclick = nextS;     /* RTL: left side = next, right side = previous */
    $(".tap.r", node).onclick = prevS;
    openLayer(node, function () { clear(); $$("video", node).forEach(function (v) { v.pause(); }); loadStories(); });
    show();
  }

  /* ---------- HOME ---------- */
  function topbar() {
    var t = el('<header class="ig-top"><button type="button" data-add aria-label="ساخت">' + ic("plusq") + '</button><h1 data-menu>Insta Mode ' + ic("down") + '</h1><button type="button" data-heart aria-label="فعالیت">' + ic("heart") + "</button></header>");
    $("[data-add]", t).onclick = openCreate;
    $("[data-menu]", t).onclick = openMenu;
    $("[data-heart]", t).onclick = openActivity;
    return t;
  }
  function renderHome() {
    main.innerHTML = ""; main.classList.remove("reels");
    main.appendChild(topbar());
    main.appendChild(el('<div class="ig-stories" id="ig-stories"></div>'));
    drawStories(); loadStories();
    var feed = el("<div></div>"); main.appendChild(feed);
    var first = true;
    infinite(feed, main, function (cursor) {
      return api("/api/insta/feed" + (cursor ? "?before=" + cursor : "")).then(function (d) {
        if (first && !d.posts.length) {
          first = false;
          feed.insertBefore(el('<div class="ig-empty"><div class="big">📸</div><h3>فید تو خالیه</h3>چند نفر را دنبال کن یا اولین پستت را بساز.<div style="margin-top:16px;display:flex;gap:8px;justify-content:center"><button class="ig-btn" data-go="explore" type="button">کاوش</button><button class="ig-btn alt" data-go="add" type="button">پست جدید</button></div></div>'), feed.lastChild);
          $("[data-go=explore]", feed).onclick = function () { show("explore"); };
          $("[data-go=add]", feed).onclick = openCreate;
        }
        first = false;
        d.posts.forEach(function (p) { feed.insertBefore(postCard(p), feed.lastChild); });
        return d;
      });
    });
  }

  /* ---------- REELS ---------- */
  function renderReels() {
    main.innerHTML = ""; main.classList.add("reels");
    var wrap = el('<div class="ig-reels"></div>');
    var top = el('<div class="ig-reel-top"><button type="button" data-add aria-label="ریلز جدید">' + ic("cam") + '</button><h2>ریلز</h2><button type="button" data-menu aria-label="منو">' + ic("dots") + "</button></div>");
    $("[data-add]", top).onclick = function () { openComposer("reel"); };
    $("[data-menu]", top).onclick = openMenu;
    main.appendChild(top); main.appendChild(wrap);
    var first = true;
    infinite(wrap, wrap, function (cursor) {
      return api("/api/insta/reels" + (cursor ? "?before=" + cursor : "")).then(function (d) {
        if (first && !d.posts.length) { wrap.insertBefore(el('<div class="ig-reel"><div class="ig-empty" style="color:#bbb;padding-top:30vh"><div class="big">🎬</div><h3 style="color:#fff">هنوز ریلزی نیست</h3>اولین ریلز را تو بساز.</div></div>'), wrap.lastChild); }
        first = false;
        d.posts.forEach(function (p) { wrap.insertBefore(reelItem(p), wrap.lastChild); });
        return d;
      });
    });
  }
  function reelItem(p) {
    P[p.id] = p;
    var r = el('<section class="ig-reel" data-pid="' + p.id + '"><video src="' + esc(p.media_url) + '" playsinline muted loop preload="metadata" data-w="1"></video><span class="ig-snd">' + ic(soundOn ? "vol" : "mute") + '</span><div class="ig-burst">❤</div><div class="shade"></div>' +
      '<div class="info"><a class="u">' + avatar(p.user, 36) + "<span>" + esc(p.user.username) + '</span></a><div class="cap">' + esc(p.caption) + "</div></div>" +
      '<div class="rail"><button class="like" type="button">' + ic("heart") + '<span class="lc"></span></button><button class="cm" type="button">' + ic("comment") + '<span class="cc"></span></button><button class="sh" type="button">' + ic("send") + '</button><button class="save" type="button">' + ic("save") + '</button><button class="mo" type="button">' + ic("dots") + "</button></div></section>");
    var box = r, last = 0, t = null, v = $("video", r);
    r.addEventListener("click", function (e) {
      if (e.target.closest("button,a")) return;
      var now = Date.now();
      if (now - last < 320) { clearTimeout(t); last = 0; if (!p.liked) setLike(p, true); burst(box); }
      else { last = now; t = setTimeout(function () { soundOn = !soundOn; applySound(); }, 320); }
    });
    watchVideo(v);
    $(".like", r).onclick = function () { setLike(p, !p.liked); };
    $(".cm", r).onclick = function () { openComments(p); };
    $(".sh", r).onclick = function () { openShare(p); };
    $(".save", r).onclick = function () { setSave(p); };
    $(".mo", r).onclick = function () { openPostMenu(p, r); };
    $(".u", r).onclick = function () { openProfile(p.user.username); };
    paint(p);
    return r;
  }

  /* ---------- EXPLORE ---------- */
  function cellHTML(p) {
    return (p.media_type === "video" ? '<video src="' + esc(p.media_url) + '#t=0.1" preload="metadata" muted playsinline></video><i>' + (p.kind === "reel" ? ic("reels") : ic("play", "fill")) + "</i>" : '<img src="' + esc(p.media_url) + '" alt="" loading="lazy">');
  }
  function fillGrid(grid, posts, startIndex, all) {
    posts.forEach(function (p, k) {
      var c = el('<div class="ig-cell" data-pid="' + p.id + '">' + cellHTML(p) + "</div>");
      P[p.id] = p;
      c.onclick = function () { openPostList(all(), all().indexOf(p)); };
      grid.appendChild(c);
    });
  }
  function personRow(u, extra, onclick) {
    var r = el('<div class="ig-row">' + avatar(u, 48) + '<div class="t"><b>' + esc(u.username) + "</b><small>" + esc(u.display_name || "") + "</small></div>" + (extra || "") + "</div>");
    r.onclick = onclick || function () { openProfile(u.username); };
    return r;
  }
  function renderExplore() {
    main.innerHTML = ""; main.classList.remove("reels");
    var s = el('<div class="ig-search"><input type="search" placeholder="جستجوی افراد…" autocomplete="off" aria-label="جستجو"></div>');
    var res = el('<div hidden></div>'), grid = el('<div class="ig-grid"></div>'), wrap = el("<div></div>");
    wrap.appendChild(grid);
    main.appendChild(s); main.appendChild(res); main.appendChild(wrap);
    var all = [];
    infinite(wrap, main, function (cursor) {
      return api("/api/insta/explore" + (cursor ? "?before=" + cursor : "")).then(function (d) {
        if (!all.length && !d.posts.length) wrap.insertBefore(el('<div class="ig-empty"><div class="big">🔎</div><h3>هنوز پستی نیست</h3>اولین پست را تو بساز.</div>'), wrap.lastChild);
        all = all.concat(d.posts); fillGrid(grid, d.posts, 0, function () { return all; }); return d;
      });
    });
    var t;
    $("input", s).addEventListener("input", function (e) {
      clearTimeout(t); var v = e.target.value.trim();
      if (!v) { res.hidden = true; wrap.hidden = false; return; }
      t = setTimeout(function () {
        api("/api/insta/search?q=" + encodeURIComponent(v)).then(function (d) {
          wrap.hidden = true; res.hidden = false; res.innerHTML = "";
          if (!d.users.length) res.innerHTML = '<div class="ig-empty">کاربری پیدا نشد.</div>';
          d.users.forEach(function (u) { res.appendChild(personRow(u)); });
        }).catch(fail);
      }, 250);
    });
  }
  function openPostList(list, idx) {
    var pg = page({ title: "پست‌ها" });
    list.forEach(function (p) { pg.body.appendChild(postCard(p)); });
    setTimeout(function () { var c = pg.body.children[idx]; if (c) pg.body.scrollTop = c.offsetTop - 4; refreshVideos(); }, 260);
  }
  function openPostById(id) {
    api("/api/insta/posts/" + id).then(function (d) { openPostList([d.post], 0); }).catch(fail);
  }

  /* ---------- PROFILE ---------- */
  function openProfile(username) {
    if (username === ME.username && !stack.length) { show("me"); return; }
    var pg = page({ title: "@" + username });
    profileView(pg.body, username);
  }
  function profileView(body, username) {
    body.innerHTML = '<div class="ig-spin"></div>';
    api("/api/insta/profile/" + encodeURIComponent(username)).then(render).catch(function (e) { body.innerHTML = '<div class="ig-empty"><h3>' + esc(e.message) + "</h3></div>"; });
    function render(d) {
      var u = d.user, tab = "posts", posts = d.posts.slice(), cursor = d.next, more = d.has_more, saved = null, loading = false;
      body.innerHTML = "";
      var head = el('<div class="ig-prof"><div class="ig-prof-top">' + avatar(u, 84) + '<div class="ig-stats"><div data-s="posts"><b>' + fa(d.counts.posts) + '</b><span>پست</span></div><div data-s="followers"><b>' + fa(d.counts.followers) + '</b><span>دنبال‌کننده</span></div><div data-s="following"><b>' + fa(d.counts.following) + "</b><span>دنبال‌شونده</span></div></div></div><h2>" + esc(u.display_name) + (u.premium ? " ⭐" : "") + (u.private_account ? " 🔒" : "") + "</h2>" + (u.bio ? "<p>" + esc(u.bio) + "</p>" : "") + '<div class="ig-prof-btns"></div></div>');
      body.appendChild(head);
      var btns = $(".ig-prof-btns", head);
      function drawBtns() {
        btns.innerHTML = "";
        if (d.is_me) {
          btns.innerHTML = '<a class="ig-btn alt full" href="/chat">ویرایش پروفایل</a><button class="ig-btn alt full" type="button" data-share>اشتراک پروفایل</button>';
          $("[data-share]", btns).onclick = function () { copyText(location.origin + "/insta?u=" + u.username); toast("لینک پروفایل کپی شد"); };
          return;
        }
        var label = d.follow === "following" ? "دنبال می‌کنی" : d.follow === "requested" ? "درخواست ارسال شد" : (d.follows_me ? "دنبال کردن متقابل" : "دنبال کردن");
        var f = el('<button class="ig-btn full' + (d.follow === "none" ? "" : " alt") + '" type="button">' + label + "</button>"), m = el('<button class="ig-btn alt full" type="button">پیام</button>');
        f.onclick = function () {
          if (d.follow === "following" && !confirm("دنبال کردن @" + u.username + " لغو شود؟")) return;
          f.disabled = true;
          api("/api/insta/follow/" + encodeURIComponent(u.username), { json: { follow: d.follow === "none" } }).then(function (r) { profileView(body, username); }).catch(function (e) { fail(e); f.disabled = false; });
        };
        m.onclick = function () { openDM(u.username); };
        btns.appendChild(f); btns.appendChild(m);
      }
      drawBtns();
      $$("[data-s]", head).forEach(function (n) {
        n.onclick = function () { var k = n.dataset.s; if (k === "posts") return; if (!d.visible) return toast("این حساب خصوصی است."); openFollowList(u, k); };
      });
      if (!d.visible) { body.appendChild(el('<div class="ig-lock"><div class="big" style="font-size:44px">🔒</div><h3>این حساب خصوصی است</h3>برای دیدن پست‌ها، دنبالش کن.</div>')); return; }
      var tabs = el('<div class="ig-tabs"><button class="on" data-t="posts" type="button" aria-label="پست‌ها">' + ic("grid") + '</button><button data-t="reels" type="button" aria-label="ریلز">' + ic("reels") + "</button>" + (d.is_me ? '<button data-t="saved" type="button" aria-label="ذخیره‌شده">' + ic("save") + "</button>" : "") + "</div>");
      var grid = el('<div class="ig-grid"></div>'), tail = el('<div class="ig-spin" hidden></div>'), sent = el('<div style="height:1px"></div>');
      body.appendChild(tabs); body.appendChild(grid); body.appendChild(tail); body.appendChild(sent);
      function list() { return tab === "saved" ? (saved || []) : posts.filter(function (p) { return tab === "reels" ? p.kind === "reel" : true; }); }
      function draw() {
        grid.innerHTML = ""; var l = list();
        if (!l.length && !(tab !== "saved" && more) && !(tab === "saved" && saved === null)) {
          grid.style.display = "block"; grid.innerHTML = '<div class="ig-empty"><div class="big">' + (tab === "saved" ? "🔖" : "📷") + "</div><h3>" + (tab === "saved" ? "چیزی ذخیره نکرده‌ای" : tab === "reels" ? "ریلزی نیست" : "هنوز پستی نیست") + "</h3></div>";
        } else { grid.style.display = ""; fillGrid(grid, l, 0, list); }
      }
      function loadMore() {
        if (loading || tab === "saved" || !more) return;
        loading = true; tail.hidden = false;
        api("/api/insta/user/" + encodeURIComponent(username) + "/posts?before=" + cursor).then(function (r) {
          posts = posts.concat(r.posts); cursor = r.next; more = r.has_more; loading = false; tail.hidden = true; draw();
        }).catch(function (e) { loading = false; tail.hidden = true; more = false; fail(e); });
      }
      $$("button", tabs).forEach(function (b) {
        b.onclick = function () {
          tab = b.dataset.t; $$("button", tabs).forEach(function (x) { x.classList.toggle("on", x === b); });
          if (tab === "saved" && saved === null) { api("/api/insta/saved").then(function (r) { saved = r.posts; draw(); }).catch(fail); }
          draw();
        };
      });
      draw();
      var scroller = body.closest(".ig-page-b") || main;
      if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { if (es[0].isIntersecting) loadMore(); }, { root: scroller, rootMargin: "500px" }).observe(sent);
    }
  }
  function renderMe() {
    main.innerHTML = ""; main.classList.remove("reels");
    var t = el('<header class="ig-top"><button type="button" data-add aria-label="ساخت">' + ic("plusq") + '</button><h1 data-menu style="font-family:inherit;font-size:18px">' + esc(ME.username) + " " + ic("down") + '</h1><button type="button" data-heart aria-label="فعالیت">' + ic("heart") + "</button></header>");
    $("[data-add]", t).onclick = openCreate; $("[data-menu]", t).onclick = openMenu; $("[data-heart]", t).onclick = openActivity;
    main.appendChild(t);
    var body = el("<div></div>"); main.appendChild(body);
    profileView(body, ME.username);
  }
  function openFollowList(u, kind) {
    var pg = page({ title: (kind === "followers" ? "دنبال‌کنندگان " : "دنبال‌شونده‌ها ") + "@" + u.username });
    pg.body.innerHTML = '<div class="ig-spin"></div>';
    api("/api/insta/follows/" + encodeURIComponent(u.username) + "?type=" + kind).then(function (d) {
      pg.body.innerHTML = "";
      if (!d.users.length) pg.body.innerHTML = '<div class="ig-empty">فهرست خالی است.</div>';
      d.users.forEach(function (x) { pg.body.appendChild(personRow(x, "", function () { openProfile(x.username); })); });
    }).catch(function (e) { pg.body.innerHTML = '<div class="ig-empty">' + esc(e.message) + "</div>"; });
  }

  /* ---------- MESSAGES (existing DM system) ---------- */
  function seenMap() { try { return JSON.parse(store("ig_seen") || "null"); } catch (e) { return null; } }
  function saveSeen(m) { store("ig_seen", JSON.stringify(m)); }
  function unreadOf(chats) {
    var m = seenMap();
    if (!m) { m = {}; chats.forEach(function (c) { m[c.id] = c.seq || 0; }); saveSeen(m); return 0; }
    return chats.filter(function (c) { return c.last && !c.last_by_me && (c.seq || 0) > (m[c.id] || 0); }).length;
  }
  function markSeen(gid, seq) { var m = seenMap() || {}; if ((m[gid] || 0) < seq) { m[gid] = seq; saveSeen(m); } }
  function renderInbox() {
    main.innerHTML = ""; main.classList.remove("reels");
    var t = el('<header class="ig-top simple"><h1>پیام‌ها</h1></header>');
    var nb = el('<button type="button" aria-label="پیام جدید" style="position:absolute;left:12px">' + ic("edit") + "</button>");
    nb.onclick = openNewDM; t.appendChild(nb); main.appendChild(t);
    var list = el('<div><div class="ig-spin"></div></div>'); main.appendChild(list);
    api("/api/insta/inbox").then(function (d) {
      setBadge("inbox", unreadOf(d.chats));
      var m = seenMap() || {};
      list.innerHTML = "";
      if (!d.chats.length) { list.innerHTML = '<div class="ig-empty"><div class="big">✉️</div><h3>پیامی نداری</h3>با دکمهٔ بالا یک گفتگوی جدید شروع کن.</div>'; return; }
      d.chats.forEach(function (c) {
        var unread = c.last && !c.last_by_me && (c.seq || 0) > (m[c.id] || 0);
        var r = el('<div class="ig-row">' + avatar(c.user, 54) + '<div class="t"><b>' + esc(c.user.display_name || c.user.username) + '</b><small class="' + (unread ? "unread" : "") + '">' + esc((c.last_by_me ? "تو: " : "") + (c.last || "")) + "</small></div>" + (unread ? '<span class="ud"></span>' : "") + "</div>");
        r.onclick = function () { openThread(c.id, c.user); };
        list.appendChild(r);
      });
    }).catch(function (e) { list.innerHTML = '<div class="ig-empty">' + esc(e.message) + "</div>"; });
  }
  function openNewDM() {
    sheet("پیام جدید", function (body, close) {
      var s = el('<div class="ig-search" style="position:static"><input placeholder="نام کاربری یا نام…" autocomplete="off"></div>'), list = el("<div></div>");
      body.appendChild(s); body.appendChild(list);
      var t;
      $("input", s).addEventListener("input", function (e) {
        clearTimeout(t); var v = e.target.value.trim(); if (!v) { list.innerHTML = ""; return; }
        t = setTimeout(function () {
          api("/api/insta/search?q=" + encodeURIComponent(v)).then(function (d) {
            list.innerHTML = ""; d.users.forEach(function (u) { list.appendChild(personRow(u, "", function () { close(); setTimeout(function () { openDM(u.username); }, 80); })); });
          }).catch(fail);
        }, 250);
      });
    });
  }
  function openDM(username) {
    api("/api/dm", { json: { username: username } }).then(function (d) { openThread(d.id, d.user); }).catch(fail);
  }
  function hhmm(iso) { try { return new Date(iso).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } }
  function bubble(m) {
    var mine = m.username === ME.username, a = m.attach, t = m.text || "", h = "";
    if (a) {
      if (a.kind === "image") h += '<img src="' + esc(a.url) + '" alt="" loading="lazy">';
      else if (a.kind === "video") h += '<video src="' + esc(a.url) + '" controls playsinline preload="metadata"></video>';
      else if (a.kind === "audio") h += '<audio src="' + esc(a.url) + '" controls></audio>';
      else h += '<a href="' + esc(a.url) + '" target="_blank" rel="noopener">📎 ' + esc(a.name || "فایل") + "</a><br>";
    }
    if (t) {
      var pm = t.match(/\/insta\?post=([0-9a-f]{16})/);
      if (pm) h += '<div class="pc" data-post="' + pm[1] + '">' + ic("grid") + " مشاهدهٔ پست</div>";
      else if (t.charAt(0) === "\u27e6") h += "📎 پیام ویژه (در چت اصلی ببین)";
      else h += esc(t);
    }
    var n = el('<div class="ig-msg' + (mine ? " me" : "") + '">' + h + "<time>" + hhmm(m.created_at) + "</time></div>");
    var pc = $(".pc", n); if (pc) pc.onclick = function () { openPostById(pc.dataset.post); };
    return n;
  }
  function openThread(gid, user) {
    var timer = null, lastSeq = 0, seen = {};
    var pg = page({ user: user, onClose: function () { clearInterval(timer); refreshBadges(); if (tab === "inbox" && !stack.length) renderInbox(); } });
    pg.head.style.cursor = "pointer"; pg.head.onclick = function () { openProfile(user.username); };
    var list = el('<div class="ig-thread"></div>'); pg.body.appendChild(list);
    var foot = el('<form class="ig-compose"><button class="att" type="button" aria-label="پیوست">' + ic("clip") + '</button><input type="file" hidden><input class="tx" maxlength="1000" placeholder="پیام…" autocomplete="off" aria-label="پیام"><button class="send" type="submit" disabled>ارسال</button></form>');
    pg.node.appendChild(foot);
    var tx = $(".tx", foot), sendB = $(".send", foot), file = $("input[type=file]", foot);
    function nearBottom() { return pg.body.scrollHeight - pg.body.scrollTop - pg.body.clientHeight < 140; }
    function add(m) { if (seen[m.id]) return false; seen[m.id] = 1; lastSeq = Math.max(lastSeq, m.seq || 0); list.appendChild(bubble(m)); return true; }
    function toEnd() { pg.body.scrollTop = pg.body.scrollHeight; }
    api("/api/messages?group_id=" + encodeURIComponent(gid)).then(function (d) {
      d.messages.forEach(add); setTimeout(toEnd, 30); markSeen(gid, lastSeq);
      if (!d.messages.length) list.appendChild(el('<div class="ig-empty" style="padding:40px 10px">سلام بگو 👋</div>'));
    }).catch(fail);
    timer = setInterval(function () {
      if (document.hidden) return;
      api("/api/messages?group_id=" + encodeURIComponent(gid) + "&after=" + lastSeq).then(function (d) {
        var stick = nearBottom(), n = 0; d.messages.forEach(function (m) { if (add(m)) n++; });
        if (n) { if (stick) toEnd(); markSeen(gid, lastSeq); }
      }).catch(function () {});
    }, 3000);
    tx.addEventListener("input", function () { sendB.disabled = !tx.value.trim(); });
    foot.addEventListener("submit", function (e) {
      e.preventDefault(); var t = tx.value.trim(); if (!t) return;
      tx.value = ""; sendB.disabled = true;
      sendText(gid, t).then(function (d) { var e0 = $(".ig-empty", list); if (e0) e0.remove(); add(d.message); toEnd(); markSeen(gid, lastSeq); }).catch(function (er) { tx.value = t; sendB.disabled = false; fail(er); });
    });
    $(".att", foot).onclick = function () { file.click(); };
    file.onchange = function () {
      var f = file.files[0]; if (!f) return;
      var fd = new FormData(); fd.append("file", f, f.name); fd.append("group_id", gid); fd.append("cid", Math.random().toString(36).slice(2));
      toast("در حال ارسال…");
      api("/api/upload", { form: fd }).then(function (d) { add(d.message); toEnd(); markSeen(gid, lastSeq); toast("ارسال شد"); }).catch(fail);
      file.value = "";
    };
  }

  /* ---------- ACTIVITY ---------- */
  function openActivity() {
    var pg = page({ title: "فعالیت", onClose: function () { store("ig_act_seen", String(Date.now() / 1000)); refreshBadges(); } });
    pg.body.innerHTML = '<div class="ig-spin"></div>';
    api("/api/insta/activity").then(function (d) {
      pg.body.innerHTML = "";
      if (d.requests.length) {
        pg.body.appendChild(el('<div class="ig-sec">درخواست‌های دنبال کردن</div>'));
        d.requests.forEach(function (u) {
          var r = personRow(u, '<button class="ig-btn sm" data-ok type="button">تأیید</button><button class="ig-btn alt sm" data-no type="button">حذف</button>');
          function answer(ok) { api("/api/insta/requests/" + encodeURIComponent(u.username), { json: { accept: ok } }).then(function () { r.remove(); }).catch(fail); }
          $("[data-ok]", r).onclick = function (e) { e.stopPropagation(); answer(true); };
          $("[data-no]", r).onclick = function (e) { e.stopPropagation(); answer(false); };
          pg.body.appendChild(r);
        });
      }
      pg.body.appendChild(el('<div class="ig-sec">اخیراً</div>'));
      if (!d.events.length) pg.body.appendChild(el('<div class="ig-empty" style="padding:30px">هنوز فعالیتی نیست.</div>'));
      d.events.forEach(function (ev) {
        var txt = ev.type === "like" ? "پستت را لایک کرد." : ev.type === "comment" ? "نظر داد: " + esc(ev.text) : "شروع به دنبال کردنت کرد.";
        var th = ev.thumb ? '<div class="th">' + (ev.thumb_type === "video" ? '<video src="' + esc(ev.thumb) + '#t=0.1" preload="metadata" muted></video>' : '<img src="' + esc(ev.thumb) + '" alt="" loading="lazy">') + "</div>" : "";
        var r = el('<div class="ig-row ig-act">' + avatar(ev.user, 44) + '<div class="t"><span class="t"><b>' + esc(ev.user.username) + "</b> " + txt + " <small>" + ago(ev.at) + "</small></span></div>" + th + "</div>");
        r.onclick = function () { ev.post_id ? openPostById(ev.post_id) : openProfile(ev.user.username); };
        pg.body.appendChild(r);
      });
    }).catch(function (e) { pg.body.innerHTML = '<div class="ig-empty">' + esc(e.message) + "</div>"; });
  }

  /* ---------- CREATE ---------- */
  function openCreate() {
    sheet("ساخت", function (body, close) {
      [["grid", "پست", "post"], ["reels", "ریلز", "reel"], ["plusq", "استوری", "story"]].forEach(function (o) {
        var b = el('<button class="ig-opt" type="button">' + ic(o[0]) + "<span>" + o[1] + "</span></button>");
        b.onclick = function () { close(); setTimeout(function () { openComposer(o[2]); }, 80); };
        body.appendChild(b);
      });
    });
  }
  var MIMEEXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov" };
  function openComposer(kind) {
    var title = kind === "story" ? "استوری جدید" : kind === "reel" ? "ریلز جدید" : "پست جدید";
    var pg = page({ title: title }), chosen = null;
    var share = el('<button class="ig-btn sm" type="button" disabled>اشتراک</button>'); pg.ex.appendChild(share);
    var input = el('<input type="file" hidden accept="' + (kind === "reel" ? "video/*" : "image/*,video/*") + '">');
    var pick = el('<div class="ig-pick" role="button" tabindex="0"><div><div style="font-size:44px">' + (kind === "reel" ? "🎬" : "🖼️") + "</div>" + (kind === "reel" ? "یک ویدیو انتخاب کن" : "یک عکس یا ویدیو انتخاب کن") + "</div></div>");
    var cap = el('<div class="ig-field"><textarea maxlength="' + (kind === "story" ? 200 : 2200) + '" placeholder="' + (kind === "story" ? "متن روی استوری (اختیاری)…" : "یک توضیح بنویس…") + '"></textarea></div>');
    var prog = el('<div class="ig-prog" hidden><b></b></div>');
    pg.body.appendChild(input); pg.body.appendChild(pick); pg.body.appendChild(cap); pg.body.appendChild(prog);
    pg.body.appendChild(el('<div class="ig-note">' + (kind === "story" ? "استوری تا ۲۴ ساعت دیده می‌شود." : "حداکثر حجم ویدیو بر اساس تنظیمات سرور محدود است.") + "</div>"));
    pick.onclick = function () { input.click(); };
    input.onchange = function () {
      var f = input.files[0]; if (!f) return; chosen = f;
      var url = URL.createObjectURL(f), isV = (f.type || "").indexOf("video") === 0;
      pick.innerHTML = isV ? '<video src="' + url + '" controls muted playsinline></video>' : '<img src="' + url + '" alt="">';
      share.disabled = false;
    };
    share.onclick = function () {
      if (!chosen) return;
      var ext = MIMEEXT[chosen.type] || ((chosen.name.match(/\.[A-Za-z0-9]{1,5}$/) || [""])[0].toLowerCase()), isV = (chosen.type || "").indexOf("video") === 0;
      var fd = new FormData(), url;
      if (kind === "story") {
        url = "/api/stories"; fd.append("kind", isV ? "video" : "image"); fd.append("image", chosen, "story" + ext);
        fd.append("caption", $("textarea", cap).value); fd.append("duration", "24"); fd.append("audience", "everyone"); fd.append("save_profile", "1");
      } else {
        url = "/api/insta/posts"; fd.append("kind", kind); fd.append("file", chosen, "post" + ext); fd.append("caption", $("textarea", cap).value);
      }
      share.disabled = true; prog.hidden = false;
      var x = new XMLHttpRequest(); x.open("POST", url); x.withCredentials = true;
      x.upload.onprogress = function (e) { if (e.lengthComputable) $("b", prog).style.width = Math.round(e.loaded / e.total * 100) + "%"; };
      x.onload = function () {
        var d = {}; try { d = JSON.parse(x.responseText); } catch (e) { /* ignore */ }
        if (x.status === 401) { location.href = "/"; return; }
        if (x.status >= 200 && x.status < 300 && d.ok) {
          toast(kind === "story" ? "استوری منتشر شد ✓" : "منتشر شد ✓"); pg.close();
          setTimeout(function () { kind === "story" ? loadStories() : show(tab === "me" || tab === "home" ? tab : "me"); }, 300);
        } else { toast(d.error || (x.status === 413 ? "حجم فایل زیاد است." : "ارسال ناموفق بود.")); share.disabled = false; prog.hidden = true; }
      };
      x.onerror = function () { toast("اتصال برقرار نشد."); share.disabled = false; prog.hidden = true; };
      x.send(fd);
    };
  }

  /* ---------- menu (tap on the title) ---------- */
  function openMenu() {
    sheet("", function (body, close) {
      function opt(icon, label, fn) { var b = el('<button class="ig-opt" type="button">' + ic(icon) + "<span>" + label + "</span></button>"); b.onclick = function () { close(); setTimeout(fn, 60); }; body.appendChild(b); }
      opt("chat", "بازگشت به چت", function () { location.href = "/chat"; });
      opt("save", "ذخیره‌شده‌ها", function () { show("me"); setTimeout(function () { var b = $('.ig-tabs [data-t="saved"]'); if (b) b.click(); }, 500); });
      var cur = store("ig_theme") || "auto";
      opt("moon", "تم: " + (cur === "auto" ? "خودکار" : cur === "dark" ? "تاریک" : "روشن") + " (تغییر)", function () {
        store("ig_theme", cur === "auto" ? "dark" : cur === "dark" ? "light" : "auto"); applyTheme();
      });
    });
  }

  /* ---------- badges ---------- */
  function setBadge(tabName, n) {
    var b = $('[data-tab="' + tabName + '"]', nav), old = $(".ig-badge", b); if (old) old.remove();
    if (n > 0) b.appendChild(el('<span class="ig-badge">' + (n > 9 ? "۹+" : fa(n)) + "</span>"));
  }
  function refreshBadges() {
    api("/api/insta/inbox").then(function (d) { setBadge("inbox", unreadOf(d.chats)); }).catch(function () {});
    api("/api/insta/activity").then(function (d) {
      var seenAt = parseFloat(store("ig_act_seen") || "0"), n = d.requests.length + d.events.filter(function (e) { return e.at > seenAt; }).length;
      $$("[data-heart]").forEach(function (h) { var o = $(".ig-dot", h); if (o) o.remove(); if (n > 0) h.appendChild(el('<i class="ig-dot"></i>')); });
    }).catch(function () {});
  }

  /* ---------- tabs ---------- */
  var tab = "home";
  var ICONS = { home: "home", reels: "reels", inbox: "send", explore: "search" };
  function buildNav() {
    $$("button", nav).forEach(function (b) {
      var k = b.dataset.tab;
      b.innerHTML = k === "me" ? avatar(ME, 28) : ic(ICONS[k]);
      b.onclick = function () { if (stack.length) return; if (k === tab) { main.scrollTo ? main.scrollTo({ top: 0, behavior: "smooth" }) : 0; if (k === "home") renderHome(); return; } show(k); };
    });
  }
  function show(k) {
    while (stack.length) { var t = stack.pop(); t.node.remove(); if (t.onClose) { try { t.onClose(); } catch (e) { /* ignore */ } } }
    tab = k;
    $$("button", nav).forEach(function (b) { b.classList.toggle("on", b.dataset.tab === k); });
    nav.classList.toggle("dark", k === "reels");
    if (vidObs) vidObs.disconnect();
    ({ home: renderHome, reels: renderReels, inbox: renderInbox, explore: renderExplore, me: renderMe })[k]();
    $$("[data-heart]").length && refreshBadges();
    main.scrollTop = 0;
  }

  /* ---------- boot ---------- */
  buildNav();
  show("home");
  refreshBadges();
  setInterval(function () { if (!document.hidden) refreshBadges(); }, 30000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { refreshBadges(); if (tab === "home" && !stack.length) loadStories(); } });
  if (PARAMS.post) openPostById(PARAMS.post);
  else if (PARAMS.u) openProfile(PARAMS.u);
  else if (PARAMS.dm) openDM(PARAMS.dm);
})();
