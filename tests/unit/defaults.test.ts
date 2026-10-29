// MIT License © 2026 Carlos Lopez
import { describe, expect, it } from 'vitest';
import {
  CODEC_PREFERENCE,
  DEFAULT_TRACKERS,
  DEFAULT_VIDEO,
  DEFAULT_VIEWER_BASE,
  UPLINK_WARNING_KBPS,
  VIDEO_LIMITS,
  cleanCtl,
  cleanStage,
  cleanVideoSettings,
  inviteLink,
  isPresenterKey,
  newPresenterKey,
  parseInvite,
  parseInviteHash,
  safeEqual,
  toMediaParams,
  uplinkKbps,
} from '@inkpad/defaults';

describe('video settings', () => {
  it('defaults to a few frames per second', () => {
    expect(cleanVideoSettings(undefined)).toEqual(DEFAULT_VIDEO);
    expect(DEFAULT_VIDEO.fps).toBe(3);
  });

  it('clamps every field into its range', () => {
    const s = cleanVideoSettings({ fps: 99, maxWidth: 10, maxHeight: 5000, bitrateKbps: -4 });
    expect(s.fps).toBe(VIDEO_LIMITS.fps.max);
    expect(s.maxWidth).toBe(VIDEO_LIMITS.width.min);
    expect(s.maxHeight).toBe(VIDEO_LIMITS.height.max);
    expect(s.bitrateKbps).toBe(VIDEO_LIMITS.bitrateKbps.min);
  });

  it('ignores values of the wrong type', () => {
    expect(cleanVideoSettings({ fps: '5', contentHint: 'blur' })).toEqual(DEFAULT_VIDEO);
  });

  it('turns settings into session media parameters', () => {
    const p = toMediaParams({ ...DEFAULT_VIDEO, bitrateKbps: 500 });
    expect(p.maxBitrate).toBe(500_000);
    expect(p.fps).toBe(3);
    expect(p.codecs).toEqual(['video/AV1', 'video/H264', 'video/VP9', 'video/VP8']);
  });

  it('estimates the uplink of a star', () => {
    expect(uplinkKbps(10, DEFAULT_VIDEO)).toBe(15000);
    expect(uplinkKbps(10, DEFAULT_VIDEO)).toBeGreaterThan(UPLINK_WARNING_KBPS);
    expect(uplinkKbps(-3, DEFAULT_VIDEO)).toBe(0);
  });
});

describe('video quality defaults', () => {
  it('send a screen at its own size, never shrinking one up to 4K', () => {
    // A 1440p screen sent at 1280x720 scored 70 (blur) against 1.6 at its own size.
    expect(DEFAULT_VIDEO.maxWidth).toBe(3840);
    expect(DEFAULT_VIDEO.maxHeight).toBe(2160);
    expect(VIDEO_LIMITS.width.max).toBe(3840);
    expect(VIDEO_LIMITS.height.max).toBe(2160);
  });

  it('prefer the codecs that are sharp on a still page', () => {
    expect(CODEC_PREFERENCE[0]).toBe('video/AV1');
    expect(CODEC_PREFERENCE.indexOf('video/H264')).toBeLessThan(
      CODEC_PREFERENCE.indexOf('video/VP9'),
    );
    expect(CODEC_PREFERENCE.indexOf('video/VP9')).toBeLessThan(
      CODEC_PREFERENCE.indexOf('video/VP8'),
    );
  });
});

describe('stage message', () => {
  const good = { aspect: 16 / 9, w: 1280, h: 720, fps: 3, state: 'live', drawing: true };

  it('accepts a well formed stage and drops unknown fields', () => {
    expect(cleanStage({ ...good, evil: 1 })).toEqual(good);
  });

  it('cleans the optional title', () => {
    expect(cleanStage({ ...good, title: 'Plan\u0000 A' })?.title).toBe('Plan A');
    expect(cleanStage({ ...good, title: '' })).toEqual(good);
  });

  it('rejects malformed stages', () => {
    expect(cleanStage(null)).toBeNull();
    expect(cleanStage({ ...good, aspect: 0 })).toBeNull();
    expect(cleanStage({ ...good, state: 'gone' })).toBeNull();
    expect(cleanStage({ ...good, drawing: 'yes' })).toBeNull();
    expect(cleanStage({ ...good, w: Number.NaN })).toBeNull();
  });
});

describe('invite links', () => {
  const token = 'abcdefghijklmnopqrstuv';

  it('puts the token in the fragment only', () => {
    const link = inviteLink(DEFAULT_VIEWER_BASE, `inkpad=${token}`);
    const url = new URL(link);
    expect(url.search).toBe('');
    expect(url.hash).toBe(`#inkpad=${token}`);
    expect(parseInviteHash(url.hash)).toBe(token);
  });

  it('rejects a missing or malformed token', () => {
    expect(parseInviteHash('')).toBeNull();
    expect(parseInviteHash('#inkpad=short')).toBeNull();
    expect(parseInviteHash('#collab=abcdefghijklmnopqrstuv')).toBeNull();
  });
});

