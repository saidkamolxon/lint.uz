# Rebuilding parquet/public/vendor

Nothing here is served. These are the inputs the vendored files were made
from, kept so they can be made again.

## hyparquet.mjs

hyparquet 1.31.1 and hyparquet-compressors 1.1.2, with `hyparquet.patch`
applied, bundled into one module.

```sh
npm i hyparquet@1.31.1 hyparquet-compressors@1.1.2 esbuild
patch -d node_modules/hyparquet -p1 < hyparquet.patch
npx esbuild hyparquet.entry.js --bundle --format=esm --minify \
  --legal-comments=none --target=es2020 --outfile=hyparquet.mjs
```

The patch changes how much of a page is decoded, never what comes out:

- **Nested columns stop at the selection.** Writers fill a page by bytes, so
  one page can hold 500,000 rows of a low-cardinality column. hyparquet
  assembles every row of every page it touches into its own arrays and
  objects, which for a struct or a list meant 1.6 GB to show 200 rows.
  Rows before the selection are now let go as soon as they are whole, and
  assembly stops once the row after it has begun: 300–500 MB at the peak,
  and it is only a peak.
- **Data page v2 skips only flat pages.** It skipped nested pages too and
  counted the skip in values rather than rows, so rows after a skipped page
  could come back empty instead of failing.

Checked against unpatched hyparquet row for row: 600 reads at page and row
group boundaries over flat, deeply nested, v1 and v2 files, with and without
a page index, all identical.

Unpatched hyparquet also fails on a `list<struct<…, list<…>>>` column written
with v2 pages (an out-of-bounds read in its level decoder). The page falls
back to DuckDB for a file hyparquet cannot read.

## duckdb-1.5.4/

`@duckdb/duckdb-wasm` 1.33.1-dev57.0, which is DuckDB v1.5.4.

```sh
npm i @duckdb/duckdb-wasm@1.33.1-dev57.0 esbuild
npx esbuild duckdb.entry.js --bundle --format=esm --minify \
  --legal-comments=none --target=es2020 --platform=browser --outfile=duckdb.mjs
gzip -9 < node_modules/@duckdb/duckdb-wasm/dist/duckdb-eh.wasm > duckdb-eh.wasm.gz
curl -O https://extensions.duckdb.org/v1.5.4/wasm_eh/parquet.duckdb_extension.wasm
curl -O https://extensions.duckdb.org/v1.5.4/wasm_eh/json.duckdb_extension.wasm
```

- **Why the blocking build.** It runs DuckDB on the thread that calls it.
  That thread is our own worker (`sql.js`), so Stop can end a query by ending
  the worker, as in the SQLite tool.
- **Why gzipped.** The wasm is 36 MB, and Cloudflare serves no single file
  over 25 MiB. The page unpacks it with `DecompressionStream`.
- **Why the extensions are here.** Parquet support is an extension in the
  wasm build, which DuckDB would otherwise fetch from extensions.duckdb.org.
  Serving the signed files from here keeps every request on lint.one.
  Their path, `ext/v1.5.4/wasm_eh/`, is the one DuckDB asks a repository
  for.

A new DuckDB version goes in a new `duckdb-<version>/` folder, so browsers
that cached the old one fetch the new files rather than mixing them.
