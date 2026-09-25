/* Asks for tab capture on a click Chrome accepts, then gets the playing
   tab ready. Chrome keeps what the first click on a tab allowed while the
   tab stays on the same site, reloads included, and the click that opened
   this window came before the permission existed — so the tab is opened
   afresh in its place (duplicated, the old one closed), and then Listen
   works on it. */
(function () {
  'use strict';
  var CAPTURE = { permissions: ['tabCapture'] };
  var $ = function (id) { return document.getElementById(id); };
  var tabId = +new URLSearchParams(location.search).get('tab');

  $('allow').addEventListener('click', function onAllow() {
    chrome.permissions.request(CAPTURE).then(function (granted) {
      if (!granted) {
        $('note').hidden = true;
        document.querySelector('h1').textContent = 'Not allowed';
        $('msg').textContent = 'You can allow it any time: choose Listen to this tab again.';
        $('allow').hidden = true;
        $('cancel').textContent = 'Close';
        return;
      }
      $('note').hidden = true;
      document.querySelector('h1').textContent = 'Allowed — one last step';
      $('msg').textContent = 'Chrome needs a fresh copy of that tab before lint.one can hear it: it opens again in its place. Then right-click it and choose Listen to this tab. From then on it is one click.';
      $('allow').textContent = 'Open it afresh';
      $('allow').removeEventListener('click', onAllow);
      $('allow').addEventListener('click', function () {
        (tabId > 0 ? chrome.tabs.duplicate(tabId).then(function (copy) {
          return chrome.tabs.remove(tabId).then(function () {
            return chrome.tabs.update(copy.id, { active: true });
          });
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
