// MIT License © 2026 Carlos Lopez
/**
 * @file The presenter page (spec/06_static_presenter): the person picks a tab,
 * a window or a screen with the browser's picker, and this page becomes host and
 * console at once. The captured surface is sent to viewers; the same video is
 * shown here with the whiteboard over it, mounted on the host session.
 */
import { SessionError } from '@inkpad/collab-session';
import { createWhiteboard, frameAdapter } from '@inkpad/collab-whiteboard';
import type { FrameAdapter, Whiteboard } from '@inkpad/collab-whiteboard';
import { cleanSettings, cleanTrackers } from '../../extension/src/settings';
import type { Settings } from '../../extension/src/settings';
import { ShareHost } from '../../extension/src/share-host';
import {
  canCaptureDisplay,
  fitScale,
  startDisplayCapture,
  surfaceWarning,
} from './display-capture';
import type { DisplayCapture } from './display-capture';
import { boardAspect, errorMessage } from './model';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

type Screen = 'start' | 'app' | 'over';

function show(screen: Screen): void {
  for (const id of ['start', 'app', 'over']) {
    $(id).hidden = id !== screen;
  }
}

function store(key: string, value?: string): string | null {
  try {
    if (value !== undefined) {
      localStorage.setItem(key, value);
    }
    return localStorage.getItem(key);
  } catch {
    return null; // private window or blocked storage: the page works without it
  }
}

// ── State of the running share ───────────────────────────────────────────────

let host: ShareHost | null = null;
let capture: DisplayCapture | null = null;
let board: Whiteboard | null = null;
let adapter: FrameAdapter | null = null;
let settings: Settings | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** Set while a picker is open, so a second click does not open another. */
let picking = false;

function toast(text: string): void {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 4000);
}

/** Why the picker gave nothing, for a person. */
function captureProblem(e: unknown): string {
  if (e instanceof DOMException && e.name === 'NotAllowedError') {
    return 'Sharing was cancelled or blocked. Press Start sharing and choose what to share.';
  }
  return 'This browser could not capture that: ' + (e instanceof Error ? e.message : String(e));
}

function problemText(problem: string | null): string {
  switch (problem) {
    case null:
      return '';
    case 'capture-ended':
      return 'Sharing stopped. Press Share again to choose what to show.';
    default:
      return errorMessage(problem);
  }
}

/** The address viewers open: this page's own folder (the site root), not `present.html`. */
function siteBase(): string {
  return new URL('./', location.href).toString();
}

// ── The page ─────────────────────────────────────────────────────────────────

function video(): HTMLVideoElement {
  return $<HTMLVideoElement>('video');
}

/** Sends the stage the captured size, and tells the encoder how far to reduce it. */
function frameChanged(): void {
  const v = video();
  adapter?.update();
  if (!host || !settings || v.videoWidth === 0) {
    return;
  }
  void host.command({ cmd: 'viewport', w: v.videoWidth, h: v.videoHeight });
  host.session.mediaParams({
    scale: fitScale(v.videoWidth, v.videoHeight, settings.video.maxWidth, settings.video.maxHeight),
  });
}

function render(): void {
  if (!host) {
    return;
  }
  const ui = host.ui();
  const n = ui.viewers.length;
  $('people').textContent = `${n} ${n === 1 ? 'viewer' : 'viewers'}`;
  const warning = capture ? surfaceWarning(capture.surface) : null;
  $('warning').textContent = [problemText(ui.problem), warning].filter(Boolean).join(' ');
  $<HTMLInputElement>('link').value = ui.link ?? '';
  $<HTMLInputElement>('drawing').checked = ui.drawing;
  $<HTMLInputElement>('lock').checked = ui.locked;
  $('pause').textContent = ui.paused ? 'Resume' : 'Pause';
  $('viewers').replaceChildren(
    ...ui.viewers.map((p) => {
      const li = document.createElement('li');
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : '#8b8d98';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = p.name || 'Viewer';
      const kick = document.createElement('button');
      kick.type = 'button';
      kick.textContent = 'Remove';
      kick.setAttribute('aria-label', `Remove ${p.name || 'viewer'}`);
      kick.addEventListener('click', () => void host?.command({ cmd: 'remove', id: p.id }));
      li.append(swatch, name, kick);
      return li;
    }),
  );
}

/** Takes the picked surface as the video: preview, senders, and the end of sharing. */
function useCapture(next: DisplayCapture): void {
  capture?.stop();
  capture = next;
  const v = video();
  v.srcObject = next.stream;
  v.play().catch(() => {});
  host?.setSource(next.stream);
  host?.setProblem(null);
  next.onEnded(() => {
    if (capture !== next) {
      return; // replaced by a newer capture
    }
    capture = null;
    host?.setSource(null);
    void host?.command({ cmd: 'pause', on: true });
    host?.setProblem('capture-ended');
  });
  render();
}

/** Opens the picker again, keeping the session and the link. */
async function reshare(): Promise<void> {
  if (picking) {
    return;
  }
  picking = true;
  try {
    useCapture(await startDisplayCapture());
    await host?.command({ cmd: 'pause', on: false });
  } catch (e) {
    toast(captureProblem(e));
  } finally {
    picking = false;
  }
}

