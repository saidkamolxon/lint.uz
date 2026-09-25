/* lint.one extension — the service worker.

   Everything the extension does ends the same way: a file (or a piece of
   text) is opened in a lint.one tool. This worker decides which tool,
   opens it in a tab, and hands the file to that tab's bridge (bridge.js),
   which gives it to the page with postMessage. The file goes page →
   extension → page inside this browser; it is never put in a URL and never
   sent to any server, lint.one's included.

   Where files come from:
   - the right-click menu: a selection, a link, an audio element, or the
     page itself when it is a file (a .json or .csv opened in a tab)
   - the popup: the current page, pasted text, or an empty tool
   - the omnibox: "lint" then a space, then text
   - auto.js, when "Open data pages automatically" is on

   And one thing that is not a file: a tab's sound. "Listen to this tab"
   opens the Audio tool on it through tabCapture, without the share-a-tab
   picker the page alone would need.

   A file read from a page is read by grab.js *in that page*, so the
   request carries the page's own cookies and a link behind a login works
   exactly as clicking it would. */

importScripts('base.js', 'formats.js', 'grab.js');

var F = self.LintFormats;
var BASE = self.LINT_BASE;

/* a tab holds the whole file in memory twice on its way in; past this a
   download and the landing page (or the installed app) are the better road */
var MAX_BYTES = 512 * 1024 * 1024;
var TEXT_PART = 4 * 1024 * 1024;
var ALL_SITES = ['http://*/*', 'https://*/*'];

/* ==========================================================================
   Jobs: a file on its way to the tab that will show it
   ========================================================================== */

/* destination tab id -> job. A job fills from its source (parts arrive as
   the source reads them) and drains into the bridge once it connects;
   neither waits for the other. */
var jobs = new Map();
/* bridges that connected before their tab's job was registered — possible
   when lint.one loads from its offline copy faster than tabs.create returns */
var waiting = new Map();
var opening = 0;

function newJob(name, type, encoding, size) {
  return { name: name, type: type, encoding: encoding, size: size || 0,
           parts: [], done: false, error: null, out: null };
}

function send(job, msg) {
  try { job.out.postMessage(msg); } catch (e) { job.out = null; }
}

function push(job, data) {
  if (job.out) send(job, { t: 'part', data: data });
  else job.parts.push(data);
}

function finish(job) {
  job.done = true;
  if (job.out) send(job, { t: 'end' });
}

function fail(job, message) {
  job.error = message;
  if (job.out) send(job, { t: 'error', message: message });
}

function attach(tabId, job, port) {
  job.out = port;
  if (job.capture) { sendCapture(tabId, job, port); return; }
  send(job, { t: 'meta', name: job.name, type: job.type, encoding: job.encoding, size: job.size });
  var parts = job.parts;
  job.parts = [];
  parts.forEach(function (p) { send(job, { t: 'part', data: p }); });
  if (job.error) send(job, { t: 'error', message: job.error });
  else if (job.done) send(job, { t: 'end' });
  port.onDisconnect.addListener(function () { jobs.delete(tabId); });
}

function register(tabId, job) {
  jobs.set(tabId, job);
  /* a job nobody collects (the tab was closed at once) is let go */
  setTimeout(function () { if (jobs.get(tabId) === job && !job.out) jobs.delete(tabId); }, 120000);
  var port = waiting.get(tabId);
  if (port) { waiting.delete(tabId); attach(tabId, job, port); }
}

function releaseWaiting() {
  if (opening > 0) return;
  waiting.forEach(function (port) { try { port.postMessage({ t: 'none' }); } catch (e) {} });
  waiting.clear();
}

/* Open the tool, next to the tab the file came from, or in that tab's
   place when `replace` (the automatic open, and an omnibox Enter without
   Alt). Resolves to the tab the job belongs to. */
function openTab(tool, source, replace) {
  var url = BASE + '/' + tool + '/';
  opening++;
  var p;
  if (replace && source && source.id >= 0) {
    p = chrome.tabs.update(source.id, { url: url }).then(function (t) { return t.id; });
  } else {
    var props = { url: url, active: true };
    if (source && source.id >= 0) {
      props.windowId = source.windowId;
      props.index = source.index + 1;
      props.openerTabId = source.id;
    }
    p = chrome.tabs.create(props).then(function (t) { return t.id; });
  }
  return p.finally(function () {
    /* after the caller has registered its job, in the same turn */
    setTimeout(function () { opening--; releaseWaiting(); }, 0);
  });
}

