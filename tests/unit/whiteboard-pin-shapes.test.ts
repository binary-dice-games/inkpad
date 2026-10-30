// @vitest-environment jsdom
// MIT License © 2026 Carlos Lopez
import { describe, expect, it } from 'vitest';
import { PIN_SHAPES, cleanItem, createWhiteboard } from '@inksplat/collab-whiteboard';
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

describe('the shape of a pin', () => {
  it('is kept in the model only when it is not round, and only if it is a known one', () => {
    const base = { id: 'ana.1', author: 'ana', stamp: [1, 'ana'] as [number, string] };
    const pin = { ...base, kind: 'pin', x: 1, y: 2, color: '#112233' };
    expect([...PIN_SHAPES]).toEqual(['round', 'square', 'diamond', 'triangle', 'star']);
    expect(cleanItem({ ...pin, shape: 'star' })).toMatchObject({ shape: 'star' });
    expect(cleanItem({ ...pin, shape: 'round' })).not.toHaveProperty('shape');
    expect(cleanItem({ ...pin, shape: 'hexagon' })).not.toHaveProperty('shape');
  });

  it('is chosen in the panel of the pin tool, with the 7 key, and from the bar of a pin', async () => {
    const room = new TestRoom();
    const host = await room.start();
    const wb = createWhiteboard(box(800, 450), { session: host, adapter: identity });
    const root = wb.element.shadowRoot!;
    try {
      wb.setTool('pin');
      // Pressing 7 again goes to the next shape, and the pin put down has it.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '7', bubbles: true }));
      const first = wb.addPin({ x: 100, y: 100 })!;
      expect(wb.items().find((i) => i.id === first)).toMatchObject({ shape: 'square' });
      expect(root.querySelector('.pin-item rect.paper')).not.toBeNull();

      // The panel lists every shape, with the one in use pressed.
      const tool = root.querySelector<HTMLButtonElement>('.toolbar button[aria-label^="Pin"]')!;
      tool.click();
      const options = [...root.querySelectorAll<HTMLButtonElement>('.pop button')];
      expect(options.map((b) => b.getAttribute('aria-label'))).toEqual([
        'Shape: Round',
        'Shape: Square',
        'Shape: Diamond',
        'Shape: Triangle',
        'Shape: Star',
      ]);
      expect(options.map((b) => b.getAttribute('aria-pressed'))).toEqual([
        'false',
        'true',
        'false',
        'false',
        'false',
      ]);
      options[4]!.click();
      const second = wb.addPin({ x: 300, y: 100 })!;
      expect(wb.items().find((i) => i.id === second)).toMatchObject({ shape: 'star' });
      expect(root.querySelectorAll('.pin-item polygon.paper')).toHaveLength(1);

      // Round is the usual one: nothing is stored for it.
      options[0]!.click();
      const third = wb.addPin({ x: 500, y: 100 })!;
      expect(wb.items().find((i) => i.id === third)).not.toHaveProperty('shape');

      // Changing a pin on the board, from the bar over it.
      (wb as unknown as { select(id: string): void }).select(first);
      const bar = [...root.querySelectorAll<HTMLButtonElement>('.selbar button')];
      const named = (label: string) => bar.find((b) => b.getAttribute('aria-label') === label)!;
      expect(named('Shape: Square').getAttribute('aria-pressed')).toBe('true');
      named('Shape: Diamond').click();
      expect(wb.items().find((i) => i.id === first)).toMatchObject({ shape: 'diamond' });
      expect(root.querySelector('.pin-item polygon.paper')).not.toBeNull();
    } finally {
      wb.destroy();
      room.close();
    }
  });
});
