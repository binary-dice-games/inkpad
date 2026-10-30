// MIT License © 2026 Carlos Lopez
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PresenterSite, draw, items, videoWidth } from '../support/presenter-site';

// The viewer app in Chrome, with the presenter page as host (the fake screen stands in for the
// picker): placement of drawings in windows of different shapes, accessibility, who is here,
// touch on a phone-sized screen, joining with a code, removal and folding the tools away.

let site: PresenterSite;
beforeAll(async () => {
  site = await PresenterSite.start();
}, 180000);
afterAll(() => site?.close());

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
    const presenter = await site.presenterPage();
    const link = await site.startSharing(presenter);
    await expect.poll(() => videoWidth(presenter), { timeout: 30000 }).toBeGreaterThan(0);
    const viewer = await (await site.context()).newPage();
    await viewer.setViewportSize({ width: 700, height: 900 }); // taller than the 16:9 video
    await site.joinViewer(link, 'Ana', viewer);
    await expect.poll(() => videoWidth(viewer), { timeout: 30000 }).toBeGreaterThan(0);

    await draw(presenter, [420, 260]);
    await expect.poll(() => items(viewer), { timeout: 15000 }).toBe(1);
    const here = await itemFraction(presenter);
    const there = await itemFraction(viewer);
    expect(Math.abs(here.fx - there.fx)).toBeLessThan(0.02);
    expect(Math.abs(here.fy - there.fy)).toBeLessThan(0.02);
    expect(Math.abs(here.size - there.size)).toBeLessThan(0.02);
  }, 120000);

  it('has no accessibility violations on its screens', async () => {
    const presenter = await site.presenterPage();
    expect(await accessibilityProblems(presenter)).toEqual([]); // the presenter start screen
    await presenter.locator('#openSettings').click();
    expect(await accessibilityProblems(presenter)).toEqual([]); // the settings dialog
    await presenter.locator('#closeSettings').click();
    const link = await site.startSharing(presenter);
    await expect.poll(() => videoWidth(presenter), { timeout: 30000 }).toBeGreaterThan(0);
    expect(await accessibilityProblems(presenter)).toEqual([]); // the live page and its panel

    const ctx = await site.context();
    const viewer = await ctx.newPage();
    await viewer.goto(link);
    expect(await accessibilityProblems(viewer)).toEqual([]); // the join form
    await viewer.locator('#name').fill('Ana');
    await viewer.locator('#joinForm button[type=submit]').click();
    await expect.poll(() => videoWidth(viewer), { timeout: 30000 }).toBeGreaterThan(0);
    await viewer.locator('#people').click();
    expect(await accessibilityProblems(viewer)).toEqual([]); // the session

    const landing = await ctx.newPage();
    await landing.goto(`${site.origin}/`);
    expect(await accessibilityProblems(landing)).toEqual([]); // no link
  }, 120000);

  it('lists who is here and tells how the connection goes', async () => {
    const presenter = await site.presenterPage();
    const link = await site.startSharing(presenter);
    const viewer = await site.joinViewer(link, 'Ana');
    await expect.poll(() => videoWidth(viewer), { timeout: 30000 }).toBeGreaterThan(0);
    await viewer.locator('#people').click();
    await expect
      .poll(() => viewer.locator('#peopleList li').allTextContents(), { timeout: 10000 })
      .toEqual(expect.arrayContaining(['Pat', 'Ana (you)']));
    await expect
      .poll(() => viewer.locator('#quality').textContent(), { timeout: 15000 })
      .toBe('Direct connection');
  }, 120000);

  it('works with touch on a phone-sized screen', async () => {
    const presenter = await site.presenterPage();
    const link = await site.startSharing(presenter);

    const ctx = await site.context({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const phone = await ctx.newPage();
    const cdp = await ctx.newCDPSession(phone);
    await site.joinViewer(link, 'Phone', phone);
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
    // (The pen's options panel is open beside the toolbar: draw away from it.)
    await touch('touchStart', 200, 450);
    for (let i = 1; i <= 8; i++) {
      await touch('touchMove', 200 + i * 15, 450 + i * 6);
    }
    await touch('touchEnd', 0, 0);
    await expect.poll(() => items(presenter), { timeout: 15000 }).toBe(1);

    // The bar fits the narrow screen: nothing sticks out sideways.
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }, 120000);

  it('joins with a code when no tracker can be reached', async () => {
    // The presenter's only tracker is dead; the viewer's link points at the same dead one.
    const presenter = await site.presenterPage('window', undefined, { tracker: false });
    const link = await site.startSharing(presenter);
    const viewer = await site.joinViewer(link, 'Ana');
    await viewer.locator('#codes summary').click();
    await viewer.locator('#makeCode').click();
    await expect
      .poll(() => viewer.locator('#myCode').inputValue(), { timeout: 15000 })
      .not.toBe('');
    const code = await viewer.locator('#myCode').inputValue();

    // The presenter pastes it under "Join codes" and gets the answer.
    await presenter.locator('#panel details summary').click();
    await presenter.locator('#viewerCode').fill(code);
    await presenter.locator('#useCode').click();
    await expect
      .poll(() => presenter.locator('#answerCode').inputValue(), { timeout: 15000 })
      .not.toBe('');
    const answer = await presenter.locator('#answerCode').inputValue();

    await viewer.locator('#answerCode').fill(answer);
    await viewer.locator('#useAnswer').click();
    await expect.poll(() => videoWidth(viewer), { timeout: 30000 }).toBeGreaterThan(0);
    await expect
      .poll(() => presenter.locator('#people').textContent(), { timeout: 15000 })
      .toBe('1 viewer');

    // A damaged code is refused with a message, not a crash.
    await presenter.locator('#viewerCode').fill('not-a-code');
    await presenter.locator('#useCode').click();
    await expect
      .poll(() => presenter.locator('#codeStatus').textContent(), { timeout: 10000 })
      .toMatch(/damaged|not a join code|did not work/i);
  }, 180000);

  it('tells a removed viewer, and a viewer can fold the tools away', async () => {
    const presenter = await site.presenterPage();
    const link = await site.startSharing(presenter);
    const viewer = await site.joinViewer(link, 'Ana');
    await expect.poll(() => videoWidth(viewer), { timeout: 30000 }).toBeGreaterThan(0);

    const toolbar = viewer.locator('collab-whiteboard .toolbar');
    await expect.poll(() => toolbar.isVisible()).toBe(true);
    await viewer.locator('#toolsToggle').click();
    await expect.poll(() => toolbar.isVisible()).toBe(false);
    expect(await viewer.locator('#toolsToggle').getAttribute('aria-pressed')).toBe('false');

    // Remembered: after a reload and a new join the toolbar starts folded, and comes back.
    await viewer.reload();
    await viewer.locator('#name').fill('Ana');
    await viewer.locator('#joinForm button[type=submit]').click();
    await expect.poll(() => videoWidth(viewer), { timeout: 30000 }).toBeGreaterThan(0);
    await expect.poll(() => toolbar.isVisible()).toBe(false);
    await viewer.locator('#toolsToggle').click();
    await expect.poll(() => toolbar.isVisible()).toBe(true);

    // The presenter removes the viewer.
    await presenter.bringToFront();
    await presenter.locator('button[aria-label="Remove Ana"]').click();
    await expect
      .poll(() => viewer.locator('#waitText').textContent(), { timeout: 10000 })
      .toMatch(/removed you/);
  }, 120000);
});
