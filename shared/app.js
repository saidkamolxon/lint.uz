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

/* ---------- the ten tools, for the suite switcher, most used first ---------- */
/* Paths on one domain rather than a subdomain each: a search engine pools a
   site's authority across its paths, but treats subdomains as separate sites
   and splits it. Relative hrefs also keep local development working. */
var SUITE = [
  { id: 'json', name: 'JSON', host: '/json' },
  { id: 'yaml', name: 'YAML', host: '/yaml' },
  { id: 'csv',  name: 'CSV',  host: '/csv'  },
  { id: 'env', name: 'ENV', host: '/env' },
  { id: 'log',  name: 'LOG',  host: '/log'  },
  { id: 'har',  name: 'HAR',  host: '/har'  },
  { id: 'xml',  name: 'XML',  host: '/xml'  },
  { id: 'cert', name: 'CERT', host: '/cert' },
  { id: 'sqlite', name: 'SQLite', host: '/sqlite' },
  { id: 'pdf',  name: 'PDF',  host: '/pdf'  },
  { id: 'parquet', name: 'Parquet', host: '/parquet' },
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

/* Save text or bytes as a file on the device: an object URL on a
   throwaway link, so nothing is uploaded anywhere. */
function download(data, name, type) {
  var url = URL.createObjectURL(data instanceof Blob ? data
    : new Blob([data], { type: type || 'text/plain' }));
  var a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  showToast('Saved ' + name);
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

/* ---------- quick tooltips ----------
   An icon says little on its own, and a browser's own tooltip waits about
   a second, which reads as nothing there. A button with no text of its own
   shows its title at once below it (above, near the bottom of the page),
   on hover and on keyboard focus; moving along a row of icons keeps it up.
   The title is lifted off while the tip shows, so the two never stack,
   and put back after unless the page gave the button a new one meanwhile.
   Any other element can ask for one with data-quick-tip="…". */
(function () {
  var tip = null, timer = null, cur = null, warmUntil = 0;

  function target(el) {
    var q = el && el.closest ? el.closest('[data-quick-tip]') : null;
    if (q) return q;
    var b = el && el.closest ? el.closest('button, [role="button"]') : null;
    if (!b || b.disabled || b.closest('.menu')) return null;
    if (!b.title && !b.dataset.tipText) return null;
    return (b.textContent || '').trim() ? null : b;
  }

  function show(b) {
    if (cur && cur !== b) hide();
    cur = b;
    if (b.title && !b.dataset.quickTip) { b.dataset.tipText = b.title; b.removeAttribute('title'); }
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'quick-tip';
      tip.setAttribute('role', 'tooltip');
      document.body.appendChild(tip);
    }
    tip.textContent = b.dataset.quickTip || b.dataset.tipText;
    tip.hidden = false;
    var r = b.getBoundingClientRect(), t = tip.getBoundingClientRect();
    var left = Math.max(6, Math.min(r.left + r.width / 2 - t.width / 2, window.innerWidth - t.width - 6));
    var top = r.bottom + 6;
    if (top + t.height > window.innerHeight - 6) top = r.top - t.height - 6;
    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
  }

  function hide() {
    clearTimeout(timer);
    if (cur) {
      if (!cur.title && cur.dataset.tipText) cur.title = cur.dataset.tipText;
      delete cur.dataset.tipText;
      warmUntil = Date.now() + 400;
      cur = null;
    }
    if (tip) tip.hidden = true;
  }

  document.addEventListener('pointerover', function (e) {
    if (e.pointerType !== 'mouse') return;
    var b = target(e.target);
    if (b === cur) return;
    if (!b) { if (cur) hide(); return; }
    clearTimeout(timer);
    if (Date.now() < warmUntil || cur) show(b);
    else timer = setTimeout(function () { show(b); }, 300);
  });
  document.addEventListener('focusin', function (e) {
    var b = target(e.target);
    if (b && b.matches(':focus-visible')) show(b);
  });
  document.addEventListener('focusout', function () { if (cur) hide(); });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
  window.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
})();

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

/* ---------- Convert to ▾ and Export ▾ ----------
   Every way out of a document, in the same two places in every tool. The
   editor tools get them from init(); LOG, HAR, SQLite and Parquet put
   toolMenuHTML in their own toolbar and call wireToolMenus. Before each
   opening a menu hides the items a tool has said do not apply, so it never
   offers what would only answer with "that does not work here". A tool
   says so with LintApp.when(id, fn) from its own script, where its state
   lives; fn gets the editor text and returns whether to show the item. */
var itemRules = {};
function when(id, fn) { itemRules[id] = fn; }

/* The markup of one of them. The items keep the ids a tool binds, so a
   handler cannot tell a menu item from the toolbar button it replaced.
   `fold` hides it on a phone, where the ⋮ lists its items instead. */
function toolMenuHTML(id, label, items, fold) {
  if (!items.length) return '';
  return '<div class="menu-wrap tool-menu' + (fold ? ' hide-sm' : '') + '">' +
    '<button id="' + id + '" class="menu-btn" aria-haspopup="true">' +
      label + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>' +
    '</button>' +
    '<div class="menu menu-start" role="menu" aria-label="' + label + '">' +
    items.map(function (it) {
      if (it.sep) return '<div class="menu-sep"></div>';
      return '<button id="' + it.id + '" class="menu-item" role="menuitem"' +
        (it.key ? ' data-key="' + it.key + '"' : '') +
        (it.title ? ' title="' + esc(it.title).replace(/"/g, '&quot;') + '"' : '') + '>' +
        esc(it.label) + '</button>';
    }).join('') +
    '</div>' +
  '</div>';
}

function wireToolMenus(getText) {
  var wraps = document.querySelectorAll('.toolbar .tool-menu');
  for (var i = 0; i < wraps.length; i++) (function (wrap) {
    var btn = wrap.querySelector('.menu-btn'), menu = wrap.querySelector('.menu');
    wireMenu(btn, menu);
    menu.addEventListener('click', function (e) {
      if (e.target.closest('.menu-item')) closeAllMenus();
    });
    menu._refresh = function () { refreshToolMenu(menu, itemRules, getText()); };
    btn.addEventListener('click', menu._refresh, true);
    /* hung from the right of its button, unless that runs off the page */
    btn.addEventListener('click', function () {
      if (!menu.classList.contains('open')) return;
      menu.classList.add('menu-start');
      if (menu.getBoundingClientRect().right > window.innerWidth - 8) menu.classList.remove('menu-start');
    });
  })(wraps[i]);
}

function refreshToolMenu(menu, specs, text) {
  var items = menu.querySelectorAll('.menu-item');
  for (var i = 0; i < items.length; i++) {
    var fn = specs[items[i].id], show = true;
    /* a rule that fails leaves its item showing: the handler still answers */
    if (fn) try { show = !!fn(text); } catch (e) { show = true; }
    items[i].hidden = !show;
  }
  /* a separator only between two groups that both still show something */
  var kids = menu.children, lastShown = null;
  for (var k = 0; k < kids.length; k++) {
    var el = kids[k];
    if (el.classList.contains('menu-sep')) {
      el.hidden = !lastShown || lastShown.classList.contains('menu-sep');
      if (!el.hidden) lastShown = el;
    } else if (!el.hidden) lastShown = el;
  }
  if (lastShown && lastShown.classList.contains('menu-sep')) lastShown.hidden = true;
  /* nothing applies: say so, rather than open an empty box */
  var note = menu.querySelector('.menu-empty');
  if (!lastShown) {
    if (!note) menu.appendChild(Object.assign(document.createElement('div'),
      { className: 'menu-label menu-empty', textContent: 'Nothing here for this document' }));
  } else if (note) note.remove();
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
    var hidden = document.querySelectorAll('.toolbar button.hide-sm, .toolbar button.hide-md, ' +
      '.toolbar .tool-menu.hide-sm, .toolbar .tool-menu.hide-md');
    var added = 0;
    for (var i = 0; i < hidden.length; i++) {
      var src = hidden[i];
      if (src.offsetParent !== null) continue;   /* still visible — skip */
      /* a folded Convert to or Export brings its items, under its name */
      if (src.classList.contains('tool-menu')) {
        if (added || items.length) {
          mirror.appendChild(Object.assign(document.createElement('div'), { className: 'menu-sep' }));
        }
        mirror.appendChild(Object.assign(document.createElement('div'), {
          className: 'menu-label', textContent: src.querySelector('.menu-btn').textContent
        }));
        var subs = src.querySelectorAll('.menu .menu-item');
        for (var j = 0; j < subs.length; j++) mirror.appendChild(mirrorItem(subs[j]));
        added++;
        continue;
      }
      if (!added && items.length) {
        mirror.appendChild(Object.assign(document.createElement('div'), { className: 'menu-sep' }));
      }
      mirror.appendChild(mirrorItem(src));
      added++;
    }
    wrap.style.display = added || items.length ? '' : 'none';
  }

  /* a stand-in that clicks the real control, which keeps its handlers */
  function mirrorItem(source) {
    var item = document.createElement('button');
    item.className = 'menu-item';
    item.setAttribute('role', 'menuitem');
    /* the label only — not any icon markup rendered after it */
    item.textContent = source.firstChild && source.firstChild.nodeType === 3
      ? source.firstChild.textContent : source.textContent || source.title;
    item.title = source.title || '';
    item.hidden = source.hidden;
    item.addEventListener('click', function () {
      closeAllMenus();
      source.click();
    });
    return item;
  }

  /* folded menus check what applies each time the ⋮ opens, as they would */
  btn.addEventListener('click', function () {
    if (!document.querySelector('.toolbar .tool-menu.hide-sm, .toolbar .tool-menu.hide-md')) return;
    var ms = document.querySelectorAll('.toolbar .tool-menu .menu');
    for (var i = 0; i < ms.length; i++) if (ms[i]._refresh) ms[i]._refresh();
    rebuild();
  }, true);

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

/* The first screen of every tool says where the shortcuts are; its key is
   Ctrl/⌘+/, since a ? typed into an editor is text. A click opens it too. */
var SHORTCUTS_HINT = '<p class="shortcuts-hint"><button type="button" data-shortcuts>' +
  'Keyboard shortcuts ' + kbd('mod+/') + '</button></p>';
document.addEventListener('click', function (e) {
  if (e.target.closest && e.target.closest('[data-shortcuts]')) showShortcuts();
});

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

  /* A document that arrives — into an empty viewer, from a file, a sample
     or a paste that replaces most of the text — unfolds from the top, as a
     branch does when opened. Typing, formatting and searching redraw the
     tree in place. */
  var arriving = false;
  this.arrive = function () { arriving = true; };
  this.setData = function (value, has) {
    var fresh = has && (arriving || !self.hasData);
    arriving = false;
    root = value;
    self.hasData = has;
    self.render();
    if (fresh) unveil();
  };

  /* A clip, not a height: it costs no layout, so a long tree unfolds as
     smoothly as a short one. */
  function unveil() {
    var first = el.firstElementChild;
    if (!first || !first.animate || (still && still.matches)) return;
    var ms = Math.round(Math.min(420, 240 + first.getBoundingClientRect().height * 0.06));
    first.animate(
      [{ clipPath: 'inset(0 0 100% 0)', opacity: 0.3, transform: 'translateY(-6px)' },
       { clipPath: 'inset(0 0 0 0)', opacity: 1, transform: 'none' }],
      { duration: ms, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
  }

  this.query = function () { return searchBox.value.trim().toLowerCase(); };

  /* A search is a detour: when it is cleared the tree comes back as it was
     before, with the branches the reader had opened, and with the row they
     reached — the one they selected, or else the one at the top of the view
     — opened to and held at the same height on screen. */
  var lastQuery = '';
  var openBefore = null;       // chains of the branches open when a search began

  function chainsOpen() {
    var out = [], open = el.querySelectorAll('.node.open');
    for (var i = 0; i < open.length && out.length < ROW_BUDGET; i++) {
      var c = chains.get(open[i].querySelector(':scope > .row'));
      if (c) out.push(c);
    }
    return out;
  }

  function placeHeld() {
    var top = el.getBoundingClientRect().top;
    var row = selected && el.contains(selected) ? selected : null;
    if (!row) {
      var rows = el.querySelectorAll('.row');
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].getBoundingClientRect().bottom > top + 1) { row = rows[i]; break; }
      }
    }
    var chain = row && chains.get(row);
    return chain ? { chain: chain, pick: row === selected, offset: row.getBoundingClientRect().top - top } : null;
  }

  function comeBack(opened, held) {
    (opened || []).slice().sort(function (a, b) { return a.length - b.length; }).forEach(function (c) {
      var row = reveal(c);
      if (row) toggle(row.parentElement, true);
    });
    if (!held) return;
    var row = reveal(held.chain);
    if (!row) return;
    if (held.pick) selectRow(row);
    el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - held.offset;
  }

  this.render = function () {
    var q = self.query();
    var cleared = !q && lastQuery;
    if (q && !lastQuery) openBefore = self.hasData ? chainsOpen() : null;
    var held = cleared ? placeHeld() : null;
    lastQuery = q;

    el.innerHTML = '';
    el.classList.remove('stale');
    selected = null;
    pathBox.textContent = '';
    paintRowCopy(null);
    if (!self.hasData) {
      el.innerHTML = emptyHTML;
      matchCount.textContent = '';
      return;
    }
    hits = []; hitIdx = -1;
    stepNav.hidden = true;
    if (q && !stepMode) { renderFiltered(q); return; }
    matchCount.textContent = '';
    var node = makeNode(adapter.rootEntry(root), q, []);
    el.appendChild(node);
    /* back from a search: exactly the branches that were open before it,
       not the default depth, so one the reader had closed stays closed */
    if (cleared && openBefore) comeBack(openBefore, held);
    else { autoExpand(node, autoDepth); if (cleared) comeBack(null, held); }
    if (cleared) openBefore = null;
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

  /* ---------- opening and closing branches ----------
     Every branch the reader opens or closes, one or many at once, goes
     through change(): Expand all, Collapse all, a click, the arrow keys,
     Alt/Option-click and the row menu alike. Only the outermost blocks that
     change move; whatever changes inside them goes with them. Drawing the
     tree for a document, a search or a match opens branches with toggle()
     unanimated: the arriving tree unveils as one (see unveil). */
  function change(nodes, open, animate) {
    var moving = [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var entry = info.get(node.querySelector(':scope > .row'));
      if (!entry || adapter.childCount(entry) === 0) continue;
      if (open && !node.dataset.loaded) renderChildren(node, entry, self.query());
      var box = node.querySelector(':scope > .children');
      /* a fold still running is overtaken by whatever comes next */
      if (box && box._fold) {
        box._fold.cancel(); box._fold = null;
        box.classList.remove('drawing', 'retracting');
        /* a close cut short still finishes its work, inner branches too */
        var close = box._close;
        box._close = null;
        if (close) close();
      }
      if (node.classList.contains('open') !== open) moving.push(node);
    }
    if (!moving.length) return;
    var inSet = new Set(moving);
    var outer = moving.filter(function (n) {
      for (var p = n.parentElement; p && p !== el; p = p.parentElement) if (inSet.has(p)) return false;
      return true;
    });
    if (open) {
      moving.forEach(function (n) { n.classList.add('open'); });
      if (animate) outer.forEach(function (n) { slide(n.querySelector(':scope > .children'), true); });
      return;
    }
    outer.forEach(function (n) {
      /* the branches inside close with it, once it has gone */
      var inner = moving.filter(function (m) { return m !== n && n.contains(m); });
      function shut() {
        n.classList.remove('open');
        inner.forEach(function (m) { m.classList.remove('open'); });
      }
      if (!animate || !slide(n.querySelector(':scope > .children'), false, shut)) shut();
    });
  }

  function toggle(node, force, animate) {
    var open = force !== undefined ? force : !node.classList.contains('open');
    change([node], open, animate);
  }
  this.toggle = toggle;

  /* A block slides down from under its row as it opens, its guide line
     growing with it, and back up as it closes; the same time and curve both
     ways. A block too tall to slide smoothly is unveiled or veiled with a
     clip instead, which costs no layout. Nothing moves for a reader who asks
     for less motion. Returns whether it moves, and calls `done` once it has. */
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)');
  var TALL = 1600;
  function slide(box, opening, done) {
    if (!box || !box.animate || (still && still.matches)) return false;
    var h = box.getBoundingClientRect().height;
    if (!h) return false;
    var ms = Math.round(Math.min(opening ? 300 : 260, 150 + Math.min(h, TALL) * 0.1));
    var frames;
    if (h > TALL || box.childElementCount > 150) {
      var hid = { clipPath: 'inset(0 0 100% 0)', opacity: 0.3 }, all = { clipPath: 'inset(0 0 0 0)', opacity: 1 };
      frames = opening ? [hid, all] : [all, hid];
    } else {
      var shut = { height: '0px', opacity: 0.2, overflow: 'hidden' };
      var full = { height: h + 'px', opacity: 1, overflow: 'hidden' };
      frames = opening ? [shut, full] : [full, shut];
    }
    var anim = box.animate(frames, { duration: ms, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
    box._fold = anim;
    box._close = opening ? null : done;
    box.style.setProperty('--draw-ms', ms + 'ms');
    box.classList.remove('drawing', 'retracting');
    void box.offsetWidth;
    box.classList.add(opening ? 'drawing' : 'retracting');
    /* finished once, by the animation or, where a hidden tab holds it
       still, by the clock */
    var ended = false;
    function finish() {
      if (ended || box._fold !== anim) return;
      ended = true;
      box._fold = null;
      box._close = null;
      box.classList.remove('drawing', 'retracting');
      if (done) done();
    }
    anim.onfinish = finish;
    setTimeout(finish, ms + 120);
    return true;
  }

  /* every branch in and under `nodes`, rendered as it goes, to the row
     budget Expand all has always kept */
  function branchesUnder(nodes) {
    var out = [], budget = ROW_BUDGET;
    (function walk(list) {
      for (var i = 0; i < list.length && budget > 0; i++) {
        var n = list[i];
        var entry = info.get(n.querySelector(':scope > .row'));
        if (!entry || adapter.childCount(entry) === 0) continue;
        budget--;
        out.push(n);
        if (!n.dataset.loaded) renderChildren(n, entry, self.query());
        var box = n.querySelector(':scope > .children');
        if (box) walk(box.querySelectorAll(':scope > .node'));
      }
    })(nodes);
    if (budget <= 0) showToast('Opened the first ' + fmtNum(ROW_BUDGET) + ' rows');
    return out;
  }
  function openAll(node) { change(branchesUnder([node]), true, true); }
  function closeInside(node) { change(Array.prototype.slice.call(node.querySelectorAll('.node.open')), false, true); }
  function closeAll(node) { change([node].concat(Array.prototype.slice.call(node.querySelectorAll('.node.open'))), false, true); }
  function isBranch(node) {
    var e = info.get(node.querySelector(':scope > .row'));
    return !!e && adapter.childCount(e) > 0;
  }

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
    var node = row.parentElement;
    if (isBranch(node)) {
      item('Expand everything inside', function () { openAll(node); });
      item('Collapse everything inside', function () { toggle(node, true, true); closeInside(node); });
      var sep2 = document.createElement('div');
      sep2.className = 'menu-sep';
      ctxMenu.appendChild(sep2);
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
  var rowCopy = $('rowCopy');
  function selectRow(row) {
    if (selected) selected.classList.remove('selected');
    selected = row;
    row.classList.add('selected');
    var entry = info.get(row);
    pathBox.textContent = entry ? adapter.path(entry) : '';
    paintRowCopy(entry);
  }

  /* the path is the status bar's own; every other copy a row offers sits
     beside it as a small button */
  function paintRowCopy(entry) {
    if (!rowCopy) return;
    rowCopy.innerHTML = '';
    if (!entry) return;
    adapter.actions(entry).slice(1).forEach(function (a) {
      var b = document.createElement('button');
      var what = a.toastLabel || a.label;
      b.textContent = 'Copy ' + (what === 'Value' ? 'value' : what);
      b.title = a.title;
      b.addEventListener('click', function () { copyText(a.get(), what); });
      rowCopy.appendChild(b);
    });
  }


  el.addEventListener('click', function (e) {
    var row = e.target.closest('.row');
    if (!row || !el.contains(row) || e.target.closest('button')) return;
    var node = row.parentElement;
    /* Alt/Option-click takes the whole branch: open everything inside, or
       close it with everything inside */
    if (e.altKey && isBranch(node)) {
      if (node.classList.contains('open')) closeAll(node); else openAll(node);
    } else toggle(node, undefined, true);
    selectRow(row);
  });

  el.addEventListener('keydown', function (e) {
    var row = e.target.closest('.row');
    if (!row) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); }
    else if (e.key === 'ArrowRight' && e.altKey) { e.preventDefault(); openAll(row.parentElement); }
    else if (e.key === 'ArrowLeft' && e.altKey) { e.preventDefault(); closeAll(row.parentElement); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); toggle(row.parentElement, true, true); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); toggle(row.parentElement, false, true); }
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
    change(branchesUnder(el.querySelectorAll(':scope > .node')), true, true);
  });

  /* everything closes but the top, which stays open to show what it holds */
  $('btnCollapse').addEventListener('click', function () {
    var first = el.querySelector(':scope > .node');
    if (!first) return;
    toggle(first, true, true);
    closeInside(first);
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
  /* every way out of the document, in the same two places in every tool;
     Copy and Download are everyone's, so Export exists in each */
  var exportItems = lc.export || [];
  document.querySelector('.toolbar .group.tool-actions').insertAdjacentHTML('beforeend',
    toolMenuHTML('menuConvert', 'Convert to', lc.convert || [], true) +
    toolMenuHTML('menuExport', 'Export', exportItems.concat(exportItems.length ? [{ sep: true }] : [], [
      { id: 'btnCopy', label: 'Copy ' + config.label, title: 'Copy the editor contents' },
      { id: 'btnDownload', label: 'Download', key: 'mod+s', title: 'Save the editor contents as a file' }
    ]), true));
  var refreshOverflow = buildOverflowMenu(slot, (lc.more || []).concat([
    { id: 'btnSample', label: 'Load a sample', title: 'Replace the editor contents with a sample document' }
  ]));
  wireToolMenus(function () { return $('input').value; });
  /* the first screen says where the shortcuts are */
  var promptActions = document.querySelector('#emptyPrompt .empty-actions');
  if (promptActions) promptActions.insertAdjacentHTML('afterend', SHORTCUTS_HINT);

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

  /* A paste that brings most of the text is a new document arriving: its
     tree unfolds, and, where the tool can (config.formatPaste), it lands
     formatted, replaced in the same moment the browser makes the paste, so
     nothing flickers. It is set as the value, not typed in through the
     browser's editing: that path slows with every line (4,000 lines take
     seven seconds), and a large minified file would freeze the tab. So the
     way back is kept here: Ctrl/⌘+Z restores the text as it
     was pasted, until the next edit. */
  var formatNext = false;
  var asPasted = null;          // { raw, formatted } while the way back is open
  editor.input.addEventListener('paste', function (e) {
    var pasted = (e.clipboardData && e.clipboardData.getData('text')) || '';
    var inp = editor.input;
    var after = inp.value.length - (inp.selectionEnd - inp.selectionStart) + pasted.length;
    if (!pasted.length || pasted.length < after * 0.5) return;
    tree.arrive();
    formatNext = !!config.formatPaste;
  });
  editor.input.addEventListener('input', function (e) {
    asPasted = null;
    if (!formatNext || e.inputType !== 'insertFromPaste') { formatNext = false; return; }
    formatNext = false;
    var text = editor.getValue();
    var out = null;
    try { out = config.formatPaste(text); } catch (err) { out = null; }
    if (!out || out === text) return;
    editor.setValue(out);
    editor.input.setSelectionRange(0, 0);
    editor.input.scrollTop = 0;
    editor.syncScroll();
    asPasted = { raw: text, formatted: out };
    /* no button on the toast: its Enter would take the formatting back
       from someone who only meant a new line */
    showToast('Formatted as it was pasted. ' + keyText('mod+z') + ' keeps it as it came');
  });
  function keepAsPasted() {
    if (!asPasted || editor.getValue() !== asPasted.formatted) { asPasted = null; return; }
    var raw = asPasted.raw;
    asPasted = null;
    tree.arrive();
    editor.setValue(raw);
    showToast('Kept as pasted');
  }
  editor.input.addEventListener('keydown', function (e) {
    if (asPasted && keyMatches(e, 'mod+z') && editor.getValue() === asPasted.formatted) {
      e.preventDefault();
      keepAsPasted();
    }
  });

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
  /* the open file's own name when there is one; pasted text and samples
     are named after the tool (pasted.json, sample.yaml) */
  on('btnDownload', function () {
    var v = editor.getValue();
    if (!v) return;
    var ext = lc.ext || config.id;
    var name = docName && /\.[A-Za-z0-9]{1,12}$/.test(docName) ? docName
      : (/^Sample/.test(docName || '') ? 'sample' : 'pasted') + '.' + ext;
    download(v, name);
  });

  /* Closing the document: the chip's × or Alt+W. Back to the empty prompt,
     with the search cleared so the next document starts fresh. */
  function closeDocument() {
    $('search').value = '';
    editor.setValue('');
    editor.input.focus();
  }

  on('btnSample', function () {
    tree.arrive();
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
    var opened = function (text) {
      docName = file.name;
      tree.arrive();
      editor.setValue(String(text));
      showToast('Opened ' + file.name + ' (' + fmtBytes(file.size) + ')');
    };
    /* a tool whose files can be binary (a DER certificate) turns them into
       the text it edits itself */
    if (config.fileToText) {
      config.fileToText(file).then(opened, function (err) {
        showToast((err && err.message) || 'Could not read that file');
      });
      return;
    }
    var reader = new FileReader();
    reader.onload = function () { opened(reader.result); };
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
  keyed.forEach(function (b) {
    b.title += ' (' + keyText(b.dataset.key) + ')';
    /* inside a menu the key is also shown, where the eye already is */
    if (b.classList.contains('menu-item')) {
      b.appendChild(Object.assign(document.createElement('span'),
        { className: 'menu-key', textContent: keyText(b.dataset.key) }));
    }
  });

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
    { keys: ['alt+right'], label: 'Open a branch and everything inside (or ' + keyText('alt') + '-click)' },
    { keys: ['alt+left'], label: 'Close a branch and everything inside' },
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

/* The same document, opened in another tool now: for a file that belongs
   in the other one (JSON Lines that are a log, or a log that is data).
   It travels as a converted document does, with its own name. */
function openIn(text, name, to) {
  var dest = null;
  for (var i = 0; i < SUITE.length; i++) if (SUITE[i].id === to) dest = SUITE[i];
  if (!dest) return;
  var w = window.open('', '_blank');
  if (w) try { w.opener = null; } catch (e) {}
  parkHandoff(dest.id, new File([text], name, { type: 'text/plain' }), function () {
    if (w) w.location.replace(dest.host + '/');
    else location.href = dest.host + '/';
  });
}

/* ---------- JSON Lines: a log, or data? ----------
   One JSON value per line is two different things in practice: a structured
   log (pino, zap, structlog, Docker's json-file) or data (a fine-tuning set,
   an export, a batch of records). The first 30 lines decide: 'log' when most
   records carry a level, or a time and a message; 'data' otherwise; null
   when the text is not JSON Lines at all. The landing page and the extension
   keep a copy of this rule, so a file lands in the same tool whichever way
   it arrives. */
var LOG_LEVEL = ['level', 'severity', 'lvl', 'levelname', 'log.level', '@l', 'loglevel'];
var LOG_TIME = ['time', 'timestamp', 'ts', '@timestamp', '@t', 'date', 'datetime', 'asctime'];
var LOG_MSG = ['msg', 'message', '@m', '@mt', 'event', 'log'];

function jsonlKind(text) {
  var lines = String(text).split('\n'), seen = 0, logs = 0, recs = 0;
  for (var i = 0; i < lines.length && seen < 30; i++) {
    var l = lines[i].trim();
    if (!l) continue;
    seen++;
    var v;
    try { v = JSON.parse(l); } catch (e) { if (seen === 1) return null; continue; }
    if (!v || typeof v !== 'object') continue;
    recs++;
    var has = function (keys) { for (var k = 0; k < keys.length; k++) if (keys[k] in v) return true; return false; };
    if (has(LOG_LEVEL) || (has(LOG_TIME) && has(LOG_MSG))) logs++;
  }
  if (seen < 2 || recs < 2) return null;
  return logs >= recs * 0.6 ? 'log' : 'data';
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
   tools; LOG, PDF and Audio build their own frame and call it directly. */
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
  shortcutsHint: SHORTCUTS_HINT,
  setDocument: setDocument,
  keyText: keyText,
  copyAndOffer: copyAndOffer,
  openIn: openIn,
  jsonlKind: jsonlKind,
  takeHandoff: takeHandoff,
  kbd: kbd,
  emptyState: emptyState,
  esc: esc,
  copy: copyText,
  download: download,
  wireToolMenus: wireToolMenus,
  toolMenuHTML: toolMenuHTML,
  when: when,
  toast: showToast,
  fmtBytes: fmtBytes,
  fmtNum: fmtNum,
  highlightInto: highlightInto,
  STR_TRUNC: STR_TRUNC,
  THEMES: THEMES,
  SUITE: SUITE
};

})(window);
