// MIT License © 2026 Carlos Lopez
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import type { Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { FakeTracker } from '../support/fake-tracker';
import { serveFiles } from '../support/browser';
import { E2E_EXTENSION_ID, loadExtension } from '../support/extension';
import type { LoadedExtension } from '../support/extension';

// The built extension in a real Chromium: share a tab (real tab capture), open the
// presenter console, join as a viewer over real WebRTC, draw both ways, use the
// presenter's controls, stop. Nothing is injected into the shared page.

let ext: LoadedExtension;
let tracker: FakeTracker;
let files: { origin: string; server: Server };
let control: Page;

beforeAll(async () => {
  const cwd = resolve(import.meta.dirname, '../..');
  for (const script of ['build-extension.mjs --e2e', 'build-viewer.mjs']) {
    const [file, ...args] = script.split(' ');
    execFileSync(process.execPath, [`scripts/${file}`, ...args], { cwd, stdio: 'inherit' });
  }
  [tracker, files] = await Promise.all([FakeTracker.start(), serveFiles()]);
  ext = await loadExtension();
  control = await ext.extensionPage();
  // Loopback only: no STUN, our own tracker, and the viewer served by this test.
  await control.evaluate(
    ([trackerUrl, viewerBase]) =>
      chrome.storage.sync.set({
        settings: {
          trackers: [trackerUrl],
          iceServers: [],
          name: 'Pat',
          viewersMayDraw: true,
          viewerBase,
          video: { fps: 5 },
        },
      }),
    [tracker.url, `${files.origin}/viewer/index.html`],
  );
}, 180000);

afterAll(async () => {
  await ext?.close();
  await tracker?.stop();
  files?.server.close();
});

interface Ui {
  phase: string;
  link: string | null;
  consoleLink: string | null;
  viewers: { name: string }[];
  locked: boolean;
  drawing: boolean;
  paused: boolean;
}

const send = <T>(message: Record<string, unknown>): Promise<T> =>
  control.evaluate((m) => chrome.runtime.sendMessage(m), message) as Promise<T>;
const status = () => send<Ui>({ target: 'background', type: 'status' });

/** The most recently opened tab (the service worker cannot read other tabs' URLs). */
async function newestTabId(): Promise<number> {
  return ext.worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return Math.max(...tabs.map((t) => t.id ?? 0));
  });
}

/** Collects the page's console messages that report a content security policy violation. */
function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/content security policy/i.test(m.text())) violations.push(m.text());
  });
  page.on('pageerror', (e) => {
    if (/content security policy/i.test(e.message)) violations.push(e.message);
  });
  return violations;
}

const items = (page: Page) => page.locator('collab-whiteboard .item').count();

/** Draws a short stroke with the pen on a page that shows the board. */
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

const videoWidth = (page: Page) =>
  page.evaluate(() => (document.getElementById('video') as HTMLVideoElement).videoWidth);

/** Brightness and colourfulness of the frame a page is showing in its video. */
const frameStats = (page: Page) =>
  page.evaluate(() => {
    const v = document.getElementById('video') as HTMLVideoElement;
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = Math.round((160 * v.videoHeight) / v.videoWidth);
    const g = c.getContext('2d')!;
    g.drawImage(v, 0, 0, c.width, c.height);
    const { data } = g.getImageData(0, 0, c.width, c.height);
    let luma = 0;
    let saturated = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const gr = data[i + 1]!;
      const b = data[i + 2]!;
      luma += (r + gr + b) / 3;
      if (Math.max(r, gr, b) - Math.min(r, gr, b) > 60) saturated += 1;
    }
    return { luma: luma / (data.length / 4), saturated };
  });

const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

