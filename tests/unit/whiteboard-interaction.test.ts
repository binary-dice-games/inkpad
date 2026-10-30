// @vitest-environment jsdom
// MIT License © 2026 Carlos Lopez
import { describe, expect, it } from 'vitest';
import { createWhiteboard, frameAdapter } from '@inkpad/collab-whiteboard';
import { TestRoom } from '../support/rooms';
import { settle, until } from '../support/wait';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

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

function keydown(key: string, init: KeyboardEventInit = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

function pointer(
  target: Element,
  type: string,
  x: number,
  y: number,
  init: MouseEventInit = {},
): void {
  target.dispatchEvent(
    new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, ...init }),
  );
}

/** The parts of a board the tests look into. */
interface Inside {
  style: { color: string; width: number; size: number; sticker: string };
  tool: string;
}

const sticker = (author: string, id = `${author}.1`) => ({
  id,
  author,
  stamp: [1, author],
  kind: 'sticker',
  x: 100,
  y: 100,
  size: 40,
  name: 'star',
});

const snapshot = (items: unknown[]) => ({ v: 1, clock: 5, clear: [0, ''], items });

describe('frame adapter zoom', () => {
  it('zooms about the pointer, keeps the picture and the drawings together, and resets', () => {
    const stage = box(800, 400);
    const video = document.createElement('video');
    const adapter = frameAdapter(stage, () => 2, video);
    let calls = 0;
    adapter.onChange(() => (calls += 1));

    // The point (200, 100) of the stage stays where it is, with the frame doubled.
    adapter.zoomAt(200, 100, 2);
    expect(adapter.view()).toEqual({ scale: 2, x: -200, y: -100 });
    expect(adapter.transform()).toMatchObject({ a: 1.6, e: -200, f: -100 });
    expect(video.style.transform).toBe('translate(-200px, -100px) scale(2)');
    expect(adapter.zoomed()).toBe(true);
    expect(calls).toBe(1);

    // Never beyond the edges of the picture, nor past the zoom limits.
    adapter.panBy(5000, 5000);
    expect(adapter.view()).toMatchObject({ x: 0, y: 0 });
    adapter.zoomAt(0, 0, 100);
    expect(adapter.view().scale).toBe(8);
    adapter.zoomAt(0, 0, 0.0001);
    expect(adapter.view()).toEqual({ scale: 1, x: 0, y: 0 });
    expect(video.style.transform).toBe('');

    adapter.zoomAt(100, 100, 3);
    adapter.resetView();
    expect(adapter.zoomed()).toBe(false);
  });

  it('is driven by the wheel and by the 0 key', async () => {
    const room = new TestRoom();
    try {
      const host = await room.start();
      const stage = box(800, 450);
      const adapter = frameAdapter(stage, () => 16 / 9);
      const wb = createWhiteboard(stage, { session: host, adapter });
      const wheel = new WheelEvent('wheel', { deltaY: -500, cancelable: true, bubbles: true });
      stage.dispatchEvent(wheel);
      expect(wheel.defaultPrevented).toBe(true);
      expect(adapter.zoomed()).toBe(true);
      keydown('0');
      expect(adapter.zoomed()).toBe(false);
      wb.destroy();
    } finally {
      room.close();
    }
  });
});

