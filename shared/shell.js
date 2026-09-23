/* ==========================================================================
   lint.one — shared chrome markup
   Each tool declares LINT_CONFIG before loading this file; the shell renders
   the identical frame so no tool can drift structurally from the others.
   ========================================================================== */
(function () {
'use strict';

var c = window.LINT_CONFIG;

document.documentElement.style.setProperty('--hue', c.hue);
document.documentElement.style.setProperty('--hue-ink', c.hueInk || '#FFFFFF');
/* the format's own glyph in the logo tile; app.css falls back to the suite
   mark for a page that never sets it */
document.documentElement.style.setProperty('--glyph', 'url("/shared/glyphs/' + c.id + '.svg")');

/* A declared `key` is named in the button's tooltip and bound by app.js —
   so the shortcut and the label can never drift apart. */
var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

function keyHint(key) {
  if (!key) return '';
  var parts = key.split('+');
  var out = parts.map(function (p) {
    if (p === 'mod') return IS_MAC ? '\u2318' : 'Ctrl';
    if (p === 'shift') return IS_MAC ? '\u21E7' : 'Shift';
    /* \u21B5 is a Mac keycap; a PC keyboard says Enter */
    if (p === 'enter') return IS_MAC ? '\u21B5' : 'Enter';
    return p.toUpperCase();
  });
  return IS_MAC ? out.join('') : out.join('+');
}

/* Three weights of button, so the eye reads the toolbar in order: Open is
   the one filled button in every tool, the `primary` action is outlined,
   and every other action is a quiet ghost. On a phone only Open and the
   primary action stay in the toolbar; the rest fold into the ⋮ menu unless
   they declare their own breakpoint. */
var actions = (c.actions || []).map(function (a) {
  var hide = a.hide || (a.primary ? '' : 'sm');
  return '<button id="' + a.id + '"' + (a.primary ? ' class="bordered"' : '') +
    (hide ? ' data-hide="' + hide + '"' : '') +
    (a.key ? ' data-key="' + a.key + '"' : '') +
    ' title="' + a.title + (a.key ? ' (' + keyHint(a.key) + ')' : '') + '">' +
    a.label + '</button>';
}).join('');

document.getElementById('app').innerHTML =
'<header class="toolbar">' +
  '<a class="brand" href="/" title="All tools">' +
    '<span class="mark" aria-hidden="true"></span>' +
    '<span class="brand-text">' +
      '<span class="brand-name">' + c.name + '</span>' +
    '</span>' +
  '</a>' +
  '<nav class="tabs" aria-label="View">' +
    '<button id="tabText" class="active">Text</button>' +
    '<button id="tabTree">Tree</button>' +
  '</nav>' +
  /* Open sits right after the brand in every tool; Copy, Sample and Clear
     live in the ⋮ menu that app.js adds to the chrome slot */
  '<button id="btnLoad" class="primary" data-key="mod+o" ' +
    'title="Open a file — or drop one on the editor (' + keyHint('mod+o') + ')">Open</button>' +
  '<span class="sep hide-sm"></span>' +
  '<div class="group">' + actions + '</div>' +
  '<span class="spacer"></span>' +
  '<div class="group" id="chromeSlot"></div>' +
  '<input type="file" id="fileInput" accept="' + c.accept + '" hidden>' +
'</header>' +

'<main class="split">' +
  '<section class="pane" id="editorPane" aria-label="' + c.label + ' source">' +
    '<div class="editor">' +
      '<div class="gutter" aria-hidden="true"><div class="gutter-inner" id="gutterInner"></div></div>' +
      '<div class="text-layers">' +
        '<pre id="highlight" aria-hidden="true"></pre>' +
        '<textarea id="input" spellcheck="false" autocapitalize="off" ' +
          'autocomplete="off" autocorrect="off" aria-label="' + c.label + ' input" ' +
          'placeholder="' + c.placeholder + '"></textarea>' +
      '</div>' +
    '</div>' +
    /* The first thing a visitor sees: what to do, and the two ways to start.
       It sits over the empty editor, which keeps focus, so a paste works at
       once; only its buttons take the pointer. app.js shows it while the
       editor is empty (body.is-empty). */
    '<div class="empty-prompt" id="emptyPrompt">' +
      '<div class="empty-prompt-body">' +
        '<h2>Paste ' + c.label + ' or drop a file</h2>' +
        (c.emptyLine ? '<p class="empty-line">' + c.emptyLine + '</p>' : '') +
        '<div class="empty-note" id="emptyNote" hidden></div>' +
        '<div class="empty-actions">' +
          '<button type="button" class="primary" data-empty="open">Open a file</button>' +
          '<button type="button" class="bordered" data-empty="sample">Load a sample</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<button id="errorBar" type="button" title="Jump to the problem">' +
      '<span class="emsg" id="errorMsg"></span>' +
      '<span class="loc" id="errorLoc"></span>' +
    '</button>' +
  '</section>' +

  '<div id="divider" role="separator" aria-orientation="vertical" ' +
    'title="Drag to resize"></div>' +

  '<section class="pane" id="treePane" aria-label="Structure">' +
    '<div class="treebar">' +
      '<label class="search-wrap">' +
        '<span id="searchIcon"></span>' +
        '<input id="search" type="search" placeholder="' + c.searchPlaceholder + '" ' +
          'aria-label="Search the structure">' +
      '</label>' +
      '<span id="matchCount"></span>' +
      '<span class="step-nav" id="stepNav" hidden>' +
        '<button id="btnPrevHit" class="icon-btn" title="Previous match (⇧↵)" aria-label="Previous match"></button>' +
        '<button id="btnNextHit" class="icon-btn" title="Next match (↵)" aria-label="Next match"></button>' +
      '</span>' +
      '<button id="btnSearchMode" class="icon-btn" aria-pressed="true"></button>' +
      '<button id="btnWrap" class="icon-btn" title="Wrap long values" aria-pressed="false" aria-label="Wrap long values"></button>' +
      '<button id="btnExpand" class="icon-btn" title="Expand everything" aria-label="Expand everything"></button>' +
      '<button id="btnCollapse" class="icon-btn" title="Collapse everything" aria-label="Collapse everything"></button>' +
    '</div>' +
    '<div id="tree"></div>' +
  '</section>' +
'</main>' +

'<footer class="status" id="statusBar">' +
  '<span class="dot"></span>' +
  '<span id="statusMsg"></span>' +
  '<span id="pathBox" title="Click to copy"></span>' +
'</footer>';

/* responsive hiding declared per-action */
var hidden = document.querySelectorAll('[data-hide]');
for (var i = 0; i < hidden.length; i++) {
  hidden[i].classList.add('hide-' + hidden[i].dataset.hide);
}
})();
