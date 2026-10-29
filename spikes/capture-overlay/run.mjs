// Spike (throwaway): does a tab capture contain the overlay, and can the overlay be
// left out by hiding it for the frame that is taken?
//
//   node spikes/capture-overlay/run.mjs [baseline|hide] [seconds]
//
// Needs Playwright's Chromium (npx playwright-core install chromium). Prints the
// measurements as JSON.
import { createServer } from 'node:http';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2] ?? 'baseline';
const seconds = Number(process.argv[3] ?? 10);
const [vw, vh] = (process.argv[4] ?? '1280x720').split('x').map(Number);
// Fit the tab inside 1280x720 without upscaling, keeping the tab's own aspect.
const fit = Math.min(1, 1280 / vw, 720 / vh);
const grow = Number(process.env.LIMIT_SCALE ?? 1);
const limits = { maxWidth: Math.round(vw * fit * grow), maxHeight: Math.round(vh * fit * grow) };

// A copy of the extension with a fixed key, so its id is known (needed for the allowlist flag).
const work = mkdtempSync(join(tmpdir(), 'inkpad-spike-'));
const extDir = join(work, 'ext');
cpSync(join(here, 'ext'), extDir, { recursive: true });
const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const der = publicKey.export({ type: 'spki', format: 'der' });
const id = [...createHash('sha256').update(der).digest().subarray(0, 16)]
  .map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15)))
  .join('');
const manifest = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'));
manifest.key = der.toString('base64');
writeFileSync(join(extDir, 'manifest.json'), JSON.stringify(manifest));

// A page that keeps changing, so the compositor keeps producing frames.
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><body style="margin:0;background:#fff;font:40px sans-serif">
    <div id=t>0</div><div id=m style="position:absolute;top:500px;width:60px;height:60px;background:#08f"></div>
    <script>let n=0;setInterval(()=>{n++;t.textContent=n;m.style.left=(n*7%900)+'px'},33)</script>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const context = await chromium.launchPersistentContext(join(work, 'profile'), {
  channel: 'chromium',
  headless: true,
  viewport: { width: vw, height: vh },
  deviceScaleFactor: Number(process.env.DSF ?? 1),
  args: [
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    // Lets this extension capture a tab without the user gesture a person would give by clicking it.
    `--allowlisted-extension-id=${id}`,
  ],
});
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const page = await context.newPage();
  await page.goto(url);
  const tabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return Math.max(...tabs.map((t) => t.id));
  });
  await worker.evaluate(
    ([t, m, s, l, v]) => globalThis.run(t, m, s, l, v),
    [tabId, mode, seconds, limits, { w: vw, h: vh }],
  );
  if (process.env.BACKGROUND) {
    // The presenter works in another tab: does the captured one keep producing frames?
    await new Promise((r) => setTimeout(r, 1500));
    const other = await context.newPage();
    await other.goto('about:blank');
    await other.bringToFront();
    console.error(
      'visibility of the captured tab:',
      await page.evaluate(() => document.visibilityState),
    );
  }
  const deadline = Date.now() + (seconds + 20) * 1000;
  let results;
  while (Date.now() < deadline) {
    results = await worker.evaluate(() => globalThis.results);
    if (results.stats || results.log.some((l) => l.startsWith('error'))) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const overlay = await page.evaluate(() => {
    const el = document.documentElement.lastElementChild;
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      style: el.getAttribute('style'),
      rect: [r.x, r.y, r.width, r.height],
      inner: innerWidth + 'x' + innerHeight,
    };
  });
  console.log(JSON.stringify({ mode, seconds, overlay, ...results }, null, 2));
} finally {
  await context.close();
  server.close();
  rmSync(work, { recursive: true, force: true });
}
