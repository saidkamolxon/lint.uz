/* ==========================================================================
   lint.one — shared runtime
   Every tool calls LintApp.init() with format-specific hooks; everything
   below (themes, tree, search, editor, file I/O, clipboard) is generic.
   ========================================================================== */
(function (global) {
'use strict';

/* The themes, their menu and the contrast switch live in theme-boot.js,
   loaded first, so the landing page and the tools share one copy. */
var THEMES = LintTheme.THEMES;

/* ---------- the ten tools, for the suite switcher ---------- */
/* Paths on one domain rather than a subdomain each: a search engine pools a
   site's authority across its paths, but treats subdomains as separate sites
   and splits it. Relative hrefs also keep local development working. */
var SUITE = [
  { id: 'json', name: 'JSON', host: '/json' },
  { id: 'xml',  name: 'XML',  host: '/xml'  },
  { id: 'yaml', name: 'YAML', host: '/yaml' },
  { id: 'csv',  name: 'CSV',  host: '/csv'  },
  { id: 'pdf',  name: 'PDF',  host: '/pdf'  },
  { id: 'log',  name: 'Logs', host: '/log'  },
  { id: 'audio', name: 'Audio', host: '/audio' },
  { id: 'sqlite', name: 'SQLite', host: '/sqlite' },
  { id: 'parquet', name: 'Parquet', host: '/parquet' },
  { id: 'env', name: 'ENV', host: '/env' }
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
  /* chevrons pointing apart and together — a plus and a minus read as
     zoom, which the text size now is */
  expand: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  collapse: '<path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  wrap: '<path d="M3 6h18M3 12h13a3 3 0 0 1 0 6h-4m0 0 2.5-2.5M12 18l2.5 2.5M3 18h5"/>',
  theme: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18" fill="currentColor" stroke="none"/>',
  filter: '<path d="M4 5h16l-6.2 7.4V19l-3.6 1.6v-8.2z"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  more: '<circle cx="12" cy="5" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/>'
};

/* ---------- keys ----------
   One way to write a shortcut everywhere: tokens joined by '+', e.g.
   'mod+shift+]' or 'shift+alt+f'. mod is Ctrl, or ⌘ on a Mac. The same
   string is bound (keyMatches), shown in a tooltip (keyText) and listed in
   the shortcuts panel (kbd), so none of the three can disagree. */
var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

/* modifiers in each platform's own order: VS Code's Ctrl+Shift+Alt on a
   PC, Apple's ⌥⇧⌘ on a Mac */
var MOD_ORDER = IS_MAC ? ['alt', 'shift', 'mod'] : ['mod', 'shift', 'alt'];
var MOD_NAMES = IS_MAC
  ? { mod: '⌘', shift: '⇧', alt: '⌥' }
  : { mod: 'Ctrl', shift: 'Shift', alt: 'Alt' };
/* ↵ is a Mac keycap; a PC keyboard says Enter */
var KEY_NAMES = {
  enter: IS_MAC ? '↵' : 'Enter', esc: 'Esc', space: 'Space',
  up: '↑', down: '↓', left: '←', right: '→',
  pageup: 'PgUp', pagedown: 'PgDn', home: 'Home', end: 'End', wheel: 'scroll'
};
/* what KeyboardEvent.key says for the named keys */
var EVENT_KEYS = {
  enter: 'Enter', esc: 'Escape', space: ' ',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  pageup: 'PageUp', pagedown: 'PageDown', home: 'Home', end: 'End'
};
/* the physical key, for when a modifier or the layout changes the character
   (Shift+] types "}", Alt+Z on a Mac types "Ω", a Cyrillic layout "я") */
var EVENT_CODES = { '[': 'BracketLeft', ']': 'BracketRight', '=': 'Equal', '-': 'Minus', '/': 'Slash' };

function parseKey(spec) {
  var parts = spec.split('+'), key = parts.pop();
  return {
    mod: parts.indexOf('mod') !== -1,
    shift: parts.indexOf('shift') !== -1,
    alt: parts.indexOf('alt') !== -1,
    key: key
  };
}

/* 'mod+shift+]' as this platform writes it: Ctrl+Shift+] or ⇧⌘] */
function keyText(spec) {
  var k = parseKey(spec);
  var mods = MOD_ORDER.filter(function (m) { return k[m]; })
    .map(function (m) { return MOD_NAMES[m]; });
  /* a modifier alone is a key too — PDF's "hold Alt to show links" */
  var name = MOD_NAMES[k.key] || KEY_NAMES[k.key] ||
    k.key.charAt(0).toUpperCase() + k.key.slice(1);
  /* a Mac runs glyphs together (⇧⌘]); a word keeps its space (⌘ Home) */
  if (IS_MAC) return mods.join('') + (mods.length && /^[A-Za-z]{2,}$/.test(name) ? ' ' : '') + name;
  return mods.concat([name]).join('+');
}

/* Same rendering the toolbar hints use, so empty-state copy never claims a
   key the user's platform does not have. */
function kbd(spec) { return '<kbd>' + esc(keyText(spec)) + '</kbd>'; }

function keyMatches(e, spec) {
  var k = parseKey(spec);
  if (k.mod !== (e.ctrlKey || e.metaKey) || k.alt !== e.altKey) return false;
  /* ? is Shift+/ on one layout and something else on another; the
     character is what the user means */
  if (k.key === '?') return e.key === '?';
  if (k.shift !== e.shiftKey) return false;
  if (EVENT_KEYS[k.key]) return e.key === EVENT_KEYS[k.key];
  if (/^fd+$/.test(k.key)) return e.key.toLowerCase() === k.key;
  if (/^[a-z0-9]$/.test(k.key)) {
    var ch = e.key.length === 1 ? e.key.toLowerCase() : '';
    if (/^[a-z0-9]$/.test(ch)) return ch === k.key;
    return e.code === (/d/.test(k.key) ? 'Digit' : 'Key') + k.key.toUpperCase();
  }
  return e.key === k.key || (!!EVENT_CODES[k.key] && e.code === EVENT_CODES[k.key]);
}

/* where a typed character belongs to the field, not to a shortcut */
function isTyping(el) {
  return !!(el && el.closest &&
    el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}

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
    a.innerHTML = esc(action.label) + kbd('enter');
    a.href = action.href;
    a.target = '_blank';
    a.rel = 'noopener';
    /* the click and Enter do the same thing: the action's own handler when
       it has one (a converted document carried to its tool), otherwise the
       link in a new tab */
    var follow = function () {
      t.classList.remove('show');
      detach();
      if (action.onFollow) action.onFollow();
      else window.open(action.href, '_blank', 'noopener');
    };
    a.addEventListener('click', function (e) {
      e.preventDefault();
      follow();
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
      follow();
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
   A converted document goes to its tool through IndexedDB (openConverted,
   below). Only when that fails does this short-lived cookie name the tool
   the user just left, so the destination can say "your JSON from YAML is on
   the clipboard" instead of a generic hint. It carries no document data. */
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
  /* the same menu the landing page shows, built in theme-boot.js — and
     rebuilt on each opening, so its ticks match a choice made in another
     tab or a contrast that followed the OS */
  function fill() { LintTheme.buildMenu(menu, function () { closeAllMenus(); }); }
  fill();
  btn.addEventListener('click', fill);

  wrap.appendChild(btn);
  wrap.appendChild(menu);
  container.appendChild(wrap);
  wireMenu(btn, menu);
}

/* The lint.one mark at the far left of every tool's toolbar, like the Apple
   menu: the suite's own glyph, which opens the suite — the seven tools, the
   way home and the keyboard shortcuts. It goes in front of the tool's
   brand, which then only names the tool; a page that still renders the
   brand as a link to / keeps its children and loses the link, since the
   menu now does that job. */
function buildSuiteMark(activeId) {
  var brand = document.querySelector('.toolbar .brand');
  if (!brand || document.querySelector('.toolbar .suite-wrap')) return;
  if (brand.tagName === 'A') {
    var span = document.createElement('span');
    span.className = brand.className;
    while (brand.firstChild) span.appendChild(brand.firstChild);
    brand.parentNode.replaceChild(span, brand);
    brand = span;
  }

  var wrap = document.createElement('div');
  wrap.className = 'menu-wrap suite-wrap';

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'suite-btn';
  btn.title = 'lint.one';
  btn.setAttribute('aria-label', 'lint.one');
  btn.setAttribute('aria-haspopup', 'true');
  btn.innerHTML = '<span class="suite-mark" aria-hidden="true"></span>';

  var menu = document.createElement('div');
  menu.className = 'menu suite-menu';
  menu.setAttribute('role', 'menu');
  var label = document.createElement('div');
  label.className = 'menu-label';
  label.textContent = 'lint.one';
  menu.appendChild(label);

  /* each tool as a small app icon — its glyph on its hue — so the menu
     reads like a row of apps rather than a list of words */
  SUITE.forEach(function (t) {
    var a = document.createElement('a');
    a.className = 'menu-item';
    a.setAttribute('role', 'menuitem');
    a.href = t.host;
    a.innerHTML =
      '<span class="tool-tile dot-' + t.id + '" aria-hidden="true"></span>' +
      '<span>' + t.name + '</span><span class="tick" aria-hidden="true">✓</span>';
    if (t.id === activeId) a.setAttribute('aria-current', 'page');
    menu.appendChild(a);
  });

  menu.appendChild(Object.assign(document.createElement('div'), { className: 'menu-sep' }));
  var home = document.createElement('a');
  home.className = 'menu-item';
  home.setAttribute('role', 'menuitem');
  home.href = '/';
  home.textContent = 'All tools';
  menu.appendChild(home);

  var keys = document.createElement('button');
  keys.type = 'button';
  keys.className = 'menu-item';
  keys.setAttribute('role', 'menuitem');
  keys.innerHTML = '<span>Keyboard shortcuts</span><span class="menu-key">' + esc(keyText('?')) + '</span>';
  keys.addEventListener('click', function () {
    closeAllMenus();
    /* the item is about to vanish with its menu, so focus comes back to
       the mark when the panel closes */
    btn.focus();
    showShortcuts();
  });
  menu.appendChild(keys);

  wrap.appendChild(btn);
  wrap.appendChild(menu);
  brand.parentNode.insertBefore(wrap, brand);
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
        /* the label only — not any icon markup rendered after it */
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
   Text size — LintApp.textZoom(onChange)
   Ctrl/⌘ with + − 0, or with the wheel, sizes the document's text and never
   the chrome: the browser's own zoom would scale the toolbar with it. The
   size is one setting for the whole suite, kept in localStorage.
   ========================================================================== */
var ZOOM_KEY = 'lintuz-zoom';
var zoomOn = false, zoomScale = 1, zoomListeners = [];

function setZoom(scale, announce) {
  /* 70% to 200% in steps of ten, held as tenths so the steps never drift */
  scale = Math.min(20, Math.max(7, Math.round(scale * 10))) / 10;
  zoomScale = scale;
  var root = document.documentElement.style;
  root.setProperty('--code-scale', String(scale));
  root.setProperty('--code-size', 'calc(var(--fs-base) * var(--code-scale))');
  try { localStorage.setItem(ZOOM_KEY, String(scale)); } catch (e) {}
  if (announce) showToast('Text size ' + Math.round(scale * 100) + '%');
  zoomListeners.forEach(function (fn) { fn(scale); });
}

function textZoom(onChange) {
  if (onChange) zoomListeners.push(onChange);
  if (zoomOn) { if (onChange) onChange(zoomScale); return; }
  zoomOn = true;

  var saved = NaN;
  try { saved = parseFloat(localStorage.getItem(ZOOM_KEY)); } catch (e) {}
  setZoom(isNaN(saved) ? 1 : saved, false);

  function step(dir) { setZoom(dir ? zoomScale + dir / 10 : 1, true); }

  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    var dir = null;
    if (e.key === '=' || e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd') dir = 1;
    else if (e.key === '-' || e.code === 'Minus' || e.code === 'NumpadSubtract') dir = -1;
    else if (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') dir = 0;
    if (dir === null) return;
    e.preventDefault();
    step(dir);
  });

  /* A trackpad pinch arrives as a burst of ctrl+wheel events; one step per
     120ms keeps it from racing through the whole range in a single gesture. */
  var last = 0;
  window.addEventListener('wheel', function (e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    if (shortcutsOpen() || !e.deltaY) return;
    var now = Date.now();
    if (now - last < 120) return;
    last = now;
    step(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
}

/* ==========================================================================
   Keyboard shortcuts — LintApp.shortcuts(groups), LintApp.showShortcuts()
   One panel lists every key the page answers to. The General group is the
   suite's own; each tool appends its groups. Keys follow what developers
   already know from VS Code and Windows Terminal.
   ========================================================================== */
var shortcutGroups = [];

/* groups = [{title, items: [{keys: ['mod+g'], label: 'Go to line'}]}].
   A group whose title is already listed gains the new items. */
function shortcuts(groups) {
  (groups || []).forEach(function (g) {
    for (var i = 0; i < shortcutGroups.length; i++) {
      if (shortcutGroups[i].title === g.title) {
        shortcutGroups[i].items = shortcutGroups[i].items.concat(g.items || []);
        return;
      }
    }
    shortcutGroups.push({ title: g.title, items: (g.items || []).slice() });
  });
}

function generalGroup() {
  var items = [
    { keys: ['mod+o'], label: 'Open a file' },
    { keys: ['alt+w'], label: 'Close the file' }
  ];
  /* only on pages with something to search (Audio has none) */
  if (document.querySelector('#search, #filter, #findInput')) {
    items.push({ keys: ['mod+f'], label: 'Find' });
  }
  /* only where the text size can actually change */
  if (zoomOn) {
    items.push(
      { keys: ['mod+='], label: 'Bigger text' },
      { keys: ['mod+-'], label: 'Smaller text' },
      { keys: ['mod+0'], label: 'Reset text size' },
      { keys: ['mod+wheel'], label: 'Change text size' }
    );
  }
  items.push({ keys: ['?', 'mod+/'], label: 'Keyboard shortcuts' });
  return { title: 'General', items: items };
}

var scDialog = null, scReturn = null;

function shortcutsOpen() { return !!(scDialog && scDialog.open); }

function showShortcuts() {
  if (!scDialog) {
    scDialog = document.createElement('dialog');
    scDialog.className = 'shortcuts';
    scDialog.setAttribute('aria-labelledby', 'scTitle');
    /* a click that lands on the dialog itself, not its contents, is on the
       backdrop */
    scDialog.addEventListener('click', function (e) {
      if (e.target === scDialog || e.target.closest('.sc-close')) scDialog.close();
    });
    scDialog.addEventListener('close', function () {
      if (scReturn && scReturn.focus && document.contains(scReturn)) scReturn.focus();
      scReturn = null;
    });
    document.body.appendChild(scDialog);
  }
  if (scDialog.open) return;

  /* built on every opening, so a group added late is still listed */
  var groups = [generalGroup()].concat(shortcutGroups);
  scDialog.innerHTML =
    '<div class="sc-head">' +
      '<h2 id="scTitle">Keyboard shortcuts</h2>' +
      '<button type="button" class="icon-btn sc-close" aria-label="Close" title="Close (' +
        keyText('esc') + ')">' + svg(ICONS.close) + '</button>' +
    '</div>' +
    '<div class="sc-body">' + groups.map(function (g) {
      return '<section class="sc-group"><h3>' + esc(g.title) + '</h3>' +
        g.items.map(function (it) {
          return '<div class="sc-row"><span>' + esc(it.label) + '</span>' +
            '<span class="sc-keys">' + it.keys.map(kbd).join(' or ') + '</span></div>';
        }).join('') +
      '</section>';
    }).join('') + '</div>';

  scReturn = document.activeElement;
  closeAllMenus();
  scDialog.showModal();
}

/* While the panel is open nothing else answers a key: this listener runs
   first of all (window, capture) and stops the event there. The browser
   still closes the dialog on Esc, which is its default action, not a
   listener. */
window.addEventListener('keydown', function (e) {
  if (shortcutsOpen()) e.stopImmediatePropagation();
}, true);

/* ? opens the panel wherever a ? is not being typed; Ctrl/⌘+/ anywhere */
document.addEventListener('keydown', function (e) {
  if (keyMatches(e, 'mod+/') || (keyMatches(e, '?') && !isTyping(e.target))) {
    e.preventDefault();
    showShortcuts();
  }
});

/* ==========================================================================
   The open document — LintApp.setDocument(name, onClose)
   A chip after the toolbar's Open button names what is open and closes it,
   with its × or Alt+W. setDocument(null) takes it away.
   ========================================================================== */
var docClose = null;

function setDocument(name, onClose) {
  var chip = $('docChip');
  if (typeof name !== 'string') {
    if (chip) chip.remove();
    docClose = null;
    return;
  }
  docClose = onClose || null;
  if (!chip) {
    var open = document.querySelector('.toolbar button.primary');
    if (!open) return;
    chip = document.createElement('span');
    chip.className = 'doc-chip';
    chip.id = 'docChip';
    chip.innerHTML = '<span class="doc-name"></span>' +
      '<button type="button" class="doc-close">' + svg(ICONS.close) + '</button>';
    chip.lastChild.addEventListener('click', function () { if (docClose) docClose(); });
    open.parentNode.insertBefore(chip, open.nextSibling);
  }
  chip.firstChild.textContent = name;
  chip.firstChild.title = name;
  chip.lastChild.setAttribute('aria-label', 'Close ' + name);
  chip.lastChild.title = 'Close (' + keyText('alt+w') + ')';
}

/* only while something is open and no menu is; the panel stops it above */
document.addEventListener('keydown', function (e) {
  if (!docClose || !keyMatches(e, 'alt+w') || document.querySelector('.menu.open')) return;
  e.preventDefault();
  docClose();
});

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
  this._marks = {};       // line -> { kind: 'err' | 'warn', title }, from tools that find more than one
  this._errTitle = '';
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
        self._paintedCur === self._curLine && self._paintedMarks === self._marks) return;
    self._lineCount = count;
    self._paintedErr = self._errLine;
    self._paintedCur = self._curLine;
    self._paintedMarks = self._marks;
    var out = '';
    for (var i = 1; i <= count; i++) {
      var cls = 'ln', mark = self._marks[i];
      /* the message rides on the line number, where a pointer finds it as
         it would in any code editor */
      var title = i === self._errLine ? self._errTitle : mark ? mark.title : '';
      if (i === self._errLine || (mark && mark.kind === 'err')) cls += ' err';
      else if (mark && mark.kind === 'warn') cls += ' warn' + (i === self._curLine ? ' cur' : '');
      else if (i === self._curLine) cls += ' cur';
      out += '<span class="' + cls + '"' + (title ? ' data-tip="' + esc(title) + '"' : '') + '>' + i + '</span>';
    }
    gutter.innerHTML = out;
  };

  /* several lines at once, for a tool whose findings are not one error */
  this.setMarks = function (marks) {
    self._marks = marks || {};
    self.paintGutter(self._lineCount);
  };

  /* The message of a marked line shows the moment the pointer is on its
     number, beside it, as a code editor's does: a browser's own tooltip
     waits a second first, which here reads as nothing happening. */
  var tip = null;
  function hideTip() { if (tip) tip.hidden = true; }
  function showTip(e) {
    var ln = e.target.closest ? e.target.closest('.ln[data-tip]') : null;
    if (!ln) { hideTip(); return; }
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'gutter-tip';
      tip.setAttribute('role', 'tooltip');
      document.body.appendChild(tip);
    }
    tip.textContent = ln.dataset.tip;
    tip.className = 'gutter-tip' + (ln.classList.contains('err') ? ' err' : ' warn');
    tip.hidden = false;
    var r = ln.getBoundingClientRect();
    var g = gutter.parentElement.getBoundingClientRect();
    tip.style.left = Math.round(g.right + 6) + 'px';
    tip.style.top = Math.round(r.top - 2) + 'px';
    /* kept on screen when the line is near the bottom */
    var over = tip.getBoundingClientRect().bottom - window.innerHeight + 8;
    if (over > 0) tip.style.top = Math.round(r.top - 2 - over) + 'px';
  }
  gutter.addEventListener('mouseover', showTip);
  /* a tap shows it too, where there is no pointer to hover */
  gutter.addEventListener('click', showTip);
  gutter.addEventListener('mouseleave', hideTip);
  document.addEventListener('pointerdown', function (e) {
    if (tip && !tip.hidden && !gutter.contains(e.target)) hideTip();
  });
  input.addEventListener('scroll', hideTip, { passive: true });

  this.setErrorLine = function (line, title) {
    self._errLine = line;
    self._errTitle = title || '';
    self._paintedErr = undefined;
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
      more.textContent = 'Show ' + next + ' more (' + fmtNum(entries.length - end) + ' left)';
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

  /* F3 and Shift+F3 step from anywhere; Ctrl+G stays as an old alias */
  document.addEventListener('keydown', function (e) {
    if (!stepMode || !hits.length) return;
    if (keyMatches(e, 'f3') || keyMatches(e, 'mod+g')) {
      e.preventDefault();
      gotoHit(hitIdx + 1);
    } else if (keyMatches(e, 'shift+f3') || keyMatches(e, 'mod+shift+g')) {
      e.preventDefault();
      gotoHit(hitIdx - 1);
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
  mountChrome(slot, config.id);
  /* a tool's own quieter commands (LINT_CONFIG.more) come first; closing
     the document is the chip's job, not an item here */
  var lc = global.LINT_CONFIG || {};
  var refreshOverflow = buildOverflowMenu(slot, (lc.more || []).concat([
    { id: 'btnCopy', label: 'Copy ' + config.label, title: 'Copy the editor contents' },
    { id: 'btnSample', label: 'Load a sample', title: 'Replace the editor contents with a sample document' }
  ]));

  /* the document's text follows the reader's text size */
  textZoom();

  /* icons into the treebar buttons, and each one's key in its tooltip */
  $('btnWrap').innerHTML = svg(ICONS.wrap);
  $('btnExpand').innerHTML = svg(ICONS.expand);
  $('btnCollapse').innerHTML = svg(ICONS.collapse);
  $('searchIcon').innerHTML = svg(ICONS.search);
  function hint(id, key) { var b = $(id); if (b) b.title += ' (' + key + ')'; }
  hint('btnWrap', keyText('alt+z'));
  hint('btnExpand', keyText('mod+shift+]'));
  hint('btnCollapse', keyText('mod+shift+['));
  hint('btnNextHit', keyText('enter') + ' or ' + keyText('f3'));
  hint('btnPrevHit', keyText('shift+enter') + ' or ' + keyText('shift+f3'));

  /* status — a message, or a list of facts laid out with space between
     them rather than a row of middle dots */
  var statusBar = $('statusBar'), statusMsg = $('statusMsg');
  function setStatus(kind, msg) {
    statusBar.className = 'status' + (kind ? ' ' + kind : '');
    if (!Array.isArray(msg)) { statusMsg.textContent = msg; return; }
    statusMsg.innerHTML = msg.map(function (m) {
      return '<span>' + esc(m) + '</span>';
    }).join('');
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
    onChange: function () { syncEmpty(); syncDocument(); schedule(); }
  });

  /* What the chip calls the document: the file's name when one was opened,
     dropped or handed over; otherwise "Pasted JSON" once there is text.
     Editing keeps the name; emptying the editor by hand closes it. */
  var docName = null;
  function syncDocument() {
    if (!editor.getValue()) {
      docName = null;
      setDocument(null);
      return;
    }
    if (docName === null) docName = 'Pasted ' + config.label;
    setDocument(docName, closeDocument);
  }

  /* While the editor is empty the page is just the editor and a prompt
     over it (body.is-empty; the CSS hides the rest). The first character
     brings the split in; clearing the editor takes it away again. */
  function syncEmpty() {
    var empty = !editor.getValue();
    if (empty === body.classList.contains('is-empty')) return;
    body.classList.toggle('is-empty', empty);
    /* a phone left on the tree tab would otherwise hide the editor */
    if (empty) setView('text');
  }

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
      setStatus('', '');
      config.onParsed && config.onParsed(null, false);
      return;
    }
    var res = config.parse(text);

    if (res.ok) {
      errorBar.classList.remove('show');
      editor.setErrorLine(null);
      errorPos = null;
      if (!config.ownsPane) tree.setData(res.value, true);
      else tree.hasData = true;
      var size = new Blob([text]).size;
      /* a tool's stats come as one "a · b" string; each part becomes its
         own item so the status bar can space them */
      var st = String(config.stats(res.value) || '').split(' · ');
      /* okLabel: a tool whose documents are never simply valid names it, or leaves it out with null */
      setStatus('ok', [config.okLabel === undefined ? 'Valid' : config.okLabel, fmtBytes(size)].concat(st).filter(Boolean));
      config.onParsed && config.onParsed(res.value, true);
    } else {
      errorPos = res.pos != null ? res.pos : null;
      editor.setErrorLine(res.line || null, res.message);
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

  /* Closing the document: the chip's × or Alt+W. Back to the empty prompt,
     with the search cleared so the next document starts fresh. */
  function closeDocument() {
    $('search').value = '';
    editor.setValue('');
    editor.input.focus();
  }

  on('btnSample', function () {
    docName = 'Sample ' + config.label;
    editor.setValue(config.sample.trim());
  });
  /* the empty prompt (and a tree empty state) offer Open and the sample
     where a first-time visitor looks */
  function onEmptyAction(e) {
    var b = e.target.closest('[data-empty]');
    if (!b) return;
    if (b.dataset.empty === 'sample') $('btnSample').click();
    else if (b.dataset.empty === 'open') $('fileInput').click();
  }
  $('tree').addEventListener('click', onEmptyAction);
  var emptyPrompt = $('emptyPrompt');
  emptyPrompt.addEventListener('click', onEmptyAction);
  /* clicking a prompt button must not pull focus out of the editor, so a
     paste still lands there if they change their mind */
  emptyPrompt.addEventListener('mousedown', function (e) {
    if (e.target.closest('[data-empty]')) e.preventDefault();
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
      docName = file.name;
      editor.setValue(String(reader.result));
      showToast('Opened ' + file.name + ' (' + fmtBytes(file.size) + ')');
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

  /* a file dropped on the landing page arrives here */
  takeHandoff(config.id, readFile);

  /* mobile view tabs */
  function setView(v) {
    body.dataset.view = v;
    $('tabText').classList.toggle('active', v === 'text');
    $('tabTree').classList.toggle('active', v === 'tree');
  }
  $('tabText').addEventListener('click', function () { setView('text'); });
  $('tabTree').addEventListener('click', function () { setView('tree'); });
  setView('text');

  /* Split divider. The editor's share of the width is kept as a ratio in
     localStorage, so it survives a reload and a resized window alike. The
     drag and Alt+Shift+←/→ share one clamp: at least 240px of editor and
     280px of tree. */
  var SPLIT_KEY = 'lintuz-split';
  var divider = $('divider'), editorPane = $('editorPane'), split = document.querySelector('.split');
  function setSplit(px, save) {
    var total = split.getBoundingClientRect().width;
    if (!total) return;
    var w = Math.min(Math.max(px, 240), total - 280);
    editorPane.style.width = (w / total * 100).toFixed(2) + '%';
    if (save) try { localStorage.setItem(SPLIT_KEY, (w / total).toFixed(4)); } catch (e) {}
  }
  var savedSplit = NaN;
  try { savedSplit = parseFloat(localStorage.getItem(SPLIT_KEY)); } catch (e) {}
  if (savedSplit > 0 && savedSplit < 1) editorPane.style.width = (savedSplit * 100).toFixed(2) + '%';

  divider.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    divider.classList.add('dragging');
    divider.setPointerCapture(e.pointerId);
    function move(ev) {
      setSplit(ev.clientX - split.getBoundingClientRect().left, false);
    }
    function up() {
      divider.classList.remove('dragging');
      divider.removeEventListener('pointermove', move);
      divider.removeEventListener('pointerup', up);
      setSplit(editorPane.getBoundingClientRect().width, true);
    }
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', up);
  });

  /* Windows Terminal's resize-pane: 5% of the width a press */
  function nudgeSplit(dir) {
    if (divider.offsetParent === null) return false;   /* no split showing */
    setSplit(editorPane.getBoundingClientRect().width +
      dir * split.getBoundingClientRect().width * 0.05, true);
    return true;
  }

  /* Buttons declaring data-key bind themselves, so a tool adds a shortcut
     by naming it in its config and nothing here needs to change. The same
     key goes into the button's tooltip and the shortcuts panel. */
  var keyed = Array.prototype.slice.call(document.querySelectorAll('.toolbar button[data-key]'));
  keyed.forEach(function (b) { b.title += ' (' + keyText(b.dataset.key) + ')'; });

  /* every declared toolbar action except Open, which General lists; Format
     keeps Ctrl/⌘+Enter as a second key */
  var fmtBtn = $('btnFormat');
  shortcuts([{ title: config.label, items: keyed.filter(function (b) {
    return b.id !== 'btnLoad';
  }).map(function (b) {
    var keys = [b.dataset.key];
    if (b === fmtBtn && keys[0] !== 'mod+enter') keys.push('mod+enter');
    return { keys: keys, label: labelOf(b) };
  }).concat([
    { keys: ['shift+alt+left', 'shift+alt+right'], label: 'Resize the split' },
    { keys: ['alt+z'], label: 'Wrap long values' },
    { keys: ['mod+shift+]'], label: 'Expand all' },
    { keys: ['mod+shift+['], label: 'Collapse all' },
    { keys: ['enter', 'f3'], label: 'Next match' },
    { keys: ['shift+enter', 'shift+f3'], label: 'Previous match' },
    { keys: ['shift+alt+c'], label: 'Copy the path of the selected row' }
  ]) }]);

  function labelOf(b) {
    var t = b.firstChild && b.firstChild.nodeType === 3 ? b.firstChild.textContent : b.textContent;
    return t.trim() || b.title;
  }

  /* keyboard */
  document.addEventListener('keydown', function (e) {
    for (var i = 0; i < keyed.length; i++) {
      if (!keyMatches(e, keyed[i].dataset.key)) continue;
      e.preventDefault();
      keyed[i].click();
      return;
    }

    if (keyMatches(e, 'mod+enter')) {
      if (fmtBtn) { e.preventDefault(); fmtBtn.click(); }
    } else if (keyMatches(e, 'mod+f')) {
      e.preventDefault();
      if (window.innerWidth <= 720) setView('tree');
      $('search').focus();
      $('search').select();
    } else if (keyMatches(e, 'shift+alt+left') || keyMatches(e, 'shift+alt+right')) {
      /* on a Mac ⌥⇧← / → select by word while typing; the editor keeps them */
      if (IS_MAC && e.target.closest && e.target.closest('textarea, input')) return;
      if (nudgeSplit(e.key === 'ArrowLeft' ? -1 : 1)) e.preventDefault();
    } else if (keyMatches(e, 'alt+z')) {
      e.preventDefault();
      $('btnWrap').click();
    } else if (keyMatches(e, 'mod+shift+]')) {
      e.preventDefault();
      $('btnExpand').click();
    } else if (keyMatches(e, 'mod+shift+[')) {
      e.preventDefault();
      $('btnCollapse').click();
    } else if (keyMatches(e, 'shift+alt+c')) {
      e.preventDefault();
      var path = $('pathBox');
      if (path.textContent) path.click();
      else showToast('Select a row first');
    }
  });

  /* ---------- arriving from another tool ----------
     The sender set a cookie naming itself. Name the format in the prompt so
     the instruction is concrete, and drop it as soon as anything is typed. */
  /* paint the empty state before anything is typed — otherwise the tree pane
     sits blank until the first parse cycle. A tool owning the pane paints
     its own. */
  if (!config.ownsPane) tree.render();

  /* the note replaces the prompt's own sentence, and goes for good with the
     first edit — coming back to an empty editor later is a fresh start */
  var from = readHandoff();
  if (from && !editor.getValue()) {
    var note = $('emptyNote');
    note.innerHTML =
      '<p class="arrived-lead">Your ' + esc(from.format || config.label) +
      ' from ' + esc(from.name) + ' is on the clipboard.</p>' +
      '<p>Press ' + kbd('mod+v') + ' to see it here.</p>';
    note.hidden = false;
    emptyPrompt.classList.add('arrived');
    var clearArrival = function () {
      note.hidden = true;
      emptyPrompt.classList.remove('arrived');
      editor.input.removeEventListener('input', clearArrival);
    };
    editor.input.addEventListener('input', clearArrival);
  }

  syncEmpty();
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

/* ---------- landing page -> tool file handoff ----------
   A file dropped on the landing page cannot ride in a URL, so the landing
   page parks it in IndexedDB ('lintone' db, 'handoff' store, key 'file',
   value {tool, file, at}) and opens the tool, which takes it exactly once:
   it is read and deleted in one transaction. A file meant for another
   tool, or older than a minute (a tab restored days later), is dropped.
   Any failure means the tool simply opens empty. */
var HANDOFF_TTL = 60000;

/* The sending side: park a file for `tool` and call back once it is
   committed, with true — or false if IndexedDB is missing, blocked or
   full, when the caller falls back to something else. */
function parkHandoff(tool, file, cb) {
  var called = false;
  var finish = function (ok) { if (!called) { called = true; cb(ok); } };
  try {
    var req = indexedDB.open('lintone', 1);
    req.onupgradeneeded = function () {
      if (!req.result.objectStoreNames.contains('handoff')) req.result.createObjectStore('handoff');
    };
    req.onsuccess = function () {
      var db = req.result;
      try {
        var tx = db.transaction('handoff', 'readwrite');
        tx.objectStore('handoff').put({ tool: tool, file: file, at: Date.now() }, 'file');
        tx.oncomplete = function () { db.close(); finish(true); };
        tx.onerror = tx.onabort = function () { db.close(); finish(false); };
      } catch (e) { db.close(); finish(false); }
    };
    req.onerror = req.onblocked = function () { finish(false); };
  } catch (e) { finish(false); }
}

function takeHandoff(toolId, cb) {
  /* The other way a file arrives: from the OS. Once lint.one is installed,
     "Open with lint.one" (or a double-click, if the user made it the
     default) launches the page its manifest file_handler names, and the
     browser queues the file here. Every tool calls takeHandoff once at
     boot, so each takes its own files without further wiring. */
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(function (params) {
      var handle = params.files && params.files[0];
      if (handle) handle.getFile().then(cb, function () {});
    });
  }
  /* The third: from the lint.one browser extension (extension/). Its
     content script on this page holds the file — a selection, a link, a
     raw JSON page, a DevTools response — and posts it here once the page
     says it is listening. postMessage clones the File within this tab, so
     it never rides in a URL or touches a server. Only this window's own
     messages count; another site cannot post to a page it did not open,
     and one it did open is a different window. */
  window.addEventListener('message', function (e) {
    if (e.source !== window || e.origin !== location.origin) return;
    var d = e.data;
    if (!d || typeof d.lintone !== 'string') return;
    if (d.lintone === 'ping') {
      window.postMessage({ lintone: 'ready', tool: toolId }, location.origin);
    } else if (d.lintone === 'file' && d.file instanceof Blob) {
      cb(d.file);
    } else if (d.lintone === 'error' && typeof d.message === 'string') {
      showToast(d.message);
    }
  });
  window.postMessage({ lintone: 'ready', tool: toolId }, location.origin);
  try {
    var req = indexedDB.open('lintone', 1);
    req.onupgradeneeded = function () {
      if (!req.result.objectStoreNames.contains('handoff')) {
        req.result.createObjectStore('handoff');
      }
    };
    req.onsuccess = function () {
      var db = req.result, value = null;
      try {
        var tx = db.transaction('handoff', 'readwrite');
        var store = tx.objectStore('handoff');
        var get = store.get('file');
        get.onsuccess = function () {
          value = get.result;
          if (value) store.delete('file');
        };
        /* only once the delete is committed, so a reload cannot open it twice */
        tx.oncomplete = function () {
          db.close();
          if (value && value.tool === toolId && value.file &&
              Date.now() - value.at < HANDOFF_TTL) cb(value.file);
        };
        tx.onerror = tx.onabort = function () { db.close(); };
      } catch (e) { db.close(); }
    };
    req.onerror = function () {};
  } catch (e) {}
}

/* Copy a converted document, then offer to open the tool that reads it —
   with the document already in it. Following the offer parks the text in
   IndexedDB as a File, exactly as the landing page parks a dropped file,
   and opens the tool, whose takeHandoff takes it. It never rides in a URL
   and never leaves the device. The copy stays too, for pasting elsewhere.
   from = the id of the tool doing the sending; to = the id it converts into. */
var CONVERT_EXT = { json: 'json', yaml: 'yaml', csv: 'csv', xml: 'xml' };

function copyAndOffer(text, label, from, to) {
  var dest = null;
  for (var i = 0; i < SUITE.length; i++) if (SUITE[i].id === to) dest = SUITE[i];
  var done = function () {
    showToast(label + ' copied',
      dest ? { label: 'Open in ' + dest.name + ' viewer', href: dest.host + '/',
               onFollow: function () { openConverted(text, label, from, dest); } } : null);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
  } else fallbackCopy(text, done);
}

/* The name the converted document arrives under: the open file's own name
   with the new extension (deploy.yaml -> deploy.json), or, for pasted text
   and samples, where it came from (from-yaml.json). */
function convertedName(from, to) {
  var ext = CONVERT_EXT[to] || 'txt';
  var chip = document.querySelector('.doc-name');
  var name = chip ? chip.textContent.trim() : '';
  var m = /^(.+)\.[A-Za-z0-9]{1,8}$/.exec(name);
  return (m ? m[1] : 'from-' + from) + '.' + ext;
}

function openConverted(text, label, from, dest) {
  var url = dest.host + '/';
  /* the tab is opened now, while the click still counts as the person's,
     so no popup blocker stands in the way; it is sent to the tool once the
     document is parked, so the tool cannot look before it is there */
  var w = window.open('', '_blank');
  if (w) try { w.opener = null; } catch (e) {}
  var file = new File([text], convertedName(from, dest.id), { type: 'text/plain' });
  parkHandoff(dest.id, file, function (ok) {
    /* without IndexedDB the clipboard is still the way: the destination
       then asks for a paste and names what is waiting */
    if (!ok) writeHandoff(from, label);
    if (w) w.location.replace(url);
    else location.href = url;
  });
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

/* The chrome every page shares: the lint.one menu in front of the tool's
   brand, and the theme menu in `slot`. init() calls it for the editor
   tools; Logs, PDF and Audio build their own frame and call it directly. */
function mountChrome(slot, activeId) {
  buildSuiteMark(activeId);
  buildThemeMenu(slot);
}

global.LintApp = {
  init: init,
  mountChrome: mountChrome,
  wireMenu: wireMenu,
  closeMenus: closeAllMenus,
  isMac: IS_MAC,
  textZoom: textZoom,
  shortcuts: shortcuts,
  showShortcuts: showShortcuts,
  setDocument: setDocument,
  keyText: keyText,
  copyAndOffer: copyAndOffer,
  takeHandoff: takeHandoff,
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
