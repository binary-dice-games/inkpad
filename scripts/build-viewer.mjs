// MIT License © 2026 Carlos Lopez
// Builds the viewer app and the presenter page into a directory.
//
//   node scripts/build-viewer.mjs [outDir]      default: viewer/dist (the GitHub Pages bundle)
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'viewer', 'src');

/**
 * Builds the viewer page and the presenter page (`index.html`, `viewer.js`,
 * `present.html`, `present.js`).
 * @param {string} out directory to write into
 */
export async function buildViewer(out) {
  mkdirSync(out, { recursive: true });
  await build({
    entryPoints: [
      { in: join(src, 'main.ts'), out: 'viewer' },
      { in: join(src, 'present.ts'), out: 'present' },
    ],
    outdir: out,
    bundle: true,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    sourcemap: false,
    minify: true,
    legalComments: 'none',
    logLevel: 'warning',
  });
  const viewerHtml = readFileSync(join(src, 'index.html'), 'utf8');
  const link = '<p><a href="present.html">Want to present your own screen? Start a session</a></p>';
  writeFileSync(join(out, 'index.html'), viewerHtml.replace('<!--{{present-link}}-->', link));
  // The presenter page shares the viewer's stylesheet (the first <style> of index.html).
  const style = /<style>[\s\S]*?<\/style>/.exec(viewerHtml)?.[0];
  if (!style) {
    throw new Error('viewer/src/index.html has no <style> block');
  }
  const page = readFileSync(join(src, 'present.html'), 'utf8');
  writeFileSync(
    join(out, 'present.html'),
    page.replace('<!--{{style}}-->', () => style),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? join(root, 'viewer', 'dist'));
  await buildViewer(out);
  console.log(`viewer built in ${out}`);
}