function openEmpty(tool, source) {
  var url = BASE + '/' + (F.BY_ID[tool] ? tool : '') + (F.BY_ID[tool] ? '/' : '');
  var props = { url: url, active: true };
  if (source && source.id >= 0) { props.windowId = source.windowId; props.index = source.index + 1; }
  return chrome.tabs.create(props);
}

/* Text split for the port, never between the two halves of a surrogate
   pair: each part becomes UTF-8 on its own in the bridge, and half a pair
   would come out as U+FFFD. */
function splitText(text) {
  var out = [];
  for (var i = 0; i < text.length;) {
    var end = Math.min(text.length, i + TEXT_PART);
    var c = text.charCodeAt(end - 1);
    if (end < text.length && c >= 0xD800 && c <= 0xDBFF) end--;
    out.push(text.slice(i, end));
    i = end;
  }
  return out;
}

function openText(text, baseName, source, opts) {
  opts = opts || {};
  var tool = (opts.tool && F.BY_ID[opts.tool]) ? opts.tool : F.sniffText(text);
  var job = newJob(F.nameFor(baseName, tool, text), 'text/plain', 'text', text.length);
  splitText(text).forEach(function (p) { job.parts.push(p); });
  job.done = true;
  return openTab(tool, source, opts.replace).then(function (tabId) { register(tabId, job); });
}

/* ==========================================================================
   Listening to a tab: the Audio tool, fed by tabCapture
   ========================================================================== */

/* Open the Audio tool beside the tab that is playing. The stream id is
   asked for only once the tool's bridge connects: Chrome ties the id to
   the tab that will use it *and* to that tab's origin, which it only has
   once lint.one has loaded in it. The person clicking the button or the
   menu item is what allows the capture; no site access is involved. */
function listen(tab) {
  if (!tab || tab.id < 0) return;
  var job = newJob('', '', 'text', 0);
  job.capture = { tabId: tab.id, title: tab.title || hostOf(tab.url || '') };
  return openTab('audio', tab, false).then(function (tabId) { register(tabId, job); });
}

/* tabCapture is optional, so installing does not say "all your data on
   all websites"; Chrome asks the first time someone listens. The tab
   waiting for that answer is kept in session storage, and the grant
   itself (permissions.onAdded) starts the listening, so it happens
   whether or not the popup that asked survived Chrome's prompt. */
var CAPTURE = { permissions: ['tabCapture'] };

function listenOrAsk(tab, fromMenu) {
  return chrome.permissions.contains(CAPTURE).then(function (ok) {
    if (ok) return listen(tab);
    return chrome.storage.session.set({ listenTab: tab.id }).then(function () {
      if (!fromMenu) return;
      /* the popup asks for itself; from the menu, ask here, and if Chrome
         will not take the request from a menu click, say where to start */
      return chrome.permissions.request(CAPTURE).catch(function () {
        chrome.storage.session.remove('listenTab');
        chrome.scripting.executeScript({
          target: { tabId: tab.id }, func: self.lintoneGrab,
          args: ['', { note: 'The first time, start listening from the lint.one button in the toolbar: Chrome asks there.' }]
        }).catch(function () {});
      });
    });
  });
}

chrome.permissions.onAdded.addListener(function (p) {
  if (!p.permissions || p.permissions.indexOf('tabCapture') < 0) return;
  chrome.storage.session.get('listenTab').then(function (v) {
    if (v.listenTab == null) return;
    chrome.storage.session.remove('listenTab');
    chrome.tabs.get(v.listenTab).then(listen, function () {});
  });
});

function sendCapture(consumerId, job, port) {
  chrome.tabCapture.getMediaStreamId({ targetTabId: job.capture.tabId, consumerTabId: consumerId })
    .then(function (streamId) {
      send(job, { t: 'capture', streamId: streamId, title: job.capture.title });
    }, function (err) {
      var m = String(err && err.message || '');
      send(job, { t: 'error', message: /active stream/i.test(m)
        ? 'That tab is already being listened to.'
        : 'Chrome would not let lint.one listen to that tab. Try again from the tab itself.' });
    });
}

/* the menu item only while the tab in front is playing sound */
function syncListenMenu(tab) {
  chrome.contextMenus.update('listen', { visible: !!(tab && tab.audible) }, function () {
    void chrome.runtime.lastError;
  });
}
chrome.tabs.onActivated.addListener(function (info) {
  chrome.tabs.get(info.tabId).then(syncListenMenu, function () {});
});
chrome.tabs.onUpdated.addListener(function (tabId, change, tab) {
  if ('audible' in change && tab.active) syncListenMenu(tab);
});

