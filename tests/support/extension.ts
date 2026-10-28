// MIT License © 2026 Carlos Lopez
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { BrowserContext, Page, Worker } from 'playwright-core';

const ROOT = resolve(import.meta.dirname, '../..');

/** The e2e build of the extension (`npm run build:extension:e2e`). */
export const EXTENSION_DIR = join(ROOT, 'extension', 'dist-e2e');

export interface LoadedExtension {
  context: BrowserContext;
  worker: Worker;
  id: string;
  /** An extension page (the popup's document) to send messages from, as the popup does. */
  extensionPage(): Promise<Page>;
  close(): Promise<void>;
}

/**
 * Starts Playwright's Chromium with the e2e build loaded. Branded Chrome
 * ignores --load-extension, so this uses the Chromium Playwright downloads
 * (`npx playwright-core install chromium`).
 */
export async function loadExtension(): Promise<LoadedExtension> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'inkpad-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
      '--disable-features=WebRtcHideLocalIpsWithMdns',
    ],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  return {
    context,
    worker,
    id,
    async extensionPage() {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${id}/options.html`);
      return page;
    },
    async close() {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}
