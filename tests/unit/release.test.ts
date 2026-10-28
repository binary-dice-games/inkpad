// MIT License © 2026 Carlos Lopez
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { ALLOWED_PERMISSIONS, auditExtension } from '../../scripts/audit-extension.mjs';
import { buildSite, normalizeBase, protocolMajor } from '../../scripts/build-site.mjs';
import { zipExtension } from '../../scripts/package-extension.mjs';
import { notesFor } from '../../scripts/release-notes.mjs';
import { smokeSite } from '../../scripts/smoke-site.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const VERSION = (
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }
).version;

let work: string;
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'inkpad-release-'));
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** A small extension directory that passes the audit; each test breaks one thing. */
function makeExtension(
  name: string,
  change: (manifest: Record<string, unknown>) => void = () => {},
) {
  const dir = join(work, name);
  mkdirSync(join(dir, 'icons'), { recursive: true });
  const manifest: Record<string, unknown> = {
    manifest_version: 3,
    name: 'inkpad',
    version: VERSION,
    permissions: Object.keys(ALLOWED_PERMISSIONS),
    background: { service_worker: 'background.js' },
    action: { default_popup: 'popup.html', default_icon: { '16': 'icons/16.png' } },
    options_ui: { page: 'options.html' },
    icons: { '16': 'icons/16.png' },
  };
  change(manifest);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  for (const f of ['background.js', 'popup.html', 'options.html', 'icons/16.png']) {
    writeFileSync(join(dir, f), 'ok');
  }
  return dir;
}

