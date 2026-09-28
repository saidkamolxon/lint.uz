/* ==========================================================================
   The HAR worker. A HAR is one JSON document that can run to hundreds of
   megabytes, mostly response bodies, so it is parsed here, off the page.
   The page gets a light index to list and filter; a request in full only
   when it is opened; and, on asking, the same file with its secrets
   replaced by "[redacted]".
   ========================================================================== */
'use strict';

let har = null;       // the parsed log
let entries = [];
let found = [];       // the secrets: {i, kind, where, name, value}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    let out;
    if (m.type === 'open') out = await open(m.file ? await m.file.text() : m.text);
    else if (m.type === 'entry') out = entry(m.i);
    else if (m.type === 'body') out = body(m.i, m.which);
    else if (m.type === 'redact') out = redact();
    else if (m.type === 'search') out = search(m.inc, m.exc);
    else if (m.type === 'close') { har = null; entries = []; found = []; texts = null; out = {}; }
    self.postMessage({ id: m.id, ok: true, ...out });
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: err.message || String(err) });
  }
};

/* ==========================================================================
   Opening
   ========================================================================== */
async function open(text) {
  har = null; entries = []; found = []; seen = new Set(); vids = new Map(); texts = null;
  let doc;
  try {
    doc = JSON.parse(text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);
  } catch (err) {
    throw new Error('This is not a HAR file: it is not valid JSON (' + err.message + ')');
  }
  if (!doc || typeof doc !== 'object' || !doc.log || !Array.isArray(doc.log.entries)) {
    throw new Error('This is JSON, but not a HAR file: it has no log.entries');
  }
  har = doc;
  entries = doc.log.entries;

  let t0 = Infinity;
  const starts = entries.map((x) => {
    const t = Date.parse(x && x.startedDateTime);
    if (t < t0) t0 = t;
    return t;
  });
  if (!isFinite(t0)) t0 = 0;

  const list = entries.map((x, i) => summary(x, i, isFinite(starts[i]) ? starts[i] - t0 : 0));
  entries.forEach(scanEntry);
  (doc.log.pages || []).forEach((p) => { if (p && p.title) scanUrl(-1, 'Page title', p.title); });

  const counts = new Array(entries.length).fill(0);
  found.forEach((f) => { if (f.i >= 0) counts[f.i]++; });
  list.forEach((r, i) => { r.secrets = counts[i]; });

  const creator = doc.log.creator || {};
  const browser = doc.log.browser || {};
  return {
    list,
    t0: isFinite(t0) ? t0 : null,
    /* the values themselves stay in the tab like the rest of the file; v
       numbers them, so the same token met in many requests is one secret */
    secrets: found.map(({ i, kind, where, name, value }) => ({ i, kind, where, name, value, v: vid(value), preview: mask(value) })),
    file: {
      version: doc.log.version || '',
      creator: [creator.name, creator.version].filter(Boolean).join(' '),
      browser: [browser.name, browser.version].filter(Boolean).join(' '),
      pages: (doc.log.pages || []).map((p) => ({ title: p.title || p.id || '', started: p.startedDateTime || '',
                                                 onLoad: p.pageTimings ? p.pageTimings.onLoad : null }))
    }
  };
}

/* ==========================================================================
   The index: what a row in the list needs
   ========================================================================== */
