// @vitest-environment jsdom
// MIT License © 2026 Carlos Lopez
import { describe, expect, it } from 'vitest';
import { NOTE_SHAPES, createWhiteboard } from '@inkpad/collab-whiteboard';
import type { NoteItem, Whiteboard } from '@inkpad/collab-whiteboard';
import { TestRoom } from '../support/rooms';

function box(width: number, height: number): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: width });
  Object.defineProperty(el, 'clientHeight', { value: height });
  document.body.append(el);
  return el;
}

/** Units are CSS pixels: a pointer at (x, y) is at (x, y) on the board. */
const identity = {
  transform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  onChange: () => () => {},
};

// jsdom has no canvas: the text is measured by its length.
HTMLCanvasElement.prototype.getContext = () => null;

type Attached = NoteItem & { on?: string; u?: number; v?: number; dr?: number };

async function mount() {
  const room = new TestRoom();
  const host = await room.start();
  const wb = createWhiteboard(box(800, 600), {
    session: host,
    adapter: identity,
    random: () => 0.5,
  });
  const root = wb.element.shadowRoot!;
  const board = root.querySelector('svg')!;
  const pick = { id: null as string | null };
  Object.defineProperty(root, 'elementsFromPoint', {
    value: () => {
      const node = pick.id ? root.querySelector(`[data-id="${pick.id}"]`) : null;
      return node ? [node] : [];
    },
  });
  const fire = (type: string, x: number, y: number, init: MouseEventInit = {}) =>
    board.dispatchEvent(
      new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, ...init }),
    );
  const drag = (
    id: string,
    from: [number, number],
    to: [number, number],
    init: MouseEventInit = {},
  ) => {
    pick.id = id;
    fire('pointerdown', ...from, init);
    fire('pointermove', ...to, init);
    fire('pointerup', ...to, init);
  };
  const get = (id: string) => wb.items().find((i) => i.id === id) as Attached;
  const order = () =>
    [...root.querySelectorAll('.items > .item')].map((n) => n.getAttribute('data-id'));
  return {
    room,
    wb,
    root,
    drag,
    fire,
    pick,
    get,
    order,
    close: () => (wb.destroy(), room.close()),
  };
}
type Mounted = Awaited<ReturnType<typeof mount>>;

/** Two notes: a small one (A) up left, and a big one (B) in the middle. */
function setup(t: Mounted) {
  const a = t.wb.addNote({ x: 100, y: 100 }, 'A')!;
  const b = t.wb.addNote({ x: 400, y: 350 }, 'B')!;
  // Size A down to 100 and make both straight, so the numbers are easy.
  for (const [id, size] of [
    [a, 100],
    [b, 200],
  ] as const) {
    const inner = t.wb as unknown as {
      local(f: () => unknown): unknown;
      model: { change(i: string, f: object): unknown };
    };
    inner.local(() => inner.model.change(id, { size, rot: undefined }));
  }
  return { a, b };
}

describe('the grip that resizes a shape', () => {
  it('is inside every shape, where it can be hit, and not at the corner of its box', async () => {
    for (const shape of NOTE_SHAPES) {
      const t = await mount();
      try {
        const id = t.wb.addNote({ x: 300, y: 300 })!;
        const inner = t.wb as unknown as {
          local(f: () => unknown): unknown;
          model: { change(i: string, f: object): unknown };
        };
        inner.local(() =>
          inner.model.change(id, { shape: shape === 'square' ? undefined : shape, rot: undefined }),
        );
        const grip = t.root.querySelector('.note-item .grip circle')!;
        const gx = Number(grip.getAttribute('cx')) - 300;
        const gy = Number(grip.getAttribute('cy')) - 300;
        // Inside the outline, as each shape draws it (half the box is 90).
        const inside = {
          square: Math.max(Math.abs(gx), Math.abs(gy)) <= 90,
          rounded: Math.max(Math.abs(gx), Math.abs(gy)) <= 81,
          oval: (gx / 90) ** 2 + (gy / 90) ** 2 <= 1,
          diamond: Math.abs(gx) / 90 + Math.abs(gy) / 90 <= 1,
          hexagon: Math.abs(gy) <= 90 && Math.abs(gx) <= 90 - 32.4 * (Math.abs(gy) / 90),
        }[shape];
        expect(inside, `${shape} at ${gx}, ${gy}`).toBe(true);
        // Pressing on it resizes: the width grows with the pointer.
        t.drag(id, [300 + gx, 300 + gy], [300 + gx + 40, 300 + gy + 40]);
        expect((t.get(id) as NoteItem).size).toBeGreaterThan(190);
        expect(t.get(id).x - t.get(id).size / 2).toBeCloseTo(210, 0); // resized: the top left stays
        // Pressing at the corner of the box, outside the shape's grip, moves the note instead.
        const now = t.get(id);
        t.drag(
          id,
          [now.x + now.size / 2 - 3, now.y + (now.size * now.ratio) / 2 - 3],
          [now.x + now.size / 2 + 27, now.y + (now.size * now.ratio) / 2 + 27],
        );
        if (shape === 'square') {
          expect(t.get(id).size, shape).toBeGreaterThan(now.size); // the grip is close enough
        } else {
          expect(t.get(id).size, shape).toBe(now.size); // not a resize
        }
      } finally {
        t.close();
      }
    }
  });
});

