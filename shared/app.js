/* ==========================================================================
   lint.one — shared runtime
   Every tool calls LintApp.init() with format-specific hooks; everything
   below (themes, tree, search, editor, file I/O, clipboard) is generic.
   ========================================================================== */
(function (global) {
'use strict';

/* ---------- theme registry — mirrors the blocks in theme.css ---------- */
var THEMES = [
  { id: '',          name: 'System',   bg: 'var(--surface)', fg: 'var(--hue)' },
  { id: 'daylight',  name: 'Daylight', bg: '#FBFBFC',        fg: '#1A1D23' },
  { id: 'slate',     name: 'Slate',    bg: '#1B1E25',        fg: '#82B5F0' },
  { id: 'paper',     name: 'Paper',    bg: '#F5F1E8',        fg: '#8A6114' },
  { id: 'midnight',  name: 'Midnight', bg: '#08090B',        fg: '#4FD68F' },
  { id: 'contrast',  name: 'Contrast', bg: '#FFFFFF',        fg: '#000000' }
];

/* The theme is remembered in a cookie rather than localStorage. Both work now
   that every tool shares one origin, but the cookie is kept: it survives a
   move back to separate hosts, and it is what the pages already read. */
var THEME_COOKIE = 'lintuz_theme';
var THEME_LS = 'lintuz-theme';

function readTheme() {
  var m = document.cookie.match(/(?:^|;\s*)lintuz_theme=([^;]*)/);
  if (m) return decodeURIComponent(m[1]);
  try { return localStorage.getItem(THEME_LS) || ''; } catch (e) { return ''; }
}

function writeTheme(id) {
  var host = location.hostname;
  /* one origin now, so the cookie needs no domain attribute */
  var domain = '';
  var secure = location.protocol === 'https:' ? '; secure' : '';
  try {
    document.cookie = THEME_COOKIE + '=' + encodeURIComponent(id) +
      '; path=/; max-age=31536000; samesite=lax' + domain + secure;
  } catch (e) {}
  try { localStorage.setItem(THEME_LS, id); } catch (e) {}
}

function applyTheme(id) {
  if (id) document.documentElement.setAttribute('data-theme', id);
  else document.documentElement.removeAttribute('data-theme');
}

/* Apply before first paint to avoid a flash of the wrong theme. */
applyTheme(readTheme());

/* ---------- the four tools, for the suite switcher ---------- */
/* Paths on one domain rather than a subdomain each: a search engine pools a
   site's authority across its paths, but treats subdomains as separate sites
   and splits it. Relative hrefs also keep local development working. */
var SUITE = [
  { id: 'json', name: 'JSON', host: '/json' },
  { id: 'xml',  name: 'XML',  host: '/xml'  },
  { id: 'yaml', name: 'YAML', host: '/yaml' },
  { id: 'csv',  name: 'CSV',  host: '/csv'  },
  { id: 'pdf',  name: 'PDF',  host: '/pdf'  },
  { id: 'log',  name: 'Log',  host: '/log'  },
  { id: 'audio', name: 'Audio', host: '/audio' }
];

/* ---------- small helpers ---------- */
var $ = function (id) { return document.getElementById(id); };

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}

function fmtNum(n) { return n.toLocaleString('en-US'); }

function svg(paths, size) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true">' + paths + '</svg>';
}

var ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  expand: '<path d="M12 5v14M5 12h14"/>',
  collapse: '<path d="M5 12h14"/>',
  wrap: '<path d="M3 6h18M3 12h13a3 3 0 0 1 0 6h-4m0 0 2.5-2.5M12 18l2.5 2.5M3 18h5"/>',
  theme: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18" fill="currentColor" stroke="none"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  filter: '<path d="M4 5h16l-6.2 7.4V19l-3.6 1.6v-8.2z"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  more: '<circle cx="12" cy="5" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/>'
};

/* ---------- clipboard ---------- */
var toastTimer;

/* showToast(msg) — plain message.
   showToast(msg, {label, href, from}) — adds one action. The toast only
   accepts pointer events while an action is present, so a plain toast never
   sits in front of the page. */
function showToast(msg, action) {
  var t = $('toast');
  if (!t) return;
  t.textContent = '';
  t.classList.toggle('actionable', !!action);

  var text = document.createElement('span');
  text.textContent = msg;
  t.appendChild(text);

  var life = 1700;
  if (action) {
    var a = document.createElement('a');
    a.className = 'toast-action';
    a.innerHTML = esc(action.label) + '<kbd class="kb">\u21B5</kbd>';
    a.href = action.href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.addEventListener('click', function () {
      /* tell the destination which tool sent the user, so it can name the
         format in its prompt. Carries no document data. */
      if (action.from) writeHandoff(action.from, action.format);
      t.classList.remove('show');
    });
    t.appendChild(a);
    life = 7000;   /* long enough to actually reach for it */

    /* Enter follows the offer while the toast is up. Bound only for this
       toast's lifetime, so Enter never does anything surprising afterwards.
       The editor holds focus permanently, so we cannot simply skip when a
       textarea is focused — instead the first edit or caret move cancels the
       binding, which is the real signal that the user went back to work. */
    var onKey = function (e) {
      if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      e.preventDefault();
      a.click();
      window.open(a.href, '_blank', 'noopener');
      detach();
    };
    var cancel = function () { detach(); };
    var detach = function () {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('input', cancel, true);
      document.removeEventListener('mousedown', cancel, true);
      clearTimeout(t._keyTimer);
    };
    document.addEventListener('keydown', onKey, true);
    /* typing anywhere, or clicking into the page, means they have moved on */
    document.addEventListener('input', cancel, true);
    document.addEventListener('mousedown', cancel, true);
    t._keyTimer = setTimeout(detach, life);
    t._detach = detach;
  } else if (t._detach) {
    t._detach();
    t._detach = null;
  }

  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove('show'); }, life);
}

