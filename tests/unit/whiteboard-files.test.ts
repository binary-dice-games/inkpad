// @vitest-environment jsdom
// MIT License © 2026 Carlos Lopez
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LIMITS,
  cleanFileInfo,
  cleanItem,
  WhiteboardError,
  createWhiteboard,
  drawingGate,
  frameAdapter,
} from '@inkpad/collab-whiteboard';
import type { PreparedFile } from '@inkpad/collab-whiteboard';
import { TestRoom } from '../support/rooms';
import { until } from '../support/wait';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function box(width: number, height: number): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: width });
  Object.defineProperty(el, 'clientHeight', { value: height });
  document.body.append(el);
  return el;
}

/** Stands in for the canvas work of the browser, which jsdom does not have. */
async function prepare(file: File): Promise<PreparedFile> {
  return {
    data: PNG,
    width: 320,
    height: 400,
    card: true,
    name: file.name,
    file: { name: file.name, mime: file.type || 'application/octet-stream', bytes: file.size },
    blob: file,
  };
}

describe('file info', () => {
  it('keeps a valid description and makes the name safe as a file name', () => {
    expect(cleanFileInfo({ name: 'plan.pdf', mime: 'application/pdf', bytes: 10 })).toEqual({
      name: 'plan.pdf',
      mime: 'application/pdf',
      bytes: 10,
    });
    expect(
      cleanFileInfo({ name: '../a:b\\c\u0007.zip', mime: 'application/zip', bytes: 1 }),
    ).toEqual({
      name: '.._a_b_c_.zip',
      mime: 'application/zip',
      bytes: 1,
    });
  });

  it('refuses a bad description', () => {
    const ok = { name: 'a.txt', mime: 'text/plain', bytes: 1 };
    expect(cleanFileInfo(null)).toBeNull();
    expect(cleanFileInfo({ ...ok, name: '   ' })).toBeNull();
    expect(cleanFileInfo({ ...ok, mime: 'text/plain; x=1' })).toBeNull();
    expect(cleanFileInfo({ ...ok, mime: 'javascript' })).toBeNull();
    expect(cleanFileInfo({ ...ok, bytes: LIMITS.fileBytes + 1 })).toBeNull();
    expect(cleanFileInfo({ ...ok, bytes: 1.5 })).toBeNull();
    expect(cleanFileInfo({ ...ok, bytes: -1 })).toBeNull();
  });

  it('keeps the file on a picture item and drops a bad one without losing the picture', () => {
    const image = {
      id: 'a.1',
      author: 'a',
      stamp: [1, 'a'],
      kind: 'image',
      x: 0,
      y: 0,
      size: 100,
      ratio: 1.25,
      data: PNG,
    };
    const file = { name: 'a.txt', mime: 'text/plain', bytes: 3 };
    expect(cleanItem({ ...image, file })).toMatchObject({ file });
    expect(cleanItem({ ...image, file: { ...file, bytes: -2 } })).not.toHaveProperty('file');
    expect(cleanItem(image)).not.toHaveProperty('file');
  });

  it('lets only small, well formed file messages through the host gate', () => {
    const gate = drawingGate(() => true);
    expect(gate('wb', { t: 'file', id: 'a.1', data: 'aGVsbG8=' }, 'g')).toBe(true);
    expect(gate('wb', { t: 'file', id: 'a.1', data: 'A'.repeat(LIMITS.fileBytes * 2) }, 'g')).toBe(
      false,
    );
    expect(gate('wb', { t: 'file', data: 'aGVsbG8=' }, 'g')).toBe(false);
    expect(gate('wb', { t: 'file', id: 'a.1', data: 5 }, 'g')).toBe(false);
    expect(drawingGate(() => false)('wb', { t: 'file', id: 'a.1', data: 'aGVsbG8=' }, 'g')).toBe(
      false,
    );
  });
});

