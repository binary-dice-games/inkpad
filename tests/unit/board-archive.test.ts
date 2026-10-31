// MIT License © 2026 Binary Dice Games
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { BoardFile } from '@inksplat/collab-whiteboard';
import {
  ARCHIVE_FORMAT,
  readArchiveManifest,
  readBoardArchive,
  writeBoardArchive,
} from '../../viewer/src/board-archive';
import { crc32, makeZip, zipParts } from '../../viewer/src/zip';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
const base = (id: string, page?: number) => ({
  id,
  author: 'p',
  stamp: [1, 'p'],
  ...(page ? { page } : {}),
});
const image = (id: string, name: string, bytes: number, page?: number) => ({
  ...base(id, page),
  kind: 'image',
  x: 0,
  y: 0,
  size: 100,
  ratio: 1,
  data: PNG,
  file: { name, mime: 'application/pdf', bytes },
});

/** A board with items on canvases 1 and 3, two documents of the same name and a photo. */
function board(): BoardFile {
  return {
    format: 'inksplat-board',
    version: 1,
    saved: '2026-10-31T10:00:00.000Z',
    meta: { backgrounds: ['video', 'cork', 'wall', 'whiteboard', 'blackboard'] },
    items: [
      {
        ...base('p.1'),
        kind: 'note',
        x: 1,
        y: 2,
        size: 90,
        ratio: 1,
        text: 'hi',
        color: '#ffee88',
      },
      image('p.2', 'report.pdf', 3),
      image('p.3', 'report.pdf', 2, 2),
      { ...image('p.4', 'x', 0), file: undefined },
    ] as unknown as BoardFile['items'],
    files: [
      { id: 'p.2', data: new Uint8Array([1, 2, 3]) },
      { id: 'p.3', data: new Uint8Array([4, 5]) },
    ],
  };
}

describe('zip files', () => {
  it('computes the CRC-32 zip tools check', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('writes stored and deflated parts that read back, with their CRCs', async () => {
    const json = new TextEncoder().encode(JSON.stringify({ a: 'b'.repeat(500) }));
    const blob = await makeZip([
      { name: 'a.json', data: json, compress: true },
      { name: 'files/ñ.bin', data: new Uint8Array([9, 8, 7]) },
    ]);
    const bytes = await bytesOf(blob);
    expect(blob.type).toBe('application/zip');
    const parts = zipParts(bytes);
    expect([...parts.keys()]).toEqual(['a.json', 'files/ñ.bin']);
    expect(await parts.get('a.json')!()).toEqual(json);
    expect([...(await parts.get('files/ñ.bin')!())]).toEqual([9, 8, 7]);
    // The local header of the JSON says deflate, its CRC is that of the text, and it is smaller.
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(8, true)).toBe(8);
    expect(view.getUint32(14, true)).toBe(crc32(json));
    const packed = view.getUint32(18, true);
    expect(packed).toBeLessThan(json.length);
    expect(new Uint8Array(inflateRawSync(bytes.subarray(30 + 6, 30 + 6 + packed)))).toEqual(json);
  });
});

