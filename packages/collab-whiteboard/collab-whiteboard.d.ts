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
}

export interface Tombstone extends ItemBase {
  deleted: true;
}

export type Item = InkItem | TextItem | StickerItem;
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
}>;

/** A refused change (a limit, read-only), with a message for the user. */
export class WhiteboardError extends Error {}

/** The item if it is well formed, else null. */
export function cleanItem(item: unknown): StoredItem | null;

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
}

export interface FrameAdapter extends Adapter {
  /** Call when the aspect changes. */
  update(): void;
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
}

export class Whiteboard {
  constructor(container: HTMLElement, options: WhiteboardOptions);
  readonly element: HTMLElement;
  readOnly: boolean;
  setTool(name: Tool): void;
  setStyle(style: { color?: string; width?: number; size?: number; sticker?: string }): void;
  setAdapter(adapter: Adapter): void;
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
  destroy(): void;
}

export function createWhiteboard(container: HTMLElement, options: WhiteboardOptions): Whiteboard;

/** The width of the frame in board units; its height is `FRAME_UNITS / aspect`. */
export const FRAME_UNITS: number;

/** The largest rectangle of `aspect` (width / height) centred in a width x height box. */
export function letterbox(width: number, height: number, aspect: number): Rect;

/** Maps board units onto the letterboxed frame inside `element`. */
export function frameAdapter(element: HTMLElement, aspect: () => number): FrameAdapter;

/**
 * A Session `accept` callback for the host: while `drawing()` is false,
 * viewers' changes are dropped; ops are rate limited per peer.
 */
export function drawingGate(
  drawing: () => boolean,
  options?: { channel?: string; opsPerSecond?: number; now?: () => number },
): (channel: string, message: unknown, from: string) => boolean;
