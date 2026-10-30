// @vitest-environment jsdom
// MIT License © 2026 Carlos Lopez
import { describe, expect, it } from 'vitest';
import { PAGES, createWhiteboard, drawingGate } from '@inksplat/collab-whiteboard';
import type { Whiteboard } from '@inksplat/collab-whiteboard';
import { TestRoom } from '../support/rooms';
import { until } from '../support/wait';

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

interface Inner {
  lastPoint: { x: number; y: number } | null;
  sendCursorAgain(): void;
}

async function mount() {
  const room = new TestRoom();
  const host = await room.start();
  const ana = createWhiteboard(box(800, 450), { session: host, adapter: identity });
  const guest = await room.join('Ben');
  await until(() => guest.host(), 'Ben reached the host');
  const ben = createWhiteboard(box(800, 450), { session: guest, adapter: identity });
  const dots = (wb: Whiteboard) => [
    ...wb.element.shadowRoot!.querySelectorAll<HTMLButtonElement>('.pages button'),
  ];
  const badge = (wb: Whiteboard, n: number) =>
    dots(wb)[n]!.parentElement!.querySelector('.n')?.textContent ?? '';
  const close = () => {
    ana.destroy();
    ben.destroy();
    room.close();
  };
  return { ana, ben, dots, badge, close };
}

