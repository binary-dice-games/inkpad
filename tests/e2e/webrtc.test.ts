// MIT License © 2026 Binary Dice Games
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import type { Server } from 'node:http';
import { FakeTracker } from '../support/fake-tracker';
import { launchChrome, serveFiles } from '../support/browser';

// Real WebRTC in Chromium: signaling through a local fake tracker, a video track
// from a canvas (standing in for the captured tab), data channels for the board.

let browser: Browser;
let tracker: FakeTracker;
let files: { origin: string; server: Server };

beforeAll(async () => {
  [browser, tracker, files] = await Promise.all([
    launchChrome(),
    FakeTracker.start(),
    serveFiles(),
  ]);
});

afterAll(async () => {
  await browser?.close();
  await tracker?.stop();
  files?.server.close();
});

function url(params: Record<string, string>): string {
  return `${files.origin}/pages/room.html?${new URLSearchParams({ tracker: tracker.url, ...params })}`;
}

async function open(
  params: Record<string, string>,
): Promise<{ page: Page; ctx: Awaited<ReturnType<Browser['newContext']>> }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[page]', e.message));
  await page.goto(url(params));
  await page.waitForFunction(() => (window as unknown as { app?: { ready?: boolean } }).app?.ready);
  return { page, ctx };
}

const guestOpen = (page: Page) =>
  page.waitForFunction(
    () => {
      const s = (window as unknown as { app: { session: { host(): unknown } } }).app.session;
      return s.host() !== null;
    },
    undefined,
    { timeout: 30000 },
  );

