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

/* A declared `key` renders as a hint inside the button and is bound by
   app.js — so the shortcut and the label can never drift apart. */
var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

function keyHint(key) {
  if (!key) return '';
  var parts = key.split('+');
  var out = parts.map(function (p) {
    if (p === 'mod') return IS_MAC ? '\u2318' : 'Ctrl';
    if (p === 'shift') return IS_MAC ? '\u21E7' : 'Shift';
    if (p === 'enter') return '\u21B5';
    return p.toUpperCase();
  });
  return IS_MAC ? out.join('') : out.join('+');
}

var actions = (c.actions || []).map(function (a) {
  return '<button id="' + a.id + '"' +
    (a.primary ? ' class="primary"' : ' class="bordered"') +
    (a.hide ? ' data-hide="' + a.hide + '"' : '') +
    (a.key ? ' data-key="' + a.key + '"' : '') +
    ' title="' + a.title + (a.key ? ' (' + keyHint(a.key) + ')' : '') + '">' +
    a.label +
    (a.key ? '<kbd class="kb">' + keyHint(a.key) + '</kbd>' : '') +
    '</button>';
}).join('');

document.getElementById('app').innerHTML =
'<header class="toolbar">' +
  '<a class="brand" href="https://lint.one" title="All lint.one tools">' +
    '<span class="mark">' + c.mark + '</span>' +
    '<span class="brand-text">' +
      '<span class="brand-name">' + c.name + '</span>' +
      '<span class="brand-host">' + c.host + '</span>' +
    '</span>' +
  '</a>' +
  '<nav class="tabs" aria-label="View">' +
    '<button id="tabText" class="active">Text</button>' +
    '<button id="tabTree">Tree</button>' +
  '</nav>' +
  '<div class="group">' + actions + '</div>' +
  '<span class="sep hide-sm"></span>' +
  '<div class="group hide-sm" id="fileGroup">' +
    '<button id="btnLoad" title="Open a file — or drop one on the editor">Open</button>' +
    '<button id="btnCopy" title="Copy the editor contents">Copy</button>' +
    '<button id="btnSample" title="Load a sample document">Sample</button>' +
    '<button id="btnClear" title="Empty the editor">Clear</button>' +
  '</div>' +
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
      '<button id="btnWrap" class="icon-btn" title="Wrap long values" aria-pressed="false" aria-label="Wrap long values"></button>' +
      '<button id="btnExpand" class="icon-btn" title="Expand everything" aria-label="Expand everything"></button>' +
      '<button id="btnCollapse" class="icon-btn" title="Collapse everything" aria-label="Collapse everything"></button>' +
    '</div>' +
    '<div id="tree"></div>' +
  '</section>' +
'</main>' +

'<footer class="status" id="statusBar">' +
  '<span class="dot"></span>' +
  '<span id="statusMsg">Ready</span>' +
  '<span id="pathBox" title="Click to copy"></span>' +
'</footer>';

/* responsive hiding declared per-action */
var hidden = document.querySelectorAll('[data-hide]');
for (var i = 0; i < hidden.length; i++) {
  hidden[i].classList.add('hide-' + hidden[i].dataset.hide);
}
})();
