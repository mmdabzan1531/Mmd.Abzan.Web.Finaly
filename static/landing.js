(function () {
  "use strict";
  var doors = document.getElementById("doors");
  if (!doors) return;                                  // broken page: the two plain links still work
  var reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var tiles = doors.querySelectorAll("a.lp-tile");
  var busy = false;

  /* tiles lean toward the finger / mouse */
  function tilt(x, y) {
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      if (typeof x !== "number" || typeof y !== "number") { t.style.setProperty("--rx", "0deg"); t.style.setProperty("--ry", "0deg"); continue; }
      var r = t.getBoundingClientRect();
      if (!r || r.width <= 0) continue;
      var dx = Math.max(-1, Math.min(1, (x - (r.left + r.width / 2)) / (r.width * 1.6)));
      var dy = Math.max(-1, Math.min(1, (y - (r.top + r.height / 2)) / (r.height * 1.6)));
      t.style.setProperty("--ry", (dx * 14).toFixed(1) + "deg");
      t.style.setProperty("--rx", (-dy * 12).toFixed(1) + "deg");
    }
  }
  if (!reduce) {
    window.addEventListener("pointermove", function (e) { if (e && typeof e.clientX === "number") tilt(e.clientX, e.clientY); }, { passive: true });
    window.addEventListener("pointerleave", function () { tilt(null, null); }, { passive: true });
    window.addEventListener("pointerup", function (e) { if (e && e.pointerType === "touch") tilt(null, null); }, { passive: true });
  }

  /* click: the other tile fades, then we go to that section's own sign-in page */
  doors.addEventListener("click", function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest("a.lp-tile") : null;
    if (!a || busy) return;
    var href = a.getAttribute("href");
    if (typeof href !== "string" || href.charAt(0) !== "/" || href.charAt(1) === "/") return;     // only same-site paths
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || reduce) return;
    ev.preventDefault();
    busy = true;
    doors.classList.add("has-choice");
    a.classList.add("is-chosen");
    setTimeout(function () { window.location.assign(href); }, 320);
  });

  window.addEventListener("pageshow", function (ev) {     // back button: reset
    if (!ev.persisted) return;
    busy = false;
    doors.classList.remove("has-choice");
    var c = doors.querySelector(".is-chosen"); if (c) c.classList.remove("is-chosen");
  });
})();
