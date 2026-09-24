/* ==========================================================================
   lint.one/sqlite — the database, off the page's thread.

   The page never touches SQLite itself. It posts {id, type, ...} here and
   gets {id, ok, ...} back, so a slow query can never freeze scrolling, and
   Stop can end a runaway one by ending this worker.

   The file is never loaded whole. SQLite reads it through a small VFS of our
   own that fetches only the pages a query touches, straight from the File on
   disk, so a 5 GB database costs about as much memory as a 5 MB one. It is
   opened read-only: this is a viewer, and it could not write the file anyway.
   ========================================================================== */
import sqlite3InitModule from './vendor/sqlite3.mjs';

/* the library logs every failed statement to the console; the page shows
   errors where they belong, so its own printing is switched off */
const quiet = () => {};
self.sqlite3ApiConfig = { warn: quiet, log: quiet, debug: quiet };
const ready = sqlite3InitModule({ print: quiet, printErr: quiet });

let sqlite3 = null;
let db = null;
let header = null;
let wal = false;

/* What each view is showing, in full. The page is sent a light copy (long
   text cut short, blobs as their size), and asks for a cell by position
   when it wants the whole value. */
const held = new Map();

const PAGE_CAP = 1000;       // rows one page of a table may ask for
const QUERY_CAP = 10000;     // rows a query result keeps
const EXPORT_CAP = 100000;   // rows a copy may carry
const TEXT_CAP = 600;        // characters a grid cell carries
const HEX_CAP = 16384;       // bytes of a blob shown as hex
const IMAGE_CAP = 8 * 1048576;

self.onmessage = async (e) => {
  const { id, type } = e.data;
  try {
    if (!sqlite3) { sqlite3 = await ready; installVfs(); }
    const out = await HANDLERS[type](e.data);
    self.postMessage({ id, ok: true, ...out });
  } catch (err) {
    self.postMessage({ id, ok: false, error: message(err) });
  }
};

/* "SQLITE_ERROR: sqlite3 result code 1: no such table: x" says the same
   thing three times; people only need the last part */
function message(err) {
  const m = String((err && err.message) || err);
  if (/^SQLITE_READONLY\b/.test(m)) return 'The database is open read-only, so nothing here can change it';
  if (/^SQLITE_IOERR\b/.test(m)) return 'The file could not be read. It may have been moved or changed since it was opened.';
  return m.replace(/^SQLITE_[A-Z_]+: sqlite3 result code \d+: /, '');
}

