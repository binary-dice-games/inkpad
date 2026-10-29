// MIT License © 2026 Carlos Lopez
/**
 * @file The presenter page (spec/06_static_presenter): the person picks a tab,
 * a window or a screen with the browser's picker, and this page becomes host and
 * console at once. The captured surface is sent to viewers; the same video is
 * shown here with the whiteboard over it, mounted on the host session.
 */
import { SessionError } from '@inkpad/collab-session';
import { LIMITS, createWhiteboard, fileToImageData, frameAdapter } from '@inkpad/collab-whiteboard';
import type { FrameAdapter, Whiteboard } from '@inkpad/collab-whiteboard';
import {
  DEFAULT_SETTINGS,
  cleanSettings,
  cleanTrackers,
  formatIceLines,
  parseIceLines,
} from './settings';
import type { Settings } from './settings';
import { ShareHost } from './share-host';
import { UPLINK_WARNING_KBPS, toMediaParams, uplinkKbps } from '@inkpad/defaults';
import {
  canCaptureDisplay,
  fitScale,
  startDisplayCapture,
  surfaceWarning,
} from './display-capture';
import type { DisplayCapture } from './display-capture';
import { boardAspect, errorMessage } from './model';
import { setToolbarFolded } from './fold';
import { cleanPrefs, loadPrefs, savePrefs } from './present-settings';
import type { PresenterPrefs } from './present-settings';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

type Screen = 'start' | 'app' | 'over';

function show(screen: Screen): void {
  for (const id of ['start', 'app', 'over']) {
    $(id).hidden = id !== screen;
  }
}

// ── State of the running share ───────────────────────────────────────────────