describe('video and board over real WebRTC', () => {
  it('connects through a tracker that drops announces over 12 KB, as public ones do', async () => {
    const small = await FakeTracker.start();
    small.maxMessageBytes = 12 * 1024;
    const params = (p: Record<string, string>) =>
      `${files.origin}/pages/room.html?${new URLSearchParams({ tracker: small.url, ...p })}`;
    const ctxs = [await browser.newContext(), await browser.newContext()];
    try {
      const host = await ctxs[0]!.newPage();
      await host.goto(params({ role: 'host', video: '1' }));
      await host.waitForFunction(
        () => (window as unknown as { app?: { ready?: boolean } }).app?.ready,
      );
      const token = await host.evaluate(
        () => (window as unknown as { app: { token: string } }).app.token,
      );
      const guest = await ctxs[1]!.newPage();
      await guest.goto(params({ role: 'guest', token }));
      await guest.waitForFunction(
        () => (window as unknown as { app?: { ready?: boolean } }).app?.ready,
      );
      await guestOpen(guest);
      expect(small.dropped).toBe(0);
      const widest = Math.max(...small.seen.map((m) => m.length));
      expect(widest).toBeLessThan(12 * 1024);
    } finally {
      for (const c of ctxs) await c.close();
      await small.stop();
    }
  });

  it('delivers video frames to a viewer at a low frame rate, and syncs drawings both ways', async () => {
    const host = await open({ role: 'host', video: '1', fps: '3' });
    const token = await host.page.evaluate(
      () => (window as unknown as { app: { token: string } }).app.token,
    );
    const guest = await open({ role: 'guest', token, name: 'Ana' });
    try {
      await guestOpen(guest.page);

      // Video: a track arrives and frames keep coming.
      await guest.page.waitForFunction(
        () => {
          const v = document.getElementById('v') as HTMLVideoElement;
          return v.videoWidth > 0 && v.readyState >= 2;
        },
        undefined,
        { timeout: 30000 },
      );

      // Measure the frames delivered over a few seconds, from the receiver's WebRTC statistics
      // (frames decoded), not from how often the page paints: painting depends on the window
      // being visible, delivery does not. Capped near the configured 3 fps.
      const sample = () =>
        guest.page.evaluate(async () => {
          const app = (
            window as unknown as {
              app: { session: { links: Map<string, { link: { pc: RTCPeerConnection } }> } };
            }
          ).app;
          const pc = [...app.session.links.values()][0]!.link.pc;
          const report = await pc.getStats();
          let decoded = 0;
          let received = 0;
          report.forEach((r) => {
            if (r.type === 'inbound-rtp' && r.kind === 'video') {
              decoded = r.framesDecoded ?? 0;
              received = r.framesReceived ?? 0;
            }
          });
          return { decoded, received, at: performance.now() };
        });
      const first = await sample();
      await new Promise((r) => setTimeout(r, 4000));
      const last = await sample();
      const fps = (last.decoded - first.decoded) / ((last.at - first.at) / 1000);
      const detail = JSON.stringify({ first, last, fps });
      expect(fps, detail).toBeGreaterThan(0.5);
      // The source makes 15 frames a second and the cap is 3: far below 15 shows the cap works.
      // (The bound is loose because frames arrive in bursts when the machine is busy.)
      expect(fps, detail).toBeLessThan(9);

      // The presenter sees the viewer; the viewer sees the presenter.
      await host.page.waitForFunction(
        () =>
          (window as unknown as { app: { session: { peers(): unknown[] } } }).app.session.peers()
            .length === 2,
      );

      // Board: the viewer draws with the pen; the presenter gets the stroke.
      await guest.page.evaluate(() => {
        (window as unknown as { app: { wb: { setTool(t: string): void } } }).app.wb.setTool('pen');
      });
      await guest.page.mouse.move(200, 150);
      await guest.page.mouse.down();
      for (let i = 1; i <= 10; i++) {
        await guest.page.mouse.move(200 + i * 20, 150 + i * 8);
      }
      await guest.page.mouse.up();
      await host.page.waitForFunction(
        () =>
          (window as unknown as { app: { wb: { items(): unknown[] } } }).app.wb.items().length ===
          1,
        undefined,
        { timeout: 10000 },
      );
      // ...and the presenter clears it for everyone.
      await host.page.evaluate(() =>
        (window as unknown as { app: { wb: { clear(): void } } }).app.wb.clear(),
      );
      await guest.page.waitForFunction(
        () =>
          (window as unknown as { app: { wb: { items(): unknown[] } } }).app.wb.items().length ===
          0,
        undefined,
        { timeout: 10000 },
      );
    } finally {
      await guest.ctx.close();
      await host.ctx.close();
    }
  });

  for (const codec of ['video/AV1', 'video/VP9']) {
    it(`sends the video with ${codec} when the viewer prefers it`, async () => {
      const codecs = `${codec},video/VP8`;
      const host = await open({ role: 'host', video: '1', codecs });
      const token = await host.page.evaluate(
        () => (window as unknown as { app: { token: string } }).app.token,
      );
      const guest = await open({ role: 'guest', token, codecs });
      try {
        await guestOpen(guest.page);
        await guest.page.waitForFunction(
          () => (document.getElementById('v') as HTMLVideoElement).videoWidth > 0,
          undefined,
          { timeout: 30000 },
        );
        // The codec the receiver decodes, from its WebRTC statistics.
        const used = await guest.page.evaluate(async () => {
          const app = (
            window as unknown as {
              app: {
                session: { links: Map<string, { link: { pc: RTCPeerConnection } }> };
              };
            }
          ).app;
          const report = await [...app.session.links.values()][0]!.link.pc.getStats();
          const codecs = new Map<string, string>();
          let id = '';
          report.forEach((r) => {
            if (r.type === 'codec') codecs.set(r.id, r.mimeType);
            if (r.type === 'inbound-rtp' && r.kind === 'video') id = r.codecId;
          });
          return codecs.get(id);
        });
        expect(used).toBe(codec);
      } finally {
        await guest.ctx.close();
        await host.ctx.close();
      }
    });
  }

  it('keeps the data link when the presenter sends no video', async () => {
    const host = await open({ role: 'host' });
    const token = await host.page.evaluate(
      () => (window as unknown as { app: { token: string } }).app.token,
    );
    const guest = await open({ role: 'guest', token });
    try {
      await guestOpen(guest.page);
      // A (muted) track is negotiated, but no frame ever arrives.
      const videoWidth = await guest.page.evaluate(
        () => (document.getElementById('v') as HTMLVideoElement).videoWidth,
      );
      expect(videoWidth).toBe(0);
      // The viewer listens first, then the presenter pings it.
      const got = guest.page.evaluate(
        () =>
          new Promise<unknown>((resolve) => {
            const app = (
              window as unknown as {
                app: {
                  session: {
                    channel(n: string): { on(e: string, cb: (m: unknown) => void): void };
                  };
                };
              }
            ).app;
            app.session.channel('ping').on('message', resolve);
          }),
      );
      await host.page.evaluate(() => {
        const app = (
          window as unknown as {
            app: { session: { channel(n: string): { send(m: unknown): void } } };
          }
        ).app;
        app.session.channel('ping').send({ n: 1 });
      });
      expect(await got).toEqual({ n: 1 });
    } finally {
      await guest.ctx.close();
      await host.ctx.close();
    }
  });

  it('relays a viewer sticker to the other viewer through the presenter', async () => {
    const host = await open({ role: 'host' });
    const token = await host.page.evaluate(
      () => (window as unknown as { app: { token: string } }).app.token,
    );
    const ana = await open({ role: 'guest', token, name: 'Ana' });
    const ben = await open({ role: 'guest', token, name: 'Ben' });
    try {
      await Promise.all([guestOpen(ana.page), guestOpen(ben.page)]);
      await ben.page.waitForFunction(
        () =>
          (window as unknown as { app: { session: { peers(): unknown[] } } }).app.session.peers()
            .length === 3,
        undefined,
        { timeout: 30000 },
      );
      await ana.page.evaluate(() => {
        const wb = (
          window as unknown as {
            app: { wb: { load(s: unknown): void } };
          }
        ).app.wb;
        wb.load({
          v: 1,
          clock: 1,
          clear: [0, ''],
          items: [
            {
              id: 'ana.1',
              author: 'ana',
              stamp: [1, 'ana'],
              kind: 'sticker',
              x: 100,
              y: 100,
              size: 60,
              name: 'laugh',
            },
          ],
        });
      });
      for (const peer of [host, ben]) {
        await peer.page.waitForFunction(
          () =>
            (window as unknown as { app: { wb: { items(): unknown[] } } }).app.wb.items().length ===
            1,
          undefined,
          { timeout: 10000 },
        );
      }
    } finally {
      await ben.ctx.close();
      await ana.ctx.close();
      await host.ctx.close();
    }
  });

  it('logs every step of making a connection, and nothing secret', async () => {
    const host = await open({ role: 'host' });
    const token = await host.page.evaluate(
      () => (window as unknown as { app: { token: string } }).app.token,
    );
    const guest = await open({ role: 'guest', token });
    try {
      await guestOpen(guest.page);
      const logs = (page: Page) =>
        page.evaluate(() => (window as unknown as { app: { logs: string[] } }).app.logs);
      const [h, g] = [(await logs(host.page)).join(' | '), (await logs(guest.page)).join(' | ')];
      for (const line of [
        'session: host',
        'tracker: connected to',
        'offer received from',
        'answer sent to',
        'data channel open: reliable',
        'link open',
        'session state: open',
      ]) {
        expect(h, `host log should contain "${line}"`).toContain(line);
      }
      for (const line of [
        'session: guest',
        'tracker: connected to',
        'announce with',
        'answer received from',
        'ICE connection: connected',
        'data channel open: fast',
        'session state: open',
      ]) {
        expect(g, `guest log should contain "${line}"`).toContain(line);
      }
      for (const text of [h, g]) {
        expect(text).not.toContain(token);
        expect(text).not.toContain('a=fingerprint');
        expect(text).not.toContain('v=0');
      }
    } finally {
      await guest.ctx.close();
      await host.ctx.close();
    }
  });

  it('shows the tracker only sealed offers: no token, no sdp', async () => {
    const host = await open({ role: 'host' });
    const token = await host.page.evaluate(
      () => (window as unknown as { app: { token: string } }).app.token,
    );
    const guest = await open({ role: 'guest', token });
    try {
      await guestOpen(guest.page);
      const everything = tracker.seen.join('\n');
      expect(everything).toContain('"offers"');
      expect(everything).not.toContain(token);
      expect(everything).not.toContain('v=0');
      expect(everything).not.toContain('a=fingerprint');
    } finally {
      await guest.ctx.close();
      await host.ctx.close();
    }
  });
});
