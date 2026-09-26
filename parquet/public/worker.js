/* ==========================================================================
   lint.one/parquet — the file, off the page's thread.

   The page posts {id, type, ...} here and gets {id, ok, ...} back, so
   decompressing a large page of rows never freezes scrolling, and Stop can
   end a slow read by ending this worker.

   The file is never loaded whole. hyparquet reads the footer first, then
   only the column chunks a page of rows needs, each as a slice of the File
   on disk. Sorting, filtering and SQL go to sql.js, which loads DuckDB only
   when one of them is first asked for.
   ========================================================================== */
import { parquetMetadataAsync, parquetSchema, parquetReadObjects, compressors } from './vendor/hyparquet.mjs';
import { light, whole, display, toCSV, toJSON } from './values.js';

let file = null;
let buffer = null;
let meta = null;
let cols = null;              // the top-level columns, as the grid shows them
let held = null;              // the rows on screen, in full

const PAGE_CAP = 1000;
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

function message(err) {
  const m = String((err && err.message) || err);
  if (/^parquet /.test(m)) return 'This file could not be read: ' + m.replace(/^parquet /, '') + '.';
  return m;
}

/* bigints and typed numbers from the footer, as plain numbers for the page */
const n = (v) => v === undefined || v === null ? null : Number(v);

/* ==========================================================================
   Opening
   ========================================================================== */
async function openFile({ file: f }) {
  if (f.size < 12) throw new Error('This file is too short to be Parquet.');
  const head = new Uint8Array(await f.slice(0, 4).arrayBuffer());
  const tail = new Uint8Array(await f.slice(f.size - 4).arrayBuffer());
  const magic = (b) => String.fromCharCode(...b);
  if (magic(tail) === 'PARE') throw new Error('This Parquet file is encrypted. Its columns cannot be read without the key.');
  if (magic(head) !== 'PAR1' || magic(tail) !== 'PAR1') {
    throw new Error(magic(head) === 'PAR1'
      ? 'This Parquet file is cut short: its footer is missing. It may still be downloading, or was copied partly.'
      : 'This is not a Parquet file.');
  }

  file = f;
  buffer = { byteLength: f.size, slice: (s, e) => f.slice(s, e).arrayBuffer() };
  meta = await parquetMetadataAsync(buffer);
  const tree = parquetSchema(meta);
  cols = tree.children.map(columnOf);
  held = null;
  return describe(tree);
}

/* ---------- a column's type, in words ---------- */
function leafType(el) {
  const lt = el.logical_type, ct = el.converted_type;
  switch (lt && lt.type) {
    case 'STRING': case 'ENUM': return { type: lt.type === 'ENUM' ? 'enum' : 'string', kind: 'text' };
    case 'JSON': return { type: 'json', kind: 'nested' };
    case 'BSON': return { type: 'bson', kind: 'bin' };
    case 'UUID': return { type: 'uuid', kind: 'text' };
    case 'DATE': return { type: 'date', kind: 'date' };
    case 'DECIMAL': return decimal(lt.precision, lt.scale);
    case 'TIMESTAMP':
      return { type: 'timestamp[' + ({ MILLIS: 'ms', MICROS: 'µs', NANOS: 'ns' })[lt.unit] +
               (lt.isAdjustedToUTC ? ', UTC' : '') + ']', kind: 'time' };
    case 'TIME': return { type: 'time[' + ({ MILLIS: 'ms', MICROS: 'µs', NANOS: 'ns' })[lt.unit] + ']', kind: 'int' };
    case 'INTEGER': return { type: (lt.isSigned ? 'int' : 'uint') + lt.bitWidth, kind: 'int' };
    case 'FLOAT16': return { type: 'float16', kind: 'float' };
    case 'GEOMETRY': case 'GEOGRAPHY': return { type: lt.type.toLowerCase(), kind: 'nested' };
  }
  switch (ct) {
    case 'UTF8': case 'ENUM': return { type: 'string', kind: 'text' };
    case 'JSON': return { type: 'json', kind: 'nested' };
    case 'DATE': return { type: 'date', kind: 'date' };
    case 'DECIMAL': return decimal(el.precision, el.scale);
    case 'TIMESTAMP_MILLIS': return { type: 'timestamp[ms]', kind: 'time' };
    case 'TIMESTAMP_MICROS': return { type: 'timestamp[µs]', kind: 'time' };
    case 'INT_8': case 'INT_16': case 'INT_32': case 'INT_64':
    case 'UINT_8': case 'UINT_16': case 'UINT_32': case 'UINT_64':
      return { type: ct.toLowerCase().replace('_', ''), kind: 'int' };
  }
  switch (el.type) {
    case 'BOOLEAN': return { type: 'bool', kind: 'bool' };
    case 'INT32': return { type: 'int32', kind: 'int' };
    case 'INT64': return { type: 'int64', kind: 'int' };
    case 'INT96': return { type: 'timestamp[int96]', kind: 'time' };
    case 'FLOAT': return { type: 'float', kind: 'float' };
    case 'DOUBLE': return { type: 'double', kind: 'float' };
    case 'BYTE_ARRAY': return { type: 'binary', kind: 'bin' };
    case 'FIXED_LEN_BYTE_ARRAY': return { type: 'fixed[' + el.type_length + ']', kind: 'bin' };
  }
  return { type: String(el.type || 'unknown').toLowerCase(), kind: 'text' };
}

