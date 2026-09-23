/* The one place the theme is read and written. Loaded in <head> of every
   page so the saved theme applies before first paint; app.js and the
   landing page call LintTheme rather than keeping copies that drift. */
(function () {
  var NAME = 'lintuz_theme', LS = 'lintuz-theme';

  function read() {
    var m = document.cookie.match(/(?:^|;\s*)lintuz_theme=([^;]*)/);
    if (m) return decodeURIComponent(m[1]);
    try { return localStorage.getItem(LS) || ''; } catch (e) { return ''; }
  }

  function apply(id) {
    if (id) document.documentElement.setAttribute('data-theme', id);
    else document.documentElement.removeAttribute('data-theme');
  }

  function write(id) {
    var secure = location.protocol === 'https:' ? '; secure' : '';
    try {
      /* the landing page once wrote this cookie on .lint.one; a second
         cookie of the same name would shadow this one, so it is expired */
      if (/(^|\.)lint\.one$/.test(location.hostname)) {
        document.cookie = NAME + '=; path=/; max-age=0; domain=.lint.one';
      }
      document.cookie = NAME + '=' + encodeURIComponent(id) +
        '; path=/; max-age=31536000; samesite=lax' + secure;
    } catch (e) {}
    try { localStorage.setItem(LS, id); } catch (e) {}
  }

  apply(read());
  window.LintTheme = { read: read, write: write, apply: apply };

  /* every page loads this file, so this is where the offline copy starts */
  if ('serviceWorker' in navigator) {
    addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }
})();
