// @vitest-environment jsdom
// MIT License © 2026 Carlos Lopez
import { describe, expect, it } from 'vitest';
import { FRAME_UNITS, createWhiteboard, frameAdapter } from '@inkpad/collab-whiteboard';
import { TestRoom } from '../support/rooms';
import { until } from '../support/wait';

function box(width: number, height: number): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: width });
  Object.defineProperty(el, 'clientHeight', { value: height });
  document.body.append(el);
  return el;
}

describe('frame adapter', () => {
  it('maps the 1000-unit frame onto the letterboxed rectangle', () => {
    let aspect = 2;
    const adapter = frameAdapter(box(800, 800), () => aspect);
    expect(adapter.transform()).toMatchObject({ a: 0.8, d: 0.8, e: 0, f: 200 });
    expect(adapter.clip?.()).toEqual({ x: 0, y: 200, width: 800, height: 400 });

    aspect = 1;
    expect(adapter.transform()).toMatchObject({ a: 0.8, e: 0, f: 0 });
    let calls = 0;
    adapter.onChange(() => (calls += 1));
    adapter.update();
    expect(calls).toBe(1);
    expect(FRAME_UNITS).toBe(1000);
  });
});

describe('whiteboard over a host session', () => {
  it('draws a sticker, shows the emoticons and lets the host board merge a load', async () => {
    const room = new TestRoom();
    try {
      const host = await room.start();
      const hostStage = box(800, 450);
      const hostBoard = createWhiteboard(hostStage, {
        session: host,
        adapter: frameAdapter(hostStage, () => 16 / 9),
      });
      const guest = await room.join('Ana');
      await until(() => guest.host(), 'guest reached host');

      const stage = box(800, 450);
      const wb = createWhiteboard(stage, {
        session: guest,
        adapter: frameAdapter(stage, () => 16 / 9),
      });
      const symbols = wb.element.shadowRoot?.querySelectorAll('symbol') ?? [];
      const names = [...symbols].map((s) => s.id);
      expect(names).toContain('sticker-smile');
      expect(names).toContain('sticker-thinking');

      // A load is sent to the host and lands on its board.
      expect(hostBoard.items()).toHaveLength(0);
      wb.load({
        v: 1,
        clock: 1,
        clear: [0, ''],
        items: [
          {
            id: 'a.1',
            author: 'a',
            stamp: [1, 'a'],
            kind: 'sticker',
            x: 10,
            y: 10,
            size: 40,
            name: 'smile',
          },
        ],
      });
      expect(wb.items()).toHaveLength(1);
      await until(() => hostBoard.items().length === 1, 'the host board has the sticker');
      wb.destroy();
      hostBoard.destroy();
    } finally {
      room.close();
    }
  });

  it('is read-only on request: only the pointer tool works', async () => {
    const room = new TestRoom();
    try {
      const host = await room.start();
      const stage = box(400, 300);
      const wb = createWhiteboard(stage, { session: host, readOnly: true });
      let tool = '';
      wb.on('tool', (t) => (tool = t));
      wb.setTool('pen');
      expect(tool).toBe('');
      wb.readOnly = false;
      wb.setTool('pen');
      expect(tool).toBe('pen');
      wb.destroy();
    } finally {
      room.close();
    }
  });
});
