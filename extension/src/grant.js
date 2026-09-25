/* Asks for tab capture on a click Chrome accepts. Listening itself needs
   one more click on the tab (Chrome only counts a click made while the
   permission is held), so once allowed this says exactly that. */
(function () {
  'use strict';
  var CAPTURE = { permissions: ['tabCapture'] };
  var $ = function (id) { return document.getElementById(id); };

  function finish(title, text) {
    document.querySelector('h1').textContent = title;
    $('msg').textContent = text;
    $('allow').hidden = true;
    $('cancel').textContent = 'Close';
    $('cancel').focus();
  }

  $('allow').addEventListener('click', function () {
    chrome.permissions.request(CAPTURE).then(function (granted) {
      if (granted) {
        finish('Allowed', 'Now right-click the page that is playing and choose Listen to this tab. From now on it opens straight away.');
      } else {
        finish('Not allowed', 'You can allow it any time: choose Listen to this tab again.');
      }
    }, function () { window.close(); });
  });
  $('cancel').addEventListener('click', function () { window.close(); });
  addEventListener('keydown', function (e) { if (e.key === 'Escape') window.close(); });
  $('allow').focus();
})();
