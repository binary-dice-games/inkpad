// MIT License © 2026 Carlos Lopez
import { describe, expect, it } from 'vitest';
import { fitScale, surfaceWarning } from '../../viewer/src/display-capture';

describe('fitScale', () => {
  it('never upscales a frame that fits', () => {
    expect(fitScale(1280, 720, 3840, 2160)).toBe(1);
    expect(fitScale(3840, 2160, 3840, 2160)).toBe(1);
  });

  it('reduces by the tighter side', () => {
    expect(fitScale(7680, 4320, 3840, 2160)).toBe(2);
    expect(fitScale(3840, 2160, 1920, 2160)).toBe(2);
    expect(fitScale(1920, 1080, 960, 1080)).toBe(2);
  });

  it('returns 1 for an unknown size', () => {
    expect(fitScale(0, 0, 1920, 1080)).toBe(1);
    expect(fitScale(Number.NaN, 100, 1920, 1080)).toBe(1);
  });
});

describe('surfaceWarning', () => {
  it('warns only for a whole screen', () => {
    expect(surfaceWarning('monitor')).toMatch(/whole screen/);
    expect(surfaceWarning('window')).toBeNull();
    expect(surfaceWarning('browser')).toBeNull();
    expect(surfaceWarning('unknown')).toBeNull();
  });
});
