#!/usr/bin/env node
/* Assembles every tool into one directory so a single worker can serve them
   all from one domain: lint.one/json, lint.one/log and so on.

   They live under one origin because search engines pool a domain's authority
   across its paths but largely split it across subdomains — with six tools
   that meant six reputations starting from zero.

   Nothing is bundled or transpiled. Files land as-is and stay readable in
   view-source, and shared/ is written once rather than copied per tool. */

import { cp, rm, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const SHARED = join(root, 'shared');
const DIST = join(root, 'site', 'dist');
const TOOLS = ['json', 'xml', 'yaml', 'csv', 'pdf', 'log'];

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
