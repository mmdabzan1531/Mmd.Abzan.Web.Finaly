/* Gate: sign in / sign up for Chatroom or Insta.
   Every value is checked with plain `if`s (type, length, format); network and JSON failures never throw. */
(function () {
  "use strict";

  var CFG = (window.GATE && typeof window.GATE === "object") ? window.GATE : {};
  var SECTION = CFG.section === "insta" ? "insta" : "chat";
  var IS_INSTA = SECTION === "insta";
  var URLS = IS_INSTA
    ? { login: "/api/insta/auth/login", register: "/api/insta/auth/register", home: "/insta" }
    : { login: "/api/chat/login", start: "/api/signup/start", resend: "/api/signup/resend", verify: "/api/signup/verify", home: "/chat" };
  var LIMITS = IS_INSTA
    ? { name: 60, userMax: 30, userRe: /^[A-Za-z0-9_.]{3,30}$/, userMsg: "نام کاربری باید ۳ تا ۳۰ حرف انگلیسی، عدد، _ یا نقطه باشد." }
    : { name: 32, userMax: 20, userRe: /^[A-Za-z0-9_]{3,20}$/, userMsg: "نام کاربری باید ۳ تا ۲۰ حرف انگلیسی، عدد یا _ باشد." };
  var PASS_MIN = 8, PASS_MAX = 128;

  var captchaQ = typeof CFG.captcha === "string" ? CFG.captcha : "";
  var resendTimer = 0;
  var submitting = false;

  function $(id) { return document.getElementById(id); }
  var el = {
    title: $("gt-title"), sub: $("gt-sub"), note: $("gt-note"),
    tabs: document.querySelector(".gt-tabs"),
    tabLogin: $("tab-login"), tabSignup: $("tab-signup"),
    panelLogin: $("panel-login"), panelSignup: $("panel-signup"),
    formLogin: $("form-login"), formSignup: $("form-signup"), formCode: $("form-code")
  };
  if (!el.formLogin || !el.formSignup || !el.tabLogin || !el.tabSignup) return;   // broken page: do nothing instead of throwing

  /* ---------- small helpers ---------- */
  var FA = "۰۱۲۳۴۵۶۷۸۹", AR = "٠١٢٣٤٥٦٧٨٩";
  function enDigits(s) {
    if (typeof s !== "string") return "";
    return s.replace(/[۰-۹٠-٩]/g, function (c) { var i = FA.indexOf(c); return String(i >= 0 ? i : AR.indexOf(c)); });
  }
  function val(id, keepSpaces) {
    var n = $(id);
    if (!n || typeof n.value !== "string") return "";
    return keepSpaces ? n.value : n.value.trim();
  }

  function showNote(type, msg) {
    if (!el.note) return;
    if (typeof msg !== "string" || !msg) { el.note.hidden = true; el.note.textContent = ""; return; }
    el.note.dataset.t = type === "ok" || type === "info" ? type : "error";
    el.note.textContent = msg;
    el.note.hidden = false;
  }
  function setErr(inputId, msg) {
    var inp = $(inputId), box = $(inputId + "-e");
    if (!inp) return;
    var wrap = inp.closest ? inp.closest(".fld") : null;
    var bad = typeof msg === "string" && msg.length > 0;
    inp.setAttribute("aria-invalid", bad ? "true" : "false");
    if (wrap) wrap.classList.toggle("bad", bad);
    if (box) box.textContent = bad ? msg : "";
  }
  function clearErrs(form) {
    if (!form) return;
    var inputs = form.querySelectorAll("input");
    for (var i = 0; i < inputs.length; i++) { if (inputs[i].id) setErr(inputs[i].id, ""); }
  }
  // errors = [[inputId, message], ...] -> shows all, focuses the first
  function applyErrors(errors) {
    if (!errors.length) return false;
    errors.forEach(function (e) { setErr(e[0], e[1]); });
    var first = $(errors[0][0]);
    if (first && first.focus) { try { first.focus({ preventScroll: false }); } catch (x) { first.focus(); } }
    return true;
  }
  function setBusy(btn, on, busyText) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = busyText; btn.setAttribute("aria-busy", "true"); btn.disabled = true; }
    else { if (btn.dataset.label) btn.textContent = btn.dataset.label; btn.removeAttribute("aria-busy"); btn.disabled = false; }
  }
  function safeTarget(t, fallback) {          // only same-site paths (blocks // and absolute URLs)
    return (typeof t === "string" && t.charAt(0) === "/" && t.charAt(1) !== "/" && t.charAt(1) !== "\\") ? t : fallback;
  }

  /* ---------- network: never rejects, always returns {ok, status, data} ---------- */
  function statusText(code) {
    if (code === 401 || code === 403) return "اجازه‌ی دسترسی نداری.";
    if (code === 404) return "آدرس پیدا نشد.";
    if (code === 408) return "زمان درخواست تمام شد؛ دوباره تلاش کن.";
    if (code === 413) return "حجم اطلاعات زیاد است.";
    if (code === 429) return "تعداد درخواست‌ها زیاد است؛ چند دقیقه بعد دوباره تلاش کن.";
    if (code >= 500) return "مشکلی در سرور پیش آمد؛ کمی بعد دوباره تلاش کن.";
    return "درخواست انجام نشد؛ دوباره تلاش کن.";
  }
  function postJSON(url, body) {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 20000);
    var opts = { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) };
    if (ctrl) opts.signal = ctrl.signal;
    return fetch(url, opts).then(function (r) {
      clearTimeout(timer);
      return r.text().then(function (txt) {
        var data = null;
        if (txt) { try { data = JSON.parse(txt); } catch (e) { data = null; } }       // not JSON (e.g. proxy error page)
        if (data === null || typeof data !== "object" || Array.isArray(data)) data = {};
        var ok = r.ok && typeof data.error !== "string";
        if (!ok && typeof data.error !== "string") data.error = statusText(r.status);
        return { ok: ok, status: r.status, data: data };
      });
    }).catch(function (e) {
      clearTimeout(timer);
      var timeout = e && e.name === "AbortError";
      return { ok: false, status: 0, data: { error: timeout ? "پاسخی از سرور نیامد؛ دوباره تلاش کن." : "اتصال به سرور برقرار نشد؛ اینترنتت را بررسی کن." } };
    });
  }

  /* ---------- validators (return "" when fine, otherwise the message) ---------- */
  function checkContact(raw) {
    var v = enDigits(typeof raw === "string" ? raw : "").trim();
    if (!v) return "ایمیل یا شماره موبایل را وارد کن.";
    if (v.indexOf("@") !== -1) {
      if (v.length > 120 || !/^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/.test(v)) return "ایمیل معتبر نیست.";
      return "";
    }
    var p = v.replace(/[\s\-().]/g, "");
    if (/^(\+98|0098|98)\d{10}$/.test(p) || /^0?9\d{9}$/.test(p)) return "";          // Iranian mobile
    if (/^\+[1-9]\d{7,14}$/.test(p) || /^00[1-9]\d{6,13}$/.test(p)) return "";        // international
    return "شماره موبایل معتبر نیست. شماره ایرانی را با ۰۹… و شماره خارجی را با + و کد کشور وارد کن.";
  }
  function checkUsername(v) {
    if (!v) return "نام کاربری را وارد کن.";
    if (!LIMITS.userRe.test(v)) return LIMITS.userMsg;
    if (IS_INSTA && (v.charAt(0) === "." || v.charAt(v.length - 1) === "." || v.indexOf("..") !== -1)) return "نام کاربری نباید با نقطه شروع یا تمام شود و دو نقطه‌ی پشت‌سرهم نداشته باشد.";
    return "";
  }
  function checkPassword(v) {
    if (!v) return "رمز عبور را وارد کن.";
    if (v.length < PASS_MIN) return "رمز عبور باید حداقل ۸ کاراکتر باشد.";
    if (v.length > PASS_MAX) return "رمز عبور نباید بیشتر از ۱۲۸ کاراکتر باشد.";
    return "";
  }
  function checkCaptcha(v) {
    var d = enDigits(v).trim();
    if (!d) return "حاصل جمع را وارد کن.";
    if (!/^\d{1,3}$/.test(d)) return "فقط عدد وارد کن.";
    return "";
  }

  /* ---------- captcha (chat only) ---------- */
  function setCaptcha(q) {
    if (typeof q !== "string" || !q) return;
    captchaQ = q;
    var labels = document.querySelectorAll(".cap-q");
    for (var i = 0; i < labels.length; i++) labels[i].textContent = q;
    ["lg-cap", "su-cap"].forEach(function (id) { var n = $(id); if (n) n.value = ""; });
  }
  function showLoginCaptcha() { var w = $("lg-cap-wrap"); if (w) w.hidden = false; }

  /* ---------- tabs ---------- */
  function go(which, fromKeyboard) {
    var login = which !== "signup";
    el.tabLogin.setAttribute("aria-selected", String(login));
    el.tabSignup.setAttribute("aria-selected", String(!login));
    el.tabLogin.tabIndex = login ? 0 : -1;
    el.tabSignup.tabIndex = login ? -1 : 0;
    if (el.tabs) el.tabs.dataset.on = login ? "login" : "signup";
    el.panelLogin.hidden = !login;
    el.panelSignup.hidden = login;
    var name = IS_INSTA ? "اینستا" : "چت‌روم";
    if (el.title) el.title.textContent = (login ? "ورود به " : "ساخت حساب در ") + name;
    if (el.sub) el.sub.textContent = login ? "با حساب " + name + " خودت وارد شو." : "هر بخش حساب جداگانه‌ی خودش را دارد؛ این حساب فقط برای " + name + " است.";
    showNote("", "");
    clearErrs(el.formLogin); clearErrs(el.formSignup); clearErrs(el.formCode);
    if (fromKeyboard) (login ? el.tabLogin : el.tabSignup).focus();
  }
  el.tabLogin.addEventListener("click", function () { go("login"); });
  el.tabSignup.addEventListener("click", function () { go("signup"); });
  [el.tabLogin, el.tabSignup].forEach(function (t) {
    t.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); go(t === el.tabLogin ? "signup" : "login", true); }
    });
  });
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-go]") : null;
    if (b) go(b.getAttribute("data-go"));
    var eye = e.target && e.target.closest ? e.target.closest(".eye") : null;       // show / hide password
    if (eye) {
      var inp = $(eye.getAttribute("data-eye"));
      if (!inp) return;
      var show = inp.type === "password";
      inp.type = show ? "text" : "password";
      eye.textContent = show ? "پنهان" : "نمایش";
      eye.setAttribute("aria-pressed", String(show));
    }
  });

  /* ---------- typing in a field clears that field's old error ---------- */
  document.addEventListener("input", function (e) {
    var t = e && e.target;
    if (!t || t.tagName !== "INPUT" || !t.id) return;
    if (t.getAttribute("aria-invalid") === "true") setErr(t.id, "");
    if (t.id === "su-pw" || t.id === "su-pw2") { var o = $(t.id === "su-pw" ? "su-pw2" : "su-pw"); if (o && o.getAttribute("aria-invalid") === "true" && val("su-pw", true) === val("su-pw2", true)) setErr(o.id, ""); }
  });

  /* ---------- wipe: remove everything the person typed ---------- */
  function wipeAll() {
    [el.formLogin, el.formSignup, el.formCode].forEach(function (f) {
      if (!f) return;
      try { f.reset(); } catch (e) { /* ignore */ }
      var inputs = f.querySelectorAll("input");
      for (var i = 0; i < inputs.length; i++) {
        inputs[i].value = "";
        if (inputs[i].dataset && inputs[i].dataset.pw !== undefined) inputs[i].type = "password";
      }
    });
    var eyes = document.querySelectorAll(".eye");
    for (var k = 0; k < eyes.length; k++) {
      var t = $(eyes[k].getAttribute("data-eye"));
      if (t) t.type = "password";
      eyes[k].textContent = "نمایش"; eyes[k].setAttribute("aria-pressed", "false");
    }
    clearErrs(el.formLogin); clearErrs(el.formSignup); clearErrs(el.formCode);
    var dev = $("dev-code"); if (dev) { dev.hidden = true; dev.textContent = ""; }
    if (el.formCode) el.formCode.hidden = true;
    el.formSignup.hidden = false;
    var sw = $("signup-switch"); if (sw) sw.hidden = false;
    stopResend();
  }

  /* ---------- LOGIN ---------- */
  el.formLogin.addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (submitting) return;
    showNote("", ""); clearErrs(el.formLogin);
    var id = val("lg-id"), pw = val("lg-pw", true), errs = [];
    if (!id) errs.push(["lg-id", "نام کاربری، ایمیل یا شماره را وارد کن."]);
    else if (id.length > 120) errs.push(["lg-id", "این مقدار خیلی طولانی است."]);
    if (!pw) errs.push(["lg-pw", "رمز عبور را وارد کن."]);
    else if (pw.length > 256) errs.push(["lg-pw", "رمز عبور خیلی طولانی است."]);
    var capWrap = $("lg-cap-wrap"), capOn = !IS_INSTA && capWrap && !capWrap.hidden;
    if (capOn) { var ce = checkCaptcha(val("lg-cap")); if (ce) errs.push(["lg-cap", ce]); }
    if (applyErrors(errs)) return;

    var btn = $("lg-submit");
    var body = IS_INSTA ? { login: id, password: pw } : { identifier: id, password: pw };
    if (capOn) body.captcha = enDigits(val("lg-cap"));
    submitting = true; setBusy(btn, true, "در حال ورود…");
    postJSON(URLS.login, body).then(function (res) {
      submitting = false;
      if (res.ok) {
        showNote("ok", "وارد شدی؛ در حال انتقال…");
        setBusy(btn, true, "در حال انتقال…");
        window.location.replace(safeTarget(res.data.redirect, URLS.home));
        return;
      }
      setBusy(btn, false);
      if (res.data.captcha_required === true) { showLoginCaptcha(); }
      if (typeof res.data.captcha === "string") { setCaptcha(res.data.captcha); }
      var pwEl = $("lg-pw"); if (pwEl) pwEl.value = "";           // a failed attempt never keeps the password on screen
      showNote("error", res.data.error);
    });
  });

  /* ---------- SIGN UP ---------- */
  function collectSignup() {
    var errs = [];
    var name = val("su-name"), user = val("su-user"), contact = val("su-contact"), pw = val("su-pw", true), pw2 = val("su-pw2", true);
    if (!name) errs.push(["su-name", "نام نمایشی را وارد کن."]);
    else if (name.length > LIMITS.name) errs.push(["su-name", "نام نمایشی نباید بیشتر از " + LIMITS.name + " کاراکتر باشد."]);
    var ue = checkUsername(user); if (ue) errs.push(["su-user", ue]);
    var ce = checkContact(contact); if (ce) errs.push(["su-contact", ce]);
    var pe = checkPassword(pw); if (pe) errs.push(["su-pw", pe]);
    if (!pe && IS_INSTA && pw.toLowerCase() === user.toLowerCase()) errs.push(["su-pw", "رمز عبور نباید با نام کاربری یکی باشد."]);
    if (!pw2) errs.push(["su-pw2", "رمز عبور را دوباره وارد کن."]);
    else if (!pe && pw !== pw2) errs.push(["su-pw2", "دو رمز عبور یکی نیستند."]);
    var body = { display_name: name, username: user, contact: enDigits(contact).trim(), password: pw };
    if (!IS_INSTA) {
      var ke = checkCaptcha(val("su-cap")); if (ke) errs.push(["su-cap", ke]);
      body.captcha = enDigits(val("su-cap"));
    }
    return { errs: errs, body: body };
  }

  function registered(msg) {                    // account exists -> wipe the page and show the login form
    wipeAll();
    go("login");
    showNote("ok", msg);
  }

  el.formSignup.addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (submitting) return;
    showNote("", ""); clearErrs(el.formSignup);
    var c = collectSignup();
    if (applyErrors(c.errs)) return;
    var btn = $("su-submit");
    submitting = true; setBusy(btn, true, IS_INSTA ? "در حال ساخت حساب…" : "در حال ارسال کد…");
    postJSON(IS_INSTA ? URLS.register : URLS.start, c.body).then(function (res) {
      submitting = false; setBusy(btn, false);
      if (!res.ok) {
        if (typeof res.data.captcha === "string") setCaptcha(res.data.captcha);
        showNote("error", res.data.error);
        return;
      }
      if (IS_INSTA) { registered(typeof res.data.message === "string" ? res.data.message : "حساب ساخته شد. حالا وارد شو."); return; }
      openCodeStep(res.data);
    });
  });

  /* ---------- chat: verification code step ---------- */
  function stopResend() { if (resendTimer) { clearInterval(resendTimer); resendTimer = 0; } var b = $("cd-resend"); if (b) { b.disabled = false; b.textContent = "ارسال دوباره کد"; } }
  function startResendCooldown(sec) {
    var b = $("cd-resend"); if (!b) return;
    stopResend();
    var left = sec;
    b.disabled = true; b.textContent = "ارسال دوباره (" + left + ")";
    resendTimer = setInterval(function () {
      left -= 1;
      if (left <= 0) { stopResend(); return; }
      b.textContent = "ارسال دوباره (" + left + ")";
    }, 1000);
  }
  function openCodeStep(data) {
    if (!el.formCode) return;
    el.formSignup.hidden = true;
    var sw = $("signup-switch"); if (sw) sw.hidden = true;
    el.formCode.hidden = false;
    var info = $("code-info");
    var to = Array.isArray(data.sent_to) ? data.sent_to.filter(function (x) { return typeof x === "string"; }).join("، ") : "";
    if (info) info.textContent = to ? "کد تأیید به " + to + " فرستاده شد." : "کد تأیید فرستاده شد.";
    showDev(data);
    startResendCooldown(30);
    if (el.title) el.title.textContent = "کد تأیید را وارد کن";
    var code = $("cd-code"); if (code) { code.value = ""; code.focus(); }
    syncCodeBtn();
  }
  function showDev(data) {
    var dev = $("dev-code");
    if (!dev) return;
    if (CFG.devCodes === true && typeof data.dev_code === "string" && /^\d{6}$/.test(data.dev_code)) {
      dev.textContent = "";
      dev.appendChild(document.createTextNode("حالت آزمایشی؛ کد: "));
      var b = document.createElement("b"); b.textContent = data.dev_code; dev.appendChild(b);
      dev.hidden = false;
    } else { dev.hidden = true; dev.textContent = ""; }
  }
  function syncCodeBtn() {
    var b = $("cd-submit"), v = enDigits(val("cd-code"));
    if (b && !submitting) b.disabled = !/^\d{6}$/.test(v);
  }
  if (el.formCode) {
    var codeInput = $("cd-code");
    if (codeInput) codeInput.addEventListener("input", function () {
      var clean = enDigits(codeInput.value).replace(/\D/g, "").slice(0, 6);
      if (clean !== codeInput.value) codeInput.value = clean;
      syncCodeBtn();
    });
    el.formCode.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (submitting) return;
      showNote("", ""); clearErrs(el.formCode);
      var code = enDigits(val("cd-code"));
      if (!code) { applyErrors([["cd-code", "کد را وارد کن."]]); return; }
      if (!/^\d{6}$/.test(code)) { applyErrors([["cd-code", "کد باید ۶ رقم باشد."]]); return; }
      var btn = $("cd-submit");
      submitting = true; setBusy(btn, true, "در حال تأیید…");
      postJSON(URLS.verify, { code: code }).then(function (res) {
        submitting = false; setBusy(btn, false);
        if (!res.ok) { showNote("error", res.data.error); syncCodeBtn(); return; }
        registered(typeof res.data.message === "string" ? res.data.message : "حساب ساخته شد. حالا وارد شو.");
      });
    });
    var resend = $("cd-resend");
    if (resend) resend.addEventListener("click", function () {
      if (submitting || resend.disabled) return;
      showNote("", "");
      resend.disabled = true;
      postJSON(URLS.resend, {}).then(function (res) {
        if (!res.ok) { resend.disabled = false; showNote("error", res.data.error); return; }
        showDev(res.data);
        showNote("info", "کد تازه فرستاده شد.");
        startResendCooldown(30);
      });
    });
    var back = $("cd-back");
    if (back) back.addEventListener("click", function () {
      el.formCode.hidden = true; el.formSignup.hidden = false;
      var sw = $("signup-switch"); if (sw) sw.hidden = false;
      stopResend(); showNote("", "");
      if (el.title) el.title.textContent = "ساخت حساب در چت‌روم";
    });
  }

  /* ---------- 3D header icon + housekeeping ---------- */
  if (window.Solid3D) {
    try { Solid3D.buildAll(document); } catch (e) { /* the page works without the icon */ }
    try { Solid3D.tilt(document.querySelectorAll(".gt .s3d"), { max: 28 }); } catch (e2) { /* ignore */ }
  }
  // coming back from the bfcache must not show an old password
  window.addEventListener("pageshow", function (ev) {
    if (ev.persisted) { ["lg-pw", "su-pw", "su-pw2"].forEach(function (id) { var n = $(id); if (n) n.value = ""; }); submitting = false; }
  });
  if (captchaQ) setCaptcha(captchaQ);
  var q = window.location.hash;
  if (q === "#signup") go("signup"); else go("login");
})();
