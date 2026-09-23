/* Applies the saved theme before first paint, so no flash of the wrong
   colours while app.js is still loading. Kept tiny and duplicated-by-design
   from app.js — it must run before anything else. */
(function () {
  var t = '';
  var m = document.cookie.match(/(?:^|;\s*)lintuz_theme=([^;]*)/);
  if (m) t = decodeURIComponent(m[1]);
  else { try { t = localStorage.getItem('lintuz-theme') || ''; } catch (e) {} }
  if (t) document.documentElement.setAttribute('data-theme', t);

  /* every page loads this file, so this is where the offline copy starts */
  if ('serviceWorker' in navigator) {
    addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }
})();
