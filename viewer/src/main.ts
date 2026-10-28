// MIT License © 2026 Carlos Lopez
/**
 * @file The viewer app: joins a session from an invite link, shows the
 * presenter's video with the shared whiteboard over it, and lets the person
 * draw. With the presenter key in the link it is the presenter console: it
 * proves the key to the host and shows the presenter's controls. The same
 * code is served from GitHub Pages and bundled in the extension as
 * `viewer.html`.
 */
import { createSession, SessionError } from '@inkpad/collab-session';
import type { Peer, Session } from '@inkpad/collab-session';
import { createWhiteboard, frameAdapter } from '@inkpad/collab-whiteboard';
import type { FrameAdapter, Whiteboard } from '@inkpad/collab-whiteboard';
import {
  CTL_CHANNEL,
  DEFAULT_ICE_SERVERS,
  DEFAULT_TRACKERS,
  PROTOCOL,
  STAGE_CHANNEL,
  cleanCtl,
  cleanStage,
  parseInvite,
} from '@inkpad/defaults';
import type { PresenterCommand, Stage } from '@inkpad/defaults';
import {
  boardAspect,
  endMessage,
  errorMessage,
  mayDraw,
  placeholder,
  progressMessage,
} from './model';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

type Screen = 'landing' | 'join' | 'wait' | 'app';

