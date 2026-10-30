// @vitest-environment jsdom
// MIT License © 2026 Carlos Lopez
import { describe, expect, it } from 'vitest';
import {
  LOCKS,
  cleanItem,
  createModel,
  createWhiteboard,
  mayChange,
} from '@inkpad/collab-whiteboard';
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

// jsdom has no canvas: the text is measured by its length.
HTMLCanvasElement.prototype.getContext = () => null;

const sticker = { kind: 'sticker', x: 5, y: 5, size: 30, name: 'check' };

describe('locks in the model', () => {
  it('keeps a good lock on any kind of item and drops a bad one', () => {
    const base = { id: 'ana.1', author: 'ana', stamp: [1, 'ana'] as [number, string] };
    expect([...LOCKS]).toEqual(['owner', 'all']);
    expect(cleanItem({ ...base, ...sticker, lock: 'owner' })).toMatchObject({ lock: 'owner' });
    expect(cleanItem({ ...base, ...sticker, lock: 'all' })).toMatchObject({ lock: 'all' });
    expect(cleanItem({ ...base, ...sticker, lock: 'everyone' })).not.toHaveProperty('lock');
    expect(cleanItem({ ...base, deleted: true, lock: 'all' })).not.toHaveProperty('lock');
  });

  it('decides who may change what', () => {
    const old = { id: 'a.1', author: 'ana', stamp: [1, 'ana'], ...sticker } as never;
    const by = (peer: string, fields: object, over = old) =>
      ({ ...(over as object), ...fields, stamp: [2, peer] }) as never;
    // Unlocked: anybody may change or delete it, but only its author may lock it.
    expect(mayChange(old, by('ben', { x: 9 }))).toBe(true);
    expect(mayChange(old, by('ben', { deleted: true }))).toBe(true);
    expect(mayChange(old, by('ben', { lock: 'owner' }))).toBe(false);
    expect(mayChange(old, by('ana', { lock: 'owner' }))).toBe(true);
    // Only the owner: the owner changes it, others cannot, nor unlock it.
    const owned = { ...(old as object), lock: 'owner' } as never;
    expect(mayChange(owned, by('ana', { x: 9 }, owned))).toBe(true);
    expect(mayChange(owned, by('ben', { x: 9 }, owned))).toBe(false);
    expect(mayChange(owned, by('ben', { deleted: true }, owned))).toBe(false);
    expect(mayChange(owned, by('ben', { lock: undefined }, owned))).toBe(false);
    // Nobody: not even the owner may change it, only unlock it (and then change it).
    const shut = { ...(old as object), lock: 'all' } as never;
    expect(mayChange(shut, by('ana', { x: 9 }, shut))).toBe(false);
    expect(mayChange(shut, by('ana', { deleted: true }, shut))).toBe(false);
    expect(mayChange(shut, by('ana', { lock: 'owner' }, shut))).toBe(true);
    expect(mayChange(shut, by('ana', { lock: undefined }, shut))).toBe(true);
    expect(mayChange(shut, by('ben', { lock: undefined }, shut))).toBe(false);
    // Nothing before, or a tombstone: nothing to protect.
    expect(mayChange(undefined, by('ben', {}))).toBe(true);
  });

  it('refuses a locked change here and drops it when it arrives from somebody else', () => {
    const ana = createModel('ana');
    const ben = createModel('ben');
    const add = ana.add({ ...sticker });
    ben.apply(add);
    const id = (add as { item: { id: string } }).item.id;
    // Open: Ben changes Ana's item, and it reaches her.
    const moved = ben.change(id, { x: 50 })!;
    expect(ana.apply(moved)).toEqual([id]);
    expect(ana.get(id)).toMatchObject({ x: 50 });
    // Ana locks it for the others: Ben cannot change it, here or by sending it.
    ben.apply(ana.change(id, { lock: 'owner' })!);
    expect(() => ben.change(id, { x: 60 })).toThrow(/locked/);
    expect(() => ben.remove(id)).toThrow(/locked/);
    const forged = { t: 'put', item: { ...ben.get(id)!, x: 70, stamp: [99, 'ben'] } };
    expect(ana.apply(forged)).toEqual([]);
    expect(ana.get(id)).toMatchObject({ x: 50, lock: 'owner' });
    // Ana may still change it; once nobody may, not even she can until she unlocks it.
    ana.change(id, { x: 51 });
    ana.change(id, { lock: 'all' });
    expect(() => ana.change(id, { x: 52 })).toThrow(/locked/);
    ana.change(id, { lock: undefined });
    expect(ana.change(id, { x: 52 })).not.toBeNull();
  });
});

