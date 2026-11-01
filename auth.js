/* auth pages: login / signup / forgot password */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const fa = n => Number(n).toLocaleString("fa-IR");

  // show / hide password
  document.querySelectorAll("[data-eye]").forEach(b => {
    const inp = $(b.dataset.eye);
    const sync = () => { b.hidden = !inp.value; };
    inp.addEventListener("input", sync); sync();
    b.addEventListener("click", () => {
      const show = inp.type === "password"; inp.type = show ? "text" : "password"; b.textContent = show ? "پنهان" : "نمایش";
    });
  });

  // the main button stays dim until the form is valid (like Instagram)
  document.querySelectorAll("form[data-gate]").forEach(f => {
    const btn = f.querySelector("button[type=submit]");
    const gate = () => { btn.disabled = !f.checkValidity(); };
    f.addEventListener("input", gate); gate();
    window.addEventListener("pageshow", () => setTimeout(gate, 60));   // browser autofill
    setTimeout(gate, 400);
  });
  const codeInput = $("su-code");
  if (codeInput) codeInput.addEventListener("input", () => { $("code-submit").disabled = !/^[0-9۰-۹]{6}$/.test(codeInput.value.trim()); });

  async function api(url, body) {
    let r, d = {};
    try {
      r = await fetch(url, {method: "POST", headers: {"Content-Type": "application/json"}, credentials: "same-origin", body: JSON.stringify(body || {})});
      d = await r.json().catch(() => ({}));
    } catch (_) { throw new Error("اتصال به سرور برقرار نشد. اینترنتت را بررسی کن."); }
    if (!r.ok) {
      if (d.captcha) { const q = $("su-cap-q") || $("fg-cap-q"), c = $("su-cap") || $("fg-cap"); if (q) q.textContent = d.captcha; if (c) c.value = ""; }
      throw new Error(d.error || "خطایی رخ داد؛ دوباره تلاش کن.");
    }
    return d;
  }
  const note = (id, m, ok) => { const e = $(id); if (!e) return; e.hidden = !m; e.textContent = m || ""; e.classList.toggle("ok", !!ok); };
  const busy = (btn, on, label) => { if (!btn) return; if (on) { btn.dataset.l = btn.textContent; btn.textContent = label || "کمی صبر کن…"; btn.disabled = true; } else { btn.textContent = btn.dataset.l || btn.textContent; btn.disabled = false; } };

  let timer = 0;
  function cooldown(btn, secs) {
    clearInterval(timer); let left = secs; btn.disabled = true;
    const tick = () => { if (left <= 0) { clearInterval(timer); btn.disabled = false; btn.textContent = "ارسال دوباره کد"; } else { btn.textContent = "ارسال دوباره کد (" + fa(left) + ")"; left--; } };
    tick(); timer = setInterval(tick, 1000);
  }
  function dev(d) { const dv = $("devcode"); if (!dv) return; dv.hidden = !d.dev_code; if (d.dev_code) dv.textContent = "حالت آزمایشی: کد شما " + d.dev_code; }

  /* ---------- signup ---------- */
  const su = $("su-form");
  if (su) {
    su.addEventListener("submit", async e => {
      e.preventDefault(); note("msg", "");
      const btn = $("su-submit"); busy(btn, true);
      try {
        const d = await api("/api/signup/start", {contact: $("su-contact").value, display_name: $("su-name").value, username: $("su-user").value, password: $("su-pass").value, captcha: $("su-cap").value});
        $("step-form").hidden = true; $("step-code").hidden = false;
        $("code-ico").textContent = d.channel === "sms" ? "💬" : "✉";
        const to = (d.sent_to || []).join(" و ");
        $("code-info").innerHTML = (d.channel === "sms" ? "کد ۶ رقمی با پیامک به " : "کد ۶ رقمی به ایمیل ") + '<b dir="ltr">' + to.replace(/[<&]/g, "") + "</b> ارسال شد.";
        dev(d); cooldown($("resend"), 30); $("su-code").focus();
      } catch (x) { note("msg", x.message); }
      busy(btn, false); btn.disabled = !su.checkValidity();
    });
    $("code-form").addEventListener("submit", async e => {
      e.preventDefault(); note("msg2", ""); const btn = $("code-submit"); busy(btn, true, "در حال بررسی…");
      try { const d = await api("/api/signup/verify", {code: $("su-code").value}); location.href = d.redirect; }
      catch (x) { note("msg2", x.message); busy(btn, false); }
    });
    $("resend").addEventListener("click", async () => {
      note("msg2", "");
      try { const d = await api("/api/signup/resend"); dev(d); note("msg2", "کد جدید ارسال شد.", true); cooldown($("resend"), 30); }
      catch (x) { note("msg2", x.message); }
    });
    $("back").addEventListener("click", () => { clearInterval(timer); $("step-code").hidden = true; $("step-form").hidden = false; note("msg2", ""); });
  }

  /* ---------- forgot password ---------- */
  const fg = $("fg-form");
  if (fg) {
    fg.addEventListener("submit", async e => {
      e.preventDefault(); note("msg", ""); const btn = fg.querySelector("button[type=submit]"); busy(btn, true);
      try {
        const d = await api("/api/forgot/start", {identifier: $("fg-id").value, captcha: $("fg-cap").value});
        $("step-find").hidden = true; $("step-reset").hidden = false; dev(d); cooldown($("resend"), 30); $("rs-code").focus();
      } catch (x) { note("msg", x.message); }
      busy(btn, false); btn.disabled = !fg.checkValidity();
    });
    $("rs-form").addEventListener("submit", async e => {
      e.preventDefault(); note("msg2", ""); const btn = e.target.querySelector("button[type=submit]"); busy(btn, true, "در حال ذخیره…");
      try { const d = await api("/api/forgot/verify", {code: $("rs-code").value, password: $("rs-pass").value}); location.href = d.redirect; }
      catch (x) { note("msg2", x.message); busy(btn, false); }
    });
    $("resend").addEventListener("click", async () => {
      note("msg2", "");
      try { const d = await api("/api/forgot/resend"); dev(d); note("msg2", "اگر حسابی پیدا شود کد جدید ارسال می‌شود.", true); cooldown($("resend"), 30); }
      catch (x) { note("msg2", x.message); }
    });
    $("back").addEventListener("click", () => { clearInterval(timer); $("step-reset").hidden = true; $("step-find").hidden = false; note("msg2", ""); });
  }
})();
