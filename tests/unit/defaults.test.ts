// MIT License © 2026 Carlos Lopez
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIDEO,
  DEFAULT_VIEWER_BASE,
  UPLINK_WARNING_KBPS,
  VIDEO_LIMITS,
  cleanStage,
  cleanVideoSettings,
  inviteLink,
  parseInviteHash,
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
    expect(p.codecs[0]).toBe('video/VP9');
  });

  it('estimates the uplink of a star', () => {
    expect(uplinkKbps(10, DEFAULT_VIDEO)).toBe(6000);
    expect(uplinkKbps(10, DEFAULT_VIDEO)).toBeGreaterThan(UPLINK_WARNING_KBPS);
    expect(uplinkKbps(-3, DEFAULT_VIDEO)).toBe(0);
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