/* ---------- cross-tool handoff ----------
   A short-lived cookie naming the tool the user just left, so the
   destination can say "your JSON from YAML is on the clipboard" instead of a
   generic hint. The document itself never leaves the clipboard. */
var HANDOFF_COOKIE = 'lintuz_from';

function writeHandoff(fromId, format) {
  var domain = '';
  var secure = location.protocol === 'https:' ? '; secure' : '';
  try {
    document.cookie = HANDOFF_COOKIE + '=' +
      encodeURIComponent(fromId + ':' + (format || '')) +
      '; path=/; max-age=120; samesite=lax' + domain + secure;
  } catch (e) {}
}

function readHandoff() {
  var m = document.cookie.match(/(?:^|;\s*)lintuz_from=([^;]*)/);
  if (!m) return null;
  var parts = decodeURIComponent(m[1]).split(':');
  var id = parts[0], format = parts[1] || '';
  /* one-shot: clear it so a later visit does not show a stale prompt */
  var domain = '';
  try {
    document.cookie = HANDOFF_COOKIE + '=; path=/; max-age=0' + domain;
  } catch (e) {}
  for (var i = 0; i < SUITE.length; i++) {
    if (SUITE[i].id === id) {
      return { id: id, name: SUITE[i].name, host: SUITE[i].host, format: format };
    }
  }
  return null;
}

function copyText(text, label) {
  var done = function () { showToast(label + ' copied'); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
  } else fallbackCopy(text, done);
}

function fallbackCopy(text, done) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); }
  catch (e) { showToast('Copy failed'); }
  ta.remove();
}

function highlightInto(el, text, q) {
  if (!q) { el.appendChild(document.createTextNode(text)); return; }
  var lower = text.toLowerCase(), i = 0, idx;
  while ((idx = lower.indexOf(q, i)) !== -1) {
    if (idx > i) el.appendChild(document.createTextNode(text.slice(i, idx)));
    var m = document.createElement('mark');
    m.textContent = text.slice(idx, idx + q.length);
    el.appendChild(m);
    i = idx + q.length;
  }
  if (i < text.length) el.appendChild(document.createTextNode(text.slice(i)));
}

/* ---------- menus ---------- */
function closeAllMenus(except) {
  var menus = document.querySelectorAll('.menu.open');
  for (var i = 0; i < menus.length; i++) {
    if (menus[i] !== except) {
      menus[i].classList.remove('open');
      var btn = menus[i].parentElement.querySelector('[aria-expanded]');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
  }
}

function wireMenu(btn, menu) {
  btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    var open = menu.classList.contains('open');
    closeAllMenus();
    if (!open) {
      menu.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
    }
  });
  menu.addEventListener('click', function (e) { e.stopPropagation(); });
}

document.addEventListener('click', function () { closeAllMenus(); });
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeAllMenus();
});

/* ==========================================================================
   Chrome construction — toolbar menus shared by all tools
   ========================================================================== */
function buildThemeMenu(container) {
  var wrap = document.createElement('div');
  wrap.className = 'menu-wrap';

  var btn = document.createElement('button');
  btn.className = 'icon-btn';
  btn.title = 'Theme';
  btn.setAttribute('aria-label', 'Choose theme');
  btn.setAttribute('aria-haspopup', 'true');
  btn.innerHTML = svg(ICONS.theme);

  var menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  var label = document.createElement('div');
  label.className = 'menu-label';
  label.textContent = 'Theme';
  menu.appendChild(label);

  var current = readTheme();
  THEMES.forEach(function (t) {
    var item = document.createElement('button');
    item.className = 'menu-item';
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', String(t.id === current));
    item.innerHTML =
      '<span class="swatch" style="--sw-bg:' + t.bg + ';--sw-fg:' + t.fg + '"></span>' +
      '<span>' + t.name + '</span><span class="tick">✓</span>';
    item.addEventListener('click', function () {
      applyTheme(t.id);
      writeTheme(t.id);
      var items = menu.querySelectorAll('.menu-item');
      for (var i = 0; i < items.length; i++) items[i].setAttribute('aria-checked', 'false');
      item.setAttribute('aria-checked', 'true');
      closeAllMenus();
      showToast(t.name + ' theme');
    });
    menu.appendChild(item);
  });

  wrap.appendChild(btn);
  wrap.appendChild(menu);
  container.appendChild(wrap);
  wireMenu(btn, menu);
}

