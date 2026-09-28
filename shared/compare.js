/* ==========================================================================
   lint.one — Compare
   The right pane's second view in JSON, YAML and XML: the editor holds the
   earlier document, a second one pasted beside it the later, and below them
   what changed. Reads like a git diff, but compares meaning rather than
   text: key order and formatting never count as changes, and arrays of
   records are paired by their id so a reordered list is not a wall of red
   and green. It works on plain data (objects, arrays, scalars), so a tool
   whose parse gives something else says how to read it with `toValue`.

   LintCompare.mount({
     app,        what LintApp.init returned
     parse,      the tool's own parse(text) -> { ok, value, message, line, col }
     label,      the format's name in messages: 'JSON', 'YAML', 'XML'
     toValue     optional: a successful parse -> plain data (default: .value)
   }) -> { comparing(), onEditorChanged() }, for the tool's onParsed.
   Depends on app.js (LintApp) and compare.css.
   ========================================================================== */
(function (global) {
'use strict';

function mount(opts) {
var app = opts.app, parse = opts.parse, label = opts.label;
var toValue = opts.toValue || function (res) { return res.value; };
var esc = LintApp.esc;
var IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
function sizeOf(v) {
  if (!v || typeof v !== 'object') return 0;
  return Array.isArray(v) ? v.length : Object.keys(v).length;
}

var $ = function (id) { return document.getElementById(id); };
var I = function (d) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
};

var CONTEXT = 3;            // unchanged lines kept either side of a change
var ROW_CAP = 20000;        // past this the documents are simply different
var LCS_CAP = 250000;       // cells; bigger arrays are paired by position
var ID_KEYS = ['id', '_id', 'uuid', 'guid', 'key', 'code', 'slug'];

/* ---------- equality, ignoring key order ---------- */
function same(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
    return true;
  }
  var ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (var j = 0; j < ka.length; j++) {
    if (!Object.prototype.hasOwnProperty.call(b, ka[j]) || !same(a[ka[j]], b[ka[j]])) return false;
  }
  return true;
}

function canon(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  return '{' + Object.keys(v).sort().map(function (k) {
    return JSON.stringify(k) + ':' + canon(v[k]);
  }).join(',') + '}';
}

var isObj = function (v) { return v !== null && typeof v === 'object' && !Array.isArray(v); };

/* ---------- which field identifies a record, if any ---------- */
function idKeyOf(a, b) {
  if (!a.length || !b.length) return null;
  if (!a.every(isObj) || !b.every(isObj)) return null;
  for (var k = 0; k < ID_KEYS.length; k++) {
    var key = ID_KEYS[k];
    var ok = [a, b].every(function (arr) {
      var seen = new Set();
      return arr.every(function (o) {
        var v = o[key];
        if (typeof v !== 'string' && typeof v !== 'number') return false;
        if (seen.has(v)) return false;
        seen.add(v);
        return true;
      });
    });
    if (!ok) continue;
    var ids = new Set(a.map(function (o) { return o[key]; }));
    if (b.some(function (o) { return ids.has(o[key]); })) return key;
  }
  return null;
}

/* ---------- pairing array items ----------
   Returns [ai, bi] pairs in reading order; either side may be -1. */
function pairById(a, b, key) {
  var at = new Map();
  a.forEach(function (o, i) { at.set(o[key], i); });
  var inB = new Set(b.map(function (o) { return o[key]; }));
  var out = [], next = 0;
  var flush = function (upto) {
    for (; next < upto; next++) if (!inB.has(a[next][key])) out.push([next, -1]);
  };
  b.forEach(function (o, j) {
    var i = at.has(o[key]) ? at.get(o[key]) : -1;
    if (i >= 0) { flush(i); if (next === i) next++; }
    out.push([i, j]);
  });
  flush(a.length);
  return out;
}

function pairBySequence(a, b) {
  var n = a.length, m = b.length;
  if (n * m > LCS_CAP) {
    var out = [];
    for (var x = 0; x < Math.max(n, m); x++) out.push([x < n ? x : -1, x < m ? x : -1]);
    return out;
  }
  var ca = a.map(canon), cb = b.map(canon);
  /* longest common subsequence of identical items, as anchors */
  var L = [];
  for (var i = 0; i <= n; i++) L.push(new Uint32Array(m + 1));
  for (i = n - 1; i >= 0; i--) {
    for (var j = m - 1; j >= 0; j--) {
      L[i][j] = ca[i] === cb[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  var res = [], ga = [], gb = [];
  /* between anchors, items that changed are paired in place so a nested
     edit reads as an edit, and the rest are added or removed */
  var gap = function () {
    var k = 0;
    for (; k < Math.min(ga.length, gb.length); k++) {
      var pa = a[ga[k]], pb = b[gb[k]];
      if (pa !== null && pb !== null && typeof pa === 'object' && typeof pb === 'object' &&
          Array.isArray(pa) === Array.isArray(pb)) res.push([ga[k], gb[k]]);
      else { res.push([ga[k], -1]); res.push([-1, gb[k]]); }
    }
    for (var r = k; r < ga.length; r++) res.push([ga[r], -1]);
    for (r = k; r < gb.length; r++) res.push([-1, gb[r]]);
    ga = []; gb = [];
  };
  i = 0; j = 0;
  while (i < n && j < m) {
    if (ca[i] === cb[j]) { gap(); res.push([i, j]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) ga.push(i++);
    else gb.push(j++);
  }
  while (i < n) ga.push(i++);
  while (j < m) gb.push(j++);
  gap();
  return res;
}

/* ---------- the diff, as a tree ----------
   One node per place the documents were compared:
     same   equal on both sides            { v }
     add    only in after                  { v }
     del    only in before                 { v }
     chg    a value replaced               { a, b }
     mod    a container with changes in it { kind: 'obj' | 'arr', kids }
   Every view — unified, split, tree — is drawn from this. */
function diffTree(x, y, key, path) {
  if (same(x, y)) return { k: 'same', key: key, path: path, v: y };

  if (isObj(x) && isObj(y)) {
    /* the after document's order, with removed keys where they used to be */
    var kx = Object.keys(x), ky = Object.keys(y);
    var order = ky.slice();
    kx.forEach(function (k, i) {
      if (Object.prototype.hasOwnProperty.call(y, k)) return;
      var prev = i > 0 ? order.indexOf(kx[i - 1]) : -1;
      order.splice(prev + 1, 0, k);
    });
    return { k: 'mod', kind: 'obj', key: key, path: path, kids: order.map(function (k) {
      var inX = Object.prototype.hasOwnProperty.call(x, k);
      var inY = Object.prototype.hasOwnProperty.call(y, k);
      var p = path.concat([k]);
      if (inX && inY) return diffTree(x[k], y[k], k, p);
      return inX ? { k: 'del', key: k, path: p, v: x[k] } : { k: 'add', key: k, path: p, v: y[k] };
    }) };
  }

  if (Array.isArray(x) && Array.isArray(y)) {
    var idKey = idKeyOf(x, y);
    var pairs = idKey ? pairById(x, y, idKey) : pairBySequence(x, y);
    return { k: 'mod', kind: 'arr', key: key, path: path, kids: pairs.map(function (pr) {
      var ia = pr[0], ib = pr[1];
      var seg = idKey ? { id: idKey, v: (ib >= 0 ? y[ib] : x[ia])[idKey] } : (ib >= 0 ? ib : ia);
      var p = path.concat([seg]);
      if (ia >= 0 && ib >= 0) return diffTree(x[ia], y[ib], seg, p);
      return ia >= 0 ? { k: 'del', key: seg, path: p, v: x[ia] } : { k: 'add', key: seg, path: p, v: y[ib] };
    }) };
  }

  return { k: 'chg', key: key, path: path, a: x, b: y };
}

/* every change, in reading order, numbered for stepping through */
function collectChanges(root) {
  var out = [];
  (function walk(n) {
    if (n.k === 'mod') {
      n.count = 0;
      n.kids.forEach(function (c) { walk(c); n.count += c.k === 'mod' ? c.count : c.k === 'same' ? 0 : 1; });
    } else if (n.k !== 'same') {
      n.ci = out.length;
      out.push(n);
    }
  })(root);
  return out;
}

/* ---------- the tree, as lines ----------
   Each line: { t: ' ' | '+' | '-', d: depth, html, path, ci } */
function keyHtml(k) { return '<span class="hl-key">' + esc(JSON.stringify(k)) + '</span><span class="hl-punct">: </span>'; }

function scalarClass(v) {
  var t = v === null ? 'null' : typeof v;
  return t === 'string' ? 'hl-str' : t === 'number' ? 'hl-num' : t === 'boolean' ? 'hl-bool' : 'hl-null';
}
function scalarHtml(v) { return '<span class="' + scalarClass(v) + '">' + esc(JSON.stringify(v)) + '</span>'; }
var isScalar = function (v) { return v === null || typeof v !== 'object'; };

/* the part of a changed value that actually differs, marked on each side */
function markedPair(a, b) {
  var sa = JSON.stringify(a), sb = JSON.stringify(b);
  var p = 0;
  while (p < sa.length && p < sb.length && sa[p] === sb[p]) p++;
  var q = 0;
  while (q < sa.length - p && q < sb.length - p && sa[sa.length - 1 - q] === sb[sb.length - 1 - q]) q++;
  var wrap = function (s, v) {
    /* a wholesale change gains nothing from marking every character */
    var mid = s.slice(p, s.length - q);
    var inner = mid.length && (p || q) && typeof v === 'string'
      ? esc(s.slice(0, p)) + '<span class="d-x">' + esc(mid) + '</span>' + esc(s.slice(s.length - q))
      : esc(s);
    return '<span class="' + scalarClass(v) + '">' + inner + '</span>';
  };
  return [wrap(sa, a), wrap(sb, b)];
}

function toLines(root) {
  var out = [];

  function emit(v, t, d, label, path, ci) {
    if (v !== null && typeof v === 'object') {
      var arr = Array.isArray(v);
      var keys = arr ? null : Object.keys(v);
      var n = arr ? v.length : keys.length;
      if (!n) { out.push({ t: t, d: d, html: label + '<span class="hl-punct">' + (arr ? '[]' : '{}') + '</span>', path: path, ci: ci }); return; }
      out.push({ t: t, d: d, html: label + '<span class="hl-punct">' + (arr ? '[' : '{') + '</span>', path: path, ci: ci });
      for (var i = 0; i < n; i++) {
        if (arr) emit(v[i], t, d + 1, '', path.concat([i]), ci);
        else emit(v[keys[i]], t, d + 1, keyHtml(keys[i]), path.concat([keys[i]]), ci);
      }
      out.push({ t: t, d: d, html: '<span class="hl-punct">' + (arr ? ']' : '}') + '</span>', path: path, ci: ci });
      return;
    }
    out.push({ t: t, d: d, html: label + scalarHtml(v), path: path, ci: ci });
  }

  (function walk(n, d, label) {
    if (n.k === 'same') return emit(n.v, ' ', d, label, n.path, -1);
    if (n.k === 'add') return emit(n.v, '+', d, label, n.path, n.ci);
    if (n.k === 'del') return emit(n.v, '-', d, label, n.path, n.ci);
    if (n.k === 'chg') {
      if (isScalar(n.a) && isScalar(n.b)) {
        var m = markedPair(n.a, n.b);
        out.push({ t: '-', d: d, html: label + m[0], path: n.path, ci: n.ci });
        out.push({ t: '+', d: d, html: label + m[1], path: n.path, ci: n.ci });
      } else {
        emit(n.a, '-', d, label, n.path, n.ci);
        emit(n.b, '+', d, label, n.path, n.ci);
      }
      return;
    }
    var obj = n.kind === 'obj';
    out.push({ t: ' ', d: d, html: label + '<span class="hl-punct">' + (obj ? '{' : '[') + '</span>', path: n.path, ci: -1 });
    n.kids.forEach(function (c) { walk(c, d + 1, obj ? keyHtml(c.key) : ''); });
    out.push({ t: ' ', d: d, html: '<span class="hl-punct">' + (obj ? '}' : ']') + '</span>', path: n.path, ci: -1 });
  })(root, 0, '');

  return out;
}

function pathText(path) {
  var s = '$';
  path.forEach(function (seg) {
    if (typeof seg === 'number') s += '[' + seg + ']';
    else if (typeof seg === 'object') s += '[' + seg.id + '=' + JSON.stringify(seg.v) + ']';
    else if (IDENT.test(seg)) s += '.' + seg;
    else s += '[' + JSON.stringify(seg) + ']';
  });
  return s;
}

/* ---------- the view ---------- */
var cmpEl = document.createElement('section');
cmpEl.id = 'compare';
cmpEl.setAttribute('aria-label', 'Compare two documents');
cmpEl.innerHTML =
  '<div class="cmp-side">' +
    '<div class="cmp-head"><span class="name">Compare with</span><span class="state" id="stateB"></span></div>' +
    '<textarea id="cmpB" spellcheck="false" autocapitalize="off" autocomplete="off" ' +
      'aria-label="' + label + ' to compare with" placeholder="Paste the newer ' + label + ' — the editor holds the earlier one…"></textarea>' +
  '</div>' +
  '<div class="cmp-body" id="cmpBody"></div>';
$('tree').after(cmpEl);

/* Tree | Compare opens the tree bar; the diff's own controls sit beside it
   and show only while comparing */
var treebar = document.querySelector('.treebar');
var modeSeg = document.createElement('span');
modeSeg.className = 'seg mode-seg';
modeSeg.setAttribute('role', 'group');
modeSeg.setAttribute('aria-label', 'Show');
modeSeg.innerHTML =
  '<button data-mode="tree" aria-pressed="true" title="The document as a tree you can search">Tree</button>' +
  '<button data-mode="compare" aria-pressed="false" title="Compare this document with another and see what changed">Compare</button>';
treebar.insertBefore(modeSeg, treebar.firstChild);

var cmpTools = document.createElement('span');
cmpTools.className = 'cmp-tools';
cmpTools.innerHTML =
  '<span class="summary" id="cmpSummary"></span>' +
  '<span class="pos" id="cmpPos"></span>' +
  '<button id="cmpPrev" class="icon-btn" aria-label="Previous change"></button>' +
  '<button id="cmpNext" class="icon-btn" aria-label="Next change"></button>' +
  '<span class="seg" role="group" aria-label="Layout">' +
    '<button data-layout="unified" title="One column, like git diff">Unified</button>' +
    '<button data-layout="split" title="Before and after side by side">Split</button>' +
    '<button data-layout="tree" title="The structure, with each change marked where it happened">Structure</button>' +
  '</span>' +
  '<button id="cmpSwap" class="icon-btn" title="Swap the two documents: the editor takes the pasted one" aria-label="Swap the two documents"></button>';
modeSeg.after(cmpTools);

var keyText = function (k) { return LintApp.kbd(k).replace(/<\/?kbd>/g, ''); };
$('cmpPrev').title = 'Previous change (' + keyText('mod+shift+g') + ')';
$('cmpNext').title = 'Next change (' + keyText('mod+g') + ')';
$('cmpPrev').innerHTML = I('<path d="M6 15l6-6 6 6"/>');
$('cmpNext').innerHTML = I('<path d="M6 9l6 6 6-6"/>');
$('cmpSwap').innerHTML = I('<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>');

var LAYOUT_KEY = 'lintuz-diff-layout';
var layout = 'unified';
try { layout = localStorage.getItem(LAYOUT_KEY) || 'unified'; } catch (e) {}
if (!/^(unified|split|tree)$/.test(layout)) layout = 'unified';

var root = null;       // the diff tree
var changes = [];      // its change nodes, in order
var lines = [];        // the tree as lines, for unified and split
var changeIdx = -1;
var cmpTimer = null;

function sideState(el, res, text) {
  if (!text.trim()) { el.className = 'state'; el.textContent = ''; return; }
  if (res.ok) { el.className = 'state ok'; el.textContent = 'Valid'; return; }
  el.className = 'state err';
  el.textContent = res.message + (res.line ? ', line ' + res.line : '');
  el.title = el.textContent;
}

function showEmpty(title, body, err) {
  $('cmpBody').innerHTML = LintApp.emptyState({ title: title, body: body });
  $('cmpBody').firstChild.classList.toggle('err', !!err);
  $('cmpSummary').textContent = '';
  $('cmpPos').textContent = '';
  root = null; changes = []; lines = []; changeIdx = -1;
}

function runCompare() {
  cmpTimer = null;
  var ta = app.editor.getValue(), tb = $('cmpB').value;
  var ra = parse(ta), rb = parse(tb);
  sideState($('stateB'), rb, tb);

  if (!ta.trim() || !tb.trim()) {
    showEmpty(!ta.trim() ? 'Put the earlier ' + label + ' in the editor' : 'Paste the ' + label + ' to compare with',
      'The editor holds the earlier document; paste the newer one above. ' +
      'Key order and formatting are ignored, and records in arrays are ' +
      'matched by their <code>id</code> — so only real changes are marked.');
    return;
  }
  if (!ra.ok || !rb.ok) {
    var which = !ra.ok ? 'The editor' : 'The pasted document';
    var r = !ra.ok ? ra : rb;
    showEmpty(which + ' is not valid ' + label, esc(r.message) + (r.line ? ' — line ' + r.line + ', column ' + r.col : ''), true);
    return;
  }

  root = diffTree(toValue(ra), toValue(rb), undefined, []);
  changes = collectChanges(root);
  if (!changes.length) {
    showEmpty('No differences',
      'The two documents hold the same data' +
      (ta.trim() === tb.trim() ? '.' : ' — they differ only in formatting or key order.'));
    return;
  }
  lines = toLines(root);
  paintSummary();
  paint();
  gotoChange(0, false);
}

function paintSummary() {
  var n = { chg: 0, add: 0, del: 0 };
  changes.forEach(function (c) { n[c.k]++; });
  var bits = [];
  if (n.chg) bits.push('<b class="n-chg">~' + n.chg + '</b> changed');
  if (n.add) bits.push('<b class="n-add">+' + n.add + '</b> added');
  if (n.del) bits.push('<b class="n-del">−' + n.del + '</b> removed');
  $('cmpSummary').innerHTML = bits.join(', ');
}

function paint(keepShown) {
  var body = $('cmpBody');
  body.classList.toggle('side-by-side', layout === 'split');
  body.classList.toggle('as-tree', layout === 'tree');
  if (layout === 'tree') paintTree();
  else paintLines(keepShown);
}

/* ---------- unified and split ----------
   Every change plus a little context; the rest folds into a row that
   opens on click. */
var shown = null;
function computeShown() {
  shown = new Uint8Array(lines.length);
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].t === ' ') continue;
    for (var k = Math.max(0, i - CONTEXT); k < Math.min(lines.length, i + CONTEXT + 1); k++) shown[k] = 1;
  }
}

function rowHtml(l, i) {
  if (!l) return '<div class="d-row d-blank"><span class="d-sign"></span><span class="d-code"></span></div>';
  var cls = l.t === '+' ? ' d-add' : l.t === '-' ? ' d-del' : '';
  return '<div class="d-row' + cls + '" data-i="' + i + '"' + (l.ci >= 0 ? ' data-c="' + l.ci + '"' : '') + '>' +
    '<span class="d-sign">' + (l.t === ' ' ? '' : l.t === '-' ? '−' : '+') + '</span>' +
    '<span class="d-code" style="padding-left:' + (l.d * 2) + 'ch">' + l.html + '</span></div>';
}

function paintLines(keepShown) {
  if (!keepShown || !shown) computeShown();
  var html = '', rows = 0, capped = false;
  var i = 0, n = lines.length;
  while (i < n) {
    if (!shown[i]) {
      var s = i;
      while (i < n && !shown[i]) i++;
      /* a single hidden line costs more to fold than to show */
      if (i - s === 1) { shown[s] = 1; i = s; continue; }
      html += '<button class="d-fold" data-from="' + s + '" data-to="' + i + '">⋯ ' +
        LintApp.fmtNum(i - s) + ' unchanged lines</button>';
      continue;
    }
    /* a visible stretch — headed by where its first change sits */
    var start = i;
    while (i < n && shown[i]) i++;
    for (var k = start; k < i; k++) {
      if (lines[k].t !== ' ') {
        html += '<div class="d-hunk" data-i="' + k + '" title="Click to copy the path">' +
          esc(pathText(lines[k].path)) + '</div>';
        break;
      }
    }
    html += stretchHtml(start, i);
    rows += i - start;
    if (rows > ROW_CAP) { capped = true; break; }
  }
  if (capped) {
    html += '<div class="d-notice">Stopped at ' + LintApp.fmtNum(ROW_CAP) +
      ' lines — these documents differ almost everywhere.</div>';
  }
  $('cmpBody').innerHTML = html;
}

function stretchHtml(from, to) {
  var html = '', i;
  if (layout !== 'split') {
    for (i = from; i < to; i++) html += rowHtml(lines[i], i);
    return html;
  }
  /* side by side: context on both sides, and a run of removals paired
     line for line with the additions that follow it */
  i = from;
  while (i < to) {
    if (lines[i].t === ' ') {
      html += '<div class="d-pair">' + rowHtml(lines[i], i) + rowHtml(lines[i], i) + '</div>';
      i++;
      continue;
    }
    var dels = [], adds = [];
    while (i < to && lines[i].t === '-') dels.push(i++);
    while (i < to && lines[i].t === '+') adds.push(i++);
    for (var k = 0; k < Math.max(dels.length, adds.length); k++) {
      html += '<div class="d-pair">' +
        (k < dels.length ? rowHtml(lines[dels[k]], dels[k]) : rowHtml(null)) +
        (k < adds.length ? rowHtml(lines[adds[k]], adds[k]) : rowHtml(null)) + '</div>';
    }
  }
  return html;
}

/* ---------- tree ----------
   The document's structure with each change marked where it happened.
   Branches holding changes open by default and say how many; everything
   unchanged stays closed and quiet. */
var TREE_FOLD = 3;           // unchanged siblings shown before they fold
var TREE_CHUNK = 500;
var nodeOf = new WeakMap();  // row element -> diff node

function sizeText(v) {
  var n = sizeOf(v);
  return Array.isArray(v) ? n + (n === 1 ? ' item' : ' items') : n + (n === 1 ? ' key' : ' keys');
}
function valueHtml(v) {
  if (isScalar(v)) return scalarHtml(v);
  return '<span class="badge">' + (Array.isArray(v) ? '[ … ]' : '{ … }') +
    '<span class="cnt">' + sizeText(v) + '</span></span>';
}
function keyLabelHtml(key) {
  if (key === undefined) return '';
  var text = typeof key === 'number' ? '[' + key + ']'
    : typeof key === 'object' ? '[' + key.id + '=' + JSON.stringify(key.v) + ']'
    : key;
  return '<span class="k' + (typeof key === 'string' ? '' : ' idx') + '">' + esc(text) + '</span>' +
    '<span class="colon">:</span>';
}

/* the children a node can open to: its diff, or — for a value that did not
   change, or arrived or left whole — the value's own members */
function treeKids(n) {
  if (n.k === 'mod') return n.kids;
  var v = n.v;
  if (n.k === 'chg' || isScalar(v)) return [];
  var arr = Array.isArray(v);
  return (arr ? v : Object.keys(v)).map(function (x, i) {
    var key = arr ? i : x;
    return { k: n.k, key: key, path: n.path.concat([key]), v: arr ? x : v[x] };
  });
}

function treeNode(n) {
  var node = document.createElement('div');
  node.className = 'node dt-' + n.k;
  var row = document.createElement('div');
  row.className = 'row';
  row.tabIndex = 0;
  if (n.ci !== undefined) row.dataset.c = n.ci;
  nodeOf.set(row, n);

  var kids = n.k === 'mod' ? n.kids.length : n.k === 'chg' || isScalar(n.v) ? 0 : sizeOf(n.v);
  var html = '<span class="caret' + (kids ? '' : ' leaf') + '"></span>';
  if (n.k === 'add' || n.k === 'del' || n.k === 'chg') {
    html += '<span class="dt-tag">' + (n.k === 'add' ? '+' : n.k === 'del' ? '−' : '~') + '</span>';
  }
  html += keyLabelHtml(n.key);
  if (n.k === 'mod') {
    html += '<span class="badge">' + (n.kind === 'arr' ? '[ … ]' : '{ … }') + '</span>' +
      '<span class="dt-count">' + n.count + (n.count === 1 ? ' change' : ' changes') + '</span>';
  } else if (n.k === 'chg') {
    if (isScalar(n.a) && isScalar(n.b)) {
      var m = markedPair(n.a, n.b);
      html += '<span class="dt-old">' + m[0] + '</span><span class="dt-arrow">→</span><span class="dt-new">' + m[1] + '</span>';
    } else {
      html += '<span class="dt-old">' + valueHtml(n.a) + '</span><span class="dt-arrow">→</span><span class="dt-new">' + valueHtml(n.b) + '</span>';
    }
  } else {
    html += valueHtml(n.v);
  }
  row.innerHTML = html;
  node.appendChild(row);
  if (n.k === 'mod') openTreeNode(node, true);
  return node;
}

function openTreeNode(node, open) {
  var row = node.querySelector(':scope > .row');
  var n = nodeOf.get(row);
  if (!n) return;
  if (open && !node.dataset.loaded) {
    node.dataset.loaded = '1';
    var box = document.createElement('div');
    box.className = 'children';
    fillKids(box, treeKids(n), 0);
    node.appendChild(box);
  }
  node.classList.toggle('open', open);
}

/* long runs of unchanged siblings fold, so a single edit in a thousand-item
   list is not buried */
function fillKids(box, kids, from) {
  var i = from, end = Math.min(kids.length, from + TREE_CHUNK);
  while (i < end) {
    if (kids[i].k === 'same') {
      var s = i;
      while (i < kids.length && kids[i].k === 'same') i++;
      if (i - s > TREE_FOLD) {
        var fold = document.createElement('button');
        fold.className = 'more-btn';
        fold.textContent = '⋯ ' + LintApp.fmtNum(i - s) + ' unchanged';
        (function (list) {
          fold.addEventListener('click', function (e) {
            e.stopPropagation();
            var frag = document.createElement('div');
            list.forEach(function (c) { frag.appendChild(treeNode(c)); });
            fold.replaceWith.apply(fold, Array.prototype.slice.call(frag.childNodes));
          });
        })(kids.slice(s, i));
        box.appendChild(fold);
      } else {
        for (var k = s; k < i; k++) box.appendChild(treeNode(kids[k]));
      }
      continue;
    }
    box.appendChild(treeNode(kids[i++]));
  }
  if (i < kids.length) {
    var more = document.createElement('button');
    more.className = 'more-btn';
    more.textContent = 'Show ' + Math.min(TREE_CHUNK, kids.length - i) + ' more (' + (kids.length - i) + ' left)';
    more.addEventListener('click', function (e) {
      e.stopPropagation();
      more.remove();
      fillKids(box, kids, i);
    });
    box.appendChild(more);
  }
}

function paintTree() {
  var body = $('cmpBody');
  body.innerHTML = '';
  var wrap = document.createElement('div');
  wrap.className = 'dt';
  wrap.appendChild(treeNode(root));
  body.appendChild(wrap);
}

/* ---------- stepping through changes ---------- */
function gotoChange(i, scroll) {
  if (!changes.length) return;
  changeIdx = (i + changes.length) % changes.length;
  var body = $('cmpBody');
  body.querySelectorAll('.d-current').forEach(function (r) { r.classList.remove('d-current'); });
  var rows = body.querySelectorAll('[data-c="' + changeIdx + '"]');
  if (layout === 'tree' && rows.length) {
    /* reopen anything the reader closed on the way — and the change's own
       node, so arriving at an added record shows what was added */
    for (var p = rows[0].parentElement; p && p !== body; p = p.parentElement) {
      if (p.classList.contains('node') && !p.classList.contains('open')) openTreeNode(p, true);
    }
  }
  rows.forEach(function (r) { r.classList.add('d-current'); });
  $('cmpPos').textContent = (changeIdx + 1) + ' / ' + changes.length;
  $('pathBox').textContent = pathText(changes[changeIdx].path);
  if (scroll !== false && rows.length) rows[0].scrollIntoView({ block: 'center' });
}

$('cmpBody').addEventListener('click', function (e) {
  var fold = e.target.closest('.d-fold');
  if (fold) {
    /* open the fold a thousand lines at a time */
    var from = +fold.dataset.from, to = +fold.dataset.to;
    for (var i = from; i < Math.min(to, from + 1000); i++) shown[i] = 1;
    var keep = $('cmpBody').scrollTop;
    repaintKeepingShown();
    $('cmpBody').scrollTop = keep;
    return;
  }
  var hunk = e.target.closest('.d-hunk');
  if (hunk) { LintApp.copy(pathText(lines[+hunk.dataset.i].path), 'Path'); return; }
  var line = e.target.closest('.d-row[data-i]');
  if (line) { $('pathBox').textContent = pathText(lines[+line.dataset.i].path); return; }
  var row = e.target.closest('.dt .row');
  if (row) {
    var n = nodeOf.get(row);
    if (n) $('pathBox').textContent = pathText(n.path);
    var node = row.parentElement;
    if (!row.querySelector('.caret.leaf')) openTreeNode(node, !node.classList.contains('open'));
  }
});

/* repaint without folding back what the reader opened */
function repaintKeepingShown() {
  paint(true);
  if (changeIdx >= 0) gotoChange(changeIdx, false);
}

function scheduleCompare() {
  clearTimeout(cmpTimer);
  cmpTimer = setTimeout(runCompare, 250);
}
$('cmpB').addEventListener('input', scheduleCompare);

function setLayout(next) {
  var from = layout;
  layout = next;
  cmpTools.querySelectorAll('[data-layout]').forEach(function (b) {
    b.setAttribute('aria-pressed', String(b.dataset.layout === next));
  });
  try { localStorage.setItem(LAYOUT_KEY, next); } catch (e) {}
  if (!changes.length) return;
  /* the line folds survive a switch between the two line views */
  paint(from !== 'tree' && next !== 'tree');
  if (changeIdx >= 0) gotoChange(changeIdx);
}
setLayout(layout);
cmpTools.querySelectorAll('[data-layout]').forEach(function (b) {
  b.addEventListener('click', function () { setLayout(b.dataset.layout); });
});
$('cmpPrev').addEventListener('click', function () { gotoChange(changeIdx - 1); });
$('cmpNext').addEventListener('click', function () { gotoChange(changeIdx + 1); });
$('cmpSwap').addEventListener('click', function () {
  var a = app.editor.getValue();
  app.editor.setValue($('cmpB').value);
  $('cmpB').value = a;
  runCompare();
});

/* ---------- Tree | Compare ---------- */
function comparing() { return document.body.classList.contains('comparing'); }

/* the editor changed under the diff; an emptied editor (a closed document)
   also ends the comparison, so the next document opens on its tree */
function onEditorChanged() {
  if (!app.editor.getValue().trim()) setMode('tree');
  else scheduleCompare();
}

function setMode(mode) {
  var on = mode === 'compare';
  document.body.classList.toggle('comparing', on);
  modeSeg.querySelectorAll('[data-mode]').forEach(function (b) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  });
  if (on) {
    runCompare();
    $('cmpB').focus();
  } else {
    $('pathBox').textContent = '';
  }
}
modeSeg.addEventListener('click', function (e) {
  var b = e.target.closest('[data-mode]');
  if (b) setMode(b.dataset.mode);
});

/* while comparing, ⌘G and F3 walk changes — ahead of the tree's own */
window.addEventListener('keydown', function (e) {
  if (!comparing()) return;
  var mod = e.ctrlKey || e.metaKey;
  if ((mod && (e.key === 'g' || e.key === 'G')) || e.key === 'F3') {
    e.preventDefault();
    e.stopPropagation();
    if (cmpTimer !== null) { clearTimeout(cmpTimer); runCompare(); }
    gotoChange(changeIdx + (e.shiftKey ? -1 : 1));
  } else if (mod && (e.key === 'f' || e.key === 'F')) {
    /* search belongs to the tree: go back to it, and let the shortcut through */
    setMode('tree');
  } else if (e.key === 'Escape' && !document.querySelector('.menu.open') &&
             !e.target.closest('dialog, [role="dialog"]')) {
    setMode('tree');
  }
}, true);

if (LintApp.shortcuts) {
  LintApp.shortcuts([{ title: 'Compare', items: [
    { keys: ['mod+g', 'f3'], label: 'Next change' },
    { keys: ['mod+shift+g', 'shift+f3'], label: 'Previous change' },
    { keys: ['esc'], label: 'Back to the tree' }
  ] }]);
}

return { comparing: comparing, onEditorChanged: onEditorChanged };
}

global.LintCompare = { mount: mount };
})(window);