function enterApp(): void {
  if (!host) {
    return;
  }
  show('app');
  const stageEl = $('stage');
  const v = video();
  const h = host;
  adapter = frameAdapter(stageEl, () =>
    boardAspect({ width: v.videoWidth, height: v.videoHeight }, h.stage()),
  );
  board = createWhiteboard(stageEl, { session: h.session, adapter, readOnly: false });
  board.on('error', (e) => toast(e.message));
  host.onChange(render);
  render();
}

function endSession(message: string): void {
  host?.stop();
  host = null;
  capture?.stop();
  capture = null;
  board?.destroy();
  board = null;
  adapter = null;
  video().srcObject = null;
  $('overText').textContent = message;
  show('over');
}

// ── Starting ─────────────────────────────────────────────────────────────────

async function startSharing(): Promise<void> {
  if (picking || host) {
    return;
  }
  const problem = $('startProblem');
  problem.hidden = true;
  const name = $<HTMLInputElement>('name').value.trim() || 'Presenter';
  const color = $<HTMLInputElement>('color').value;
  const draw = $<HTMLInputElement>('startDrawing').checked;
  store('inkpad.presenter.name', name);
  store('inkpad.color', color);
  store('inkpad.presenter.drawing', draw ? '1' : '0');

  picking = true;
  let picked: DisplayCapture;
  try {
    picked = await startDisplayCapture();
  } catch (e) {
    problem.textContent = captureProblem(e);
    problem.hidden = false;
    return;
  } finally {
    picking = false;
  }

  // `?tr=wss://...` (repeatable) replaces the public trackers; the viewer link then carries them.
  const trackers = cleanTrackers(new URLSearchParams(location.search).getAll('tr'));
  settings = cleanSettings({
    name,
    color,
    viewersMayDraw: draw,
    viewerBase: siteBase(),
    ...(trackers && trackers.length > 0 ? { trackers } : {}),
  });
  try {
    host = await ShareHost.start({
      settings,
      keeper: false,
      clearBoard: () => board?.clear(),
      onEnd: () => endSession('You ended the session.'),
    });
  } catch (e) {
    picked.stop();
    problem.textContent = errorMessage(e instanceof SessionError ? e.reason : undefined);
    problem.hidden = false;
    return;
  }
  enterApp();
  useCapture(picked);
  frameChanged();
}

function main(): void {
  const palette = ['#e5484d', '#f5a524', '#30a46c', '#0f9f86', '#3e63dd', '#8e4ec6'];
  $<HTMLInputElement>('color').value =
    store('inkpad.color') ?? palette[Math.floor(Math.random() * palette.length)] ?? '#3e63dd';
  $<HTMLInputElement>('name').value = store('inkpad.presenter.name') ?? '';
  $<HTMLInputElement>('startDrawing').checked = store('inkpad.presenter.drawing') !== '0';

  for (const event of ['loadedmetadata', 'resize']) {
    video().addEventListener(event, frameChanged);
  }
  show('start');
  if (!canCaptureDisplay()) {
    $('startProblem').textContent =
      'This browser cannot share a screen, window or tab. Use Chrome, Edge, Firefox or Safari on a computer.';
    $('startProblem').hidden = false;
    $<HTMLButtonElement>('startShare').disabled = true;
    return;
  }

  $('startForm').addEventListener('submit', (e) => {
    e.preventDefault();
    void startSharing();
  });
  $('again').addEventListener('click', () => {
    show('start');
  });
  $('fullscreen').addEventListener('click', () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void $('app')
        .requestFullscreen()
        .catch(() => {});
    }
  });
  $('panelToggle').addEventListener('click', () => ($('panel').hidden = !$('panel').hidden));
  $('copyLink').addEventListener('click', () => {
    const link = $<HTMLInputElement>('link');
    link.select();
    navigator.clipboard.writeText(link.value).then(
      () => toast('Link copied.'),
      () => toast('Copy the link from the box.'),
    );
  });
  $<HTMLInputElement>('drawing').addEventListener(
    'change',
    (e) => void host?.command({ cmd: 'drawing', on: (e.target as HTMLInputElement).checked }),
  );
  $<HTMLInputElement>('lock').addEventListener(
    'change',
    (e) => void host?.command({ cmd: 'lock', on: (e.target as HTMLInputElement).checked }),
  );
  $('pause').addEventListener('click', () => {
    if (!capture) {
      void reshare(); // nothing to resume: choose what to share
    } else if (host) {
      void host.command({ cmd: 'pause', on: !host.ui().paused });
    }
  });
  $('reshare').addEventListener('click', () => void reshare());
  $('clear').addEventListener('click', () => {
    if (confirm('Clear all drawings for everyone?')) {
      void host?.command({ cmd: 'clear' });
    }
  });
  $('end').addEventListener('click', () => {
    if (confirm('End the session for everyone?')) {
      endSession('You ended the session.');
    }
  });
  $('useCode').addEventListener('click', async () => {
    const say = (text: string): void => {
      $('codeStatus').textContent = text;
    };
    try {
      const answer = await host?.acceptCode($<HTMLTextAreaElement>('viewerCode').value);
      const out = $<HTMLTextAreaElement>('answerCode');
      out.value = answer ?? '';
      out.hidden = false;
      out.select();
      say('Send this answer back to the viewer.');
    } catch (e) {
      say(e instanceof Error ? e.message : 'That code did not work.');
    }
  });
  // Viewers are told the session ended when the page closes.
  window.addEventListener('pagehide', () => host?.stop());
}

main();
