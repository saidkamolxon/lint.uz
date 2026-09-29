/* ==========================================================================
   lint.one/parquet — SQL, sorting and filtering, by DuckDB.

   This worker is started only when one of them is first asked for: DuckDB
   is 9 MB to fetch the first time (the service worker keeps it after that)
   and a second to start, which someone who only wants to look at a file
   should never pay. It runs DuckDB's blocking build on this thread, so the
   page's Stop ends a query by ending the worker, as in the SQLite tool.

   Nothing is fetched from anywhere but lint.one. Parquet support is an
   extension in DuckDB's wasm build; the signed file is served from beside
   this one, and DuckDB is told to look for extensions there and nowhere else.
   ========================================================================== */
import { createDuckDB, BROWSER_RUNTIME, DuckDBDataProtocol, VoidLogger } from './vendor/duckdb-1.5.4/duckdb.mjs';
import { light, whole, toCSV, toJSON, fmtTime, fmtDate, scaleDigits } from './values.js';

const BASE = new URL('./vendor/duckdb-1.5.4/', import.meta.url);
const ENGINE = 'DuckDB 1.5.4';

let db = null;
let conn = null;
let rowNumbers = true;        // whether read_parquet could add file_row_number
let fields = [];              // the file's columns, with their Arrow types
const held = new Map();       // 'grid' | 'query' -> {cols, rows}
const counts = new Map();     // filter -> matching rows

const PAGE_CAP = 1000;
const QUERY_CAP = 10000;
const EXPORT_CAP = 100000;

self.onmessage = async (e) => {
  const { id, type } = e.data;
  try {
    const out = await HANDLERS[type](e.data);
    self.postMessage({ id, ok: true, ...out });
  } catch (err) {
    self.postMessage({ id, ok: false, error: message(err) });
  }
};

/* DuckDB's messages are good; only the advice to install extensions is
   wrong here, where nothing can be installed */
function message(err) {
  const m = String((err && err.message) || err);
  if (/Out of Memory Error/i.test(m)) {
    return 'DuckDB ran out of its 1 GB of memory for this query. A LIMIT, fewer columns or a narrower WHERE usually fixes it.';
  }
  return m.replace(/\n\nPlease try installing[\s\S]*$/, '').replace(/\n\nAlternatively, consider[\s\S]*$/, '');
}

const q = (name) => '"' + String(name).replace(/"/g, '""') + '"';

/* ==========================================================================
   Starting DuckDB
   ========================================================================== */
async function engineBytes() {
  const res = await fetch(new URL('duckdb-eh.wasm.gz', BASE));
  if (!res.ok) throw new Error('The SQL engine could not be loaded (' + res.status + ').');
  const total = Number(res.headers.get('content-length')) || 8054516;
  const parts = [];
  let done = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done: end, value } = await reader.read();
    if (end) break;
    parts.push(value);
    done += value.length;
    self.postMessage({ type: 'progress', done: Math.min(done, total), total });
  }
  const packed = new Blob(parts);
  /* stored gzipped because Cloudflare serves no file over 25 MiB; if a
     server has already unpacked it on the way, it is used as it came */
  const head = new Uint8Array(await packed.slice(0, 2).arrayBuffer());
  if (head[0] !== 0x1f || head[1] !== 0x8b) return packed;
  return new Response(packed.stream().pipeThrough(new DecompressionStream('gzip'))).blob();
}

async function start() {
  if (db) return;
  const blob = await engineBytes();
  const url = URL.createObjectURL(new Blob([blob], { type: 'application/wasm' }));
  try {
    const bundle = { mainModule: url, mainWorker: '' };
    db = await createDuckDB({ mvp: bundle, eh: bundle }, new VoidLogger(), BROWSER_RUNTIME);
    await db.instantiate();
  } finally {
    URL.revokeObjectURL(url);
  }
  conn = db.connect();
  const repo = new URL('ext', BASE).href;
  [
    'SET autoinstall_known_extensions = false',
    'SET autoload_known_extensions = false',
    `SET custom_extension_repository = '${repo}'`,
    'INSTALL parquet', 'LOAD parquet',
    'INSTALL json', 'LOAD json',
    /* DuckDB keeps what it read from files in memory by default; in a tab,
       where memory is never handed back, that is the whole file */
    'SET enable_external_file_cache = false',
    "SET memory_limit = '1GB'"
  ].forEach((s) => conn.query(s));
}