function summary(x, i, start) {
  const req = (x && x.request) || {};
  const res = (x && x.response) || {};
  const content = res.content || {};
  let host = '', path = req.url || '', scheme = '';
  try {
    const u = new URL(req.url);
    host = u.host; scheme = u.protocol.replace(':', '');
    path = u.pathname + u.search;
  } catch (e) {}
  const status = Number(res.status) || 0;
  const mime = String(content.mimeType || headerOf(res.headers, 'content-type') || '').split(';')[0].trim().toLowerCase();
  const t = x.timings || {};
  const transfer = x.response && isNum(res._transferSize) ? res._transferSize
    : (isNum(res.bodySize) && res.bodySize >= 0 ? res.bodySize + Math.max(0, res.headersSize || 0) : null);
  return {
    i,
    method: String(req.method || 'GET').toUpperCase(),
    url: String(req.url || ''),
    host, path, scheme,
    status,
    statusText: String(res.statusText || ''),
    type: typeOf(x, mime, req.url),
    mime,
    transfer,                                  // bytes over the wire, when the browser said
    size: isNum(content.size) && content.size >= 0 ? content.size : null,   // the body, decoded
    start,
    time: isNum(x.time) && x.time >= 0 ? x.time : 0,
    wait: isNum(t.wait) && t.wait >= 0 ? t.wait : 0,
    before: ['blocked', 'dns', 'connect', 'send'].reduce((s, k) => s + (isNum(t[k]) && t[k] > 0 ? t[k] : 0), 0),
    cached: !!(x._fromCache || x.cache && (x.cache.beforeRequest || x.cache.afterRequest)) || status === 304,
    error: String(x._error || res._error || (status === 0 ? (res.statusText || 'No response') : '')),
    http: String(res.httpVersion || req.httpVersion || ''),
    ip: String(x.serverIPAddress || ''),
    secrets: 0
  };
}

