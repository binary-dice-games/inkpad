// MIT License © 2026 Binary Dice Games
/**
 * @file Zip files without a library: {@link zipParts} reads one (stored and deflated parts, as
 * Office files and board files have), {@link makeZip} writes one (JSON deflated, everything else
 * stored as it is). The browser's CompressionStream and DecompressionStream do the deflating.
 */

/** The most one part of a zip may unfold to (a zip bomb stops here). */
export const PART_LIMIT = 16 * 1024 * 1024;

/**
 * The parts of a zip: name to a function that unpacks it. Handles stored and deflated parts; a
 * part over {@link PART_LIMIT} unpacked, or in a zip64 archive, is left out.
 *
 * @throws {Error} when `bytes` is not a zip
 */
export function zipParts(bytes: Uint8Array): Map<string, () => Promise<Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); --i) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) {
    throw new Error('not a zip');
  }
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const text = new TextDecoder();
  const parts = new Map<string, () => Promise<Uint8Array>>();
  for (let n = 0; n < count && at + 46 <= bytes.length; ++n) {
    if (view.getUint32(at, true) !== 0x02014b50) {
      break;
    }
    const method = view.getUint16(at + 10, true);
    const packed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = text.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (packed === 0xffffffff || size === 0xffffffff || local + 30 > bytes.length) {
      continue; // zip64
    }
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + packed);
    if (method === 0 && size <= PART_LIMIT) {
      parts.set(name, () => Promise.resolve(data));
    } else if (method === 8 && size <= PART_LIMIT) {
      parts.set(name, () => inflate(data));
    }
  }
  return parts;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(data as BufferSource);
      controller.close();
    },
  }).pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.length;
    if (total > PART_LIMIT) {
      await reader.cancel();
      throw new Error('too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** A part of a zip to write. */
export interface ZipEntry {
  /** Its path in the zip, with `/` between folders. */
  name: string;
  data: Uint8Array;
  /** Deflate it (for text); otherwise it is stored as it is (pictures and documents are packed already). */
  compress?: boolean;
}

let crcTable: Uint32Array | undefined;

/** The CRC-32 of `bytes`, as zip files keep it. */
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; ++n) {
      let c = n;
      for (let k = 0; k < 8; ++k) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }
  const table = crcTable;
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; ++i) {
    crc = table[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** `data` deflated (raw), or null where the browser cannot. */
async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([data as BlobPart])
      .stream()
      .pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * A zip of `entries`, in their order. Names are UTF-8; times are left at the zip epoch (1980), so
 * the same board makes the same bytes.
 *
 * @throws {Error} when the zip would need zip64 (over 4 GB, or 65535 entries)
 */
export async function makeZip(entries: ZipEntry[]): Promise<Blob> {
  if (entries.length > 0xffff) {
    throw new Error('too many parts for a zip');
  }
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const packed = entry.compress ? await deflate(entry.data) : null;
    const method = packed && packed.length < entry.data.length ? 8 : 0;
    const data = method === 8 ? packed! : entry.data;
    const crc = crc32(entry.data);
    const local = new Uint8Array(30);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true); // version needed: 2.0
    l.setUint16(6, 0x0800, true); // the name is UTF-8
    l.setUint16(8, method, true);
    l.setUint16(12, 0x21, true); // 1980-01-01
    l.setUint32(14, crc, true);
    l.setUint32(18, data.length, true);
    l.setUint32(22, entry.data.length, true);
    l.setUint16(26, name.length, true);
    const record = new Uint8Array(46);
    const c = new DataView(record.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, method, true);
    c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, entry.data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    chunks.push(local, name, data);
    central.push(record, name);
    offset += 30 + name.length + data.length;
    if (offset > 0xffffffff) {
      throw new Error('too large for a zip');
    }
  }
  const size = central.reduce((n, part) => n + part.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, end] as BlobPart[], { type: 'application/zip' });
}
