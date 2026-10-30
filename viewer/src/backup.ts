// MIT License © 2026 Binary Dice Games
/**
 * @file The presenter's backup of the board (spec/06_static_presenter/DESIGN.md, Backup): a board
 * file kept in the browser's own storage for this site, written a moment after every change, so
 * a closed tab, a crash or a reload does not lose the work. The next session offers to resume it.
 *
 * The file goes in the origin private file system (OPFS) where the browser can write files
 * there, else in IndexedDB; with neither there is no backup.
 */

/** Where a backup is kept: one text file. */
export interface BackupStore {
  /** The backup's text, or null when there is none. */
  read(): Promise<string | null>;
  /** Replaces the backup. */
  write(text: string): Promise<void>;
  /** Deletes the backup (nothing happens when there is none). */
  remove(): Promise<void>;
}

/** The name of the backup file. */
export const BACKUP_NAME = 'board-backup.inksplat.json';

/** A store in memory (for tests, and a page whose browser has no storage). */
export function memoryStore(initial: string | null = null): BackupStore {
  let text = initial;
  return {
    read: () => Promise.resolve(text),
    write: (next) => {
      text = next;
      return Promise.resolve();
    },
    remove: () => {
      text = null;
      return Promise.resolve();
    },
  };
}

/** The backup as a file in the origin private file system, if the browser can write one there. */
async function opfsStore(): Promise<BackupStore | null> {
  const dir = await navigator.storage?.getDirectory?.();
  if (!dir || !('createWritable' in FileSystemFileHandle.prototype)) {
    return null;
  }
  return {
    read: async () => {
      try {
        return await (await (await dir.getFileHandle(BACKUP_NAME)).getFile()).text();
      } catch (e) {
        if (e instanceof DOMException && e.name === 'NotFoundError') {
          return null;
        }
        throw e;
      }
    },
    write: async (text) => {
      const out = await (await dir.getFileHandle(BACKUP_NAME, { create: true })).createWritable();
      await out.write(text);
      await out.close();
    },
    remove: async () => {
      try {
        await dir.removeEntry(BACKUP_NAME);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'NotFoundError')) {
          throw e;
        }
      }
    },
  };
}

/** The backup as one record in IndexedDB. */
function indexedDbStore(): BackupStore | null {
  if (typeof indexedDB === 'undefined') {
    return null;
  }
  const db = new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open('inksplat-backup', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('files');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error('IndexedDB could not be opened.'));
  });
  const run = async <T>(
    mode: IDBTransactionMode,
    op: (s: IDBObjectStore) => IDBRequest,
  ): Promise<T> => {
    const tx = (await db).transaction('files', mode);
    const req = op(tx.objectStore('files'));
    return new Promise<T>((resolve, reject) => {
      tx.oncomplete = () => resolve(req.result as T);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB failed.'));
    });
  };
  return {
    read: async () => {
      const text = await run<unknown>('readonly', (s) => s.get(BACKUP_NAME));
      return typeof text === 'string' ? text : null;
    },
    write: (text) => run('readwrite', (s) => s.put(text, BACKUP_NAME)),
    remove: () => run('readwrite', (s) => s.delete(BACKUP_NAME)),
  };
}

/** The best store this browser has for the backup, or null when it has none. */
export async function openBackupStore(): Promise<BackupStore | null> {
  try {
    const opfs = await opfsStore();
    if (opfs) {
      return opfs;
    }
  } catch {
    // Blocked (a private window, a policy): try IndexedDB.
  }
  try {
    return indexedDbStore();
  } catch {
    return null;
  }
}

/** What the resume question says about a backup. */
export interface BackupInfo {
  /** When it was written, if it says. */
  saved: Date | null;
  /** How many items it holds (at least one). */
  items: number;
  /** The board file, as text, to open or download. */
  text: string;
}

/** What a backup holds, or null when `text` is not a board file or the board was empty. */
export function backupInfo(text: string | null): BackupInfo | null {
  if (!text) {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const board = data as { format?: unknown; items?: unknown; saved?: unknown };
  if (
    board?.format !== 'inksplat-board' ||
    !Array.isArray(board.items) ||
    board.items.length === 0
  ) {
    return null;
  }
  const saved = typeof board.saved === 'string' ? new Date(board.saved) : null;
  return {
    saved: saved && !Number.isNaN(saved.getTime()) ? saved : null,
    items: board.items.length,
    text,
  };
}

/** Options of a {@link BackupWriter}. */
export interface BackupWriterOptions {
  /** Where the backup goes. */
  store: BackupStore;
  /** The board file to keep (an object with `items`), or null to keep nothing. */
  make: () => Promise<{ items: unknown[] } | null>;
  /** How long after a change the backup is written; changes in between go in the same write. */
  delayMs?: number;
  /** Called when a write fails (once per failure). */
  onError?: (e: unknown) => void;
}

/**
 * Writes the board to its backup a moment after it changes: {@link schedule} on every change,
 * {@link flush} when the page is about to go away. At most one write runs at a time; a board with
 * no items removes the backup, so an empty session leaves nothing to resume.
 */
export class BackupWriter {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false;
  private running: Promise<void> | null = null;
  private stopped = false;
  private readonly delayMs: number;

  constructor(private readonly options: BackupWriterOptions) {
    this.delayMs = options.delayMs ?? 1000;
  }

  /** Notes a change; the backup is written within `delayMs`. */
  schedule(): void {
    if (this.stopped) {
      return;
    }
    this.dirty = true;
    if (this.timer === undefined && !this.running) {
      this.timer = setTimeout(() => void this.run(), this.delayMs);
    }
  }

  /** Writes pending changes now; resolves when the backup is up to date. */
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.running;
    if (this.dirty) {
      await this.run();
    }
  }

  /** Stops writing (pending changes are dropped; call {@link flush} first to keep them). */
  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private run(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.running) {
      return this.running;
    }
    this.dirty = false;
    this.running = (async () => {
      try {
        const board = await this.options.make();
        if (board && board.items.length > 0) {
          await this.options.store.write(JSON.stringify(board));
        } else {
          await this.options.store.remove();
        }
      } catch (e) {
        this.options.onError?.(e);
      } finally {
        this.running = null;
        if (this.dirty && !this.stopped) {
          this.timer = setTimeout(() => void this.run(), this.delayMs);
        }
      }
    })();
    return this.running;
  }
}