/* what kind of request, as the browser's Network tab would file it */
function typeOf(x, mime, url) {
  const rt = String(x._resourceType || '').toLowerCase();
  const byRt = { xhr: 'xhr', fetch: 'xhr', document: 'doc', script: 'js', stylesheet: 'css', image: 'img',
                 font: 'font', media: 'media', websocket: 'ws', manifest: 'other', preflight: 'xhr', ping: 'xhr',
                 eventsource: 'xhr', texttrack: 'media' };
  if (byRt[rt]) return byRt[rt];
  if (Array.isArray(x._webSocketMessages) || /^wss?:/i.test(url || '')) return 'ws';
  if (/json|xml(?!.*html)|protobuf|grpc|graphql|x-www-form-urlencoded|event-stream/.test(mime)) return 'xhr';
  if (/html/.test(mime)) return 'doc';
  if (/javascript|ecmascript|wasm/.test(mime)) return 'js';
  if (/css/.test(mime)) return 'css';
  if (/^image\//.test(mime)) return 'img';
  if (/^font\/|woff|opentype|truetype/.test(mime)) return 'font';
  if (/^(audio|video)\//.test(mime) || /mpegurl|dash\+xml/.test(mime)) return 'media';
  return 'other';
}

function isNum(v) { return typeof v === 'number' && isFinite(v); }
function headerOf(headers, name) {
  if (!Array.isArray(headers)) return '';
  const h = headers.find((x) => x && String(x.name).toLowerCase() === name);
  return h ? String(h.value) : '';
}

/* ==========================================================================
   Search: the words asked for, anywhere in a request — its URL, headers,
   cookies and bodies. Each request's text is gathered, lowercased, the
   first time a search runs, and a body only in its first 256 KB.
   ========================================================================== */
const SEARCH_BODY = 256 * 1024;
let texts = null;

function searchText(x) {
  if (!x) return '';
  const req = x.request || {};
  const res = x.response || {};
  const c = res.content || {};
  const parts = [req.method, req.url, res.status, res.statusText, c.mimeType, x._error || ''];
  const pairs = (list) => (list || []).forEach((h) => { if (h) parts.push(h.name + ': ' + h.value); });
  pairs(req.headers); pairs(res.headers); pairs(req.cookies); pairs(res.cookies);
  if (req.postData) {
    pairs(req.postData.params);
    if (req.postData.text) parts.push(String(req.postData.text).slice(0, SEARCH_BODY));
  }
  if (c.text && c.encoding !== 'base64') parts.push(String(c.text).slice(0, SEARCH_BODY));
  let text = parts.join('\n');
  /* a URL is searched as written and as read: %2F and / both find it */
  try { text += '\n' + decodeURIComponent(req.url || ''); } catch (e) {}
  return text.toLowerCase();
}

function search(inc, exc) {
  if (!texts) texts = entries.map(searchText);
  const hits = [];
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    if (inc.every((w) => t.includes(w)) && !exc.some((w) => t.includes(w))) hits.push(i);
  }
  return { hits };
}

/* ==========================================================================
   One request, in full, when it is opened. Bodies are cut at a size the
   panel can show; the whole of one comes with 'body'.
   ========================================================================== */
const SHOW_MAX = 512 * 1024;

function entry(i) {
  const x = entries[i];
  if (!x) throw new Error('No such request');
  const req = x.request || {};
  const res = x.response || {};
  return {
    request: {
      method: req.method, url: req.url, httpVersion: req.httpVersion,
      headers: pairs(req.headers), cookies: cookies(req.cookies), query: pairs(req.queryString),
      post: req.postData ? {
        mime: req.postData.mimeType || '',
        params: pairs(req.postData.params),
        text: cut(req.postData.text),
        size: String(req.postData.text || '').length
      } : null
    },
    response: {
      status: res.status, statusText: res.statusText, httpVersion: res.httpVersion,
      headers: pairs(res.headers), cookies: cookies(res.cookies),
      redirectURL: res.redirectURL || '',
      content: content(res.content || {})
    },
    timings: x.timings || {},
    time: x.time,
    started: x.startedDateTime,
    initiator: initiator(x._initiator),
    ws: Array.isArray(x._webSocketMessages)
      ? x._webSocketMessages.slice(0, 500).map((w) => ({ type: w.type, time: w.time, op: w.opcode, data: cut(w.data, 4096) }))
      : null,
    wsCount: Array.isArray(x._webSocketMessages) ? x._webSocketMessages.length : 0
  };
}

function pairs(list) {
  return Array.isArray(list) ? list.filter(Boolean).map((h) => ({ name: String(h.name), value: h.value == null ? '' : String(h.value) })) : [];
}
function cookies(list) {
  return Array.isArray(list) ? list.filter(Boolean).map((c) => ({
    name: String(c.name), value: c.value == null ? '' : String(c.value),
    path: c.path || '', domain: c.domain || '', expires: c.expires || '',
    httpOnly: !!c.httpOnly, secure: !!c.secure, sameSite: c.sameSite || ''
  })) : [];
}
function cut(s, max) {
  if (s == null) return null;
  s = String(s);
  max = max || SHOW_MAX;
  return s.length > max ? { text: s.slice(0, max), cut: s.length } : { text: s, cut: 0 };
}

function content(c) {
  const mime = String(c.mimeType || '').split(';')[0].trim().toLowerCase();
  const out = { mime, size: c.size, compression: c.compression, encoding: c.encoding || '', text: null, image: null, note: '' };
  if (c.text == null || c.text === '') {
    out.note = c.comment || '';
    return out;
  }
  if (c.encoding === 'base64') {
    if (/^image\//.test(mime) && c.text.length < 8 * 1024 * 1024) { out.image = 'data:' + mime + ';base64,' + c.text; return out; }
    if (textual(mime)) {
      try { out.text = cut(decode64(c.text)); } catch (e) { out.note = 'The body is base64 that does not decode'; }
      return out;
    }
    out.note = 'Binary, ' + mime;
    return out;
  }
  out.text = cut(c.text);
  return out;
}

function textual(mime) {
  return /^text\/|json|xml|javascript|ecmascript|css|html|svg|graphql|x-www-form-urlencoded|event-stream|csv|yaml/.test(mime) || !mime;
}
function decode64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  return new TextDecoder().decode(bytes);
}

/* the chain that made the request: a parser line, or a script's stack */
function initiator(ini) {
  if (!ini || typeof ini !== 'object') return null;
  const out = { type: ini.type || '', url: ini.url || '', line: ini.lineNumber, frames: [] };
  let st = ini.stack;
  while (st && out.frames.length < 30) {
    (st.callFrames || []).forEach((f) => {
      if (out.frames.length < 30) out.frames.push({ fn: f.functionName || '', url: f.url || '', line: f.lineNumber });
    });
    st = st.parent;
  }
  if (!out.url && out.frames.length) out.url = out.frames[0].url;
  return out;
}

function body(i, which) {
  const x = entries[i];
  if (!x) throw new Error('No such request');
  if (which === 'request') return { text: x.request && x.request.postData ? String(x.request.postData.text || '') : '' };
  const c = (x.response && x.response.content) || {};
  const mime = String(c.mimeType || '').split(';')[0].trim().toLowerCase();
  let text = c.text == null ? '' : String(c.text);
  if (c.encoding === 'base64' && textual(mime)) { try { text = decode64(text); } catch (e) {} }
  return { text, mime, base64: c.encoding === 'base64' && !textual(mime) };
}

/* ==========================================================================
   Secrets. What a HAR carries that should not travel with it: the login a
   request was made with (cookies, Authorization, API keys), tokens in URLs,
   and passwords and tokens in the bodies. A name decides for headers,
   parameters and JSON keys; a shape decides for a value anywhere (a JWT,
   or a key with a known prefix).
   ========================================================================== */
const SECRET_HEADERS = new Set([
  'authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'api-key', 'apikey',
  'x-auth-token', 'x-access-token', 'x-refresh-token', 'x-csrf-token', 'x-xsrf-token', 'csrf-token',
  'x-amz-security-token', 'x-goog-api-key', 'x-session-token', 'x-session-id', 'x-client-secret',
  'private-token', 'x-vault-token', 'x-auth', 'x-token', 'x-firebase-appcheck', 'x-goog-iap-jwt-assertion'
]);
/* a parameter or key, lowercased with - _ . dropped, that ends in one of these */
const SECRET_ENDS = ['token', 'secret', 'password', 'passwd', 'apikey', 'signature', 'sessionid', 'credential',
                     'credentials', 'authorization', 'privatekey', 'clientsecret', 'jwt'];
/* ...or is exactly one of these; in a URL a few short names count as well */
const SECRET_KEYS = new Set(['pwd', 'pass', 'secret', 'session', 'cookie', 'otp', 'cvv', 'cvc', 'cardnumber', 'ssn']);
const SECRET_URL_KEYS = new Set(['key', 'sig', 'sid', 'code', 'auth', 'state', 'ticket']);
const TOKEN_RE = /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*|\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{30,}|\bya29\.[0-9A-Za-z_-]{20,}/g;

function secretName(name, inUrl) {
  const k = String(name).toLowerCase().replace(/[-_.\s[\]]/g, '');
  if (!k) return false;
  if (SECRET_KEYS.has(k) || (inUrl && SECRET_URL_KEYS.has(k))) return true;
  return SECRET_ENDS.some((end) => k.endsWith(end));
}
function secretHeader(name) {
  const n = String(name).toLowerCase();
  return SECRET_HEADERS.has(n) || (/^x-/.test(n) && secretName(n.slice(2)));
}
/* a value worth hiding: not empty, not a word like "true" */
function worth(v) {
  return typeof v === 'string' ? v.length >= 4 && !/^(true|false|null|undefined|none)$/i.test(v) : false;
}

/* one secret counts once in a request, wherever in it it shows */
let seen = new Set();
function add(i, kind, where, name, value) {
  value = String(value);
  if (!value || value.includes(R)) return;
  const key = i + '\u0000' + value;
  if (seen.has(key)) return;
  seen.add(key);
  found.push({ i, kind, where, name, value });
}

function scanEntry(x, i) {
  if (!x) return;
  const req = x.request || {};
  const res = x.response || {};
  scanUrl(i, 'URL', req.url);
  scanHeaders(i, 'Request header', req.headers);
  scanHeaders(i, 'Response header', res.headers);
  (req.cookies || []).forEach((c) => { if (c && worth(String(c.value))) add(i, 'cookie', 'Request cookie', c.name, c.value); });
  (res.cookies || []).forEach((c) => { if (c && worth(String(c.value))) add(i, 'cookie', 'Response cookie', c.name, c.value); });
  if (res.redirectURL) scanUrl(i, 'Redirect', res.redirectURL);
  if (req.postData) {
    (req.postData.params || []).forEach((p) => {
      if (p && secretName(p.name) && worth(String(p.value))) add(i, 'body', 'Request body', p.name, p.value);
    });
    scanText(i, 'Request body', req.postData.text, req.postData.mimeType);
  }
  const c = res.content || {};
  if (c.text && c.encoding !== 'base64') scanText(i, 'Response body', c.text, c.mimeType);
  (x._webSocketMessages || []).forEach((w) => { if (w && typeof w.data === 'string') scanText(i, 'WebSocket message', w.data, ''); });
}

function scanHeaders(i, where, headers) {
  (headers || []).forEach((h) => {
    if (!h) return;
    const v = String(h.value == null ? '' : h.value);
    const n = String(h.name).toLowerCase();
    if (secretHeader(n)) {
      if (!worth(v)) return;
      /* a cookie header holds several; each is named, so each can be seen */
      if (n === 'cookie') {
        v.split(/;\s*/).forEach((part) => {
          const eq = part.indexOf('=');
          if (eq > 0 && worth(part.slice(eq + 1))) add(i, 'cookie', where, part.slice(0, eq), part.slice(eq + 1));
        });
      } else if (n === 'set-cookie') {
        v.split('\n').forEach((line) => {
          const first = line.split(';')[0];
          const eq = first.indexOf('=');
          if (eq > 0 && worth(first.slice(eq + 1))) add(i, 'cookie', where, first.slice(0, eq).trim(), first.slice(eq + 1));
        });
      } else {
        add(i, 'header', where, h.name, v);
      }
      return;
    }
    if (n === ':path') scanUrl(i, where + ' ' + h.name, 'https://h' + v);
    else if (/^(referer|location|origin|content-location|link)$/.test(n)) scanUrl(i, where + ' ' + h.name, v);
    else scanTokens(i, 'header', where, h.name, v);
  });
}

function scanUrl(i, where, url) {
  if (!url) return;
  url = String(url);
  let u;
  try { u = new URL(url); } catch (e) { scanTokens(i, 'url', where, where, url); return; }
  if (u.password) add(i, 'url', where, 'password in the address', u.password);
  u.searchParams.forEach((v, k) => {
    if (secretName(k, true) && worth(v)) add(i, 'url', where, k, v);
    else scanTokens(i, 'url', where, k, v);
  });
  /* tokens in a path or a fragment: /reset/eyJ…, #access_token=… */
  if (u.hash) {
    new URLSearchParams(u.hash.slice(1)).forEach((v, k) => {
      if (secretName(k, true) && worth(v)) add(i, 'url', where, k, v);
    });
  }
  scanTokens(i, 'url', where, 'in the path', u.pathname);
}

function scanTokens(i, kind, where, name, s) {
  if (typeof s !== 'string' || s.length < 20) return;
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(s))) add(i, kind, where, name, m[0]);
}

