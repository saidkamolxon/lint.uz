#!/usr/bin/env node
/* Assembles every tool into one directory so a single worker can serve them
   all from one domain: lint.one/json, lint.one/log and so on.

   They live under one origin because search engines pool a domain's authority
   across its paths but largely split it across subdomains — with six tools
   that meant six reputations starting from zero.

   Nothing is bundled or transpiled. Files land as-is and stay readable in
   view-source, and shared/ is written once rather than copied per tool. */

import { cp, rm, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const SHARED = join(root, 'shared');
const DIST = join(root, 'site', 'dist');
const TOOLS = ['json', 'xml', 'yaml', 'csv', 'pdf', 'log', 'audio', 'sqlite', 'parquet', 'env', 'har'];

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

/* the landing page sits at the root */
await cp(join(root, 'site', 'public'), DIST, { recursive: true });

/* each tool gets a folder named after its path */
for (const tool of TOOLS) {
  const src = join(root, tool, 'public');
  if (!existsSync(src)) {
    console.warn(`skip ${tool} — no public/ directory`);
    continue;
  }
  const dest = join(DIST, tool);
  await cp(src, dest, { recursive: true });
  /* a per-tool copy of shared/ would be dead weight; one copy serves all */
  await rm(join(dest, 'shared'), { recursive: true, force: true });
  const files = await readdir(dest);
  console.log(`✓ /${tool}  (${files.length} entries)`);
}

/* one shared directory for the whole site */
await cp(SHARED, join(DIST, 'shared'), { recursive: true });
console.log('✓ /shared');

/* the offline copy: every file in dist, as the URL a browser asks for it by,
   versioned by content so any change to any file ships a fresh copy */
const files = (await readdir(DIST, { recursive: true, withFileTypes: true }))
  .filter((d) => d.isFile())
  .map((d) => relative(DIST, join(d.parentPath, d.name)).split(sep).join('/'))
  /* link-preview cards and crawler files are for other machines, not for
     reading offline; caching them would only cost every visitor a download.
     The manifest and app icons stay out too: the browser reads them when the
     app is installed, and a cached copy would install the previous version's
     name and icons. Left out of the copy, they always come from the network. */
  .filter((f) => !/^(og|icons)\/|^(robots\.txt|sitemap\.xml|manifest\.webmanifest|apple-touch-icon\.png)$/.test(f))
  .sort();
/* DuckDB (parquet/vendor/duckdb-*) is 9 MB that only someone sorting or
   querying a Parquet file needs. It stays out of the copy every visitor
   downloads; the service worker keeps it the first time it is fetched. Its
   folder is named for its version, so a new one never mixes with the old. */
const LAZY = /^parquet\/vendor\/duckdb-/;
const eager = files.filter((f) => !LAZY.test(f));
const lazy = files.filter((f) => LAZY.test(f));
const hash = createHash('sha256');
for (const f of eager) hash.update(f).update(await readFile(join(DIST, f)));
const toUrl = (f) => '/' + f.replace(/(^|\/)index\.html$/, '$1');
const urls = eager.map(toUrl);
const sw = (await readFile(join(root, 'site', 'sw.js'), 'utf8'))
  .replace('__VERSION__', hash.digest('hex').slice(0, 12))
  .replace('__FILES__', JSON.stringify(urls, null, 2))
  .replace('__LAZY__', JSON.stringify(lazy.map(toUrl), null, 2));
await writeFile(join(DIST, 'sw.js'), sw);
console.log(`✓ /sw.js  (${urls.length} files offline, ${lazy.length} kept on first use)`);
