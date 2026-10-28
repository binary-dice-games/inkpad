// MIT License © 2026 Carlos Lopez
// Checks a built extension against what we promise the Chrome Web Store and users.
//
//   node scripts/audit-extension.mjs [dir]       default: extension/dist
//
// It fails when the manifest asks for more than the documented permissions (see
// docs/publishing.md and spec/02_presenter_extension/DESIGN.md section 4), when
// the version is not the package version, when a file the manifest names is
// missing, or when the code could load remote code or ships source maps.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The only permissions the extension may ask for, and why (kept in sync with docs/publishing.md). */
export const ALLOWED_PERMISSIONS = {
  activeTab: 'capture the tab the user chooses',
  tabCapture: 'record that tab',
  offscreen: 'a hidden page that holds the connections and the capture',
  storage: 'the settings',
};

/** Manifest keys that widen what the extension can do and so must not appear. */
const FORBIDDEN_KEYS = [
  'host_permissions',
  'optional_host_permissions',
  'optional_permissions',
  'content_scripts',
  'externally_connectable',
  'web_accessible_resources',
  'key',
  'update_url',
  'oauth2',
];

const FORBIDDEN_CODE = [
  [/\beval\s*\(/, 'eval('],
  [/\bnew Function\s*\(/, 'new Function('],
  [/\bimportScripts\s*\(/, 'importScripts('],
  [/<script[^>]+src=["']https?:/i, 'a remote <script src>'],
  [/\/\/# sourceMappingURL=/, 'a source map reference'],
];

function listFiles(dir, prefix = '') {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    return statSync(full).isDirectory() ? listFiles(full, rel) : [rel];
  });
}

/** Every file name the manifest points to. */
function manifestFiles(manifest) {
  const files = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_ui?.page,
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
  ];
  return files.filter(Boolean);
}

/**
 * @param {string} dir the built extension
 * @param {{version?: string}} [options] the version it must have (default: package.json's)
 * @returns {string[]} the problems found; empty when the extension passes
 */
export function auditExtension(dir, { version } = {}) {
  const problems = [];
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    return [`no manifest.json in ${dir}`];
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const expectedVersion =
    version ?? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

  if (manifest.manifest_version !== 3) {
    problems.push(`manifest_version is ${manifest.manifest_version}, expected 3`);
  }
  if (manifest.version !== expectedVersion) {
    problems.push(`version is ${manifest.version}, expected ${expectedVersion}`);
  }
  const wanted = Object.keys(ALLOWED_PERMISSIONS).sort();
  const have = [...(manifest.permissions ?? [])].sort();
  for (const p of have.filter((p) => !wanted.includes(p))) {
    problems.push(`permission not allowed: ${p}`);
  }
  for (const p of wanted.filter((p) => !have.includes(p))) {
    problems.push(`permission missing: ${p}`);
  }
  for (const key of FORBIDDEN_KEYS.filter((k) => k in manifest)) {
    problems.push(`manifest key not allowed: ${key}`);
  }
  const csp = JSON.stringify(manifest.content_security_policy ?? '');
  if (/unsafe-eval|https?:\/\//.test(csp)) {
    problems.push('content_security_policy loosens the default or names a remote origin');
  }
  for (const file of manifestFiles(manifest)) {
    if (!existsSync(join(dir, file))) {
      problems.push(`the manifest names ${file}, which is missing`);
    }
  }

  const files = listFiles(dir);
  for (const file of files) {
    if (file.endsWith('.map')) {
      problems.push(`source map shipped: ${file}`);
    }
    if (/\.(js|mjs|html)$/.test(file)) {
      const text = readFileSync(join(dir, file), 'utf8');
      for (const [pattern, label] of FORBIDDEN_CODE) {
        if (pattern.test(text)) {
          problems.push(`${file} contains ${label}`);
        }
      }
    }
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] ?? join(root, 'extension', 'dist'));
  const problems = auditExtension(dir);
  if (problems.length) {
    console.error(`extension audit failed:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`extension audit passed: ${dir}`);
}
