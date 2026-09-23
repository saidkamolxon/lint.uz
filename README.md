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

The landing page at **[lint.one](https://lint.one)** links all seven, and opens
any file dropped on it in the tool that reads it.

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

| JSON | XML | YAML | CSV | PDF | Logs | Audio |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `#4F46E5` indigo | `#0F766E` teal | `#B45309` ochre | `#4D7C0F` green | `#BE123C` crimson | `#0369A1` blue | `#C026D3` magenta |

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
`pdf/public/vendor/`); the worker and fonts load only once a file is opened,
so the initial page weight stays close to the other tools.

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
```

## License

MIT. Bundled fonts are used under the SIL Open Font License 1.1 — see
[`shared/fonts/LICENSE.txt`](shared/fonts/LICENSE.txt).
