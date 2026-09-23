/* The one place the theme is read, written and offered. Loaded in <head> of
   every page so the saved theme applies before first paint; app.js and the
   landing page call LintTheme rather than keeping copies that drift. Only
   the few lines that apply the saved choice run at boot — the menu is built
   when a page asks for it, by which time there is a body to put it in. */
(function () {
  var NAME = 'lintuz_theme', LS = 'lintuz-theme';
  var C_NAME = 'lintuz_contrast', C_LS = 'lintuz-contrast';
  var root = document.documentElement;

  /* Paper, Midnight and Contrast were once menu choices. A saved one maps to
     the theme closest to it, so nobody comes back to an unstyled page;
     Contrast is now a separate switch, turned on for whoever had chosen it. */
  var RETIRED = { paper: 'daylight', midnight: 'slate', contrast: 'daylight' };

  /* Swatches are concrete colours, not var()s: the menu shows every theme
     while only one is applied. System is a diagonal of the light and dark
     surfaces, because it is whichever of the two the OS asks for. */
  var THEMES = [
    { id: '',         name: 'System', bg: '#FBFBFC', fg: '#15171C' },
    { id: 'daylight', name: 'Light',  bg: '#FFFFFF', fg: '#FFFFFF' },
    { id: 'slate',    name: 'Dark',   bg: '#15171C', fg: '#15171C' }
  ];

  function cookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function stored(name, ls) {
    var v = cookie(name);
    if (v === null) try { v = localStorage.getItem(ls); } catch (e) {}
    return v;
  }

  function save(name, ls, value) {
    var secure = location.protocol === 'https:' ? '; secure' : '';
    try {
      /* the landing page once wrote these cookies on .lint.one; a second
         cookie of the same name would shadow this one, so it is expired */
      if (/(^|\.)lint\.one$/.test(location.hostname)) {
        document.cookie = name + '=; path=/; max-age=0; domain=.lint.one';
      }
      document.cookie = name + '=' + encodeURIComponent(value) +
        '; path=/; max-age=31536000; samesite=lax' + secure;
    } catch (e) {}
    try { localStorage.setItem(ls, value); } catch (e) {}
  }

  function read() {
    var id = stored(NAME, LS) || '';
    return RETIRED.hasOwnProperty(id) ? RETIRED[id] : id;
  }

  function apply(id) {
    if (id) root.setAttribute('data-theme', id);
    else root.removeAttribute('data-theme');
  }

  function write(id) { save(NAME, LS, id); }

  /* true or false once someone has chosen, null while they never have —
     the caller then follows the OS. Whoever picked the retired Contrast
     theme chose more contrast, so that still counts as a choice. */
  function readContrast() {
    var v = stored(C_NAME, C_LS);
    if (v === '1' || v === '0') return v === '1';
    return stored(NAME, LS) === 'contrast' ? true : null;
  }

  function applyContrast(on) {
    if (on) root.setAttribute('data-contrast', 'more');
    else root.removeAttribute('data-contrast');
  }

  function writeContrast(on) { save(C_NAME, C_LS, on ? '1' : '0'); }

  /* Fill a .menu element with the theme choices and the contrast switch.
     Picking applies and saves at once; onPicked() runs afterwards so the
     caller can close its menu. No toast: the page itself just changed. */
  function buildMenu(menu, onPicked) {
    menu.textContent = '';
    menu.setAttribute('role', 'menu');

    function el(tag, cls, html) {
      var n = document.createElement(tag);
      n.className = cls;
      if (html) n.innerHTML = html;
      return n;
    }

    menu.appendChild(el('div', 'menu-label', 'Theme'));

    var current = read(), radios = [];
    THEMES.forEach(function (t) {
      var item = el('button', 'menu-item',
        '<span class="swatch" style="--sw-bg:' + t.bg + ';--sw-fg:' + t.fg + '"></span>' +
        '<span>' + t.name + '</span><span class="tick" aria-hidden="true">✓</span>');
      item.type = 'button';
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(t.id === current));
      item.addEventListener('click', function () {
        apply(t.id);
        write(t.id);
        radios.forEach(function (r) { r.setAttribute('aria-checked', String(r === item)); });
        if (onPicked) onPicked();
      });
      radios.push(item);
      menu.appendChild(item);
    });

    menu.appendChild(el('div', 'menu-sep'));

    /* the icon is the half-filled circle every OS uses for contrast */
    var box = el('button', 'menu-item',
      '<svg class="menu-icon" viewBox="0 0 16 16" aria-hidden="true">' +
        '<circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
        '<path d="M8 1.75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor"/></svg>' +
      '<span>Increase contrast</span><span class="tick" aria-hidden="true">✓</span>');
    box.type = 'button';
    box.setAttribute('role', 'menuitemcheckbox');
    box.setAttribute('aria-checked', String(root.getAttribute('data-contrast') === 'more'));
    box.addEventListener('click', function () {
      var on = root.getAttribute('data-contrast') !== 'more';
      applyContrast(on);
      writeContrast(on);
      box.setAttribute('aria-checked', String(on));
      if (onPicked) onPicked();
    });
    menu.appendChild(box);
  }

  apply(read());
  /* nothing saved: follow the OS setting as it is when the page opens */
  var contrast = readContrast();
  if (contrast === null) {
    try { contrast = matchMedia('(prefers-contrast: more)').matches; } catch (e) { contrast = false; }
  }
  applyContrast(contrast);

  window.LintTheme = {
    THEMES: THEMES,
    read: read, write: write, apply: apply,
    readContrast: readContrast, writeContrast: writeContrast, applyContrast: applyContrast,
    buildMenu: buildMenu
  };

  /* every page loads this file, so this is where the offline copy starts */
  if ('serviceWorker' in navigator) {
    addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }
})();
