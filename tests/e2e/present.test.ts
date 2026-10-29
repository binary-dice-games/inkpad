// MIT License © 2026 Carlos Lopez
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite } from '../../scripts/build-site.mjs';
import { launchChrome } from '../support/browser';
import { FakeTracker } from '../support/fake-tracker';

// The static presenter page (spec/06_static_presenter) in Chrome: it starts a session from a
// "screen" (a canvas stream standing in for the picker, which automation cannot drive), a
// viewer joins through the site's viewer page over real WebRTC, video arrives, drawings go
// both ways, and pause, a lost source and the end reach the viewer.

let browser: Browser;
let tracker: FakeTracker;
let server: Server;
let work: string;
let origin: string;
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'inkpad-present-'));
  const out = join(work, 'site');
  await buildSite(out, { base: '/', archive: join(work, 'none') });
  server = createServer((req, res) => {
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
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  [browser, tracker] = await Promise.all([launchChrome(), FakeTracker.start()]);
});

afterAll(async () => {
  for (const c of contexts) await c.close();
  await browser?.close();
  await tracker?.stop();
  server?.close();
  rmSync(work, { recursive: true, force: true });
});

/** A page whose `getDisplayMedia` returns a moving canvas, as a chosen window would be. */
async function presenterPage(surface = 'window'): Promise<Page> {
  const ctx = await browser.newContext();
  contexts.push(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[presenter]', e.message));
  await page.addInitScript((displaySurface: string) => {
    navigator.mediaDevices.getDisplayMedia = async (options) => {
      (window as unknown as { asked: unknown }).asked = options;
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const g = canvas.getContext('2d')!;
      let n = 0;
      setInterval(() => {
        n += 1;
        g.fillStyle = n % 2 ? '#206040' : '#604020';
        g.fillRect(0, 0, 640, 360);
      }, 50);
      const stream = canvas.captureStream(15);
      const track = stream.getVideoTracks()[0]!;
      const real = track.getSettings.bind(track);
      track.getSettings = () => ({ ...real(), displaySurface }) as MediaTrackSettings;
      (window as unknown as { shared: MediaStreamTrack }).shared = track;
      return stream;
    };
  }, surface);
  await page.goto(`${origin}/present.html?tr=${encodeURIComponent(tracker.url)}`);
  return page;
}

/** Saves the name (and, optionally, the pointer mode) through the settings dialog. */
async function configure(page: Page, cursor?: string): Promise<void> {
  await page.locator('#openSettings').click();
  await page.locator('#name').fill('Pat');
  if (cursor) await page.locator('#cursor').selectOption(cursor);
  await page.locator('#settingsForm button[type=submit]').click();
}

async function startSharing(page: Page): Promise<string> {
  await configure(page);
  await page.locator('#startShare').click();
  await page.locator('#app').waitFor({ state: 'visible', timeout: 30000 });
  await expect.poll(() => page.locator('#link').inputValue()).toMatch(/#inkpad=/);
  return page.locator('#link').inputValue();
}

async function joinViewer(link: string): Promise<Page> {
  const ctx = await browser.newContext();
  contexts.push(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[viewer]', e.message));
  await page.goto(link);
  await page.locator('#name').fill('Ana');
  await page.locator('#joinForm button[type=submit]').click();
  await page.locator('#app').waitFor({ state: 'visible', timeout: 30000 });
  return page;
}

const items = (page: Page) => page.locator('collab-whiteboard .item').count();

async function draw(page: Page, from: [number, number]): Promise<void> {
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

describe('static presenter page', () => {
  it('is linked from the viewer page and shows the start screen', async () => {
    const page = await presenterPage();
    await expect.poll(() => page.locator('#startShare').isVisible()).toBe(true);
    const ctx = await browser.newContext();
    contexts.push(ctx);
    const landing = await ctx.newPage();
    await landing.goto(`${origin}/`);
    await expect
      .poll(() => landing.locator('a[href="present.html"]').count(), { timeout: 10000 })
      .toBe(1);
  });

  it('shares a source: video reaches a viewer, drawings go both ways, pause and end follow', async () => {
    const presenter = await presenterPage();
    const link = await startSharing(presenter);
    expect(link.startsWith(`${origin}/#inkpad=`)).toBe(true);
    const viewer = await joinViewer(link);

    // The video arrives, at the source's own size.
    await expect
      .poll(
        () =>
          viewer.evaluate(() => (document.getElementById('video') as HTMLVideoElement).videoWidth),
        { timeout: 30000 },
      )
      .toBe(640);
    await expect.poll(() => presenter.locator('#people').textContent()).toBe('1 viewer');

    // The presenter draws on the host session: the viewer sees it, and the other way round.
    await draw(presenter, [200, 200]);
    await expect.poll(() => items(viewer), { timeout: 15000 }).toBe(1);
    await draw(viewer, [200, 380]);
    await expect.poll(() => items(presenter), { timeout: 15000 }).toBe(2);

    // Viewers can draw: off disables the viewer's pen, on enables it.
    const pen = () => viewer.locator('collab-whiteboard button[aria-label="Pen"]').isDisabled();
    await presenter.bringToFront();
    await presenter.locator('#drawing').uncheck();
    await expect.poll(pen, { timeout: 10000 }).toBe(true);
    await presenter.locator('#drawing').check();
    await expect.poll(pen, { timeout: 10000 }).toBe(false);

    // Pause shows on the viewer; resume brings the video back.
    await presenter.locator('#pause').click();
    await expect.poll(() => viewer.locator('#notice').textContent()).toMatch(/paused/);
    await presenter.locator('#pause').click();
    await expect.poll(() => viewer.locator('#notice').textContent()).toBe('');

    // Clear removes the drawings everywhere.
    presenter.once('dialog', (d) => void d.accept());
    await presenter.locator('#clear').click();
    await expect.poll(() => items(viewer), { timeout: 15000 }).toBe(0);
    await expect.poll(() => items(presenter), { timeout: 15000 }).toBe(0);

    // The user stops sharing in the browser: the session stays, paused, with a way back.
    await presenter.evaluate(() =>
      (window as unknown as { shared: MediaStreamTrack }).shared.dispatchEvent(new Event('ended')),
    );
    await expect.poll(() => presenter.locator('#warning').textContent()).toMatch(/Sharing stopped/);
    await expect.poll(() => viewer.locator('#notice').textContent()).toMatch(/paused/);

    // End: the viewer is told, the presenter sees the end screen.
    presenter.once('dialog', (d) => void d.accept());
    await presenter.locator('#end').click();
    await presenter.locator('#over').waitFor({ state: 'visible' });
    await expect.poll(() => viewer.locator('#notice').textContent()).toMatch(/ended/);
    await expect.poll(() => viewer.locator('#wait').isVisible()).toBe(true);
  });

  it('hides the pointer when asked, and remembers the settings', async () => {
    const presenter = await presenterPage();
    await configure(presenter, 'never');
    await expect.poll(() => presenter.locator('#summary').textContent()).toMatch(/Pat.*hidden/);
    await presenter.locator('#startShare').click();
    await presenter.locator('#app').waitFor({ state: 'visible', timeout: 30000 });
    const asked = await presenter.evaluate(
      () => (window as unknown as { asked: { video: { cursor?: string } } }).asked,
    );
    expect(asked.video.cursor).toBe('never');
    // Stored: a reload shows them again.
    await presenter.reload();
    await expect.poll(() => presenter.locator('#summary').textContent()).toMatch(/Pat.*hidden/);
  });

  it('applies video settings to a running share', async () => {
    const presenter = await presenterPage();
    await startSharing(presenter);
    await presenter.locator('#settingsLive').click();
    await presenter.locator('#fps').fill('5');
    await presenter.locator('#settingsForm button[type=submit]').click();
    await expect.poll(() => presenter.locator('#toast').textContent()).toMatch(/Saved/);
    await presenter.locator('#settingsLive').click();
    expect(await presenter.locator('#fps').inputValue()).toBe('5');
  });

  it('folds the controls and the tools away so they do not hide the view', async () => {
    const presenter = await presenterPage();
    await startSharing(presenter);
    const toolbar = presenter.locator('collab-whiteboard .toolbar');
    await expect.poll(() => toolbar.isVisible()).toBe(true);
    await expect.poll(() => presenter.locator('#panel').isVisible()).toBe(true);

    await presenter.locator('#toolsToggle').click();
    await expect.poll(() => toolbar.isVisible()).toBe(false);
    await presenter.locator('#panelToggle').click();
    await expect.poll(() => presenter.locator('#panel').isVisible()).toBe(false);

    // Remembered across a reload (the next session starts folded).
    await presenter.reload();
    await presenter.locator('#startShare').click();
    await presenter.locator('#app').waitFor({ state: 'visible', timeout: 30000 });
    await expect.poll(() => presenter.locator('#panel').isVisible()).toBe(false);
    await expect.poll(() => toolbar.isVisible()).toBe(false);

    // Back again.
    await presenter.locator('#toolsToggle').click();
    await expect.poll(() => toolbar.isVisible()).toBe(true);
  });

  it('warns when a whole screen is shared', async () => {
    const presenter = await presenterPage('monitor');
    await startSharing(presenter);
    await expect.poll(() => presenter.locator('#warning').textContent()).toMatch(/whole screen/);
  });

  it('shows why when sharing is refused', async () => {
    const ctx = await browser.newContext();
    contexts.push(ctx);
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      navigator.mediaDevices.getDisplayMedia = () =>
        Promise.reject(new DOMException('no', 'NotAllowedError'));
    });
    await page.goto(`${origin}/present.html`);
    await page.locator('#startShare').click();
    await expect.poll(() => page.locator('#startProblem').textContent()).toMatch(/cancelled/);
    expect(await page.locator('#app').isVisible()).toBe(false);
  });
});
