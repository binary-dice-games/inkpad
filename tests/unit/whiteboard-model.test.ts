// MIT License © 2026 Carlos Lopez
import { describe, expect, it } from 'vitest';
import {
  FRAME_UNITS,
  LIMITS,
  STICKERS,
  WhiteboardError,
  WhiteboardModel,
  cleanItem,
  drawingGate,
  letterbox,
  simplifyPoints,
} from '@inkpad/collab-whiteboard';
import type { Operation } from '@inkpad/collab-whiteboard';

const ink = (points = [0, 0, 10, 10]) => ({
  kind: 'ink',
  points,
  color: '#e5484d',
  width: 3,
});

describe('model convergence', () => {
  it('converges whatever the order and repetition of operations', () => {
    const a = new WhiteboardModel('peer-a');
    const b = new WhiteboardModel('peer-b');
    const ops: Operation[] = [
      a.add(ink()),
      b.add({ kind: 'sticker', x: 5, y: 5, size: 40, name: 'smile' }),
      a.add({ kind: 'text', x: 1, y: 1, size: 20, text: 'hi', color: '#1c2024' }),
    ];
    const firstId = (ops[0] as { item: { id: string } }).item.id;
    ops.push(b.change(firstId, { width: 9 }) ?? ops[0]!);
    ops.push(a.remove((ops[1] as { item: { id: string } }).item.id) ?? ops[0]!);

    const shuffled = (seed: number) => {
      const copy = [...ops, ...ops];
      let s = seed;
      for (let i = copy.length - 1; i > 0; i--) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        const j = s % (i + 1);
        [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      }
      return copy;
    };
    const states = [1, 2, 3, 4].map((seed) => {
      const m = new WhiteboardModel(`peer-${seed}`);
      shuffled(seed).forEach((op) => m.apply(op));
      return JSON.stringify(m.live());
    });
    expect(new Set(states).size).toBe(1);
  });

  it('removes every older item on clear, keeps newer ones', () => {
    const a = new WhiteboardModel('peer-a');
    const b = new WhiteboardModel('peer-b');
    const old = a.add(ink());
    b.apply(old);
    const clear = b.clear();
    const fresh = b.add(ink([1, 1, 2, 2]));
    a.apply(clear);
    a.apply(fresh);
    expect(a.live()).toHaveLength(1);
    expect(a.apply(old)).toEqual([]);
  });

  it('merges a snapshot into another model', () => {
    const a = new WhiteboardModel('peer-a');
    a.add(ink());
    a.add({ kind: 'sticker', x: 1, y: 1, size: 30, name: 'wink' });
    const b = new WhiteboardModel('peer-b');
    expect(b.merge(a.snapshot())).toHaveLength(2);
    expect(b.live()).toHaveLength(2);
    expect(b.merge(a.snapshot())).toHaveLength(0);
    expect(b.merge({ v: 2 })).toBeNull();
  });

  it('undoes and redoes as new operations', () => {
    const a = new WhiteboardModel('peer-a');
    const b = new WhiteboardModel('peer-b');
    const add = a.add(ink());
    b.apply(add);
    const undo = a.undo()!;
    b.apply(undo);
    expect(b.live()).toHaveLength(0);
    b.apply(a.redo()!);
    expect(b.live()).toHaveLength(1);
  });

  it('enforces the item limit', () => {
    const a = new WhiteboardModel('peer-a');
    for (let i = 0; i < LIMITS.items; i++) {
      a.add({ kind: 'sticker', x: 0, y: 0, size: 10, name: 'check' });
    }
    expect(() => a.add(ink())).toThrow(WhiteboardError);
  });
});

describe('validation', () => {
  const base = { id: 'p.1', author: 'p', stamp: [1, 'p'] };

  it('keeps only known fields', () => {
    const item = cleanItem({
      ...base,
      kind: 'sticker',
      x: 1,
      y: 2,
      size: 30,
      name: 'smile',
      evil: '<script>',
    });
    expect(item).toEqual({ ...base, kind: 'sticker', x: 1, y: 2, size: 30, name: 'smile' });
  });

  it('rejects malformed items', () => {
    expect(cleanItem({ ...base, kind: 'ink', points: [1], color: '#000000', width: 2 })).toBeNull();
    expect(
      cleanItem({ ...base, kind: 'ink', points: [0, 0, 1, 1], color: 'red', width: 2 }),
    ).toBeNull();
    expect(
      cleanItem({
        ...base,
        kind: 'text',
        x: 0,
        y: 0,
        size: 20,
        text: 'x'.repeat(501),
        color: '#000000',
      }),
    ).toBeNull();
    expect(cleanItem({ ...base, kind: 'sticker', x: 0, y: 0, size: 20, name: '../x' })).toBeNull();
    expect(cleanItem({ ...base, kind: 'other' })).toBeNull();
    expect(cleanItem(null)).toBeNull();
  });

  it('simplifies a straight run to its ends', () => {
    expect(simplifyPoints([0, 0, 5, 5.01, 10, 10])).toEqual([0, 0, 10, 10]);
  });
});

describe('stickers', () => {
  it('has the emoticon faces next to the symbols', () => {
    for (const name of [
      'smile',
      'laugh',
      'wink',
      'sad',
      'surprised',
      'angry',
      'cool',
      'thinking',
    ]) {
      expect(STICKERS[name]).toContain('<circle');
    }
    for (const name of [
      'check',
      'cross',
      'question',
      'star',
      'heart',
      'thumbs-up',
      'warning',
      'arrow',
    ]) {
      expect(STICKERS[name]).toBeTruthy();
    }
  });
});