describe('numbered tools', () => {
  it('selects with the number and goes through the options when pressed again', async () => {
    const room = new TestRoom();
    try {
      const host = await room.start();
      const wb = createWhiteboard(box(800, 450), { session: host });
      const inside = wb as unknown as Inside;
      expect(inside.tool).toBe('pointer');

      keydown('2');
      expect(inside.tool).toBe('pen');
      expect(inside.style.width).toBe(4); // normal
      keydown('2');
      expect(inside.style.width).toBe(8); // thick
      keydown('2');
      expect(inside.style.width).toBe(2); // thin
      keydown('2');
      expect(inside.style.width).toBe(4);

      keydown('3');
      expect(inside.tool).toBe('text');
      expect(inside.style.size).toBe(28);
      keydown('3');
      expect(inside.style.size).toBe(44);
      keydown('3');
      expect(inside.style.size).toBe(18);

      keydown('4');
      expect(inside.tool).toBe('sticker');
      const first = inside.style.sticker;
      keydown('4');
      expect(inside.style.sticker).not.toBe(first);

      // The colour is the last number and keeps the tool.
      const before = inside.style.color;
      keydown('7');
      expect(inside.tool).toBe('sticker');
      expect(inside.style.color).not.toBe(before);

      // Pressing it on goes through every colour, white last, and round again.
      const seen = new Set([before, inside.style.color]);
      for (let i = 0; i < 7; i++) {
        keydown('7');
        seen.add(inside.style.color);
      }
      expect(seen.size).toBe(8);
      expect(seen.has('#ffffff')).toBe(true);
      expect(wb.element.shadowRoot?.querySelectorAll('.pop button')).toHaveLength(0); // closed

      keydown('5');
      expect(inside.tool).toBe('eraser');
      keydown('1');
      expect(inside.tool).toBe('pointer');
      keydown('9'); // no such tool
      expect(inside.tool).toBe('pointer');
      keydown('2', { ctrlKey: true }); // a browser shortcut, not ours
      expect(inside.tool).toBe('pointer');

      // The toolbar shows the number.
      const buttons = [...(wb.element.shadowRoot?.querySelectorAll('.toolbar button') ?? [])];
      expect(buttons[1]?.getAttribute('title')).toBe('Pen (2)');
      expect(buttons[1]?.getAttribute('aria-keyshortcuts')).toBe('2');
      wb.destroy();
    } finally {
      room.close();
    }
  });

  it('ignores the numbers while typing in a field and when read-only', async () => {
    const room = new TestRoom();
    try {
      const host = await room.start();
      const wb = createWhiteboard(box(800, 450), { session: host, readOnly: true });
      const inside = wb as unknown as Inside;
      const field = document.createElement('input');
      document.body.append(field);
      keydown('2');
      expect(inside.tool).toBe('pointer'); // read-only
      wb.readOnly = false;
      field.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
      expect(inside.tool).toBe('pointer'); // typing
      keydown('2');
      expect(inside.tool).toBe('pen');
      wb.destroy();
    } finally {
      room.close();
    }
  });
});

describe('moving, turning, scaling and removing', () => {
  async function mount() {
    const room = new TestRoom();
    const host = await room.start();
    const wb = createWhiteboard(box(800, 450), { session: host, adapter: identity });
    const root = wb.element.shadowRoot!;
    const board = root.querySelector('svg')!;
    const node = () => root.querySelector('.item')!;
    // jsdom has no hit testing: the item is under the pointer.
    Object.defineProperty(root, 'elementsFromPoint', { value: () => [node()] });
    return { room, wb, board, me: host.me.id, node };
  }

  it('drags your own item with the pointer tool, and not somebody else’s', async () => {
    const t = await mount();
    try {
      t.wb.load(snapshot([sticker('other')]));
      pointer(t.board, 'pointerdown', 100, 100);
      pointer(t.board, 'pointermove', 130, 140);
      pointer(t.board, 'pointerup', 130, 140);
      expect(t.wb.items()[0]).toMatchObject({ x: 100, y: 100 });
      t.wb.destroy();
    } finally {
      t.room.close();
    }

    const mine = await mount();
    try {
      mine.wb.load(snapshot([sticker(mine.me)]));
      pointer(mine.board, 'pointerdown', 100, 100);
      pointer(mine.board, 'pointermove', 130, 140);
      expect(mine.node().getAttribute('transform')).toBe('translate(30 40)');
      pointer(mine.board, 'pointerup', 130, 140);
      expect(mine.wb.items()[0]).toMatchObject({ x: 130, y: 140 });
      mine.wb.destroy();
    } finally {
      mine.room.close();
    }
  });

  it('moves an ink stroke by all its points', async () => {
    const t = await mount();
    try {
      t.wb.load(
        snapshot([
          {
            id: `${t.me}.2`,
            author: t.me,
            stamp: [2, t.me],
            kind: 'ink',
            points: [0, 0, 10, 10, 20, 20],
            color: '#e5484d',
            width: 4,
          },
        ]),
      );
      pointer(t.board, 'pointerdown', 10, 10);
      pointer(t.board, 'pointermove', 15, 30);
      pointer(t.board, 'pointerup', 15, 30);
      expect(t.wb.items()[0]).toMatchObject({ points: [5, 20, 15, 30, 25, 40] });
      t.wb.destroy();
    } finally {
      t.room.close();
    }
  });

  it('scales with Shift and turns with Ctrl', async () => {
    const t = await mount();
    try {
      t.wb.load(snapshot([sticker(t.me)]));
      pointer(t.board, 'pointerdown', 120, 100); // 20 from the centre
      pointer(t.board, 'pointermove', 140, 100, { shiftKey: true }); // 40 from it
      pointer(t.board, 'pointerup', 140, 100, { shiftKey: true });
      expect(t.wb.items()[0]).toMatchObject({ x: 100, y: 100, size: 80 });

      pointer(t.board, 'pointerdown', 140, 100);
      pointer(t.board, 'pointermove', 100, 140, { ctrlKey: true }); // a quarter turn
      pointer(t.board, 'pointerup', 100, 140, { ctrlKey: true });
      expect(t.wb.items()[0]).toMatchObject({ size: 80, rot: 90 });
      t.wb.destroy();
    } finally {
      t.room.close();
    }
  });

  it('shows, moves and removes an image', async () => {
    const t = await mount();
    try {
      t.wb.load(
        snapshot([
          {
            id: `${t.me}.1`,
            author: t.me,
            stamp: [1, t.me],
            kind: 'image',
            x: 100,
            y: 100,
            size: 200,
            ratio: 0.5,
            data: PNG,
            rot: 30,
          },
        ]),
      );
      const image = t.node().querySelector('image')!;
      expect(image.getAttribute('href')).toBe(PNG);
      expect(image.getAttribute('height')).toBe('100');
      expect(image.parentElement?.getAttribute('transform')).toBe('rotate(30 100 100)');
      pointer(t.board, 'pointerdown', 100, 100);
      pointer(t.board, 'pointermove', 90, 100);
      pointer(t.board, 'pointerup', 90, 100);
      expect(t.wb.items()[0]).toMatchObject({ x: 90, y: 100 });
      expect(t.wb.contentBounds()?.width).toBeGreaterThan(200);

      const menu = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
      t.board.dispatchEvent(menu);
      expect(menu.defaultPrevented).toBe(true);
      expect(t.wb.items()).toHaveLength(0);
      t.wb.destroy();
    } finally {
      t.room.close();
    }
  });

  it('removes with the right button only what is yours', async () => {
    const t = await mount();
    try {
      t.wb.load(snapshot([sticker('other')]));
      const menu = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
      t.board.dispatchEvent(menu);
      expect(menu.defaultPrevented).toBe(false);
      expect(t.wb.items()).toHaveLength(1);
      t.wb.destroy();
    } finally {
      t.room.close();
    }
  });
});

