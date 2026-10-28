// MIT License © 2026 Carlos Lopez
/**
 * @file Defaults and small pure helpers shared by the extension and the
 * viewer: trackers, ICE servers, video presets, the `stage` message and
 * invite links. See spec/01_core_features/DESIGN.md.
 */

/** Wire protocol id; changes only on incompatible changes. */
export const PROTOCOL = 'inkpad/1';

/** Where the viewer is served by default (GitHub Pages of this repository). */
export const DEFAULT_VIEWER_BASE = 'https://binary-dice-games.github.io/inkpad/';

/** Public WebTorrent trackers used to introduce peers (they see only sealed bytes). */
export const DEFAULT_TRACKERS: readonly string[] = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev',
  'wss://tracker.files.fm:7073/announce',
];

/** STUN only: TURN needs credentials and is left to the user's settings. */
export const DEFAULT_ICE_SERVERS: readonly RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

/** Bounds and defaults of the video settings (spec/03_tab_streaming/DESIGN.md section 4). */
export const VIDEO_LIMITS = {
  fps: { min: 0.5, max: 15, default: 3 },
  /** Largest side of the frame is not bounded; width x height are. */
  width: { min: 640, max: 1920, default: 1280 },
  height: { min: 360, max: 1080, default: 720 },
  bitrateKbps: { min: 100, max: 3000, default: 600 },
} as const;

export type ContentHint = 'detail' | 'text' | 'motion';

export interface VideoSettings {
  fps: number;
  maxWidth: number;
  maxHeight: number;
  bitrateKbps: number;
  contentHint: ContentHint;
}

export const DEFAULT_VIDEO: Readonly<VideoSettings> = {
  fps: VIDEO_LIMITS.fps.default,
  maxWidth: VIDEO_LIMITS.width.default,
  maxHeight: VIDEO_LIMITS.height.default,
  bitrateKbps: VIDEO_LIMITS.bitrateKbps.default,
  contentHint: 'detail',
};

/** Frame-rate presets offered by the options page. */
export const FPS_PRESETS: readonly number[] = [1, 3, 5, 10];

/** Codec preference, best first; the browser's own order follows. */
export const CODEC_PREFERENCE: readonly string[] = ['video/VP9', 'video/H264', 'video/VP8'];

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Settings from any stored object: every field clamped into its range, missing ones defaulted. */
export function cleanVideoSettings(input: unknown): VideoSettings {
  const o = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const hint = o.contentHint;
  return {
    fps: clamp(o.fps, VIDEO_LIMITS.fps.min, VIDEO_LIMITS.fps.max, DEFAULT_VIDEO.fps),
    maxWidth: Math.round(
      clamp(o.maxWidth, VIDEO_LIMITS.width.min, VIDEO_LIMITS.width.max, DEFAULT_VIDEO.maxWidth),
    ),
    maxHeight: Math.round(
      clamp(o.maxHeight, VIDEO_LIMITS.height.min, VIDEO_LIMITS.height.max, DEFAULT_VIDEO.maxHeight),
    ),
    bitrateKbps: Math.round(
      clamp(
        o.bitrateKbps,
        VIDEO_LIMITS.bitrateKbps.min,
        VIDEO_LIMITS.bitrateKbps.max,
        DEFAULT_VIDEO.bitrateKbps,
      ),
    ),
    contentHint:
      hint === 'text' || hint === 'motion' || hint === 'detail' ? hint : DEFAULT_VIDEO.contentHint,
  };
}

/** The `Session.mediaParams()` argument for these settings. */
export function toMediaParams(settings: VideoSettings): {
  fps: number;
  maxBitrate: number;
  contentHint: ContentHint;
  codecs: string[];
} {
  return {
    fps: settings.fps,
    maxBitrate: settings.bitrateKbps * 1000,
    contentHint: settings.contentHint,
    codecs: [...CODEC_PREFERENCE],
  };
}

/** Uplink the presenter needs for `viewers` viewers (a star: one stream each), in kbit/s. */
export function uplinkKbps(viewers: number, settings: Pick<VideoSettings, 'bitrateKbps'>): number {
  return Math.max(0, Math.floor(viewers)) * settings.bitrateKbps;
}

/** The uplink above which the options page warns, in kbit/s. */
export const UPLINK_WARNING_KBPS = 4000;

// ── Stage message ─────────────────────────────────────────────────────────────

export type StageState = 'live' | 'paused' | 'ended';

/** What the host tells viewers about the shared frame (channel `stage`). */
export interface Stage {
  /** Frame width / height. */
  aspect: number;
  w: number;
  h: number;
  fps: number;
  state: StageState;
  /** Whether viewers may draw. */
  drawing: boolean;
  title?: string;
}

export const STAGE_CHANNEL = 'stage';

const MAX_TITLE = 120;

