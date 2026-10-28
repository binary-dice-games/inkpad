// MIT License © 2026 Carlos Lopez
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  cleanIceServers,
  cleanSettings,
  cleanTrackers,
  cleanViewerBase,
  formatIceLines,
  parseIceLines,
} from '../../extension/src/settings';
import { IDLE, canCapture, checkTarget, transition } from '../../extension/src/state';
import type { ShareState } from '../../extension/src/state';

describe('settings', () => {
  it('gives the defaults for nothing or garbage', () => {
    expect(cleanSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings('x')).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values and replaces invalid ones field by field', () => {
    const s = cleanSettings({
      name: '  Ana \u0007 ',
      color: 'red',
      viewersMayDraw: false,
      viewerBase: 'ftp://nope',
      video: { fps: 99 },
    });
    expect(s.name).toBe('Ana');
    expect(s.color).toBe(DEFAULT_SETTINGS.color);
    expect(s.viewersMayDraw).toBe(false);
    expect(s.viewerBase).toBe(DEFAULT_SETTINGS.viewerBase);
    expect(s.video.fps).toBe(15);
  });

  it('truncates long names and defaults empty ones', () => {
    expect(cleanSettings({ name: 'x'.repeat(100) }).name).toHaveLength(40);
    expect(cleanSettings({ name: '   ' }).name).toBe(DEFAULT_SETTINGS.name);
  });

  it('accepts https viewer pages and localhost http, and drops the hash and query', () => {
    expect(cleanViewerBase('https://example.github.io/inkpad/?a=1#x')).toBe(
      'https://example.github.io/inkpad/',
    );
    expect(cleanViewerBase('http://localhost:8080/')).toBe('http://localhost:8080/');
    expect(cleanViewerBase('http://127.0.0.1:8080/x')).toBe('http://127.0.0.1:8080/x');
    expect(cleanViewerBase('http://example.com/')).toBeNull();
    expect(cleanViewerBase('javascript:alert(1)')).toBeNull();
    expect(cleanViewerBase(42)).toBeNull();
  });

  it('keeps only ws(s) trackers, once each, and allows an empty list', () => {
    expect(
      cleanTrackers(
        'wss://a.example\nhttps://b.example\n\nwss://a.example\nnot a url\nws://c.example',
      ),
    ).toEqual(['wss://a.example', 'ws://c.example']);
    expect(cleanSettings({ trackers: [] }).trackers).toEqual([]);
    expect(cleanSettings({ trackers: 5 }).trackers).toEqual(DEFAULT_SETTINGS.trackers);
    expect(cleanTrackers(Array.from({ length: 30 }, (_, i) => `wss://t${i}.example`))).toHaveLength(
      10,
    );
  });

  it('validates ICE servers', () => {
    expect(
      cleanIceServers([
        { urls: 'stun:stun.example:3478' },
        { urls: ['turn:t.example', 'http://bad'], username: 'u', credential: 'c' },
        { urls: 'http://bad' },
        'junk',
      ]),
    ).toEqual([
      { urls: 'stun:stun.example:3478' },
      { urls: 'turn:t.example', username: 'u', credential: 'c' },
    ]);
  });

  it('round-trips the text form of ICE servers', () => {
    const text = 'stun:stun.example:3478\nturn:t.example:3478 user secret';
    const servers = parseIceLines(text);
    expect(servers).toHaveLength(2);
    expect(formatIceLines(servers)).toBe(text);
    expect(parseIceLines('\n  \nnonsense')).toEqual([]);
  });
});

describe('share state machine', () => {
  const live: ShareState = { phase: 'live', tabId: 7 };

  it('goes idle -> starting -> live -> paused -> live -> ending -> idle', () => {
    let s: ShareState = { ...IDLE };
    s = transition(s, { type: 'start', tabId: 7 });
    expect(s).toEqual({ phase: 'starting', tabId: 7 });
    s = transition(s, { type: 'started' });
    expect(s.phase).toBe('live');
    s = transition(s, { type: 'pause' });
    expect(s.phase).toBe('paused');
    s = transition(s, { type: 'resume' });
    expect(s.phase).toBe('live');
    s = transition(s, { type: 'stop' });
    expect(s.phase).toBe('ending');
    s = transition(s, { type: 'stopped' });
    expect(s).toEqual(IDLE);
  });

  it('ignores events that do not apply', () => {
    expect(transition(IDLE, { type: 'pause' })).toEqual(IDLE);
    expect(transition(IDLE, { type: 'stop' })).toEqual(IDLE);
    expect(transition(IDLE, { type: 'started' })).toEqual(IDLE);
    expect(transition(live, { type: 'start', tabId: 9 })).toEqual(live);
    expect(transition(live, { type: 'resume' })).toEqual(live);
  });

  it('lets a failed start return to idle from any phase', () => {
    expect(transition({ phase: 'starting', tabId: 1 }, { type: 'stopped' })).toEqual(IDLE);
    expect(transition({ phase: 'starting', tabId: 1 }, { type: 'stop' }).phase).toBe('ending');
  });
});

describe('canCapture', () => {
  it('allows web pages and files', () => {
    expect(canCapture('https://example.com/a')).toBe(true);
    expect(canCapture('http://127.0.0.1:3000/')).toBe(true);
    expect(canCapture('file:///c:/a.html')).toBe(true);
  });

  it('refuses browser pages, the Web Store and nothing', () => {
    expect(canCapture('chrome://settings')).toBe(false);
    expect(canCapture('chrome-extension://abc/popup.html')).toBe(false);
    expect(canCapture('about:blank')).toBe(false);
    expect(canCapture('https://chromewebstore.google.com/detail/x')).toBe(false);
    expect(canCapture('https://chrome.google.com/webstore/detail/x')).toBe(false);
    expect(canCapture(undefined)).toBe(false);
    expect(canCapture('not a url')).toBe(false);
  });
});

describe('checkTarget', () => {
  const pages = {
    viewerBase: 'https://example.github.io/inkpad/',
    consoleBase: 'chrome-extension://abcdefgh/viewer.html',
  };

  it('lets a normal page through', () => {
    expect(checkTarget('https://example.com/a', pages)).toBeNull();
  });

  it('refuses the viewer and the console, with or without the hash', () => {
    expect(checkTarget('https://example.github.io/inkpad/#inkpad=abc', pages)?.reason).toBe(
      'console',
    );
    expect(checkTarget('chrome-extension://abcdefgh/viewer.html#inkpad=x', pages)?.reason).toBe(
      'console',
    );
    expect(checkTarget('https://example.github.io/inkpad/', pages)?.reason).toBe('console');
  });

  it('refuses pages the browser does not allow', () => {
    expect(checkTarget('chrome://settings', pages)?.reason).toBe('restricted');
    expect(checkTarget(undefined, pages)?.reason).toBe('restricted');
  });
});
