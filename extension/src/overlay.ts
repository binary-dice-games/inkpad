// MIT License © 2026 Carlos Lopez
/**
 * @file The overlay injected into the shared tab: the whiteboard drawn over the
 * page and a small control bar (share link, viewers, lock, pause, hide, stop).
 * It is a view: the session and the drawings live in the offscreen document,
 * reached through a runtime port, so a page load only loses the view.
 *
 * The overlay is a child of `<html>` (not `<body>`) inside a closed shadow
 * root, so page styles and scripts do not reach it and it can be left out of
 * a capture of `<body>` (spec/03_tab_streaming section 3).
 */
import { connectSessionProxy } from '@inkpad/collab-session/session-proxy';
import { createWhiteboard, frameAdapter } from '@inkpad/collab-whiteboard';
import type { Whiteboard } from '@inkpad/collab-whiteboard';
import { OVERLAY_PORT } from './messages';
import type {
  Command,
  OverlayMessage,
  PortControlMessage,
  PortUiMessage,
  UiState,
} from './messages';

/** Replaced at build time: the e2e build leaves the shadow root open so tests can look inside. */
declare const __INKPAD_E2E__: boolean;

const STYLE = `
:host { all: initial; }
.stage { position: fixed; inset: 0; pointer-events: none; }
.bar { position: fixed; top: 8px; right: 8px; font: 13px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #1c2024; pointer-events: auto; max-width: min(340px, calc(100vw - 16px)); }
.pill { display: flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 16px; background: #fff;
  border: 1px solid #d9d9e0; box-shadow: 0 2px 10px rgba(0,0,0,.18); cursor: grab; user-select: none; }
.pill .dot { width: 9px; height: 9px; border-radius: 50%; background: #e5484d; }
.pill.paused .dot { background: #f5a524; }
.pill button { all: unset; cursor: pointer; padding: 0 2px; font-weight: 600; }
.pill button:focus-visible, .panel button:focus-visible, .panel input:focus-visible { outline: 2px solid #0f9f86; outline-offset: 1px; }
.panel { margin-top: 6px; padding: 10px; border-radius: 10px; background: #fff; border: 1px solid #d9d9e0;
  box-shadow: 0 2px 10px rgba(0,0,0,.18); display: grid; gap: 8px; }
.panel[hidden] { display: none; }
.panel .row { display: flex; gap: 6px; align-items: center; }
.panel input[type=text] { flex: 1; min-width: 0; padding: 4px 6px; border: 1px solid #d9d9e0; border-radius: 6px; font: inherit; }
.panel button { all: unset; box-sizing: border-box; padding: 4px 10px; border-radius: 6px; border: 1px solid #d9d9e0; cursor: pointer; text-align: center; background: #f6f6f8; }
.panel button:hover { background: #ececf0; }
.panel button.danger { background: #e5484d; color: #fff; border-color: #e5484d; }
.panel label { display: flex; gap: 6px; align-items: center; cursor: pointer; }
.panel ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 3px; max-height: 140px; overflow: auto; }
.panel li { display: flex; align-items: center; gap: 6px; }
.panel li .swatch { width: 10px; height: 10px; border-radius: 50%; flex: none; }
.panel li .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.panel li button { padding: 0 6px; }
.note { font-size: 12px; color: #60646c; }
.problem { font-size: 12px; color: #b45309; }
.toast { padding: 4px 8px; border-radius: 6px; background: #1c2024; color: #fff; font-size: 12px; }
@media (prefers-color-scheme: dark) {
  .bar { color: #edeef0; }
  .pill, .panel { background: #18191b; border-color: #363a3f; }
  .panel input[type=text] { background: #111113; color: inherit; border-color: #363a3f; }
  .panel button { background: #272a2d; border-color: #363a3f; color: inherit; }
  .panel button.danger { background: #e5484d; border-color: #e5484d; color: #fff; }
  .note { color: #b0b4ba; }
}
`;

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === true) {
      el.setAttribute(name, '');
    } else if (value !== false) {
      el.setAttribute(name, value);
    }
  }
  for (const child of children) {
    if (child) {
      el.append(child);
    }
  }
  return el;
}

interface Overlay {
  destroy(): void;
  toggleHidden(): void;
}

