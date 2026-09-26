/* lint.one — one worker, every tool.

   The tools live at paths rather than subdomains because search engines pool
   a domain's authority across its paths and largely split it across
   subdomains. With six tools that meant six reputations starting from zero.

   Beyond serving static assets this worker does two things: it keeps one
   canonical spelling per tool, and it turns a request for a format that does
   not exist yet into something useful — a page that says so and counts how
   many people wanted it. */

const TOOLS = ['json', 'xml', 'yaml', 'csv', 'pdf', 'log', 'audio', 'sqlite', 'parquet'];

/* Other names people type for a format we read, each sent to the tool that
   reads it: /yml is /yaml, /db is /sqlite. The same names the landing page
   routes a dropped file by, so a path and a file never disagree. Subdomains
   arrive here as paths (the redirect worker makes yml.lint.one /yml), so
   they follow too. */
const ALIASES = {
  yml: 'yaml',
  geojson: 'json', jsonc: 'json',
  svg: 'xml', xsd: 'xml', xsl: 'xml', xslt: 'xml', plist: 'xml',
  rss: 'xml', atom: 'xml', kml: 'xml', gpx: 'xml',
  tsv: 'csv', psv: 'csv',
  logs: 'log', txt: 'log', out: 'log', err: 'log', jsonl: 'log', ndjson: 'log',
  mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', oga: 'audio', opus: 'audio',
  m4a: 'audio', aac: 'audio', weba: 'audio', aiff: 'audio',
  db: 'sqlite', sql: 'sqlite', sqlite3: 'sqlite', db3: 'sqlite', s3db: 'sqlite',
  sl3: 'sqlite', gpkg: 'sqlite', mbtiles: 'sqlite',
  parq: 'parquet', pqt: 'parquet'
};

/* What might plausibly be a file format someone hoped for: short, letters and
   digits, containing at least one letter. Digits may lead — 3js, 7z and mp4
   are all real. Keeps /about and crawler noise out of the table while still
   accepting formats nobody predicted. */
const FORMAT_RE = /^(?=.*[a-z])[a-z0-9]{1,12}$/;

/* Reserved words that are clearly not formats, so they get a plain 404 */
const NOT_FORMATS = new Set([
  'about', 'privacy', 'terms', 'contact', 'blog', 'docs', 'api', 'admin',
  'login', 'signup', 'search', 'assets', 'static', 'shared', 'favicon',
  'robots', 'sitemap', 'index', 'wp', 'wordpress', 'php', 'cgi'
]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/interest') return interest(request, env);

    const bare = path.replace(/^\/+|\/+$/g, '');
    const name = bare.toLowerCase();

    /* /JSON and /json both mean /json/ — one canonical URL per tool, so a
       crawler never files the same page several times */
    if (bare && TOOLS.includes(name) && path !== '/' + name + '/') {
      return Response.redirect(url.origin + '/' + name + '/' + url.search, 301);
    }

    /* an alias keeps whatever follows it: /yml/js-yaml.min.js is the YAML
       tool's file, which a page on yml.lint.uz once asked for */
    const [first, ...rest] = path.replace(/^\/+/, '').split('/');
    const tool = Object.hasOwn(ALIASES, first.toLowerCase()) ? ALIASES[first.toLowerCase()] : null;
    if (tool) {
      return Response.redirect(url.origin + '/' + tool + '/' + rest.join('/') + url.search, 301);
    }

    const res = await env.ASSETS.fetch(request);
    if (res.status !== 404) return res;

    /* A miss that looks like a format is someone asking for a tool we have
       not built. Say so, and let them add their name to the count. */
    if (FORMAT_RE.test(name) && !NOT_FORMATS.has(name)) {
      return notYet(name, env);
    }
    return missing();
  }
};

/* ---------- counting interest ----------
   The voter key is a one-way hash of address, format and a server secret.
   It dedups without the table ever holding anything that identifies anyone:
   there is no way back from the hash to an IP. */
async function voterKey(request, format, env) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const salt = env.VOTE_SALT || 'lint.one';
  const data = new TextEncoder().encode(salt + '|' + format + '|' + ip);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function countFor(env, format) {
  try {
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM interest WHERE format = ?').bind(format).first();
    return row ? row.n : 0;
  } catch (e) {
    return 0;
  }
}