function buildSuiteMenu(container, activeId) {
  var wrap = document.createElement('div');
  wrap.className = 'menu-wrap';

  var btn = document.createElement('button');
  btn.className = 'icon-btn';
  btn.title = 'Other tools';
  btn.setAttribute('aria-label', 'Switch tool');
  btn.setAttribute('aria-haspopup', 'true');
  btn.innerHTML = svg(ICONS.grid);

  var menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  var label = document.createElement('div');
  label.className = 'menu-label';
  label.textContent = 'Tools';
  menu.appendChild(label);

  SUITE.forEach(function (t) {
    var a = document.createElement('a');
    a.className = 'menu-item';
    a.setAttribute('role', 'menuitem');
    a.href = t.host;
    a.innerHTML =
      '<span class="fmt-dot dot-' + t.id + '"></span>' +
      '<span>' + t.name + '</span>' +
      (t.id === activeId
        ? '<span class="tick" style="opacity:1">✓</span>'
        : '<span class="ext">↗</span>');
    if (t.id === activeId) {
      a.setAttribute('aria-current', 'page');
      a.style.fontWeight = '600';
    }
    menu.appendChild(a);
  });

  menu.appendChild(Object.assign(document.createElement('div'), { className: 'menu-sep' }));
  var home = document.createElement('a');
  home.className = 'menu-item';
  home.href = '/';
  home.innerHTML = '<span>All tools</span><span class="ext">↗</span>';
  menu.appendChild(home);

  wrap.appendChild(btn);
  wrap.appendChild(menu);
  container.appendChild(wrap);
  wireMenu(btn, menu);
}


/* ---------- more menu ----------
   The ⋮ every tool ends its toolbar with, just before the suite and theme
   menus. It holds the tool's quieter commands (`items`), and on narrow
   screens also mirrors whatever toolbar actions got hidden — rebuilt on
   resize so it always matches what is actually hidden. */
function buildOverflowMenu(container, items) {
  items = items || [];
  var wrap = document.createElement('div');
  wrap.className = 'menu-wrap';

  var btn = document.createElement('button');
  btn.className = 'icon-btn';
  btn.title = 'More actions';
  btn.setAttribute('aria-label', 'More actions');
  btn.setAttribute('aria-haspopup', 'true');
  btn.innerHTML = svg(ICONS.more);

  var menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');

  items.forEach(function (it) {
    var item = document.createElement('button');
    item.className = 'menu-item';
    item.id = it.id;
    item.setAttribute('role', 'menuitem');
    item.textContent = it.label;
    if (it.title) item.title = it.title;
    item.addEventListener('click', function () { closeAllMenus(); });
    menu.appendChild(item);
  });
  var mirror = document.createElement('div');
  menu.appendChild(mirror);

  wrap.appendChild(btn);
  wrap.appendChild(menu);
  container.insertBefore(wrap, container.firstChild);
  wireMenu(btn, menu);

  function rebuild() {
    mirror.innerHTML = '';
    var hidden = document.querySelectorAll('.toolbar button.hide-sm, .toolbar button.hide-md');
    var added = 0;
    for (var i = 0; i < hidden.length; i++) {
      var src = hidden[i];
      if (src.offsetParent !== null) continue;   /* still visible — skip */
      (function (source) {
        var item = document.createElement('button');
        item.className = 'menu-item';
        item.setAttribute('role', 'menuitem');
        /* the label only — not the shortcut hint rendered after it */
        item.textContent = source.firstChild && source.firstChild.nodeType === 3
          ? source.firstChild.textContent : source.textContent || source.title;
        item.title = source.title || '';
        item.addEventListener('click', function () {
          closeAllMenus();
          source.click();
        });
        if (!added && items.length) {
          mirror.appendChild(Object.assign(document.createElement('div'), { className: 'menu-sep' }));
        }
        mirror.appendChild(item);
      })(src);
      added++;
    }
    wrap.style.display = added || items.length ? '' : 'none';
  }

  rebuild();
  var t;
  window.addEventListener('resize', function () {
    clearTimeout(t);
    t = setTimeout(rebuild, 150);
  });
  return rebuild;
}

/* ==========================================================================
   Editor — gutter, syntax overlay, scroll sync
   ========================================================================== */
function Editor(opts) {
  var input = $('input');
  var highlight = $('highlight');
  var gutter = $('gutterInner');
  var self = this;

  this.input = input;
  this.onChange = opts.onChange;
  this.highlighter = opts.highlighter;
  this._errLine = null;
  this._lineCount = 0;
  this._curLine = 1;

  /* Repaint the syntax layer and the line numbers. Skipped above a size
     ceiling, where re-highlighting on every keystroke costs more than it
     gives — the textarea text becomes visible instead. */
  var HL_CEILING = 300000;

  this.paint = function () {
    var text = input.value;
    var lines = text.split('\n');

    if (text.length > HL_CEILING) {
      highlight.innerHTML = '';
      input.style.webkitTextFillColor = 'var(--ink)';
      input.style.color = 'var(--ink)';
    } else {
      input.style.webkitTextFillColor = '';
      input.style.color = '';
      var html = self.highlighter ? self.highlighter(text) : esc(text);
      /* trailing newline keeps the last line scrollable into view */
      highlight.innerHTML = html + '\n';
    }
    self.paintGutter(lines.length);
    self.syncScroll();
  };

  this.paintGutter = function (count) {
    if (count === self._lineCount && self._paintedErr === self._errLine &&
        self._paintedCur === self._curLine) return;
    self._lineCount = count;
    self._paintedErr = self._errLine;
    self._paintedCur = self._curLine;
    var out = '';
    for (var i = 1; i <= count; i++) {
      var cls = 'ln';
      if (i === self._errLine) cls += ' err';
      else if (i === self._curLine) cls += ' cur';
      out += '<span class="' + cls + '">' + i + '</span>';
    }
    gutter.innerHTML = out;
  };

  this.setErrorLine = function (line) {
    self._errLine = line;
    self.paintGutter(self._lineCount);
  };

  this.syncScroll = function () {
    highlight.scrollTop = input.scrollTop;
    highlight.scrollLeft = input.scrollLeft;
    gutter.style.transform = 'translateY(' + (-input.scrollTop) + 'px)';
  };

  this.trackCaret = function () {
    var upto = input.value.slice(0, input.selectionStart);
    var line = upto.split('\n').length;
    if (line !== self._curLine) {
      self._curLine = line;
      self.paintGutter(self._lineCount);
    }
  };

  this.setValue = function (text) {
    input.value = text;
    self.paint();
    if (self.onChange) self.onChange();
  };

  this.getValue = function () { return input.value; };

  this.jumpTo = function (pos) {
    input.focus();
    input.setSelectionRange(pos, Math.min(pos + 1, input.value.length));
    var lines = input.value.slice(0, pos).split('\n').length;
    var lh = parseFloat(getComputedStyle(input).lineHeight) || 21;
    input.scrollTop = Math.max(0, (lines - 5) * lh);
    self.syncScroll();
    self.trackCaret();
  };

  input.addEventListener('scroll', this.syncScroll, { passive: true });
  input.addEventListener('input', function () {
    self.paint();
    self.trackCaret();
    if (self.onChange) self.onChange();
  });
  ['keyup', 'click', 'focus'].forEach(function (ev) {
    input.addEventListener(ev, self.trackCaret);
  });

  /* Tab inserts two spaces; Shift+Tab outdents. */
  input.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    var start = input.selectionStart, end = input.selectionEnd;
    if (e.shiftKey) {
      var ls = input.value.lastIndexOf('\n', start - 1) + 1;
      if (input.value.slice(ls, ls + 2) === '  ') {
        input.value = input.value.slice(0, ls) + input.value.slice(ls + 2);
        input.selectionStart = Math.max(ls, start - 2);
        input.selectionEnd = Math.max(ls, end - 2);
      }
    } else {
      input.value = input.value.slice(0, start) + '  ' + input.value.slice(end);
      input.selectionStart = input.selectionEnd = start + 2;
    }
    self.paint();
    self.trackCaret();
    if (self.onChange) self.onChange();
  });
}