/* ==========================================================================
   Reading a file from a page (grab.js), or — for a
   link to another site, once every site is allowed — from here
   ========================================================================== */

/* Start grab.js in the page. It posts back over a 'grab' port, handled
   below; the promise it returns only matters if injection itself fails
   (a chrome:// page, the Web Store, a PDF inside the built-in viewer's
   frame). */
function grabIn(tab, frameId, url, opts) {
  opts = opts || {};
  return chrome.scripting.executeScript({
    target: { tabId: tab.id, frameIds: [frameId || 0] },
    func: self.lintoneGrab,
    args: [url, { usePage: !!opts.usePage, replace: !!opts.replace, fallbackName: opts.fallbackName || '' }]
  }).catch(function () {
    /* the page would not take a script — read it from here instead, if
       this extension may */
    return readHere(url, tab, opts);
  });
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch (e) { return ''; }
}

function mayRead(url) {
  var origin;
  try { origin = new URL(url).origin; } catch (e) { return Promise.resolve(false); }
  if (!/^https?:/.test(origin)) return Promise.resolve(false);
  return chrome.permissions.contains({ origins: [origin + '/*'] }).catch(function () { return false; });
}

/* Decide the tool for a file described by `meta`, or say why not.
   Returns { tool, name } or { error }. */
function decide(meta) {
  if (meta.size > MAX_BYTES) {
    return { error: 'That file is over 512 MB. Download it and open it from lint.one instead.' };
  }
  var tool = F.pick(meta.name, meta.type, null);
  if (!tool && F.isWebPage(meta.type)) {
    return { error: 'That is a web page, not a file lint.one reads.' };
  }
  if (!tool) tool = F.sniffHead(meta.head || '');
  return { tool: tool, name: F.nameFor(meta.name, tool, meta.head) };
}

/* the 'grab' port: grab.js, from the page a file comes from */
function onGrab(port) {
  var job = null, ended = false;

  port.onMessage.addListener(function (msg) {
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'meta') {
      var d = decide(msg);
      if (d.error) { port.postMessage({ t: 'stop', message: d.error }); return; }
      job = newJob(d.name, msg.type || '', msg.encoding === 'text' ? 'text' : 'b64', msg.size);
      port.postMessage({ t: 'go' });
      var sourceTab = port.sender && port.sender.tab
        ? Promise.resolve(port.sender.tab)
        : (msg.tabId >= 0 ? chrome.tabs.get(msg.tabId).catch(function () { return null; }) : Promise.resolve(null));
      var j = job;
      sourceTab.then(function (src) { return openTab(d.tool, src, msg.replace); })
        .then(function (tabId) { register(tabId, j); })
        .catch(function () {});
    } else if (msg.t === 'part' && job) {
      push(job, msg.data);
    } else if (msg.t === 'end' && job) {
      ended = true;
      finish(job);
    } else if (msg.t === 'error' && job) {
      ended = true;
      fail(job, msg.message || 'The file could not be read.');
    } else if (msg.t === 'cors') {
      /* grab.js could not read a link to another site from the page: the
         other site did not allow it. Read it from here if every site is
         allowed; otherwise say what would make it work. */
      mayRead(msg.url).then(function (ok) {
        if (!ok) {
          port.postMessage({ t: 'stop', message:
            'That link is on another site. To open it, turn on \u201cOpen data pages automatically\u201d ' +
            'in the lint.one menu, or download the file and drop it on lint.one.' });
          return;
        }
        port.postMessage({ t: 'handled' });
        var src = port.sender && port.sender.tab;
        readHere(msg.url, src, { replace: false, fallbackName: msg.fallbackName });
      });
    }
  });

  port.onDisconnect.addListener(function () {
    if (job && !ended) fail(job, 'The page closed before the file was read.');
  });
}

function b64(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function nameFromResponse(res, url, fallback) {
  var cd = res.headers.get('content-disposition') || '';
  var m = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(cd) || /filename\s*=\s*"?([^";]+)"?/i.exec(cd);
  if (m) { try { return decodeURIComponent(m[1].trim()); } catch (e) { return m[1].trim(); } }
  try {
    var u = new URL(url);
    var seg = u.pathname.split('/').filter(Boolean).pop();
    if (seg) return decodeURIComponent(seg);
    return u.hostname;
  } catch (e) { return fallback || 'download'; }
}

/* The same work grab.js does, from the service worker, for a link the page
   could not read itself. Needs host access to the link's site. */
