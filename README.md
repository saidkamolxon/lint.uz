# lint.one

> Client-side viewers, formatters and validators for the formats you actually
> paste at 2 a.m. — production manifests, API payloads, exported spreadsheets.
> Nothing you paste ever leaves the browser.

| | Subdomain | What it does |
| :-- | :-- | :-- |
| `{}` | **[json.lint.one](https://json.lint.one)** | Collapsible tree, path copying, minify, unescape, errors pinned to the line |
| `<>` | **[xml.lint.one](https://xml.lint.one)** | Element/attribute/text tree, XPath for any node, XML → JSON |
| `—` | **[yaml.lint.one](https://yaml.lint.one)** | Indentation validation, multi-document manifests, YAML ↔ JSON |
| `⌸` | **[csv.lint.one](https://csv.lint.one)** | Sortable table, delimiter sniffing, ragged-row flagging, CSV → JSON |
| `P` | **[pdf.lint.one](https://pdf.lint.one)** | Page reader, text extraction, fonts, metadata, and what the file contains |
| `≡` | **[log.lint.one](https://log.lint.one)** | Severity filtering, folded stack traces, density strip; handles 1M+ lines |
| `♪` | **[audio.lint.one](https://audio.lint.one)** | Plays a file or another tab's sound with a live spectrum; waveform seek, tags, levels |
| `⛁` | **[lint.one/sqlite](https://lint.one/sqlite)** | Tables, schema and read-only SQL on a `.db` file; JSON cells formatted, blobs as hex or images |

The landing page at **[lint.one](https://lint.one)** links all eight, and opens
any file dropped on it in the tool that reads it.

The original domain, `lint.uz`, redirects here: every path and subdomain is
preserved, so `yaml.lint.uz` lands on `yaml.lint.one`.

Other names for a format lead to its tool: `/yml` opens YAML, `/db` and
`/sql` open SQLite, `/tsv` opens CSV, `/mp3` opens Audio, and so on. The
aliases are the same extensions the landing page routes a dropped file by,
and they work as subdomains too, so `yml.lint.one` lands on `lint.one/yaml/`.

---

## Install it

lint.one is one installable app (Chrome and Edge: the install icon in the
address bar; Safari: Share → Add to Dock / Home Screen). Installed, it shows
up in the OS **Open with** menu for every format above — a `.pdf` opens in
the PDF viewer, a `.log` in Logs — and can be made the default app for
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
- **DevTools** gets a *lint.one* panel listing every response the page
  loaded that a tool reads; one click opens it.
- **Open data pages automatically** (off until you turn it on): JSON, XML,
  YAML and CSV you open in a tab go straight to the tool.

The file travels page → extension → the tool's tab, all inside the
browser, and reaches the page with `postMessage` — never in a URL and never
through a server. The extension asks only for what those features need at
install; access to every site is requested when, and only if, you turn on
the automatic opening. See [`extension/README.md`](extension/README.md) to
load it and to publish it.

---

## Privacy

**Your data never leaves your browser.**

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
`lintuz_from` lives for two minutes after you click "Open JSON viewer" so the
destination can say *which* format is waiting on your clipboard. A file dropped on
the landing page waits in your browser's IndexedDB for the second it takes
the tool to open, and is deleted as it is read. Your text size,
split width and a few view toggles sit in localStorage. Nothing else is stored.

### Moving between tools

Converting copies the result to your clipboard and offers a button to open the
tool that reads it. The document travels on your clipboard — never in a URL,
never through a server — so the destination asks you to paste rather than
filling itself in.

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

| JSON | XML | YAML | CSV | PDF | Logs | Audio | SQLite |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `#4F46E5` indigo | `#0F766E` teal | `#B45309` ochre | `#4D7C0F` green | `#BE123C` crimson | `#0369A1` blue | `#C026D3` magenta | `#7C3AED` violet |

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
