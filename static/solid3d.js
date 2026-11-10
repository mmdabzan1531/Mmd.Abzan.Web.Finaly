/* Solid3D: builds extruded 3D icons (Insta camera, chat bubble) and tilts them toward the pointer. */
(function (root) {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var uid = 0;

  /* ---- colour helpers (every input is checked, bad values fall back to a safe colour) ---- */
  function rgb(h) {
    if (typeof h !== "string" || !/^#[0-9a-f]{6}$/i.test(h)) return [128, 128, 128];
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  function mix(a, b, t) {
    var x = rgb(a), y = rgb(b);
    if (typeof t !== "number" || isNaN(t)) t = 0;
    t = Math.max(0, Math.min(1, t));
    return "rgb(" + [0, 1, 2].map(function (i) { return Math.round(x[i] + (y[i] - x[i]) * t); }).join(",") + ")";
  }

  /* ---- the shapes ---- */
  var SHAPES = {
    insta: {
      body: "M30 6h40a24 24 0 0 1 24 24v40a24 24 0 0 1-24 24H30A24 24 0 0 1 6 70V30A24 24 0 0 1 30 6z",
      stops: [["0", "#ffd24a"], ["0.35", "#ff7a45"], ["0.68", "#ff3d7f"], ["1", "#8f3dff"]],
      back: "#2a0b33", near: "#c62f74",
      details: [
        { z: 1.2, n: 3, make: function (c) { return rect(22, 22, 56, 56, 18, c); } },
        { z: 3.4, n: 3, make: function (c) { return circle(50, 50, 13.5, c); } },
        { z: 3.4, n: 2, make: function (c) { return dot(69, 31, 3.8, c); } }
      ]
    },
    chat: {
      body: "M26 8h48a20 20 0 0 1 20 20v28a20 20 0 0 1-20 20H48L26 94V76A20 20 0 0 1 6 56V28A20 20 0 0 1 26 8z",
      stops: [["0", "#3df2d0"], ["0.5", "#2aa8ff"], ["1", "#5a4dff"]],
      back: "#07203f", near: "#1b86d0",
      details: [
        { z: 3, n: 3, make: function (c) { return dot(31, 42, 5.6, c); } },
        { z: 3, n: 3, make: function (c) { return dot(50, 42, 5.6, c); } },
        { z: 3, n: 3, make: function (c) { return dot(69, 42, 5.6, c); } }
      ]
    }
  };

  function mk(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) { if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]); }
    return n;
  }
  function rect(x, y, w, h, r, c) { return mk("rect", { x: x, y: y, width: w, height: h, rx: r, fill: "none", stroke: c, "stroke-width": 5.5 }); }
  function circle(x, y, r, c) { return mk("circle", { cx: x, cy: y, r: r, fill: "none", stroke: c, "stroke-width": 5.5 }); }
  function dot(x, y, r, c) { return mk("circle", { cx: x, cy: y, r: r, fill: c }); }

  function layer(z) {
    var s = mk("svg", { viewBox: "0 0 100 100", "class": "s3d-l", "aria-hidden": "true", focusable: "false" });
    s.style.transform = "translateZ(calc(var(--u) * " + z + "))";
    return s;
  }

  function build(host) {
    if (!host || host.nodeType !== 1) return false;
    var shape = SHAPES[host.getAttribute("data-shape")];
    if (!shape) return false;                                   // unknown shape: leave the host empty
    if (typeof document.createElementNS !== "function") return false;
    host.textContent = "";
    var tilt = document.createElement("span"); tilt.className = "s3d-tilt";
    var float_ = document.createElement("span"); float_.className = "s3d-float";
    tilt.appendChild(float_); host.appendChild(tilt);

    var N = 30, STEP = 1.55, i, z0 = -((N - 1) * STEP) / 2;
    for (i = 0; i < N - 1; i++) {                               // the solid body: dark at the back, lighter near the front
      var l = layer(z0 + i * STEP);
      l.appendChild(mk("path", { d: shape.body, fill: mix(shape.back, shape.near, i / (N - 2)) }));
      float_.appendChild(l);
    }
    var zf = z0 + (N - 1) * STEP;                               // front face with its gradient
    var id = "s3d-g" + (++uid);
    var front = layer(zf);
    var defs = mk("defs", {});
    var g = mk("linearGradient", { id: id, x1: "0", y1: "1", x2: "1", y2: "0" });
    shape.stops.forEach(function (st) { g.appendChild(mk("stop", { offset: st[0], "stop-color": st[1] })); });
    var gl = mk("linearGradient", { id: id + "h", x1: "0", y1: "0", x2: "0", y2: "1" });
    gl.appendChild(mk("stop", { offset: "0", "stop-color": "#fff", "stop-opacity": ".38" }));
    gl.appendChild(mk("stop", { offset: ".55", "stop-color": "#fff", "stop-opacity": "0" }));
    defs.appendChild(g); defs.appendChild(gl); front.appendChild(defs);
    front.appendChild(mk("path", { d: shape.body, fill: "url(#" + id + ")" }));
    front.appendChild(mk("path", { d: shape.body, fill: "url(#" + id + "h)" }));
    float_.appendChild(front);

    shape.details.forEach(function (d) {                        // white glyph parts, each one extruded a little
      for (var k = 0; k < d.n; k++) {
        var last = k === d.n - 1;
        var dl = layer(zf + d.z + k * 0.7);
        dl.appendChild(d.make(last ? "#ffffff" : mix("#7a2a5a", "#ffe9f3", k / Math.max(1, d.n - 1))));
        float_.appendChild(dl);
      }
    });
    return true;
  }

  function buildAll(scope) {
    var list = (scope && scope.querySelectorAll ? scope : document).querySelectorAll(".s3d[data-shape]");
    for (var i = 0; i < list.length; i++) {
      try { build(list[i]); } catch (e) { /* one broken icon must never break the page */ }
    }
  }

  /* ---- tilt toward the pointer (mouse, pen and finger drag) ---- */
  function tilt(els, opts) {
    var items = [];
    if (!els || typeof els.length !== "number") return function () {};
    for (var i = 0; i < els.length; i++) { if (els[i] && els[i].nodeType === 1) items.push({ el: els[i], rx: 0, ry: 0 }); }
    if (!items.length) return function () {};
    var reduce = !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
    var max = (opts && typeof opts.max === "number" && opts.max > 0) ? opts.max : 24;
    if (reduce) max = Math.min(max, 10);
    var ease = reduce ? 1 : 0.13, px = null, py = null, raf = 0;

    function frame() {
      raf = 0;
      var moving = false;
      items.forEach(function (it) {
        var tx = 0, ty = 0;
        if (px !== null && py !== null) {
          var r = it.el.getBoundingClientRect();
          if (r.width > 0) {
            var span = Math.max(r.width, 180) * 1.7;
            var dx = Math.max(-1, Math.min(1, (px - (r.left + r.width / 2)) / span));
            var dy = Math.max(-1, Math.min(1, (py - (r.top + r.height / 2)) / span));
            tx = -dy * max * 0.8; ty = dx * max;
          }
        }
        it.rx += (tx - it.rx) * ease; it.ry += (ty - it.ry) * ease;
        if (Math.abs(tx - it.rx) > 0.04 || Math.abs(ty - it.ry) > 0.04) moving = true;
        it.el.style.setProperty("--rx", it.rx.toFixed(2) + "deg");
        it.el.style.setProperty("--ry", it.ry.toFixed(2) + "deg");
      });
      if (moving) raf = root.requestAnimationFrame(frame);
    }
    function kick() { if (!raf) raf = root.requestAnimationFrame(frame); }
    function onMove(e) { if (!e || typeof e.clientX !== "number" || typeof e.clientY !== "number") return; px = e.clientX; py = e.clientY; kick(); }
    function onLeave() { px = null; py = null; kick(); }
    root.addEventListener("pointermove", onMove, { passive: true });
    root.addEventListener("pointerdown", onMove, { passive: true });
    root.addEventListener("pointerup", function (e) { if (e && e.pointerType === "touch") onLeave(); }, { passive: true });
    root.addEventListener("pointercancel", onLeave, { passive: true });
    root.addEventListener("blur", onLeave);
    document.addEventListener("mouseleave", onLeave);
    return onLeave;
  }

  root.Solid3D = { build: build, buildAll: buildAll, tilt: tilt };
})(window);
