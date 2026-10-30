// @vitest-environment jsdom
// MIT License © 2026 Carlos Lopez
import { describe, expect, it } from 'vitest';
import { cleanItem, createWhiteboard } from '@inkpad/collab-whiteboard';
import type { NoteItem } from '@inkpad/collab-whiteboard';
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

function pointer(target: Element, type: string, x: number, y: number): void {
  target.dispatchEvent(
    new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }),
  );
}

function keydown(key: string, init: KeyboardEventInit = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

const base = { id: 'ana.1', author: 'ana', stamp: [1, 'ana'] as [number, string] };
const note = {
  ...base,
  kind: 'note',
  x: 100,
  y: 100,
  size: 180,
  ratio: 1,
  text: 'Hi',
  color: '#ffe9a8',
};

/** The parts of the board these tests look at. */
interface Inside {
  tool: string;
  style: { color: string };
}

describe('sticky note items', () => {
  it('keeps a good note, even an empty one, and nothing it should not', () => {
    expect(cleanItem(note)).toMatchObject({ kind: 'note', text: 'Hi', color: '#ffe9a8' });
    expect(cleanItem({ ...note, text: '', rot: 4 })).toMatchObject({ text: '', rot: 4 });
    expect(cleanItem({ ...note, extra: 1 })).not.toHaveProperty('extra');
    expect(cleanItem({ ...note, size: 10 })).toBeNull();
    expect(cleanItem({ ...note, size: 700 })).toBeNull();
    expect(cleanItem({ ...note, ratio: 9 })).toBeNull();
    expect(cleanItem({ ...note, color: 'red' })).toBeNull();
    expect(cleanItem({ ...note, text: 'x'.repeat(501) })).toBeNull();
    expect(cleanItem({ ...note, text: 5 })).toBeNull();
  });
});

// jsdom has no canvas: the text is measured by its length.
HTMLCanvasElement.prototype.getContext = () => null;

describe('sticky notes on the board', () => {
  async function mount() {
    const room = new TestRoom();
    const host = await room.start();
    const stage = box(800, 450);
    const wb = createWhiteboard(stage, { session: host, adapter: identity, random: () => 0.5 });
    const root = wb.element.shadowRoot!;
    const board = root.querySelector('svg')!;
    const node = () => root.querySelector('.item')!;
    // jsdom has no hit testing: the note is under the pointer.
    Object.defineProperty(root, 'elementsFromPoint', { value: () => [node()].filter(Boolean) });
    return { room, host, stage, wb, root, board, node };
  }

  it('is a tool after the eraser, before the colour', async () => {
    const t = await mount();
    try {
      keydown('6');
      expect((t.wb as unknown as Inside).tool).toBe('note');
      const color = (t.wb as unknown as Inside).style.color;
      keydown('9');
      expect((t.wb as unknown as Inside).tool).toBe('note');
      expect((t.wb as unknown as Inside).style.color).not.toBe(color);
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('is made with a click, written in a text box, and kept when it is left', async () => {
    const t = await mount();
    try {
      t.wb.setTool('note');
      pointer(t.board, 'pointerdown', 200, 150);
      pointer(t.board, 'pointerup', 200, 150);
      expect((t.wb as unknown as Inside).tool).toBe('pointer');
      expect(t.wb.items()).toMatchObject([{ kind: 'note', x: 200, y: 150, text: '', size: 180 }]);
      const ta = t.root.querySelector('textarea.sticky') as HTMLTextAreaElement;
      expect(ta).not.toBeNull();
      const text = 'Buy milk\nand a very long line of words that has to wrap around';
      ta.value = text;
      ta.dispatchEvent(new Event('blur'));
      expect(t.root.querySelector('textarea')).toBeNull();
      const item = t.wb.items()[0]!;
      expect(item).toMatchObject({ text });
      // The text is drawn in lines inside the paper, and the pin is there for what comes later.
      expect(t.node().querySelectorAll('tspan').length).toBeGreaterThan(2);
      expect(t.node().querySelector('.pin circle')).not.toBeNull();
      expect(t.node().querySelector('.pin')?.getAttribute('data-id')).toBe(item.id);
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('is edited by a click, and Escape drops the change', async () => {
    const t = await mount();
    try {
      const id = t.wb.addNote({ x: 100, y: 100 }, 'first')!;
      pointer(t.board, 'pointerdown', 100, 100);
      pointer(t.board, 'pointerup', 100, 100);
      const ta = t.root.querySelector('textarea.sticky') as HTMLTextAreaElement;
      expect(ta.value).toBe('first');
      ta.value = 'second';
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(t.wb.items()[0]).toMatchObject({ id, text: 'first' });

      pointer(t.board, 'pointerdown', 100, 100);
      pointer(t.board, 'pointerup', 100, 100);
      const again = t.root.querySelector('textarea.sticky') as HTMLTextAreaElement;
      again.value = 'third';
      again.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
      );
      expect(t.wb.items()[0]).toMatchObject({ text: 'third' });
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('moves when dragged and resizes from its corner, keeping the top left corner', async () => {
    const t = await mount();
    try {
      t.wb.addNote({ x: 100, y: 100 }, 'note');
      pointer(t.board, 'pointerdown', 100, 100);
      pointer(t.board, 'pointermove', 130, 140);
      pointer(t.board, 'pointerup', 130, 140);
      expect(t.wb.items()[0]).toMatchObject({ x: 130, y: 140, size: 180 });
      expect(t.root.querySelector('textarea')).toBeNull(); // a drag does not start editing

      // The bottom right corner is at (220, 230); the pointer takes it to (255, 245).
      pointer(t.board, 'pointerdown', 215, 225);
      pointer(t.board, 'pointermove', 255, 245);
      pointer(t.board, 'pointerup', 255, 245);
      const n = t.wb.items()[0] as NoteItem;
      expect(n).toMatchObject({ size: 215, ratio: 0.907 });
      expect(n.x - 215 / 2).toBeCloseTo(40, 0); // the top left corner stays at (40, 50)
      expect(n.y - 195 / 2).toBeCloseTo(50, 0);
      expect(t.root.querySelector('textarea')).toBeNull();
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('is removed by its owner with the right button', async () => {
    const t = await mount();
    try {
      t.wb.addNote({ x: 100, y: 100 }, 'bye');
      pointer(t.board, 'contextmenu', 100, 100);
      expect(t.wb.items()).toHaveLength(0);
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('is copied by others with a double click, and they cannot change it', async () => {
    const t = await mount();
    try {
      const copied: string[] = [];
      const ana = await t.room.join('Ana');
      await until(() => ana.host(), 'Ana reached the host');
      const anaBoard = createWhiteboard(box(800, 450), {
        session: ana,
        adapter: identity,
        copyText: async (text) => {
          copied.push(text);
          return true;
        },
      });
      t.wb.addNote({ x: 100, y: 100 }, 'Shared text\nsecond line');
      await until(() => anaBoard.items().length === 1, 'the note arrived');
      const root = anaBoard.element.shadowRoot!;
      Object.defineProperty(root, 'elementsFromPoint', {
        value: () => [root.querySelector('.item')].filter(Boolean),
      });
      const board = root.querySelector('svg')!;
      // Others see no resize grip, a click does not edit, a drag does not move it.
      expect(root.querySelector('.grip')).toBeNull();
      pointer(board, 'pointerdown', 100, 100);
      pointer(board, 'pointermove', 150, 150);
      pointer(board, 'pointerup', 150, 150);
      expect(anaBoard.items()[0]).toMatchObject({ x: 100, y: 100 });
      expect(root.querySelector('textarea')).toBeNull();
      pointer(board, 'dblclick', 100, 100);
      await until(() => copied.length === 1, 'the text was copied');
      expect(copied).toEqual(['Shared text\nsecond line']);
      await until(() => (root.textContent ?? '').includes('Note copied'), 'the message');
      anaBoard.destroy();
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });

  it('does nothing on a read-only board', async () => {
    const t = await mount();
    try {
      t.wb.readOnly = true;
      expect(t.wb.addNote()).toBeNull();
      expect(t.wb.items()).toHaveLength(0);
    } finally {
      t.wb.destroy();
      t.room.close();
    }
  });
});