describe('board zips', () => {
  it('lays a board out as a manifest, settings, one JSON per canvas, images and files', async () => {
    const archive = await writeBoardArchive(board());
    expect(archive).toMatchObject({ items: 4, files: 2 });
    const parts = zipParts(await bytesOf(archive.blob));
    expect([...parts.keys()]).toEqual([
      'manifest.json',
      'settings.json',
      'canvas-1.json',
      'canvas-2.json',
      'canvas-3.json',
      'canvas-4.json',
      'canvas-5.json',
      'images/p.2.png',
      'images/p.3.png',
      'images/p.4.png',
      'files/report.pdf',
      'files/report (2).pdf',
    ]);
    const read = async (name: string) => JSON.parse(text(await parts.get(name)!())) as unknown;
    expect(await read('manifest.json')).toMatchObject({
      format: ARCHIVE_FORMAT,
      version: 1,
      saved: '2026-10-31T10:00:00.000Z',
      items: 4,
      images: 3,
      files: 2,
      canvases: [
        { canvas: 1, path: 'canvas-1.json', items: 3 },
        { canvas: 2, path: 'canvas-2.json', items: 0 },
        { canvas: 3, path: 'canvas-3.json', items: 1 },
        { canvas: 4, path: 'canvas-4.json', items: 0 },
        { canvas: 5, path: 'canvas-5.json', items: 0 },
      ],
    });
    expect(await read('settings.json')).toEqual(board().meta);
    const third = (await read('canvas-3.json')) as { canvas: number; items: object[] };
    expect(third.canvas).toBe(3);
    expect(third.items[0]).toMatchObject({
      id: 'p.3',
      data: 'images/p.3.png',
      file: { name: 'report.pdf', path: 'files/report (2).pdf' },
    });
    expect(third.items[0]).not.toHaveProperty('page');
    // No base64 anywhere: the photo and the documents are files of their own.
    expect(text(await parts.get('canvas-1.json')!())).not.toContain('base64');
    expect([...(await parts.get('images/p.2.png')!()).subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    expect([...(await parts.get('files/report.pdf')!())]).toEqual([1, 2, 3]);
    expect([...(await parts.get('files/report (2).pdf')!())]).toEqual([4, 5]);
  });

  it('reads back the board file it was made from', async () => {
    const zip = await bytesOf((await writeBoardArchive(board())).blob);
    const back = await readBoardArchive(zip);
    expect(back.meta).toEqual(board().meta);
    expect(back.saved).toBe('2026-10-31T10:00:00.000Z');
    expect(back.items).toHaveLength(4);
    const p3 = back.items.find((i) => i.id === 'p.3') as unknown as Record<string, unknown>;
    expect(p3).toMatchObject({ page: 2, data: PNG, file: { name: 'report.pdf', bytes: 2 } });
    expect((p3.file as object) ?? {}).not.toHaveProperty('path');
    expect(back.files.map((f) => [f.id, [...f.data]])).toEqual([
      ['p.2', [1, 2, 3]],
      ['p.3', [4, 5]],
    ]);
    expect(await readArchiveManifest(zip)).toMatchObject({ items: 4 });
  });

  it('opens a zip edited by hand: missing parts are left out, not fatal', async () => {
    const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
    const zip = await bytesOf(
      await makeZip([
        { name: 'manifest.json', data: enc({ format: ARCHIVE_FORMAT, version: 1 }) },
        {
          name: 'canvas-2.json',
          data: enc({
            items: [
              image('a.1', 'gone.pdf', 4),
              { ...image('a.2', 'x', 1), data: 'images/none.gif' },
              7,
            ],
          }),
        },
      ]),
    );
    const back = await readBoardArchive(zip);
    expect(back.meta).toEqual({});
    expect(back.files).toEqual([]);
    expect(back.items).toHaveLength(2);
    expect(back.items[0]).toMatchObject({ page: 1, data: PNG }); // a data URL stays as it is
    expect((back.items[1] as unknown as { data: string }).data).toBe(''); // the board drops it
  });

  it('refuses what is not a board zip, or comes from a newer version', async () => {
    const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
    const other = await bytesOf(await makeZip([{ name: 'word/document.xml', data: enc('x') }]));
    await expect(readBoardArchive(other)).rejects.toThrow(/not an inksplat board/);
    await expect(readBoardArchive(new Uint8Array([1, 2, 3]))).rejects.toThrow(/not an inksplat/);
    expect(await readArchiveManifest(other)).toBeNull();
    const newer = await bytesOf(
      await makeZip([{ name: 'manifest.json', data: enc({ format: ARCHIVE_FORMAT, version: 9 }) }]),
    );
    await expect(readBoardArchive(newer)).rejects.toThrow(/newer inksplat/);
  });
});