async function interest(request, env) {
  const url = new URL(request.url);
  const format = (url.searchParams.get('format') || '').toLowerCase();

  if (!FORMAT_RE.test(format) || NOT_FORMATS.has(format)) {
    return json({ error: 'unknown format' }, 400);
  }

  if (request.method === 'GET') {
    return json({ format, count: await countFor(env, format) });
  }

  if (request.method !== 'POST') return json({ error: 'method' }, 405);

  try {
    const voter = await voterKey(request, format, env);
    /* the primary key does the deduping, so a second click is a no-op */
    await env.DB.prepare(
      'INSERT OR IGNORE INTO interest (format, voter, at) VALUES (?, ?, ?)')
      .bind(format, voter, Date.now()).run();
    return json({ format, count: await countFor(env, format), counted: true });
  } catch (e) {
    return json({ error: 'could not record that' }, 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8',
               'cache-control': 'no-store' }
  });
}

/* ---------- pages ---------- */
function shell(title, body, status) {
  return new Response(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · lint.one</title>
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<!-- the pages carry their own light and dark themes; Dark Reader would
     repaint them on top and lose the format colours and glyphs -->
<meta name="darkreader-lock">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/shared/theme.css">
<style>
  body {
    margin: 0; min-height: 100vh;
    display: grid; place-items: center;
    font-family: var(--ui); background: var(--surface); color: var(--ink);
    -webkit-font-smoothing: antialiased;
  }
  main { max-width: 42ch; padding: var(--s5) var(--s4); text-align: center; }
  .mark {
    display: inline-grid; place-items: center;
    width: 44px; height: 44px; border-radius: 12px;
    background: var(--ink); color: var(--surface);
    font-family: var(--mono); font-weight: 700; font-size: 17px;
    margin-bottom: var(--s4);
  }
  h1 {
    margin: 0 0 var(--s3);
    font-size: 25px; font-weight: 660; letter-spacing: -0.025em;
    line-height: 1.15;
  }
  h1 code {
    font-family: var(--mono); font-size: 0.86em;
    background: var(--sunken); border: var(--hairline) solid var(--line);
    border-radius: 6px; padding: 1px 7px;
  }
  p { margin: 0 0 var(--s4); color: var(--muted); line-height: 1.6; font-size: 14.5px; }
  .row { display: flex; gap: var(--s2); justify-content: center; flex-wrap: wrap; }
  a.btn, button.btn {
    font: inherit; font-size: 13.5px; font-weight: 550;
    padding: 9px 16px; border-radius: 8px; cursor: pointer;
    text-decoration: none; border: var(--hairline) solid var(--line);
    background: var(--raised); color: var(--ink);
  }
  a.btn:hover, button.btn:hover { background: var(--row-hover); }
  button.btn.primary { background: var(--ink); color: var(--surface); border-color: var(--ink); }
  button.btn.primary:hover { opacity: 0.88; }
  button.btn[disabled] { cursor: default; opacity: 1; }
  .count { font-variant-numeric: tabular-nums; }
  .said { color: var(--muted); font-size: 13px; margin-top: var(--s3); }
  :focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
</style>
</head>
<body><main>${body}</main></body>
</html>`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
}

async function notYet(format, env) {
  const count = await countFor(env, format);
  const esc = (s) => s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const f = esc(format);

  return shell(`No ${f} viewer yet`, `
    <span class="mark">${f.slice(0, 2).toUpperCase()}</span>
    <h1>There's no <code>${f}</code> viewer yet.</h1>
    <p>Six formats are live today. If you want this one, say so — the count
       decides what gets built next.</p>
    <div class="row">
      <button class="btn primary" id="want" data-format="${f}">
        I want ${f} <span class="count" id="n">${count ? '· ' + count : ''}</span>
      </button>
      <a class="btn" href="/">See the six</a>
    </div>
    <p class="said" id="said" hidden>Counted. ${count ? '' : ''}</p>
    <script>
      const btn = document.getElementById('want');
      const n = document.getElementById('n');
      const said = document.getElementById('said');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const r = await fetch('/api/interest?format=' + encodeURIComponent(btn.dataset.format),
                                { method: 'POST' });
          const d = await r.json();
          if (typeof d.count === 'number') {
            n.textContent = '· ' + d.count;
            btn.textContent = 'Counted ';
            btn.appendChild(n);
            said.textContent = d.count === 1
              ? 'You are the first to ask for this one.'
              : d.count + ' people have asked for ' + btn.dataset.format + '.';
            said.hidden = false;
          }
        } catch (e) {
          btn.disabled = false;
        }
      });
    </script>`, 404);
}

function missing() {
  return shell('Not found', `
    <span class="mark">404</span>
    <h1>That page isn't here.</h1>
    <p>The address may be mistyped, or the page may have moved.</p>
    <div class="row"><a class="btn" href="/">Go to lint.one</a></div>`, 404);
}