function decimal(precision, scale) {
  return { type: `decimal(${precision}, ${scale || 0})`, kind: 'decimal', precision, scale: scale || 0 };
}

const isList = (el) => (el.logical_type && el.logical_type.type === 'LIST') || el.converted_type === 'LIST';
const isMap = (el) => (el.logical_type && el.logical_type.type === 'MAP') ||
  el.converted_type === 'MAP' || el.converted_type === 'MAP_KEY_VALUE';

/* the whole type of a node, nested ones spelled out: list<string>,
   map<string, int64>, struct<city, zip, geo> */
function typeOf(node) {
  const el = node.element;
  if (!node.children.length) {
    const t = leafType(el);
    return el.repetition_type === 'REPEATED' ? { ...t, type: 'list<' + t.type + '>', kind: 'nested' } : t;
  }
  if (isList(el)) {
    /* the three-level list: LIST -> repeated group -> element. A repeated
       group of several fields is itself the element (the legacy two-level
       form), as the Parquet spec's backward-compatibility rules say. */
    const rep = node.children[0];
    const item = rep.children.length === 1 ? rep.children[0] : rep;
    const inner = item === rep && !rep.children.length ? leafType(rep.element).type : typeOf(item).type;
    return { type: 'list<' + inner + '>', kind: 'nested' };
  }
  if (isMap(el)) {
    const kv = node.children[0];
    const [k, v] = kv.children;
    return { type: 'map<' + (k ? typeOf(k).type : '?') + ', ' + (v ? typeOf(v).type : '?') + '>', kind: 'nested' };
  }
  const t = { type: 'struct<' + node.children.map((c) => c.element.name).join(', ') + '>', kind: 'nested' };
  return el.repetition_type === 'REPEATED' ? { type: 'list<' + t.type + '>', kind: 'nested' } : t;
}

function columnOf(node) {
  const t = typeOf(node);
  return { name: node.element.name, ...t, nullable: node.element.repetition_type !== 'REQUIRED' };
}

/* ==========================================================================
   What the file says about itself
   ========================================================================== */