describe('extension audit', () => {
  it('passes a manifest with exactly the documented permissions', () => {
    expect(auditExtension(makeExtension('good'))).toEqual([]);
  });

  it('refuses an added permission, a missing one, and host access', () => {
    const extra = makeExtension('extra', (m) => (m.permissions as string[]).push('tabs'));
    expect(auditExtension(extra)).toContain('permission not allowed: tabs');
    const missing = makeExtension('missing', (m) => (m.permissions = ['storage']));
    expect(auditExtension(missing)).toContain('permission missing: tabCapture');
    const hosts = makeExtension('hosts', (m) => (m.host_permissions = ['<all_urls>']));
    expect(auditExtension(hosts)).toContain('manifest key not allowed: host_permissions');
    const scripts = makeExtension('scripts', (m) => (m.content_scripts = []));
    expect(auditExtension(scripts)).toContain('manifest key not allowed: content_scripts');
    const key = makeExtension('key', (m) => (m.key = 'abc'));
    expect(auditExtension(key)).toContain('manifest key not allowed: key');
  });

  it('refuses the wrong version, a missing file and a loosened CSP', () => {
    const old = makeExtension('old', (m) => (m.version = '0.0.1'));
    expect(auditExtension(old).join()).toMatch(/version is 0\.0\.1/);
    const dir = makeExtension('gone');
    rmSync(join(dir, 'popup.html'));
    expect(auditExtension(dir)).toContain('the manifest names popup.html, which is missing');
    const csp = makeExtension('csp', (m) => {
      m.content_security_policy = { extension_pages: "script-src 'self' 'unsafe-eval'" };
    });
    expect(auditExtension(csp).join()).toMatch(/content_security_policy/);
  });

  it('refuses code that could load remote code, and shipped source maps', () => {
    const dir = makeExtension('code');
    writeFileSync(join(dir, 'background.js'), 'const a = 1; eval("x");');
    writeFileSync(join(dir, 'popup.html'), '<script src="https://cdn.example/x.js"></script>');
    writeFileSync(join(dir, 'options.html'), 'ok');
    writeFileSync(
      join(dir, 'x.js'),
      'importScripts("a"); new Function("b");\n//# sourceMappingURL=x.js.map',
    );
    writeFileSync(join(dir, 'x.js.map'), '{}');
    const found = auditExtension(dir).join('\n');
    expect(found).toMatch(/background\.js contains eval\(/);
    expect(found).toMatch(/popup\.html contains a remote <script src>/);
    expect(found).toMatch(/x\.js contains importScripts\(/);
    expect(found).toMatch(/x\.js contains new Function\(/);
    expect(found).toMatch(/source map shipped: x\.js\.map/);
  });

  it('reports a directory without a manifest', () => {
    expect(auditExtension(join(work, 'nothing'))[0]).toMatch(/no manifest\.json/);
  });
});

describe('the real extension build', () => {
  const dist = join(ROOT, 'extension', 'dist');

  beforeAll(() => {
    execFileSync(process.execPath, ['scripts/build-extension.mjs'], { cwd: ROOT, stdio: 'ignore' });
  });

  it('passes the audit', () => {
    expect(auditExtension(dist)).toEqual([]);
  });

  it('zips to the same bytes every time, with the files a store needs', () => {
    const a = zipExtension(dist);
    const b = zipExtension(dist);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const files = Object.keys(unzipSync(a));
    for (const f of [
      'manifest.json',
      'background.js',
      'offscreen.js',
      'popup.html',
      'viewer.html',
      'viewer.js',
    ]) {
      expect(files).toContain(f);
    }
    expect(files.some((f) => f.endsWith('.map'))).toBe(false);
    const manifest = JSON.parse(Buffer.from(unzipSync(a)['manifest.json']!).toString('utf8')) as {
      version: string;
    };
    expect(manifest.version).toBe(VERSION);
  });
});

describe('the viewer address baked into the extension', () => {
  const build = (env: Record<string, string>) =>
    execFileSync(process.execPath, ['scripts/build-extension.mjs'], {
      cwd: ROOT,
      stdio: 'pipe',
      env: { ...process.env, ...env },
    });
  const bundleText = () =>
    ['background.js', 'options.js', 'popup.js', 'offscreen.js']
      .map((f) => readFileSync(join(ROOT, 'extension', 'dist', f), 'utf8'))
      .join('\n');

  afterAll(() => {
    build({}); // leave the default build in place
  });

  it('is the default unless the build is told otherwise', () => {
    build({ INKPAD_VIEWER_BASE: '' });
    expect(bundleText()).toContain('https://binary-dice-games.github.io/inkpad/');
  });

  it('can be set for a fork', () => {
    build({ INKPAD_VIEWER_BASE: 'https://someone.github.io/their-fork/' });
    const text = bundleText();
    expect(text).toContain('https://someone.github.io/their-fork/');
    expect(text).not.toContain('https://binary-dice-games.github.io/inkpad/');
  });

  it('refuses an address that is not https or lacks the trailing slash', () => {
    expect(() => build({ INKPAD_VIEWER_BASE: 'http://x.example/' })).toThrow();
    expect(() => build({ INKPAD_VIEWER_BASE: 'https://x.example/no-slash' })).toThrow();
  });
});

describe('release notes', () => {
  const changelog = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '### Added',
    '- next thing',
    '',
    '## [0.2.0] - 2026-11-01',
    '',
    '### Fixed',
    '- a fix',
    '',
    '## [0.1.0]',
    '',
    '- first',
  ].join('\r\n');

  it('finds the section of a version, with or without a date', () => {
    expect(notesFor(changelog, '0.2.0')).toBe('### Fixed\n- a fix');
    expect(notesFor(changelog, '0.1.0')).toBe('- first');
    expect(notesFor(changelog, 'Unreleased')).toContain('next thing');
  });

  it('fails for a missing or empty section', () => {
    expect(() => notesFor(changelog, '9.9.9')).toThrow(/no section for 9\.9\.9/);
    expect(() => notesFor('## [1.0.0]\n\n## [0.9.0]\n- x', '1.0.0')).toThrow(/empty/);
  });

  it('does not mistake 0.1 for 0.1.0', () => {
    expect(() => notesFor(changelog, '0.1')).toThrow(/no section/);
  });
});

describe('the Pages site', () => {
  let out: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    out = join(work, 'site');
    // An older viewer kept in the repo for an older protocol major.
    const archive = join(work, 'archive');
    mkdirSync(join(archive, 'v0'), { recursive: true });
    writeFileSync(join(archive, 'v0', 'index.html'), 'old viewer');
    await buildSite(out, { base: '/inkpad/', archive });
    // Serves the site like GitHub Pages: unknown paths get 404.html with status 404.
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      const path = url.pathname.replace(/^\/inkpad\//, '');
      const file = join(out, path === '' || path.endsWith('/') ? `${path}index.html` : path);
      try {
        const body = readFileSync(file);
        res.writeHead(200).end(body);
      } catch {
        res.writeHead(404).end(readFileSync(join(out, '404.html')));
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/inkpad/`;
  });
  afterAll(() => server?.close());

  it('has the viewer at the root and under its protocol major, and keeps older majors', () => {
    expect(protocolMajor()).toBe(1);
    const index = readFileSync(join(out, 'index.html'), 'utf8');
    expect(readFileSync(join(out, 'v1', 'index.html'), 'utf8')).toBe(index);
    expect(readFileSync(join(out, 'v0', 'index.html'), 'utf8')).toBe('old viewer');
    expect(readFileSync(join(out, '.nojekyll'), 'utf8')).toBe('');
  });

  it('points the 404 page at the site base', () => {
    const page = readFileSync(join(out, '404.html'), 'utf8');
    expect(page).toContain('src="/inkpad/redirect.js"');
    expect(page).toContain('data-base="/inkpad/"');
    expect(page).not.toContain('{{base}}');
  });

  it('passes the smoke check when served', async () => {
    expect(await smokeSite(base)).toEqual([]);
  });

  it('fails the smoke check when something is missing', async () => {
    rmSync(join(out, 'privacy.html'));
    try {
      const problems = await smokeSite(base);
      expect(problems.join('\n')).toMatch(/privacy policy: status 404/);
    } finally {
      writeFileSync(join(out, 'privacy.html'), 'privacy policy');
    }
  });

  it('reports a site that cannot be reached', async () => {
    const problems = await smokeSite('http://127.0.0.1:1/');
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]).toMatch(/cannot fetch/);
  });

  it('accepts only sane base paths', () => {
    expect(normalizeBase('/inkpad')).toBe('/inkpad/');
    expect(normalizeBase('/')).toBe('/');
    expect(() => normalizeBase('inkpad')).toThrow();
    expect(() => normalizeBase('/a b/')).toThrow();
    expect(() => normalizeBase('//evil.example/')).toThrow();
  });
});