describe('presenter key and ctl messages', () => {
  it('makes distinct 22-character keys', () => {
    const a = newPresenterKey();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(isPresenterKey(a)).toBe(true);
    expect(newPresenterKey()).not.toBe(a);
    expect(isPresenterKey('short')).toBe(false);
    expect(isPresenterKey(42)).toBe(false);
  });

  it('compares strings in full', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('accepts well formed ctl messages and drops unknown fields', () => {
    const key = newPresenterKey();
    expect(cleanCtl({ t: 'auth', key, extra: 1 })).toEqual({ t: 'auth', key });
    expect(cleanCtl({ t: 'role', presenter: true })).toEqual({ t: 'role', presenter: true });
    expect(cleanCtl({ t: 'cmd', command: { cmd: 'lock', on: true, evil: 1 } })).toEqual({
      t: 'cmd',
      command: { cmd: 'lock', on: true },
    });
    expect(cleanCtl({ t: 'cmd', command: { cmd: 'remove', id: 'peer-1234' } })).toEqual({
      t: 'cmd',
      command: { cmd: 'remove', id: 'peer-1234' },
    });
    expect(cleanCtl({ t: 'cmd', command: { cmd: 'clear' } })).toEqual({
      t: 'cmd',
      command: { cmd: 'clear' },
    });
    expect(cleanCtl({ t: 'cmd', command: { cmd: 'end' } })).toEqual({
      t: 'cmd',
      command: { cmd: 'end' },
    });
  });

  it('rejects malformed ctl messages', () => {
    expect(cleanCtl(null)).toBeNull();
    expect(cleanCtl('x')).toBeNull();
    expect(cleanCtl({ t: 'auth', key: 'short' })).toBeNull();
    expect(cleanCtl({ t: 'role', presenter: 'yes' })).toBeNull();
    expect(cleanCtl({ t: 'cmd' })).toBeNull();
    expect(cleanCtl({ t: 'cmd', command: { cmd: 'lock', on: 'yes' } })).toBeNull();
    expect(cleanCtl({ t: 'cmd', command: { cmd: 'remove', id: '../x' } })).toBeNull();
    expect(cleanCtl({ t: 'cmd', command: { cmd: 'format' } })).toBeNull();
    expect(cleanCtl({ t: 'other' })).toBeNull();
  });
});

describe('invite links with a presenter key and trackers', () => {
  const token = 'abcdefghijklmnopqrstuv';

  it('adds the presenter key only when given', () => {
    const key = newPresenterKey();
    const viewer = inviteLink(DEFAULT_VIEWER_BASE, `inkpad=${token}`, {
      trackers: DEFAULT_TRACKERS,
    });
    const console_ = inviteLink(DEFAULT_VIEWER_BASE, `inkpad=${token}`, {
      presenterKey: key,
      trackers: DEFAULT_TRACKERS,
    });
    expect(parseInvite(new URL(viewer).hash)).toEqual({ token });
    expect(parseInvite(new URL(console_).hash)).toEqual({ token, presenterKey: key });
  });

  it('carries only non-default trackers', () => {
    const custom = ['wss://tracker.example/announce', 'ws://127.0.0.1:9999'];
    const link = inviteLink(DEFAULT_VIEWER_BASE, `inkpad=${token}`, { trackers: custom });
    expect(parseInvite(new URL(link).hash)?.trackers).toEqual(custom);
    const plain = inviteLink(DEFAULT_VIEWER_BASE, `inkpad=${token}`, {
      trackers: DEFAULT_TRACKERS,
    });
    expect(parseInvite(new URL(plain).hash)?.trackers).toBeUndefined();
  });

  it('ignores bad keys and non-websocket trackers in a link', () => {
    const hash = `#inkpad=${token}&presenter=bad&tr=https%3A%2F%2Fx.example&tr=wss%3A%2F%2Fok.example`;
    expect(parseInvite(hash)).toEqual({ token, trackers: ['wss://ok.example'] });
    expect(parseInvite('#presenter=abcdefghijklmnopqrstuv')).toBeNull();
  });
});

describe('default trackers', () => {
  it('are the three that nymph uses, all secure websockets', () => {
    expect(DEFAULT_TRACKERS).toEqual([
      'wss://tracker.openwebtorrent.com',
      'wss://tracker.webtorrent.dev',
      'wss://tracker.btorrent.xyz',
    ]);
  });
});
