// MIT License © 2026 Carlos Lopez
// Builds the extension into extension/dist (or extension/dist-e2e with --e2e).
//
//   node scripts/build-extension.mjs [--e2e]
//
// --e2e adds host access to loopback pages, so tests can inject the overlay
// without the activeTab gesture that a browser automation cannot give.
import { build } from 'esbuild';
import { deflateSync } from 'node:zlib';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const e2e = process.argv.includes('--e2e');
const out = join(root, 'extension', e2e ? 'dist-e2e' : 'dist');
const src = join(root, 'extension', 'src');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'icons'), { recursive: true });

await build({
  entryPoints: ['background', 'offscreen', 'overlay', 'popup', 'options'].map((n) =>
    join(src, `${n}.ts`),
  ),
  outdir: out,
  bundle: true,
  format: 'iife',
  target: 'chrome116',
  platform: 'browser',
  sourcemap: e2e ? 'inline' : false,
  minify: !e2e,
  legalComments: 'none',
  define: { __INKPAD_E2E__: String(e2e) },
  logLevel: 'warning',
});

for (const page of ['popup.html', 'options.html', 'offscreen.html']) {
  copyFileSync(join(src, page), join(out, page));
}

const manifest = JSON.parse(readFileSync(join(root, 'extension', 'manifest.json'), 'utf8'));
manifest.version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
if (e2e) {
  manifest.host_permissions = ['http://127.0.0.1/*', 'http://localhost/*'];
}
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// ── Icons: a teal disc with a white pen stroke, drawn pixel by pixel ─────────
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const inside = Math.hypot(dx, dy) <= c - 0.5;
      // a diagonal stroke from lower left to upper right
      const along = (dx - dy) / Math.SQRT2;
      const across = (dx + dy) / Math.SQRT2;
      const stroke =
        Math.abs(along) <= size * 0.3 && Math.abs(across + size * 0.02) <= size * 0.075;
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const [r, g, b] = stroke ? [255, 255, 255] : [15, 159, 134];
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = inside ? 255 : 0;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(out, 'icons', `${size}.png`), png(size));
}

console.log(`extension built in ${out}`);
