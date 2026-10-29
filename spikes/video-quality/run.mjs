// Spike: how sharp is the video of a static, text-heavy page after the page stops moving?
//
//   node spikes/video-quality/run.mjs "name:query" ...     (each argument is one configuration)
//
// For each configuration a presenter page sends a 1920x1080 text scene (moving for 4 s, then still)
// through the same canvas relay and WebRTC path the extension uses; a viewer page measures the mean
// luma difference between what arrives and the original (0 is perfect) at several moments after
// the scene went still, and reads the sender's encoder statistics.
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// A minimal WebTorrent tracker (the same job as tests/support/fake-tracker.ts).
const swarms = new Map();
const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
await new Promise((r) => wss.once('listening', r));
wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    const m = JSON.parse(data.toString());
    if (m.action !== 'announce') return;
    const swarm = swarms.get(m.info_hash) ?? new Map();
    swarms.set(m.info_hash, swarm);
    swarm.set(m.peer_id, ws);
    if (m.to_peer_id) {
      swarm
        .get(m.to_peer_id)
        ?.send(
          JSON.stringify({
            action: 'announce',
            info_hash: m.info_hash,
            peer_id: m.peer_id,
            offer_id: m.offer_id,
            answer: m.answer,
          }),
        );
      return;
    }
    const others = [...swarm.entries()].filter(([id]) => id !== m.peer_id);
    (m.offers ?? []).forEach((o, i) =>
      others[i % Math.max(others.length, 1)]?.[1].send(
        JSON.stringify({
          action: 'announce',
          info_hash: m.info_hash,
          peer_id: m.peer_id,
          offer_id: o.offer_id,
          offer: o.offer,
        }),
      ),
    );
  });
});
const tracker = `ws://127.0.0.1:${wss.address().port}`;

const http = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = normalize(
    path === '/page.html' ? join(root, 'spikes/video-quality/page.html') : join(root, path),
  );
  if (!file.startsWith(root) || !existsSync(file) || file === root) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    'content-type': extname(file) === '.html' ? 'text/html' : 'text/javascript',
  });
  res.end(readFileSync(file));
});
await new Promise((r) => http.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${http.address().port}`;

const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: [
    '--disable-features=WebRtcHideLocalIpsWithMdns',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
  ],
});

const configs = process.argv.slice(2).map((a) => {
  const i = a.indexOf(':');
  return { name: a.slice(0, i), query: a.slice(i + 1) };
});
const moments = [1, 3, 6, 10]; // seconds after the scene went still

for (const { name, query } of configs) {
  const ctxs = [await browser.newContext(), await browser.newContext()];
  try {
    const host = await ctxs[0].newPage();
    if (process.env.LOGS) host.on('console', (m) => console.log('   host:', m.text()));
    await host.goto(
      `${origin}/page.html?role=host&tracker=${encodeURIComponent(tracker)}&${query}`,
    );
    await host.waitForFunction(() => window.app?.ready);
    const token = await host.evaluate(() => window.app.token);
    const guest = await ctxs[1].newPage();
    await guest.goto(
      `${origin}/page.html?role=guest&token=${token}&tracker=${encodeURIComponent(tracker)}&${query}`,
    );
    await guest.waitForFunction(() => document.getElementById('v').videoWidth > 0, undefined, {
      timeout: 30000,
    });
    await guest.bringToFront();
    await new Promise((r) => setTimeout(r, 4000)); // moving
    const movingDiff = await guest.evaluate(() => window.app.measure());
    await host.evaluate(() => window.app.stop());
    const t0 = Date.now();
    const row = [];
    for (const s of moments) {
      await new Promise((r) => setTimeout(r, Math.max(0, t0 + s * 1000 - Date.now())));
      const m = await guest.evaluate(() => window.app.measure());
      row.push(`${s}s: ${m.diff.toFixed(2)}`);
    }
    const stats = await host.evaluate(() => window.app.stats());
    if (process.env.DUMP)
      console.log(
        JSON.stringify(
          {
            host: await host.evaluate(() => window.app.dump()),
            guest: await guest.evaluate(() => window.app.dump()),
          },
          null,
          1,
        ),
      );
    console.log(
      `${name.padEnd(22)} still -> ${row.join('  ')}   | moving ${movingDiff.diff.toFixed(2)} | ${stats.codec} sent ${stats.sent} limit=${stats.limit} qp=${stats.qp} ${(stats.bytes / 1024).toFixed(0)} KB, ${stats.encodeMs} ms/frame (${stats.framesEncoded} frames) hw=${stats.hw}`,
    );
  } catch (e) {
    console.log(`${name.padEnd(22)} FAILED ${e.message.split('\n')[0]}`);
  } finally {
    for (const c of ctxs) await c.close();
  }
}
await browser.close();
http.close();
wss.close();
