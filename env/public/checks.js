/* ==========================================================================
   lint.one/env — what is wrong with a .env file, and what to do about it.

   analyze(text, readAs) reads the file with every parser in parsers.js and
   reports three kinds of thing:
   - where a program rejects the file or a line of it;
   - where they read a value differently, with the cause spelled out
     (a # that Node cuts at, a $ that Compose expands, a trailing space
     docker run keeps);
   - what is likely a mistake whoever reads it: a key set twice, a port
     that is not a number, a URL with an unescaped @ in its password, a flag
     that says "yes", a value left as "changeme".
   ========================================================================== */
(function (global) {
'use strict';

var P = global.EnvParsers || (typeof require === 'function' ? require('./parsers.js') : null);
var own = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };

/* ---------- invisible characters ---------- */
var INVISIBLE = {
  '\xA0': 'a no-break space', '\u1680': 'an ogham space', '\u180E': 'a Mongolian vowel separator',
  '\u2000': 'an en quad', '\u2001': 'an em quad', '\u2002': 'an en space', '\u2003': 'an em space',
  '\u2004': 'a three-per-em space', '\u2005': 'a four-per-em space', '\u2006': 'a six-per-em space',
  '\u2007': 'a figure space', '\u2008': 'a punctuation space', '\u2009': 'a thin space', '\u200A': 'a hair space',
  '\u200B': 'a zero-width space', '\u200C': 'a zero-width non-joiner', '\u200D': 'a zero-width joiner',
  '\u2028': 'a line separator', '\u2029': 'a paragraph separator', '\u202F': 'a narrow no-break space',
  '\u205F': 'a medium mathematical space', '\u2060': 'a word joiner', '\u3000': 'an ideographic space',
  '\uFEFF': 'a byte-order mark'
};
var INVISIBLE_RE = /[\xA0\u1680\u180E\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF]/g;
var hex4 = function (c) { return 'U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'); };

/* ---------- names that say what their value should be ---------- */
function kindOf(key) {
  var k = key.toUpperCase();
  if (/(^|_)PORT$/.test(k)) return 'port';
  if (/(_|^)(URL|URI|DSN|ENDPOINT)$|^DATABASE_URL$/.test(k)) return 'url';
  if (/(^|_)(ENABLED?|DISABLED?|DEBUG|FLAG|VERBOSE)$|^(IS|USE|ENABLE|DISABLE|HAS|ALLOW)_/.test(k)) return 'flag';
  if (/(^|_)(HOST|HOSTNAME)$/.test(k)) return 'host';
  if (/(^|_)EMAIL$/.test(k)) return 'email';
  return null;
}

var PLACEHOLDER = /^(change[-_ ]?me|changeit|todo|tbd|fixme|x{3,}|\*{3,}|\.{3}|placeholder|replace[-_ ]?me|your[-_ ].+|<[^>]+>|\[[^\]]+\]|\{\{.+\}\})$/i;