async function build(port: chrome.runtime.Port): Promise<Overlay> {
  const proxy = await connectSessionProxy(port);

  const host = document.createElement('inkpad-overlay');
  host.style.cssText =
    'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block';
  const shadow = host.attachShadow({ mode: __INKPAD_E2E__ ? 'open' : 'closed' });
  const stage = h('div', { class: 'stage' });
  const bar = h('div', { class: 'bar' });
  shadow.append(h('style', {}, STYLE), stage, bar);

  const wb: Whiteboard = createWhiteboard(stage, {
    session: proxy,
    adapter: frameAdapter(stage, () => window.innerWidth / Math.max(1, window.innerHeight)),
  });

  // ── Controls ───────────────────────────────────────────────────────────────
  let ui: UiState | null = null;
  let hidden = false;
  let expanded = false;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const send = (message: PortControlMessage): void => {
    try {
      port.postMessage(message);
    } catch {
      // the port closed: the overlay is going away
    }
  };
  const command = (c: Command): void => send({ k: 'ctl', command: c });

  const pill = h('div', { class: 'pill', part: 'pill' });
  const panel = h('div', { class: 'panel', hidden: true });
  bar.append(pill, panel);

  function toast(text: string): void {
    const t = h('div', { class: 'toast', role: 'status' }, text);
    bar.append(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 4000);
  }

  async function copy(link: string, input: HTMLInputElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      toast('Link copied');
    } catch {
      input.select();
      toast(document.execCommand('copy') ? 'Link copied' : 'Press Ctrl+C to copy the link');
    }
  }

  function render(): void {
    if (!ui) {
      return;
    }
    const viewers = ui.viewers.length;
    pill.className = `pill${ui.paused ? ' paused' : ''}`;
    const toggle = h(
      'button',
      { type: 'button', 'aria-expanded': String(expanded), title: 'Sharing controls' },
      `${ui.paused ? 'Paused' : 'Sharing'} · ${viewers} viewer${viewers === 1 ? '' : 's'}`,
    );
    toggle.addEventListener('click', () => {
      expanded = !expanded;
      render();
    });
    pill.replaceChildren(h('span', { class: 'dot' }), toggle);

    panel.hidden = !expanded;
    if (!expanded) {
      return;
    }
    const link = h('input', {
      type: 'text',
      readonly: true,
      'aria-label': 'Link for viewers',
      value: ui.link ?? '',
    });
    const copyButton = h('button', { type: 'button' }, 'Copy');
    copyButton.addEventListener('click', () => void copy(ui?.link ?? '', link));

    const lock = h('input', { type: 'checkbox' });
    lock.checked = ui.locked;
    lock.addEventListener('change', () => command({ cmd: 'lock', on: lock.checked }));
    const drawing = h('input', { type: 'checkbox' });
    drawing.checked = ui.drawing;
    drawing.addEventListener('change', () => command({ cmd: 'drawing', on: drawing.checked }));

    const list = h('ul', { 'aria-label': 'Viewers' });
    for (const v of ui.viewers) {
      const remove = h(
        'button',
        { type: 'button', 'aria-label': 'Remove viewer', title: 'Remove viewer' },
        '✕',
      );
      remove.addEventListener('click', () => command({ cmd: 'remove', id: v.id }));
      const swatch = h('span', { class: 'swatch' });
      swatch.style.background = /^#[0-9a-fA-F]{6}$/.test(v.color) ? v.color : '#8b8d98';
      list.append(h('li', {}, swatch, h('span', { class: 'name' }, v.name || 'Viewer'), remove));
    }

    const newLink = h(
      'button',
      { type: 'button', title: 'Old links stop working; people here stay' },
      'New link',
    );
    newLink.addEventListener('click', () => command({ cmd: 'newLink' }));
    const pause = h('button', { type: 'button' }, ui.paused ? 'Resume' : 'Pause');
    pause.addEventListener('click', () => command({ cmd: 'pause', on: !ui?.paused }));
    const hide = h('button', { type: 'button' }, hidden ? 'Show drawings' : 'Hide drawings');
    hide.addEventListener('click', () => toggleHidden());
    const stop = h('button', { type: 'button', class: 'danger' }, 'Stop sharing');
    stop.addEventListener('click', () => send({ k: 'stopShare' }));

    const problem =
      ui.problem === 'no-tracker'
        ? h(
            'div',
            { class: 'problem' },
            'No tracker could be reached; this network may block them.',
          )
        : null;
    const parts: (Node | null)[] = [
      h('div', { class: 'row' }, link, copyButton),
      h('label', {}, drawing, 'Viewers can draw'),
      h('label', {}, lock, 'Lock: no new viewers'),
      viewers > 0
        ? list
        : h('div', { class: 'note' }, 'Nobody has joined yet. Send them the link.'),
      problem,
      h('div', { class: 'row' }, newLink, pause, hide),
      stop,
    ];
    panel.replaceChildren(...parts.filter((n): n is Node => n !== null));
  }

  function toggleHidden(): void {
    hidden = !hidden;
    wb.element.style.visibility = hidden ? 'hidden' : 'visible';
    if (hidden) {
      wb.setTool('pointer');
    }
    render();
  }

  const onUi = (raw: unknown): void => {
    const m = raw as PortUiMessage | undefined;
    if (m?.k !== 'ui') {
      return;
    }
    ui = m.ui;
    if (ui.phase === 'idle') {
      destroy();
    } else {
      render();
    }
  };
  port.onMessage.addListener(onUi);

  wb.on('error', (e) => toast(e.message));

  // ── Viewport and dragging ──────────────────────────────────────────────────
  const reportViewport = (): void =>
    command({ cmd: 'viewport', w: window.innerWidth, h: window.innerHeight });
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const onResize = (): void => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(reportViewport, 200);
  };
  window.addEventListener('resize', onResize);
  reportViewport();

  const posKey = `bar:${location.origin}`;
  chrome.storage.local
    .get(posKey)
    .then((stored) => {
      const p = stored[posKey] as { x: number; y: number } | undefined;
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        placeBar(p.x, p.y);
      }
    })
    .catch(() => {});

  function placeBar(x: number, y: number): void {
    const maxX = Math.max(0, window.innerWidth - 60);
    const maxY = Math.max(0, window.innerHeight - 40);
    bar.style.left = `${Math.min(Math.max(0, x), maxX)}px`;
    bar.style.top = `${Math.min(Math.max(0, y), maxY)}px`;
    bar.style.right = 'auto';
  }
  pill.addEventListener('pointerdown', (down) => {
    if ((down.target as HTMLElement).closest('button')) {
      return;
    }
    const start = bar.getBoundingClientRect();
    const dx = down.clientX - start.left;
    const dy = down.clientY - start.top;
    pill.setPointerCapture(down.pointerId);
    const move = (e: PointerEvent): void => placeBar(e.clientX - dx, e.clientY - dy);
    const up = (): void => {
      pill.removeEventListener('pointermove', move);
      pill.removeEventListener('pointerup', up);
      const r = bar.getBoundingClientRect();
      void chrome.storage.local.set({ [posKey]: { x: r.left, y: r.top } }).catch(() => {});
    };
    pill.addEventListener('pointermove', move);
    pill.addEventListener('pointerup', up);
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  let destroyed = false;
  function destroy(): void {
    if (destroyed) {
      return;
    }
    destroyed = true;
    clearTimeout(toastTimer);
    clearTimeout(resizeTimer);
    window.removeEventListener('resize', onResize);
    port.onMessage.removeListener(onUi);
    wb.destroy();
    host.remove();
    try {
      port.disconnect();
    } catch {
      // already closed
    }
    onDestroyed();
  }
  port.onDisconnect.addListener(destroy);
  document.documentElement.append(host);

  return { destroy, toggleHidden };
}

let onDestroyed: () => void = () => {};

/** Marks this world as having an overlay, so a second injection does nothing. */
const world = globalThis as unknown as { __inkpadOverlay?: boolean };

async function main(): Promise<void> {
  if (world.__inkpadOverlay) {
    return;
  }
  world.__inkpadOverlay = true;
  const port = chrome.runtime.connect({ name: OVERLAY_PORT });
  let overlay: Overlay;
  const onMessage = (message: unknown): void => {
    if ((message as OverlayMessage | undefined)?.type === 'toggle-overlay') {
      overlay?.toggleHidden();
    }
  };
  onDestroyed = () => {
    chrome.runtime.onMessage.removeListener(onMessage);
    world.__inkpadOverlay = false;
  };
  try {
    overlay = await build(port);
    chrome.runtime.onMessage.addListener(onMessage);
  } catch {
    // no share is running (the port was refused): nothing to show
    port.disconnect();
    onDestroyed();
  }
}

void main();
