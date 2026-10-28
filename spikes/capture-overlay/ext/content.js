// Spike (throwaway): a magenta "overlay" box and a marker pixel block that says
// whether the overlay is hidden (blue) or shown (green). Hide and show are driven
// from the offscreen document over a port, and acknowledged after two frames.
(() => {
  const OVERLAY = { x: 200, y: 200, w: 100, h: 100 };
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  const box = document.createElement('div');
  box.style.cssText = `position:absolute;left:${OVERLAY.x}px;top:${OVERLAY.y}px;width:${OVERLAY.w}px;height:${OVERLAY.h}px;background:#ff00ff`;
  const marker = document.createElement('div');
  marker.style.cssText = 'position:absolute;left:0;top:0;width:8px;height:8px;background:#00ff00';
  host.append(box, marker);
  document.documentElement.append(host);

  const port = chrome.runtime.connect({ name: 'spike' });
  const frames2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  port.onMessage.addListener(async (m) => {
    if (m.k === 'blink') {
      // Hidden for exactly one display frame: hide in one animation frame, show in the next.
      requestAnimationFrame(() => {
        box.style.visibility = 'hidden';
        marker.style.background = '#0000ff';
        const t0 = performance.now();
        requestAnimationFrame(() => {
          box.style.visibility = 'visible';
          marker.style.background = '#00ff00';
          port.postMessage({ k: 'ack', seq: m.seq, kind: 'blink', at: Date.now(), hiddenMs: performance.now() - t0 });
        });
      });
      return;
    }
    if (m.k === 'hide') {
      box.style.visibility = 'hidden';
      marker.style.background = '#0000ff';
    } else if (m.k === 'show') {
      box.style.visibility = 'visible';
      marker.style.background = '#00ff00';
    } else if (m.k === 'hideOnly') {
      box.style.visibility = 'hidden';
    } else {
      return;
    }
    await frames2();
    port.postMessage({ k: 'ack', seq: m.seq, kind: m.k, at: Date.now() });
  });
})();
