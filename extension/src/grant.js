/* Asks for tab capture on a click Chrome accepts, then gets the playing
   tab ready. Chrome counts only the first click on a page until it
   reloads, and the click that opened this window came before the
   permission existed — so the tab reloads once, and then Listen works. */
(function () {
  'use strict';
  var CAPTURE = { permissions: ['tabCapture'] };
  var $ = function (id) { return document.getElementById(id); };
  var tabId = +new URLSearchParams(location.search).get('tab');

  $('allow').addEventListener('click', function onAllow() {
    chrome.permissions.request(CAPTURE).then(function (granted) {
      if (!granted) {
        document.querySelector('h1').textContent = 'Not allowed';
        $('msg').textContent = 'You can allow it any time: choose Listen to this tab again.';
        $('allow').hidden = true;
        $('cancel').textContent = 'Close';
        return;
      }
      document.querySelector('h1').textContent = 'Allowed — one last step';
      $('msg').textContent = 'That tab reloads once so Chrome lets lint.one hear it. Then right-click it and choose Listen to this tab. From then on it opens straight away.';
      $('allow').textContent = 'Reload the tab';
      $('allow').removeEventListener('click', onAllow);
      $('allow').addEventListener('click', function () {
        (tabId > 0 ? chrome.tabs.reload(tabId).then(function () {
          return chrome.tabs.update(tabId, { active: true });
        }) : Promise.resolve()).catch(function () {}).then(function () { window.close(); });
      });
      $('cancel').textContent = 'Not now';
      $('allow').focus();
    }, function () { window.close(); });
  });
  $('cancel').addEventListener('click', function () { window.close(); });
  addEventListener('keydown', function (e) { if (e.key === 'Escape') window.close(); });
  $('allow').focus();
})();
