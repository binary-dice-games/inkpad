// @vitest-environment jsdom
// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import { qrModules, qrSvg } from '../../viewer/src/qr';

const link = 'https://binary-dice-games.github.io/inksplat/#inksplat=AbCdEfGhIjKlMnOpQrStUv';

describe('QR code of the viewer link', () => {
  it('makes a square code with the three finder patterns of a QR code', () => {
    const m = qrModules(link);
    const n = m.length;
    expect(n).toBeGreaterThanOrEqual(21);
    expect((n - 17) % 4).toBe(0); // 17 + 4 * version
    expect(m.every((row) => row.length === n)).toBe(true);
    // A finder pattern: a dark ring, a light ring, a dark 3 x 3 centre.
    for (const [r0, c0] of [
      [0, 0],
      [0, n - 7],
      [n - 7, 0],
    ] as const) {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
          expect(m[r0 + r]![c0 + c], `${r0},${c0} ${r},${c}`).toBe(ring !== 2);
        }
      }
    }
  });

  it('is the same for the same link, and bigger for a longer one', () => {
    expect(qrModules(link)).toEqual(qrModules(link));
    const long = `${link}&tr=wss://tracker.one.example&tr=wss://tracker.two.example&tr=wss://tracker.three.example`;
    expect(qrModules(long).length).toBeGreaterThan(qrModules(link).length);
  });

  it('refuses text that does not fit', () => {
    expect(() => qrModules('x'.repeat(5000))).toThrow();
  });

  it('draws black on white with a quiet zone, whatever the theme', () => {
    const m = qrModules(link);
    const svg = qrSvg(m);
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${m.length + 8} ${m.length + 8}`);
    expect(svg.querySelector('rect')?.getAttribute('fill')).toBe('#ffffff');
    const path = svg.querySelector('path')!;
    expect(path.getAttribute('fill')).toBe('#000000');
    const dark = m.flat().filter(Boolean).length;
    expect((path.getAttribute('d')!.match(/M/g) ?? []).length).toBe(dark);
  });
});