function readHere(url, source, opts) {
  opts = opts || {};
  return mayRead(url).then(function (ok) {
    if (!ok) return;
    return fetch(url, { credentials: 'include' }).then(function (res) {
      if (!res.ok) throw new Error('status ' + res.status);
      return res.blob().then(function (blob) {
        var type = (res.headers.get('content-type') || blob.type || '').split(';')[0].trim();
        var name = nameFromResponse(res, url, opts.fallbackName);
        return blob.slice(0, 4096).text().then(function (head) {
          var d = decide({ name: name, type: type, size: blob.size, head: head });
          if (d.error) return;
          var job = newJob(d.name, type, 'b64', blob.size);
          return openTab(d.tool, source, opts.replace).then(function (tabId) {
            register(tabId, job);
            var CH = 3 * 1024 * 1024, off = 0;
            function next() {
              if (off >= blob.size) { finish(job); return; }
              var piece = blob.slice(off, off + CH);
              off += CH;
              return piece.arrayBuffer().then(function (buf) {
                push(job, b64(new Uint8Array(buf)));
                return next();
              });
            }
            return next();
          });
        });
      });
    });
  }).catch(function () {});
}

/* ==========================================================================
   Bridges: lint.one tabs asking whether a file is waiting for them
   ========================================================================== */

function onBridge(port) {
  var tabId = port.sender && port.sender.tab && port.sender.tab.id;
  if (tabId == null) { port.disconnect(); return; }
  var job = jobs.get(tabId);
  if (job && !job.out) { attach(tabId, job, port); return; }
  if (opening > 0) {
    waiting.set(tabId, port);
    port.onDisconnect.addListener(function () { if (waiting.get(tabId) === port) waiting.delete(tabId); });
    return;
  }
  port.postMessage({ t: 'none' });
}

chrome.runtime.onConnect.addListener(function (port) {
  if (port.name === 'bridge') onBridge(port);
  else if (port.name === 'grab') onGrab(port);
});

/* ==========================================================================
   Right-click menu
   ========================================================================== */

/* Every extension a tool reads, as URL patterns, so "Open this page" only
   appears on a page that is a file: /users.json, /report.pdf?download=1 */
function filePagePatterns() {
  var out = [];
  Object.keys(F.BY_EXT).forEach(function (e) {
    out.push('*://*/*.' + e, '*://*/*.' + e + '?*', '*://*/*.' + e.toUpperCase());
  });
  return out;
}

function buildMenus() {
  chrome.contextMenus.removeAll(function () {
    chrome.contextMenus.create({ id: 'selection', title: 'Open selection in lint.one', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'link', title: 'Open link in lint.one', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'media', title: 'Open audio in lint.one', contexts: ['audio'] });
    chrome.contextMenus.create({
      id: 'listen', title: 'Listen to this tab in lint.one', contexts: ['page', 'video', 'audio'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'], visible: false
    }, function () {
      chrome.tabs.query({ active: true, currentWindow: true }).then(function (t) { syncListenMenu(t[0]); });
    });
    chrome.contextMenus.create({
      id: 'page', title: 'Open this file in lint.one', contexts: ['page', 'frame'],
      documentUrlPatterns: filePagePatterns()
    });
  });
}

/* The selection as the page has it. The menu's own selectionText has its
   line breaks folded into spaces, which would turn YAML, CSV or a log
   into one long line; a textarea's selection is not in getSelection() at
   all. */
function selectionIn(tab, frameId, fallback) {
  return chrome.scripting.executeScript({
    target: { tabId: tab.id, frameIds: [frameId || 0] },
    func: function () {
      var el = document.activeElement;
      if (el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search|url)$/i.test(el.type))) &&
          el.selectionEnd > el.selectionStart) {
        return el.value.slice(el.selectionStart, el.selectionEnd);
      }
      return String(window.getSelection() || '');
    }
  }).then(function (r) {
    var s = r && r[0] && r[0].result;
    return typeof s === 'string' && s.trim() ? s : (fallback || '');
  }, function () { return fallback || ''; });
}

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (!tab) return;
  var frameId = info.frameId || 0;
  if (info.menuItemId === 'selection') {
    selectionIn(tab, frameId, info.selectionText).then(function (text) {
      if (text.trim()) openText(text, 'selection', tab);
    });
  } else if (info.menuItemId === 'link' && info.linkUrl) {
    grabIn(tab, frameId, info.linkUrl, {});
  } else if (info.menuItemId === 'media' && info.srcUrl) {
    grabIn(tab, frameId, info.srcUrl, {});
  } else if (info.menuItemId === 'listen') {
    listenOrAsk(tab, true);
  } else if (info.menuItemId === 'page') {
    grabIn(tab, frameId, info.frameUrl || info.pageUrl || tab.url, { usePage: true });
  }
});