let host: ShareHost | null = null;
let capture: DisplayCapture | null = null;
let board: Whiteboard | null = null;
let adapter: FrameAdapter | null = null;
let settings: Settings | null = null;
let prefs: PresenterPrefs = loadPrefs();
/** The avatar in the settings dialog, until it is saved. */
let avatarDraft = '';
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
  adapter = frameAdapter(
    stageEl,
    () => boardAspect({ width: v.videoWidth, height: v.videoHeight }, h.stage()),
    v,
  );
  board = createWhiteboard(stageEl, {
    session: h.session,
    adapter,
    readOnly: false,
    avatar: settings?.avatar,
  });
  board.on('error', (e) => toast(e.message));
  host.onChange(render);
  setToolsCollapsed(prefs.toolsCollapsed);
  setPanelCollapsed(prefs.panelCollapsed);
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

  picking = true;
  let picked: DisplayCapture;
  try {
    picked = await startDisplayCapture(prefs.cursor);
  } catch (e) {
    problem.textContent = captureProblem(e);
    problem.hidden = false;
    return;
  } finally {
    picking = false;
  }

  // `?tr=wss://...` (repeatable) replaces the trackers; the viewer link then carries them.
  const trackers = cleanTrackers(new URLSearchParams(location.search).getAll('tr'));
  settings = cleanSettings({
    ...prefs.settings,
    viewerBase: siteBase(),
    ...(trackers && trackers.length > 0 ? { trackers } : {}),
  });
  try {
    host = await ShareHost.start({
      settings,
      clearBoard: () => board?.clear(),
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

// ── Settings and collapsing ──────────────────────────────────────────────────

const input = (id: string): HTMLInputElement => $<HTMLInputElement>(id);

function fillSettings(p: PresenterPrefs): void {
  const s = p.settings;
  input('name').value = s.name;
  input('color').value = s.color;
  input('viewersMayDraw').checked = s.viewersMayDraw;
  $<HTMLSelectElement>('cursor').value = p.cursor;
  input('fps').value = String(s.video.fps);
  input('maxWidth').value = String(s.video.maxWidth);
  input('maxHeight').value = String(s.video.maxHeight);
  input('bitrateKbps').value = String(s.video.bitrateKbps);
  showAvatar(s.avatar);
  input('trackerTtl').value = String(s.trackerTtlMinutes);
  $<HTMLTextAreaElement>('trackers').value = s.trackers.join('\n');
  $<HTMLTextAreaElement>('iceServers').value = formatIceLines(s.iceServers);
  showUplink();
}

/** The prefs as typed in the dialog, validated. */
function readSettings(): PresenterPrefs {
  return cleanPrefs({
    ...prefs,
    cursor: $<HTMLSelectElement>('cursor').value,
    settings: {
      name: input('name').value,
      color: input('color').value,
      avatar: avatarDraft,
      trackerTtlMinutes: input('trackerTtl').valueAsNumber,
      viewersMayDraw: input('viewersMayDraw').checked,
      video: {
        fps: input('fps').valueAsNumber,
        maxWidth: input('maxWidth').valueAsNumber,
        maxHeight: input('maxHeight').valueAsNumber,
        bitrateKbps: input('bitrateKbps').valueAsNumber,
      },
      trackers: cleanTrackers($<HTMLTextAreaElement>('trackers').value) ?? [],
      iceServers: parseIceLines($<HTMLTextAreaElement>('iceServers').value),
    },
  });
}

/** Shows the avatar chosen in the dialog (`''`: none). */
function showAvatar(data: string): void {
  avatarDraft = data;
  const img = $<HTMLImageElement>('avatarPreview');
  img.hidden = data === '';
  if (data) {
    img.src = data;
  } else {
    img.removeAttribute('src');
  }
  input('avatar').value = '';
}

function showUplink(): void {
  const kbps = uplinkKbps(10, readSettings().settings.video);
  const el = $('uplink');
  el.textContent = `With 10 viewers you upload about ${(kbps / 1000).toFixed(1)} Mbit/s (one stream per viewer).`;
  el.style.color = kbps > UPLINK_WARNING_KBPS ? '#b45309' : '';
}

function summary(): void {
  const { settings: s, cursor } = prefs;
  const pointer = { always: 'shown', motion: 'shown while it moves', never: 'hidden' }[cursor];
  $('summary').textContent =
    `${s.name}, ${s.video.fps} frames per second, mouse pointer ${pointer}.`;
}

/** Stores the dialog's prefs; the video limits reach a running share at once. */
function saveSettings(): void {
  prefs = readSettings();
  savePrefs(prefs);
  summary();
  if (host && settings) {
    settings = { ...settings, video: prefs.settings.video, avatar: prefs.settings.avatar };
    board?.setAvatar(prefs.settings.avatar);
    host.session.mediaParams(toMediaParams(settings.video));
    frameChanged();
    toast('Saved. Video changes apply now; the rest from the next session or share.');
  }
}

/** Folds the whiteboard toolbar away, or brings it back. */
function setToolsCollapsed(collapsed: boolean): void {
  prefs = { ...prefs, toolsCollapsed: collapsed };
  savePrefs(prefs);
  $('toolsToggle').setAttribute('aria-pressed', String(!collapsed));
  setToolbarFolded(board, collapsed);
}

function setPanelCollapsed(collapsed: boolean): void {
  prefs = { ...prefs, panelCollapsed: collapsed };
  savePrefs(prefs);
  $('panel').hidden = collapsed;
  $('panelToggle').setAttribute('aria-expanded', String(!collapsed));
}

function main(): void {
  summary();
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
  $('panelToggle').addEventListener('click', () => setPanelCollapsed(!prefs.panelCollapsed));
  $('toolsToggle').addEventListener('click', () => setToolsCollapsed(!prefs.toolsCollapsed));
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('#settings [role=tab]')];
  const selectTab = (tab: HTMLButtonElement, focus = false): void => {
    for (const other of tabs) {
      const on = other === tab;
      other.setAttribute('aria-selected', String(on));
      other.tabIndex = on ? 0 : -1;
      $(other.getAttribute('aria-controls') ?? '').hidden = !on;
    }
    if (focus) {
      tab.focus();
    }
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (step !== 0) {
        e.preventDefault();
        selectTab(tabs[(i + step + tabs.length) % tabs.length]!, true);
      }
    });
  });
  const dialog = $<HTMLDialogElement>('settings');
  const openSettings = (): void => {
    fillSettings(prefs);
    selectTab(tabs[0]!);
    dialog.showModal();
  };
  $('openSettings').addEventListener('click', openSettings);
  $('settingsLive').addEventListener('click', openSettings);
  $('closeSettings').addEventListener('click', () => dialog.close());
  $('resetSettings').addEventListener('click', () =>
    fillSettings({ ...prefs, ...cleanPrefs({ settings: DEFAULT_SETTINGS }) }),
  );
  input('avatar').addEventListener('change', () => {
    const file = input('avatar').files?.[0];
    if (file) {
      fileToImageData(file, { maxSide: 96, square: true, maxChars: LIMITS.avatarChars }).then(
        (picture) => showAvatar(picture.data),
        (e: unknown) => toast(e instanceof Error ? e.message : 'That picture cannot be used.'),
      );
    }
  });
  $('avatarClear').addEventListener('click', () => showAvatar(''));
  $('settingsForm').addEventListener('input', showUplink);
  $('settingsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    saveSettings();
    dialog.close();
  });
  $('newLink').addEventListener('click', () => void host?.command({ cmd: 'newLink' }));
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
