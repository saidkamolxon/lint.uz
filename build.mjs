#!/usr/bin/env node
/* Copies shared/ into each tool's public/ so Wrangler can serve it as a
   static asset. Run before dev and deploy — see package.json scripts.
   Nothing is bundled or transpiled; the files land as-is and stay
   readable in view-source. */

import { cp, rm, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const SHARED = join(root, 'shared');
const TOOLS = ['json', 'xml', 'yaml', 'csv'];

const only = process.argv[2];
const targets = only ? [only] : TOOLS;

for (const tool of targets) {
  const publicDir = join(root, tool, 'public');
  if (!existsSync(publicDir)) {
    console.warn(`skip ${tool} — no public/ directory`);
    continue;
  }
  const dest = join(publicDir, 'shared');
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  await cp(SHARED, dest, { recursive: true });
  const files = await readdir(dest);
  console.log(`✓ ${tool}/public/shared  (${files.length} entries)`);
}

/* the landing page serves the same shared assets */
const site = join(root, 'site', 'public');
if (existsSync(site) && (!only || only === 'site')) {
  const dest = join(site, 'shared');
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  await cp(SHARED, dest, { recursive: true });
  console.log('✓ site/public/shared');
}
