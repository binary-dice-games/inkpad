// MIT License © 2026 Binary Dice Games (adapted by Carlos Lopez for inkpad)

export type Stamp = [number, string];

interface ItemBase {
  id: string;
  author: string;
  stamp: Stamp;
}

export interface InkItem extends ItemBase {
  kind: 'ink';
  /** Flat x0, y0, x1, y1, ... in board units. */
  points: number[];
  color: string;
  width: number;
}

export interface TextItem extends ItemBase {
  kind: 'text';
  x: number;
  y: number;
  size: number;
  text: string;
  color: string;
}

export interface StickerItem extends ItemBase {
  kind: 'sticker';
  x: number;
  y: number;
  size: number;
  name: string;
  /** Degrees, -180 to 180; absent: 0. */
  rot?: number;
}

/** A picture (a small PNG, JPEG or WebP data URL) dropped on the board; `size` is its width. */
export interface ImageItem extends ItemBase {
  kind: 'image';
  x: number;
  y: number;
  size: number;
  /** Height / width. */
  ratio: number;
  data: string;
  rot?: number;
}

export interface Tombstone extends ItemBase {
  deleted: true;
}

export type Item = InkItem | TextItem | StickerItem | ImageItem;
export type StoredItem = Item | Tombstone;

export type Operation = { t: 'put'; item: StoredItem } | { t: 'clear'; stamp: Stamp };

export interface Snapshot {
  v: 1;
  clock: number;
  clear: Stamp;
  items: StoredItem[];
}

export const LIMITS: Readonly<{
  items: number;
  points: number;
  text: number;
  snapshotBytes: number;
  images: number;
  imageChars: number;
  avatarChars: number;
}>;

/** A refused change (a limit, read-only), with a message for the user. */
export class WhiteboardError extends Error {}

/** The item if it is well formed, else null. */
export function cleanItem(item: unknown): StoredItem | null;

/** The data URL if it is a PNG, JPEG or WebP image of at most `maxChars` characters, else null. */
export function cleanImageData(value: unknown, maxChars?: number): string | null;

/**
 * Reads an image file into a data URL small enough to send, scaling it down until it fits
 * (`square` crops the middle, for an avatar). Throws a WhiteboardError if it is not an image the
 * browser can read or stays too big.
 */
export function fileToImageData(
  file: File,
  options?: { maxSide?: number; square?: boolean; maxChars?: number },
): Promise<{ data: string; width: number; height: number }>;

/** Simplifies a flat polyline (Ramer-Douglas-Peucker) and rounds it to 0.1. */
export function simplifyPoints(points: number[], tolerance?: number): number[];

export class WhiteboardModel {
  constructor(peerId: string);
  readonly peerId: string;
  clock: number;
  items: Map<string, StoredItem>;
  live(): Item[];
  get(id: string): Item | null;
  /** Ids changed, ['*'] for a clear that removed items, [] if nothing, null if malformed. */
  apply(op: unknown): string[] | null;
  add(fields: Record<string, unknown>): Operation;
  change(id: string, fields: Record<string, unknown>): Operation | null;
  remove(id: string): Operation | null;
  clear(): Operation;
  undo(): Operation | null;
  redo(): Operation | null;
  snapshot(): Snapshot;
  /** The operations that changed this model, or null if the snapshot is malformed. */
  merge(snapshot: unknown): Operation[] | null;
}

export function createModel(peerId: string): WhiteboardModel;

/** Built-in sticker symbols (24-unit SVG fragments), by name. */
export const STICKERS: Readonly<Record<string, string>>;

export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  hidden?: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Maps board units to the container's CSS pixels. */
export interface Adapter {
  element?: HTMLElement;
  transform(): Matrix | null;
  clip?(): Rect | null;
  onChange(cb: () => void): () => void;
  /** Zooms by `factor` about the point (x, y) of the container, in CSS pixels. */
  zoomAt?(x: number, y: number, factor: number): void;
  /** Moves the zoomed content by (dx, dy) CSS pixels. */
  panBy?(dx: number, dy: number): void;
  resetView?(): void;
  zoomed?(): boolean;
}