function scanText(i, where, text, mime) {
  if (typeof text !== 'string' || !text) return;
  const t = text.trimStart();
  if ((t[0] === '{' || t[0] === '[') && text.length < 32 * 1024 * 1024) {
    try { walk(JSON.parse(text), (k, v) => { if (secretName(k) && worth(v)) add(i, 'body', where, k, v); }); } catch (e) {}
  } else if (/x-www-form-urlencoded/.test(mime || '') || /^[\w.%-]+=[^&\s]*(&[\w.%-]+=[^&\s]*)+$/.test(t.slice(0, 2000))) {
    try {
      new URLSearchParams(t).forEach((v, k) => { if (secretName(k) && worth(v)) add(i, 'body', where, k, v); });
    } catch (e) {}
  }
  scanTokens(i, 'body', where, 'token', text);
}

/* every key and string value of a JSON value, depth first */
function walk(v, fn) {
  if (Array.isArray(v)) v.forEach((x) => walk(x, fn));
  else if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      const x = v[k];
      if (typeof x === 'string') fn(k, x);
      else if (typeof x === 'number' && secretName(k) && String(x).length >= 4) fn(k, String(x));
      else walk(x, fn);
    }
  }
}

let vids = new Map();
function vid(value) {
  if (!vids.has(value)) vids.set(value, vids.size);
  return vids.get(value);
}