function show(screen: Screen): void {
  for (const id of ['landing', 'join', 'wait', 'app']) {
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

/** Settings the extension keeps, when this page is the extension's own console. */
async function extensionSettings(): Promise<{
  name?: string;
  color?: string;
  iceServers?: RTCIceServer[];
}> {
  try {
    const stored = await chrome.storage.sync.get('settings');
    const s = stored.settings as Record<string, unknown> | undefined;
    return {
      name: typeof s?.name === 'string' ? s.name : undefined,
      color: typeof s?.color === 'string' ? s.color : undefined,
      iceServers: Array.isArray(s?.iceServers) ? (s.iceServers as RTCIceServer[]) : undefined,
    };
  } catch {
    return {}; // not an extension page
  }
}

const invite = parseInvite(location.hash);

// ── State of the running session ─────────────────────────────────────────────

let session: Session | null = null;
let board: Whiteboard | null = null;
let adapter: FrameAdapter | null = null;
let stage: Stage | null = null;
let presenter = false;
let locked = false;
let hasVideo = false;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function toast(text: string): void {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 4000);
}

function hostId(): string | null {
  return session?.host()?.id ?? null;
}

/** Sends a presenter command to the host. */
function command(c: PresenterCommand): void {
  const to = hostId();
  if (session && to) {
    session.channel(CTL_CHANNEL).send({ t: 'cmd', command: c }, { to });
  }
}

// ── The page ─────────────────────────────────────────────────────────────────

function video(): HTMLVideoElement {
  return $<HTMLVideoElement>('video');
}

function refreshStage(): void {
  hasVideo = video().videoWidth > 0;
  adapter?.update();
  $('notice').textContent = placeholder(stage, hasVideo) ?? '';
  if (board) {
    const allowed = mayDraw(presenter, stage);
    if (board.readOnly === allowed) {
      board.readOnly = !allowed;
      if (!presenter) {
        toast(allowed ? 'You can draw now.' : 'Drawing is disabled by the presenter.');
      }
    }
  }
  renderPanel();
}

function renderPeople(): void {
  const peers = session ? session.peers() : [];
  const n = peers.length;
  $('people').textContent = `${n} ${n === 1 ? 'person' : 'people'}`;
  $('peopleList').replaceChildren(
    ...peers.map((p) => {
      const li = document.createElement('li');
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : '#8b8d98';
      const name = document.createElement('span');
      name.textContent =
        (p.name || (p.role === 'host' ? 'Presenter' : 'Guest')) +
        (p.id === session?.me.id ? ' (you)' : '');
      li.append(swatch, name);
      return li;
    }),
  );
  // How this person reaches the presenter, as the host measured it.
  const mine = peers.find((p) => p.id === session?.me.id)?.path;
  $('quality').textContent =
    mine === 'direct' ? 'Direct connection' : mine === 'relay' ? 'Relayed connection' : '';
  renderPanel();
}

function renderPanel(): void {
  $('panelToggle').hidden = !presenter;
  if (!presenter || !session) {
    $('panel').hidden = true;
    return;
  }
  const me = session.me.id;
  const list = $('viewers');
  list.replaceChildren(
    ...session
      .peers()
      .filter((p: Peer) => p.role === 'guest' && p.id !== me)
      .map((p) => {
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
        kick.addEventListener('click', () => command({ cmd: 'remove', id: p.id }));
        li.append(swatch, name, kick);
        return li;
      }),
  );
  $<HTMLInputElement>('drawing').checked = stage?.drawing ?? true;
  $<HTMLInputElement>('lock').checked = locked;
  $('pause').textContent = stage?.state === 'paused' ? 'Resume' : 'Pause';
}

function enterApp(): void {
  if (board || !session) {
    return;
  }
  show('app');
  const stageEl = $('stage');
  const v = video();
  adapter = frameAdapter(stageEl, () =>
    boardAspect({ width: v.videoWidth, height: v.videoHeight }, stage),
  );
  board = createWhiteboard(stageEl, {
    session,
    adapter,
    readOnly: !mayDraw(presenter, stage),
  });
  board.on('error', (e) => toast(e.message));
  for (const event of ['loadedmetadata', 'resize', 'playing']) {
    v.addEventListener(event, refreshStage);
  }
  refreshStage();
  renderPeople();
}

function endSession(message: string): void {
  board?.destroy();
  board = null;
  adapter = null;
  $('waitTitle').textContent = 'Session over';
  $('waitText').textContent = message;
  show('wait');
}

// ── Joining ──────────────────────────────────────────────────────────────────

async function join(name: string, color: string): Promise<void> {
  if (!invite) {
    return;
  }
  show('wait');
  $('waitTitle').textContent = 'Connecting…';
  $('waitText').textContent = progressMessage(undefined);
  const config = await extensionSettings();
  try {
    session = await createSession({
      role: 'guest',
      token: invite.token,
      protocol: PROTOCOL,
      me: { name, color },
      iceServers: config.iceServers ?? [...DEFAULT_ICE_SERVERS],
      rendezvous: [
        { kind: 'torrent', urls: invite.trackers ?? [...DEFAULT_TRACKERS] },
        { kind: 'manual' },
      ],
    });
  } catch (e) {
    const reason = e instanceof SessionError ? e.reason : undefined;
    $('waitTitle').textContent = 'Cannot join';
    $('waitText').textContent = errorMessage(reason);
    return;
  }
  const s = session;
  wireCodes(s);
  s.on('status', (e) => {
    if (!board) {
      $('waitText').textContent = progressMessage(e.stage);
    }
  });
  s.on('error', (e) => {
    if (!board) {
      $('waitText').textContent = errorMessage('reason' in e ? (e.reason as string) : undefined);
    }
  });
  s.on('state', (e) => {
    locked = !!e.locked;
    if (e.state === 'open') {
      enterApp();
      if (invite.presenterKey) {
        authenticate(invite.presenterKey);
      }
    } else if (e.state === 'ended') {
      endSession(endMessage(e.reason));
    }
    renderPanel();
  });
  s.on('track', (stream) => {
    const v = video();
    v.srcObject = stream;
    v.play().catch(() => {});
  });
  s.on('peers', renderPeople);
  s.channel(STAGE_CHANNEL).on('message', (m, from) => {
    const next = cleanStage(m);
    if (next && from === hostId()) {
      stage = next;
      if (next.state === 'ended' && !presenter) {
        $('notice').textContent = placeholder(next, hasVideo) ?? '';
      }
      refreshStage();
    }
  });
  s.channel(CTL_CHANNEL).on('message', (m, from) => {
    const message = cleanCtl(m);
    if (message?.t === 'role' && from === hostId()) {
      presenter = message.presenter;
      if (presenter) {
        $('panel').hidden = false;
      } else {
        toast('The presenter key was not accepted: you are a viewer.');
      }
      refreshStage();
    }
  });
}

/** The "join with a code" fallback for networks that block the trackers. */
function wireCodes(s: Session): void {
  const say = (text: string): void => {
    $('codeStatus').textContent = text;
  };
  $('makeCode').addEventListener('click', async () => {
    try {
      const code = await s.manual?.offerCode();
      const box = $<HTMLTextAreaElement>('myCode');
      box.value = code ?? '';
      box.hidden = false;
      box.select();
      say('Send this code to the presenter, then paste their answer below.');
    } catch (e) {
      say(e instanceof Error ? e.message : 'Could not make a code.');
    }
  });
  $('useAnswer').addEventListener('click', async () => {
    try {
      await s.manual?.acceptAnswer($<HTMLTextAreaElement>('answerCode').value);
      say('Connecting\u2026');
    } catch (e) {
      say(e instanceof Error ? e.message : 'That answer did not work.');
    }
  });
}

/** Proves the presenter key to the host; retried a few times in case the first message beats the link. */
function authenticate(key: string): void {
  let tries = 0;
  const send = (): void => {
    const to = hostId();
    if (presenter || !session || tries >= 5) {
      return;
    }
    tries += 1;
    if (to) {
      session.channel(CTL_CHANNEL).send({ t: 'auth', key }, { to });
    }
    setTimeout(send, 1500);
  };
  send();
}

// ── Start ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const nameInput = $<HTMLInputElement>('name');
  const colorInput = $<HTMLInputElement>('color');
  const palette = ['#e5484d', '#f5a524', '#30a46c', '#0f9f86', '#3e63dd', '#8e4ec6'];
  colorInput.value =
    store('inkpad.color') ?? palette[Math.floor(Math.random() * palette.length)] ?? '#3e63dd';
  nameInput.value = store('inkpad.name') ?? '';

  $('fullscreen').addEventListener('click', () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void $('app')
        .requestFullscreen()
        .catch(() => {});
    }
  });
  $('people').addEventListener('click', () => {
    const list = $('peopleList');
    list.hidden = !list.hidden;
    $('people').setAttribute('aria-expanded', String(!list.hidden));
  });
  $('panelToggle').addEventListener('click', () => ($('panel').hidden = !$('panel').hidden));
  $<HTMLInputElement>('drawing').addEventListener('change', (e) =>
    command({ cmd: 'drawing', on: (e.target as HTMLInputElement).checked }),
  );
  $<HTMLInputElement>('lock').addEventListener('change', (e) =>
    command({ cmd: 'lock', on: (e.target as HTMLInputElement).checked }),
  );
  $('pause').addEventListener('click', () =>
    command({ cmd: 'pause', on: stage?.state !== 'paused' }),
  );
  $('clear').addEventListener('click', () => {
    if (confirm('Clear all drawings for everyone?')) {
      command({ cmd: 'clear' });
    }
  });
  $('end').addEventListener('click', () => {
    if (confirm('End the session for everyone?')) {
      command({ cmd: 'end' });
    }
  });

  if (!invite) {
    show('landing');
    if (location.hash.includes('inkpad=')) {
      $('landingProblem').textContent = 'That link is not valid. Ask the presenter for a new one.';
      $('landingProblem').hidden = false;
    }
    return;
  }

  if (invite.presenterKey) {
    // The console needs no form: the extension's settings name it.
    const config = await extensionSettings();
    await join(config.name ?? 'Presenter', config.color ?? '#3e63dd');
    return;
  }
  show('join');
  $('joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim() || 'Guest';
    store('inkpad.name', name);
    store('inkpad.color', colorInput.value);
    void join(name, colorInput.value);
  });
  nameInput.focus();
}

void main();
