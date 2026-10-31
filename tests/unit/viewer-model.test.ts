// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import type { Stage } from '@inksplat/defaults';
import {
  DEFAULT_ASPECT,
  boardAspect,
  endMessage,
  errorMessage,
  mayDraw,
  placeholder,
  progressMessage,
} from '../../viewer/src/model';

const stage = (over: Partial<Stage> = {}): Stage => ({
  aspect: 2,
  w: 1000,
  h: 500,
  fps: 3,
  state: 'live',
  drawing: true,
  ...over,
});

describe('messages', () => {
  it('says why a session ended', () => {
    expect(endMessage('host-ended')).toMatch(/ended/);
    expect(endMessage('host-gone')).toMatch(/left/);
    expect(endMessage('removed')).toMatch(/removed you/);
    expect(endMessage('locked')).toMatch(/locked/);
    expect(endMessage(undefined)).toBe('The session has ended.');
  });

  it('explains connection errors, with a fallback', () => {
    for (const reason of ['no-tracker', 'no-answer', 'ice-failed', 'no-webrtc', 'bad-token']) {
      expect(errorMessage(reason)).not.toBe(errorMessage('something-else'));
    }
    expect(errorMessage(undefined)).toMatch(/went wrong/);
  });

  it('describes the connection progress', () => {
    expect(progressMessage('tracker')).toMatch(/Looking/);
    expect(progressMessage('answer')).toMatch(/Connecting to the presenter/);
    expect(progressMessage(undefined)).toBe('Connecting…');
  });
});

describe('placeholder', () => {
  const ana = { owner: 'ana-1234', name: 'Ana', w: 640, h: 360 };

  it('waits for the active stream on a screen canvas until a frame arrives', () => {
    expect(placeholder(stage({ screen: ana }), false)).toMatch(/Waiting for the screen of Ana/);
    expect(placeholder(stage({ screen: ana }), true)).toBeNull();
    // Nothing shared: the screen is plain black.
    expect(placeholder(null, false)).toBeNull();
    expect(placeholder(stage(), false)).toBeNull();
    // A canvas with another background has nothing to wait for.
    expect(placeholder(stage({ screen: ana }), false, 1)).toBeNull();
    expect(placeholder(stage({ screen: ana, backgrounds: ['wall', 'screen'] }), false, 1)).toMatch(
      /Waiting/,
    );
  });

  it('shows the owner their own stream at once', () => {
    expect(placeholder(stage({ screen: ana }), false, 0, 'ana-1234')).toBeNull();
    expect(placeholder(stage({ screen: ana }), false, 0, 'bob-1234')).toMatch(/Waiting/);
  });

  it('says when the presenter ended, whatever the screen shows', () => {
    expect(placeholder(stage({ state: 'ended' }), true)).toMatch(/ended/);
  });
});

describe('boardAspect', () => {
  it("is the stage's fixed frame, else 16:9", () => {
    expect(boardAspect(stage({ aspect: 1.5 }))).toBe(1.5);
    expect(boardAspect(null)).toBe(DEFAULT_ASPECT);
    expect(boardAspect(stage({ aspect: 0 }))).toBe(DEFAULT_ASPECT);
    expect(DEFAULT_ASPECT).toBe(16 / 9);
  });
});

describe('mayDraw', () => {
  it('lets a viewer draw only while the presenter allows it', () => {
    expect(mayDraw(stage({ drawing: true }))).toBe(true);
    expect(mayDraw(stage({ drawing: false }))).toBe(false);
    expect(mayDraw(null)).toBe(false);
  });
});
