// MIT License © 2026 Carlos Lopez
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite, normalizeBase, protocolMajor } from '../../scripts/build-site.mjs';
import { smokeSite } from '../../scripts/smoke-site.mjs';

let work: string;
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'inkpad-release-'));
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

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

  it('ships the presenter page, also under the protocol major, with small bundles', () => {
    for (const dir of ['', `v${protocolMajor()}/`]) {
      expect(readFileSync(join(out, dir, 'present.html'), 'utf8')).toContain('present.js');
      for (const bundle of ['viewer.js', 'present.js']) {
        const code = readFileSync(join(out, dir, bundle));
        expect(gzipSync(code).length, `${dir}${bundle}`).toBeLessThan(150 * 1024);
      }
    }
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
