/* lint.one extension — the DevTools panel.

   Lists every response the inspected page loads that a lint.one tool can
   read, and opens one in that tool on a click. The body comes from
   DevTools itself (getContent), so nothing is requested again: what opens
   is exactly what the page received, POST responses and all. It goes to
   the service worker over the same 'grab' port grab.js uses, and on to
   the tool's tab from there. */
(function () {
  'use strict';
  var F = self.LintFormats;
  var net = chrome.devtools.network;
  var tabId = chrome.devtools.inspectedWindow.tabId;
  var $ = function (id) { return document.getElementById(id); };

  var MAX_ROWS = 2000;
  var PART = 4 * 1024 * 1024;
  var FILTERS = [
    { id: 'all',  name: 'All' },
    { id: 'json', name: 'JSON' },
    { id: 'xml',  name: 'XML' },
    { id: 'yaml', name: 'YAML' },
    { id: 'csv',  name: 'CSV' },
    { id: 'log',  name: 'Logs' },
    { id: 'file', name: 'Files', title: 'PDF, SQLite and audio' }
  ];

  var rows = [];
  var filter = 'all', query = '';
  var list = $('list');

  /* ---------- toast ---------- */
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  /* ---------- rows ---------- */
  function nameFromUrl(url) {
    try {
      var u = new URL(url);
      var seg = u.pathname.split('/').filter(Boolean).pop();
      return seg ? decodeURIComponent(seg) : u.hostname;
    } catch (e) { return url; }
  }

  function fmtBytes(n) {
    if (!(n >= 0)) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' kB';
    return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
  }

  /* Which tool reads a response, if any. Plain text is kept too: it is
     sniffed when opened, since the Content-Type says nothing about it. */
  function classify(req) {
    var url = req.request && req.request.url;
    if (!url || !/^https?:/.test(url)) return null;
    var res = req.response || {};
    var mime = String((res.content && res.content.mimeType) || '').toLowerCase();
    if (F.isWebPage(mime)) return null;
    if (/^(image|video|font)\//.test(mime) || /javascript|css|wasm/.test(mime)) return null;
    var name = nameFromUrl(url);
    var tool = F.pick(name, mime, null);
    if (!tool && !/^text\/plain\b/.test(mime)) return null;
    var size = res.content && res.content.size;
    if (!(size > 0)) size = res.bodySize > 0 ? res.bodySize : 0;
    var host = '';
    try { var u = new URL(url); host = u.host + u.pathname; } catch (e) {}
    return {
      req: req, tool: tool, name: name, url: url, host: host, mime: mime,
      status: res.status || 0, size: size, method: (req.request.method || 'GET').toUpperCase()
    };
  }

  function group(row) {
    if (!row.tool) return 'log';
    return /^(pdf|audio|sqlite)$/.test(row.tool) ? 'file' : row.tool;
  }

  function visible(row) {
    if (filter !== 'all' && group(row) !== filter) return false;
    return !query || row.url.toLowerCase().indexOf(query) >= 0;
  }

  function render(row) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'resp';
    if (row.tool) b.style.setProperty('--tool-hue', F.BY_ID[row.tool].hue);
    var kind = row.tool ? F.BY_ID[row.tool].name : 'Text';
    b.innerHTML =
      '<span class="tool-tile dot-' + (row.tool || 'none') + '" aria-hidden="true"></span>' +
      '<span class="r-name"></span><span class="r-url"></span>' +
      '<span class="r-status"></span><span class="r-kind"></span><span class="r-size"></span>';
    b.children[1].textContent = row.name;
    b.children[2].textContent = (row.method !== 'GET' ? row.method + ' ' : '') + row.host;
    b.children[3].textContent = row.status || '';
    if (row.status >= 400) b.children[3].classList.add('bad');
    b.children[4].textContent = kind;
    b.children[5].textContent = fmtBytes(row.size);
    b.title = 'Open in lint.one ' + kind + '\n' + row.url;
    b.addEventListener('click', function () { open(row, b); });
    row.el = b;
    return b;
  }

  function add(req) {
    var row = classify(req);
    if (!row) return;
    rows.push(row);
    if (rows.length > MAX_ROWS) {
      var old = rows.shift();
      if (old.el) old.el.remove();
    }
    var el = render(row);
    el.hidden = !visible(row);
    var atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 4;
    list.appendChild(el);
    if (atBottom) list.scrollTop = list.scrollHeight;
    count();
  }

  function count() {
    var n = rows.filter(visible).length;
    $('count').textContent = n + (n === 1 ? ' response' : ' responses') +
      (n !== rows.length ? ' of ' + rows.length : '');
  }

  function refilter() {
    rows.forEach(function (r) { r.el.hidden = !visible(r); });
    count();
  }

  function clear() {
    rows = [];
    list.textContent = '';
    count();
  }

  /* ---------- opening ---------- */
  function latin1Head(b64) {
    try { return atob(b64.slice(0, 5464)); } catch (e) { return ''; }
  }

  function splitText(text) {
    var out = [];
    for (var i = 0; i < text.length;) {
      var end = Math.min(text.length, i + PART);
      var c = text.charCodeAt(end - 1);
      if (end < text.length && c >= 0xD800 && c <= 0xDBFF) end--;
      out.push(text.slice(i, end));
      i = end;
    }
    return out;
  }

  function open(row, el) {
    if (typeof row.req.getContent !== 'function') { toast('DevTools no longer has that response. Reload the page.'); return; }
    el.classList.add('opening');
    row.req.getContent(function (content, encoding) {
      el.classList.remove('opening');
      if (content == null || content === '') { toast('That response has no body to open.'); return; }
      var b64 = encoding === 'base64';
      var parts = b64 ? [] : splitText(content);
      if (b64) for (var i = 0; i < content.length; i += PART) parts.push(content.slice(i, i + PART));

      var port;
      try { port = chrome.runtime.connect({ name: 'grab' }); }
      catch (e) { toast('The extension was updated. Close and reopen DevTools.'); return; }
      port.onMessage.addListener(function (msg) {
        if (!msg) return;
        if (msg.t === 'stop') { toast(msg.message); port.disconnect(); }
        else if (msg.t === 'go') {
          parts.forEach(function (p) { port.postMessage({ t: 'part', data: p }); });
          port.postMessage({ t: 'end' });
          port.disconnect();
        }
      });
      port.postMessage({
        t: 'meta', name: row.name, type: row.mime, tabId: tabId,
        encoding: b64 ? 'b64' : 'text',
        size: b64 ? Math.floor(content.length * 3 / 4) : content.length,
        head: b64 ? latin1Head(content) : content.slice(0, 4096)
      });
    });
  }

  /* keyboard: arrows move between rows, as in the Network panel */
  list.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    var shown = rows.filter(function (r) { return !r.el.hidden; }).map(function (r) { return r.el; });
    var i = shown.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    var next = shown[e.key === 'ArrowDown' ? Math.min(shown.length - 1, i + 1) : Math.max(0, i - 1)];
    if (next) next.focus();
  });

  /* ---------- toolbar ---------- */
  var seg = $('filters');
  FILTERS.forEach(function (f) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = f.name;
    if (f.title) b.title = f.title;
    b.setAttribute('aria-pressed', String(f.id === filter));
    b.addEventListener('click', function () {
      filter = f.id;
      Array.prototype.forEach.call(seg.children, function (c) { c.setAttribute('aria-pressed', String(c === b)); });
      refilter();
    });
    seg.appendChild(b);
  });

  $('filter').addEventListener('input', function (e) {
    query = e.target.value.trim().toLowerCase();
    refilter();
  });
  $('clear').addEventListener('click', clear);

  var preserve = $('preserve');
  try { preserve.checked = localStorage.getItem('lintone-preserve') === '1'; } catch (e) {}
  preserve.addEventListener('change', function () {
    try { localStorage.setItem('lintone-preserve', preserve.checked ? '1' : '0'); } catch (e) {}
  });

  /* ---------- the network ---------- */
  net.getHAR(function (har) {
    (har && har.entries || []).forEach(add);
  });
  net.onRequestFinished.addListener(add);
  net.onNavigated.addListener(function () { if (!preserve.checked) clear(); });
})();
