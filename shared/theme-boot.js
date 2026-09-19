/* Applies the saved theme before first paint, so no flash of the wrong
   colours while app.js is still loading. Kept tiny and duplicated-by-design
   from app.js — it must run before anything else. */
(function () {
  var t = '';
  var m = document.cookie.match(/(?:^|;\s*)lintuz_theme=([^;]*)/);
  if (m) t = decodeURIComponent(m[1]);
  else { try { t = localStorage.getItem('lintuz-theme') || ''; } catch (e) {} }
  if (t) document.documentElement.setAttribute('data-theme', t);
})();
