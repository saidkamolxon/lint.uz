/* ==========================================================================
   lint.one/parquet — what a value looks like, for both workers.

   The file reader (worker.js, hyparquet) and the SQL engine (sql.js, DuckDB)
   hand back values in different shapes: a Date or a number of milliseconds,
   a float or an exact decimal string. Everything that crosses to the page
   goes through here first, so a column reads the same whichever of them
   read it.

   What the page is sent for a cell: null, a number, a bigint, a boolean, a
   short string; long text as {t, n} (the start and the length); bytes as
   {b} (the length alone). The page asks for the whole value when it wants it.
   ========================================================================== */

export const TEXT_CAP = 600;      // characters a grid cell carries
export const HEX_CAP = 16384;     // bytes of a binary value shown as hex
export const IMAGE_CAP = 8 * 1048576;

/* kinds the page styles by: numbers right-aligned, times and dates as text */
export const NUMERIC = new Set(['int', 'float', 'decimal']);

/* ---------- times ---------- */
export function fmtTime(d) {
  if (typeof d === 'number') d = new Date(d);
  if (!(d instanceof Date) || isNaN(d)) return 'Invalid date';
  const s = d.toISOString();
  return s.replace('T', ' ').replace(/\.000Z$|Z$/, '');
}

export function fmtDate(d) {
  if (typeof d === 'number') d = new Date(d);
  if (!(d instanceof Date) || isNaN(d)) return 'Invalid date';
  return d.toISOString().slice(0, 10);
}

/* An exact decimal from its unscaled digits: "430684", scale 2 -> "4306.84" */
export function scaleDigits(digits, scale) {
  let s = String(digits);
  if (!scale) return s;
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  s = s.padStart(scale + 1, '0');
  return (neg ? '-' : '') + s.slice(0, -scale) + '.' + s.slice(-scale);
}

/* ---------- JSON, for nested values and for copying out ----------
   A bigint that fits a double stays a number; one that does not becomes a
   string, since JSON has no way to carry it. Bytes become hex. */
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export function jsonable(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : String(v);
  if (v instanceof Date) return isNaN(v) ? null : v.toISOString();
  if (v instanceof Uint8Array) return hex(v);
  if (Array.isArray(v)) return v.map(jsonable);
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = jsonable(v[k]);
    return o;
  }
  if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
  return v;
}

/* ---------- one value, as a column of this kind shows it ----------
   col = {kind, scale, precision}. Returns the full display value: a string
   for anything that is not plainly a number or a boolean. */
export function display(v, col) {
  if (v === null || v === undefined) return null;
  switch (col.kind) {
    case 'time': return v instanceof Date || typeof v === 'number' ? fmtTime(v) : String(v);
    case 'date': return v instanceof Date || typeof v === 'number' ? fmtDate(v) : String(v);
    case 'decimal':
      /* hyparquet gives a float; up to 15 digits, fixing the scale gives the
         exact value back. Wider decimals are marked approximate in the schema
         and read exactly by SQL, which hands over a string. */
      if (typeof v === 'number') return col.precision <= 15 ? v.toFixed(col.scale || 0) : String(v);
      return String(v);
    case 'bin':
      return v;
    case 'nested':
      return typeof v === 'string' ? v : JSON.stringify(jsonable(v));
    default:
      if (v instanceof Date) return fmtTime(v);
      if (v instanceof Uint8Array) return v;
      if (typeof v === 'object') return JSON.stringify(jsonable(v));
      return v;
  }
}

/* what crosses to the page for a grid cell */
export function light(v, col) {
  const d = display(v, col);
  if (d instanceof Uint8Array) return { b: d.length };
  if (typeof d === 'string' && d.length > TEXT_CAP) return { t: d.slice(0, TEXT_CAP), n: d.length };
  return d;
}

/* a cell's whole value, for the drawer */
export function whole(v, col) {
  const d = display(v, col);
  if (d instanceof Uint8Array) {
    const image = imageType(d);
    return { blob: { size: d.length, hex: d.slice(0, HEX_CAP), image,
                     bytes: image && d.length <= IMAGE_CAP ? d.slice() : null } };
  }
  if (col.kind === 'nested' && d !== null) {
    return { value: JSON.stringify(jsonable(v), null, 2), nested: true };
  }
  return { value: d };
}

/* the magic numbers browsers can draw, so a stored thumbnail shows as one */
export function imageType(b) {
  const at = (sig, o = 0) => sig.every((x, i) => b[o + i] === x);
  if (at([0x89, 0x50, 0x4E, 0x47])) return 'image/png';
  if (at([0xFF, 0xD8, 0xFF])) return 'image/jpeg';
  if (at([0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (at([0x42, 0x4D])) return 'image/bmp';
  return null;
}

/* ---------- copying out ---------- */
function plainOut(v, col) {
  const d = display(v, col);
  if (d instanceof Uint8Array) return hex(d);
  if (col.kind === 'nested' && d !== null) return jsonable(v);
  if (typeof d === 'bigint') return Number.isSafeInteger(Number(d)) ? Number(d) : String(d);
  return d;
}

export function toCSV(cols, rows) {
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) || s !== s.trim() ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.map((c) => cell(c.name)).join(',')]
    .concat(rows.map((r) => cols.map((c, i) => cell(plainOut(r[i], c))).join(','))).join('\n');
}

export function toJSON(cols, rows) {
  return JSON.stringify(rows.map((r) => {
    const o = {};
    cols.forEach((c, i) => {
      let v = plainOut(r[i], c);
      /* an exact decimal is a number in JSON when a double holds it exactly */
      if (c.kind === 'decimal' && typeof v === 'string' && c.precision <= 15) v = Number(v);
      o[c.name] = v;
    });
    return o;
  }), null, 2);
}
