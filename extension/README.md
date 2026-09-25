# lint.one for Chrome

Opens what you find in the browser (a selection, a link, a raw JSON page, a
DevTools response) in the lint.one tool that reads it. Nothing is uploaded:
the file goes from the page to the extension to the tool's tab, all inside
the browser.

## Try it

```bash
npm run build:extension     # extension/dist, talking to https://lint.one
```

1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. **Load unpacked** → choose `extension/dist`.
3. Pin it from the puzzle-piece menu so its button stays in the toolbar.

After changing a file, run the build again and press ↻ on the extension's
card.

To work on the site and the extension together, run `npm run dev` (the site
at `localhost:8787`) and build with `npm run dev:extension`: that build
opens files in the local site instead of lint.one, and is named
"lint.one (dev)" so the two can sit side by side.

## How it fits together

| File | Runs in | What it does |
| :-- | :-- | :-- |
| `background.js` | the service worker | Right-click menu, omnibox, messages; decides the tool, opens its tab, passes the file on |
| `grab.js` | the page a file comes from | Reads a link or the page itself, with that page's cookies, and streams it to the worker |
| `bridge.js` | lint.one | Receives the file and hands it to the page (`takeHandoff` in `shared/app.js`); remembers lint.one's theme |
| `audio/public/index.html` | the Audio tool | Takes the tab's sound from the stream id the bridge passes on (`listenTab`) |
| `auto.js` | every site, only when turned on | Sends a raw JSON/XML/YAML/CSV page to lint.one |
| `popup.*` | the toolbar button | This page, paste, tools, the one setting |
| `panel.*`, `devtools.*` | DevTools | The lint.one panel |
| `formats.js` | all of the above | Which tool reads what, the same table the landing page uses |
| `ui.css`, `ui-theme.js` | popup and panel | The few pieces `shared/` doesn't have; lint.one's theme |

The popup and panel load `shared/theme.css` and `shared/app.css`, which
the build copies in, so they share the tools' tokens, components, fonts
and glyphs rather than a copy that drifts. `icons/` holds the mark rendered
from `shared/glyph.svg` at the sizes Chrome asks for.

## Publishing to the Chrome Web Store

`npm run build:extension` also writes `extension/lint.one-extension-<version>.zip`,
which is what the store takes. Bump `version` in `src/manifest.json` for
every upload.

One-time setup, in the [Developer Dashboard](https://chrome.google.com/webstore/devconsole):
register (a one-time fee), then pick `lint.one` as the item's
**Official URL**. That needs the same Google account to be an owner of
lint.one in Search Console.

### Listing

**Name:** lint.one

**Summary** (132 characters max):
Open JSON, XML, YAML, CSV, logs, PDFs, SQLite and audio from any page in lint.one. Nothing you open leaves your browser.

**Description:**

> Right-click a selection, a link or a raw data page and open it in the
> lint.one viewer that reads it: a JSON tree with errors pinned to the line,
> XML with XPath, YAML validation, a sortable CSV table, a log reader for
> millions of lines, PDFs, SQLite databases and audio with a live spectrum.
>
> - Right-click → Open in lint.one, on a selection, a link or a file page
> - The toolbar button: open this page, paste anything, or pick a tool
> - The address bar: type "lint", a space, and paste
> - Listen to this tab: a live spectrum of any tab's sound, one click
> - DevTools: a lint.one panel with every response the page loaded
> - Optional: open JSON, XML, YAML and CSV pages automatically
>
> Private by design: lint.one runs entirely in your browser. The extension
> passes files from the page to the lint.one tab inside the browser — never
> in a URL, never through a server. No analytics, no accounts, no remote
> code.

**Category:** Developer Tools

**Screenshots:** 1280×800. The popup over a JSON page, the right-click menu
on a link, the DevTools panel, and a file opened in a tool.

**Privacy policy URL:** https://lint.one/privacy/ (`site/public/privacy/`)

### What the install dialog says

*"Read and change all your data on all websites"* — from `devtools_page`
alone (checked with `chrome.management.getPermissionWarningsByManifest`).
Without the DevTools panel it would be *"Read and change your data on
lint.one"*. `tabCapture` would add the same all-sites line, so it is an
optional permission, asked for on first use instead.

### Permission justifications

The dashboard asks for one line per permission:

| Permission | Why |
| :-- | :-- |
| `activeTab` | Reads the selection, link or page the person chose, in the tab they chose it in, only when they click. |
| `contextMenus` | Adds "Open in lint.one" to the right-click menu. |
| `scripting` | Reads the chosen selection, link or page from inside that page, so a link behind a login works with the page's own cookies. |
| `storage` | Remembers the one setting and the theme picked on lint.one. |
| `tabCapture` (optional) | Asked for the first time the person chooses "Listen to this tab": lets the lint.one Audio tab hear the tab the person chose, only when they click, to draw its live spectrum. Nothing is recorded or sent. |
| Content script on `https://lint.one/*` | Hands the file to the lint.one page that shows it. |
| `devtools_page` | Adds the lint.one panel to DevTools, which lists the responses of the page being inspected so one can be opened in a tool. Chrome words this as access to all websites; the panel reads only the inspected page, only while DevTools is open. |
| Optional access to all sites | Asked for only when the person turns on "Open data pages automatically"; lets JSON, XML, YAML and CSV pages open in lint.one by themselves, and links to other sites be read. |

**Single purpose:** open files and data found in the browser in the
lint.one viewers.

**Data usage:** collects no user data; nothing is sold, transferred or used
for anything but opening the file the person chose; remote code: none.
