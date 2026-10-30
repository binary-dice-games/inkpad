// MIT License © 2026 Carlos Lopez
import { describe, expect, it } from 'vitest';
import {
  CODEC_PREFERENCE,
  DEFAULT_TRACKERS,
  DEFAULT_VIDEO,
  DEFAULT_VIEWER_BASE,
  UPLINK_WARNING_KBPS,
  VIDEO_LIMITS,
  BACKGROUNDS,
  CANVASES,
  canvasBackground,
  cleanStage,
  defaultBackgrounds,
  cleanVideoSettings,
  inviteLink,
  parseInvite,
  parseInviteHash,
  toMediaParams,
  uplinkKbps,
} from '@inksplat/defaults';

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

  it('says a session has no video, and keeps only known backgrounds per canvas', () => {
    expect(
      cleanStage({ ...good, video: false, backgrounds: ['cork', 'lava', 'video', 'wall'] }),
    ).toEqual({
      ...good,
      video: false,
      // Unknown entries, the video without video and missing canvases take the defaults.
      backgrounds: ['cork', 'blackboard', 'wall', 'wall', 'whiteboard'],
    });
    expect(cleanStage({ ...good, video: true })).toEqual(good);
    expect(cleanStage({ ...good, video: 'no' })).toEqual(good);
    expect(cleanStage({ ...good, backgrounds: 'cork' })).toEqual(good);
    expect(cleanStage({ ...good, backgrounds: ['wall', 'video'] })?.backgrounds).toEqual([
      'wall',
      'video',
      'blackboard',
      'wall',
      'cork',
    ]);
    expect(BACKGROUNDS).toEqual(['whiteboard', 'blackboard', 'wall', 'cork']);
  });

  it('gives canvas 1 the video when there is one, and the backgrounds to the others', () => {
    expect(defaultBackgrounds(true)).toEqual(['video', 'whiteboard', 'blackboard', 'wall', 'cork']);
    expect(defaultBackgrounds(false)).toEqual([
      'whiteboard',
      'blackboard',
      'wall',
      'cork',
      'whiteboard',
    ]);
    expect(defaultBackgrounds(true)).toHaveLength(CANVASES);
    const stage = cleanStage(good)!;
    expect(canvasBackground(stage, 0)).toBe('video');
    expect(canvasBackground(stage, 4)).toBe('cork');
    expect(canvasBackground(null, 0)).toBe('video');
    expect(canvasBackground({ ...stage, video: false }, 0)).toBe('whiteboard');
    expect(canvasBackground({ ...stage, backgrounds: ['wall'] }, 0)).toBe('wall');
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
    const link = inviteLink(DEFAULT_VIEWER_BASE, `inksplat=${token}`);
    const url = new URL(link);
    expect(url.search).toBe('');
    expect(url.hash).toBe(`#inksplat=${token}`);
    expect(parseInviteHash(url.hash)).toBe(token);
  });

  it('rejects a missing or malformed token', () => {
    expect(parseInviteHash('')).toBeNull();
    expect(parseInviteHash('#inksplat=short')).toBeNull();
    expect(parseInviteHash('#collab=abcdefghijklmnopqrstuv')).toBeNull();
  });
});

describe('invite links with trackers', () => {
  const token = 'abcdefghijklmnopqrstuv';

  it('has only the room token when the trackers are the defaults', () => {
    const link = inviteLink(DEFAULT_VIEWER_BASE, `inksplat=${token}`, {
      trackers: DEFAULT_TRACKERS,
    });
    expect(parseInvite(new URL(link).hash)).toEqual({ token });
  });

  it('carries only non-default trackers', () => {
    const custom = ['wss://tracker.example/announce', 'ws://127.0.0.1:9999'];
    const link = inviteLink(DEFAULT_VIEWER_BASE, `inksplat=${token}`, { trackers: custom });
    expect(parseInvite(new URL(link).hash)?.trackers).toEqual(custom);
    const plain = inviteLink(DEFAULT_VIEWER_BASE, `inksplat=${token}`, {
      trackers: DEFAULT_TRACKERS,
    });
    expect(parseInvite(new URL(plain).hash)?.trackers).toBeUndefined();
  });

  it('ignores a leftover presenter key and non-websocket trackers in a link', () => {
    const hash = `#inksplat=${token}&presenter=bad&tr=https%3A%2F%2Fx.example&tr=wss%3A%2F%2Fok.example`;
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
