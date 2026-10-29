// MIT License © 2026 Carlos Lopez
// Builds the viewer app (also the presenter console) into a directory.
//
//   node scripts/build-viewer.mjs [outDir]      default: viewer/dist (the GitHub Pages bundle)
//
// The extension build calls buildViewer() to put the same app in the extension
// as viewer.html.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'viewer', 'src');

/**
 * @param {string} out directory to write into
 * @param {{htmlName?: string, debug?: boolean, present?: boolean}} [options] `htmlName` is the
 *        page's file name (`index.html` for Pages, `viewer.html` in the extension); `debug`
 *        keeps source maps; `present` adds the presenter page (`present.html`, for Pages; the
 *        extension has its own capture) and links to it from the landing page
 */
export async function buildViewer(
  out,
  { htmlName = 'index.html', debug = false, present = false } = {},
) {
  mkdirSync(out, { recursive: true });
  await build({
    entryPoints: [
      { in: join(src, 'main.ts'), out: 'viewer' },
      ...(present ? [{ in: join(src, 'present.ts'), out: 'present' }] : []),
    ],
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
  const viewerHtml = readFileSync(join(src, 'index.html'), 'utf8');
  const link = present
    ? '<p><a href="present.html">Want to present your own screen? Start a session</a></p>'
    : '';
  writeFileSync(join(out, htmlName), viewerHtml.replace('<!--{{present-link}}-->', link));
  if (present) {
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
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? join(root, 'viewer', 'dist'));
  await buildViewer(out, { present: true });
  console.log(`viewer built in ${out}`);
}
