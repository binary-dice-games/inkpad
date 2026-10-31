// @vitest-environment jsdom
// MIT License © 2026 Binary Dice Games
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Whiteboard } from '@inksplat/collab-whiteboard';
import type { Stage } from '@inksplat/defaults';
import {
  exportBackground,
  fileBackgrounds,
  fileStamp,
  openBoardFile,
  saveAs,
  videoFrame,
} from '../../viewer/src/save';
import type { SaveHost } from '../../viewer/src/save';
import { makeZip, zipParts } from '../../viewer/src/zip';

/** The bytes of a Blob (jsdom's Blob has no arrayBuffer()). */
const bytesOf = (blob: Blob) =>
  new Promise<Uint8Array>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });

const stage = (extra: Partial<Stage> = {}): Stage => ({ ...extra }) as Stage;

/** A page's side of saving, with a board that records what it was asked. */
function setup(extra: Partial<Stage> = {}, board: object | null = {}) {
  const toasts: string[] = [];
  const backgrounds: unknown[][] = [];
  const page = { currentPage: () => 0 };
  const host: SaveHost = {
    board: () => (board ? { ...page, ...board } : null) as Whiteboard | null,
    stage: () => stage(extra),
    video: () => null,
    toast: (t) => toasts.push(t),
    backgrounds: (names) => backgrounds.push(names),
  };
  return { host, toasts, backgrounds };
}

describe('what is saved of a board', () => {
  it('names files by date and time', () => {
    expect(fileStamp(new Date(2026, 9, 30, 7, 5))).toBe('2026-10-30-0705');
  });

  it('puts the sheet behind a canvas without video, and nothing behind video', () => {
    expect(exportBackground(stage())).toBeUndefined();
    expect(exportBackground(null)).toBeUndefined();
    expect(exportBackground(stage(), 1)!.background).toContain('#f6f7f8'); // canvas 2: whiteboard
    const cork = exportBackground(stage({ video: false, backgrounds: ['cork'] }))!;
    expect(cork.background).toContain('#bd9467');
    expect(cork['background-blend-mode']).toContain('multiply');
    expect(cork.border).toContain('solid');
    expect(cork['box-shadow']).toContain('inset');
    expect(exportBackground(stage({ video: false }))!.background).toContain('#f6f7f8'); // whiteboard
  });

  it('has no frame to take from a video that has not started', () => {
    expect(videoFrame(null)).toBeNull();
    expect(videoFrame(document.createElement('video'))).toBeNull();
  });
});

describe('saving', () => {
  let downloads: { name: string; blob: Blob }[];
  beforeEach(() => {
    downloads = [];
    let blob: Blob | MediaSource;
    URL.createObjectURL = (b) => {
      blob = b;
      return 'blob:x';
    };
    URL.revokeObjectURL = () => {};
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push({ name: this.download, blob: blob as Blob });
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('gives a PNG, an SVG and a board file their own names and contents', async () => {
    const calls: unknown[] = [];
    const board = {
      toPng: async (o: unknown) => {
        calls.push(o);
        return new Blob(['png'], { type: 'image/png' });
      },
      toSvg: (_box: unknown, o: unknown) => {
        calls.push(o);
        return '<svg/>';
      },
      saveBoard: async (meta: unknown) => {
        return { format: 'inksplat-board', version: 1, saved: '', meta, items: [], files: [] };
      },
    };
    const p = setup({ video: false, backgrounds: ['wall'] }, board);
    await saveAs('png', p.host);
    await saveAs('svg', p.host);
    await saveAs('board', p.host);
    expect(downloads.map((d) => d.name.replace(/\d{4}-\d\d-\d\d-\d{4}/, 'DATE'))).toEqual([
      'inksplat-board-DATE.png',
      'inksplat-board-DATE.svg',
      'inksplat-board-DATE.inksplat.zip',
    ]);
    expect(downloads[1]!.blob.type).toBe('image/svg+xml');
    expect(downloads[2]!.blob.type).toBe('application/zip');
    expect(calls).toHaveLength(2);
    expect((calls[0] as { background: object }).background).toBeDefined();
    // The board file remembers the backgrounds of all canvases, for the session that opens it.
    const parts = zipParts(await bytesOf(downloads[2]!.blob));
    expect(parts.has('manifest.json')).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(await parts.get('settings.json')!()))).toEqual({
      backgrounds: ['wall', 'blackboard', 'wall', 'cork', 'whiteboard'],
    });
    expect(p.toasts).toEqual([]);
  });

  it('says why when it cannot', async () => {
    const none = setup({}, null);
    await saveAs('png', none.host);
    expect(none.toasts).toEqual(['There is no board to save yet.']);
    const failing = setup(
      {},
      {
        toPng: async () => {
          throw new Error('This browser could not make a picture of the board.');
        },
      },
    );
    await saveAs('png', failing.host);
    expect(failing.toasts).toEqual(['This browser could not make a picture of the board.']);
    expect(downloads).toHaveLength(0);
  });
});