/** The stage if the message is well formed, else null; unknown fields are dropped. */
export function cleanStage(message: unknown): Stage | null {
  if (typeof message !== 'object' || message === null) {
    return null;
  }
  const m = message as Record<string, unknown>;
  const finite = (n: unknown, lo: number, hi: number): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
  if (
    !finite(m.aspect, 0.1, 10) ||
    !finite(m.w, 1, 16384) ||
    !finite(m.h, 1, 16384) ||
    !finite(m.fps, 0, 120)
  ) {
    return null;
  }
  if (m.state !== 'live' && m.state !== 'paused' && m.state !== 'ended') {
    return null;
  }
  if (typeof m.drawing !== 'boolean') {
    return null;
  }
  const stage: Stage = {
    aspect: m.aspect,
    w: m.w,
    h: m.h,
    fps: m.fps,
    state: m.state,
    drawing: m.drawing,
  };
  if (typeof m.title === 'string' && m.title.length > 0) {
    // eslint-disable-next-line no-control-regex
    stage.title = m.title.replace(/[\u0000-\u001f]/g, '').slice(0, MAX_TITLE);
  }
  return stage;
}

// ── Invite links ──────────────────────────────────────────────────────────────

const FRAGMENT_KEY = 'inkpad';
const PRESENTER_KEY = 'presenter';
const TRACKER_KEY = 'tr';
const TOKEN = /^[A-Za-z0-9_-]{22}$/;
const MAX_TRACKERS = 10;

/** What an invite link carries. */
export interface Invite {
  /** The room token. */
  token: string;
  /** The presenter key; present only in the console link. */
  presenterKey?: string;
  /** Trackers to use when they differ from the defaults (a viewer cannot guess them). */
  trackers?: string[];
}

/**
 * `<base>#inkpad=<token>[&presenter=<key>][&tr=<tracker>...]`; `fragment` is
 * `Session.inviteFragment()`. Trackers are added only when they are not the
 * defaults.
 */
export function inviteLink(
  base: string,
  fragment: string,
  extra: { presenterKey?: string; trackers?: readonly string[] } = {},
): string {
  const url = new URL(base);
  const params = new URLSearchParams(fragment);
  if (extra.presenterKey) {
    params.set(PRESENTER_KEY, extra.presenterKey);
  }
  const custom =
    extra.trackers &&
    extra.trackers.length > 0 &&
    extra.trackers.join(' ') !== DEFAULT_TRACKERS.join(' ');
  if (custom) {
    for (const tracker of extra.trackers!.slice(0, MAX_TRACKERS)) {
      params.append(TRACKER_KEY, tracker);
    }
  }
  url.hash = params.toString();
  return url.toString();
}

/** The invite in a URL hash, or null if the room token is absent or malformed. */
export function parseInvite(hash: string): Invite | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const token = params.get(FRAGMENT_KEY);
  if (token === null || !TOKEN.test(token)) {
    return null;
  }
  const invite: Invite = { token };
  const key = params.get(PRESENTER_KEY);
  if (key !== null && isPresenterKey(key)) {
    invite.presenterKey = key;
  }
  const trackers = params
    .getAll(TRACKER_KEY)
    .filter((t) => /^wss?:\/\/[^\s]+$/.test(t))
    .slice(0, MAX_TRACKERS);
  if (trackers.length > 0) {
    invite.trackers = trackers;
  }
  return invite;
}

/** The room token in a URL hash (`#inkpad=<token>`), or null if absent or malformed. */
export function parseInviteHash(hash: string): string | null {
  return parseInvite(hash)?.token ?? null;
}

// ── Presenter role ────────────────────────────────────────────────────────────

/** The channel for presenter authentication and commands (guest and host only; never relayed). */
export const CTL_CHANNEL = 'ctl';

/** A fresh presenter key: 128 random bits as 22 base64url characters. */
export function newPresenterKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isPresenterKey(value: unknown): value is string {
  return typeof value === 'string' && TOKEN.test(value);
}

/** Compares two strings in time that depends only on their length. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** What the presenter console can ask the host to do. */
export type PresenterCommand =
  | { cmd: 'lock'; on: boolean }
  | { cmd: 'drawing'; on: boolean }
  | { cmd: 'pause'; on: boolean }
  | { cmd: 'remove'; id: string }
  | { cmd: 'clear' }
  | { cmd: 'end' };

/** Messages on the `ctl` channel. */
export type CtlMessage =
  | { t: 'auth'; key: string }
  | { t: 'cmd'; command: PresenterCommand }
  /** Host to console: whether the key was accepted. */
  | { t: 'role'; presenter: boolean };

const PEER_ID = /^[A-Za-z0-9_-]{4,40}$/;

/** The `ctl` message if it is well formed, else null; unknown fields are dropped. */
export function cleanCtl(message: unknown): CtlMessage | null {
  if (typeof message !== 'object' || message === null) {
    return null;
  }
  const m = message as Record<string, unknown>;
  if (m.t === 'auth') {
    return isPresenterKey(m.key) ? { t: 'auth', key: m.key } : null;
  }
  if (m.t === 'role') {
    return typeof m.presenter === 'boolean' ? { t: 'role', presenter: m.presenter } : null;
  }
  if (m.t !== 'cmd' || typeof m.command !== 'object' || m.command === null) {
    return null;
  }
  const c = m.command as Record<string, unknown>;
  switch (c.cmd) {
    case 'lock':
    case 'drawing':
    case 'pause':
      return typeof c.on === 'boolean' ? { t: 'cmd', command: { cmd: c.cmd, on: c.on } } : null;
    case 'remove':
      return typeof c.id === 'string' && PEER_ID.test(c.id)
        ? { t: 'cmd', command: { cmd: 'remove', id: c.id } }
        : null;
    case 'clear':
    case 'end':
      return { t: 'cmd', command: { cmd: c.cmd } };
    default:
      return null;
  }
}