async function open({ file }) {
  await start();
  db.registerFileHandle('data.parquet', file, DuckDBDataProtocol.BROWSER_FILEREADER, true);
  conn.query("CREATE OR REPLACE VIEW data AS SELECT * FROM read_parquet('data.parquet')");
  try {
    conn.query("CREATE OR REPLACE VIEW lint_numbered AS SELECT * FROM read_parquet('data.parquet', file_row_number = true)");
    rowNumbers = true;
  } catch (e) {
    rowNumbers = false;       // a column of that name already; plain sorting still works
  }
  fields = conn.query('SELECT * FROM data LIMIT 0').schema.fields;
  held.clear();
  counts.clear();
  return { engine: ENGINE };
}

/* ==========================================================================
   From Arrow to what values.js reads
   ========================================================================== */
const T = { Null: 1, Int: 2, Float: 3, Binary: 4, Utf8: 5, Bool: 6, Decimal: 7, Date: 8, Time: 9,
  Timestamp: 10, Interval: 11, List: 12, Struct: 13, Union: 14, FixedSizeBinary: 15,
  FixedSizeList: 16, Map: 17, Duration: 18, LargeBinary: 19, LargeUtf8: 20 };
const UNIT = ['s', 'ms', 'µs', 'ns'];

function label(t) {
  switch (t.typeId) {
    case T.Int: return (t.isSigned ? 'int' : 'uint') + t.bitWidth;
    case T.Float: return ['float16', 'float', 'double'][t.precision] || 'float';
    case T.Decimal: return `decimal(${t.precision}, ${t.scale})`;
    case T.Date: return 'date';
    case T.Timestamp: return 'timestamp[' + UNIT[t.unit] + (t.timezone ? ', ' + t.timezone : '') + ']';
    case T.Time: return 'time';
    case T.Utf8: case T.LargeUtf8: return 'string';
    case T.Binary: case T.LargeBinary: return 'binary';
    case T.FixedSizeBinary: return 'fixed[' + t.byteWidth + ']';
    case T.Bool: return 'bool';
    case T.List: case T.FixedSizeList: return 'list<' + label(t.children[0].type) + '>';
    case T.Struct: return 'struct<' + t.children.map((f) => f.name).join(', ') + '>';
    case T.Map: {
      const [k, v] = t.children[0].type.children;
      return 'map<' + label(k.type) + ', ' + label(v.type) + '>';
    }
    case T.Null: return 'null';
    default: return String(t).toLowerCase();
  }
}

function kind(t) {
  switch (t.typeId) {
    case T.Int: return 'int';
    case T.Float: return 'float';
    case T.Decimal: return 'decimal';
    case T.Date: return 'date';
    case T.Timestamp: return 'time';
    case T.Bool: return 'bool';
    case T.Binary: case T.LargeBinary: case T.FixedSizeBinary: return 'bin';
    case T.List: case T.FixedSizeList: case T.Struct: case T.Map: return 'nested';
    default: return 'text';
  }
}

function columnsOf(schema) {
  return schema.fields.map((f) => ({
    name: f.name, type: label(f.type), kind: kind(f.type),
    precision: f.type.precision, scale: f.type.scale
  }));
}

function timeOfDay(v, unit) {
  const per = [1, 1e3, 1e6, 1e9][unit] || 1e6;
  const n = Number(v);
  const secs = Math.floor(n / per);
  const frac = n - secs * per;
  const hms = [Math.floor(secs / 3600), Math.floor(secs / 60) % 60, secs % 60]
    .map((x) => String(x).padStart(2, '0')).join(':');
  return frac ? hms + '.' + String(frac).padStart(String(per).length - 1, '0').replace(/0+$/, '') : hms;
}

/* One Arrow value as plain JS. A top-level time or date stays a number, for
   values.js to format as the column's kind; inside a struct or a list,
   where there is no column to say what it is, it is formatted here. */
function plain(v, t, top) {
  if (v === null || v === undefined) return null;
  switch (t.typeId) {
    case T.Decimal: return scaleDigits(String(v), t.scale);
    case T.Date: return top ? v : fmtDate(v);
    case T.Timestamp: return top ? v : fmtTime(v);
    case T.Time: return timeOfDay(v, t.unit);
    case T.Interval: case T.Duration: case T.Union: return String(v);
    case T.List: case T.FixedSizeList: {
      const c = t.children[0].type;
      return Array.from(v, (x) => plain(x, c, false));
    }
    case T.Struct: {
      const o = {};
      for (const f of t.children) o[f.name] = plain(v[f.name], f.type, false);
      return o;
    }
    case T.Map: {
      const vt = t.children[0].type.children[1].type;
      const o = {};
      for (const [k, x] of v) o[String(k)] = plain(x, vt, false);
      return o;
    }
    default: return v;
  }
}

