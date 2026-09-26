/* Runs on lint.one itself. Two small jobs:

   1. When the service worker opened this tab to show a file, collect it
      and give it to the page. The page (shared/app.js, takeHandoff) says
      "ready" once it is listening; the file then goes over a port from the
      worker, is put back together here as a File, and is posted to the
      page with window.postMessage — a structured clone within this tab.
      It is never in a URL, and no server is involved.

      The Audio tool can be sent a tab's sound the same way: a stream id
      from tabCapture, which only this tab, on this origin, can open.

   2. Remember the theme picked on lint.one, so the popup wears the same
      one. */
(function () {
  'use strict';

  /* ---------- theme ---------- */
  function syncTheme() {
    var theme = null, contrast = null;
    try {
      theme = localStorage.getItem('lintuz-theme');
      contrast = localStorage.getItem('lintuz-contrast');
    } catch (e) {}
    chrome.storage.local.set({ theme: theme || '', contrast: contrast || '' }).catch(function () {});
  }
  syncTheme();
  /* the theme menu writes localStorage, which fires no event in the tab
     that wrote it; a click anywhere is a cheap moment to look again */
  addEventListener('click', function () { setTimeout(syncTheme, 0); }, true);

  /* ---------- file handoff ---------- */
  var tool = location.pathname.split('/')[1];
  var TOOLS = ['json', 'xml', 'yaml', 'csv', 'pdf', 'log', 'audio', 'sqlite', 'parquet'];
  if (TOOLS.indexOf(tool) < 0) return;

  var started = false;

  function decode(b64) {
    if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(b64);
    var s = atob(b64), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function toPage(msg) { window.postMessage(msg, location.origin); }

  function collect() {
    if (started) return;
    started = true;
    var port;
    try { port = chrome.runtime.connect({ name: 'bridge' }); } catch (e) { return; }
    var meta = null, parts = [];

    port.onMessage.addListener(function (msg) {
      if (!msg) return;
      if (msg.t === 'none') {
        port.disconnect();
      } else if (msg.t === 'meta') {
        meta = msg;
      } else if (msg.t === 'part' && meta) {
        parts.push(meta.encoding === 'text' ? msg.data : decode(msg.data));
      } else if (msg.t === 'end' && meta) {
        var file = new File(parts, meta.name, { type: meta.type || '' });
        parts = [];
        toPage({ lintone: 'file', file: file });
        port.disconnect();
      } else if (msg.t === 'capture' && typeof msg.streamId === 'string') {
        /* not a file: a tab's sound, for the Audio tool to open */
        toPage({ lintone: 'capture', streamId: msg.streamId, title: msg.title || '' });
        port.disconnect();
      } else if (msg.t === 'error') {
        toPage({ lintone: 'error', message: msg.message });
        port.disconnect();
      }
    });
  }

  addEventListener('message', function (e) {
    if (e.source !== window || e.origin !== location.origin) return;
    if (e.data && e.data.lintone === 'ready' && e.data.tool === tool) collect();
  });
  /* in case the page was already listening before this script arrived
     (the extension was installed or reloaded with the tab open) */
  toPage({ lintone: 'ping' });
})();