const q = (name) => '"' + String(name).replace(/"/g, '""') + '"';

/* ==========================================================================
   The file VFS — SQLite asks for bytes at an offset; we answer from the File

   Reads come in 16 KB blocks through FileReaderSync, which only a worker
   has, and the last BLOCKS of them are kept. Bigger blocks made scans
   cheaper but random lookups far dearer: a query that walks an index into
   a large table touches pages all over the file, and each miss read a whole
   megabyte to use four kilobytes of it. SQLite keeps its own small page
   cache on top.
   ========================================================================== */
const VFS = 'lint-file';
const BLOCK = 16384;
const BLOCKS = 4096;         // 64 MB at most, whatever the file's size

let file = null;             // the File being read
const blocks = new Map();    // block index -> bytes, oldest first
let reader = null;

function block(i) {
  let b = blocks.get(i);
  if (b) {
    blocks.delete(i);
    blocks.set(i, b);
    return b;
  }
  b = new Uint8Array(reader.readAsArrayBuffer(file.slice(i * BLOCK, (i + 1) * BLOCK)));
  /* A database written in WAL mode says so in bytes 18 and 19, and SQLite
     would go looking for the -wal file it cannot have. Reading them as the
     rollback journal gives the same pages; what the -wal file still held is
     missing, and the page says so. */
  if (i === 0 && b.length > 19 && (b[18] === 2 || b[19] === 2)) { b[18] = 1; b[19] = 1; }
  blocks.set(i, b);
  if (blocks.size > BLOCKS) blocks.delete(blocks.keys().next().value);
  return b;
}

function readInto(dest, at, n) {
  let done = 0;
  while (done < n) {
    const pos = at + done;
    const b = block(Math.floor(pos / BLOCK));
    const from = pos % BLOCK;
    const take = Math.min(n - done, b.length - from);
    if (take <= 0) break;
    dest.set(b.subarray(from, from + take), done);
    done += take;
  }
  return done;
}

function installVfs() {
  const { capi, wasm } = sqlite3;
  reader = new FileReaderSync();

  const io = new capi.sqlite3_io_methods();
  io.$iVersion = 1;
  sqlite3.vfs.installVfs({ io: { struct: io, methods: {
    xClose: () => 0,
    xRead(pFile, pDest, n, offset64) {
      try {
        const dest = wasm.heap8u().subarray(Number(pDest), Number(pDest) + n);
        const got = readInto(dest, Number(offset64), n);
        if (got < n) { dest.fill(0, got); return capi.SQLITE_IOERR_SHORT_READ; }
        return 0;
      } catch (e) {
        return capi.SQLITE_IOERR_READ;
      }
    },
    xWrite: () => capi.SQLITE_READONLY,
    xTruncate: () => capi.SQLITE_READONLY,
    xSync: () => 0,
    xFileSize(pFile, pSz64) {
      wasm.poke64(pSz64, BigInt(file ? file.size : 0));
      return 0;
    },
    xLock: () => 0,
    xUnlock: () => 0,
    xCheckReservedLock(pFile, pOut) { wasm.poke32(pOut, 0); return 0; },
    xFileControl: () => capi.SQLITE_NOTFOUND,
    xSectorSize: () => 4096,
    /* immutable: no locks, no journals, no checking whether it changed */
    xDeviceCharacteristics: () => capi.SQLITE_IOCAP_IMMUTABLE
  } } });

  const vfs = new capi.sqlite3_vfs();
  const base = new capi.sqlite3_vfs(capi.sqlite3_vfs_find(null));
  vfs.$iVersion = 2;
  vfs.$szOsFile = capi.sqlite3_file.structInfo.sizeof;
  vfs.$mxPathname = 512;
  vfs.$xRandomness = base.$xRandomness;
  vfs.$xSleep = base.$xSleep;
  base.dispose();
  sqlite3.vfs.installVfs({ vfs: { struct: vfs, name: VFS, methods: {
    xOpen(pVfs, zName, pFile, flags, pOutFlags) {
      /* the database itself, and nothing else: with nothing to write there
         is no journal, and temporary tables live in memory */
      if (!file || !(flags & capi.SQLITE_OPEN_MAIN_DB)) return capi.SQLITE_CANTOPEN;
      const f = new capi.sqlite3_file(pFile);
      f.$pMethods = io.pointer;
      f.dispose();
      wasm.poke32(pOutFlags, capi.SQLITE_OPEN_READONLY | capi.SQLITE_OPEN_MAIN_DB);
      return 0;
    },
    xDelete: () => 0,
    xAccess(pVfs, zName, flags, pOut) { wasm.poke32(pOut, 0); return 0; },
    xFullPathname(pVfs, zName, nOut, pOut) {
      return wasm.cstrncpy(pOut, zName, nOut) < nOut ? 0 : capi.SQLITE_CANTOPEN;
    },
    xCurrentTime(pVfs, pOut) {
      wasm.poke(pOut, 2440587.5 + Date.now() / 864e5, 'double');
      return 0;
    },
    xCurrentTimeInt64(pVfs, pOut) {
      wasm.poke(pOut, 0xbfc83e532200 + Date.now(), 'i64');
      return 0;
    },
    xGetLastError: () => 0
  } } });
}

/* ==========================================================================
   Opening
   ========================================================================== */
const MAGIC = 'SQLite format 3\u0000';

async function openFile({ file: f }) {
  const head = new Uint8Array(await f.slice(0, 100).arrayBuffer());
  if (head.length < 100 || String.fromCharCode(...head.subarray(0, 16)) !== MAGIC) {
    throw new Error(/-(wal|shm|journal)$/i.test(f.name)
      ? 'This is one of SQLite\'s side files. Open the database it belongs to.'
      : 'This is not a SQLite database. An encrypted one (SQLCipher) looks the same from outside.');
  }

  close();
  file = f;
  wal = head[18] === 2 || head[19] === 2;
  try {
    db = new sqlite3.oo1.DB({ filename: 'file:db?immutable=1', flags: 'r', vfs: VFS });
    db.exec('PRAGMA temp_store = memory; PRAGMA cache_size = -8192;');
    db.selectValue('SELECT count(*) FROM sqlite_schema');
  } catch (err) {
    close();
    throw new Error('SQLite could not read this file: ' + message(err) + '.');
  }
  header = readHeader(head);
  return describe();
}

async function openSample({ sql }) {
  close();
  db = new sqlite3.oo1.DB(':memory:');
  db.exec(sql);
  /* the sample should behave like any opened file: read-only */
  db.exec('PRAGMA query_only = 1');
  wal = false;
  header = null;
  return describe();
}

function close() {
  held.clear();
  countCache.clear();
  if (db) { try { db.close(); } catch (e) { /* already gone */ } }
  db = null;
  file = null;
  blocks.clear();
}

/* ---------- the 100-byte header ----------
   https://sqlite.org/fileformat.html#the_database_header */
function readHeader(b) {
  const u16 = (o) => (b[o] << 8) | b[o + 1];
  const u32 = (o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
  const ps = u16(16);
  return {
    pageSize: ps === 1 ? 65536 : ps,
    pageCount: u32(28),
    freelist: u32(36),
    schemaFormat: u32(44),
    encoding: ({ 1: 'UTF-8', 2: 'UTF-16le', 3: 'UTF-16be' })[u32(56)] || 'unknown',
    userVersion: u32(60) | 0,
    applicationId: u32(68),
    autoVacuum: u32(52) ? (u32(64) ? 'incremental' : 'full') : 'none',
    changeCounter: u32(24),
    writtenBy: u32(96)
  };
}

function describe() {
  const sqlVersion = sqlite3.version.libVersion;
  /* table_list names shadow tables (the insides of a full-text index) and
     virtual ones, which sqlite_schema alone cannot tell apart */
  const tables = db.selectObjects(
    "SELECT name, type, ncol, wr, strict FROM pragma_table_list WHERE schema = 'main' ORDER BY name COLLATE NOCASE");
  const kinds = db.selectObjects(
    "SELECT type, count(*) AS n FROM sqlite_schema WHERE name NOT LIKE 'sqlite_autoindex%' GROUP BY type");
  const counts = {};
  kinds.forEach((k) => { counts[k.type] = k.n; });
  return {
    tables: tables.map((t) => ({
      name: t.name,
      /* sqlite_schema and sqlite_temp_schema are listed too; they are the
         catalogue, not data, so they sort with the other internals */
      kind: t.name.startsWith('sqlite_') ? 'internal' : t.type,
      ncol: t.ncol,
      withoutRowid: !!t.wr,
      strict: !!t.strict
    })).filter((t) => t.name !== 'sqlite_temp_schema'),
    indexes: counts.index || 0,
    triggers: counts.trigger || 0,
    header,
    wal,
    engine: sqlVersion
  };
}

/* ==========================================================================
   Reading
   ========================================================================== */

/* the columns a SELECT * would show, plus generated ones; hidden columns of
   a virtual table stay hidden, as they do in the sqlite3 shell */
function columnsOf(name) {
  return db.selectObjects('SELECT name, type, pk, hidden FROM pragma_table_xinfo(?)', [name])
    .filter((c) => c.hidden !== 1);
}

function where(cols, filter) {
  if (!filter) return '';
  return ' WHERE (' + cols.map((c) =>
    'CAST(' + q(c.name) + " AS TEXT) LIKE ?1 ESCAPE '\\'").join(' OR ') + ')';
}

function likeArg(filter) {
  return '%' + filter.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
}

/* counting a filter on a big table is the slow part of paging, so a count
   is kept until the view or the filter changes */
const countCache = new Map();

function rows({ name, offset, limit, order, filter }) {
  const cols = columnsOf(name);
  if (!cols.length) throw new Error('No such table or view: ' + name);
  const w = where(cols, filter);
  const bind = filter ? [likeArg(filter)] : undefined;

  const key = name + '\u0000' + (filter || '');
  let total = countCache.get(key);
  if (total === undefined) {
    total = db.selectValue('SELECT count(*) FROM ' + q(name) + w, bind);
    countCache.set(key, total);
  }

  const by = order && cols.some((c) => c.name === order.col)
    ? ' ORDER BY ' + q(order.col) + (order.dir < 0 ? ' DESC' : ' ASC')
    : '';
  const n = Math.min(PAGE_CAP, Math.max(1, limit | 0));
  const sql = 'SELECT ' + cols.map((c) => q(c.name)).join(', ') + ' FROM ' + q(name) +
    w + by + ' LIMIT ' + n + ' OFFSET ' + Math.max(0, offset | 0);
  const out = db.selectArrays(sql, bind);

  held.set('grid', { rows: out });
  return {
    columns: cols.map((c) => ({ name: c.name, type: c.type, pk: c.pk })),
    rows: out.map(light),
    total: Number(total)
  };
}

function count({ name }) {
  return { n: Number(db.selectValue('SELECT count(*) FROM ' + q(name))) };
}

/* ---------- what crosses to the page ----------
   Numbers, NULL and short text as they are; long text cut to what a cell can
   show, with its length; a blob as its size alone. */
function light(row) {
  return row.map((v) => {
    if (v instanceof Uint8Array) return { b: v.length };
    if (typeof v === 'string' && v.length > TEXT_CAP) return { t: v.slice(0, TEXT_CAP), n: v.length };
    return v;
  });
}

function cell({ view, r, c }) {
  const h = held.get(view);
  const rows = h && h.rows;
  if (!rows || !rows[r] || c >= rows[r].length) throw new Error('That value is no longer loaded.');
  const v = rows[r][c];
  if (!(v instanceof Uint8Array)) return { value: v };

  const image = imageType(v);
  return {
    blob: {
      size: v.length,
      hex: v.slice(0, HEX_CAP),
      image,
      bytes: image && v.length <= IMAGE_CAP ? v.slice() : null
    }
  };
}

/* the magic numbers browsers can draw, so a stored thumbnail shows as one */
function imageType(b) {
  const at = (sig, o = 0) => sig.every((x, i) => b[o + i] === x);
  if (at([0x89, 0x50, 0x4E, 0x47])) return 'image/png';
  if (at([0xFF, 0xD8, 0xFF])) return 'image/jpeg';
  if (at([0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (at([0x42, 0x4D])) return 'image/bmp';
  return null;
}

/* ==========================================================================
   Schema
   ========================================================================== */
function schema({ name }) {
  const obj = db.selectObject(
    "SELECT type, sql FROM sqlite_schema WHERE name = ? COLLATE NOCASE", [name]) || {};
  const columns = db.selectObjects(
    'SELECT name, type, "notnull" AS nn, dflt_value AS dflt, pk, hidden FROM pragma_table_xinfo(?)', [name]);

  let indexes = [], foreign = [], triggers = [];
  if (obj.type !== 'view') {
    indexes = db.selectObjects(
      'SELECT name, "unique" AS uniq, origin, partial FROM pragma_index_list(?) ORDER BY name', [name])
      .map((ix) => ({
        ...ix,
        columns: db.selectValues(
          'SELECT coalesce(name, CASE cid WHEN -2 THEN \'<expression>\' ELSE \'rowid\' END) ' +
          'FROM pragma_index_info(?) ORDER BY seqno', [ix.name]),
        sql: db.selectValue('SELECT sql FROM sqlite_schema WHERE type = \'index\' AND name = ?', [ix.name]) || null
      }));
    foreign = db.selectObjects(
      'SELECT id, "table" AS target, "from" AS col, "to" AS ref, on_update, on_delete ' +
      'FROM pragma_foreign_key_list(?) ORDER BY id, seq', [name]);
  }
  triggers = db.selectObjects(
    "SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = ? ORDER BY name", [name]);

  return { type: obj.type || 'table', sql: obj.sql || null, columns, indexes, foreign, triggers };
}

/* ==========================================================================
   Queries
   ========================================================================== */

/* Split a script into statements where SQLite itself says one is complete,
   so a semicolon inside a string, a comment or a trigger body never cuts. */
function statements(sql) {
  const out = [];
  let from = 0;
  for (let i = sql.indexOf(';'); i !== -1; i = sql.indexOf(';', i + 1)) {
    const part = sql.slice(from, i + 1);
    if (sqlite3.capi.sqlite3_complete(part)) { out.push(part); from = i + 1; }
  }
  if (sql.slice(from).trim()) out.push(sql.slice(from));
  return out.filter((s) => !isBlank(s));
}

/* nothing but whitespace, comments and semicolons */
function isBlank(s) {
  return !s.replace(/--[^\n]*|\/\*[\s\S]*?(\*\/|$)/g, '').replace(/[\s;]/g, '');
}

function query({ sql }) {
  const t0 = performance.now();
  const list = statements(sql);
  if (!list.length) throw new Error('There is no statement to run.');

  let result = null, ran = 0;
  for (let i = 0; i < list.length; i++) {
    const stmt = db.prepare(list[i]);
    try {
      if (stmt.columnCount) {
        const columns = stmt.getColumnNames();
        const out = [];
        let more = false;
        while (stmt.step()) {
          if (out.length === QUERY_CAP) { more = true; break; }
          out.push(stmt.get([]));
        }
        result = { columns, out, more, index: i };
      } else {
        while (stmt.step()) { /* a statement with no columns still has to run */ }
      }
      ran++;
    } catch (err) {
      /* say which statement failed when there were several */
      throw new Error((list.length > 1 ? 'Statement ' + (i + 1) + ': ' : '') + message(err));
    } finally {
      stmt.finalize();
    }
  }

  const ms = performance.now() - t0;
  if (!result) return { ran, ms, columns: null };
  held.set('query', { columns: result.columns, rows: result.out });
  return {
    ran, ms,
    statement: list.length > 1 ? result.index + 1 : 0,
    columns: result.columns.map((name) => ({ name })),
    rows: result.out.map(light),
    total: result.out.length,
    more: result.more
  };
}

/* the page shows a query's rows a page at a time out of what is held */
function page({ from, limit }) {
  const all = held.get('query');
  if (!all) throw new Error('Run a query first.');
  return { rows: all.rows.slice(from, from + limit).map(light), offset: from };
}

/* ==========================================================================
   Copying out — CSV or JSON, built here so a large copy never blocks typing
   ========================================================================== */
function exportText({ view, name, order, filter, format }) {
  let columns, data, clipped = false;
  if (view === 'query') {
    const last = held.get('query');
    if (!last) throw new Error('Run a query first.');
    columns = last.columns;
    data = last.rows;
  } else {
    const cols = columnsOf(name);
    columns = cols.map((c) => c.name);
    const by = order && columns.includes(order.col)
      ? ' ORDER BY ' + q(order.col) + (order.dir < 0 ? ' DESC' : ' ASC') : '';
    data = db.selectArrays('SELECT ' + columns.map(q).join(', ') + ' FROM ' + q(name) +
      where(cols, filter) + by + ' LIMIT ' + (EXPORT_CAP + 1), filter ? [likeArg(filter)] : undefined);
    if (data.length > EXPORT_CAP) { data.length = EXPORT_CAP; clipped = true; }
  }
  const text = format === 'json' ? toJSON(columns, data) : toCSV(columns, data);
  return { text, rows: data.length, clipped };
}

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

function plain(v) {
  if (v instanceof Uint8Array) return hex(v);
  if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : String(v);
  return v;
}

function toCSV(columns, data) {
  const cell = (v) => {
    v = plain(v);
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) || s !== s.trim() ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [columns.map(cell).join(',')].concat(data.map((r) => r.map(cell).join(','))).join('\n');
}

function toJSON(columns, data) {
  return JSON.stringify(data.map((r) => {
    const o = {};
    columns.forEach((c, i) => { o[c] = plain(r[i]); });
    return o;
  }), null, 2);
}

function check() {
  const out = db.selectValues('PRAGMA quick_check');
  return { ok: out.length === 1 && out[0] === 'ok', problems: out };
}

const HANDLERS = {
  open: openFile,
  sample: openSample,
  close: () => { close(); return {}; },
  rows,
  count,
  cell,
  schema,
  query,
  page,
  export: exportText,
  check
};