/* rows of a result, at most `cap` of them */
function rowsOf(table, cap) {
  const fields = table.schema.fields;
  const vecs = fields.map((_, i) => table.getChildAt(i));
  const n = Math.min(table.numRows, cap);
  const out = new Array(n);
  for (let r = 0; r < n; r++) out[r] = fields.map((f, i) => plain(vecs[i].get(r), f.type, true));
  return out;
}

/* ==========================================================================
   Filtering

   Casting every column to text and matching that was simple and slow: on
   eight million rows it turned every number, date and struct into a string,
   15 seconds a keystroke. Instead each column is searched as what it is:
   text directly, the text inside structs, lists and maps through their
   fields, numbers and dates only when what was typed could be one. The
   same rows match; only what is needed is read.

   "column:text" searches one column (a struct's field by its path,
   address.city:khiva), which on a large file is the fast way to look.
   ========================================================================== */
const TEXT = new Set([T.Utf8, T.LargeUtf8]);
const NUMBER = new Set([T.Int, T.Float, T.Decimal]);
const WHEN = new Set([T.Date, T.Timestamp, T.Time]);
/* contains(lower(…)) rather than ILIKE: the same match, no wildcards to
   escape, and twice as fast inside a list's lambda */
const has = (expr) => `contains(lower(${expr}), $1)`;

/* a dictionary-encoded string column is still a string column */
const valueType = (t) => t.typeId === -1 || t.dictionary ? t.dictionary : t;

/* The predicates that search one value of type t for the term. `any` says
   the column was named, so it is searched whatever its type. */
function predicates(expr, t, term, any, depth = 0) {
  t = valueType(t);
  const id = t.typeId;
  if (TEXT.has(id)) return [has(expr)];
  if (id === T.Struct) {
    return t.children.flatMap((f) =>
      predicates(`struct_extract(${expr}, '${f.name.replace(/'/g, "''")}')`, f.type, term, any, depth));
  }
  if (id === T.List || id === T.FixedSizeList) return listPredicate(expr, t.children[0].type, term, any, depth);
  if (id === T.Map) {
    const [k, v] = t.children[0].type.children;
    return [...listPredicate(`map_keys(${expr})`, k.type, term, any, depth),
            ...listPredicate(`map_values(${expr})`, v.type, term, any, depth)];
  }
  const cast = [has(`CAST(${expr} AS VARCHAR)`)];
  /* numbers and times are compared as numbers and times, which is fast;
     only a named column is matched as text when the term is not one */
  if (NUMBER.has(id)) {
    const r = numberRange(term);
    return r ? [`(${expr} ${r[0]} ${r[1]} AND ${expr} ${r[2]} ${r[3]})`] : any ? cast : [];
  }
  if (id === T.Date || id === T.Timestamp) {
    const r = timeRange(term);
    if (r) return [`(CAST(${expr} AS TIMESTAMP) >= TIMESTAMP '${r[0]}' AND CAST(${expr} AS TIMESTAMP) < TIMESTAMP '${r[1]}')`];
    return any || /^\d{1,2}:\d{2}/.test(term) ? cast : [];
  }
  if (id === T.Time) return any || /^\d{1,2}:\d{2}/.test(term) ? cast : [];
  /* bytes, when their column is named, are searched as the hex they show as */
  if (id === T.Binary || id === T.LargeBinary || id === T.FixedSizeBinary) return any ? [has(`hex(${expr})`)] : [];
  if (any) return cast;
  if (id === T.Bool && /^(true|false)$/i.test(term)) return cast;
  return [];
}

/* A number as typed, as the range of values that begin with it: 4306 is
   [4306, 4307), 4306.8 is [4306.8, 4306.9), -12.5 is (-12.6, -12.5]. So
   "4306" finds 4306.84, as reading the column would. */
function numberRange(term) {
  const m = /^([-+]?)(\d+)(?:[.,](\d+))?$/.exec(term);
  if (!m) return null;
  const digits = m[3] ? m[3].length : 0;
  const v = Number(m[2] + (m[3] ? '.' + m[3] : ''));
  const lit = (x) => x.toFixed(digits);
  const next = lit(v + 10 ** -digits);
  return m[1] === '-' ? ['>', '-' + next, '<=', '-' + lit(v)] : ['>=', lit(v), '<', next];
}

/* A date or time as typed, as the span it names: 2025 is that year,
   2025-09 that month, 2025-09-09 14 that hour */