/** Runs axe-core on the page; returns the violations as short strings. */
async function accessibilityProblems(page: Page): Promise<string[]> {
  // Evaluated over the DevTools protocol: the page's content security policy forbids injected scripts.
  await page.evaluate(readFileSync(axePath, 'utf8'));
  return page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (c: Document) => Promise<{
            violations: { id: string; impact: string; nodes: { target: unknown[] }[] }[];
          }>;
        };
      }
    ).axe;
    const result = await axe.run(document);
    return result.violations.map(
      (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => String(n.target)).join(' | ')}`,
    );
  });
}

/** Starts a share of a fresh fixture page; returns the page and the popup state. */
async function startShare(): Promise<{ fixture: Page; ui: Ui }> {
  const fixture = await ext.context.newPage();
  await fixture.goto(`${files.origin}/pages/fixture.html`);
  const started = await send<{ ok: boolean; message?: string }>({
    target: 'background',
    type: 'start',
    tabId: await newestTabId(),
  });
  expect(started, started.message).toMatchObject({ ok: true });
  return { fixture, ui: await status() };
}

/** Opens the viewer link and joins with a name. */
async function joinViewer(link: string, name: string, page?: Page): Promise<Page> {
  const viewer = page ?? (await ext.context.newPage());
  await viewer.goto(link);
  await viewer.locator('#name').fill(name);
  await viewer.locator('#joinForm button[type=submit]').click();
  return viewer;
}

/** Where the first drawn item is, as a fraction of the video frame as shown on this page. */
const itemFraction = (page: Page) =>
  page.evaluate(() => {
    const v = document.getElementById('video') as HTMLVideoElement;
    const box = v.getBoundingClientRect();
    const aspect = v.videoWidth / v.videoHeight;
    let w = box.width;
    let h = box.height;
    if (w / h > aspect) w = h * aspect;
    else h = w / aspect;
    const x0 = box.left + (box.width - w) / 2;
    const y0 = box.top + (box.height - h) / 2;
    const item = document
      .querySelector('collab-whiteboard')!
      .shadowRoot!.querySelector('.item')!
      .getBoundingClientRect();
    return {
      fx: (item.left + item.width / 2 - x0) / w,
      fy: (item.top + item.height / 2 - y0) / h,
      size: item.width / w,
    };
  });

describe('viewer app', () => {
  it('puts a drawing at the same place of the frame in windows of different shapes', async () => {
    const { fixture, ui } = await startShare();
    const console_ = await ext.context.newPage();
    await console_.goto(ui.consoleLink!);
    await expect.poll(() => videoWidth(console_), { timeout: 30000 }).toBeGreaterThan(0);
    const viewer = await ext.context.newPage();
    await viewer.setViewportSize({ width: 700, height: 900 }); // taller than the 16:9 video
    await joinViewer(ui.link!, 'Ana', viewer);
    await expect.poll(() => videoWidth(viewer), { timeout: 30000 }).toBeGreaterThan(0);

    await draw(console_, [420, 260]);
    await expect.poll(() => items(viewer), { timeout: 15000 }).toBe(1);
    const here = await itemFraction(console_);
    const there = await itemFraction(viewer);
    expect(Math.abs(here.fx - there.fx)).toBeLessThan(0.02);
    expect(Math.abs(here.fy - there.fy)).toBeLessThan(0.02);
    expect(Math.abs(here.size - there.size)).toBeLessThan(0.02);

    await send({ target: 'background', type: 'stop' });
    await viewer.close();
    await console_.close();
    await fixture.close();
  }, 120000);

  it('has no accessibility violations on its screens', async () => {
    const { fixture, ui } = await startShare();
    const viewer = await ext.context.newPage();
    await viewer.goto(ui.link!);
    expect(await accessibilityProblems(viewer)).toEqual([]); // the join form
    await viewer.locator('#name').fill('Ana');
    await viewer.locator('#joinForm button[type=submit]').click();
    await expect.poll(() => videoWidth(viewer), { timeout: 30000 }).toBeGreaterThan(0);
    await viewer.locator('#people').click();
    expect(await accessibilityProblems(viewer)).toEqual([]); // the session

    const console_ = await ext.context.newPage();
    await console_.goto(ui.consoleLink!);
    await expect
      .poll(() => console_.locator('#panelToggle').isVisible(), { timeout: 30000 })
      .toBe(true);
    await expect.poll(() => videoWidth(console_), { timeout: 30000 }).toBeGreaterThan(0);
    expect(await accessibilityProblems(console_)).toEqual([]); // the console panel

    const landing = await ext.context.newPage();
    await landing.goto(`${files.origin}/viewer/index.html`);
    expect(await accessibilityProblems(landing)).toEqual([]); // no link

    await send({ target: 'background', type: 'stop' });
    for (const page of [landing, console_, viewer, fixture]) await page.close();
  }, 120000);

  it('lists who is here and tells how the connection goes', async () => {
    const { fixture, ui } = await startShare();
    const viewer = await joinViewer(ui.link!, 'Ana');
    await expect.poll(() => videoWidth(viewer), { timeout: 30000 }).toBeGreaterThan(0);
    await viewer.locator('#people').click();
    await expect
      .poll(() => viewer.locator('#peopleList li').allTextContents(), { timeout: 10000 })
      .toEqual(expect.arrayContaining(['Pat', 'Ana (you)']));
    await expect
      .poll(() => viewer.locator('#quality').textContent(), { timeout: 15000 })
      .toBe('Direct connection');
    await send({ target: 'background', type: 'stop' });
    await viewer.close();
    await fixture.close();
  }, 120000);

  it('works with touch on a phone-sized screen', async () => {
    const { fixture, ui } = await startShare();
    const console_ = await ext.context.newPage();
    await console_.goto(ui.consoleLink!);
    await expect.poll(() => videoWidth(console_), { timeout: 30000 }).toBeGreaterThan(0);

    const phone = await ext.context.newPage();
    const cdp = await ext.context.newCDPSession(phone);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await joinViewer(ui.link!, 'Phone', phone);
    await expect.poll(() => videoWidth(phone), { timeout: 30000 }).toBeGreaterThan(0);

    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
      });
    // Choose the pen with a tap, then draw with one finger.
    const pen = await phone.locator('collab-whiteboard button[aria-label="Pen"]').boundingBox();
    await touch('touchStart', pen!.x + pen!.width / 2, pen!.y + pen!.height / 2);
    await touch('touchEnd', 0, 0);
    await expect
      .poll(() =>
        phone.locator('collab-whiteboard button[aria-label="Pen"]').getAttribute('aria-pressed'),
      )
      .toBe('true');
    // The 16:9 video fills the middle band of the tall screen (about y 313 to 531).
    await touch('touchStart', 80, 400);
    for (let i = 1; i <= 8; i++) {
      await touch('touchMove', 80 + i * 25, 400 + i * 8);
    }
    await touch('touchEnd', 0, 0);
    await expect.poll(() => items(console_), { timeout: 15000 }).toBe(1);

    // The bar fits the narrow screen: nothing sticks out sideways.
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    await send({ target: 'background', type: 'stop' });
    await phone.close();
    await console_.close();
    await fixture.close();
  }, 120000);

  it('joins with a code when no tracker can be reached', async () => {
    // The presenter has no tracker; the viewer's link points at a dead one.
    await control.evaluate(() =>
      chrome.storage.sync
        .get('settings')
        .then(({ settings }) =>
          chrome.storage.sync.set({ settings: { ...settings, trackers: [] } }),
        ),
    );
    try {
      const { fixture, ui } = await startShare();
      const viewer = await joinViewer(`${ui.link!}&tr=ws%3A%2F%2F127.0.0.1%3A1`, 'Ana');
      await viewer.locator('#codes summary').click();
      await viewer.locator('#makeCode').click();
      await expect
        .poll(() => viewer.locator('#myCode').inputValue(), { timeout: 15000 })
        .not.toBe('');
      const code = await viewer.locator('#myCode').inputValue();

      // The presenter pastes it in the popup and gets the answer.
      const popup = await ext.context.newPage();
      await popup.goto(`chrome-extension://${E2E_EXTENSION_ID}/popup.html`);
      await popup.locator('details summary').click();
      await popup.locator('#viewerCode').fill(code);
      await popup.locator('#makeAnswer').click();
      await expect
        .poll(() => popup.locator('#answerOut').inputValue(), { timeout: 15000 })
        .not.toBe('');
      const answer = await popup.locator('#answerOut').inputValue();
      await popup.close();

      await viewer.locator('#answerCode').fill(answer);
      await viewer.locator('#useAnswer').click();
      await expect.poll(() => videoWidth(viewer), { timeout: 30000 }).toBeGreaterThan(0);
      await expect
        .poll(async () => (await status()).viewers.map((v) => v.name), { timeout: 15000 })
        .toEqual(['Ana']);

      // A damaged code is refused with a message, not a crash.
      const popup2 = await ext.context.newPage();
      await popup2.goto(`chrome-extension://${E2E_EXTENSION_ID}/popup.html`);
      await popup2.locator('details summary').click();
      await popup2.locator('#viewerCode').fill('not-a-code');
      await popup2.locator('#makeAnswer').click();
      await expect
        .poll(() => popup2.locator('#codeStatus').textContent(), { timeout: 10000 })
        .toMatch(/damaged|not a join code|did not work/i);
      await popup2.close();

      await send({ target: 'background', type: 'stop' });
      await viewer.close();
      await fixture.close();
    } finally {
      await control.evaluate(
        (trackerUrl) =>
          chrome.storage.sync
            .get('settings')
            .then(({ settings }) =>
              chrome.storage.sync.set({ settings: { ...settings, trackers: [trackerUrl] } }),
            ),
        tracker.url,
      );
    }
  }, 180000);
});

