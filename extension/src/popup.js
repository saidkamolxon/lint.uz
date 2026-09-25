/* lint.one extension — the toolbar popup: open the page you are on, open
   something you paste, open a tool, and the one setting. */
(function () {
  'use strict';
  var F = self.LintFormats;
  var BASE = self.LINT_BASE;
  var ALL_SITES = ['http://*/*', 'https://*/*'];
  var TEXT_TOOLS = ['json', 'xml', 'yaml', 'csv', 'log'];
  var $ = function (id) { return document.getElementById(id); };
  var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  function tint(el, tool) {
    if (tool && F.BY_ID[tool]) el.style.setProperty('--tool-hue', F.BY_ID[tool].hue);
    else el.style.removeProperty('--tool-hue');
  }

  function tile(el, tool) {
    el.className = el.className.replace(/\bdot-\S+/g, '').trim() + ' dot-' + (tool || 'none');
  }

  /* hand a message to the worker and close; it answers at once, so the
     popup going away cannot cut the work short */
  function tell(msg) {
    chrome.runtime.sendMessage(msg).then(function () { window.close(); }, function () { window.close(); });
  }

  function openTab(url) {
    chrome.tabs.create({ url: url }).then(function () { window.close(); });
  }

  $('home').addEventListener('click', function (e) { e.preventDefault(); openTab(BASE + '/'); });

  /* ---------- this page ---------- */
  function nameFromUrl(url) {
    try {
      var u = new URL(url);
      var seg = u.pathname.split('/').filter(Boolean).pop();
      return seg ? decodeURIComponent(seg) : u.hostname;
    } catch (e) { return ''; }
  }

  chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
    var tab = tabs[0];
    /* not the Audio tool itself: it is the one listening */
    if (tab && tab.audible && (tab.url || '').indexOf(BASE + '/audio/') !== 0) {
      var where = '';
      try { where = new URL(tab.url).hostname; } catch (e) {}
      $('listenMeta').textContent = 'Live spectrum' + (where ? ' · ' + where : '');
      tint($('listen'), 'audio');
      $('listenBtn').onclick = function () {
        /* the first time, Chrome asks for tab capture here; listening then
           needs one more click, which Chrome counts only once it is held */
        chrome.permissions.contains({ permissions: ['tabCapture'] }).then(function (ok) {
          if (ok) { tell({ kind: 'listen', tabId: tab.id }); return; }
          chrome.permissions.request({ permissions: ['tabCapture'] }).then(function (granted) {
            if (!granted) return;
            $('listenMeta').textContent = 'Allowed — open this menu again and click Listen';
          }, function () {});
        });
      };
      $('listen').hidden = false;
    }
    if (!tab || !/^https?:/.test(tab.url || '')) return;
    var name = nameFromUrl(tab.url);
    var host = new URL(tab.url).hostname;

    function show(tool) {
      if (!tool) return;
      var t = F.BY_ID[tool];
      $('pageName').textContent = F.nameFor(name, tool);
      $('pageMeta').textContent = t.name + ' · ' + host;
      tile($('pageTile'), tool);
      tint($('page'), tool);
      $('pageBtn').setAttribute('aria-label', 'Open this page in lint.one ' + t.name);
      $('pageBtn').onclick = function () { tell({ kind: 'page', tabId: tab.id }); };
      $('page').hidden = false;
    }

    /* opening the popup lets it look at this one tab (activeTab), so it
       can ask the page what it is rather than guess from the address */
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: function () {
        var pre = document.body && document.body.querySelector(':scope > pre');
        return { type: document.contentType || '', head: pre ? pre.textContent.slice(0, 4096) : null };
      }
    }).then(function (r) {
      var info = r && r[0] && r[0].result;
      if (!info) { show(F.byName(name)); return; }
      if (F.isWebPage(info.type)) return;
      var tool = F.pick(name, info.type, info.head);
      if (!tool && !/^(image|video|font)\//.test(info.type) && info.head != null) tool = F.sniffText(info.head);
      show(tool);
    }, function () {
      /* a page that will not take a script — the built-in PDF viewer, a
         Chrome page: the address is all there is */
      show(F.byName(name));
    });
  });

  /* ---------- paste ---------- */
  var paste = $('paste'), asBtn = $('asBtn'), asMenu = $('asMenu'), openBtn = $('openPaste');
  var chosen = null, detected = null, timer = null;

  $('openKeys').innerHTML = '<kbd>' + (IS_MAC ? '⌘' : 'Ctrl') + '</kbd><kbd>Enter</kbd>';

  function current() { return chosen || detected; }

  function refresh() {
    var text = paste.value;
    detected = text.trim() ? F.sniffText(text) : null;
    if (!text.trim()) chosen = null;
    var tool = current();
    asBtn.disabled = !tool;
    openBtn.disabled = !tool;
    $('asName').textContent = tool ? F.BY_ID[tool].name : 'Format';
    asBtn.title = tool ? (chosen ? 'Opening as ' : 'Looks like ') + F.BY_ID[tool].name + ' — choose another' : '';
    tile($('asTile'), tool);
    tint(document.querySelector('.paste'), tool);
    openBtn.textContent = tool ? 'Open in ' + F.BY_ID[tool].name : 'Open';
  }

  paste.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(refresh, 80);
  });

  function openPasted() {
    var tool = current();
    if (!tool || !paste.value.trim()) return;
    tell({ kind: 'text', text: paste.value, tool: tool, name: 'pasted' });
  }
  openBtn.addEventListener('click', openPasted);
  paste.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); refresh(); openPasted(); }
  });

  /* the format menu: detection is a guess, and the person has the last word */
  function closeMenu() {
    asMenu.classList.remove('open');
    asBtn.setAttribute('aria-expanded', 'false');
  }
  function buildMenu() {
    asMenu.textContent = '';
    var label = document.createElement('div');
    label.className = 'menu-label';
    label.textContent = 'Open as';
    asMenu.appendChild(label);
    TEXT_TOOLS.forEach(function (id) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-item';
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', String(current() === id));
      b.innerHTML = '<span class="tool-tile dot-' + id + '" aria-hidden="true"></span><span></span>' +
        '<span class="tick" aria-hidden="true">✓</span>';
      b.children[1].textContent = F.BY_ID[id].name + (detected === id ? ' (detected)' : '');
      b.addEventListener('click', function () {
        chosen = id === detected ? null : id;
        closeMenu();
        refresh();
        paste.focus();
      });
      asMenu.appendChild(b);
    });
  }
  asBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (asMenu.classList.contains('open')) { closeMenu(); return; }
    buildMenu();
    asMenu.classList.add('open');
    asBtn.setAttribute('aria-expanded', 'true');
    var first = asMenu.querySelector('[aria-checked="true"]') || asMenu.querySelector('.menu-item');
    if (first) first.focus();
  });
  document.addEventListener('click', function (e) { if (!asMenu.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && asMenu.classList.contains('open')) { e.preventDefault(); closeMenu(); asBtn.focus(); }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && asMenu.classList.contains('open')) {
      e.preventDefault();
      var items = Array.prototype.slice.call(asMenu.querySelectorAll('.menu-item'));
      var i = items.indexOf(document.activeElement);
      i = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[i].focus();
    }
  });

  refresh();
  paste.focus();

  /* ---------- tools ---------- */
  var grid = $('tools');
  F.TOOLS.forEach(function (t) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tool-btn';
    b.style.setProperty('--tool-hue', t.hue);
    b.innerHTML = '<span class="tool-tile tile-md dot-' + t.id + '" aria-hidden="true"></span><span></span>';
    b.children[1].textContent = t.name;
    b.title = 'Open the ' + t.name + ' tool';
    b.addEventListener('click', function () { openTab(BASE + '/' + t.id + '/'); });
    grid.appendChild(b);
  });

  /* ---------- the setting ---------- */
  var sw = $('autoSwitch');

  function showSwitch(on) { sw.setAttribute('aria-checked', String(!!on)); }

  Promise.all([
    chrome.storage.local.get('auto'),
    chrome.permissions.contains({ origins: ALL_SITES })
  ]).then(function (r) {
    var want = !!r[0].auto, may = r[1];
    /* a request the person turned down (or the popup closing on Chrome's
       prompt) leaves the wish without the access; forget the wish */
    if (want && !may) chrome.storage.local.set({ auto: false });
    showSwitch(want && may);
  });

  sw.addEventListener('click', function () {
    var on = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-busy', 'true');
    if (on) {
      /* the wish is saved first: Chrome's prompt can close this popup, and
         the worker then finishes the job when the access arrives */
      chrome.storage.local.set({ auto: true }).then(function () {
        return chrome.permissions.request({ origins: ALL_SITES });
      }).then(function (granted) {
        if (!granted) return chrome.storage.local.set({ auto: false }).then(function () { return false; });
        chrome.runtime.sendMessage({ kind: 'sync-auto' }).catch(function () {});
        return true;
      }).then(function (ok) {
        showSwitch(ok);
        sw.removeAttribute('aria-busy');
      }, function () {
        showSwitch(false);
        sw.removeAttribute('aria-busy');
      });
    } else {
      chrome.storage.local.set({ auto: false }).then(function () {
        return chrome.permissions.remove({ origins: ALL_SITES });
      }).catch(function () {}).then(function () {
        showSwitch(false);
        sw.removeAttribute('aria-busy');
      });
    }
  });
})();