function timeRange(term) {
  const m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2})(?:[ T](\d{1,2})(?::(\d{1,2})(?::(\d{1,2}))?)?)?)?)?$/.exec(term);
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1).map((x) => x === undefined ? undefined : Number(x));
  const at = [y, (mo || 1) - 1, d || 1, h || 0, mi || 0, se || 0];
  const from = new Date(Date.UTC(...at));
  const to = new Date(from);
  if (se !== undefined) to.setUTCSeconds(to.getUTCSeconds() + 1);
  else if (mi !== undefined) to.setUTCMinutes(to.getUTCMinutes() + 1);
  else if (h !== undefined) to.setUTCHours(to.getUTCHours() + 1);
  else if (d !== undefined) to.setUTCDate(to.getUTCDate() + 1);
  else if (mo !== undefined) to.setUTCMonth(to.getUTCMonth() + 1);
  else to.setUTCFullYear(to.getUTCFullYear() + 1);
  if (isNaN(from) || from.getUTCMonth() !== at[1]) return null;
  const iso = (x) => x.toISOString().slice(0, 19).replace('T', ' ');
  return [iso(from), iso(to)];
}

function listPredicate(expr, itemType, term, any, depth) {
  const x = 'x' + depth;
  const inner = predicates(x, itemType, term, any, depth + 1);
  return inner.length ? [`len(list_filter(${expr}, lambda ${x}: ${inner.join(' OR ')})) > 0`] : [];
}

/* "address.city:khiva" -> the field it names and what to look for */
function scoped(filter) {
  const m = /^\s*([^\s:]+)\s*:\s*(.*)$/s.exec(filter);
  if (!m) return null;
  let list = fields, t = null, expr = null;
  for (const part of m[1].split('.')) {
    const f = list.find((x) => x.name.toLowerCase() === part.toLowerCase());
    if (!f) return null;
    expr = expr === null ? q(f.name) : `struct_extract(${expr}, '${f.name.replace(/'/g, "''")}')`;
    t = valueType(f.type);
    list = t.typeId === T.Struct ? t.children : [];
  }
  return { expr, type: t, term: m[2].trim() };
}

/* the WHERE clause for a filter, and the argument it binds */
function filterOf(filter) {
  if (!filter) return { where: '', arg: null };
  const one = scoped(filter);
  const term = one ? one.term : filter.trim();
  if (!term) return { where: '', arg: null };
  const preds = one
    ? predicates(one.expr, one.type, term, true)
    : fields.flatMap((f) => predicates(q(f.name), f.type, term, false));
  const where = ' WHERE ' + (preds.length ? '(' + preds.join(' OR ') + ')' : 'false');
  /* a filter of numbers and dates alone has nothing to bind */
  return { where, arg: where.includes('$1') ? term.toLowerCase() : null };
}

function run(sql, arg) {
  if (arg === null || arg === undefined) return conn.query(sql);
  const stmt = conn.prepare(sql);
  try { return stmt.query(arg); } finally { stmt.close(); }
}

function orderBy(order) {
  return order ? ' ORDER BY ' + q(order.col) + (order.dir < 0 ? ' DESC' : ' ASC') + ' NULLS LAST' : '';
}

/* A page of rows. With a filter the page comes first and the count after,
   on its own call: the first 200 matches are found long before the last
   one is, and the page need not wait for it. */
async function rows({ offset, limit, order, filter }) {
  const { where: w, arg } = filterOf(filter);
  const n = Math.min(PAGE_CAP, Math.max(1, limit | 0));
  const off = Math.max(0, offset | 0);
  let table;
  if (order && rowNumbers) {
    /* Sort the key and the row number alone, then fetch the page's rows by
       number: sorting whole rows kept every one of them in memory, gigabytes
       for a large file */
    const by = orderBy(order) + ', file_row_number';
    table = run('SELECT * EXCLUDE (file_row_number) FROM lint_numbered WHERE file_row_number IN (' +
      'SELECT file_row_number FROM lint_numbered' + w + by + ` LIMIT ${n} OFFSET ${off})` + by, arg);
  } else {
    table = run('SELECT * FROM data' + w + orderBy(order) + ` LIMIT ${n} OFFSET ${off}`, arg);
  }
  const cols = columnsOf(table.schema);
  const out = rowsOf(table, n);
  held.set('grid', { cols, rows: out });
  /* the total is known without counting when there is no filter, when it
     was counted before, or when this first page came up short */
  let total = w ? counts.get(filter) : Number(conn.query('SELECT count(*) AS n FROM data').get(0).n);
  if (total === undefined && off === 0 && out.length < n) total = out.length;
  return { columns: cols, rows: out.map((r) => r.map((v, i) => light(v, cols[i]))), total: total === undefined ? null : total };
}

