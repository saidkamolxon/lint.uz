/* The popup and the DevTools panel wear the theme picked on lint.one:
   bridge.js copies it into extension storage whenever a lint.one page is
   open. It is applied before first paint from a local copy, then checked
   against storage, the same order shared/theme-boot.js follows with its
   cookie. The DevTools panel follows DevTools' own light or dark instead,
   since it sits inside DevTools; contrast still follows lint.one. */
(function () {
  'use strict';
  var root = document.documentElement;
  var CACHE = 'lintone-theme';
  /* theme-boot.js's retired names, mapped the same way */
  var RETIRED = { paper: 'daylight', midnight: 'slate', contrast: 'daylight' };

  var devtools = null;
  try {
    if (chrome.devtools && chrome.devtools.panels) {
      devtools = chrome.devtools.panels.themeName === 'dark' ? 'slate' : 'daylight';
    }
  } catch (e) {}

  function apply(v) {
    v = v || {};
    var theme = devtools || (RETIRED.hasOwnProperty(v.theme) ? RETIRED[v.theme] : v.theme);
    if (theme === 'daylight' || theme === 'slate') root.setAttribute('data-theme', theme);
    else root.removeAttribute('data-theme');

    var more;
    if (v.contrast === '1' || v.contrast === '0') more = v.contrast === '1';
    else if (v.theme === 'contrast') more = true;
    else { try { more = matchMedia('(prefers-contrast: more)').matches; } catch (e) { more = false; } }
    if (more) root.setAttribute('data-contrast', 'more');
    else root.removeAttribute('data-contrast');
  }

  var cached = null;
  try { cached = JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch (e) {}
  apply(cached);

  function load() {
    chrome.storage.local.get(['theme', 'contrast']).then(function (v) {
      apply(v);
      try { localStorage.setItem(CACHE, JSON.stringify({ theme: v.theme || '', contrast: v.contrast || '' })); } catch (e) {}
    }, function () {});
  }
  load();
  chrome.storage.onChanged.addListener(function (c, area) {
    if (area === 'local' && (c.theme || c.contrast)) load();
  });
})();
