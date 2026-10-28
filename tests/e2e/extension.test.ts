// MIT License © 2026 Carlos Lopez
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import type { Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { FakeTracker } from '../support/fake-tracker';
import { serveFiles } from '../support/browser';
import { loadExtension } from '../support/extension';
import type { LoadedExtension } from '../support/extension';

// The built extension in a real Chromium: start from the popup's messages, draw on the
// page, join as a viewer over real WebRTC, survive a reload, stop.

let ext: LoadedExtension;
let tracker: FakeTracker;
let files: { origin: string; server: Server };
let control: Page;

beforeAll(async () => {
  execFileSync(process.execPath, ['scripts/build-extension.mjs', '--e2e'], {
    cwd: resolve(import.meta.dirname, '../..'),
    stdio: 'inherit',
  });
  [tracker, files] = await Promise.all([FakeTracker.start(), serveFiles()]);
  ext = await loadExtension();
  control = await ext.extensionPage();
  // Loopback only: no STUN, and our own tracker.
  await control.evaluate(
    (trackerUrl) =>
      chrome.storage.sync.set({
        settings: { trackers: [trackerUrl], iceServers: [], name: 'Pat', viewersMayDraw: true },
      }),
    tracker.url,
  );
}, 120000);

afterAll(async () => {
  await ext?.close();
  await tracker?.stop();
  files?.server.close();
});

interface Ui {
  phase: string;
  link: string | null;
  viewers: { name: string }[];
  overlay: boolean;
  drawing: boolean;
  paused: boolean;
}

const send = <T>(message: Record<string, unknown>): Promise<T> =>
  control.evaluate((m) => chrome.runtime.sendMessage(m), message) as Promise<T>;
const status = () => send<Ui>({ target: 'background', type: 'status' });
const command = (c: Record<string, unknown>) =>
  send<Ui>({ target: 'offscreen', type: 'command', command: c });

/** The most recently opened tab (the service worker cannot read other tabs' URLs). */
async function newestTabId(): Promise<number> {
  return ext.worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return Math.max(...tabs.map((t) => t.id ?? 0));
  });
}