/* ==========================================================================
   Tree — generic renderer over a {key, value} model
   ========================================================================== */
var CHUNK = 100;
var ROW_BUDGET = 4000;
var STR_TRUNC = 200;

function Tree(opts) {
  var el = $('tree');
  var searchBox = $('search');
  var matchCount = $('matchCount');
  var pathBox = $('pathBox');
  var self = this;

  var adapter = opts.adapter;     // format-specific node access
  var emptyHTML = opts.emptyHTML;
  var autoDepth = opts.autoDepth || 3;

  var info = new WeakMap();
  var chains = new WeakMap();     // row -> child indices leading to it from the root
  var selected = null;
  var root = null;
  this.hasData = false;

  this.setData = function (value, has) {
    root = value;
    self.hasData = has;
    self.render();
  };

  this.query = function () { return searchBox.value.trim().toLowerCase(); };

  this.render = function () {
    el.innerHTML = '';
    el.classList.remove('stale');
    selected = null;
    pathBox.textContent = '';
    if (!self.hasData) {
      el.innerHTML = emptyHTML;
      matchCount.textContent = '';
      return;
    }
    var q = self.query();
    hits = []; hitIdx = -1;
    stepNav.hidden = true;
    if (q && !stepMode) { renderFiltered(q); return; }
    matchCount.textContent = '';
    var node = makeNode(adapter.rootEntry(root), q, []);
    el.appendChild(node);
    autoExpand(node, autoDepth);
    if (q) {
      collectHits(q);
      stepNav.hidden = !hits.length;
      if (hits.length) gotoHit(0);
      else matchCount.textContent = 'no matches';
    }
  };

  this.markStale = function () { el.classList.add('stale'); };

  function makeNode(entry, q, chain) {
    var node = document.createElement('div');
    node.className = 'node';
    var row = document.createElement('div');
    row.className = 'row';
    row.tabIndex = 0;
    info.set(row, entry);
    chains.set(row, chain);

    var kids = adapter.childCount(entry);
    var caret = document.createElement('span');
    caret.className = 'caret' + (kids > 0 ? '' : ' leaf');
    row.appendChild(caret);

    adapter.decorate(row, entry, q, { highlightInto: highlightInto, STR_TRUNC: STR_TRUNC });

    var actions = document.createElement('span');
    actions.className = 'row-actions';
    adapter.actions(entry).forEach(function (a) {
      var b = document.createElement('button');
      b.textContent = a.label;
      b.title = a.title;
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        copyText(a.get(), a.toastLabel || a.label);
      });
      actions.appendChild(b);
    });
    row.appendChild(actions);

    node.appendChild(row);
    return node;
  }

  function renderChildren(node, entry, q, from) {
    var box = node.querySelector(':scope > .children');
    if (!box) {
      box = document.createElement('div');
      box.className = 'children';
      node.appendChild(box);
    }
    var entries = adapter.children(entry);
    var chain = chains.get(node.querySelector(':scope > .row')) || [];
    var start = from || 0;
    var end = Math.min(start + CHUNK, entries.length);
    for (var i = start; i < end; i++) box.appendChild(makeNode(entries[i], q, chain.concat([i])));
    if (end < entries.length) {
      var more = document.createElement('button');
      more.className = 'more-btn';
      var next = Math.min(CHUNK, entries.length - end);
      more.textContent = 'Show ' + next + ' more · ' + (entries.length - end) + ' left';
      more.addEventListener('click', function () {
        more.remove();
        renderChildren(node, entry, q, end);
      });
      box.appendChild(more);
    }
    node.dataset.loaded = '1';
  }

  function toggle(node, force) {
    var row = node.querySelector(':scope > .row');
    var entry = info.get(row);
    if (!entry || adapter.childCount(entry) === 0) return;
    var open = force !== undefined ? force : !node.classList.contains('open');
    if (open && !node.dataset.loaded) renderChildren(node, entry, self.query());
    node.classList.toggle('open', open);
  }
  this.toggle = toggle;

  function autoExpand(node, levels) {
    if (levels <= 0) return;
    toggle(node, true);
    var box = node.querySelector(':scope > .children');
    if (!box) return;
    for (var i = 0; i < box.children.length; i++) {
      var c = box.children[i];
      if (c.classList && c.classList.contains('node')) autoExpand(c, levels - 1);
    }
  }

  function renderFiltered(q) {
    var matches = 0, rendered = 0, clipped = false;

    function build(entry, chain) {
      if (rendered > ROW_BUDGET) { clipped = true; return null; }
      var selfMatch = adapter.matches(entry, q);
      var kids = [];
      var children = adapter.children(entry);
      for (var i = 0; i < children.length; i++) {
        var c = build(children[i], chain.concat([i]));
        if (c) kids.push(c);
      }
      if (!selfMatch && kids.length === 0) return null;
      if (selfMatch) matches++;
      rendered++;
      var node = makeNode(entry, q, chain);
      if (kids.length) {
        var box = document.createElement('div');
        box.className = 'children';
        for (var j = 0; j < kids.length; j++) box.appendChild(kids[j]);
        node.appendChild(box);
        node.dataset.loaded = '1';
        node.classList.add('open');
      }
      return node;
    }

    var node = build(adapter.rootEntry(root), []);
    if (node) el.appendChild(node);
    else el.innerHTML = '<div class="empty">No matches for “' + esc(q) + '”.</div>';
    matchCount.textContent = matches
      ? matches + (clipped ? '+' : '') + ' match' + (matches === 1 ? '' : 'es')
      : 'no matches';
    if (clipped) {
      var n = document.createElement('div');
      n.className = 'notice';
      n.textContent = 'Stopped at ' + fmtNum(ROW_BUDGET) + ' rows — narrow the search.';
      el.appendChild(n);
    }
  }

  /* ---------- stepping through matches in the full tree ----------
     The other way to search: nothing is hidden, and each match is opened
     and scrolled to in turn — for when the surroundings matter as much as
     the match. Matches are held as child-index chains, so reaching one
     only renders the branches on the way to it. */
  var MODE_KEY = 'lintuz-search-mode';
  var HIT_CAP = 10000;
  var stepMode = false;
  try { stepMode = localStorage.getItem(MODE_KEY) === 'step'; } catch (e) {}
  var hits = [], hitIdx = -1, hitsClipped = false;
  var stepNav = $('stepNav');
  var btnMode = $('btnSearchMode');

  function collectHits(q) {
    hitsClipped = false;
    (function walk(entry, chain) {
      if (hits.length >= HIT_CAP) { hitsClipped = true; return; }
      if (adapter.matches(entry, q)) hits.push(chain);
      var kids = adapter.children(entry);
      for (var i = 0; i < kids.length; i++) walk(kids[i], chain.concat([i]));
    })(adapter.rootEntry(root), []);
  }

  /* open every branch on the way to a node and return its row */
  function reveal(chain) {
    var node = el.querySelector(':scope > .node');
    for (var d = 0; node && d < chain.length; d++) {
      toggle(node, true);
      var box = node.querySelector(':scope > .children');
      if (!box) return null;
      var more;
      while (box.querySelectorAll(':scope > .node').length <= chain[d] &&
             (more = box.querySelector(':scope > .more-btn'))) more.click();
      node = box.children[chain[d]];
    }
    return node ? node.querySelector(':scope > .row') : null;
  }

  function gotoHit(i) {
    if (!hits.length) return;
    hitIdx = (i + hits.length) % hits.length;
    var prev = el.querySelector('.row.current-hit');
    if (prev) prev.classList.remove('current-hit');
    var row = reveal(hits[hitIdx]);
    if (row) {
      row.classList.add('current-hit');
      selectRow(row);
      row.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
    matchCount.textContent = (hitIdx + 1) + ' / ' + fmtNum(hits.length) + (hitsClipped ? '+' : '');
  }

  function setMode(step) {
    stepMode = step;
    btnMode.setAttribute('aria-pressed', String(!step));
    btnMode.title = step
      ? 'Showing the full tree — click to show only the matches'
      : 'Showing only the matches — click to step through them in the full tree';
    btnMode.setAttribute('aria-label', btnMode.title);
    try { localStorage.setItem(MODE_KEY, step ? 'step' : 'filter'); } catch (e) {}
  }

  btnMode.innerHTML = svg(ICONS.filter);
  $('btnPrevHit').innerHTML = svg(ICONS.up);
  $('btnNextHit').innerHTML = svg(ICONS.down);
  setMode(stepMode);
  if (opts.ownsSearch) btnMode.hidden = true;

  btnMode.addEventListener('click', function () {
    setMode(!stepMode);
    if (self.query()) self.render();
  });
  $('btnPrevHit').addEventListener('click', function () { gotoHit(hitIdx - 1); });
  $('btnNextHit').addEventListener('click', function () { gotoHit(hitIdx + 1); });

  document.addEventListener('keydown', function (e) {
    if (!stepMode || !hits.length) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault();
      gotoHit(hitIdx + (e.shiftKey ? -1 : 1));
    }
  });

  /* from a filtered result to the same node with everything around it */
  function showInTree(chain) {
    setMode(true);
    self.render();
    var key = chain.join('/');
    for (var i = 0; i < hits.length; i++) {
      if (hits[i].join('/') === key) { gotoHit(i); return; }
    }
    /* an ancestor kept only for its matching children */
    var row = reveal(chain);
    if (row) {
      var prev = el.querySelector('.row.current-hit');
      if (prev) prev.classList.remove('current-hit');
      selectRow(row);
      row.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
  }

  /* ---------- row menu ---------- */
  var ctxWrap = document.createElement('div');
  ctxWrap.className = 'menu-wrap';
  var ctxMenu = document.createElement('div');
  ctxMenu.className = 'menu ctx-menu';
  ctxMenu.setAttribute('role', 'menu');
  ctxWrap.appendChild(ctxMenu);
  document.body.appendChild(ctxWrap);
  ctxMenu.addEventListener('click', function (e) { e.stopPropagation(); });

  el.addEventListener('contextmenu', function (e) {
    var row = e.target.closest('.row');
    if (!row || !el.contains(row)) return;
    var entry = info.get(row);
    if (!entry) return;
    e.preventDefault();
    selectRow(row);

    ctxMenu.innerHTML = '';
    function item(label, run) {
      var b = document.createElement('button');
      b.className = 'menu-item';
      b.setAttribute('role', 'menuitem');
      b.textContent = label;
      b.addEventListener('click', function () { closeAllMenus(); run(); });
      ctxMenu.appendChild(b);
    }
    if (self.query() && !stepMode) {
      var chain = chains.get(row);
      item('Show in full tree', function () { showInTree(chain); });
      var sep = document.createElement('div');
      sep.className = 'menu-sep';
      ctxMenu.appendChild(sep);
    }
    adapter.actions(entry).forEach(function (a) {
      item(a.title, function () { copyText(a.get(), a.toastLabel || a.label); });
    });

    closeAllMenus();
    ctxMenu.classList.add('open');
    /* from the keyboard the event has no pointer position — use the row */
    var x = e.clientX, y = e.clientY;
    if (!x && !y) { var r = row.getBoundingClientRect(); x = r.left + 24; y = r.bottom; }
    var w = ctxMenu.offsetWidth, h = ctxMenu.offsetHeight;
    ctxMenu.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 4)) + 'px';
    ctxMenu.style.top = Math.max(4, Math.min(y, window.innerHeight - h - 4)) + 'px';
    var first = ctxMenu.querySelector('.menu-item');
    if (first) first.focus();
  });
  el.addEventListener('scroll', function () { closeAllMenus(); }, { passive: true });

  /* interaction */
  function selectRow(row) {
    if (selected) selected.classList.remove('selected');
    selected = row;
    row.classList.add('selected');
    var entry = info.get(row);
    pathBox.textContent = entry ? adapter.path(entry) : '';
  }

  el.addEventListener('click', function (e) {
    var row = e.target.closest('.row');
    if (!row || !el.contains(row) || e.target.closest('button')) return;
    selectRow(row);
    toggle(row.parentElement);
  });

  el.addEventListener('keydown', function (e) {
    var row = e.target.closest('.row');
    if (!row) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); toggle(row.parentElement, true); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); toggle(row.parentElement, false); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      var rows = Array.prototype.slice.call(el.querySelectorAll('.row'));
      var i = rows.indexOf(row);
      var next = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) next.focus();
    }
  });

  pathBox.addEventListener('click', function () {
    if (pathBox.textContent) copyText(pathBox.textContent, adapter.pathLabel || 'Path');
  });

  $('btnExpand').addEventListener('click', function () {
    var budget = ROW_BUDGET;
    (function walk(container) {
      var nodes = container.querySelectorAll(':scope > .node');
      for (var i = 0; i < nodes.length; i++) {
        if (budget-- <= 0) return;
        toggle(nodes[i], true);
        var box = nodes[i].querySelector(':scope > .children');
        if (box) walk(box);
      }
    })(el);
    if (budget <= 0) showToast('Expanded the first ' + fmtNum(ROW_BUDGET) + ' rows');
  });

  $('btnCollapse').addEventListener('click', function () {
    var open = el.querySelectorAll('.node.open');
    for (var i = 0; i < open.length; i++) open[i].classList.remove('open');
    var first = el.querySelector(':scope > .node');
    if (first) toggle(first, true);
  });

  /* wrap toggle */
  var WRAP_KEY = 'lintuz-wrap';
  var btnWrap = $('btnWrap');
  var wrapOn = false;
  try { wrapOn = localStorage.getItem(WRAP_KEY) === '1'; } catch (e) {}
  function applyWrap(on) {
    el.classList.toggle('wrap', on);
    btnWrap.setAttribute('aria-pressed', String(on));
  }
  applyWrap(wrapOn);
  btnWrap.addEventListener('click', function () {
    wrapOn = !wrapOn;
    applyWrap(wrapOn);
    try { localStorage.setItem(WRAP_KEY, wrapOn ? '1' : '0'); } catch (e) {}
  });

  /* A tool that renders its own right-hand pane (CSV's table) owns search
     too — otherwise both listeners fire and the shared tree overwrites it. */
  if (!opts.ownsSearch) {
    var searchTimer = null;
    searchBox.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { searchTimer = null; self.render(); }, 220);
    });
    /* Enter steps to the next match — and settles a query still being typed */
    searchBox.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || !stepMode) return;
      e.preventDefault();
      if (searchTimer !== null) {
        clearTimeout(searchTimer);
        searchTimer = null;
        self.render();
        return;
      }
      gotoHit(hitIdx + (e.shiftKey ? -1 : 1));
    });
  }
}

