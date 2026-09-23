/* The one place the theme is read and written. Loaded in <head> of every
   page so the saved theme applies before first paint; app.js and the
   landing page call LintTheme rather than keeping copies that drift. */
(function () {
  var NAME = 'lintuz_theme', LS = 'lintuz-theme';

  /* Paper, Midnight and Contrast were once menu choices. A saved one maps to
     the theme closest to it, so nobody comes back to an unstyled page;
     Contrast now follows the OS setting on its own. */
  var RETIRED = { paper: 'daylight', midnight: 'slate', contrast: 'daylight' };

  function read() {
    var id = '';
    var m = document.cookie.match(/(?:^|;\s*)lintuz_theme=([^;]*)/);
    if (m) id = decodeURIComponent(m[1]);
    else try { id = localStorage.getItem(LS) || ''; } catch (e) {}
    return RETIRED.hasOwnProperty(id) ? RETIRED[id] : id;
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
