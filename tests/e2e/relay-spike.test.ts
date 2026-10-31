// MIT License © 2026 Binary Dice Games
import { afterAll, beforeAll, describe, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import type { Server } from 'node:http';
import { launchChrome, serveFiles } from '../support/browser';

// The browser behaviour the relay relies on (spec/07_participant_streaming, PLAN step 1):
// encoded frames received on one peer connection are written into the senders of others and
// decode at the far end, and a switch of source shows the new one after its key frame.

type App = { ready?: boolean; setActive(id: string): Promise<void>; color(i: number): string };

let browser: Browser;
let files: { origin: string; server: Server };

beforeAll(async () => {
  [browser, files] = await Promise.all([launchChrome(), serveFiles()]);
});

afterAll(async () => {
  await browser?.close();
  files?.server.close();
});

async function colors(page: Page, color: string): Promise<void> {
  await page.waitForFunction(
    (c) => {
      const a = (window as unknown as { app: App }).app;
      return a.color(0) === c && a.color(1) === c;
    },
    color,
    { timeout: 10000, polling: 100 },
  );
}

describe('forwarding encoded frames between peer connections', () => {
  it('reaches two viewers and switches source on a key frame', async () => {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('[page]', e.message));
    try {
      await page.goto(`${files.origin}/pages/relay-spike.html`);
      await page.waitForFunction(() => (window as unknown as { app?: App }).app?.ready);
      await colors(page, 'red');
      await page.evaluate(() => (window as unknown as { app: App }).app.setActive('b'));
      await colors(page, 'green');
      await page.evaluate(() => (window as unknown as { app: App }).app.setActive('a'));
      await colors(page, 'red');
    } finally {
      await page.close();
    }
  });
});
