// A person's look, set before the first paint so the page never flashes the
// wrong one (design pass, decision 9, 2026-10-29). A file, not an inline
// script: the hub's CSP allows scripts from its own origin only.
//
// "civic_appearance" in this browser is light, dark or system: a signed-in
// person's own setting (mirrored here by config/appearance.ts from their
// account, light by default), or what a signed-out reader chose in the footer.
// A signed-out reader who chose nothing follows the device.
(function () {
  var root = document.documentElement;
  var pref = null;
  var signedIn = false;
  try {
    pref = localStorage.getItem("civic_appearance");
    signedIn = Boolean(localStorage.getItem("civic_auth_token"));
  } catch (e) {
    // Blocked storage: the device decides.
  }
  if (pref !== "light" && pref !== "dark" && pref !== "system") pref = signedIn ? "light" : "system";
  var query = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function apply() {
    var dark = pref === "dark" || (pref === "system" && Boolean(query && query.matches));
    root.setAttribute("data-mode", dark ? "dark" : "light");
  }
  apply();
  if (query && query.addEventListener) query.addEventListener("change", apply);
})();