function validate(key, value) {
  if (value === null || value === undefined) return null;
  var v = value;
  var bad = function (short, text) { return { short: short, text: text }; };
  if (PLACEHOLDER.test(v.trim())) return bad('placeholder', '“' + v + '” looks like a placeholder, not a real value');
  if (v === '') return null;
  switch (kindOf(key)) {
    case 'port': {
      if (!/^\d+$/.test(v)) return bad('not a port', 'A port is a number from 1 to 65535');
      var n = Number(v);
      if (n < 1 || n > 65535) return bad('not a port', 'A port is a number from 1 to 65535');
      return null;
    }
    case 'url': {
      if (/\s/.test(v)) return bad('space in URL', 'The URL contains a space');
      var m = /^([a-z][a-z0-9+.\-]*):\/\/([^/?#]*)(.*)$/i.exec(v);
      if (!m) return /^[a-z][a-z0-9+.\-]*:/i.test(v) ? null : bad('not a URL', 'A URL starts with its scheme: https://, postgres://…');
      var authority = m[2];
      var at = authority.lastIndexOf('@');
      if (at !== -1 && authority.slice(0, at).indexOf('@') !== -1) return Object.assign(bad('@ in password', 'The password contains an @, so the URL ends up with the wrong host'), { fix: 'encode' });
      if (/^[^@]*:[^@]*[#?\/][^@]*@/.test(m[2] + m[3]) && m[3]) return bad('# or / in password', 'The password contains a /, ? or #. Percent-encode it');
      var host = at === -1 ? authority : authority.slice(at + 1);
      if (!host && !/^file$/i.test(m[1])) return bad('no host', 'The URL has no host');
      return null;
    }
    case 'flag':
      if (/^(true|false|1|0)$/.test(v)) return null;
      return Object.assign(bad('not true/false', 'A flag should be true, false, 1 or 0'), { soft: true });
    case 'host':
      if (/:\/\//.test(v)) return Object.assign(bad('a URL, not a host', 'A host name has no scheme: ' + v.split('://')[0] + ':// should not be there'), { fix: 'host' });
      if (/\//.test(v)) return bad('path in host', 'A host name has no path');
      return null;
    case 'email':
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? null : Object.assign(bad('not an email', 'This does not look like an email address'), { soft: true });
  }
  return null;
}

/* ---------- secrets on their way to the browser ----------
   Frameworks build variables with these prefixes into the page itself, where
   anyone can read them. A secret there is published. */
var PUBLIC = /^(NEXT_PUBLIC_|VITE_|REACT_APP_|NUXT_PUBLIC_|PUBLIC_|EXPO_PUBLIC_|GATSBY_|VUE_APP_)/;
var SECRET_NAME = /(SECRET|PRIVATE|PASSWORD|PASSWD|TOKEN|SERVICE_ROLE|CREDENTIAL)/i;
var SECRET_VALUE = /^(sk_(live|test)_|rk_(live|test)_|sk-[A-Za-z0-9_-]{16,}|ghp_|gho_|github_pat_|xox[abpr]-|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY)/;

function exposed(key, value) {
  var m = PUBLIC.exec(key);
  if (!m) return null;
  var byValue = typeof value === 'string' && SECRET_VALUE.test(value.trim());
  if (!byValue && !(SECRET_NAME.test(key.slice(m[1].length)) && !/PUBLISHABLE|PUBLIC_KEY|ANON/i.test(key))) return null;
  return 'Anything named ' + m[1] + '… is built into the code sent to the browser, where anyone can read it. ' +
    (byValue ? 'This value is a secret key.' : 'This looks like a secret.') + ' Drop the ' + m[1] + ' prefix and read it on the server';
}

/* ---------- the lines, as written ----------
   A tolerant scan of every assignment-looking line, for the causes of
   disagreement: which quote a value starts with, what follows it. */
function scanLines(text) {
  var out = [];
  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i].replace(/\r$/, '');
    var t = raw.replace(/^\uFEFF/, '');
    if (!t.trim() || /^\s*#/.test(t)) continue;
    var m = /^(\s*)(export\s+)?([^=\s#]+)(\s*)(=)?(\s*)(.*)$/.exec(t);
    if (!m) { out.push({ line: i + 1, raw: raw, bad: true }); continue; }
    var bom = raw.length - t.length;
    out.push({
      line: i + 1, raw: raw, key: m[3], export: !!m[2], eq: !!m[5],
      eqAt: bom + m[1].length + (m[2] || '').length + m[3].length + m[4].length,
      valueAt: bom + m[1].length + (m[2] || '').length + m[3].length + m[4].length + (m[5] || '').length + m[6].length,
      spaceBefore: m[4].length > 0, spaceAfter: m[6].length > 0, value: m[7],
      quote: /^["'`]/.test(m[7]) ? m[7][0] : null
    });
  }
  return out;
}

function list(names) {
  if (names.length <= 1) return names.join('');
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

function show(v) {
  if (v === null) return 'no value';
  if (v === undefined) return 'not set';
  return '“' + v.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '”';
}

/* ==========================================================================
   analyze
   ========================================================================== */
function analyze(text, readAs) {
  readAs = readAs || 'any';
  var results = {};
  P.PARSERS.forEach(function (p) { results[p.id] = p.read(text); });
  var names = {};
  P.PARSERS.forEach(function (p) { names[p.id] = p.short; });

  var problems = [];
  function add(line, severity, message, extra) {
    var p = { line: line, severity: severity, message: message };
    if (extra) for (var k in extra) p[k] = extra[k];
    problems.push(p);
  }

  /* ---------- the variables, as each program ends up with them ---------- */
  var order = [], vars = {};
  P.PARSERS.forEach(function (p) {
    results[p.id].entries.forEach(function (e) {
      if (!own(vars, e.key)) { vars[e.key] = { key: e.key, line: e.line, values: {}, lines: {} }; order.push(e.key); }
      vars[e.key].values[p.id] = e.value;
      (vars[e.key].lines[p.id] = vars[e.key].lines[p.id] || []).push(e.line);
    });
  });
  order.sort(function (a, b) { return vars[a].line - vars[b].line; });

  /* With no program chosen, a value is what most programs read; a tie
     goes to the one listed first. Programs that refuse the file do not vote. */
  order.forEach(function (k) {
    var v = vars[k], votes = [];
    P.PARSERS.forEach(function (p) {
      if (results[p.id].stopped || !own(v.values, p.id)) return;
      var val = v.values[p.id];
      var hit = votes.filter(function (x) { return x.value === val; })[0];
      if (hit) hit.n++; else votes.push({ value: val, n: 1 });
    });
    votes.sort(function (a, b) { return b.n - a.n; });
    v.common = votes.length ? votes[0].value : undefined;
  });
  function valueOf(v) { return readAs === 'any' ? v.common : own(v.values, readAs) ? v.values[readAs] : undefined; }

  /* Every finding says which programs it touches (affects), and so how much
     it matters to the reader: 'break' if their app will get a wrong value,
     'risk' if some app would, 'fyi' otherwise. With a program chosen, a
     finding about the others is not theirs, and is left out. Findings sit
     with the variable on their line; col and len point at the exact text,
     and fix names the edit the page can make. */
  var scanned = scanLines(text);
  var keyAt = {};
  scanned.forEach(function (s) { if (s.key) keyAt[s.line] = s.key; });
  var ALL = P.PARSERS.map(function (p) { return p.id; });
  function at(line, base, short, message, extra) {
    extra = extra || {};
    var affects = extra.affects || null;
    var impact = extra.impact || null;
    if (affects) {
      if (readAs !== 'any' && affects.indexOf(readAs) === -1) return;
      impact = base === 'info' ? 'fyi' : readAs === 'any' && affects.length < ALL.length ? 'risk' : 'break';
    }
    if (!impact) impact = base === 'info' ? 'fyi' : 'risk';
    add(line, impact === 'break' ? 'error' : impact === 'risk' ? 'warn' : 'info', message,
      Object.assign({ short: short, impact: impact, key: line !== null && own(keyAt, line) ? keyAt[line] : null }, extra));
  }

  /* ---------- what each program refuses ---------- */
  P.PARSERS.forEach(function (p) {
    results[p.id].errors.forEach(function (e) {
      at(e.line, results[p.id].stopped ? 'error' : 'warn',
        results[p.id].stopped ? p.short + ' cannot read the file' : p.short + ' reads it differently', e.message, { affects: [p.id] });
    });
  });

  /* ---------- the file as a whole ---------- */
  if (text.charCodeAt(0) === 0xFEFF) {
    at(1, 'warn', 'byte-order mark', 'The file starts with an invisible byte-order mark', { affects: ['python', 'shell'], key: null, fix: 'bom' });
  }
  if (/\r\n/.test(text)) {
    at(null, 'warn', 'Windows line endings', 'Windows line endings: the shell keeps a \\r at the end of every value', { affects: ['shell'], key: null, fix: 'crlf' });
  }

  /* ---------- line by line ---------- */
  scanned.forEach(function (s) {
    INVISIBLE_RE.lastIndex = 0;
    var m;
    while ((m = INVISIBLE_RE.exec(s.raw)) !== null) {
      if (s.line === 1 && m.index === 0 && m[0] === '\uFEFF') continue;
      at(s.line, 'warn', 'invisible character', 'An invisible character: ' + INVISIBLE[m[0]] + ' (' + hex4(m[0]) + ')',
        { impact: 'break', col: m.index + 1, len: 1, fix: 'invisible' });
    }
    if (s.bad) return;
    if (!s.eq) {
      at(s.line, 'warn', 'no =', 'No = on this line, so each program does something different with it', { impact: 'risk' });
      return;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s.key)) {
      at(s.line, 'warn', 'not a shell name', 'A shell cannot set a name with ' +
        (/-/.test(s.key) ? 'a -' : /\./.test(s.key) ? 'a .' : /^\d/.test(s.key) ? 'a digit first' : 'these characters') + ' in it. Use letters, digits and _',
        { affects: ['shell'], col: (s.raw.length - s.raw.replace(/^\s*(export\s+)?/, '').length) + 1, len: s.key.length });
    }
    if (s.spaceBefore || (s.spaceAfter && !s.quote && s.value)) {
      at(s.line, 'warn', 'space around =', 'A space next to the =. The shell cannot read the line, and docker run ' +
        (s.spaceBefore ? 'refuses the file' : 'keeps the space in the value'),
        { affects: ['shell', 'docker'], col: s.raw.slice(0, s.eqAt).replace(/\s+$/, '').length + 1, len: s.valueAt - s.raw.slice(0, s.eqAt).replace(/\s+$/, '').length, fix: 'equals' });
    }
    if (s.quote && readAs === 'docker') {
      at(s.line, 'warn', 'quotes kept', 'docker run keeps the quotes as part of the value', { affects: ['docker'], col: s.valueAt + 1, len: 1, fix: 'unquote' });
    }

    var v = s.value;
    var canQuote = v.indexOf("'") === -1 && readAs !== 'docker';
    if (!s.quote) {
      var trail = /[ \t]+$/.exec(v);
      if (trail && v.trim() && !/\s#/.test(v)) {
        at(s.line, 'warn', 'trailing spaces', (trail[0].length === 1 ? 'A space' : trail[0].length + ' spaces') +
          ' after the value. docker run keeps ' + (trail[0].length === 1 ? 'it' : 'them') + ' as part of the value',
          { affects: ['docker'], col: s.raw.length - trail[0].length + 1, len: trail[0].length, fix: 'trailing' });
      }
      var hashAt = v.search(/[^\s]#/);
      if (hashAt !== -1) {
        at(s.line, 'warn', '# cuts the value', 'Node\'s dotenv ends the value at the #, so it reads “' + v.slice(0, hashAt + 1).trim() + '”',
          { affects: ['node'], col: s.valueAt + hashAt + 2, len: 1, fix: canQuote ? 'quote' : null });
      }
      var comment = /\s#.*$/.exec(v);
      if (comment && v.slice(0, comment.index).trim()) {
        at(s.line, 'info', 'comment', 'docker run keeps the comment as part of the value',
          { affects: ['docker'], col: s.valueAt + comment.index + 1, len: comment[0].length, fix: 'comment' });
      }
      var core = v.replace(/\s+#.*$/, '').trim();
      if (/\s/.test(core)) {
        at(s.line, 'info', 'space in value', 'The shell reads only the first word', { affects: ['shell'], fix: canQuote ? 'quote' : null });
      }
    }
    var dollar = v.search(/\$(\{|[A-Za-z_])/);
    if (s.quote !== "'" && dollar !== -1) {
      at(s.line, 'warn', '$ is expanded', 'Compose and the shell replace the $… with a variable',
        { affects: /\$\{/.test(v) ? ['compose', 'shell', 'python'] : ['compose', 'shell'], col: s.valueAt + dollar + 1, len: (/^\$(\{[^}]*\}?|[A-Za-z_][A-Za-z0-9_]*)/.exec(v.slice(dollar)) || ['$'])[0].length,
          fix: !canQuote ? null : !s.quote ? 'quote' : s.quote === '"' && !/\\/.test(v) ? 'single' : null });
    } else if (s.quote !== "'" && /\$\$/.test(v)) {
      at(s.line, 'info', '$$', '$$ is one $ in Compose and the process id in the shell', { affects: ['compose', 'shell'] });
    }
    if (s.quote === '"' && /\\[tabfv\\"']/.test(v)) {
      at(s.line, 'info', 'backslash', 'Python and Compose turn \\t and the like into characters; Node keeps them as written', { affects: ['python', 'compose'] });
    }
    if (s.quote === '`') at(s.line, 'warn', 'backquotes', 'The shell runs a value in backquotes as a command', { affects: ['shell', 'node'] });
  });

  /* ---------- the same key twice ---------- */
  var seen = {};
  scanned.forEach(function (s) {
    if (s.bad || !s.eq) return;
    (seen[s.key] = seen[s.key] || []).push(s.line);
  });
  Object.keys(seen).forEach(function (k) {
    var lines = seen[k];
    if (lines.length < 2) return;
    var last = vars[k] ? valueOf(vars[k]) : undefined;
    at(lines[lines.length - 1], 'warn', lines.length === 2 ? 'set twice' : 'set ' + lines.length + ' times',
      'Set on lines ' + list(lines.map(String)) + '. The last one wins' + (last !== undefined ? ': ' + show(last) : ''),
      { impact: 'risk', key: k, lines: lines, fix: 'dedupe' });
  });

  /* ---------- disagreement, and the values themselves ---------- */
  var envRefs = [];
  P.PARSERS.forEach(function (p) { results[p.id].env.forEach(function (n) { if (envRefs.indexOf(n) === -1 && !own(vars, n)) envRefs.push(n); }); });
  order.forEach(function (k) {
    var v = vars[k];
    var shown = {};
    P.PARSERS.forEach(function (p) { if (!results[p.id].stopped) shown[p.id] = own(v.values, p.id) ? v.values[p.id] : undefined; });
    var distinct = [];
    Object.keys(shown).forEach(function (id) {
      var s = shown[id] === undefined ? '\u0000unset' : shown[id] === null ? '\u0000null' : shown[id];
      if (distinct.indexOf(s) === -1) distinct.push(s);
    });
    v.differs = distinct.length > 1;
    v.value = valueOf(v);
    var leak = exposed(k, v.value);
    if (leak) at(v.line, 'warn', 'public secret', leak, { impact: 'break', key: k });
    var issue = validate(k, v.value);
    if (issue) {
      at(v.line, 'warn', issue.short, issue.text, { impact: issue.soft ? 'risk' : 'break', key: k, fix: issue.fix || null });
    }
  });
  /* a variable the file does not set is noted on each line that uses it */
  envRefs.forEach(function (n) {
    var ref = new RegExp('\\$(\\{' + n + '[}:?+\\-=]|' + n + '(?![A-Za-z0-9_]))');
    scanned.forEach(function (s) {
      if (s.key && s.quote !== "'" && ref.test(s.value || '')) {
        at(s.line, 'info', 'from environment', '$' + n + ' is not set in this file. It comes from the environment, so here it reads as empty',
          { affects: ['compose', 'shell', 'python'] });
      }
    });
  });

  function linesWith(impact) {
    var out = [];
    problems.forEach(function (p) { var l = p.line === null ? 'file' : p.line; if (p.impact === impact && out.indexOf(l) === -1) out.push(l); });
    return out;
  }

  var rank = { error: 0, warn: 1, info: 2 };
  problems.sort(function (a, b) {
    return (a.line === null) - (b.line === null) || (a.line || 0) - (b.line || 0) || rank[a.severity] - rank[b.severity];
  });

  return {
    vars: order.map(function (k) { return vars[k]; }),
    problems: problems,
    results: results,
    counts: {
      error: problems.filter(function (p) { return p.severity === 'error'; }).length,
      warn: problems.filter(function (p) { return p.severity === 'warn'; }).length,
      info: problems.filter(function (p) { return p.severity === 'info'; }).length
    },
    /* lines, not findings: three findings on one line are one line to fix */
    lines: {
      break: linesWith('break'),
      risk: linesWith('risk').filter(function (l) { return linesWith('break').indexOf(l) === -1; })
    }
  };
}

/* ==========================================================================
   Comparing with .env.example
   ========================================================================== */
function compare(analysis, exampleText) {
  var ex = P.node(exampleText);
  var exKeys = [], exVals = {};
  ex.entries.forEach(function (e) { if (exKeys.indexOf(e.key) === -1) exKeys.push(e.key); exVals[e.key] = e.value; });
  var have = analysis.vars.map(function (v) { return v.key; });
  return {
    missing: exKeys.filter(function (k) { return have.indexOf(k) === -1; }).map(function (k) { return { key: k, example: exVals[k] }; }),
    extra: have.filter(function (k) { return exKeys.indexOf(k) === -1; }),
    both: have.filter(function (k) { return exKeys.indexOf(k) !== -1; }).length,
    exampleCount: exKeys.length
  };
}

/* ==========================================================================
   Writing it out
   ========================================================================== */
function yamlString(v) {
  return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
}

var SAFE_VALUE = /^(true|false|yes|no|on|off|\d+(\.\d+)?|development|production|staging|test|local|debug|info|warn|error)$/i;
var SECRETISH = /(SECRET|PASSWORD|PASSWD|PASS|TOKEN|KEY|PRIVATE|CREDENTIAL|AUTH|DSN|SALT|CERT)/i;

/* The file as a teammate should receive it: every line kept, comments too,
   and a value kept only when it cannot be a secret (a port, a flag, the
   environment's name, a URL with no user or password in it) */
function toExample(text) {
  return text.replace(/\r\n?/g, '\n').split('\n').map(function (line) {
    var m = /^(\s*(?:export\s+)?)([^=\s#]+)(\s*=\s*)(.*)$/.exec(line);
    if (!m) return line;
    var v = m[4].replace(/\s+#.*$/, '').trim().replace(/^(["'`])([\s\S]*)\1$/, '$2');
    var keep = !SECRETISH.test(m[2]) && (SAFE_VALUE.test(v) || (/^[a-z][a-z0-9+.\-]*:\/\/[^@\s]*$/i.test(v) && !/:\/\/[^/]*:[^/]*@/.test(v)));
    return m[1] + m[2] + '=' + (keep ? v : '');
  }).join('\n');
}

var EXPORTS = {
  json: function (pairs) {
    var o = {};
    pairs.forEach(function (p) { o[p.key] = p.value; });
    return JSON.stringify(o, null, 2);
  },
  /* a Compose file interpolates $ itself, so every $ is doubled */
  compose: function (pairs) {
    return 'environment:\n' + pairs.map(function (p) {
      return '  ' + p.key + ': ' + (p.value === null ? 'null' : yamlString(p.value.replace(/\$/g, '$$$$')));
    }).join('\n');
  },
  configmap: function (pairs, name) {
    return 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ' + name + '\ndata:\n' + pairs.map(function (p) {
      return '  ' + p.key + ': ' + yamlString(p.value === null ? '' : p.value);
    }).join('\n');
  },
  secret: function (pairs, name) {
    return 'apiVersion: v1\nkind: Secret\nmetadata:\n  name: ' + name + '\ntype: Opaque\nstringData:\n' + pairs.map(function (p) {
      return '  ' + p.key + ': ' + yamlString(p.value === null ? '' : p.value);
    }).join('\n');
  },
  /* single quotes keep everything; a single quote itself is closed, escaped and reopened */
  shell: function (pairs) {
    return pairs.map(function (p) {
      return 'export ' + p.key + "='" + (p.value === null ? '' : p.value).replace(/'/g, "'\\''") + "'";
    }).join('\n');
  }
};

var api = { analyze: analyze, compare: compare, exports: EXPORTS, toExample: toExample, validate: validate, kindOf: kindOf };
if (typeof module === 'object' && module.exports) module.exports = api;
else global.EnvChecks = api;
})(this);
