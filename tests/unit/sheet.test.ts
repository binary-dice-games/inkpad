// @vitest-environment jsdom
// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { BACKGROUNDS } from '@inksplat/defaults';
import type { Stage } from '@inksplat/defaults';
import { BACKGROUND_STYLES, showSheet } from '../../viewer/src/sheet';

const stage = (over: Partial<Stage> = {}): Stage => ({
  aspect: 2,
  w: 1000,
  h: 500,
  fps: 3,
  state: 'live',
  drawing: true,
  ...over,
});

function parts() {
  const box = document.createElement('div');
  Object.defineProperty(box, 'clientWidth', { value: 800 });
  Object.defineProperty(box, 'clientHeight', { value: 800 });
  const video = document.createElement('video');
  const page = document.createElement('div');
  page.hidden = true;
  return { box, video, page };
}

describe('the sheet of a canvas without video', () => {
  it('has a style for every background', () => {
    for (const name of BACKGROUNDS) {
      expect(BACKGROUND_STYLES[name].background).toContain('#');
      expect(BACKGROUND_STYLES[name].label).not.toBe('');
    }
  });

  it('gives the wall and the cork a lit rough surface, and the cork a frame', () => {
    for (const name of ['wall', 'cork'] as const) {
      const style = BACKGROUND_STYLES[name];
      expect(style.blend).toContain('multiply');
      expect(style.shadow).toContain('inset');
    }
    expect(BACKGROUND_STYLES.cork.border).toContain('solid');
  });

  it('shows the video on the canvases that show it (canvas 1 unless chosen otherwise)', () => {
    const p = parts();
    showSheet(p, stage(), 2);
    expect(p.video.hidden).toBe(false);
    expect(p.page.hidden).toBe(true);
    showSheet(p, null, 2);
    expect(p.page.hidden).toBe(true);
    // Canvas 2 shows the whiteboard by default, over the video's own aspect.
    showSheet(p, stage(), 2, 1);
    expect(p.video.hidden).toBe(true);
    expect(p.page.hidden).toBe(false);
    expect(p.page.style.border).toContain('rgb(185, 190, 198)');
    showSheet(p, stage({ backgrounds: ['cork', 'video'] }), 2, 1);
    expect(p.video.hidden).toBe(false);
    expect(p.page.hidden).toBe(true);
    showSheet(p, stage({ backgrounds: ['cork', 'video'] }), 2, 0);
    expect(p.page.style.border).toContain('rgb(139, 94, 52)');
  });

  it('shows a letterboxed sheet with the background instead of the video', () => {
    const p = parts();
    showSheet(p, stage({ video: false, backgrounds: ['blackboard'] }), 2);
    expect(p.video.hidden).toBe(true);
    expect(p.page.hidden).toBe(false);
    expect(p.page.style.width).toBe('800px');
    expect(p.page.style.height).toBe('400px');
    expect(p.page.style.top).toBe('200px');
    expect(p.page.style.border).toContain('solid');

    // No background said: the default, a whiteboard in its frame.
    showSheet(p, stage({ video: false }), 2);
    expect(p.page.style.border).toContain('rgb(185, 190, 198)');
    showSheet(p, stage({ video: false, backgrounds: ['wall', 'wall', 'cork'] }), 2, 2);
    expect(p.page.style.border).toContain('rgb(139, 94, 52)');
  });
});
