/* Reads a file in the page it comes from, and streams it to the service
   worker over a 'grab' port.

   Never loaded on its own: background.js imports this file only to hand
   lintoneGrab to chrome.scripting.executeScript, which runs it in the page
   the person right-clicked (or the one the popup was opened over). That is
   the point — a request made from the page carries the page's cookies, so
   a link behind a login opens exactly as clicking it would. The function
   is serialised to run there, so it uses nothing from outside itself.

   url     what to read
   opts    { note: only show this message at the foot of the page;
             usePage: the url is this page, so its text may be taken as
             shown rather than fetched again;
             replace: open the tool in this tab rather than beside it;
             fallbackName } */
function lintoneGrab(url, opts) {
  'use strict';
  opts = opts || {};
  var CHUNK = 3 * 1024 * 1024;
  var toastTimer = null, slowTimer = null;
  /* shared/glyph.svg, inline: an extension file would have to be exposed
     to every web page to be drawn in one */
  var GLYPH = 'url("data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="227 239 760 760"><path d="M632 412L632 708A65 65 0 0 0 697 773L731 773' +
    'A22 22 0 0 1 753 795L753 831A22 22 0 0 1 731 853L638 853A95 95 0 0 1 543 758L543 522Q543 503 525 510L486 526Q461 536 461 510' +
    'L461 478Q461 458 479 448L596 389Q632 371 632 412Z"/></svg>') + '")';

  /* A small note at the foot of the page, drawn after the toast every
     lint.one tool shows, in a shadow root so the page's styles cannot
     touch it and it cannot touch them. */
  function toast(message, life) {
    var host = document.getElementById('lintone-note');
    if (!host) {
      host = document.createElement('div');
      host.id = 'lintone-note';
      host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; left: 50%; bottom: 32px; transform: translateX(-50%);';
      var root = host.attachShadow({ mode: 'open' });
      root.innerHTML =
        '<style>' +
        '.t { box-sizing: border-box; max-width: min(520px, calc(100vw - 32px)); padding: 8px 16px; border-radius: 10px;' +
        ' font: 500 13px/1.45 "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;' +
        ' background: #1A1D23; color: #FBFBFC; box-shadow: 0 6px 20px -6px rgb(26 29 35 / .35), 0 1px 2px rgb(26 29 35 / .1);' +
        ' display: flex; gap: 10px; align-items: flex-start; }' +
        '.m { width: 16px; height: 16px; border-radius: 3.75px; flex: none; margin-top: 1.5px; background: #FBFBFC; position: relative; }' +
        '.m::before { content: ""; position: absolute; inset: 0; background: #1A1D23;' +
        ' -webkit-mask: ' + GLYPH + ' center / 100% no-repeat; mask: ' + GLYPH + ' center / 100% no-repeat; }' +
        '@media (prefers-color-scheme: dark) { .t { background: #E6E9F0; color: #15171C; }' +
        ' .m { background: #15171C; } .m::before { background: #E6E9F0; } }' +
        '</style><div class="t" role="status"><span class="m"></span><span class="x"></span></div>';
      (document.body || document.documentElement).appendChild(host);
    }
    host.shadowRoot.querySelector('.x').textContent = message;
    clearTimeout(toastTimer);
    if (life !== 0) toastTimer = setTimeout(function () { host.remove(); }, life || 6000);
  }

  function clearToast() {
    clearTimeout(slowTimer);
    var host = document.getElementById('lintone-note');
    if (host) host.remove();
  }

  function nameFrom(res, u) {
    var cd = (res && res.headers.get('content-disposition')) || '';
    var m = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(cd) || /filename\s*=\s*"?([^";]+)"?/i.exec(cd);
    if (m) { try { return decodeURIComponent(m[1].trim()); } catch (e) { return m[1].trim(); } }
    try {
      var p = new URL(u, location.href);
      var seg = p.pathname.split('/').filter(Boolean).pop();
      return seg ? decodeURIComponent(seg) : p.hostname;
    } catch (e) { return opts.fallbackName || 'download'; }
  }

  function b64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { var s = String(r.result); resolve(s.slice(s.indexOf(',') + 1)); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(blob);
    });
  }

  /* The page as shown, when it is a text file the browser drew as text:
     Chrome puts a .json, .csv or .log in one <pre>. Taking it from there
     costs no second request, and gives what the person is looking at even
     when asking again would not (a POST result, a one-time link). */
  function pageText() {
    if (!opts.usePage || !document.body) return null;
    var here = location.href.split('#')[0], want = String(url).split('#')[0];
    if (here !== want) return null;
    var type = document.contentType || '';
    if (/html/i.test(type)) return null;
    var pre = document.body.querySelector(':scope > pre');
    return pre ? { text: pre.textContent, type: type } : null;
  }

  function read() {
    var shown = pageText();
    if (shown) {
      return Promise.resolve({
        blob: new Blob([shown.text], { type: shown.type }),
        type: shown.type,
        name: nameFrom(null, url)
      });
    }
    var sameOrigin;
    try { sameOrigin = new URL(url, location.href).origin === location.origin; } catch (e) { sameOrigin = false; }
    /* the page itself (a PDF, an XML tree): the browser most likely still
       has it, so it is not downloaded twice */
    var init = { credentials: 'include' };
    if (opts.usePage) init.cache = 'force-cache';
    return fetch(url, init).then(function (res) {
      if (!res.ok) {
        var e = new Error('The server answered ' + res.status + (res.statusText ? ' ' + res.statusText : '') + ' for that link.');
        e.shown = true;
        throw e;
      }
      return res.blob().then(function (blob) {
        return {
          blob: blob,
          type: (res.headers.get('content-type') || blob.type || '').split(';')[0].trim(),
          name: nameFrom(res, url)
        };
      });
    }, function (err) {
      /* a fetch that fails outright is the network, or another site that
         does not let this page read it; the worker may be able to */
      var e = new Error(sameOrigin ? 'lint.one could not reach that link.' : 'cors');
      e.cors = !sameOrigin;
      e.shown = sameOrigin;
      throw e;
    });
  }

  /* only a note to show, nothing to read */
  if (opts.note) { toast(opts.note); return Promise.resolve(true); }

  return new Promise(function (resolve) {
    var port;
    try { port = chrome.runtime.connect({ name: 'grab' }); } catch (e) { resolve(false); return; }
    var file = null, handled = false;

    function done(ok) {
      try { port.disconnect(); } catch (e) {}
      resolve(ok);
    }

    port.onMessage.addListener(function (msg) {
      if (!msg) return;
      if (msg.t === 'stop') {
        handled = true;
        clearTimeout(slowTimer);
        toast(msg.message);
        done(false);
      } else if (msg.t === 'handled') {
        handled = true;
        clearToast();
        done(true);
      } else if (msg.t === 'go' && file) {
        var off = 0, size = file.blob.size;
        (function next() {
          if (off >= size) {
            port.postMessage({ t: 'end' });
            clearToast();
            done(true);
            return;
          }
          var piece = file.blob.slice(off, off + CHUNK);
          off += CHUNK;
          b64(piece).then(function (data) {
            port.postMessage({ t: 'part', data: data });
            next();
          }, function () {
            port.postMessage({ t: 'error', message: 'The file could not be read.' });
            done(false);
          });
        })();
      }
    });
    port.onDisconnect.addListener(function () {
      if (!handled && !file) clearToast();
      resolve(false);
    });

    /* say something only if reading takes long enough to wonder */
    slowTimer = setTimeout(function () { toast('Reading it for lint.one…', 0); }, 450);

    read().then(function (f) {
      file = f;
      return f.blob.slice(0, 4096).text().then(function (head) {
        port.postMessage({
          t: 'meta', name: f.name, type: f.type, size: f.blob.size, head: head,
          encoding: 'b64', replace: !!opts.replace
        });
      });
    }).catch(function (e) {
      clearTimeout(slowTimer);
      if (e && e.cors) {
        port.postMessage({ t: 'cors', url: String(new URL(url, location.href)), fallbackName: opts.fallbackName });
        return;
      }
      toast(e && e.shown ? e.message : 'lint.one could not read that.');
      done(false);
    });
  });
}
