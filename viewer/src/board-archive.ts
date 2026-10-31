// MIT License © 2026 Binary Dice Games
/**
 * @file Board files as zips (`.inksplat.zip`), so anyone can open one with any zip tool and see
 * what is in it, and pictures and documents stay as they are instead of base64 in a JSON file:
 *
 *     manifest.json      what this is, when it was saved, what is in it
 *     settings.json      the page's settings for the board (the background of every canvas)
 *     canvas-1.json      the items of each canvas, one file per canvas (canvas-1 to canvas-5)
 *     images/<id>.jpg    the pictures on the board (photos, previews of documents)
 *     files/<name>       the documents pinned on the board, as they were dropped
 *
 * In the canvas files an image's `data` is the path of its picture in the zip, and the `file`
 * of a document has a `path` too. {@link readBoardArchive} turns a zip back into the board file
 * the whiteboard loads. See spec/06_static_presenter/DESIGN.md (Board files).
 */
import type { BoardFile, Item } from '@inksplat/collab-whiteboard';
import { CANVASES } from '@inksplat/defaults';
import { makeZip, zipParts } from './zip';
import type { ZipEntry } from './zip';

/** The `format` of the manifest of a board zip. */
export const ARCHIVE_FORMAT = 'inksplat-board-zip';
/** The version of the layout described above. */
export const ARCHIVE_VERSION = 1;
/** The most all the parts of a board zip together may unfold to. */
const UNPACKED_LIMIT = 64 * 1024 * 1024;
/** The largest picture of an image item (the whiteboard keeps them under 300000 base64 chars). */
const IMAGE_BYTES = 300_000;
/** The largest document (the whiteboard's limit for a file). */
const FILE_BYTES = 5 * 1024 * 1024;

/** The manifest of a board zip (`manifest.json`). */
export interface ArchiveManifest {
  format: typeof ARCHIVE_FORMAT;
  version: number;
  /** When it was saved (ISO 8601). */
  saved: string;
  /** The canvas files, with how many items each holds. */
  canvases: { canvas: number; path: string; items: number }[];
  /** How many items, pictures and documents the zip holds in all. */
  items: number;
  images: number;
  files: number;
}

/** A board saved as a zip. */
export interface BoardArchive {
  blob: Blob;
  /** How many items it holds (none: an empty board). */
  items: number;
  /** How many documents pinned on images it holds. */
  files: number;
}

const json = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

