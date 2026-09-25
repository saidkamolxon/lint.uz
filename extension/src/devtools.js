/* Adds a "lint.one" panel to DevTools: every response the inspected page
   loads that a tool can read, one click from being opened in it. */
chrome.devtools.panels.create('lint.one', 'icons/icon-32.png', 'panel.html');
