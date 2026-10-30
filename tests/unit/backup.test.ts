// MIT License © 2026 Binary Dice Games
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupWriter, backupInfo, memoryStore } from '../../viewer/src/backup';
import type { BackupStore } from '../../viewer/src/backup';

const board = (items: unknown[], saved = '2026-10-30T15:30:00.000Z') =>
  JSON.stringify({ format: 'inksplat-board', version: 1, saved, meta: {}, items, files: [] });

describe('what a backup holds', () => {
  it('reads the time and the number of items of a board file', () => {
    const info = backupInfo(board([{ id: 'a' }, { id: 'b' }]));
    expect(info?.items).toBe(2);
    expect(info?.saved?.toISOString()).toBe('2026-10-30T15:30:00.000Z');
  });

  it('has nothing to resume for no file, another file or an empty board', () => {
    expect(backupInfo(null)).toBeNull();
    expect(backupInfo('not json')).toBeNull();
    expect(backupInfo(JSON.stringify({ format: 'other', items: [{}] }))).toBeNull();
    expect(backupInfo(board([]))).toBeNull();
  });

  it('keeps a board whose time is missing', () => {
    expect(backupInfo(board([{}], 'nonsense'))?.saved).toBeNull();
  });
});

describe('writing the backup', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A writer over a memory store whose board is `items`; counts the boards made. */
  function setup(items: unknown[] = [{ id: 'a' }], store: BackupStore = memoryStore()) {
    const state = { items, made: 0 };
    const writer = new BackupWriter({
      store,
      delayMs: 1000,
      make: () => {
        state.made += 1;
        return Promise.resolve({ format: 'inksplat-board', items: state.items });
      },
    });
    return { writer, store, state };
  }

  it('writes a moment after a change, once for many changes', async () => {
    const { writer, store, state } = setup();
    writer.schedule();
    writer.schedule();
    expect(await store.read()).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.made).toBe(1);
    expect(backupInfo(await store.read())?.items).toBe(1);
  });

  it('keeps writing during a long run of changes', async () => {
    const { writer, state } = setup();
    for (let i = 0; i < 5; i++) {
      writer.schedule();
      await vi.advanceTimersByTimeAsync(600);
    }
    expect(state.made).toBeGreaterThanOrEqual(2);
  });

  it('flushes pending changes at once', async () => {
    const { writer, store } = setup();
    writer.schedule();
    await writer.flush();
    expect(backupInfo(await store.read())?.items).toBe(1);
  });

  it('removes the backup when the board is empty', async () => {
    const { writer, store } = setup([], memoryStore(board([{ id: 'old' }])));
    writer.schedule();
    await writer.flush();
    expect(await store.read()).toBeNull();
  });

  it('writes nothing after it stops', async () => {
    const { writer, state } = setup();
    writer.schedule();
    writer.stop();
    writer.schedule();
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.made).toBe(0);
  });

  it('reports a failed write and tries again on the next change', async () => {
    const errors: unknown[] = [];
    let fail = true;
    const store = memoryStore();
    const writer = new BackupWriter({
      store: {
        ...store,
        write: (text) => (fail ? Promise.reject(new Error('full')) : store.write(text)),
      },
      make: () => Promise.resolve({ items: [{}] }),
      onError: (e) => errors.push(e),
    });
    writer.schedule();
    await writer.flush();
    expect(errors).toHaveLength(1);
    fail = false;
    writer.schedule();
    await writer.flush();
    expect(await store.read()).not.toBeNull();
  });
});
