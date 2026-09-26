/* ==========================================================================
   lint.one/env — how five programs read the same .env file.

   A .env file has no specification. Each program that reads one has its own
   parser, and they disagree on exactly the things people get wrong: a
   trailing space, a # in a password, a $ in a value, a quote, a \t. Each
   function here reads a file the way one of them does, and was checked
   against the real thing on the same files:

     node     dotenv 18 (Node): dotenv.parse, its default regex parser
     python   python-dotenv 1.2: dotenv_values, which interpolates ${VAR}
     compose  Docker Compose 2.40: env_file, parsed by compose-go
     docker   docker run --env-file: docker/cli's parseKeyValueFile
     shell    set -a; . ./.env in bash or sh

   Each returns { entries, errors, env }:
     entries  every assignment in file order, duplicates kept:
              { key, value, line }, value null for a key with no value
     errors   { line, message } for what that program rejects
     env      names the value read from the environment (${HOME}), which a
              browser cannot know and treats as unset
   ========================================================================== */
(function (global) {
'use strict';

/* 1-based line of an offset */
function lineAt(text, pos) {
  var n = 1;
  for (var i = 0; i < pos && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/* ---------- dotenv (Node) ----------
   dotenv's own rule, from its source (BSD-2-Clause, Scott Motte): one regex
   per assignment. An unquoted value ends at the first #, even without a
   space before it; only double quotes turn \n and \r into line breaks; no
   variable is expanded. A line the regex does not match is skipped. */
var DOTENV_LINE = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/mg;

function node(text) {
  var src = text.replace(/\r\n?/mg, '\n');
  var entries = [], m;
  DOTENV_LINE.lastIndex = 0;
  while ((m = DOTENV_LINE.exec(src)) !== null) {
    var key = m[1];
    var value = (m[2] || '').trim();
    var quote = value[0];
    value = value.replace(/^(['"`])([\s\S]*)\1$/mg, '$2');
    if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
    entries.push({ key: key, value: value, line: lineAt(src, m.index + m[0].indexOf(key)) });
  }
  return { entries: entries, errors: [], env: [] };
}

/* ---------- python-dotenv ----------
   A port of its tokenizer (python-dotenv's parser.py). Whitespace is what
   Python's str.isspace says, which leaves out U+FEFF: a BOM becomes part of
   the first key's name. A line it cannot read is skipped with a warning. */
var PY_WS = '\\t\\n\\x0b\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
var PY = {
  multilineWs: new RegExp('[' + PY_WS + ']*', 'y'),
  sqKey: /'([^']+)'/y,
  uqKey: new RegExp("([^=#" + PY_WS + "]+)", 'y'),
  sqVal: /'((?:\\'|[^'])*)'/y,
  dqVal: /"((?:\\"|[^"])*)"/y,
  uqVal: /([^\r\n]*)/y,
  rest: /[^\r\n]*(?:\r\n|\r|\n)?/y
};
/* [^\S\r\n] in Python: whitespace other than line breaks */
var PY_HWS = '[\\t\\x0b\\f \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
PY.ws = new RegExp(PY_HWS + '*', 'y');
PY.export = new RegExp('(?:export' + PY_HWS + '+)?', 'y');
PY.eq = new RegExp('(=' + PY_HWS + '*)', 'y');
PY.comment = new RegExp('(?:' + PY_HWS + '*#[^\\r\\n]*)?', 'y');
PY.eol = new RegExp(PY_HWS + '*(?:\\r\\n|\\n|\\r|$)', 'y');
var PY_ESC = { '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\x0b' };
var PY_VAR = /\$\{([^}:]*)(?::-([^}]*))?\}/g;

function python(text) {
  var entries = [], errors = [], env = [];
  var pos = 0;
  function read(re) {
    re.lastIndex = pos;
    var m = re.exec(text);
    if (!m) throw new Error('parse');
    pos = re.lastIndex;
    return m;
  }
  while (pos < text.length) {
    var start = pos, at;
    try {
      read(PY.multilineWs);
      if (pos >= text.length) break;
      at = pos;
      read(PY.export);
      var key = null;
      var c = text[pos];
      if (c === '#') key = null;
      else if (c === "'") key = read(PY.sqKey)[1];
      else key = read(PY.uqKey)[1];
      read(PY.ws);
      var value = null;
      if (text[pos] === '=') {
        read(PY.eq);
        c = text[pos];
        if (c === "'") value = read(PY.sqVal)[1].replace(/\\[\\']/g, function (e) { return PY_ESC[e[1]]; });
        else if (c === '"') value = read(PY.dqVal)[1].replace(/\\[\\'"abfnrtv]/g, function (e) { return PY_ESC[e[1]]; });
        else if (c === undefined || c === '\n' || c === '\r') value = '';
        else value = read(PY.uqVal)[1].replace(new RegExp('[' + PY_WS + ']+#.*'), '').replace(new RegExp('[' + PY_WS + ']+$'), '');
      }
      read(PY.comment);
      read(PY.eol);
      if (key !== null) entries.push({ key: key, value: value, line: lineAt(text, at) });
    } catch (e) {
      /* python-dotenv drops the rest of the line from where it failed, and
         goes on from there: an unclosed quote can swallow the lines after */
      read(PY.rest);
      errors.push({ line: lineAt(text, at === undefined ? start : at), message: 'python-dotenv cannot read this line and skips it' });
    }
  }
  /* dotenv_values expands ${VAR} and ${VAR:-default} in every value, from
     what came before in the file (and the environment, unknown here) */
  var seen = {};
  entries.forEach(function (e) {
    if (e.value !== null) {
      e.value = e.value.replace(PY_VAR, function (m, name, dflt) {
        if (Object.prototype.hasOwnProperty.call(seen, name) && seen[name] !== null) return seen[name];
        if (dflt === undefined && env.indexOf(name) === -1) env.push(name);
        return dflt === undefined ? '' : dflt;
      });
    }
    seen[e.key] = e.value;
  });
  return { entries: entries, errors: errors, env: env };
}

/* ---------- Docker Compose (env_file) ----------
   compose-go's parser: an unquoted value ends at " #" (a space, then #) and
   loses trailing whitespace; single quotes are literal; double quotes take
   \n \t \\ \" and the like. $VAR and ${VAR…} are expanded in both unquoted
   and double-quoted values, and $$ is a literal $. */
function isSpaceRune(c) { return /\s/.test(c) && c !== '\uFEFF'; }

function interpolate(value, vars, env) {
  var out = '', i = 0;
  while (i < value.length) {
    var c = value[i];
    if (c !== '$') { out += c; i++; continue; }
    var nx = value[i + 1];
    if (nx === '$') { out += '$'; i += 2; continue; }
    if (nx === '{') {
      var end = value.indexOf('}', i + 2);
      if (end === -1) { out += value.slice(i); break; }
      var body = value.slice(i + 2, end);
      var m = /^([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?+])(.*))?$/s.exec(body);
      if (!m) { out += value.slice(i, end + 1); i = end + 1; continue; }
      var has = Object.prototype.hasOwnProperty.call(vars, m[1]);
      var v = has ? vars[m[1]] : undefined;
      var op = m[2], arg = m[3];
      if (!has && env.indexOf(m[1]) === -1 && !(op && op.indexOf('-') !== -1)) env.push(m[1]);
      var empty = v === undefined || (op && op[0] === ':' && v === '');
      if (op === ':-' || op === '-') out += (op === '-' ? v === undefined : empty) ? arg : v;
      else if (op === ':+' || op === '+') out += (op === '+' ? v !== undefined : !empty) ? arg : '';
      else out += v === undefined ? '' : v;
      i = end + 1;
      continue;
    }
    var name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(value.slice(i + 1));
    if (!name) { out += '$'; i++; continue; }
    if (Object.prototype.hasOwnProperty.call(vars, name[0])) out += vars[name[0]];
    else if (env.indexOf(name[0]) === -1) env.push(name[0]);
    i += 1 + name[0].length;
  }
  return out;
}

var COMPOSE_ESC = { n: '\n', r: '\r', t: '\t', a: '\x07', b: '\b', f: '\f', v: '\x0b', '\\': '\\', '"': '"', $: '\u0000$' };

function compose(text) {
  var src = text.replace(/^\uFEFF/, '');
  var entries = [], errors = [], env = [], vars = {};
  var i = 0;
  while (i < src.length) {
    /* statement start: skip whitespace and comment lines */
    while (i < src.length && isSpaceRune(src[i])) i++;
    if (i >= src.length) break;
    if (src[i] === '#') { var nl = src.indexOf('\n', i); if (nl === -1) break; i = nl; continue; }
    var line = lineAt(src, i);
    var s = i;
    if (/^export\s+/.test(src.slice(i, i + 20))) { i += 6; while (isSpaceRune(src[i])) i++; s = i; }
    var key = null, inherited = false, bad = null;
    for (; i < src.length; i++) {
      var ch = src[i];
      if (ch === '=' || ch === ':' || ch === '\n') { key = src.slice(s, i); inherited = ch === '\n'; i++; break; }
      if (isSpaceRune(ch) || /[_.\-\[\]]/.test(ch) || /[\p{L}\p{N}]/u.test(ch)) continue;
      bad = ch; break;
    }
    if (bad !== null) {
      errors.push({ line: line, message: 'Compose stops here: “' + bad + '” is not allowed in a variable name' });
      return { entries: entries, errors: errors, env: env, stopped: true };
    }
    if (key === null) { key = src.slice(s); i = src.length; inherited = true; }
    key = key.replace(/\s+$/, '');
    if (/\s/.test(key)) {
      errors.push({ line: line, message: 'Compose stops here: a variable name cannot contain a space' });
      return { entries: entries, errors: errors, env: env, stopped: true };
    }
    if (inherited) { continue; }   // KEY with no "=": taken from the environment
    while (i < src.length && src[i] !== '\n' && isSpaceRune(src[i])) i++;
    var q = src[i];
    var value;
    if (q !== '"' && q !== "'") {
      var e = src.indexOf('\n', i); if (e === -1) e = src.length;
      value = src.slice(i, e);
      var cut = value.indexOf(' #'); if (cut !== -1) value = value.slice(0, cut);
      value = value.replace(/\s+$/, '');
      value = interpolate(value, vars, env);
      i = e;
    } else {
      var j = i + 1, esc = false, close = -1;
      for (; j < src.length; j++) {
        var cj = src[j];
        if (cj !== q) {
          if (!esc && cj === '\\') { esc = true; continue; }
          esc = false; continue;
        }
        if (esc) { esc = false; continue; }
        close = j; break;
      }
      if (close === -1) {
        errors.push({ line: line, message: 'Compose stops here: the quoted value is never closed' });
        return { entries: entries, errors: errors, env: env, stopped: true };
      }
      value = src.slice(i + 1, close);
      if (q === '"') {
        value = value.replace(/\\(.)/gs, function (m, c) { return Object.prototype.hasOwnProperty.call(COMPOSE_ESC, c) ? COMPOSE_ESC[c] : m; });
        /* an escaped \$ is a literal $, kept out of interpolation */
        var parts = value.split('\u0000$');
        value = parts.map(function (p) { return interpolate(p, vars, env); }).join('$');
      } else {
        value = value.replace(/\\'/g, "'");
      }
      i = close + 1;
    }
    entries.push({ key: key, value: value, line: line });
    vars[key] = value;
  }
  return { entries: entries, errors: errors, env: env };
}

/* ---------- docker run --env-file ----------
   docker/cli's parseKeyValueFile: each line has its leading whitespace
   removed and is split at the first =. The value is taken exactly as it
   is: quotes stay part of it, and so do trailing spaces and any #. A key
   containing a space or a tab is an error. There are no multi-line values. */
function docker(text) {
  var src = text.replace(/^\uFEFF/, '');
  var lines = src.split('\n');
  var entries = [], errors = [];
  for (var n = 0; n < lines.length; n++) {
    var l = lines[n].replace(/\r$/, '');
    var t = l.replace(/^\s+/, '');
    if (!t || t[0] === '#') continue;
    var eq = t.indexOf('=');
    var key = eq === -1 ? t : t.slice(0, eq);
    if (/[ \t]/.test(key)) {
      errors.push({ line: n + 1, message: 'docker run refuses the file: “' + key + '” contains whitespace' });
      return { entries: [], errors: errors, env: [], stopped: true };
    }
    if (eq === -1) continue;   // KEY alone: passed through from the environment
    entries.push({ key: key, value: t.slice(eq + 1), line: n + 1 });
  }
  return { entries: entries, errors: errors, env: [] };
}

/* ---------- a shell: set -a; . ./.env ----------
   Each line is a shell command. NAME=value assigns; a space ends the value
   and makes the rest a command to run; $VAR and $(…) are expanded; single
   quotes keep everything; a line that is not an assignment is run as a
   command. A quote left open is a syntax error that stops the file. */
var NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function shell(text) {
  var entries = [], errors = [], env = [], vars = {};
  var i = 0, n = text.length;

  function expand(name) {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
    if (env.indexOf(name) === -1) env.push(name);
    return '';
  }

  /* one $-expansion starting at text[i] === '$'; returns [value, next] */
  function dollar(j) {
    var nx = text[j + 1];
    if (nx === '{') {
      var end = text.indexOf('}', j + 2);
      if (end === -1) return ['$', j + 1];
      var body = text.slice(j + 2, end);
      var m = /^([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-=+?])(.*))?$/s.exec(body);
      if (!m) return ['', end + 1];
      var has = Object.prototype.hasOwnProperty.call(vars, m[1]);
      var v = has ? vars[m[1]] : undefined;
      if (!has && env.indexOf(m[1]) === -1) env.push(m[1]);
      var op = m[2], arg = m[3];
      var empty = v === undefined || (op && op[0] === ':' && v === '');
      if (op === ':-' || op === '-' || op === ':=' || op === '=') return [(op.length === 1 ? v === undefined : empty) ? arg : v, end + 1];
      if (op === ':+' || op === '+') return [(op.length === 1 ? v !== undefined : !empty) ? arg : '', end + 1];
      return [v === undefined ? '' : v, end + 1];
    }
    if (nx === '(') return [null, j + 1];   // command substitution
    if (nx === '$') return ['<pid>', j + 2];
    var name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(j + 1));
    if (name) return [expand(name[0]), j + 1 + name[0].length];
    if (nx !== undefined && /[0-9#?!*@-]/.test(nx)) return ['', j + 2];
    return ['$', j + 1];
  }

  while (i < n) {
    /* skip blanks and comments between commands */
    while (i < n && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === ';')) i++;
    if (i >= n) break;
    if (text[i] === '#') { while (i < n && text[i] !== '\n') i++; continue; }
    var line = lineAt(text, i);
    /* read the words of one command */
    var words = [], ranCommand = false, op = null;
    while (i < n && text[i] !== '\n' && text[i] !== ';') {
      if (text[i] === ' ' || text[i] === '\t') { i++; continue; }
      if (text[i] === '#' ) { while (i < n && text[i] !== '\n') i++; break; }
      var raw = '', val = '', sub = false;
      while (i < n && text[i] !== ' ' && text[i] !== '\t' && text[i] !== '\n' && text[i] !== ';') {
        var c = text[i];
        if (c === "'") {
          var close = text.indexOf("'", i + 1);
          if (close === -1) { errors.push({ line: line, message: 'The shell stops here: a single quote is never closed' }); return { entries: entries, errors: errors, env: env, stopped: true }; }
          val += text.slice(i + 1, close); raw += text.slice(i, close + 1); i = close + 1;
        } else if (c === '"') {
          var j = i + 1, piece = '';
          for (; j < n && text[j] !== '"'; j++) {
            if (text[j] === '\\' && /[$`"\\\n]/.test(text[j + 1] || '')) { if (text[j + 1] !== '\n') piece += text[j + 1]; j++; continue; }
            if (text[j] === '$') { var d = dollar(j); if (d[0] === null) { sub = true; var cp = text.indexOf(')', j); j = cp === -1 ? n : cp; continue; } piece += d[0]; j = d[1] - 1; continue; }
            if (text[j] === '`') { sub = true; var bt = text.indexOf('`', j + 1); j = bt === -1 ? n : bt; continue; }
            piece += text[j];
          }
          if (j >= n) { errors.push({ line: line, message: 'The shell stops here: a double quote is never closed' }); return { entries: entries, errors: errors, env: env, stopped: true }; }
          val += piece; raw += text.slice(i, j + 1); i = j + 1;
        } else if (c === '\\') {
          if (text[i + 1] === '\n') { i += 2; continue; }
          val += text[i + 1] || ''; raw += text.slice(i, i + 2); i += 2;
        } else if (c === '$') {
          var dd = dollar(i);
          if (dd[0] === null) { sub = true; var close2 = text.indexOf(')', i); i = close2 === -1 ? n : close2 + 1; continue; }
          val += dd[0]; raw += text.slice(i, dd[1]); i = dd[1];
        } else if (c === '`') {
          sub = true; var bt2 = text.indexOf('`', i + 1); i = bt2 === -1 ? n : bt2 + 1;
        } else if (/[|&<>()]/.test(c)) {
          /* a pipe, a redirect or a subshell: the line is not an assignment */
          op = c; while (i < n && text[i] !== '\n') i++;
          break;
        } else { val += c; raw += c; i++; }
      }
      words.push({ raw: raw, val: val, sub: sub });
      if (op) break;
    }
    if (op) {
      errors.push({ line: line, message: 'The shell reads the unquoted “' + op + '” as ' +
        (op === '|' ? 'a pipe' : op === '&' ? 'running in the background' : op === '(' || op === ')' ? 'a subshell' : 'a redirect') +
        ', so nothing on this line is set' });
      continue;
    }
    /* an unquoted word that expands to nothing ($UNSET) is no word at all */
    words = words.filter(function (w) {
      return w.val !== '' || /['"]/.test(w.raw) || w.sub || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w.raw);
    });
    /* an assignment is NAME= before any quote; `export` takes assignments too */
    var assigns = [], k = 0;
    var exported = words.length && words[0].raw === 'export';
    if (exported) k = 1;
    for (; k < words.length; k++) {
      var w = words[k];
      var eq = w.raw.indexOf('=');
      var name = eq > 0 ? w.raw.slice(0, eq) : '';
      if (eq > 0 && NAME.test(name)) {
        /* the value is what follows NAME= in the expanded word */
        assigns.push({ key: name, value: w.val.slice(w.val.indexOf('=') + 1), line: line, sub: w.sub });
      } else if (exported) {
        if (!NAME.test(w.raw)) errors.push({ line: line, message: 'export: “' + w.raw + '” is not a valid name' });
      } else if (w.sub && w.val === '' && words.slice(k).every(function (x) { return x.sub && x.val === ''; })) {
        /* `cmd` in place of a command: what it prints is run, and when it
           prints nothing the assignments before it simply stand */
        errors.push({ line: line, message: 'The shell runs a command here (a `…` or $(…) outside a value)' });
        break;
      } else {
        ranCommand = true;
        errors.push({ line: line, message: 'The shell runs “' + w.val + '” as a command' +
          (assigns.length ? ', and ' + assigns.map(function (a) { return a.key; }).join(', ') + ' is set only for that command' : '') });
        break;
      }
    }
    if (!ranCommand) assigns.forEach(function (a) {
      if (a.sub) errors.push({ line: line, message: 'The shell runs a command to get ' + a.key + ' (a `…` or $(…) in its value)' });
      entries.push(a); vars[a.key] = a.value;
    });
  }
  return { entries: entries, errors: errors, env: env };
}

var PARSERS = [
  { id: 'node', name: 'dotenv (Node.js)', short: 'Node.js', read: node },
  { id: 'python', name: 'python-dotenv', short: 'Python', read: python },
  { id: 'compose', name: 'Docker Compose', short: 'Docker Compose', read: compose },
  { id: 'docker', name: 'docker run --env-file', short: 'docker run', read: docker },
  { id: 'shell', name: 'Shell (source)', short: 'Shell', read: shell }
];

var api = { PARSERS: PARSERS, node: node, python: python, compose: compose, docker: docker, shell: shell, lineAt: lineAt };
if (typeof module === 'object' && module.exports) module.exports = api;
else global.EnvParsers = api;
})(this);