function mask(v) {
  v = String(v);
  if (v.length <= 8) return '•'.repeat(Math.max(4, v.length));
  return v.slice(0, 4) + '•••' + v.slice(-2) + '  (' + v.length + ' chars)';
}

/* ==========================================================================
   The same file, without them. Each place a secret was found by name is
   redacted where it stands; then every secret value still anywhere in the
   text (a cookie echoed in a body, a token in a stack's URL) is replaced
   too. The result is checked: none of the values may be left.
   ========================================================================== */
const R = '[redacted]';

function redact() {
  if (!har) throw new Error('No file is open');
  const values = [...new Set(found.map((f) => f.value).filter((v) => v.length >= 6))];
  const forms = new Set();
  values.forEach((v) => {
    forms.add(JSON.stringify(v).slice(1, -1));
    try { const enc = encodeURIComponent(v); if (enc !== v) forms.add(enc); } catch (e) {}
  });
  const sweep = forms.size
    ? new RegExp([...forms].sort((a, b) => b.length - a.length).map(reEsc).join('|'), 'g')
    : null;
  const clean = (s) => sweep ? s.replace(sweep, R) : s;

  const { entries: _, ...rest } = har.log;
  const pages = (rest.pages || []).map((p) => p && p.title ? { ...p, title: redactUrl(String(p.title)) } : p);
  const MARK = '\u0000entries';
  const PLACE = JSON.stringify(MARK);
  const shell = clean(JSON.stringify({ ...har, log: { ...rest, ...(rest.pages ? { pages } : {}), entries: MARK } }, null, 2));
  const parts = entries.map((x) => clean(JSON.stringify(redactEntry(x), null, 2)).replace(/\n/g, '\n      '));
  const at = shell.indexOf(PLACE);
  const text = shell.slice(0, at) + (parts.length ? '[\n      ' + parts.join(',\n      ') + '\n    ]' : '[]') +
    shell.slice(at + PLACE.length) + '\n';

  /* the check: parse it back, and look for every value */
  JSON.parse(text);
  const left = values.filter((v) => text.includes(JSON.stringify(v).slice(1, -1)));
  return { text, redacted: found.length, left: left.length };
}

function reEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function redactEntry(x) {
  if (!x) return x;
  const req = x.request || {};
  const res = x.response || {};
  const out = { ...x };
  out.request = {
    ...req,
    url: redactUrl(req.url),
    headers: redactHeaders(req.headers),
    cookies: (req.cookies || []).map((c) => ({ ...c, value: R })),
    queryString: (req.queryString || []).map((q) => q && secretName(q.name, true) && worth(String(q.value))
      ? { ...q, value: R } : q && { ...q, value: redactTokens(String(q.value == null ? '' : q.value)) })
  };
  if (req.postData) {
    out.request.postData = {
      ...req.postData,
      params: req.postData.params && req.postData.params.map((p) => p && secretName(p.name) && worth(String(p.value)) ? { ...p, value: R } : p),
      text: redactText(req.postData.text, req.postData.mimeType)
    };
  }
  out.response = {
    ...res,
    headers: redactHeaders(res.headers),
    cookies: (res.cookies || []).map((c) => ({ ...c, value: R })),
    redirectURL: res.redirectURL ? redactUrl(res.redirectURL) : res.redirectURL
  };
  if (res.content && res.content.text && res.content.encoding !== 'base64') {
    out.response.content = { ...res.content, text: redactText(res.content.text, res.content.mimeType) };
  }
  if (Array.isArray(x._webSocketMessages)) {
    out._webSocketMessages = x._webSocketMessages.map((w) => w && typeof w.data === 'string' ? { ...w, data: redactText(w.data, '') } : w);
  }
  return out;
}

