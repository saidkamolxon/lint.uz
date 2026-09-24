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

/* A declared `key` becomes data-key. app.js binds it, names it in the
   button's tooltip and lists it in the shortcuts panel, all from that one
   attribute, so the shortcut, the tooltip and the panel cannot drift. */

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
    ' title="' + a.title + '">' +
    a.label + '</button>';
}).join('');

document.getElementById('app').innerHTML =
'<header class="toolbar">' +
  /* app.js puts the lint.one menu in front of the brand; the brand itself
     names the tool and goes nowhere */
  '<span class="brand">' +
    '<span class="brand-text">' +
      '<span class="brand-name">' + c.name + '</span>' +
    '</span>' +
  '</span>' +
  '<nav class="tabs" aria-label="View">' +
    '<button id="tabText" class="active">Text</button>' +
    '<button id="tabTree">Tree</button>' +
  '</nav>' +
  /* Open sits right after the brand in every tool, and the open document's
     chip after it; Copy and Sample live in the ⋮ menu app.js adds */
  '<button id="btnLoad" class="primary" data-key="mod+o" ' +
    'title="Open a file — or drop one on the editor">Open</button>' +
  '<span class="sep hide-sm tool-actions"></span>' +
  '<div class="group tool-actions">' + actions + '</div>' +
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
        '<button id="btnPrevHit" class="icon-btn" title="Previous match" aria-label="Previous match"></button>' +
        '<button id="btnNextHit" class="icon-btn" title="Next match" aria-label="Next match"></button>' +
      '</span>' +
      '<button id="btnSearchMode" class="icon-btn" aria-pressed="true"></button>' +
      '<button id="btnWrap" class="icon-btn" title="Wrap long values" aria-pressed="false" aria-label="Wrap long values"></button>' +
      '<button id="btnExpand" class="icon-btn" title="Expand all" aria-label="Expand all"></button>' +
      '<button id="btnCollapse" class="icon-btn" title="Collapse all" aria-label="Collapse all"></button>' +
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
