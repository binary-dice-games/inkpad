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
  it('waits for the video until a frame arrives', () => {
    expect(placeholder(null, false)).toMatch(/Waiting/);
    expect(placeholder(stage(), false)).toMatch(/Waiting/);
    expect(placeholder(stage({ video: false }), false)).toBeNull(); // a board has no video to wait for
    expect(placeholder(stage(), true)).toBeNull();
    // A canvas with a background instead of the video has nothing to wait for either.
    expect(placeholder(stage(), false, 1)).toBeNull();
    expect(placeholder(stage({ state: 'paused' }), true, 1)).toBeNull();
    expect(placeholder(stage({ backgrounds: ['wall', 'video'] }), false, 1)).toMatch(/Waiting/);
  });

  it('says when the presenter paused or ended, whatever the video shows', () => {
    expect(placeholder(stage({ state: 'paused' }), true)).toMatch(/paused/);
    expect(placeholder(stage({ state: 'ended' }), true)).toMatch(/ended/);
  });
});

describe('boardAspect', () => {
  it('prefers the video, then the stage, then the default', () => {
    expect(boardAspect({ width: 1000, height: 500 }, stage({ aspect: 1 }))).toBe(2);
    expect(boardAspect({ width: 0, height: 0 }, stage({ aspect: 1.5 }))).toBe(1.5);
    expect(boardAspect({ width: 0, height: 0 }, null)).toBe(DEFAULT_ASPECT);
    expect(boardAspect({ width: 0, height: 0 }, stage({ aspect: 0 }))).toBe(DEFAULT_ASPECT);
  });
});

describe('mayDraw', () => {
  it('lets a viewer draw only while the presenter allows it', () => {
    expect(mayDraw(stage({ drawing: true }))).toBe(true);
    expect(mayDraw(stage({ drawing: false }))).toBe(false);
    expect(mayDraw(null)).toBe(false);
  });
});