describe('locking and text size on the board', () => {
  async function mount() {
    const room = new TestRoom();
    const host = await room.start();
    const wb = createWhiteboard(box(800, 450), { session: host, adapter: identity });
    const root = wb.element.shadowRoot!;
    const board = root.querySelector('svg')!;
    Object.defineProperty(root, 'elementsFromPoint', {
      value: () => [root.querySelector('.item')].filter(Boolean),
    });
    const click = (x: number, y: number) => {
      for (const type of ['pointerdown', 'pointerup']) {
        board.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
      }
    };
    const bar = () => [...root.querySelectorAll<HTMLButtonElement>('.selbar button')];
    const named = (start: string) =>
      bar().find((b) => (b.getAttribute('aria-label') ?? '').startsWith(start))!;
    return { room, wb, root, click, bar, named };
  }
  type Mounted = Awaited<ReturnType<typeof mount>>;
  const done = (t: Mounted) => {
    t.wb.destroy();
    t.room.close();
  };

  it('cycles from unlocked to only the owner to nobody and back, and shows it', async () => {
    const t = await mount();
    try {
      t.wb.addNote({ x: 200, y: 200 }, 'idea');
      t.click(200, 200);
      t.root.querySelector('textarea')?.dispatchEvent(new Event('blur'));
      const item = () => t.wb.items()[0] as NoteItem & { lock?: string };
      expect(t.named('Unlocked').getAttribute('aria-pressed')).toBe('false');
      expect(t.root.querySelector('.lock')).toBeNull();

      t.named('Unlocked').click();
      expect(item().lock).toBe('owner');
      expect(t.named('Locked: only').getAttribute('aria-pressed')).toBe('true');
      expect(t.root.querySelector('.note-item .lock')).not.toBeNull(); // a padlock on it
      t.named('Locked: only').click();
      expect(item().lock).toBe('all');
      expect(t.named('Locked for everybody')).toBeTruthy();
      // Nobody may change it now: the bar offers the copy and the lock, and a drag does nothing.
      expect(t.bar().map((b) => b.getAttribute('aria-label')?.split(':')[0])).toEqual([
        'Copy the text',
        'Locked for everybody (click to unlock it)'.split(':')[0],
      ]);
      t.named('Locked for everybody').click();
      expect(item().lock).toBeUndefined();
      expect(t.root.querySelector('.lock')).toBeNull();
    } finally {
      done(t);
    }
  });

  it('keeps a note from its owner too while nobody may change it', async () => {
    const t = await mount();
    try {
      t.wb.addNote({ x: 200, y: 200 }, 'idea');
      t.click(200, 200);
      t.root.querySelector('textarea')?.dispatchEvent(new Event('blur'));
      t.named('Unlocked').click();
      t.named('Locked: only').click(); // now nobody
      const errors: string[] = [];
      t.wb.on('error', (e) => errors.push(e.message));
      const board = t.root.querySelector('svg')!;
      const fire = (type: string, x: number, y: number) =>
        board.dispatchEvent(
          new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }),
        );
      fire('pointerdown', 200, 200);
      fire('pointermove', 260, 260);
      fire('pointerup', 260, 260);
      expect(t.wb.items()[0]).toMatchObject({ x: 200, y: 200 });
      expect(t.root.querySelector('textarea')).toBeNull(); // no editing either
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
      expect(t.wb.items()).toHaveLength(1);
      expect(t.root.textContent).toContain('That element is locked');
      expect(errors).toEqual([]);
    } finally {
      done(t);
    }
  });

  it('changes the text size of a note from its bar, the same three sizes as the text tool', async () => {
    const t = await mount();
    try {
      t.wb.addNote({ x: 200, y: 200 }, 'A fairly long text that needs a few lines to fit in');
      t.click(200, 200);
      t.root.querySelector('textarea')?.dispatchEvent(new Event('blur'));
      const sizes = t.bar().filter((b) => b.getAttribute('aria-label')?.startsWith('Text note'));
      expect(sizes.map((b) => b.getAttribute('aria-label'))).toEqual([
        'Text note: small',
        'Text note: medium',
        'Text note: large',
      ]);
      expect(sizes.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
      const fontOf = () => t.root.querySelector('.note-item text')!.getAttribute('font-size');
      const lines = () => t.root.querySelectorAll('.note-item tspan').length;
      expect(fontOf()).toBe('16');
      const usual = lines();

      t.named('Text note: large').click();
      expect(t.wb.items()[0]).toMatchObject({ fs: 24 });
      expect(fontOf()).toBe('24');
      expect(lines()).toBeGreaterThan(usual); // bigger letters, more lines
      expect(t.named('Text note: large').getAttribute('aria-pressed')).toBe('true');

      t.named('Text note: small').click();
      expect(fontOf()).toBe('12');
      expect(lines()).toBeLessThan(usual + 1);
      // The usual size is the default: nothing is stored for it.
      t.named('Text note: medium').click();
      expect(t.wb.items()[0]).not.toHaveProperty('fs');
      // The box being written in has the size too.
      t.named('Text note: large').click();
      t.click(200, 200);
      expect(t.root.querySelector<HTMLTextAreaElement>('textarea.sticky')!.style.fontSize).toBe(
        '24px',
      );
    } finally {
      done(t);
    }
  });

  it('arrives locked on the other boards, which then show only what they may do', async () => {
    const t = await mount();
    try {
      const ben = await t.room.join('Ben');
      await until(() => ben.host(), 'Ben reached the host');
      const benBoard = createWhiteboard(box(800, 450), { session: ben, adapter: identity });
      t.wb.addNote({ x: 200, y: 200 }, 'idea');
      t.click(200, 200);
      t.root.querySelector('textarea')?.dispatchEvent(new Event('blur'));
      t.named('Unlocked').click();
      await until(
        () => (benBoard.items()[0] as { lock?: string })?.lock === 'owner',
        'it arrived locked',
      );
      // Ben, who is not the owner, cannot change it: the model refuses and says so.
      const errors: string[] = [];
      benBoard.on('error', (e) => errors.push(e.message));
      const inner = benBoard as unknown as {
        local(f: () => unknown): unknown;
        model: { change(i: string, f: object): unknown };
      };
      inner.local(() => inner.model.change(benBoard.items()[0]!.id, { x: 1 }));
      expect(errors).toEqual(['That element is locked.']);
      expect(benBoard.items()[0]).toMatchObject({ x: 200 });
      benBoard.destroy();
    } finally {
      done(t);
    }
  });
});
