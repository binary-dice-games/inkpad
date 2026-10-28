// Spike (throwaway): captures the tab, classifies frames by two probes (the overlay
// box and the marker block) and, in "hide" mode, takes frames with the overlay hidden.
const log = (text) => chrome.runtime.sendMessage({ target: 'sw', type: 'log', text });
let port = null;
let acks = new Map();
chrome.runtime.onConnect.addListener((p) => {
  port = p;
  p.onMessage.addListener((m) => m.k === 'ack' && acks.get(m.seq)?.(m));
});

let seq = 0;
const ask = (kind) =>
  new Promise((resolve) => {
    const n = ++seq;
    acks.set(n, resolve);
    port.postMessage({ k: kind, seq: n });
    setTimeout(() => resolve({ at: Date.now(), hiddenMs: NaN, timedOut: true }), 1500);
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];

function color(px) {
  const [r, g, b] = px;
  if (r > 200 && g < 80 && b > 200) return 'magenta';
  if (r < 80 && g > 200 && b < 80) return 'green';
  if (r < 80 && g < 80 && b > 200) return 'blue';
  return 'other';
}

async function run({ streamId, mode, seconds, limits, view }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
        maxFrameRate: 30,
        ...(limits ?? {}),
      },
    },
  });
  const track = stream.getVideoTracks()[0];
  const info = {
    restrictTo: 'restrictTo' in track,
    cropTo: 'cropTo' in track,
    settings: track.getSettings(),
  };
  await log(`track ${JSON.stringify(info)}`);

  const latest = { t: 0, marker: 'none', probe: 'none', n: 0 };
  const history = [];
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  let canvas = null;
  let ctx = null;
  (async () => {
    for (;;) {
      const { value: frame, done } = await reader.read();
      if (done) return;
      if (!canvas || canvas.width !== frame.displayWidth) {
        canvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight);
        ctx = canvas.getContext('2d', { willReadFrequently: true });
      }
      ctx.drawImage(frame, 0, 0);
      frame.close();
      latest.marker = color(ctx.getImageData(3, 3, 1, 1).data);
      const sx = canvas.width / (view?.w ?? canvas.width);
      const sy = canvas.height / (view?.h ?? canvas.height);
      const px = Math.round(250 * sx);
      const py = Math.round(250 * sy);
      latest.probe = color(ctx.getImageData(px, py, 1, 1).data);
      latest.raw = { probe: [...ctx.getImageData(250, 250, 1, 1).data], marker: [...ctx.getImageData(3, 3, 1, 1).data] };
      latest.t = Date.now();
      latest.n += 1;
      history.push({ t: latest.t, marker: latest.marker, probe: latest.probe });
    }
  })();

  while (latest.n < 3) await sleep(20); // frames are flowing
  const stats = { info };

  if (mode === 'baseline') {
    await sleep(seconds * 1000);
    const shown = history.filter((h) => h.probe === 'magenta').length;
    const count = (key) => history.reduce((m, h) => ((m[h[key]] = (m[h[key]] ?? 0) + 1), m), {});
    Object.assign(stats, {
      frames: history.length,
      framesWithOverlay: shown,
      probeClasses: count('probe'),
      markerClasses: count('marker'),
      sample: latest.raw,
      size: [canvas.width, canvas.height],
      view,
    });
  } else if (mode === 'blink') {
    // Every 333 ms: the page hides the overlay for one display frame; take the frame that shows it.
    const hiddenMs = [];
    const toFrameMs = [];
    let ok = 0;
    let missed = 0;
    let leaked = 0;
    const cycles = Math.floor((seconds * 1000) / 333);
    for (let i = 0; i < cycles; i++) {
      const started = Date.now();
      const done = ask('blink');
      const deadline = Date.now() + 1000;
      let got = null;
      while (Date.now() < deadline && !got) {
        got = history.find((h) => h.t >= started && h.marker === 'blue') ?? null;
        if (!got) await sleep(2);
      }
      const ack = await done;
      if (ack.timedOut) log('ack timed out');
      hiddenMs.push(ack.hiddenMs);
      if (got) {
        ok += 1;
        toFrameMs.push(got.t - started);
        if (got.probe === 'magenta') leaked += 1;
      } else {
        missed += 1;
      }
      await sleep(Math.max(0, 333 - (Date.now() - started)));
    }
    Object.assign(stats, {
      cycles,
      ok,
      missed,
      leaked,
      hiddenMs: { median: median(hiddenMs), p95: pct(hiddenMs, 0.95), max: Math.max(...hiddenMs) },
      toFrameMs: { median: median(toFrameMs), p95: pct(toFrameMs, 0.95), max: Math.max(...toFrameMs) },
    });
  } else {
    // Every 333 ms: hide, wait for a frame that shows the "hidden" marker, show again.
    const hiddenMs = [];
    const toFrameMs = [];
    let ok = 0;
    let tooLate = 0;
    let leaked = 0;
    const cycles = Math.floor((seconds * 1000) / 333);
    for (let i = 0; i < cycles; i++) {
      const started = Date.now();
      const hide = await ask('hide');
      const deadline = Date.now() + 1000;
      let got = null;
      while (Date.now() < deadline && !got) {
        got = history.find((h) => h.t >= started && h.marker === 'blue') ?? null;
        if (!got) await sleep(5);
      }
      const show = await ask('show');
      hiddenMs.push(show.at - hide.at);
      if (got) {
        ok += 1;
        toFrameMs.push(got.t - started);
        if (got.probe === 'magenta') leaked += 1; // overlay still in a "hidden" frame
      } else {
        tooLate += 1;
      }
      await sleep(Math.max(0, 333 - (Date.now() - started)));
    }
    Object.assign(stats, {
      cycles,
      ok,
      tooLate,
      leaked,
      hiddenMs: { median: median(hiddenMs), p95: pct(hiddenMs, 0.95), max: Math.max(...hiddenMs) },
      toFrameMs: { median: median(toFrameMs), p95: pct(toFrameMs, 0.95), max: Math.max(...toFrameMs) },
    });
  }
  track.stop();
  chrome.runtime.sendMessage({ target: 'sw', type: 'stats', stats });
}

chrome.runtime.onMessage.addListener((m) => {
  if (m?.target === 'offscreen' && m.type === 'run') {
    run(m).catch((e) => log(`error: ${e?.message ?? e}`));
  }
});
