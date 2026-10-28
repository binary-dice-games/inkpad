// MIT License © 2026 Carlos Lopez
// Builds the viewer app (also the presenter console) into a directory.
//
//   node scripts/build-viewer.mjs [outDir]      default: viewer/dist (the GitHub Pages bundle)
//
// The extension build calls buildViewer() to put the same app in the extension
// as viewer.html.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'viewer', 'src');

/**
 * @param {string} out directory to write into
 * @param {{htmlName?: string, debug?: boolean}} [options] `htmlName` is the page's file name
 *        (`index.html` for Pages, `viewer.html` in the extension); `debug` keeps source maps
 */
export async function buildViewer(out, { htmlName = 'index.html', debug = false } = {}) {
  mkdirSync(out, { recursive: true });
  await build({
    entryPoints: [{ in: join(src, 'main.ts'), out: 'viewer' }],
    outdir: out,
    bundle: true,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    sourcemap: debug ? 'inline' : false,
    minify: !debug,
    legalComments: 'none',
    logLevel: 'warning',
  });
  copyFileSync(join(src, 'index.html'), join(out, htmlName));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? join(root, 'viewer', 'dist'));
  await buildViewer(out);
  console.log(`viewer built in ${out}`);
}