describe('cursors, avatars and the speaking queue', () => {
  async function party() {
    const room = new TestRoom();
    const host = await room.start();
    const make = (session: typeof host, avatar?: string) => {
      const stage = box(800, 450);
      const wb = createWhiteboard(stage, {
        session,
        adapter: frameAdapter(stage, () => 16 / 9),
        avatar,
      });
      return { stage, wb };
    };
    const hostSide = make(host);
    const ana = await room.join('Ana');
    await until(() => ana.host(), 'Ana reached the host');
    const anaSide = make(ana, PNG);
    const ben = await room.join('Ben');
    await until(() => ben.host(), 'Ben reached the host');
    const benSide = make(ben);
    await until(() => host.peers().length === 3 && ana.peers().length === 3, 'roster');
    return {
      room,
      host,
      ana,
      ben,
      make,
      hostBoard: hostSide.wb,
      anaBoard: anaSide.wb,
      benBoard: benSide.wb,
      anaStage: anaSide.stage,
      benStage: benSide.stage,
      done: () => {
        [hostSide, anaSide, benSide].forEach((s) => s.wb.destroy());
        room.close();
      },
    };
  }

  const root = (wb: { element: HTMLElement }) => wb.element.shadowRoot!;

  it('shows a cursor as the tool of its owner, with the avatar instead of the name', async () => {
    const p = await party();
    try {
      p.anaBoard.setTool('pen');
      pointer(p.anaStage, 'pointermove', 120, 80);
      await until(() => root(p.hostBoard).querySelector('.cursor svg.pen'), 'pen cursor');
      await until(() => root(p.benBoard).querySelector('.cursor svg.pen'), 'pen cursor on Ben');

      // The avatar is on the host and on the other guest, in place of the name.
      await until(() => root(p.hostBoard).querySelector('.cursor img[src]'), 'avatar on host');
      expect(root(p.hostBoard).querySelector<HTMLElement>('.cursor span')?.hidden).toBe(true);
      await until(() => root(p.benBoard).querySelector('.cursor img[src]'), 'avatar on Ben');

      // A new tool reaches the others without a move.
      p.anaBoard.setTool('eraser');
      await until(() => root(p.hostBoard).querySelector('.cursor svg.eraser'), 'eraser cursor');

      // Somebody without an avatar is shown by name.
      pointer(p.benStage, 'pointermove', 5, 5);
      await until(() => root(p.anaBoard).querySelector('.cursor span:not([hidden])'), 'a name');
      expect(root(p.anaBoard).querySelector('.cursor span:not([hidden])')?.textContent).toBe('Ben');
    } finally {
      p.done();
    }
  });

  it('keeps the queue for the turn to speak in order, and the speaker stands out', async () => {
    const p = await party();
    try {
      p.anaBoard.requestTurn();
      await until(() => p.hostBoard.turnQueue().length === 1, 'Ana queued');
      p.benBoard.requestTurn();
      p.benBoard.requestTurn(); // twice is once
      const both = [p.ana.me.id, p.ben.me.id];
      for (const wb of [p.hostBoard, p.anaBoard, p.benBoard]) {
        await until(() => wb.turnQueue().join() === both.join(), 'the queue everywhere');
      }

      const entries = [...root(p.benBoard).querySelectorAll<HTMLElement>('.queue .entry')];
      expect(entries).toHaveLength(2);
      expect(entries[0]?.classList.contains('first')).toBe(true);
      expect(entries[0]?.querySelector('img')?.getAttribute('src')).toBe(PNG);
      expect(entries[0]?.textContent).toContain('Ana');
      expect(entries[1]?.textContent).toContain('Ben (you)');
      expect(entries[0]?.style.background).not.toBe('');
      expect(root(p.benBoard).querySelector('.queue .turn')?.textContent).toBe('Leave the queue');
      expect(root(p.anaBoard).querySelector('.queue .turn')?.textContent).toBe('End my turn');
      expect(root(p.hostBoard).querySelector('.queue .turn')?.textContent).toBe('Ask for a turn');

      // The speaker's cursor stands out on the other boards.
      pointer(p.anaStage, 'pointermove', 50, 50);
      await until(() => root(p.hostBoard).querySelector('.cursor.active'), 'active cursor');

      // Ana ends her turn: Ben has it.
      p.anaBoard.endTurn();
      await until(() => p.hostBoard.turnQueue().join() === p.ben.me.id, 'Ben speaks');
      await until(() => !root(p.hostBoard).querySelector('.cursor.active'), 'plain cursor');
      await until(() => p.anaBoard.turnQueue().length === 1, 'Ana sees it too');
    } finally {
      p.done();
    }
  });

  it('lets the host remove someone, drops who leaves, and refuses a forged queue', async () => {
    const p = await party();
    try {
      p.anaBoard.requestTurn();
      await until(() => p.hostBoard.turnQueue().length === 1, 'Ana queued');
      p.benBoard.requestTurn();
      await until(() => p.hostBoard.turnQueue().length === 2, 'both queued');

      // A guest cannot write the queue for the others.
      p.ben.channel('wb').send({ t: 'queue', ids: [p.ben.me.id] });
      await settle();
      expect(p.anaBoard.turnQueue()).toEqual([p.ana.me.id, p.ben.me.id]);

      // Only the host removes others.
      p.anaBoard.removeFromQueue(p.ben.me.id);
      await settle();
      expect(p.hostBoard.turnQueue()).toHaveLength(2);
      p.hostBoard.removeFromQueue(p.ana.me.id);
      await until(() => p.benBoard.turnQueue().join() === p.ben.me.id, 'Ana removed');

      p.ben.close();
      await until(() => p.hostBoard.turnQueue().length === 0, 'Ben left the queue by leaving');
    } finally {
      p.done();
    }
  });

  it('gives the avatars and the queue to whoever joins later', async () => {
    const p = await party();
    try {
      p.anaBoard.requestTurn();
      await until(() => p.hostBoard.turnQueue().length === 1, 'Ana queued');
      const cat = await p.room.join('Cat');
      await until(() => cat.host(), 'Cat reached the host');
      const late = p.make(cat);
      await until(() => late.wb.turnQueue().length === 1, 'Cat is told the queue');
      await until(
        () => root(late.wb).querySelector('.queue .entry img')?.getAttribute('src') === PNG,
        'Cat has the avatar of Ana',
      );
      late.wb.destroy();
    } finally {
      p.done();
    }
  });
});
