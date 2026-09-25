/* Watches for the page going fullscreen, in a tab lint.one is listening to.

   While a tab is captured, Chrome keeps a video's fullscreen inside the
   tab (so the capture still sees the page): the tab strip and address bar
   stay on screen. This tells the service worker when the page enters or
   leaves fullscreen, and the worker makes the window itself fullscreen,
   then puts it back — what the fullscreen button did before listening.

   Never loaded on its own: background.js imports this file only to hand
   lintoneFullscreen to chrome.scripting.executeScript, right after the
   click that started listening, which is what lets it run in that tab. */
function lintoneFullscreen() {
  'use strict';
  if (window.__lintoneFullscreen) return;
  window.__lintoneFullscreen = true;
  document.addEventListener('fullscreenchange', function () {
    try {
      chrome.runtime.sendMessage({ kind: 'fullscreen', on: !!document.fullscreenElement })
        .catch(function () {});
    } catch (e) { /* the extension was reloaded; nothing left to tell */ }
  });
}
