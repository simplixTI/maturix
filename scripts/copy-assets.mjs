// Copies non-TS runtime assets that `tsc` doesn't emit into dist/, so the
// production build (node dist/index.js) finds them. Currently the conversation
// template JSONs, read at runtime from dist/core/messaging/templates.
// Cross-platform (pure Node fs). Run as part of `npm run build`.
import { mkdir, readdir, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const assetDirs = [
  ['src/core/messaging/templates', 'dist/core/messaging/templates'],
];

let total = 0;
for (const [from, to] of assetDirs) {
  const srcDir = join(root, from);
  const dstDir = join(root, to);
  try {
    const files = (await readdir(srcDir)).filter((f) => f.endsWith('.json'));
    await mkdir(dstDir, { recursive: true });
    for (const f of files) {
      await copyFile(join(srcDir, f), join(dstDir, f));
      total++;
    }
  } catch (err) {
    console.warn(`copy-assets: skipped ${from} (${err.message})`);
  }
}
console.log(`copy-assets: copied ${total} asset file(s) into dist/`);