function count({ filter }) {
  if (counts.has(filter)) return { n: counts.get(filter) };
  const { where: w, arg } = filterOf(filter);
  const n = Number(run('SELECT count(*) AS n FROM data' + w, arg).get(0).n);
  counts.set(filter, n);
  return { n };
}

/* ==========================================================================
   Queries
   ========================================================================== */

/* Statements end at a semicolon outside quotes and comments */
function statements(sql) {
  const out = [];
  let from = 0, i = 0;
  while (i < sql.length) {
    const ch = sql[i], two = sql.slice(i, i + 2);
    if (two === '--') { const e = sql.indexOf('\n', i); i = e < 0 ? sql.length : e + 1; continue; }
    if (two === '/*') { const e = sql.indexOf('*/', i + 2); i = e < 0 ? sql.length : e + 2; continue; }
    if (ch === "'" || ch === '"') {
      i++;
      while (i < sql.length) {
        if (sql[i] === ch) { if (sql[i + 1] === ch) { i += 2; continue; } break; }
        i++;
      }
      i++;
      continue;
    }
    if (ch === '$') {
      const m = /^\$([A-Za-z_]*)\$/.exec(sql.slice(i));
      if (m) { const e = sql.indexOf(m[0], i + m[0].length); i = e < 0 ? sql.length : e + m[0].length; continue; }
    }
    if (ch === ';') { out.push(sql.slice(from, i)); from = i + 1; }
    i++;
  }
  out.push(sql.slice(from));
  return out.filter((s) => s.replace(/--[^\n]*|\/\*[\s\S]*?(\*\/|$)/g, '').trim());
}

/* a statement whose rows can be capped by wrapping it: DuckDB pushes the
   LIMIT inside, so SELECT * on a large file does not build all of it */
const CAPPABLE = /^\s*(?:(?:--[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*(select|with|from|values|table)\b/i;

function query({ sql }) {
  const t0 = performance.now();
  const list = statements(sql);
  if (!list.length) throw new Error('There is no statement to run.');

  let table = null;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    const last = i === list.length - 1;
    try {
      if (last && CAPPABLE.test(s)) {
        try {
          table = conn.query(`SELECT * FROM (\n${s}\n) LIMIT ${QUERY_CAP + 1}`);
        } catch (err) {
          /* the unwrapped statement gives the error its own line numbers */
          table = conn.query(s);
        }
      } else {
        const r = conn.query(s);
        if (last) table = r;
      }
    } catch (err) {
      throw new Error((list.length > 1 ? 'Statement ' + (i + 1) + ': ' : '') + message(err));
    }
  }

  const ms = performance.now() - t0;
  if (!table || !table.schema.fields.length) return { ran: list.length, ms, columns: null };
  const cols = columnsOf(table.schema);
  const out = rowsOf(table, QUERY_CAP);
  held.set('query', { cols, rows: out });
  return {
    ran: list.length, ms,
    statement: list.length > 1 ? list.length : 0,
    columns: cols,
    rows: out.slice(0, 200).map((r) => r.map((v, i) => light(v, cols[i]))),
    total: out.length,
    more: table.numRows > QUERY_CAP
  };
}

function page({ from, limit }) {
  const h = held.get('query');
  if (!h) throw new Error('Run a query first.');
  return { rows: h.rows.slice(from, from + limit).map((r) => r.map((v, i) => light(v, h.cols[i]))), offset: from };
}

function cell({ view, r, c }) {
  const h = held.get(view);
  if (!h || !h.rows[r] || !(c >= 0 && c < h.cols.length)) throw new Error('That value is no longer loaded.');
  return whole(h.rows[r][c], h.cols[c]);
}

function exportText({ view, order, filter, format }) {
  let cols, data, clipped = false;
  if (view === 'query') {
    const h = held.get('query');
    if (!h) throw new Error('Run a query first.');
    cols = h.cols;
    data = h.rows;
  } else {
    const { where: w, arg } = filterOf(filter);
    const table = run('SELECT * FROM data' + w + orderBy(order) + ` LIMIT ${EXPORT_CAP + 1}`, arg);
    cols = columnsOf(table.schema);
    data = rowsOf(table, EXPORT_CAP);
    clipped = table.numRows > EXPORT_CAP;
  }
  const text = format === 'json' ? toJSON(cols, data) : toCSV(cols, data);
  return { text, rows: data.length, clipped };
}

const HANDLERS = { open, rows, count, query, page, cell, export: exportText };