describe('files pinned on the board', () => {
  const created: string[] = [];
  beforeEach(() => {
    URL.createObjectURL = () => {
      created.push('blob:test');
      return 'blob:test';
    };
    URL.revokeObjectURL = () => {};
  });
  afterEach(() => {
    created.length = 0;
  });

  async function party() {
    const room = new TestRoom();
    const host = await room.start();
    const sides: { destroy(): void }[] = [];
    const make = (session: typeof host) => {
      const stage = box(800, 450);
      const wb = createWhiteboard(stage, {
        session,
        adapter: frameAdapter(stage, () => 16 / 9),
        prepareFile: prepare,
      });
      sides.push(wb);
      return wb;
    };
    const hostBoard = make(host);
    const ana = await room.join('Ana');
    await until(() => ana.host(), 'Ana reached the host');
    const anaBoard = make(ana);
    const ben = await room.join('Ben');
    await until(() => ben.host(), 'Ben reached the host');
    const benBoard = make(ben);
    await until(() => host.peers().length === 3, 'roster');
    return {
      room,
      ana,
      ben,
      make,
      hostBoard,
      anaBoard,
      benBoard,
      done: () => {
        sides.forEach((s) => s.destroy());
        room.close();
      },
    };
  }

  const proxies = (wb: { element: HTMLElement }) =>
    wb.element.shadowRoot!.querySelectorAll('.drag .proxy');

  it('sends the file to everyone, and others drag out a copy', async () => {
    const p = await party();
    try {
      const id = await p.anaBoard.addFile(
        new File(['hello world'], 'notes.txt', { type: 'text/plain' }),
        {
          x: 200,
          y: 150,
        },
      );
      expect(id).not.toBeNull();
      for (const wb of [p.hostBoard, p.benBoard]) {
        await until(() => wb.fileOf(id!), 'the file arrived');
        expect(wb.fileOf(id!)).toMatchObject({ name: 'notes.txt', mime: 'text/plain' });
        expect(wb.fileOf(id!)?.blob.size).toBe(11);
      }

      // Others get a box to drag it from; the author moves the item instead.
      expect(proxies(p.benBoard)).toHaveLength(1);
      expect(proxies(p.hostBoard)).toHaveLength(1);
      expect(proxies(p.anaBoard)).toHaveLength(0);

      const add = vi.fn();
      const setData = vi.fn();
      const drag = new Event('dragstart', { bubbles: true, cancelable: true });
      Object.defineProperty(drag, 'dataTransfer', {
        value: { items: { add }, setData, setDragImage: () => {}, effectAllowed: '' },
      });
      proxies(p.benBoard)[0]!.dispatchEvent(drag);
      expect(drag.defaultPrevented).toBe(false);
      expect((add.mock.calls[0]?.[0] as File).name).toBe('notes.txt');
      expect(setData).toHaveBeenCalledWith('DownloadURL', 'text/plain:notes.txt:blob:test');
    } finally {
      p.done();
    }
  });

  it('shows a pinned print: a border, a shadow and a pin', async () => {
    const p = await party();
    try {
      await p.anaBoard.addFile(new File(['x'], 'a.txt', { type: 'text/plain' }));
      await until(() => p.benBoard.element.shadowRoot!.querySelector('.item.image-item'), 'item');
      const item = p.benBoard.element.shadowRoot!.querySelector('.item.image-item')!;
      expect(item.querySelector('g[filter="url(#wb-shadow)"]')).not.toBeNull();
      expect(item.querySelector('rect')?.getAttribute('fill')).toBe('#ffffff');
      expect(item.querySelectorAll('circle')).toHaveLength(2); // the pin and its highlight
      expect(item.querySelector('ellipse')).not.toBeNull(); // the shadow of the pin
      expect(p.benBoard.element.shadowRoot!.querySelector('filter#wb-shadow')).not.toBeNull();
      expect(p.benBoard.toSvg()).toContain('wb-shadow');
    } finally {
      p.done();
    }
  });

  it('gives the file to whoever joins later, and drops it with the item', async () => {
    const p = await party();
    try {
      const id = (await p.anaBoard.addFile(
        new File(['zip!'], 'a.zip', { type: 'application/zip' }),
      ))!;
      await until(() => p.hostBoard.fileOf(id), 'host has it');
      const cat = await p.room.join('Cat');
      await until(() => cat.host(), 'Cat reached the host');
      const late = p.make(cat);
      await until(() => late.fileOf(id), 'Cat has the file');
      expect(late.fileOf(id)?.blob.size).toBe(4);
      late.destroy();
    } finally {
      p.done();
    }
  });

  it('gives the picture when no file was sent, and refuses a drag while the file arrives', async () => {
    const p = await party();
    try {
      const id = (await p.anaBoard.addFile(new File(['x'], 'x.png', { type: 'image/png' })))!;
      expect(id).not.toBeNull();
      // A picture without a file (too big to send): the file is the picture itself.
      p.anaBoard.load({
        v: 1,
        clock: 99,
        clear: [0, ''],
        items: [
          {
            id: `${p.ana.me.id}.99`,
            author: p.ana.me.id,
            stamp: [99, p.ana.me.id],
            kind: 'image',
            x: 5,
            y: 5,
            size: 60,
            ratio: 1,
            data: PNG,
          },
        ],
      });
      await until(() => p.benBoard.fileOf(`${p.ana.me.id}.99`), 'picture on Ben');
      expect(p.benBoard.fileOf(`${p.ana.me.id}.99`)).toMatchObject({
        name: 'picture.png',
        mime: 'image/png',
      });

      // An item whose file has not arrived cannot be dragged yet.
      const missing = `${p.ana.me.id}.98`;
      p.anaBoard.load({
        v: 1,
        clock: 100,
        clear: [0, ''],
        items: [
          {
            id: missing,
            author: p.ana.me.id,
            stamp: [100, p.ana.me.id],
            kind: 'image',
            x: 5,
            y: 5,
            size: 60,
            ratio: 1,
            data: PNG,
            file: { name: 'late.pdf', mime: 'application/pdf', bytes: 5 },
          },
        ],
      });
      await until(() => p.benBoard.items().some((i) => i.id === missing), 'item on Ben');
      expect(p.benBoard.fileOf(missing)).toBeNull();
      const drag = new Event('dragstart', { bubbles: true, cancelable: true });
      Object.defineProperty(drag, 'dataTransfer', { value: { items: { add: vi.fn() } } });
      const boxes = [...proxies(p.benBoard)];
      boxes.forEach((b) => b.dispatchEvent(drag));
      expect(drag.defaultPrevented).toBe(true);
    } finally {
      p.done();
    }
  });

  it('accepts a file only from its author, and only as long as the item says', async () => {
    const p = await party();
    try {
      const id = `${p.ana.me.id}.7`;
      p.anaBoard.load({
        v: 1,
        clock: 7,
        clear: [0, ''],
        items: [
          {
            id,
            author: p.ana.me.id,
            stamp: [7, p.ana.me.id],
            kind: 'image',
            x: 5,
            y: 5,
            size: 60,
            ratio: 1,
            data: PNG,
            file: { name: 'five.txt', mime: 'text/plain', bytes: 5 },
          },
        ],
      });
      await until(() => p.benBoard.items().length === 1, 'item on Ben');

      // Ben cannot supply Ana's file, nor can anybody make it the wrong length.
      p.ben.channel('wb').send({ t: 'file', id, data: btoa('hello') });
      p.ana.channel('wb').send({ t: 'file', id, data: btoa('hi') });
      p.ana.channel('wb').send({ t: 'file', id, data: '!!!not base64!!!' });
      await new Promise((r) => setTimeout(r, 150));
      expect(p.hostBoard.fileOf(id)).toBeNull();
      expect(p.benBoard.fileOf(id)).toBeNull();

      p.ana.channel('wb').send({ t: 'file', id, data: btoa('hello') });
      await until(() => p.benBoard.fileOf(id), 'the right file');
      expect(p.benBoard.fileOf(id)?.blob.size).toBe(5);
      expect(p.hostBoard.fileOf(id)?.blob.size).toBe(5);
    } finally {
      p.done();
    }
  });

  it('turns a drop of several files into items and reports a refused one', async () => {
    const room = new TestRoom();
    try {
      const host = await room.start();
      const stage = box(800, 450);
      const wb = createWhiteboard(stage, {
        session: host,
        adapter: frameAdapter(stage, () => 16 / 9),
        prepareFile: async (file) => {
          if (file.name === 'big.iso') {
            throw new WhiteboardError('big.iso is too large to share');
          }
          return prepare(file);
        },
      });
      const errors: string[] = [];
      wb.on('error', (e) => errors.push(e.message));
      const drop = new MouseEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: 50,
        clientY: 40,
      });
      Object.defineProperty(drop, 'dataTransfer', {
        value: {
          types: ['Files'],
          files: [
            new File(['a'], 'a.txt'),
            new File(['b'], 'b.zip'),
            new File(['i'], 'big.iso'),
            new File(['c'], 'c.docx'),
          ],
        },
      });
      stage.dispatchEvent(drop);
      expect(drop.defaultPrevented).toBe(true);
      await until(() => wb.items().length === 3, 'three items');
      expect(wb.items().map((i) => (i.kind === 'image' ? i.file?.name : ''))).toEqual([
        'a.txt',
        'b.zip',
        'c.docx',
      ]);
      await until(() => errors.length === 1, 'the refusal');
      expect(errors).toEqual(['big.iso is too large to share']);
      wb.destroy();
    } finally {
      room.close();
    }
  });
});