describe('canvases', () => {
  it('keeps what is put on each canvas on it', async () => {
    const t = await mount();
    try {
      expect(PAGES).toBe(5);
      const first = t.ana.addNote({ x: 100, y: 100 }, 'first')!;
      t.ana.setPage(2);
      expect(t.ana.currentPage()).toBe(2);
      expect(t.ana.element.shadowRoot!.querySelectorAll('.note-item')).toHaveLength(0);
      const second = t.ana.addNote({ x: 200, y: 200 }, 'second')!;
      const items = t.ana.items();
      expect(items.find((i) => i.id === first)).not.toHaveProperty('page');
      expect(items.find((i) => i.id === second)).toMatchObject({ page: 2 });
      expect(t.ana.element.shadowRoot!.querySelectorAll('.note-item')).toHaveLength(1);
      t.ana.setPage(0);
      expect(t.ana.element.shadowRoot!.querySelectorAll('.note-item')).toHaveLength(1);
      expect(t.ana.element.shadowRoot!.querySelector('.note-item text')?.textContent).toBe('first');
      t.ana.setPage(9); // there are only five
      t.ana.setPage(-1);
      expect(t.ana.currentPage()).toBe(0);
    } finally {
      t.close();
    }
  });

  it('is chosen by each person, who sees how many are on each canvas', async () => {
    const t = await mount();
    try {
      expect(t.dots(t.ana)).toHaveLength(5);
      await until(() => t.ana.pageCounts()[0] === 2, 'both are on the first canvas');
      expect(t.badge(t.ana, 0)).toBe('2');
      t.ben.setPage(3);
      await until(() => t.ana.pageCounts()[3] === 1, 'Ana saw Ben move');
      expect(t.ana.currentPage()).toBe(0); // hers did not change
      expect(t.ana.pageCounts()).toEqual([1, 0, 0, 1, 0]);
      expect(t.badge(t.ana, 3)).toBe('1');
      expect(t.badge(t.ana, 1)).toBe(''); // nobody there: no number
      expect(t.dots(t.ana)[3]!.getAttribute('aria-label')).toBe('Canvas 4, 1 here');
      expect(t.dots(t.ana)[0]!.getAttribute('aria-current')).toBe('true');
      expect(t.dots(t.ben)[3]!.getAttribute('aria-current')).toBe('true');
      // A click on a button goes there, and Ana is told of it too.
      t.dots(t.ana)[3]!.click();
      expect(t.ana.currentPage()).toBe(3);
      await until(() => t.ben.pageCounts()[3] === 2, 'Ben saw Ana come');
    } finally {
      t.close();
    }
  });

  it('shows the work and the cursors of whoever is on the same canvas only', async () => {
    const t = await mount();
    try {
      const cursors = () =>
        [...t.ana.element.shadowRoot!.querySelectorAll<HTMLElement>('.cursor')].filter(
          (c) => !c.hidden,
        );
      const point = (wb: Whiteboard) => {
        const inner = wb as unknown as Inner;
        inner.lastPoint = { x: 50, y: 60 };
        inner.sendCursorAgain();
      };
      point(t.ben);
      await until(() => cursors().length === 1, "Ben's cursor shows: same canvas");
      t.ben.setPage(1);
      point(t.ben);
      await until(() => t.ana.pageCounts()[1] === 1, 'Ana saw Ben leave');
      expect(cursors()).toHaveLength(0);
      // What he draws there does not reach her canvas, but is kept for it.
      t.ben.addNote({ x: 300, y: 300 }, 'over here');
      await until(() => t.ana.items().length === 1, 'the note arrived');
      expect(t.ana.element.shadowRoot!.querySelectorAll('.note-item')).toHaveLength(0);
      t.ana.setPage(1);
      expect(t.ana.element.shadowRoot!.querySelectorAll('.note-item')).toHaveLength(1);
      point(t.ben);
      await until(() => cursors().length === 1, 'they meet again');
    } finally {
      t.close();
    }
  });

  it('clears only the canvas it is on, and its drawings only', async () => {
    const t = await mount();
    try {
      t.ana.addNote({ x: 100, y: 100 }, 'one');
      t.ana.setPage(1);
      t.ana.addNote({ x: 100, y: 100 }, 'two');
      t.ana.addPin({ x: 400, y: 300 });
      t.ana.clear();
      expect(t.ana.items().map((i) => i.page ?? 0)).toEqual([0]);
      await until(() => t.ben.items().length === 1, 'Ben has only the first canvas now');
      t.ana.setPage(0);
      t.ana.clear(); // nothing is anywhere else: the whole board
      expect(t.ana.items()).toHaveLength(0);
    } finally {
      t.close();
    }
  });

  it('is saved with every canvas and loaded back onto the canvas it came from', async () => {
    const t = await mount();
    try {
      t.ana.addNote({ x: 100, y: 100 }, 'one');
      t.ana.setPage(4);
      const b = t.ana.addNote({ x: 100, y: 100 }, 'five')!;
      const a = t.ana.addPin({ x: 50, y: 50 })!;
      t.ana.addArrow(a, b);
      const saved = JSON.parse(JSON.stringify(await t.ana.saveBoard()));
      expect(saved.items.map((i: { page?: number }) => i.page ?? 0).sort()).toEqual([0, 4, 4, 4]);
      // The other canvases are kept when one is cleared; loading adds a second copy of every canvas.
      t.ana.setPage(0);
      t.ana.clear();
      expect(t.ana.items()).toHaveLength(3);
      t.ana.setPage(2);
      await t.ana.loadBoard(saved);
      expect(
        t.ana
          .items()
          .map((i) => i.page ?? 0)
          .sort(),
      ).toEqual([0, 4, 4, 4, 4, 4, 4]);
      // The thread still joins the two pins on the canvas they were saved on.
      t.ana.setPage(4);
      expect(t.ana.element.shadowRoot!.querySelectorAll('.arrow-item')).toHaveLength(2);
      expect(t.ana.element.shadowRoot!.querySelectorAll('.note-item')).toHaveLength(2);
    } finally {
      t.close();
    }
  });

  it('lets a guest without the turn move between canvases', () => {
    const gate = drawingGate(() => false);
    expect(gate('wb', { t: 'pg', n: 2 }, 'g')).toBe(true);
    expect(gate('wb', { t: 'pg', n: 7 }, 'g')).toBe(false);
    expect(gate('wb', { t: 'pg', n: 1, of: 'someone' }, 'g')).toBe(false);
  });

  it('exports only the canvas that is shown', async () => {
    const t = await mount();
    try {
      t.ana.addNote({ x: 100, y: 100 }, 'on the first');
      t.ana.setPage(1);
      expect(t.ana.toSvg()).not.toContain('on the first');
      expect(t.ana.contentBounds()).toBeNull();
      t.ana.setPage(0);
      expect(t.ana.toSvg()).toContain('on the first');
    } finally {
      t.close();
    }
  });
});