describe('an element dragged by its pin onto another', () => {
  it('is attached to it, drawn on top of it, and goes with it when it is moved', async () => {
    const t = await mount();
    try {
      const { a, b } = setup(t);
      // Drawn in the order they were made; A's pin is at the top middle of A (100, ~51).
      expect(t.order()).toEqual([a, b]);
      t.drag(a, [100, 52], [420, 360]);
      // Dropped on B: A moved by (320, 308) and is attached.
      expect(t.get(a)).toMatchObject({ on: b, x: 420, y: 408 });
      expect(t.get(a).u).toBeCloseTo((420 - 400) / 200, 3);
      expect(t.get(a).v).toBeCloseTo((408 - 350) / 200, 3);
      expect(t.order()).toEqual([b, a]); // A is on top of B now

      // B moves (by its body, away from A): A goes along, keeping its place on it.
      t.drag(b, [330, 440], [380, 480]);
      expect(t.get(b)).toMatchObject({ x: 450, y: 390 });
      expect(t.get(a)).toMatchObject({ x: 470, y: 448 });
      expect(t.order()).toEqual([b, a]); // although B was changed after A

      // A moved by its body is still on B, at its new place there.
      t.drag(a, [470, 470], [500, 490]);
      expect(t.get(a)).toMatchObject({ on: b, x: 500, y: 468 });
      t.drag(b, [330, 440], [310, 440]);
      expect(t.get(a)).toMatchObject({ x: 480, y: 468 });
    } finally {
      t.close();
    }
  });

  it('outlines the pin being dragged, and what it would be attached to, not the element', async () => {
    const t = await mount();
    try {
      const { a, b } = setup(t);
      const node = (id: string) => t.root.querySelector(`.items > [data-id="${id}"]`)!;
      const ring = () => t.root.querySelector('.live .pin-ring');
      // Dragged by its pin: a ring is around the pin, which goes along; the note is not outlined.
      t.pick.id = a;
      t.fire('pointerdown', 100, 52);
      expect(ring()).not.toBeNull();
      expect(node(a).classList.contains('by-pin')).toBe(true);
      t.fire('pointermove', 200, 200); // over nothing
      expect(Number(ring()!.getAttribute('cx'))).toBeCloseTo(200, 0);
      expect(Number(ring()!.getAttribute('cy'))).toBeCloseTo(200, 0);
      expect(t.root.querySelector('.drop-target')).toBeNull();
      t.fire('pointermove', 420, 360); // over B: it is the one to be attached to
      expect(node(b).classList.contains('drop-target')).toBe(true);
      expect(node(a).classList.contains('drop-target')).toBe(false);
      t.fire('pointermove', 700, 80); // and away again
      expect(t.root.querySelector('.drop-target')).toBeNull();
      t.fire('pointermove', 420, 360);
      t.fire('pointerup', 420, 360);
      expect(ring()).toBeNull();
      expect(t.root.querySelector('.by-pin, .drop-target')).toBeNull();
      expect(t.get(a).on).toBe(b);

      // Dragged by its body: nothing of that.
      t.pick.id = a;
      t.fire('pointerdown', 420, 430);
      t.fire('pointermove', 450, 440);
      expect(ring()).toBeNull();
      expect(node(a).classList.contains('by-pin')).toBe(false);
      t.fire('pointerup', 450, 440);
    } finally {
      t.close();
    }
  });

  it('is detached when dragged by its pin onto nothing, and then stays when B moves', async () => {
    const t = await mount();
    try {
      const { a, b } = setup(t);
      t.drag(a, [100, 52], [420, 360]);
      expect(t.get(a).on).toBe(b);
      // A's pin is now at (420, ~359): drag it to the empty corner.
      t.drag(a, [420, 360], [700, 80]);
      expect(t.get(a)).toMatchObject({ x: 700 });
      expect(t.get(a).on).toBeUndefined();
      expect(t.get(a)).not.toHaveProperty('u');
      t.drag(b, [330, 440], [380, 480]);
      expect(t.get(a).x).toBeCloseTo(700, 0);
    } finally {
      t.close();
    }
  });

  it('turns and scales with what it is on, and chains of them follow', async () => {
    const t = await mount();
    try {
      const { a, b } = setup(t);
      const c = t.wb.addNote({ x: 700, y: 100 }, 'C')!;
      const inner = t.wb as unknown as {
        local(f: () => unknown): unknown;
        model: { change(i: string, f: object): unknown };
      };
      inner.local(() => inner.model.change(c, { size: 60, rot: undefined }));
      t.drag(a, [100, 52], [420, 360]); // A on B, at (420, 408)
      // C by its pin (60 wide: at the top middle, (700, 72)) onto A (box 370..470 by 358..458).
      t.drag(c, [700, 72], [430, 420]);
      expect(t.get(c)).toMatchObject({ on: a, x: 430, y: 448 });
      expect(t.order()).toEqual([b, a, c]);
      // B moves: A and then C go along.
      t.drag(b, [330, 440], [350, 460]);
      expect(t.get(b)).toMatchObject({ x: 420, y: 370 });
      expect(t.get(a)).toMatchObject({ x: 440, y: 428 });
      expect(t.get(c)).toMatchObject({ x: 450, y: 468 });
      // B is turned a quarter (Ctrl+drag about its centre): what is on it goes round with it.
      t.drag(b, [520, 370], [420, 470], { ctrlKey: true });
      expect(t.get(b).rot).toBeCloseTo(90, 0);
      expect(t.get(a).rot).toBeCloseTo(90, 0);
      expect(t.get(a).x).toBeCloseTo(420 - 58, 0); // (20, 58) from B's centre turned 90 degrees: (-58, 20)
      expect(t.get(a).y).toBeCloseTo(370 + 20, 0);
      expect(t.get(c).rot).toBeCloseTo(90, 0);
    } finally {
      t.close();
    }
  });

  it('is not attached to what is on it, nor does a locked one follow', async () => {
    const t = await mount();
    try {
      const { a, b } = setup(t);
      t.drag(a, [100, 52], [420, 360]); // A on B
      // Dragging B by its pin onto A would hold B up by A: it is refused (B stays free).
      const pinOfB = { x: t.get(b).x, y: t.get(b).y - 100 - 6 + 4 };
      t.drag(b, [pinOfB.x, pinOfB.y + 1], [425, 360]);
      expect(t.get(b).on).toBeUndefined();
      // A locked element stays where it is when what it is on moves.
      const inner = t.wb as unknown as {
        local(f: () => unknown): unknown;
        model: { change(i: string, f: object): unknown };
      };
      const x = t.get(a).x;
      inner.local(() => inner.model.change(a, { lock: 'all' }));
      t.drag(b, [330, 560], [360, 560]);
      expect(t.get(a).x).toBe(x);
    } finally {
      t.close();
    }
  });

  it('keeps its place through a saved board', async () => {
    const t = await mount();
    try {
      const { a, b } = setup(t);
      t.drag(a, [100, 52], [420, 360]);
      const saved = JSON.parse(JSON.stringify(await t.wb.saveBoard()));
      const room = new TestRoom();
      try {
        const host = await room.start();
        const next = createWhiteboard(box(800, 600), { session: host, adapter: identity });
        await next.loadBoard(saved);
        const items = next.items() as Attached[];
        const newA = items.find((i) => i.text === 'A')!;
        const newB = items.find((i) => i.text === 'B')!;
        expect(newA.on).toBe(newB.id);
        expect(newA.id).not.toBe(a);
        expect(newB.id).not.toBe(b);
        expect(newA.u).toBeCloseTo(0.1, 3);
        next.destroy();
      } finally {
        room.close();
      }
    } finally {
      t.close();
    }
  });
});

export type { Whiteboard };
