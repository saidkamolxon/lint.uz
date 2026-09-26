/* Which lint.one tool reads a thing: by its file name, by the type a server
   gave it, and last by what it starts with. Loaded by the service worker
   (importScripts) and the popup, so the two always agree — and agree with the landing page, whose extension table this
   copies, so a file dropped there and a link opened here land in the same
   tool. */
(function (global) {
  'use strict';

  /* the suite's names and hues, as shared/app.js and the README have them */
  var TOOLS = [
    { id: 'json',   name: 'JSON',   hue: '#4F46E5', ext: 'json' },
    { id: 'yaml',   name: 'YAML',   hue: '#B45309', ext: 'yaml' },
    { id: 'csv',    name: 'CSV',    hue: '#4D7C0F', ext: 'csv' },
    { id: 'env', name: 'ENV', hue: '#A32972', ext: 'env' },
    { id: 'log',    name: 'LOG',    hue: '#0369A1', ext: 'log' },
    { id: 'xml',    name: 'XML',    hue: '#0F766E', ext: 'xml' },
    { id: 'sqlite', name: 'SQLite', hue: '#7C3AED', ext: 'db' },
    { id: 'pdf',    name: 'PDF',    hue: '#BE123C', ext: 'pdf' },
    { id: 'parquet', name: 'Parquet', hue: '#F7CE46', ext: 'parquet' },
    { id: 'audio',  name: 'Audio',  hue: '#C026D3', ext: 'mp3' }
  ];
  var BY_ID = {};
  TOOLS.forEach(function (t) { BY_ID[t.id] = t; });

  /* site/public/index.html's BY_EXT */
  var BY_EXT = {
    json: 'json', geojson: 'json', jsonc: 'json',
    jsonl: 'log', ndjson: 'log',   // until settle() reads what is in them
    xml: 'xml', svg: 'xml', xsd: 'xml', xsl: 'xml', xslt: 'xml', plist: 'xml',
    rss: 'xml', atom: 'xml', kml: 'xml', gpx: 'xml',
    yaml: 'yaml', yml: 'yaml',
    csv: 'csv', tsv: 'csv', psv: 'csv',
    pdf: 'pdf',
    log: 'log', txt: 'log', out: 'log', err: 'log',
    mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', oga: 'audio',
    opus: 'audio', m4a: 'audio', aac: 'audio', weba: 'audio',
    aif: 'audio', aiff: 'audio',
    db: 'sqlite', sqlite: 'sqlite', sqlite3: 'sqlite', db3: 'sqlite', s3db: 'sqlite',
    sl3: 'sqlite', gpkg: 'sqlite', mbtiles: 'sqlite',
    parquet: 'parquet', parq: 'parquet', pqt: 'parquet',
    env: 'env'
  };

  /* JSON Lines: a log, or data? The rule shared/app.js keeps as jsonlKind:
     'log' when most of the first 30 records carry a level, or a time and a
     message; 'data' otherwise; null when this is not JSON Lines. */
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
  /* data goes to JSON only while the JSON viewer can hold it */
  var JSON_TOOL_LIMIT = 20 * 1048576;

  /* A choice made by name or type, looked at again with the file's start:
     JSON Lines that are data go to JSON, a log to LOG */
  function settle(tool, head, size) {
    if ((tool !== 'log' && tool !== 'json') || head == null) return tool;
    var kind = jsonlKind(head);
    if (kind === 'log') return 'log';
    if (kind === 'data') return size > JSON_TOOL_LIMIT ? 'log' : 'json';
    return tool;
  }

  function extOf(name) {
    var m = /\.([a-z0-9]{1,8})$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  function byName(name) {
    /* .env, .env.local, .env.production: the name is the format */
    if (/(^|[\/\\])\.env(\.[\w-]+)?$/i.test(name || '')) return 'env';
    var e = extOf(name);
    return e && Object.prototype.hasOwnProperty.call(BY_EXT, e) ? BY_EXT[e] : null;
  }

  /* A server's Content-Type. text/plain says nothing, and text/html is a
     web page — neither picks a tool on its own. */
  function byType(type) {
    var t = String(type || '').split(';')[0].trim().toLowerCase();
    if (!t) return null;
    if (t === 'application/pdf') return 'pdf';
    if (/^audio\//.test(t)) return 'audio';
    if (/sqlite/.test(t)) return 'sqlite';
    if (/parquet/.test(t)) return 'parquet';
    if (/(^|[\/+])x?-?ndjson$|jsonl|json-seq/.test(t)) return 'log';
    if (/(^|[\/+])json$/.test(t)) return 'json';
    if (/(^|[\/+])x?-?yaml$|\/yml$/.test(t)) return 'yaml';
    if (t === 'text/csv' || t === 'text/tab-separated-values') return 'csv';
    if (/(^|[\/+])xml$/.test(t) && t !== 'application/xhtml+xml') return 'xml';
    return null;
  }

  function isWebPage(type) {
    return /^(text\/html|application\/xhtml\+xml)\b/i.test(String(type || ''));
  }

  var TIMESTAMP = /^\s*\[?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|\d{2}:\d{2}:\d{2}|[A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2})/;
  var LEVEL = /^\s*\[?(TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|ERR|FATAL|CRITICAL|VERBOSE)\b/;
  var YAML_LINE = /^(\s*-(\s|$)|\s*[A-Za-z_"'][\w .\/"'-]*:(\s|$)|\s+\S|\s*#|---|\.\.\.)/;

  /* What a piece of text is, from the text alone. JSON and XML announce
     themselves in their first character; logs by timestamps or levels at
     the start of their lines; CSV by the same count of one delimiter on
     every line; YAML by "key:" and "- " lines. Whatever is left is read as
     a log, the one tool that takes any text. Malformed JSON still goes to
     the JSON tool: finding the error is what it is for. */
  function sniffText(text) {
    var s = String(text || '').replace(/^﻿/, '');
    var lines = s.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; }).slice(0, 40);
    if (!lines.length) return 'log';
    var c = s.trim().charAt(0);

    /* "[2024-05-01 10:00] GET /" and "[INFO] ..." open with a bracket too */
    if (c === '[' && (TIMESTAMP.test(lines[0]) || LEVEL.test(lines[0]))) return 'log';
    if (c === '{' || c === '[') {
      /* one record per line: a log to read, or data to see as records */
      return jsonlKind(s) === 'log' ? 'log' : 'json';
    }
    if (c === '<') return 'xml';

    /* KEY=value on every line that is not a comment: a .env file */
    var assigns = lines.filter(function (l) { return /^\s*(export\s+)?[A-Za-z_][A-Za-z0-9_.-]*=/.test(l); }).length;
    var comments = lines.filter(function (l) { return /^\s*#/.test(l); }).length;
    if (assigns >= 2 && assigns + comments === lines.length) return 'env';

    var logLike = lines.filter(function (l) { return TIMESTAMP.test(l) || LEVEL.test(l); }).length;
    if (logLike >= Math.max(1, lines.length * 0.5)) return 'log';

    if (lines.length >= 2) {
      var delims = [',', '\t', ';', '|'];
      for (var i = 0; i < delims.length; i++) {
        var d = delims[i];
        var counts = lines.slice(0, 20).map(function (l) { return l.split(d).length - 1; });
        var first = counts[0];
        if (first >= 1 && counts.filter(function (n) { return n === first; }).length >= counts.length * 0.8) {
          return 'csv';
        }
      }
    }

    if (/^---(\s|$)/.test(s.trim()) ||
        lines.filter(function (l) { return YAML_LINE.test(l); }).length >= lines.length * 0.8 &&
        lines.some(function (l) { return /^\s*(-\s|[^:#]+:(\s|$))/.test(l); })) return 'yaml';

    return 'log';
  }

  /* The first bytes of a file, read as text. Binary formats carry a
     signature there; anything else is text and sniffed as such. */
  function sniffHead(head) {
    var h = String(head || '');
    if (h.slice(0, 16) === 'SQLite format 3\u0000') return 'sqlite';
    if (h.slice(0, 4) === 'PAR1') return 'parquet';
    if (h.slice(0, 5) === '%PDF-') return 'pdf';
    if (/^(ID3|fLaC|OggS|FORM)/.test(h) || /^RIFF....WAVE/.test(h) ||
        /^....ftypM4A/.test(h)) return 'audio';
    return sniffText(h);
  }

  /* The one decision: name first (the person or server chose it), then the
     server's type, then the content. */
  function pick(name, type, head) {
    return byName(name) || byType(type) || (head == null ? null : sniffHead(head));
  }

  /* A name worth showing in the tool's document chip: the one given, with
     the tool's extension added if it has none that the tool reads. */
  function nameFor(base, tool, text) {
    var n = String(base || '').trim() || 'untitled';
    if (byName(n) === tool) return n;
    var ext = BY_ID[tool] ? BY_ID[tool].ext : 'txt';
    if (tool === 'csv' && text && /\t/.test(String(text).split('\n')[0])) ext = 'tsv';
    return n.replace(/\.(txt|text)$/i, '') + '.' + ext;
  }

  /* what a person might type after "lint" to mean a tool: its id, its
     name, or any extension that leads to it */
  function toolFromWord(word) {
    var w = String(word || '').trim().toLowerCase().replace(/^\./, '');
    if (BY_ID[w]) return w;
    for (var i = 0; i < TOOLS.length; i++) if (TOOLS[i].name.toLowerCase() === w) return TOOLS[i].id;
    if (w === 'logs') return 'log';
    return Object.prototype.hasOwnProperty.call(BY_EXT, w) ? BY_EXT[w] : null;
  }

  global.LintFormats = {
    TOOLS: TOOLS,
    BY_ID: BY_ID,
    BY_EXT: BY_EXT,
    extOf: extOf,
    byName: byName,
    byType: byType,
    isWebPage: isWebPage,
    sniffText: sniffText,
    sniffHead: sniffHead,
    pick: pick,
    settle: settle,
    jsonlKind: jsonlKind,
    nameFor: nameFor,
    toolFromWord: toolFromWord
  };
})(self);
