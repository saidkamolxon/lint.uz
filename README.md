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

The landing page at **[lint.one](https://lint.one)** links all six.

The original domain, `lint.uz`, redirects here: every path and subdomain is
preserved, so `yaml.lint.uz` lands on `yaml.lint.one`.

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

Two cookies, both on `.lint.one`, neither carrying document data:
`lintuz_theme` remembers the theme you picked so all four tools agree, and
`lintuz_from` lives for two minutes after you click "Open JSON viewer" so the
destination can say *which* format is waiting on your clipboard. Nothing else
is stored.

### Moving between tools

Converting copies the result to your clipboard and offers a button to open the
tool that reads it. The document travels on your clipboard — never in a URL,
never through a server — so the destination asks you to paste rather than
filling itself in.

---

## Design system

All five properties share one system in [`shared/`](shared/):

| File | Role |
| :-- | :-- |
| `theme.css` | Design tokens and all six themes |
| `app.css` | Every shared component |
| `app.js` | Tree rendering, search, editor, themes, file I/O |
| `shell.js` | The toolbar/split/status frame, rendered identically everywhere |
| `theme-boot.js` | Applies the saved theme before first paint |
| `fonts/` | Inter + JetBrains Mono, variable woff2 (SIL OFL) |

**Each format owns one hue**, appearing only in the editor gutter, the logo
mark and the favicon — so a tab is identifiable at a glance while the suite
still reads as one product:

| JSON | XML | YAML | CSV | PDF |
| :-- | :-- | :-- | :-- | :-- |
| `#4F46E5` indigo | `#0F766E` teal | `#B45309` ochre | `#9333EA` plum | `#BE123C` crimson |

Plus `log` at `#0369A1` signal blue.

**Themes:** System, Daylight, Slate, Paper, Midnight, Contrast (WCAG AAA).
To add one, copy a block in `theme.css`, rename the selector, and register it
in `THEMES[]` in `app.js`.

A tool's own `index.html` holds only what is genuinely format-specific: its
parser, syntax highlighter, tree adapter, sample document and toolbar actions.

**PDF is the exception.** A rendered page is the content, so it has no
editor/tree split and builds its own single-pane frame from `LintApp.mountChrome`
rather than `shell.js`. It also cannot be *themed* the way text can — a page is
an image the author fixed. The chrome is themed like everything else, and the
sheet gets an explicit **Normal / Dim / Invert** control, defaulting to Dim on
dark themes until the reader chooses otherwise. It bundles PDF.js (Apache-2.0,
`pdf/public/vendor/`); the worker and fonts load only once a file is opened,
so the initial page weight stays close to the other tools.

---

## Local development

```bash
git clone https://github.com/saidkamolxon/lint.uz.git
cd lint.uz

npm run build          # copy shared/ into every public/
npm run dev:json       # or dev:xml, dev:yaml, dev:csv, dev:site
```

`build.mjs` copies `shared/` into each tool's `public/` so Wrangler can serve
it as a static asset. Nothing is bundled or transpiled — the files land as-is
and stay readable in view-source. The generated `*/public/shared/` directories
are gitignored.

## Deployment

Each property is a Cloudflare Worker with static assets. Pushing to `main`
runs `.github/workflows/deploy.yml`, which deploys only what changed — and
redeploys everything when `shared/` changes, since all five embed it.

```bash
npm run deploy:json    # or deploy:xml, deploy:yaml, deploy:csv, deploy:site
```

## License

MIT. Bundled fonts are used under the SIL Open Font License 1.1 — see
[`shared/fonts/LICENSE.txt`](shared/fonts/LICENSE.txt).