describe('presenter extension and console', () => {
  it('keeps the viewer bundle small (under 150 KB gzipped)', () => {
    const bundle = readFileSync(resolve(import.meta.dirname, '../../viewer/dist/viewer.js'));
    expect(gzipSync(bundle).length).toBeLessThan(150 * 1024);
  });

  it('refuses a page the browser does not let extensions use', async () => {
    const page = await ext.context.newPage();
    await page.goto('about:blank');
    const result = await send<{ ok: boolean; reason?: string }>({
      target: 'background',
      type: 'start',
      tabId: await newestTabId(),
    });
    expect(result).toMatchObject({ ok: false, reason: 'restricted' });
    expect((await status()).phase).toBe('idle');
    await page.close();
  });

  it('refuses to share the viewer page itself', async () => {
    const page = await ext.context.newPage();
    await page.goto(`${files.origin}/viewer/index.html`);
    const result = await send<{ ok: boolean; reason?: string }>({
      target: 'background',
      type: 'start',
      tabId: await newestTabId(),
    });
    expect(result).toMatchObject({ ok: false, reason: 'console' });
    await page.close();
  });

  it('shares a tab with a console and a viewer, end to end', async () => {
    const fixture = await ext.context.newPage();
    await fixture.goto(`${files.origin}/pages/fixture.html`);

    // Start.
    const started = await send<{ ok: boolean; message?: string }>({
      target: 'background',
      type: 'start',
      tabId: await newestTabId(),
    });
    expect(started, started.message).toMatchObject({ ok: true });
    const ui = await status();
    expect(ui.phase).toBe('live');
    expect(ui.link).toMatch(/\/viewer\/index\.html#inkpad=[A-Za-z0-9_-]{22}/);
    expect(ui.link).not.toContain('presenter=');
    expect(ui.consoleLink).toMatch(
      new RegExp(`^chrome-extension://${E2E_EXTENSION_ID}/viewer\\.html#inkpad=.*&presenter=`),
    );

    // Nothing is injected into the shared page, and it stays usable.
    expect(await fixture.evaluate(() => document.documentElement.children.length)).toBe(2);
    expect(await fixture.locator('collab-whiteboard').count()).toBe(0);
    await fixture.locator('#count').click();
    expect(await fixture.locator('#count').textContent()).toBe('clicks: 1');

    // The popup's "Open console" opens the console in a window of its own.
    const popup = await ext.context.newPage();
    await popup.goto(`chrome-extension://${E2E_EXTENSION_ID}/popup.html`);
    const opened = ext.context.waitForEvent('page');
    await popup.locator('#openConsole').click();
    const console_ = await opened;
    const consoleCsp = watchCsp(console_);
    await popup.close();
    await console_.waitForLoadState();
    expect(console_.url()).toContain('viewer.html#inkpad=');

    // The console joins and recognises the presenter key; the video arrives.
    await expect
      .poll(() => console_.locator('#panelToggle').isVisible(), { timeout: 30000 })
      .toBe(true);
    await expect.poll(() => videoWidth(console_), { timeout: 30000 }).toBeGreaterThan(0);

    // The presenter is not counted as a viewer.
    expect((await status()).viewers).toEqual([]);

    // A viewer joins from the hosted viewer page.
    const viewer = await ext.context.newPage();
    const viewerCsp = watchCsp(viewer);
    await viewer.goto(ui.link!);
    await viewer.locator('#name').fill('Ana');
    await viewer.locator('#joinForm button[type=submit]').click();
    await expect.poll(() => videoWidth(viewer), { timeout: 30000 }).toBeGreaterThan(0);
    await expect
      .poll(async () => (await status()).viewers.map((v) => v.name), { timeout: 15000 })
      .toEqual(['Ana']);

    // The video shows the shared page (a white page), at the tab's own aspect.
    expect((await frameStats(viewer)).luma).toBeGreaterThan(180);
    const dims = await viewer.evaluate(() => {
      const v = document.getElementById('video') as HTMLVideoElement;
      return { w: v.videoWidth, h: v.videoHeight };
    });
    const tab = await ext.worker.evaluate(async () => {
      const state = (await chrome.storage.session.get('share')).share as { tabId: number };
      const t = await chrome.tabs.get(state.tabId);
      return { w: t.width!, h: t.height! };
    });
    expect(dims.w / dims.h).toBeCloseTo(tab.w / tab.h, 1);

    // The console draws; the viewer sees it. The viewer draws; the console sees it.
    await draw(console_, [300, 250]);
    await expect.poll(() => items(viewer), { timeout: 15000 }).toBe(1);
    await draw(viewer, [200, 400]);
    await expect.poll(() => items(console_), { timeout: 15000 }).toBe(2);
    expect(await fixture.locator('collab-whiteboard').count()).toBe(0);

    // The drawings are not in the video: the shared page is greyscale, so a coloured
    // pixel would be a stroke. Wait for fresh frames first.
    await new Promise((r) => setTimeout(r, 2500));
    expect((await frameStats(viewer)).saturated).toBe(0);
    expect((await frameStats(console_)).saturated).toBe(0);
    // Control: the measurement does see colour that is really in the page.
    await fixture.evaluate(() => {
      const box = document.createElement('div');
      box.id = 'control-box';
      box.style.cssText = 'position:fixed;left:0;top:0;width:50vw;height:50vh;background:#e5484d';
      document.body.append(box);
    });
    await expect
      .poll(async () => (await frameStats(viewer)).saturated, { timeout: 10000 })
      .toBeGreaterThan(100);
    await fixture.evaluate(() => document.getElementById('control-box')?.remove());

    // Drawing off: the viewer's tools are disabled; on again, they work.
    await console_.bringToFront();
    await console_.locator('#drawing').uncheck();
    const penDisabled = () =>
      viewer.locator('collab-whiteboard button[aria-label="Pen"]').isDisabled();
    await expect.poll(penDisabled, { timeout: 10000 }).toBe(true);
    expect((await status()).drawing).toBe(false);
    await console_.locator('#drawing').check();
    await expect.poll(penDisabled, { timeout: 10000 }).toBe(false);

    // Pause shows on the viewer; resume brings the video back.
    await console_.locator('#pause').click();
    await expect.poll(async () => (await status()).paused).toBe(true);
    await expect.poll(() => viewer.locator('#notice').textContent()).toMatch(/paused/);
    await console_.locator('#pause').click();
    await expect.poll(async () => (await status()).paused).toBe(false);
    await expect.poll(() => viewer.locator('#notice').textContent()).toBe('');

    // Clear for everyone.
    console_.on('dialog', (d) => void d.accept());
    await console_.locator('#clear').click();
    await expect.poll(() => items(viewer), { timeout: 10000 }).toBe(0);
    await expect.poll(() => items(console_), { timeout: 10000 }).toBe(0);

    // Remove the viewer.
    await console_.locator('button[aria-label="Remove Ana"]').click();
    await expect
      .poll(() => viewer.locator('#waitText').textContent(), { timeout: 10000 })
      .toMatch(/removed you/);

    // End the session from the console: the extension goes idle.
    await console_.locator('#end').click();
    await expect.poll(async () => (await status()).phase, { timeout: 15000 }).toBe('idle');
    await expect.poll(() => console_.locator('#waitTitle').textContent()).toBe('Session over');

    // The page's content security policy was never violated, on either page.
    expect(viewerCsp).toEqual([]);
    expect(consoleCsp).toEqual([]);

    await viewer.close();
    await console_.close();
    await fixture.close();
  }, 240000);

  it('treats a console link with the wrong key as a plain viewer', async () => {
    const fixture = await ext.context.newPage();
    await fixture.goto(`${files.origin}/pages/fixture.html`);
    await send({ target: 'background', type: 'start', tabId: await newestTabId() });
    const ui = await status();
    const forged = ui.consoleLink!.replace(
      /presenter=[A-Za-z0-9_-]{22}/,
      `presenter=${'A'.repeat(22)}`,
    );

    const page = await ext.context.newPage();
    await page.goto(forged);
    await expect.poll(() => page.locator('#app').isVisible(), { timeout: 30000 }).toBe(true);
    await expect
      .poll(() => page.locator('#toast').textContent(), { timeout: 15000 })
      .toMatch(/not accepted/);
    expect(await page.locator('#panelToggle').isVisible()).toBe(false);
    expect((await status()).phase).toBe('live');

    await send({ target: 'background', type: 'stop' });
    await page.close();
    await fixture.close();
  }, 120000);

  it('sends a few frames per second, as configured, not the capture rate', async () => {
    const fixture = await ext.context.newPage();
    await fixture.goto(`${files.origin}/pages/fixture.html`);
    await send({ target: 'background', type: 'start', tabId: await newestTabId() });
    const ui = await status();
    const viewer = await ext.context.newPage();
    await viewer.goto(ui.link!);
    await viewer.locator('#name').fill('Ana');
    await viewer.locator('#joinForm button[type=submit]').click();
    await expect.poll(() => videoWidth(viewer), { timeout: 30000 }).toBeGreaterThan(0);

    // The page changes 25 times a second; the settings say 5 frames a second.
    await viewer.bringToFront();
    const fps = await viewer.evaluate(async () => {
      const v = document.getElementById('video') as HTMLVideoElement;
      let frames = 0;
      const count = () => {
        frames += 1;
        v.requestVideoFrameCallback(count);
      };
      v.requestVideoFrameCallback(count);
      const t0 = performance.now();
      await new Promise((r) => setTimeout(r, 5000));
      return frames / ((performance.now() - t0) / 1000);
    });
    expect(fps).toBeGreaterThan(2);
    expect(fps).toBeLessThan(6.5);

    await send({ target: 'background', type: 'stop' });
    await viewer.close();
    await fixture.close();
  }, 120000);

  it('re-fits the video when told the shared tab changed shape', async () => {
    const fixture = await ext.context.newPage();
    await fixture.goto(`${files.origin}/pages/fixture.html`);
    await send({ target: 'background', type: 'start', tabId: await newestTabId() });
    const ui = await status();
    const viewer = await ext.context.newPage();
    await viewer.goto(ui.link!);
    await viewer.locator('#name').fill('Ana');
    await viewer.locator('#joinForm button[type=submit]').click();
    await expect.poll(() => videoWidth(viewer), { timeout: 30000 }).toBeGreaterThan(0);

    const aspectOfVideo = () =>
      viewer.evaluate(() => {
        const v = document.getElementById('video') as HTMLVideoElement;
        return v.videoWidth / v.videoHeight;
      });
    const before = await aspectOfVideo();

    // The service worker tells the capture the tab is now tall and narrow (it sends this on
    // a window resize; automation cannot resize a real window, so the message is sent here).
    const resized = await send<{ ok: boolean; message?: string }>({
      target: 'offscreen',
      type: 'resize',
      width: 700,
      height: 900,
    });
    expect(resized, resized.message).toMatchObject({ ok: true });
    await expect
      .poll(async () => Math.abs((await aspectOfVideo()) - 700 / 900), { timeout: 20000 })
      .toBeLessThan(0.1);
    expect(Math.abs((await aspectOfVideo()) - before)).toBeGreaterThan(0.5);

    await send({ target: 'background', type: 'stop' });
    await viewer.close();
    await fixture.close();
  }, 120000);

  it('stops the share when the shared tab is closed', async () => {
    const page = await ext.context.newPage();
    await page.goto(`${files.origin}/pages/fixture.html`);
    const started = await send<{ ok: boolean }>({
      target: 'background',
      type: 'start',
      tabId: await newestTabId(),
    });
    expect(started.ok).toBe(true);
    await page.close();
    await expect.poll(async () => (await status()).phase, { timeout: 10000 }).toBe('idle');
  }, 60000);
});