function describe(tree) {
  const groups = meta.row_groups;
  const leaves = [];
  const walk = (node, depth, parent) => {
    const el = node.element;
    /* the repeated group inside a list or a map is plumbing, not a type
       anyone chose; it is named for what it is */
    const t = parent && node.children.length && (isList(parent.element) || isMap(parent.element))
      ? { type: 'repeated group', kind: 'nested' }
      : node.children.length ? typeOf(node) : leafType(el);
    const entry = {
      name: el.name, depth, type: t.type, kind: t.kind,
      physical: node.children.length ? null : String(el.type || '').toLowerCase(),
      repetition: (el.repetition_type || '').toLowerCase(),
      approx: t.kind === 'decimal' && t.precision > 15,
      leaf: !node.children.length
    };
    if (entry.leaf) Object.assign(entry, chunkFacts(node.path, t));
    leaves.push(entry);
    node.children.forEach((c) => walk(c, depth + 1, node));
  };
  tree.children.forEach((c) => walk(c, 0, null));

  const codecs = new Set(), encodings = new Set();
  let compressed = 0, uncompressed = 0;
  for (const g of groups) for (const c of g.columns) {
    const m = c.meta_data;
    if (!m) continue;
    codecs.add(m.codec);
    m.encodings.forEach((x) => encodings.add(x));
    compressed += Number(m.total_compressed_size);
    uncompressed += Number(m.total_uncompressed_size);
  }

  return {
    rows: n(meta.num_rows),
    columns: cols,
    schema: leaves,
    groups: groups.map((g) => ({
      rows: n(g.num_rows),
      bytes: n(g.total_compressed_size) || g.columns.reduce((s, c) => s + Number(c.meta_data ? c.meta_data.total_compressed_size : 0), 0),
      raw: n(g.total_byte_size)
    })),
    version: meta.version,
    createdBy: meta.created_by || null,
    kv: (meta.key_value_metadata || []).map(({ key, value }) => {
      /* Arrow keeps its whole schema here as base64 flatbuffers: say what it
         is rather than print a wall of it */
      if (key === 'ARROW:schema') return { key, note: 'The Arrow schema this file was written from, ' + (value || '').length + ' characters of base64' };
      const v = value || '';
      let json = null;
      if (/^\s*[[{]/.test(v)) { try { json = JSON.stringify(JSON.parse(v), null, 2); } catch (e) { /* not JSON */ } }
      return { key, value: json || v, json: !!json };
    }),
    codecs: [...codecs],
    encodings: [...encodings],
    compressed, uncompressed,
    metaBytes: n(meta.metadata_length),
    reader: 'hyparquet 1.31.1'
  };
}

/* per leaf column: its codec, sizes across every row group, and what the
   statistics say — nulls and the smallest and largest value */
function chunkFacts(path, t) {
  let compressed = 0, uncompressed = 0, nulls = 0, haveNulls = true, min, max;
  const codecs = new Set(), encodings = new Set();
  for (const g of meta.row_groups) {
    const c = g.columns.find((x) => x.meta_data && x.meta_data.path_in_schema.join('.') === path.join('.'));
    const m = c && c.meta_data;
    if (!m) continue;
    codecs.add(m.codec);
    m.encodings.forEach((x) => encodings.add(x));
    compressed += Number(m.total_compressed_size);
    uncompressed += Number(m.total_uncompressed_size);
    const s = m.statistics;
    if (s && s.null_count !== undefined) nulls += Number(s.null_count); else haveNulls = false;
    const lo = s && (s.min_value !== undefined ? s.min_value : s.min);
    const hi = s && (s.max_value !== undefined ? s.max_value : s.max);
    if (lo !== undefined && lo !== null && (min === undefined || lo < min)) min = lo;
    if (hi !== undefined && hi !== null && (max === undefined || hi > max)) max = hi;
  }
  const shown = (v) => {
    /* statistics of bytes are bytes too; as text they are noise */
    if (v === undefined || t.kind === 'bin') return null;
    const d = display(v, t);
    if (d instanceof Uint8Array) return d.length + ' bytes';
    const s = String(d);
    return s.length > 80 ? s.slice(0, 80) + '…' : s;
  };
  return {
    codec: [...codecs].join(', '), encodings: [...encodings],
    compressed, uncompressed,
    nulls: haveNulls ? nulls : null,
    min: shown(min), max: shown(max)
  };
}

/* ==========================================================================
   Reading rows — only the columns and row groups a page touches
   ========================================================================== */
async function read(from, to) {
  if (to <= from) return [];
  const objs = await parquetReadObjects({
    file: buffer, metadata: meta, rowStart: from, rowEnd: to,
    compressors, utf8: false
  });
  return objs.map((o) => cols.map((c) => o[c.name]));
}

async function rows({ offset, limit }) {
  const total = Number(meta.num_rows);
  const from = Math.max(0, Math.min(offset | 0, total));
  const to = Math.min(total, from + Math.min(PAGE_CAP, Math.max(1, limit | 0)));
  const out = await read(from, to);
  held = out;
  return { columns: cols, rows: out.map((r) => r.map((v, i) => light(v, cols[i]))), total };
}

function cell({ r, c }) {
  if (!held || !held[r] || !(c >= 0 && c < cols.length)) throw new Error('That value is no longer loaded.');
  return whole(held[r][c], cols[c]);
}

/* the file's own order, from the top */
async function exportText({ format }) {
  const total = Number(meta.num_rows);
  const to = Math.min(total, EXPORT_CAP);
  const data = await read(0, to);
  const text = format === 'json' ? toJSON(cols, data) : toCSV(cols, data);
  return { text, rows: data.length, clipped: total > to };
}

function close() {
  file = buffer = meta = cols = held = null;
  return {};
}

const HANDLERS = { open: openFile, rows, cell, export: exportText, close };
