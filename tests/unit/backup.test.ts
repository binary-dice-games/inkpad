// MIT License © 2026 Binary Dice Games
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardFile } from '@inksplat/collab-whiteboard';
import { BackupWriter, backupInfo, memoryStore } from '../../viewer/src/backup';
import type { BackupStore } from '../../viewer/src/backup';
import { writeBoardArchive } from '../../viewer/src/board-archive';

const SAVED = '2026-10-30T15:30:00.000Z';
const ink = (id: string) => ({
  id,
  author: 'p',
  stamp: [1, 'p'],
  kind: 'ink',
  points: [0, 0, 1, 1],
  color: '#000000',
  width: 2,
});
const boardOf = (items: unknown[], saved = SAVED) =>
  ({ format: 'inksplat-board', version: 1, saved, meta: {}, items, files: [] }) as BoardFile;
/** A backup: the board zip. */
const zipped = async (items: unknown[], saved = SAVED) =>
  (await writeBoardArchive(boardOf(items, saved))).blob;

describe('what a backup holds', () => {
  it('reads the time and the number of items of a board zip', async () => {
    const info = await backupInfo(await zipped([ink('a'), ink('b')]));
    expect(info?.items).toBe(2);
    expect(info?.saved?.toISOString()).toBe(SAVED);
  });

  it('has nothing to resume for no file, another file or an empty board', async () => {
    expect(await backupInfo(null)).toBeNull();
    expect(await backupInfo(new Blob(['not a zip']))).toBeNull();
    expect(await backupInfo(new Blob([JSON.stringify(boardOf([ink('a')]))]))).toBeNull();
    expect(await backupInfo(await zipped([]))).toBeNull();
  });

  it('keeps a board whose time is missing', async () => {
    expect((await backupInfo(await zipped([ink('a')], 'nonsense')))?.saved).toBeNull();
  });
});

describe('writing the backup', () => {
  /** The zips of a board with one item and of an empty one, made before the timers are faked. */
  const zips = new Map<number, Blob>();
  beforeAll(async () => {
    zips.set(0, await zipped([]));
    zips.set(1, await zipped([ink('a')]));
  });
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A writer over a memory store whose board is `items`; counts the boards made. */
  function setup(items: unknown[] = [ink('a')], store: BackupStore = memoryStore()) {
    const state = { items, made: 0 };
    const writer = new BackupWriter({
      store,
      delayMs: 1000,
      make: () => {
        state.made += 1;
        return Promise.resolve({ blob: zips.get(state.items.length)!, items: state.items.length });
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
    expect((await backupInfo(await store.read()))?.items).toBe(1);
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
    expect((await backupInfo(await store.read()))?.items).toBe(1);
  });

  it('removes the backup when the board is empty', async () => {
    const { writer, store } = setup([], memoryStore(zips.get(1)!));
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
      make: () => Promise.resolve({ blob: new Blob(['zip']), items: 1 }),
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
