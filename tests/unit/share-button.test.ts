// @vitest-environment jsdom
// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import type { Stage } from '@inksplat/defaults';
import {
  buttonText,
  captureProblem,
  ownerStatus,
  statusText,
  wireShareButton,
} from '../../viewer/src/share-button';

const stage = (over: Partial<Stage> = {}): Stage => ({
  aspect: 16 / 9,
  w: 1280,
  h: 720,
  fps: 3,
  state: 'live',
  drawing: true,
  ...over,
});

describe('the share button', () => {
  it('tells the owner where their stream stands', () => {
    const screen = { owner: 'ana-1234', name: 'Ana', w: 1, h: 1 };
    expect(ownerStatus(stage(), 'ana-1234', false)).toBe('idle');
    expect(ownerStatus(stage(), 'ana-1234', true)).toBe('offered');
    expect(ownerStatus(stage({ preview: 'ana-1234' }), 'ana-1234', true)).toBe('previewed');
    expect(ownerStatus(stage({ screen }), 'ana-1234', true)).toBe('live');
    expect(ownerStatus(stage({ screen }), 'bob-1234', true)).toBe('offered');
    expect(ownerStatus(null, null, true)).toBe('idle');
    expect(statusText('idle', false)).toBe('');
    expect(statusText('offered', false)).toMatch(/presenter can show/);
    expect(statusText('offered', true)).toMatch(/ready to show/);
    expect(statusText('previewed', false)).toMatch(/looking at/);
    expect(statusText('live', true)).toMatch(/everybody/);
    expect(buttonText(false)).toBe('Share screen');
    expect(buttonText(true)).toBe('Stop sharing');
  });

  it('says why the picker gave nothing', () => {
    expect(captureProblem(new DOMException('no', 'NotAllowedError'))).toMatch(/cancelled/);
    expect(captureProblem(new Error('boom'))).toMatch(/boom/);
  });

  it('is hidden where the browser has no picker, and asks once before the first share', () => {
    const button = document.createElement('button');
    const notice = document.createElement('dialog');
    notice.innerHTML =
      '<button value="cancel">Cancel</button><button value="continue">Continue</button>';
    let shown = 0;
    notice.showModal = () => {
      shown += 1;
    };
    notice.close = () => {};
    localStorage.clear();
    wireShareButton({
      button,
      notice,
      onStart: () => {},
      onStop: () => {},
      toast: () => {},
    });
    expect(button.hidden).toBe(true); // jsdom has no getDisplayMedia
    expect(button.textContent).toBe('Share screen');
    button.click();
    expect(shown).toBe(1);
  });
});
