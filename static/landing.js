(function () {
  "use strict";
  if (!window.Solid3D) return;                       // 3D helper failed to load: the two plain links still work
  var doors = document.getElementById("doors");
  if (!doors) return;
  try { Solid3D.buildAll(document); } catch (e) { /* ignore: links stay usable */ }
  try { Solid3D.tilt(document.querySelectorAll(".lp .s3d"), { max: 26 }); } catch (e2) { /* ignore */ }

  var reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var busy = false;

  doors.addEventListener("click", function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest("a.lp-door") : null;
    if (!a || busy) return;
    var href = a.getAttribute("href");
    if (typeof href !== "string" || href.charAt(0) !== "/") return;      // only same-site paths
    // keep normal browser behaviour for new-tab clicks, reduced motion, etc.
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || reduce) return;
    ev.preventDefault();
    busy = true;
    doors.classList.add("has-choice");
    a.classList.add("is-chosen");
    setTimeout(function () { window.location.assign(href); }, 520);
  });

  // coming back with the browser's back button: reset the animation
  window.addEventListener("pageshow", function (ev) {
    if (!ev.persisted) return;
    busy = false;
    doors.classList.remove("has-choice");
    var chosen = doors.querySelector(".is-chosen");
    if (chosen) chosen.classList.remove("is-chosen");
  });
})();