export interface FrameAdapter extends Adapter {
  /** Call when the aspect changes. */
  update(): void;
  zoomAt(x: number, y: number, factor: number): void;
  panBy(dx: number, dy: number): void;
  resetView(): void;
  zoomed(): boolean;
  view(): { scale: number; x: number; y: number };
}

/** The session surface a whiteboard needs: a Session or a SessionProxy. */
export interface WhiteboardSession {
  readonly role: 'host' | 'guest';
  readonly me: { id: string; color: string };
  peers(): { id: string; name: string; color: string }[];
  host?(): { id: string } | null;
  channel(name: string): {
    send(message: unknown, options?: { to?: string | null; fast?: boolean }): void;
    on(event: 'message', cb: (message: unknown, from: string) => void): () => void;
    on(event: 'join', cb: (peer: { id: string }) => void): () => void;
  };
  on(event: 'peers', cb: (peers: unknown[]) => void): () => void;
}

export type Tool = 'pointer' | 'pen' | 'text' | 'sticker' | 'eraser';

export interface WhiteboardOptions {
  session: WhiteboardSession;
  adapter?: Adapter;
  /** Default `wb`. */
  channel?: string;
  /** Show the toolbar; default true. */
  toolbar?: boolean;
  tools?: Tool[];
  stickers?: { name: string; svg: string }[];
  strings?: Record<string, string>;
  color?: string;
  readOnly?: boolean;
  /** This person's avatar (an image data URL), shown on their cursor instead of their name. */
  avatar?: string;
  /** Show the speaking queue; default true. */
  turns?: boolean;
}

export class Whiteboard {
  constructor(container: HTMLElement, options: WhiteboardOptions);
  readonly element: HTMLElement;
  readOnly: boolean;
  setTool(name: Tool): void;
  setStyle(style: { color?: string; width?: number; size?: number; sticker?: string }): void;
  setAdapter(adapter: Adapter): void;
  /**
   * The shortcut of the nth tool (1 is the first; the colour is last): selects it, and pressing
   * the tool in use again goes through its options.
   */
  chooseSlot(n: number): void;
  setAvatar(data: string | null): void;
  /** Puts this person at the end of the speaking queue. */
  requestTurn(): void;
  /** Takes this person out of the queue; the next one has the turn. */
  endTurn(): void;
  /** Peer ids waiting to speak; the first has the turn. */
  turnQueue(): string[];
  /** Host only: takes someone out of the queue. */
  removeFromQueue(id: string): void;
  resetZoom(): void;
  undo(): void;
  redo(): void;
  /** Clears the whiteboard for everyone. */
  clear(): void;
  snapshot(): Snapshot;
  /** Merges a snapshot (it does not replace what is here) and tells the others. */
  load(snapshot: unknown): void;
  items(): Item[];
  toSvg(box?: Rect): string;
  contentBounds(): Rect | null;
  on(event: 'change', cb: (e: { source: 'local' | 'remote' | 'load' }) => void): () => void;
  on(event: 'tool', cb: (name: Tool) => void): () => void;
  on(event: 'error', cb: (e: WhiteboardError) => void): () => void;
  on(event: 'queue', cb: (e: { ids: string[] }) => void): () => void;
  destroy(): void;
}

export function createWhiteboard(container: HTMLElement, options: WhiteboardOptions): Whiteboard;

/** The width of the frame in board units; its height is `FRAME_UNITS / aspect`. */
export const FRAME_UNITS: number;

/** The largest rectangle of `aspect` (width / height) centred in a width x height box. */
export function letterbox(width: number, height: number, aspect: number): Rect;

/** Maps board units onto the letterboxed frame inside `element`. */
export function frameAdapter(
  element: HTMLElement,
  aspect: () => number,
  /** The picture in the element (the video): zoomed with the frame. */
  content?: HTMLElement,
): FrameAdapter;

/**
 * A Session `accept` callback for the host: while `drawing()` is false,
 * viewers' changes are dropped; ops are rate limited per peer.
 */
export function drawingGate(
  drawing: () => boolean,
  options?: { channel?: string; opsPerSecond?: number; now?: () => number },
): (channel: string, message: unknown, from: string) => boolean;