function redactHeaders(headers) {
  return (headers || []).map((h) => {
    if (!h) return h;
    const n = String(h.name).toLowerCase();
    const v = String(h.value == null ? '' : h.value);
    if (n === 'cookie') return { ...h, value: v.split(/;\s*/).map((p) => p.replace(/=.*/, '=' + R)).join('; ') };
    if (n === 'set-cookie') return { ...h, value: v.split('\n').map((l) => l.replace(/^([^=;]*=)[^;]*/, '$1' + R)).join('\n') };
    if (secretHeader(n)) {
      /* keep the scheme, so "Bearer [redacted]" still says what was there */
      const m = /^(Bearer|Basic|Token|Digest|Negotiate|NTLM|AWS4-HMAC-SHA256|OAuth)\s+/i.exec(v);
      return { ...h, value: m ? m[0] + R : R };
    }
    if (n === ':path') return { ...h, value: redactUrl('https://h' + v).slice('https://h'.length) };
    if (/^(referer|location|origin|content-location|link)$/.test(n)) return { ...h, value: redactUrl(v) };
    return { ...h, value: redactTokens(v) };
  });
}

function redactUrl(url) {
  if (!url) return url;
  url = String(url);
  let u;
  try { u = new URL(url); } catch (e) { return redactTokens(url); }
  if (u.password) u.password = 'redacted';
  /* the query is rebuilt by hand: URLSearchParams would re-encode the parts
     that were not touched, and the file should change only where it must */
  const q = u.search.slice(1);
  if (q) {
    u.search = '?' + q.split('&').map((part) => {
      const eq = part.indexOf('=');
      if (eq < 0) return part;
      let k = part.slice(0, eq), v = part.slice(eq + 1), dk = k, dv = v;
      try { dk = decodeURIComponent(k.replace(/\+/g, ' ')); dv = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) {}
      if (secretName(dk, true) && worth(dv)) return k + '=' + encodeURIComponent(R);
      return k + '=' + redactTokens(v);
    }).join('&');
  }
  if (u.hash && /=/.test(u.hash)) {
    u.hash = '#' + u.hash.slice(1).split('&').map((part) => {
      const eq = part.indexOf('=');
      if (eq < 0) return part;
      return secretName(part.slice(0, eq), true) ? part.slice(0, eq + 1) + encodeURIComponent(R) : part;
    }).join('&');
  }
  u.pathname = redactTokens(u.pathname);
  return u.href;
}

function redactTokens(s) {
  if (typeof s !== 'string' || s.length < 20) return s;
  TOKEN_RE.lastIndex = 0;
  return s.replace(TOKEN_RE, R);
}

function redactText(text, mime) {
  if (typeof text !== 'string' || !text) return text;
  const t = text.trimStart();
  if ((t[0] === '{' || t[0] === '[') && text.length < 32 * 1024 * 1024) {
    try {
      const v = JSON.parse(text);
      const pretty = /^\s*[{[]\s*\n/.test(text);
      return redactTokens(JSON.stringify(redactJson(v), null, pretty ? 2 : 0));
    } catch (e) {}
  }
  if (/x-www-form-urlencoded/.test(mime || '') || /^[\w.%-]+=[^&\s]*(&[\w.%-]+=[^&\s]*)+$/.test(t.slice(0, 2000))) {
    return redactTokens(text.split('&').map((part) => {
      const eq = part.indexOf('=');
      if (eq < 0) return part;
      let dk = part.slice(0, eq), dv = part.slice(eq + 1);
      try { dk = decodeURIComponent(dk.replace(/\+/g, ' ')); dv = decodeURIComponent(dv.replace(/\+/g, ' ')); } catch (e) {}
      return secretName(dk) && worth(dv) ? part.slice(0, eq + 1) + encodeURIComponent(R) : part;
    }).join('&'));
  }
  return redactTokens(text);
}

function redactJson(v) {
  if (Array.isArray(v)) return v.map(redactJson);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) {
      const x = v[k];
      if (typeof x === 'string' && secretName(k) && worth(x)) o[k] = R;
      else if (typeof x === 'number' && secretName(k) && String(x).length >= 4) o[k] = R;
      else o[k] = redactJson(x);
    }
    return o;
  }
  return v;
}
