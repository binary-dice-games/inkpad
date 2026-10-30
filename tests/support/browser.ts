// MIT License © 2026 Binary Dice Games
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';

const ROOT = resolve(import.meta.dirname, '../..');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
};

/** Where to find Chrome: INKSPLAT_CHROME, else a well known install path, else Playwright's channel. */
function chromePath(): string | undefined {
  const candidates = [
    process.env.INKSPLAT_CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find((p) => p && existsSync(p));
}

/**
 * Serves the repository's `packages/` and `tests/e2e/pages/` over loopback so test pages load as real pages would.
 */
export async function serveFiles(): Promise<{ origin: string; server: Server }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    const file = normalize(
      path.startsWith('/pages/')
        ? join(ROOT, 'tests/e2e', path)
        : path.startsWith('/packages/')
          ? join(ROOT, path)
          : '',
    );
    if (!file.startsWith(ROOT) || !existsSync(file) || file === ROOT) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

/** Launches Chromium able to make loopback WebRTC links without a camera or a picker. */
export async function launchChrome(): Promise<Browser> {
  const executablePath = chromePath();
  return chromium.launch({
    ...(executablePath ? { executablePath } : { channel: 'chrome' }),
    headless: true,
    args: [
      // Host candidates as plain IPs: no mDNS lookups between two pages of one browser.
      '--disable-features=WebRtcHideLocalIpsWithMdns',
      '--autoplay-policy=no-user-gesture-required',
      // Several windows run side by side and only one is in front: do not slow the others
      // down (timers, rendering), or the presenter page's video source stalls.
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });
}