describe('presenter extension', () => {
  it('refuses a page the browser does not let extensions use', async () => {
    const page = await ext.context.newPage();
    await page.goto('about:blank');
    const tabId = await newestTabId();
    const result = await send<{ ok: boolean; reason?: string }>({
      target: 'background',
      type: 'start',
      tabId,
    });
    expect(result).toMatchObject({ ok: false, reason: 'restricted' });
    expect((await status()).phase).toBe('idle');
    await page.close();
  });

  it('shares a tab, draws both ways, survives a reload and stops', async () => {
    const fixture = await ext.context.newPage();
    await fixture.goto(`${files.origin}/pages/fixture.html`);
    const tabId = await newestTabId();

    // Start.
    const started = await send<{ ok: boolean; message?: string }>({
      target: 'background',
      type: 'start',
      tabId,
    });
    expect(started, started.message).toMatchObject({ ok: true });
    await expect.poll(async () => (await status()).overlay, { timeout: 15000 }).toBe(true);
    const ui = await status();
    expect(ui.phase).toBe('live');
    expect(ui.link).toMatch(/#inkpad=[A-Za-z0-9_-]{22}$/);
    const token = new URL(ui.link!).hash.split('=')[1]!;

    // The overlay is there, and the page below stays usable in pointer mode.
    await expect.poll(() => fixture.locator('inkpad-overlay').count(), { timeout: 5000 }).toBe(1);
    await fixture.locator('#count').click();
    await expect.poll(() => fixture.locator('#count').textContent()).toBe('clicks: 1');

    // A viewer joins over real WebRTC.
    const viewerPage = await ext.context.newPage();
    await viewerPage.goto(
      `${files.origin}/pages/room.html?${new URLSearchParams({ role: 'guest', token, tracker: tracker.url, name: 'Ana' })}`,
    );
    await expect
      .poll(async () => (await status()).viewers.map((v) => v.name), { timeout: 30000 })
      .toEqual(['Ana']);

    // The presenter draws a stroke with the pen; the viewer receives it.
    await fixture.bringToFront();
    await fixture.locator('collab-whiteboard button[aria-label="Pen"]').click();
    await fixture.mouse.move(300, 300);
    await fixture.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await fixture.mouse.move(300 + i * 25, 300 + i * 10);
    }
    await fixture.mouse.up();
    const viewerItems = () =>
      viewerPage.evaluate(
        () => (window as unknown as { app: { wb: { items(): unknown[] } } }).app.wb.items().length,
      );
    await expect.poll(viewerItems, { timeout: 10000 }).toBe(1);
    await expect
      .poll(() => fixture.locator('collab-whiteboard .item').count(), { timeout: 5000 })
      .toBe(1);

    // The viewer adds a sticker; it shows on the page.
    await viewerPage.evaluate(() => {
      (window as unknown as { app: { wb: { load(s: unknown): void } } }).app.wb.load({
        v: 1,
        clock: 5,
        clear: [0, ''],
        items: [
          {
            id: 'ana.1',
            author: 'ana',
            stamp: [5, 'ana'],
            kind: 'sticker',
            x: 200,
            y: 200,
            size: 80,
            name: 'laugh',
          },
        ],
      });
    });
    await expect
      .poll(() => fixture.locator('collab-whiteboard .item').count(), { timeout: 10000 })
      .toBe(2);

    // A reload loses the page but not the drawings: the overlay comes back with both items.
    await fixture.reload();
    await expect.poll(() => fixture.locator('inkpad-overlay').count(), { timeout: 15000 }).toBe(1);
    await expect
      .poll(() => fixture.locator('collab-whiteboard .item').count(), { timeout: 15000 })
      .toBe(2);
    expect((await status()).phase).toBe('live');

    // The presenter locks drawing: the viewer's next stroke does not arrive.
    await command({ cmd: 'drawing', on: false });
    await expect.poll(async () => (await status()).drawing).toBe(false);
    await viewerPage.evaluate(() => {
      (window as unknown as { app: { wb: { load(s: unknown): void } } }).app.wb.load({
        v: 1,
        clock: 9,
        clear: [0, ''],
        items: [
          {
            id: 'ana.2',
            author: 'ana',
            stamp: [9, 'ana'],
            kind: 'sticker',
            x: 10,
            y: 10,
            size: 40,
            name: 'cool',
          },
        ],
      });
    });
    await new Promise((r) => setTimeout(r, 1500));
    await expect
      .poll(() => fixture.locator('collab-whiteboard .item').count(), { timeout: 5000 })
      .toBe(2);

    // Pause shows in the state; stop removes the overlay and ends the room.
    await command({ cmd: 'pause', on: true });
    await expect.poll(async () => (await status()).paused).toBe(true);
    await command({ cmd: 'pause', on: false });

    await send({ target: 'background', type: 'stop' });
    await expect.poll(() => fixture.locator('inkpad-overlay').count(), { timeout: 10000 }).toBe(0);
    await expect
      .poll(
        () =>
          viewerPage.evaluate(() => (window as unknown as { app: { state: string } }).app.state),
        { timeout: 10000 },
      )
      .toBe('ended');
    expect((await status()).phase).toBe('idle');

    await viewerPage.close();
    await fixture.close();
  }, 120000);

  it('stops the share when the shared tab is closed', async () => {
    const page = await ext.context.newPage();
    await page.goto(`${files.origin}/pages/fixture.html`);
    const tabId = await newestTabId();
    const started = await send<{ ok: boolean }>({ target: 'background', type: 'start', tabId });
    expect(started.ok).toBe(true);
    await page.close();
    await expect.poll(async () => (await status()).phase, { timeout: 10000 }).toBe('idle');
  }, 60000);
});