/* ==========================================================================
   Boot
   ========================================================================== */
function init(config) {
  var body = document.body;

  /* chrome */
  var slot = $('chromeSlot');
  buildSuiteMenu(slot, config.id);
  buildThemeMenu(slot);
  var refreshOverflow = buildOverflowMenu(slot, [
    { id: 'btnCopy', label: 'Copy ' + config.label, title: 'Copy the editor contents' },
    { id: 'btnSample', label: 'Load a sample', title: 'Replace the editor contents with a sample document' },
    { id: 'btnClear', label: 'Clear', title: 'Empty the editor' }
  ]);

  /* icons into the treebar buttons */
  $('btnWrap').innerHTML = svg(ICONS.wrap);
  $('btnExpand').innerHTML = svg(ICONS.expand);
  $('btnCollapse').innerHTML = svg(ICONS.collapse);
  $('searchIcon').innerHTML = svg(ICONS.search);

  /* status */
  var statusBar = $('statusBar'), statusMsg = $('statusMsg');
  function setStatus(kind, msg) {
    statusBar.className = 'status' + (kind ? ' ' + kind : '');
    statusMsg.textContent = msg;
  }

  /* error bar */
  var errorBar = $('errorBar'), errorMsg = $('errorMsg'), errorLoc = $('errorLoc');
  var errorPos = null;

  var tree = new Tree({
    adapter: config.adapter,
    emptyHTML: config.emptyHTML,
    autoDepth: config.autoDepth,
    ownsSearch: config.ownsPane
  });

  var editor = new Editor({
    highlighter: config.highlighter,
    onChange: function () { schedule(); }
  });

  var parseTimer;
  function schedule() {
    clearTimeout(parseTimer);
    parseTimer = setTimeout(run, 280);
  }

  function run() {
    var text = editor.getValue();
    if (!text.trim()) {
      if (!config.ownsPane) tree.setData(null, false);
      else tree.hasData = false;
      errorBar.classList.remove('show');
      editor.setErrorLine(null);
      setStatus('', 'Ready');
      config.onParsed && config.onParsed(null, false);
      return;
    }
    var t0 = performance.now();
    var res = config.parse(text);
    var ms = performance.now() - t0;

    if (res.ok) {
      errorBar.classList.remove('show');
      editor.setErrorLine(null);
      errorPos = null;
      if (!config.ownsPane) tree.setData(res.value, true);
      else tree.hasData = true;
      var size = new Blob([text]).size;
      var st = config.stats(res.value);
      setStatus('ok', 'Valid · ' + fmtBytes(size) + ' · ' + st +
        ' · ' + ms.toFixed(ms < 10 ? 1 : 0) + ' ms');
      config.onParsed && config.onParsed(res.value, true);
    } else {
      errorPos = res.pos != null ? res.pos : null;
      editor.setErrorLine(res.line || null);
      errorMsg.textContent = res.message;
      errorLoc.textContent = res.line ? 'line ' + res.line + ':' + (res.col || 1) : '';
      errorBar.classList.add('show');
      if (!config.ownsPane) tree.markStale();
      setStatus('err', 'Invalid ' + config.label);
      config.onParsed && config.onParsed(null, false);
    }
  }

  errorBar.addEventListener('click', function () {
    if (errorPos !== null) editor.jumpTo(errorPos);
  });

  /* toolbar wiring shared by every tool */
  function on(id, fn) {
    var b = $(id);
    if (b) b.addEventListener('click', fn);
  }

  on('btnCopy', function () {
    var v = editor.getValue();
    if (v) copyText(v, config.label);
  });

  on('btnClear', function () {
    editor.setValue('');
    $('search').value = '';
    editor.input.focus();
  });

  on('btnSample', function () { editor.setValue(config.sample.trim()); });
  /* the empty state offers the sample too, where a first-time visitor looks */
  $('tree').addEventListener('click', function (e) {
    if (e.target.closest('[data-empty="sample"]')) $('btnSample').click();
  });

  on('btnLoad', function () { $('fileInput').click(); });
  $('fileInput').addEventListener('change', function (e) {
    if (e.target.files[0]) readFile(e.target.files[0]);
    e.target.value = '';
  });

  function readFile(file) {
    if (file.size > 50 * 1048576) {
      showToast('That file is over 50 MB — too large to open here');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      editor.setValue(String(reader.result));
      showToast('Opened ' + file.name + ' · ' + fmtBytes(file.size));
    };
    reader.onerror = function () { showToast('Could not read that file'); };
    reader.readAsText(file);
  }

  ['dragover', 'dragenter'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      e.preventDefault();
      body.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      e.preventDefault();
      if (ev === 'drop' || e.relatedTarget === null) body.classList.remove('dragover');
    });
  });
  document.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readFile(f);
  });

  /* mobile view tabs */
  function setView(v) {
    body.dataset.view = v;
    $('tabText').classList.toggle('active', v === 'text');
    $('tabTree').classList.toggle('active', v === 'tree');
  }
  $('tabText').addEventListener('click', function () { setView('text'); });
  $('tabTree').addEventListener('click', function () { setView('tree'); });
  setView('text');

  /* split divider */
  var divider = $('divider'), editorPane = $('editorPane');
  divider.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    divider.classList.add('dragging');
    divider.setPointerCapture(e.pointerId);
    function move(ev) {
      var rect = document.querySelector('.split').getBoundingClientRect();
      var w = Math.min(Math.max(ev.clientX - rect.left, 240), rect.width - 280);
      editorPane.style.width = w + 'px';
    }
    function up() {
      divider.classList.remove('dragging');
      divider.removeEventListener('pointermove', move);
      divider.removeEventListener('pointerup', up);
    }
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', up);
  });

  /* Buttons declaring data-key bind themselves, so a tool adds a shortcut
     by naming it in its config and nothing here needs to change. */
  var keyed = document.querySelectorAll('.toolbar button[data-key]');
  var keyMap = [];
  for (var ki = 0; ki < keyed.length; ki++) {
    var spec = keyed[ki].dataset.key.split('+');
    keyMap.push({
      btn: keyed[ki],
      mod: spec.indexOf('mod') !== -1,
      shift: spec.indexOf('shift') !== -1,
      key: spec[spec.length - 1]
    });
  }

  /* keyboard */
  document.addEventListener('keydown', function (e) {
    var mod = e.ctrlKey || e.metaKey;

    for (var i = 0; i < keyMap.length; i++) {
      var m = keyMap[i];
      if (m.mod !== mod) continue;
      if (m.shift !== e.shiftKey) continue;
      if (e.key.toLowerCase() !== m.key) continue;
      e.preventDefault();
      m.btn.click();
      return;
    }

    if (mod && e.key === 'Enter') {
      e.preventDefault();
      var fmt = $('btnFormat');
      if (fmt) fmt.click();
    } else if (mod && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      if (window.innerWidth <= 720) setView('tree');
      $('search').focus();
      $('search').select();
    } else if (mod && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      editor.input.focus();
    }
  });

  /* ---------- arriving from another tool ----------
     The sender set a cookie naming itself. Name the format in the prompt so
     the instruction is concrete, and drop it as soon as anything is typed. */
  /* paint the empty state before anything is typed — otherwise the tree pane
     sits blank until the first parse cycle. A tool owning the pane paints
     its own. */
  if (!config.ownsPane) tree.render();

  var from = readHandoff();
  if (from && !editor.getValue()) {
    var paste = navigator.platform.indexOf('Mac') === 0 ? '\u2318V' : 'Ctrl+V';
    $('tree').innerHTML =
      '<div class="empty arrived">' +
        '<p class="arrived-lead">Your ' + (from.format || config.label) +
        ' from ' + from.name + ' is on the clipboard.</p>' +
        '<p>Press <kbd>' + paste + '</kbd> in the editor to see it here.</p>' +
      '</div>';
    /* restore the normal empty state once they start working */
    var clearArrival = function () {
      var a = $('tree').querySelector('.arrived');
      if (a) tree.render();
      editor.input.removeEventListener('input', clearArrival);
    };
    editor.input.addEventListener('input', clearArrival);
  }

  editor.paint();
  editor.input.focus();

  return {
    editor: editor,
    tree: tree,
    run: run,
    schedule: schedule,
    setStatus: setStatus,
    toast: showToast,
    copy: copyText
  };
}

