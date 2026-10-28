// MIT License © 2026 Carlos Lopez
// Builds, audits and zips the extension for the Chrome Web Store.
//
//   node scripts/package-extension.mjs [outDir]       default: release/
//
// Writes inkpad-extension-<version>.zip and its .sha256. The zip is reproducible:
// the same sources give the same bytes (sorted names, fixed timestamps).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { auditExtension } from './audit-extension.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function listFiles(dir, prefix = '') {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      return statSync(full).isDirectory() ? listFiles(full, rel) : [rel];
    });
}

/**
 * Zips a built extension directory, deterministically.
 * @param {string} dir the built extension
 * @returns {Uint8Array} the zip
 */
export function zipExtension(dir) {
  const entries = {};
  for (const file of listFiles(dir)) {
    // 1980-01-01 is the earliest time a zip can hold: it keeps the bytes the same each time.
    entries[file] = [
      readFileSync(join(dir, file)),
      { mtime: new Date(Date.UTC(1980, 0, 1)), level: 9 },
    ];
  }
  return zipSync(entries);
}

/**
 * @param {string} outDir where to write the zip and its checksum
 * @returns {{zip: string, sha256: string, hash: string}}
 * @throws {Error} when the audit fails
 */
export function packageExtension(outDir = join(root, 'release')) {
  execFileSync(process.execPath, [join(root, 'scripts', 'build-extension.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
  const dist = join(root, 'extension', 'dist');
  const problems = auditExtension(dist);
  if (problems.length) {
    throw new Error(`extension audit failed:\n- ${problems.join('\n- ')}`);
  }
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  mkdirSync(outDir, { recursive: true });
  const zip = join(outDir, `inkpad-extension-${version}.zip`);
  const bytes = zipExtension(dist);
  writeFileSync(zip, bytes);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const sha256 = `${zip}.sha256`;
  writeFileSync(sha256, `${hash}  inkpad-extension-${version}.zip\n`);
  return { zip, sha256, hash };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { zip, hash } = packageExtension(process.argv[2] ? resolve(process.argv[2]) : undefined);
  console.log(`packaged ${zip}\nsha256 ${hash}`);
}
