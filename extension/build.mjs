#!/usr/bin/env node
/* Assembles the browser extension in extension/dist/ and zips it for the
   Chrome Web Store.

     node extension/build.mjs          talks to https://lint.one
     node extension/build.mjs --dev    talks to http://localhost:8787 (npm run dev)

   Like the site's build, nothing is bundled or transpiled: src/ lands as-is,
   with the parts of shared/ the popup and panel wear (tokens, components,
   fonts, glyphs), so they look like every other lint.one page. The only
   files written rather than copied are base.js (where lint.one lives) and
   the manifest (that address, for the content script). */

import { cp, rm, mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, crc32 } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const SRC = join(here, 'src');
const DIST = join(here, 'dist');
const dev = process.argv.includes('--dev');
const BASE = dev ? 'http://localhost:8787' : 'https://lint.one';

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await cp(SRC, DIST, { recursive: true });

/* only what the popup and panel use; theme.css finds fonts/ beside it,
   app.css imports menu.css, and the tiles ask for /shared/glyphs/ */
const SHARED = ['theme.css', 'app.css', 'menu.css', 'glyph.svg', 'glyphs', 'fonts'];
for (const f of SHARED) {
  await cp(join(root, 'shared', f), join(DIST, 'shared', f), { recursive: true });
}

await writeFile(join(DIST, 'base.js'),
  `/* written by extension/build.mjs */\nself.LINT_BASE = ${JSON.stringify(BASE)};\n`);

const manifest = JSON.parse(await readFile(join(SRC, 'manifest.json'), 'utf8'));
manifest.content_scripts[0].matches = [BASE + '/*'];
if (dev) manifest.name += ' (dev)';
await writeFile(join(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const files = (await readdir(DIST, { recursive: true, withFileTypes: true }))
  .filter((d) => d.isFile())
  .map((d) => relative(DIST, join(d.parentPath, d.name)).split(sep).join('/'))
  .sort();
console.log(`✓ extension/dist  (${files.length} files, ${BASE})`);

/* A zip, written here rather than with a dependency: the store takes a
   plain archive of the folder, and Node has deflate and CRC-32 built in. */
const zipName = `lint.one-extension-${manifest.version}${dev ? '-dev' : ''}.zip`;
const chunks = [], central = [];
let offset = 0;
for (const name of files) {
  const data = await readFile(join(DIST, name));
  const packed = deflateRawSync(data, { level: 9 });
  const store = packed.length >= data.length;
  const body = store ? data : packed;
  const crc = crc32(data);
  const nameBuf = Buffer.from(name, 'utf8');
  const { mtime } = await stat(join(DIST, name));
  const time = (mtime.getHours() << 11) | (mtime.getMinutes() << 5) | (mtime.getSeconds() >> 1);
  const date = ((mtime.getFullYear() - 1980) << 9) | ((mtime.getMonth() + 1) << 5) | mtime.getDate();

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);            /* names are UTF-8 */
  local.writeUInt16LE(store ? 0 : 8, 8);
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  chunks.push(local, nameBuf, body);

  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4);
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0x0800, 8);
  entry.writeUInt16LE(store ? 0 : 8, 10);
  entry.writeUInt16LE(time, 12);
  entry.writeUInt16LE(date, 14);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(body.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(nameBuf.length, 28);
  entry.writeUInt32LE(offset, 42);
  central.push(entry, nameBuf);

  offset += local.length + nameBuf.length + body.length;
}
const dir = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(dir.length, 12);
end.writeUInt32LE(offset, 16);
await writeFile(join(here, zipName), Buffer.concat([...chunks, dir, end]));
console.log(`✓ extension/${zipName}`);
