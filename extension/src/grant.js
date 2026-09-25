/* Asks for tab capture on a click Chrome accepts, then closes. The tab to
   listen to was saved by the worker (listenOrAsk); the grant itself starts
   the listening there (permissions.onAdded), so this page only asks. */
(function () {
  'use strict';
  var CAPTURE = { permissions: ['tabCapture'] };
  var $ = function (id) { return document.getElementById(id); };

  function forget() { return chrome.storage.session.remove('listenTab').catch(function () {}); }

  $('allow').addEventListener('click', function () {
    chrome.permissions.request(CAPTURE).then(function (granted) {
      if (granted) { window.close(); return; }
      forget();
      $('msg').textContent = 'Not allowed. You can try again from the lint.one button or the right-click menu whenever you like.';
      $('allow').hidden = true;
      $('cancel').textContent = 'Close';
    }, function () {
      forget().then(function () { window.close(); });
    });
  });
  $('cancel').addEventListener('click', function () { forget().then(function () { window.close(); }); });
  addEventListener('keydown', function (e) { if (e.key === 'Escape') $('cancel').click(); });
  $('allow').focus();
})();
