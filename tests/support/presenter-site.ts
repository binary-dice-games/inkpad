// MIT License © 2026 Carlos Lopez
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { buildSite } from '../../scripts/build-site.mjs';
import { launchChrome } from './browser';
import { FakeTracker } from './fake-tracker';

/**
 * The built Pages site served over loopback, a local fake tracker and Chrome: what the browser
 * tests of the presenter page and the viewer need. The real picker cannot be driven, so the
 * presenter page gets a `getDisplayMedia` that returns a moving canvas, as a chosen window would.
 */
export class PresenterSite {
  private readonly contexts: BrowserContext[] = [];

  private constructor(
    readonly origin: string,
    readonly browser: Browser,
    readonly tracker: FakeTracker,
    private readonly server: Server,
    private readonly work: string,
  ) {}

  static async start(): Promise<PresenterSite> {
    const work = mkdtempSync(join(tmpdir(), 'inkpad-present-'));
    const out = join(work, 'site');
    await buildSite(out, { base: '/', archive: join(work, 'none') });
    const server = createServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      try {
        const body = readFileSync(join(out, path === '/' ? 'index.html' : path.slice(1)));
        res.writeHead(200, {
          'content-type': path.endsWith('.js') ? 'text/javascript' : 'text/html',
        });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const [browser, tracker] = await Promise.all([launchChrome(), FakeTracker.start()]);
    return new PresenterSite(origin, browser, tracker, server, work);
  }

  async close(): Promise<void> {
    for (const c of this.contexts) await c.close();
    await this.browser.close();
    await this.tracker.stop();
    this.server.close();
    rmSync(this.work, { recursive: true, force: true });
  }

  /** A fresh browser context that is closed with the site. */
  async context(options: Parameters<Browser['newContext']>[0] = {}): Promise<BrowserContext> {
    const ctx = await this.browser.newContext(options);
    this.contexts.push(ctx);
    return ctx;
  }

  /**
   * The presenter page, with a fake screen of `size` (default 640x360) whose surface kind is
   * `surface`. The options of the last `getDisplayMedia` call are in `window.asked`, the shared
   * track in `window.shared`.
   */
  async presenterPage(
    surface = 'window',
    size = { width: 640, height: 360 },
    options: { tracker?: boolean } = {},
  ): Promise<Page> {
    const page = await (await this.context()).newPage();
    page.on('pageerror', (e) => console.error('[presenter]', e.message));
    await page.addInitScript(
      ([displaySurface, w, h]: [string, number, number]) => {
        navigator.mediaDevices.getDisplayMedia = async (asked) => {
          (window as unknown as { asked: unknown }).asked = asked;
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const g = canvas.getContext('2d')!;
          let n = 0;
          setInterval(() => {
            n += 1;
            g.fillStyle = n % 2 ? '#206040' : '#604020';
            g.fillRect(0, 0, w, h);
          }, 50);
          const stream = canvas.captureStream(15);
          const track = stream.getVideoTracks()[0]!;
          const real = track.getSettings.bind(track);
          track.getSettings = () => ({ ...real(), displaySurface }) as MediaTrackSettings;
          (window as unknown as { shared: MediaStreamTrack }).shared = track;
          return stream;
        };
      },
      [surface, size.width, size.height] as [string, number, number],
    );
    // `tracker: false` points the session at a dead tracker (viewers must join with a code).
    const tracker = options.tracker === false ? 'ws://127.0.0.1:1' : this.tracker.url;
    const query = `?tr=${encodeURIComponent(tracker)}`;
    await page.goto(`${this.origin}/present.html${query}`);
    return page;
  }

  /** Starts sharing on a presenter page; returns the viewer link. */
  async startSharing(page: Page): Promise<string> {
    await configure(page);
    await page.locator('#startShare').click();
    await page.locator('#app').waitFor({ state: 'visible', timeout: 30000 });
    await expect.poll(() => page.locator('#link').inputValue()).toMatch(/#inkpad=/);
    return page.locator('#link').inputValue();
  }

  /** Opens a viewer link in a fresh context (or `page`) and joins with `name`. */
  async joinViewer(link: string, name = 'Ana', page?: Page): Promise<Page> {
    const viewer = page ?? (await (await this.context()).newPage());
    viewer.on('pageerror', (e) => console.error('[viewer]', e.message));
    await viewer.goto(link);
    await viewer.locator('#name').fill(name);
    await viewer.locator('#joinForm button[type=submit]').click();
    return viewer;
  }
}

/** Saves the name (and, optionally, the pointer mode) through the settings dialog. */
export async function configure(page: Page, cursor?: string): Promise<void> {
  await page.locator('#openSettings').click();
  await page.locator('#name').fill('Pat');
  if (cursor) await page.locator('#cursor').selectOption(cursor);
  await page.locator('#settingsForm button[type=submit]').click();
}

export const items = (page: Page) => page.locator('collab-whiteboard .item').count();

/** Draws a short stroke with the pen on a page that shows the board. */
export async function draw(page: Page, from: [number, number]): Promise<void> {
  await page.bringToFront();
  await page.locator('collab-whiteboard button[aria-label="Pen"]').click();
  await page.mouse.move(...from);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(from[0] + i * 25, from[1] + i * 10);
  }
  await page.mouse.up();
  await page.locator('collab-whiteboard button[aria-label^="Pointer"]').click();
}

export const videoWidth = (page: Page) =>
  page.evaluate(() => (document.getElementById('video') as HTMLVideoElement).videoWidth);
