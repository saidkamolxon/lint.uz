# lint.one

> Client-side viewers, formatters and validators for the formats you actually
> paste at 2 a.m. — production manifests, API payloads, exported spreadsheets.
> Nothing you paste ever leaves the browser.

| | Subdomain | What it does |
| :-- | :-- | :-- |
| `{}` | **[json.lint.one](https://json.lint.one)** | Collapsible tree, path copying, minify, unescape, errors pinned to the line; JSON Lines (`.jsonl`, `.ndjson`) as records, to an array or CSV. JSON Lines that read as a log (a level, or a time and a message) open in LOG instead, and so does data over 20 MB |
| `—` | **[yaml.lint.one](https://yaml.lint.one)** | Indentation validation, multi-document manifests, YAML ↔ JSON |
| `⌸` | **[csv.lint.one](https://csv.lint.one)** | Sortable table, delimiter sniffing, ragged-row flagging, CSV → JSON |
| `⚿` | **[lint.one/env](https://lint.one/env)** | How Node, Python, Compose, `docker run` and the shell each read a `.env` file; trailing spaces, duplicates, bad ports and URLs; diff against `.env.example`; export to Compose or Kubernetes |
| `≡` | **[log.lint.one](https://log.lint.one)** | Severity filtering, folded stack traces, density strip; handles 1M+ lines |
| `⋯` | **[lint.one/har](https://lint.one/har)** | The requests in a browser's HAR export: what failed, was slow, large or repeated at a glance; search through headers and bodies, `status:5xx time:>1s` filters; grouped by endpoint (`/users/{id}`) or domain; headers, bodies, timing; copy as cURL, fetch, Python, C#, PowerShell or raw HTTP; finds cookies, tokens and passwords and saves a copy without them |
| `<>` | **[xml.lint.one](https://xml.lint.one)** | Element/attribute/text tree, XPath for any node, XML → JSON |
| `⛁` | **[lint.one/sqlite](https://lint.one/sqlite)** | Tables, schema and read-only SQL on a `.db` file; JSON cells formatted, blobs as hex or images |
| `P` | **[pdf.lint.one](https://pdf.lint.one)** | Page reader, text extraction, fonts, metadata, and what the file contains |
| `⫼` | **[lint.one/parquet](https://lint.one/parquet)** | Rows, schema, row groups and column statistics of a `.parquet` file; sorting, filtering and SQL by DuckDB |
| `♪` | **[audio.lint.one](https://audio.lint.one)** | Plays a file or another tab's sound with a live spectrum; waveform seek, tags, levels |

The landing page at **[lint.one](https://lint.one)** links all eleven, and opens
any file dropped on it in the tool that reads it.

The original domain, `lint.uz`, redirects here: every path and subdomain is
preserved, so `yaml.lint.uz` lands on `yaml.lint.one`.

Other names for a format lead to its tool: `/yml` opens YAML, `/db` and
`/sql` open SQLite, `/parq` opens Parquet, `/dotenv` opens .env, `/tsv` opens CSV, `/mp3` opens Audio, and so on. The
aliases are the same extensions the landing page routes a dropped file by,
and they work as subdomains too, so `yml.lint.one` lands on `lint.one/yaml/`.

---

## Install it

lint.one is one installable app (Chrome and Edge: the install icon in the
address bar; Safari: Share → Add to Dock / Home Screen). Installed, it shows
up in the OS **Open with** menu for every format above — a `.pdf` opens in
the PDF viewer, a `.log` in LOG — and can be made the default app for
any of them. The manifest's `file_handlers` send each type to its page;
the file is handed to the page by the browser, never uploaded.

## Browser extension

[`extension/`](extension/) is a Chrome extension that brings lint.one to
wherever the data already is:

- **Right-click** a selection, a link or an audio element, or a page that
  is a file (`/users.json`, `/report.csv`), and choose *Open in lint.one*.
  A link is read by the page it is on, with that page's cookies, so a file
  behind a login opens exactly as clicking it would.
- **The toolbar button** opens the page you are on, anything you paste,
  or any tool.
- **The address bar:** type `lint`, a space, then paste.
- **Listen to this tab**, from the toolbar button or the right-click menu
  while a tab plays sound, opens the Audio tool on it with no share-a-tab
  picker. Chrome still marks the tab as captured.
- **From DevTools:** right-click a request → *Open in new tab*, then open
  that page from the toolbar button; or *Copy response* and paste it.
- **Open data pages automatically** (off until you turn it on): JSON, XML,
  YAML and CSV you open in a tab go straight to the tool.

The file travels page → extension → the tool's tab, all inside the
browser, and reaches the page with `postMessage` — never in a URL and never
through a server. Access to every site is requested when, and only if,
you turn on the automatic opening, and tab capture the first time you
listen to a tab, so Chrome's install dialog says only "Read and change
your data on lint.one". See [`extension/README.md`](extension/README.md) to
load it and to publish it.

---

## Privacy

**Your data never leaves your browser.** The full policy, the extension
included, is at [lint.one/privacy](https://lint.one/privacy/).

- **Entirely client-side.** Parsing, validation, formatting and conversion run
  in the page via `JSON.parse`, `DOMParser` and bundled zero-telemetry
  libraries. There is no backend, no API, no database, no analytics.
- **No third-party requests at all.** Fonts are self-hosted, so opening any
  tool makes zero outbound connections. The landing page counts its own
  cross-origin requests and shows you the number.
- **Verify it yourself.** Open DevTools → Network, paste a production secret,
  and watch nothing happen.

Three cookies, none carrying document data: `lintuz_theme` and
`lintuz_contrast` remember the look you picked so every page agrees, and
`lintuz_from` lives for two minutes, only if a converted document could not
be handed over directly (below), so the destination can say *which* format is
waiting on your clipboard. A file dropped on the landing page, or a document
converted for another tool, waits in your browser's IndexedDB for the second it
takes the tool to open, and is deleted as it is read. Your text size,
split width and a few view toggles sit in localStorage. Nothing else is stored.

### Moving between tools

Converting (YAML → JSON, JSON → YAML, XML → JSON, CSV → JSON, SQLite and
Parquet rows → JSON or CSV) copies the result to your clipboard and offers to open
the tool that reads it — click the button or press Enter. The tool opens with
the document already in it: it travels through IndexedDB on your device, the
way a dropped file does, never in a URL and never through a server. If the
browser blocks IndexedDB, the destination asks you to paste from the
clipboard instead.

---

## Design system

Every page shares one system in [`shared/`](shared/):

| File | Role |
| :-- | :-- |
| `theme.css` | Design tokens and the three themes |
| `app.css` | Every shared component |
| `menu.css` | The menu component, shared with the landing page |
| `app.js` | Tree rendering, search, editor, empty state, file I/O |
| `shell.js` | The toolbar/split/status frame, rendered identically everywhere |
| `theme-boot.js` | Theme and contrast: read, saved, applied before first paint, and the menu |
| `glyphs/` | One mark per format, used as a mask on the format's hue |
| `fonts/` | IBM Plex Sans + JetBrains Mono, variable woff2 (SIL OFL) |

**Each format owns one hue and one glyph**, appearing only in the editor
gutter, the logo mark, the suite menu and the favicon — so a tab is identifiable at a glance while the suite
still reads as one product:

| JSON | YAML | CSV | ENV | LOG | HAR | XML | SQLite | PDF | Parquet | Audio |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `#4F46E5` indigo | `#B45309` ochre | `#4D7C0F` green | `#A32972` raspberry | `#0369A1` blue | `#475569` slate | `#0F766E` teal | `#7C3AED` violet | `#BE123C` crimson | `#F7CE46` saffron | `#C026D3` magenta |

**Themes:** System, Light and Dark, each with an **Increase contrast** switch
(WCAG AAA palettes) that starts from the OS setting. To add a theme, copy a
block in `theme.css`, rename the selector, and register it in `THEMES` in
`theme-boot.js`.

**Keyboard:** every page lists its shortcuts under `?` (or Ctrl/⌘+/). They
follow VS Code and Windows Terminal where one exists: Shift+Alt+F formats,
Alt+Z wraps, Alt+Shift+←/→ resizes the split, Ctrl/⌘ with + − 0 or the wheel
sizes the document text (never the page), and Alt+W closes the file.

A tool's own `index.html` holds only what is genuinely format-specific: its
parser, syntax highlighter, tree adapter, sample document and toolbar actions.

**PDF is the exception.** A rendered page is the content, so it has no
editor/tree split and builds its own single-pane frame from `LintApp.mountChrome`
rather than `shell.js`. It also cannot be *themed* the way text can — a page is
an image the author fixed. The chrome is themed like everything else, and the
sheet gets an explicit **Normal / Dim / Invert** control, defaulting to Dim on
dark themes until the reader chooses otherwise. It bundles PDF.js (Apache-2.0,
`pdf/public/vendor/`) and its WebAssembly image decoders (`vendor/wasm/`: JBIG2,
JPEG 2000 and ICC colour, which scanned documents need; BSD, Apache-2.0 and
MIT); the worker, decoders and fonts load only once a file needs them,
so the initial page weight stays close to the other tools.

**SQLite builds its own frame too**, for the same reason: a database is a set
of tables, not one text. It bundles the official SQLite WebAssembly build
(`sqlite/public/vendor/`, SQLite is public domain) and runs it in a worker, so
a slow query never freezes the page and Stop can end it. The file is never
loaded whole: a small read-only VFS fetches the pages a query touches straight
from the file on disk, keeping at most 64 MB of them, so a database of any size
opens at once and costs a tab about the same memory. Queries that jump all over
a very large table (an index lookup per row) are slower than in native SQLite
for the same reason. A database saved in WAL mode opens without whatever its
`-wal` file still held, and the page says so.

**Parquet uses two readers.**
- **Browsing is hyparquet** (MIT, 170 KB, `parquet/public/vendor/`). It
  starts at once, reads the footer, and fetches only the column chunks a
  screen of rows needs, straight from the file on disk. It is patched so a
  nested column decodes only the rows asked for.
  [`parquet/vendor-build/`](parquet/vendor-build/) has the patch and why.
- **Sorting, filtering and SQL are DuckDB** (MIT, `vendor/duckdb-1.5.4/`).
  Its blocking wasm build runs in a worker of our own, so Stop ends a query
  by ending that worker. The file is the table `data`.
- **DuckDB loads only when needed.** It is 9 MB, so it loads the first time
  one of those is asked for. The service worker keeps it after that but
  leaves it out of the copy every visitor downloads.
- **Nothing is fetched from elsewhere.** Its Parquet and JSON extensions are
  served from beside it, so DuckDB never reaches out to
  extensions.duckdb.org.
- **DuckDB is the fallback.** When hyparquet cannot decode a file, DuckDB
  reads its rows instead.
- **The filter searches each column as what it is.** Text is matched
  directly, including the text inside structs, lists and maps. Numbers and
  dates are compared by value, and only when the term could be one:
  `4306` finds 4306.84 and `2025-09` finds that month. `column:text` looks
  in one column only (`city:khiva`, `address.city:khiva`). The page appears
  as soon as its rows are found; the count follows.

**.env has no specification**, so the tool reads a file the way five
programs do and shows where they part:
- **By default no program is chosen.** Each value is what most of them
  read, and a note marks the lines they read differently. Choosing a
  program shows its values instead.
- **It answers whether the file works.** The panel opens with how many lines break the app and how many
  might. The editor underlines the exact text at fault. Each finding has a one-click fix that Ctrl/⌘+Z undoes.
- **The programs:** dotenv for Node, python-dotenv, Docker Compose's
  `env_file`, `docker run --env-file` and a shell that sources the file.
- **How the emulations are checked.** Each one lives in
  `env/public/parsers.js` and was run against the real program on the
  same files: 30 hand-written edge cases, plus several thousand generated
  ones across three runs. They matched every time except one case, a `\0`
  escape in Compose.
  - `docker run` could not be run, so it follows docker/cli's source.
- **The checks** (`checks.js`) explain each difference:
  - a # that Node cuts a value at;
  - a $ that Compose and the shell expand;
  - trailing spaces that only `docker run` keeps.

  They also flag duplicate keys, invisible characters, and values that do
  not fit their name (`*_PORT`, `*_URL`, flags, hosts, e-mails,
  placeholders).

---

## Local development

```bash
git clone https://github.com/saidkamolxon/lint.uz.git
cd lint.uz

npm run dev            # every tool at http://localhost:8787/<tool>/
```

`build.mjs` assembles `site/dist/`: the landing page at the root, each tool in
a folder named after its path, and one copy of `shared/`. Nothing is bundled
or transpiled — the files land as-is and stay readable in view-source.

## Deployment

Two Cloudflare Workers. `site` serves the landing page and every tool at
`lint.one/<tool>`; `redirect` sends `lint.uz` and the old subdomains there.
Pushing to `main` runs `.github/workflows/deploy.yml`, which deploys whichever
of the two changed.

```bash
npm run deploy           # the site
npm run deploy:redirect  # the redirect worker
npm run build:extension  # the extension, zipped for the Chrome Web Store
```

## License

MIT. Bundled fonts are used under the SIL Open Font License 1.1 — see
[`shared/fonts/LICENSE.txt`](shared/fonts/LICENSE.txt).
