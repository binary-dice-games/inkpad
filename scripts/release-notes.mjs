// MIT License © 2026 Carlos Lopez
// Prints the CHANGELOG.md section of a version, for the text of a GitHub release.
//
//   node scripts/release-notes.mjs <version>        for example 0.2.0
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {string} changelog the text of CHANGELOG.md
 * @param {string} version a version such as `0.2.0` (or `Unreleased`)
 * @returns {string} the section's body, trimmed
 * @throws {Error} when the section is missing or empty
 */
export function notesFor(changelog, version) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const heading = new RegExp(`^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`);
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) {
    throw new Error(`CHANGELOG.md has no section for ${version}`);
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## \[/.test(l));
  const body = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
  if (!body) {
    throw new Error(`the CHANGELOG.md section for ${version} is empty`);
  }
  return body;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = process.argv[2];
  if (!version) {
    console.error('usage: node scripts/release-notes.mjs <version>');
    process.exit(2);
  }
  try {
    console.log(notesFor(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), version));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