const IMAGE_TYPES: Record<string, string> = { png: 'png', jpeg: 'jpg', webp: 'webp' };
const EXTENSION_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; ++i) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/** A path segment safe in any zip tool: no folders, no leading dot, not empty. */
function safeName(name: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are what it removes
  const clean = name.replace(/[\u0000-\u001f\\/:*?"<>|]/g, '_').trim();
  return !clean ? 'file' : clean.startsWith('.') ? `_${clean}` : clean;
}

/** `name`, or `name (2).ext` and so on when a file of that name (in any case) is taken. */
function uniqueName(name: string, taken: Set<string>): string {
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  let candidate = name;
  for (let n = 2; taken.has(candidate.toLowerCase()); ++n) {
    candidate = `${stem} (${n})${ext}`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/**
 * The zip of a saved board (from `saveBoard(meta, { binary: true })`; base64 files are decoded
 * too).
 */
export async function writeBoardArchive(board: BoardFile): Promise<BoardArchive> {
  const fileData = new Map<string, Uint8Array>();
  for (const f of board.files) {
    fileData.set(f.id, typeof f.data === 'string' ? fromBase64(f.data) : f.data);
  }
  const canvases: Record<string, unknown>[][] = Array.from({ length: CANVASES }, () => []);
  const pictures: ZipEntry[] = [];
  const documents: ZipEntry[] = [];
  const pictureNames = new Set<string>();
  const documentNames = new Set<string>();
  for (const item of board.items) {
    const { page, ...rest } = item as Item & { page?: number };
    const entry: Record<string, unknown> = { ...rest };
    if (item.kind === 'image') {
      const m = /^data:image\/(png|jpeg|webp);base64,(.*)$/.exec(item.data);
      if (m) {
        const name = uniqueName(`${safeName(item.id)}.${IMAGE_TYPES[m[1]!]}`, pictureNames);
        pictures.push({ name: `images/${name}`, data: fromBase64(m[2]!) });
        entry.data = `images/${name}`;
      }
      const bytes = fileData.get(item.id);
      if (item.file && bytes) {
        const name = uniqueName(safeName(item.file.name), documentNames);
        documents.push({ name: `files/${name}`, data: bytes });
        entry.file = { ...item.file, path: `files/${name}` };
      }
    }
    const canvas = Number.isInteger(page) && page! > 0 && page! < CANVASES ? page! : 0;
    canvases[canvas]!.push(entry);
  }
  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    saved: board.saved,
    canvases: canvases.map((items, i) => ({
      canvas: i + 1,
      path: `canvas-${i + 1}.json`,
      items: items.length,
    })),
    items: board.items.length,
    images: pictures.length,
    files: documents.length,
  };
  const blob = await makeZip([
    { name: 'manifest.json', data: json(manifest), compress: true },
    { name: 'settings.json', data: json(board.meta), compress: true },
    ...canvases.map((items, i) => ({
      name: `canvas-${i + 1}.json`,
      data: json({ canvas: i + 1, items }),
      compress: true,
    })),
    ...pictures,
    ...documents,
  ]);
  return { blob, items: board.items.length, files: documents.length };
}

/** The parts of a board zip, read within {@link UNPACKED_LIMIT}. */
function archiveReader(bytes: Uint8Array) {
  const parts = zipParts(bytes);
  let unpacked = 0;
  const read = async (name: string): Promise<Uint8Array | null> => {
    const part = parts.get(name);
    if (!part) {
      return null;
    }
    const data = await part();
    unpacked += data.length;
    if (unpacked > UNPACKED_LIMIT) {
      throw new Error('That board file is too large.');
    }
    return data;
  };
  const readJson = async (name: string): Promise<unknown> => {
    const data = await read(name);
    if (!data) {
      return undefined;
    }
    try {
      return JSON.parse(new TextDecoder().decode(data)) as unknown;
    } catch {
      return undefined;
    }
  };
  return { read, readJson };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The manifest of a board zip, or null when `bytes` is not one.
 */
export async function readArchiveManifest(bytes: Uint8Array): Promise<ArchiveManifest | null> {
  try {
    const manifest = await archiveReader(bytes).readJson('manifest.json');
    return isRecord(manifest) && manifest.format === ARCHIVE_FORMAT
      ? (manifest as unknown as ArchiveManifest)
      : null;
  } catch {
    return null;
  }
}

/**
 * The board file in a board zip, for the whiteboard's `loadBoard` (pictures as data URLs, documents
 * as bytes). Pictures and documents that are missing or too large are left out; the whiteboard
 * checks the items themselves.
 *
 * @throws {Error} when `bytes` is not a board zip, is of a newer version, or unfolds too large
 */
export async function readBoardArchive(bytes: Uint8Array): Promise<BoardFile> {
  let reader: ReturnType<typeof archiveReader>;
  let manifest: unknown;
  try {
    reader = archiveReader(bytes);
    manifest = await reader.readJson('manifest.json');
  } catch {
    throw new Error('That is not an inksplat board file.');
  }
  if (!isRecord(manifest) || manifest.format !== ARCHIVE_FORMAT) {
    throw new Error('That is not an inksplat board file.');
  }
  if (typeof manifest.version !== 'number' || manifest.version > ARCHIVE_VERSION) {
    throw new Error('That board file comes from a newer inksplat: update the page to open it.');
  }
  const settings = await reader.readJson('settings.json');
  const items: Item[] = [];
  const files: { id: string; data: Uint8Array }[] = [];
  for (let canvas = 1; canvas <= CANVASES; ++canvas) {
    const content = await reader.readJson(`canvas-${canvas}.json`);
    const list = isRecord(content) && Array.isArray(content.items) ? content.items : [];
    for (const raw of list as unknown[]) {
      if (!isRecord(raw)) {
        continue;
      }
      const item: Record<string, unknown> = { ...raw };
      delete item.page;
      if (canvas > 1) {
        item.page = canvas - 1;
      }
      if (
        item.kind === 'image' &&
        typeof item.data === 'string' &&
        !item.data.startsWith('data:')
      ) {
        const ext = /\.([a-z]+)$/.exec(item.data)?.[1] ?? '';
        const picture = EXTENSION_TYPES[ext] ? await reader.read(item.data) : null;
        item.data =
          picture && picture.length <= IMAGE_BYTES
            ? `data:${EXTENSION_TYPES[ext]};base64,${toBase64(picture)}`
            : '';
      }
      if (item.kind === 'image' && isRecord(item.file)) {
        const { path, ...file } = item.file;
        item.file = file;
        const data = typeof path === 'string' ? await reader.read(path) : null;
        if (data && data.length <= FILE_BYTES && typeof item.id === 'string') {
          files.push({ id: item.id, data });
        }
      }
      items.push(item as unknown as Item);
    }
  }
  return {
    format: 'inksplat-board',
    version: 1,
    saved: typeof manifest.saved === 'string' ? manifest.saved : new Date().toISOString(),
    meta: isRecord(settings) ? settings : {},
    items,
    files,
  };
}