describe('letterbox (board units)', () => {
  it('fits a wide frame in a tall box', () => {
    expect(letterbox(800, 800, 2)).toEqual({ x: 0, y: 200, width: 800, height: 400 });
  });

  it('fits a tall frame in a wide box', () => {
    expect(letterbox(1000, 500, 0.5)).toEqual({ x: 375, y: 0, width: 250, height: 500 });
  });

  it('maps board units to the frame at several aspects', () => {
    for (const aspect of [16 / 9, 4 / 3, 1, 9 / 16]) {
      const r = letterbox(1280, 720, aspect);
      const scale = r.width / FRAME_UNITS;
      // the frame's far corner in board units is (1000, 1000 / aspect)
      expect(FRAME_UNITS * scale).toBeCloseTo(r.width);
      expect((FRAME_UNITS / aspect) * scale).toBeCloseTo(r.height);
    }
  });

  it('falls back to the whole box for a bad aspect', () => {
    expect(letterbox(300, 200, 0)).toEqual({ x: 0, y: 0, width: 300, height: 200 });
    expect(letterbox(300, 200, Number.NaN)).toEqual({ x: 0, y: 0, width: 300, height: 200 });
  });
});

describe('drawingGate', () => {
  const op = { t: 'op', op: { t: 'clear', stamp: [1, 'g'] } };

  it('passes other channels and cursors always', () => {
    const gate = drawingGate(() => false);
    expect(gate('stage', { anything: 1 }, 'g')).toBe(true);
    expect(gate('wb', { t: 'cur', x: 1, y: 1 }, 'g')).toBe(true);
  });

  it('drops ops, ink and non-empty snapshots while drawing is off', () => {
    const gate = drawingGate(() => false);
    expect(gate('wb', op, 'g')).toBe(false);
    expect(gate('wb', { t: 'ink', id: 'x' }, 'g')).toBe(false);
    const full = new WhiteboardModel('g');
    full.add(ink());
    expect(gate('wb', { t: 'sync', snapshot: full.snapshot() }, 'g')).toBe(false);
    expect(
      gate('wb', { t: 'sync', want: true, snapshot: new WhiteboardModel('g').snapshot() }, 'g'),
    ).toBe(true);
  });

  it('passes ops while drawing is on, up to the rate limit per peer', () => {
    let now = 0;
    const gate = drawingGate(() => true, { opsPerSecond: 5, now: () => now });
    const results = Array.from({ length: 8 }, () => gate('wb', op, 'g'));
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(gate('wb', op, 'other')).toBe(true);
    now += 1000;
    expect(gate('wb', op, 'g')).toBe(true);
  });
});

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('images and turning', () => {
  it('keeps a well formed image and its turn, drops a bad one', () => {
    const image = {
      id: 'a.1',
      author: 'a',
      stamp: [1, 'a'],
      kind: 'image',
      x: 10,
      y: 20,
      size: 200,
      ratio: 0.5,
      data: PNG,
      rot: 45,
    };
    expect(cleanItem(image)).toEqual(image);
    expect(cleanItem({ ...image, data: 'https://example.com/x.png' })).toBeNull();
    expect(cleanItem({ ...image, data: 'data:image/svg+xml;base64,AAAA' })).toBeNull();
    expect(cleanItem({ ...image, data: PNG + 'A'.repeat(LIMITS.imageChars) })).toBeNull();
    expect(cleanItem({ ...image, ratio: 0 })).toBeNull();
    expect(cleanItem({ ...image, rot: 'x' })).not.toHaveProperty('rot');
  });

  it('turns a sticker and forgets a zero turn', () => {
    const sticker = {
      id: 'a.1',
      author: 'a',
      stamp: [1, 'a'],
      kind: 'sticker',
      x: 1,
      y: 2,
      size: 30,
      name: 'star',
    };
    expect(cleanItem({ ...sticker, rot: -90 })).toMatchObject({ rot: -90 });
    expect(cleanItem({ ...sticker, rot: 0 })).not.toHaveProperty('rot');
    expect(cleanItem({ ...sticker, rot: 999 })).not.toHaveProperty('rot');
  });

  it('limits the images on the board', () => {
    const m = new WhiteboardModel('peer-a');
    const image = { kind: 'image', x: 0, y: 0, size: 50, ratio: 1, data: PNG };
    for (let i = 0; i < LIMITS.images; i++) {
      m.add(image);
    }
    expect(() => m.add(image)).toThrow(WhiteboardError);
    expect(() => m.add(ink())).not.toThrow();
  });
});

describe('gate for avatars and turns', () => {
  const gate = drawingGate(() => false);
  it('lets avatars and turn requests through even while drawing is locked', () => {
    expect(gate('wb', { t: 'avatar', data: PNG }, 'g')).toBe(true);
    expect(gate('wb', { t: 'avatar', data: '' }, 'g')).toBe(true);
    expect(gate('wb', { t: 'turn', op: 'join' }, 'g')).toBe(true);
    expect(gate('wb', { t: 'turn', op: 'leave' }, 'g')).toBe(true);
  });

  it('refuses bad avatars, other turn requests and a viewer speaking for the host', () => {
    expect(gate('wb', { t: 'avatar', data: 'javascript:alert(1)' }, 'g')).toBe(false);
    expect(gate('wb', { t: 'avatar', data: PNG, of: 'someone' }, 'g')).toBe(false);
    expect(gate('wb', { t: 'turn', op: 'kick' }, 'g')).toBe(false);
    expect(drawingGate(() => true)('wb', { t: 'queue', ids: ['g'] }, 'g')).toBe(false);
    expect(gate('wb', { t: 'queue', ids: ['g'] }, 'g')).toBe(false);
  });
});