describe('opening a board file', () => {
  const enc = (text: string) => new TextEncoder().encode(text);
  const fileOf = (bytes: Uint8Array) => {
    const file = new File([bytes as BlobPart], 'b.inksplat.zip');
    // jsdom's File has no arrayBuffer().
    return Object.assign(file, { arrayBuffer: async () => bytes.slice().buffer });
  };
  /** A board zip with nothing but its manifest and settings. */
  const boardZip = async () =>
    fileOf(
      await bytesOf(
        await makeZip([
          { name: 'manifest.json', data: enc('{"format":"inksplat-board-zip","version":1}') },
          { name: 'settings.json', data: enc('{"backgrounds":["cork"]}') },
        ]),
      ),
    );

  it('adds it, says how much, and gives the presenter its backgrounds', async () => {
    let loaded: unknown;
    const p = setup(
      { video: false },
      {
        loadBoard: async (data: unknown) => {
          loaded = data;
          return {
            added: 3,
            skipped: 1,
            files: 2,
            meta: { backgrounds: ['cork', 'video', 'lava', 'wall', 'wall'] },
          };
        },
      },
    );
    await openBoardFile(await boardZip(), p.host);
    expect(loaded).toMatchObject({
      format: 'inksplat-board',
      version: 1,
      meta: { backgrounds: ['cork'] },
      items: [],
      files: [],
    });
    expect(p.toasts).toEqual(['Added 3 items, 2 files (1 left out).']);
    // No video in this session: that canvas, like the unknown one, stays as it is.
    expect(p.backgrounds).toEqual([['cork', undefined, undefined, 'wall', 'wall']]);
  });

  it('keeps unknown backgrounds out', () => {
    const none = stage({ video: false });
    expect(fileBackgrounds({}, none)).toBeUndefined();
    expect(fileBackgrounds({ background: 'cork' }, none)).toBeUndefined(); // not a setting of ours
    expect(fileBackgrounds({ backgrounds: ['lava'] }, none)).toBeUndefined();
    expect(fileBackgrounds({ backgrounds: ['video'] }, none)).toBeUndefined(); // no video here
    expect(fileBackgrounds({ backgrounds: ['video'] }, stage())).toEqual([
      'video',
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('keeps a background that is not one of ours out, and speaks of one item as one', async () => {
    const p = setup(
      {},
      {
        loadBoard: async () => ({
          added: 1,
          skipped: 0,
          files: 1,
          meta: { backgrounds: ['lava'] },
        }),
      },
    );
    await openBoardFile(await boardZip(), p.host);
    expect(p.toasts).toEqual(['Added 1 item, 1 file.']);
    expect(p.backgrounds).toEqual([]);
  });

  it('refuses what is not a board zip, what the board refuses, and what is too large', async () => {
    const p = setup(
      {},
      {
        loadBoard: async () => {
          throw new Error('The board is locked: nothing can be added.');
        },
      },
    );
    await openBoardFile(fileOf(enc('{"format":"inksplat-board","version":1}')), p.host);
    await openBoardFile(await boardZip(), p.host);
    expect(p.toasts).toEqual([
      'That is not an inksplat board file.',
      'The board is locked: nothing can be added.',
    ]);
    const big = await boardZip();
    Object.defineProperty(big, 'size', { value: 100 * 1024 * 1024 });
    await openBoardFile(big, p.host);
    expect(p.toasts[2]).toBe('That file is too large to be a board.');
    const nothing = setup({}, null);
    await openBoardFile(await boardZip(), nothing.host);
    expect(nothing.toasts).toEqual(['Join a session first.']);
  });
});