/* Copy a converted document, then offer to open the tool that reads it.
   from = the id of the tool doing the sending; to = the id it converts into. */
function copyAndOffer(text, label, from, to) {
  var dest = null;
  for (var i = 0; i < SUITE.length; i++) if (SUITE[i].id === to) dest = SUITE[i];
  var done = function () {
    showToast(label + ' copied',
      dest ? { label: 'Open ' + dest.name + ' viewer', href: dest.host,
               from: from, format: label } : null);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
  } else fallbackCopy(text, done);
}

/* Same rendering the toolbar hints use, so empty-state copy never claims a
   key the user's platform does not have. */
var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
function kbd(key) {
  var out = key.split('+').map(function (p) {
    if (p === 'mod') return IS_MAC ? '\u2318' : 'Ctrl';
    if (p === 'shift') return IS_MAC ? '\u21E7' : 'Shift';
    if (p === 'enter') return IS_MAC ? '\u21B5' : 'Enter';
    return p.toUpperCase();
  });
  return '<kbd>' + (IS_MAC ? out.join('') : out.join('+')) + '</kbd>';
}

/* The empty state every tool opens on: a heading saying what to do, one
   sentence on what happens, optional buttons, and the keys. `extra` is raw
   HTML placed between the sentence and the keys (a tool's own choices). */
function emptyState(o) {
  return '<div class="empty-state">' +
    '<h2>' + o.title + '</h2>' +
    (o.body ? '<p>' + o.body + '</p>' : '') +
    (o.extra || '') +
    (o.keys ? '<p class="keys">' + o.keys + '</p>' : '') +
  '</div>';
}

/* A tool with no editor/tree (PDF) builds its own frame, so it needs the
   suite switcher and theme picker on their own. */
function mountChrome(slot, activeId) {
  buildSuiteMenu(slot, activeId);
  buildThemeMenu(slot);
}

global.LintApp = {
  init: init,
  mountChrome: mountChrome,
  wireMenu: wireMenu,
  closeMenus: closeAllMenus,
  isMac: IS_MAC,
  copyAndOffer: copyAndOffer,
  kbd: kbd,
  emptyState: emptyState,
  esc: esc,
  copy: copyText,
  toast: showToast,
  fmtBytes: fmtBytes,
  fmtNum: fmtNum,
  highlightInto: highlightInto,
  STR_TRUNC: STR_TRUNC,
  THEMES: THEMES,
  SUITE: SUITE
};

})(window);