/* ==========================================================================
   Omnibox: "lint", space, then text — or a tool's name to open it empty
   ========================================================================== */

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, function (c) {
    return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c];
  });
}

chrome.omnibox.setDefaultSuggestion({ description: 'Paste JSON, XML, YAML, CSV or a log, or type a format to open its tool' });

chrome.omnibox.onInputChanged.addListener(function (text, suggest) {
  var t = text.trim();
  if (!t) return;
  var word = F.toolFromWord(t);
  if (word) {
    chrome.omnibox.setDefaultSuggestion({ description: 'Open <match>' + escapeXml(F.BY_ID[word].name) + '</match> in lint.one' });
  } else {
    var tool = F.sniffText(t);
    chrome.omnibox.setDefaultSuggestion({ description: 'Open as <match>' + escapeXml(F.BY_ID[tool].name) + '</match> in lint.one' });
  }
  suggest([]);
});

chrome.omnibox.onInputEntered.addListener(function (text, disposition) {
  var t = text.trim();
  if (!t) return;
  chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
    var tab = tabs[0];
    var replace = disposition === 'currentTab';
    var word = F.toolFromWord(t);
    if (word) {
      var url = BASE + '/' + word + '/';
      if (replace && tab) chrome.tabs.update(tab.id, { url: url });
      else chrome.tabs.create({ url: url, active: disposition !== 'newBackgroundTab' });
      return;
    }
    openText(text, 'pasted', tab, { replace: replace });
  });
});

/* ==========================================================================
   Messages from the popup and auto.js
   ========================================================================== */

chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
  if (!msg || typeof msg.kind !== 'string') return;
  /* answered at once, so the popup can close without cutting us off */
  reply({ ok: true });

  if (msg.kind === 'text' && typeof msg.text === 'string' && msg.text.trim()) {
    chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
      openText(msg.text, msg.name || 'pasted', tabs[0], { tool: msg.tool });
    });
  } else if (msg.kind === 'tool') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
      openEmpty(msg.tool, tabs[0]);
    });
  } else if (msg.kind === 'page' && msg.tabId >= 0) {
    chrome.tabs.get(msg.tabId).then(function (tab) {
      grabIn(tab, 0, tab.url, { usePage: true });
    }).catch(function () {});
  } else if (msg.kind === 'listen' && msg.tabId >= 0) {
    chrome.tabs.get(msg.tabId).then(function (t) { return listenOrAsk(t, false); }, function () {});
  } else if (msg.kind === 'auto' && sender.tab && sender.frameId === 0) {
    grabIn(sender.tab, 0, sender.url || sender.tab.url, { usePage: true, replace: true });
  } else if (msg.kind === 'sync-auto') {
    syncAuto();
  }
});

/* ==========================================================================
   "Open data pages automatically": auto.js on every site, registered only
   while the setting is on and every site is allowed
   ========================================================================== */

function syncAuto() {
  return Promise.all([
    chrome.storage.local.get('auto'),
    chrome.permissions.contains({ origins: ALL_SITES }).catch(function () { return false; }),
    chrome.scripting.getRegisteredContentScripts({ ids: ['auto'] }).catch(function () { return []; })
  ]).then(function (r) {
    var want = !!(r[0] && r[0].auto) && r[1];
    var have = r[2].length > 0;
    if (want && !have) {
      return chrome.scripting.registerContentScripts([{
        id: 'auto', matches: ALL_SITES, js: ['auto.js'],
        runAt: 'document_end', allFrames: false, persistAcrossSessions: true
      }]).catch(function () {});
    }
    if (!want && have) {
      return chrome.scripting.unregisterContentScripts({ ids: ['auto'] }).catch(function () {});
    }
  });
}

chrome.permissions.onAdded.addListener(syncAuto);
chrome.permissions.onRemoved.addListener(function () {
  /* access taken back in Chrome's settings turns the setting off too, so
     the popup never shows a switch that does nothing */
  chrome.permissions.contains({ origins: ALL_SITES }).then(function (ok) {
    if (!ok) chrome.storage.local.set({ auto: false });
    syncAuto();
  });
});
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === 'local' && changes.auto) syncAuto();
});

chrome.runtime.onInstalled.addListener(function () { buildMenus(); syncAuto(); });
chrome.runtime.onStartup.addListener(syncAuto);
