// MIT License © 2026 Binary Dice Games (adapted by Carlos Lopez for inkpad)
/**
 * @file collab-whiteboard.js A shared whiteboard over any element:
 * everyone's cursors, freehand ink, text notes and stickers, synced over any
 * session-like transport. It imports nothing.
 *
 * Provenance: copied from binary-dice-games/nymph, web/collab/collab-whiteboard.js
 * at commit 13de939afdd5b52f35b1bbd8ef90cd677c3ae844 (2026-10). Changes:
 * emoticon stickers, `frameAdapter` (board units = a frame 1000 units wide,
 * see spec/01_core_features/DESIGN.md section 4.2) and `drawingGate` (the
 * host-side lock on viewers' changes).
 *
 *   import { createWhiteboard } from './collab-whiteboard.js';
 *   const wb = createWhiteboard(container, { session, adapter });
 *   wb.setTool('pen');
 *
 * Items are stored in content units the host defines (the adapter's
 * transform maps them to the screen), and merged per item, last writer
 * wins, so every peer converges whatever the order the changes arrive in.
 */

// ── Limits and validation ─────────────────────────────────────────────────────

/** The model's limits (DESIGN.md section 3.6). */
export const LIMITS = Object.freeze({
  items: 2000,
  points: 5000,
  text: 500,
  snapshotBytes: 1 << 20,
});

/** A refused change (a limit, read-only), with a message for the user. */
export class WhiteboardError extends Error {}

const ID = /^[A-Za-z0-9_.-]{1,64}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const STICKER = /^[a-z0-9-]{1,32}$/;
const KINDS = new Set(['ink', 'text', 'sticker']);
const finite = (n, lo = -1e6, hi = 1e6) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;

function validStamp(s) {
  return Array.isArray(s) && s.length === 2 && Number.isInteger(s[0]) && s[0] >= 0 && typeof s[1] === 'string' && ID.test(s[1]);
}

/** Orders stamps: the clock, then the peer id. */
function compareStamps(a, b) {
  if (a[0] !== b[0]) {
    return a[0] - b[0];
  }
  return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
}

/**
 * The item if it is well formed, else null. Only the known fields of its
 * kind are kept, so nothing a peer adds reaches the renderer.
 */
export function cleanItem(item) {
  if (!item || typeof item !== 'object' || !ID.test(item.id ?? '') || !ID.test(item.author ?? '') || !validStamp(item.stamp)) {
    return null;
  }
  const base = { id: item.id, author: item.author, stamp: [item.stamp[0], item.stamp[1]] };
  if (item.deleted === true) {
    return { ...base, deleted: true };
  }
  if (!KINDS.has(item.kind)) {
    return null;
  }
  base.kind = item.kind;
  if (item.kind === 'ink') {
    const p = item.points;
    if (!Array.isArray(p) || p.length < 2 || p.length % 2 !== 0 || p.length > LIMITS.points * 2 || !p.every((n) => finite(n))) {
      return null;
    }
    if (!COLOR.test(item.color ?? '') || !finite(item.width, 0.5, 64)) {
      return null;
    }
    return { ...base, points: p.slice(), color: item.color, width: item.width };
  }
  if (!finite(item.x) || !finite(item.y) || !finite(item.size, 4, 400)) {
    return null;
  }
  if (item.kind === 'text') {
    if (typeof item.text !== 'string' || item.text.length === 0 || item.text.length > LIMITS.text || !COLOR.test(item.color ?? '')) {
      return null;
    }
    return { ...base, x: item.x, y: item.y, size: item.size, text: item.text, color: item.color };
  }
  if (!STICKER.test(item.name ?? '')) {
    return null;
  }
  return { ...base, x: item.x, y: item.y, size: item.size, name: item.name };
}

// ── Points ────────────────────────────────────────────────────────────────────

/**
 * Simplifies a flat [x0, y0, x1, y1, ...] polyline (Ramer-Douglas-Peucker,
 * `tolerance` content units) and rounds it to 0.1.
 */
export function simplifyPoints(points, tolerance = 0.4) {
  const n = points.length / 2;
  if (n <= 2) {
    return points.map(round1);
  }
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  const t2 = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = points[a * 2];
    const ay = points[a * 2 + 1];
    const dx = points[b * 2] - ax;
    const dy = points[b * 2 + 1] - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; ++i) {
      const px = points[i * 2] - ax;
      const py = points[i * 2 + 1] - ay;
      let d2;
      if (len2 === 0) {
        d2 = px * px + py * py;
      } else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const ex = px - t * dx;
        const ey = py - t * dy;
        d2 = ex * ex + ey * ey;
      }
      if (d2 > worst) {
        worst = d2;
        at = i;
      }
    }
    if (worst > t2) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; ++i) {
    if (keep[i]) {
      out.push(round1(points[i * 2]), round1(points[i * 2 + 1]));
    }
  }
  return out;
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

// ── Model ─────────────────────────────────────────────────────────────────────

/**
 * The whiteboard's state: items merged per id, last writer (largest
 * stamp) wins, deletes kept as tombstones, Clear as a stamp that removes
 * every older item. Applying the same operations in any order, any
 * number of times, gives the same state.
 *
 * Operations: {t: 'put', item} (add, change or delete one item, whole) and
 * {t: 'clear', stamp}.
 */
export class WhiteboardModel {
  /** @param {string} peerId this peer's id: new items' ids and stamps */
  constructor(peerId) {
    if (!ID.test(peerId ?? '')) {
      throw new WhiteboardError('a whiteboard needs a peer id of letters, digits, ".", "_" and "-"');
    }
    this.peerId = peerId;
    this.clock = 0;
    this.counter = 0;
    this.items = new Map();
    this.clearStamp = [0, ''];
    this.undoStack = [];
    this.redoStack = [];
  }

  /** The items not deleted, oldest stamp first (the drawing order). */
  live() {
    return [...this.items.values()].filter((i) => !i.deleted).sort((a, b) => compareStamps(a.stamp, b.stamp));
  }

  get(id) {
    const item = this.items.get(id);
    return item && !item.deleted ? item : null;
  }

  /** @private A new stamp, after everything seen. */
  stamp() {
    this.clock += 1;
    return [this.clock, this.peerId];
  }

  /**
   * Applies an operation from anywhere; returns the ids it changed (or
   * ['*'] for a clear that removed something), [] when it changed nothing,
   * or null when it is malformed.
   */
  apply(op) {
    if (!op || typeof op !== 'object') {
      return null;
    }
    if (op.t === 'clear') {
      if (!validStamp(op.stamp)) {
        return null;
      }
      this.clock = Math.max(this.clock, op.stamp[0]);
      if (compareStamps(op.stamp, this.clearStamp) <= 0) {
        return [];
      }
      this.clearStamp = [op.stamp[0], op.stamp[1]];
      let removed = false;
      for (const [id, item] of this.items) {
        if (compareStamps(item.stamp, this.clearStamp) < 0) {
          this.items.delete(id);
          removed = true;
        }
      }
      return removed ? ['*'] : [];
    }
    if (op.t !== 'put') {
      return null;
    }
    const item = cleanItem(op.item);
    if (!item) {
      return null;
    }
    this.clock = Math.max(this.clock, item.stamp[0]);
    if (compareStamps(item.stamp, this.clearStamp) < 0) {
      return [];
    }
    const old = this.items.get(item.id);
    if (old && compareStamps(item.stamp, old.stamp) <= 0) {
      return [];
    }
    this.items.set(item.id, item);
    return [item.id];
  }

  /**
   * Adds an item made here: `fields` without id, author or stamp. Returns
   * the operation to send. Throws a WhiteboardError past the limits.
   */
  add(fields) {
    if (this.live().length >= LIMITS.items) {
      throw new WhiteboardError(`The whiteboard is full (${LIMITS.items} items): erase some first.`);
    }
    this.counter += 1;
    const id = `${this.peerId}.${this.counter}`;
    return this.put(null, { ...fields, id, author: this.peerId });
  }

  /** Changes an item (any author's): `fields` replace its own. */
  change(id, fields) {
    const old = this.get(id);
    if (!old) {
      return null;
    }
    return this.put(old, { ...old, ...fields, id, author: old.author });
  }

  /** Deletes an item. */
  remove(id) {
    const old = this.get(id);
    if (!old) {
      return null;
    }
    return this.put(old, { id, author: old.author, deleted: true });
  }

  /** @private Puts `next` with a new stamp, recording `before` for undo. */
  put(before, next, { record = true } = {}) {
    const item = cleanItem({ ...next, stamp: this.stamp() });
    if (!item) {
      throw new WhiteboardError('That item is not valid (too many points, too long a text, or a bad colour).');
    }
    const op = { t: 'put', item };
    this.apply(op);
    if (record) {
      this.undoStack.push({ before, after: item });
      if (this.undoStack.length > 200) {
        this.undoStack.shift();
      }
      this.redoStack = [];
    }
    return op;
  }

  /** Clears the whiteboard for everyone; returns the operation. */
  clear() {
    this.clock += 1;
    const op = { t: 'clear', stamp: [this.clock, this.peerId] };
    this.apply(op);
    this.undoStack = [];
    this.redoStack = [];
    return op;
  }

  /** Undoes this peer's last change (as a new operation), or null. */
  undo() {
    const entry = this.undoStack.pop();
    if (!entry) {
      return null;
    }
    this.redoStack.push(entry);
    const { before, after } = entry;
    const restored = before ? { ...before } : { id: after.id, author: after.author, deleted: true };
    return this.put(null, restored, { record: false });
  }

  /** Redoes what undo() took back, or null. */
  redo() {
    const entry = this.redoStack.pop();
    if (!entry) {
      return null;
    }
    this.undoStack.push(entry);
    return this.put(null, { ...entry.after }, { record: false });
  }

  /** A JSON snapshot that merge() takes back: items, tombstones, clear stamp. */
  snapshot() {
    return { v: 1, clock: this.clock, clear: this.clearStamp, items: [...this.items.values()] };
  }

  /**
   * Merges a snapshot (from a peer, or kept from before); returns the ops
   * that changed this state, for relaying.
   */
  merge(snapshot) {
    if (!snapshot || snapshot.v !== 1 || !Array.isArray(snapshot.items)) {
      return null;
    }
    const changed = [];
    if (validStamp(snapshot.clear) && snapshot.clear[0] > 0) {
      const op = { t: 'clear', stamp: snapshot.clear };
      if (this.apply(op)?.length) {
        changed.push(op);
      }
    }
    for (const item of snapshot.items.slice(0, LIMITS.items * 4)) {
      const op = { t: 'put', item };
      if (this.apply(op)?.length) {
        changed.push(op);
      }
    }
    if (Number.isInteger(snapshot.clock)) {
      this.clock = Math.max(this.clock, snapshot.clock);
    }
    return changed;
  }
}

/** A model for `peerId` (also for tests). */
export function createModel(peerId) {
  return new WhiteboardModel(peerId);
}

// ── Stickers ──────────────────────────────────────────────────────────────────

const LINE = 'fill="none" stroke="#1c2024" stroke-width="1.9" stroke-linecap="round"';
const EYES = '<circle cx="8.6" cy="10" r="1.5" fill="#1c2024"/><circle cx="15.4" cy="10" r="1.5" fill="#1c2024"/>';

/** An emoticon: a round face (`fill`) with the given features. */
function face(features, fill = '#ffc53d') {
  return `<circle cx="12" cy="12" r="11" fill="${fill}" stroke="#b97300" stroke-width="1"/>${features}`;
}

/**
 * Built-in stickers: 24-unit SVG symbols, drawn the same on every system
 * (not emoji glyphs, which differ per OS).
 */
export const STICKERS = Object.freeze({
  check: '<circle cx="12" cy="12" r="11" fill="#30a46c"/><path d="M6.5 12.5l3.5 3.5 7.5-8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  cross: '<circle cx="12" cy="12" r="11" fill="#e5484d"/><path d="M8 8l8 8M16 8l-8 8" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>',
  question: '<circle cx="12" cy="12" r="11" fill="#3e63dd"/><path d="M9.2 9.3a2.9 2.9 0 1 1 4.2 2.6c-.9.5-1.4 1.1-1.4 2.1v.6" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round"/><circle cx="12" cy="17.6" r="1.4" fill="#fff"/>',
  star: '<path d="M12 1.8l3.1 6.4 7 1-5.1 4.9 1.2 7L12 17.8l-6.2 3.3 1.2-7L1.9 9.2l7-1z" fill="#f5a524" stroke="#b97300" stroke-width="1" stroke-linejoin="round"/>',
  heart: '<path d="M12 21.3S2.2 15.2 2.2 8.6A5 5 0 0 1 12 6.2a5 5 0 0 1 9.8 2.4c0 6.6-9.8 12.7-9.8 12.7z" fill="#e93d82"/>',
  'thumbs-up': '<path d="M2.5 10.5h4v11h-4z" fill="#f5a524"/><path d="M7.5 21.5h9.6a2.4 2.4 0 0 0 2.3-1.8l1.8-6.6A2.4 2.4 0 0 0 18.9 10H14l.8-4a2.2 2.2 0 0 0-4.1-1.4L7.5 10.6z" fill="#ffc53d" stroke="#b97300" stroke-width="1" stroke-linejoin="round"/>',
  warning: '<path d="M12 2.2l10.6 19H1.4z" fill="#ffc53d" stroke="#b97300" stroke-width="1.2" stroke-linejoin="round"/><path d="M12 9v5.5" stroke="#1c2024" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="18" r="1.4" fill="#1c2024"/>',
  arrow: '<path d="M3 12h13M11 5.5L17.5 12 11 18.5" fill="none" stroke="#1c2024" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  smile: face(`${EYES}<path d="M7 14.2q5 5.2 10 0" ${LINE}/>`),
  laugh: face('<path d="M6.5 10.2q2-2.6 4 0M13.5 10.2q2-2.6 4 0" ' + LINE + '/><path d="M6.5 13.4h11a5.5 5.5 0 0 1-11 0z" fill="#1c2024"/>'),
  wink: face(`<circle cx="8.6" cy="9.6" r="1.5" fill="#1c2024"/><path d="M13.6 9.8h3.8" ${LINE}/><path d="M7 14.2q5 5.2 10 0" ${LINE}/>`),
  sad: face(`${EYES}<path d="M8 17.4q4-4.2 8 0" ${LINE}/>`),
  surprised: face(`${EYES}<ellipse cx="12" cy="16.4" rx="2.1" ry="2.7" fill="#1c2024"/>`),
  angry: face(`<path d="M6.3 7.3l4.4 2.1M17.7 7.3l-4.4 2.1" ${LINE}/><circle cx="8.6" cy="11" r="1.4" fill="#1c2024"/><circle cx="15.4" cy="11" r="1.4" fill="#1c2024"/><path d="M8 17.2q4-3.2 8 0" ${LINE}/>`, '#ff9d5c'),
  cool: face(`<path d="M4.3 8.4h15.4v3.3a2.6 2.6 0 0 1-2.6 2.6h-1.4a2.6 2.6 0 0 1-2.6-2.6h-1.4a2.6 2.6 0 0 1-2.6 2.6H6.9a2.6 2.6 0 0 1-2.6-2.6z" fill="#1c2024"/><path d="M7 16q5 4.4 10 0" ${LINE}/>`),
  thinking: face(`<circle cx="8.6" cy="10.4" r="1.5" fill="#1c2024"/><circle cx="15.4" cy="10.4" r="1.5" fill="#1c2024"/><path d="M12.6 6.6l4.8-1.2" ${LINE}/><path d="M9 16.6h5.6" ${LINE}/>`),
});

const PLACEHOLDER = '<circle cx="12" cy="12" r="10.5" fill="#d9d9e0" stroke="#8b8d98" stroke-dasharray="3 2"/><text x="12" y="16.5" font-size="12" text-anchor="middle" fill="#60646c" font-family="sans-serif">?</text>';

// ── Overlay ───────────────────────────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';
const PALETTE = ['#e5484d', '#f5a524', '#30a46c', '#0f9f86', '#3e63dd', '#8e4ec6', '#1c2024'];

/** Labels a host can translate (`strings` option). */
const STRINGS = {
  pointer: 'Pointer: use the page below (Esc)',
  pen: 'Pen',
  text: 'Text note',
  sticker: 'Sticker',
  eraser: 'Eraser',
  undo: 'Undo (Ctrl+Z)',
  redo: 'Redo (Ctrl+Y)',
  clear: 'Clear the whiteboard for everyone',
  color: 'Colour',
  readOnly: 'Drawing is locked',
  typeHere: 'Type, then Enter (Shift+Enter for a new line)',
};

const ICONS = {
  pointer: '<path d="M5 3l14 7-6 1.8L10.5 18z" fill="currentColor"/>',
  pen: '<path d="M4 20l1-4L16 5l3 3L8 19z M14 7l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  sticker: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  eraser: '<path d="M8 20h12M4.5 15.5l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 18H7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  undo: '<path d="M9 7L4 12l5 5M4 12h10a6 6 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" transform="translate(0 -3)"/>',
  redo: '<path d="M15 7l5 5-5 5M20 12H10a6 6 0 0 0 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" transform="translate(0 -3)"/>',
  clear: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
};

const STYLE = `
:host { all: initial; position: absolute; inset: 0; pointer-events: none; z-index: 5;
  --wb-bg: #ffffff; --wb-fg: #1c2024; --wb-border: #d9d9e0; --wb-accent: #0f9f86; --wb-hover: #f0f0f3;
  font: 13px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; }
@media (prefers-color-scheme: dark) { :host { --wb-bg: #18191b; --wb-fg: #edeef0; --wb-border: #363a3f; --wb-hover: #272a2d; } }
svg.board { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
svg.board.active { pointer-events: auto; touch-action: none; }
svg.board.active .item { pointer-events: visiblePainted; }
svg.board.active .item .hit { pointer-events: stroke; }
svg.board.pen { cursor: crosshair; } svg.board.text { cursor: text; } svg.board.sticker { cursor: copy; }
svg.board.eraser { cursor: cell; }
svg.board.text .item.text-item, svg.board.sticker .item.sticker-item { cursor: move; }
.capture { fill: transparent; }
.item text { white-space: pre; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; paint-order: stroke; stroke: #ffffff; stroke-width: 0.25em; stroke-linejoin: round; }
.item.erasing { opacity: 0.3; }
.cursors { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.cursor { position: absolute; left: 0; top: 0; will-change: transform; transition: transform 60ms linear; }
.cursor svg { display: block; filter: drop-shadow(0 1px 1px rgba(0,0,0,.35)); }
.cursor span { position: absolute; left: 14px; top: 16px; padding: 1px 6px; border-radius: 6px; color: #fff; font-size: 11px; white-space: nowrap; max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
.toolbar { position: absolute; left: 8px; top: 8px; display: flex; flex-direction: column; gap: 2px; padding: 4px; border-radius: 10px;
  background: var(--wb-bg); color: var(--wb-fg); border: 1px solid var(--wb-border); box-shadow: 0 2px 10px rgba(0,0,0,.15); pointer-events: auto; }
.toolbar button { all: unset; box-sizing: border-box; width: 32px; height: 32px; border-radius: 7px; display: grid; place-items: center; cursor: pointer; color: inherit; }
.toolbar button:hover { background: var(--wb-hover); }
.toolbar button:focus-visible { outline: 2px solid var(--wb-accent); outline-offset: -2px; }
.toolbar button[aria-pressed="true"] { background: var(--wb-accent); color: #fff; }
.toolbar button:disabled { opacity: .35; cursor: default; background: none; }
.toolbar hr { border: 0; border-top: 1px solid var(--wb-border); margin: 3px 2px; }
.toolbar .swatch { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--wb-bg); box-shadow: 0 0 0 1px var(--wb-border); }
.toolbar svg { width: 20px; height: 20px; }
.locked { font-size: 11px; padding: 4px; max-width: 32px; text-align: center; opacity: .75; }
.pop { position: absolute; left: 52px; display: grid; grid-template-columns: repeat(4, 34px); gap: 2px; padding: 4px; border-radius: 10px;
  background: var(--wb-bg); border: 1px solid var(--wb-border); box-shadow: 0 2px 10px rgba(0,0,0,.15); pointer-events: auto; }
.pop[hidden] { display: none; }
.pop button { all: unset; width: 34px; height: 34px; border-radius: 7px; display: grid; place-items: center; cursor: pointer; }
.pop button:hover, .pop button[aria-pressed="true"] { background: var(--wb-hover); }
.pop .swatch { width: 20px; height: 20px; border-radius: 50%; }
textarea.note { position: absolute; margin: 0; padding: 2px 4px; border: 1px dashed var(--wb-accent); border-radius: 4px; background: rgba(255,255,255,.92);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.2; resize: none; overflow: hidden; outline: none; pointer-events: auto; min-width: 4em; transform-origin: 0 0; }
`;

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    node.setAttribute(k, String(v));
  }
  return node;
}

function htmlEl(tag, attrs = {}, html) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null && v !== false) {
      node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  if (html !== undefined) {
    node.innerHTML = html; // only the package's own icons and the host's stickers
  }
  return node;
}

/** The smoothed path of a flat polyline (quadratic curves through midpoints). */
function inkPath(p) {
  if (p.length < 4) {
    return `M${p[0]} ${p[1]}l0.01 0`;
  }
  let d = `M${p[0]} ${p[1]}`;
  for (let i = 2; i < p.length - 2; i += 2) {
    const mx = round1((p[i] + p[i + 2]) / 2);
    const my = round1((p[i + 1] + p[i + 3]) / 2);
    d += `Q${p[i]} ${p[i + 1]} ${mx} ${my}`;
  }
  return `${d}L${p[p.length - 2]} ${p[p.length - 1]}`;
}

/** The default adapter: the container's box, one unit per CSS pixel at the start. */
function boxAdapter(element) {
  const r = element.getBoundingClientRect();
  const w0 = r.width || 1;
  return {
    element,
    transform: () => {
      const s = (element.getBoundingClientRect().width || w0) / w0;
      return { a: s, b: 0, c: 0, d: s, e: 0, f: 0 };
    },
    onChange: (cb) => {
      if (typeof ResizeObserver !== 'function') {
        return () => {};
      }
      const ro = new ResizeObserver(() => cb());
      ro.observe(element);
      return () => ro.disconnect();
    },
  };
}

/**
 * The whiteboard over `container` (DESIGN.md section 5.2).
 */
export class Whiteboard {
  /**
   * @param {HTMLElement} container the element drawn over (made a positioning parent)
   * @param {{adapter?, session, channel?: string, toolbar?: boolean, tools?: string[],
   *          stickers?: {name: string, svg: string}[], strings?: object,
   *          color?: string, readOnly?: boolean}} options
   */
  constructor(container, options = {}) {
    if (!options.session) {
      throw new WhiteboardError('a whiteboard needs a session (me, peers(), on(), channel())');
    }
    this.container = container;
    this.session = options.session;
    this.strings = { ...STRINGS, ...(options.strings ?? {}) };
    this.tools = (options.tools ?? ['pointer', 'pen', 'text', 'sticker', 'eraser']).filter((t) => t in ICONS);
    if (!this.tools.includes('pointer')) {
      this.tools.unshift('pointer');
    }
    this.stickers = new Map(Object.entries(STICKERS));
    for (const s of options.stickers ?? []) {
      if (STICKER.test(s.name ?? '') && typeof s.svg === 'string') {
        this.stickers.set(s.name, s.svg); // the host's, never a peer's
      }
    }
    this.model = new WhiteboardModel(this.session.me.id);
    this.listeners = new Map();
    this.tool = 'pointer';
    const own = this.session.me.color;
    this.style = { color: COLOR.test(own ?? '') ? own : PALETTE[0], width: 3, size: 28, sticker: 'check' };
    this.readOnlyFlag = !!options.readOnly;
    this.nodes = new Map(); // item id -> SVG node
    this.liveInk = new Map(); // `${peer}:${id}` -> {node, points, seq}
    this.cursors = new Map(); // peer id -> {node, x, y, timer}
    this.cleanups = [];
    this.lastCursorSent = 0;
    this.inkSeq = 0;
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }
    this.buildDom(options.toolbar !== false);
    this.setAdapter(options.adapter ?? boxAdapter(container));
    this.wireSession(options.channel ?? 'wb');
    this.wireInput();
    this.render();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /** `pointer` lets input through to the page; the others draw. */
  setTool(name) {
    if (!this.tools.includes(name) || (this.readOnlyFlag && name !== 'pointer')) {
      return;
    }
    this.finishText();
    this.tool = name;
    this.board.setAttribute('class', `board ${name}${name === 'pointer' ? '' : ' active'}`);
    this.popover.hidden = true;
    this.renderToolbar();
    this.emit('tool', name);
  }

  /** The style of new items: {color, width, size, sticker}. */
  setStyle(style) {
    if (style.color && COLOR.test(style.color)) {
      this.style.color = style.color;
    }
    for (const k of ['width', 'size']) {
      if (finite(style[k], 0.5, 400)) {
        this.style[k] = style[k];
      }
    }
    if (style.sticker && this.stickers.has(style.sticker)) {
      this.style.sticker = style.sticker;
    }
    this.renderToolbar();
  }

  /** The overlay element (a host that replaces the container's children puts it back). */
  get element() {
    return this.host;
  }

  get readOnly() {
    return this.readOnlyFlag;
  }

  /** A read-only whiteboard shows everything and draws nothing. */
  set readOnly(on) {
    this.readOnlyFlag = !!on;
    if (this.readOnlyFlag) {
      this.setTool('pointer');
    }
    this.renderToolbar();
  }

  /** Swaps the adapter (the host's figure moved to another element). */
  setAdapter(adapter) {
    this.unadapt?.();
    this.adapter = adapter;
    this.unadapt = adapter.onChange(() => this.place());
    this.place();
  }

  undo() {
    this.local(() => this.model.undo());
  }

  redo() {
    this.local(() => this.model.redo());
  }

  /** Clears the whiteboard for everyone. */
  clear() {
    if (!this.readOnlyFlag) {
      this.local(() => this.model.clear());
    }
  }

  snapshot() {
    return this.model.snapshot();
  }

  /** Merges a snapshot (it does not replace what is here) and tells the others. */
  load(snapshot) {
    const ops = this.model.merge(snapshot) ?? [];
    for (const op of ops) {
      this.send({ t: 'op', op });
    }
    this.render();
    if (ops.length) {
      this.emit('change', { source: 'load' });
    }
  }

  /** The live items, oldest first (for hosts: counts, notes). */
  items() {
    return this.model.live();
  }

  /**
   * The items as a standalone SVG document in content units: the viewBox
   * is `box` ({x, y, width, height}) or the items' bounds.
   */
  toSvg(box) {
    const items = this.model.live();
    const b = box ?? this.bounds(items);
    const svg = svgEl('svg', { xmlns: SVG_NS, viewBox: `${b.x} ${b.y} ${b.width} ${b.height}`, width: b.width, height: b.height });
    const used = new Set(items.filter((i) => i.kind === 'sticker').map((i) => i.name));
    if (used.size) {
      const defs = svgEl('defs');
      for (const name of used) {
        defs.append(this.symbol(name));
      }
      svg.append(defs);
    }
    for (const item of items) {
      const node = this.itemNode(item);
      node.querySelectorAll('.hit').forEach((h) => h.remove());
      node.removeAttribute('class');
      node.removeAttribute('data-id');
      svg.append(node);
    }
    return new XMLSerializer().serializeToString(svg);
  }

  /** The drawings' bounds in content units ({x, y, width, height}), or null when there are none. */
  contentBounds() {
    const items = this.model.live();
    return items.length ? this.bounds(items) : null;
  }

  /** "change" ({source: 'local' | 'remote' | 'load'}), "tool" (name). Returns an unsubscribe function. */
  on(event, cb) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(cb);
    return () => this.listeners.get(event)?.delete(cb);
  }

  destroy() {
    this.finishText();
    for (const c of this.cleanups) {
      c();
    }
    this.unadapt?.();
    for (const c of this.cursors.values()) {
      clearTimeout(c.timer);
    }
    this.host.remove();
    this.destroyed = true;
  }

  // ── Session ──────────────────────────────────────────────────────────────

  /** @private */
  wireSession(name) {
    this.channel = this.session.channel(name);
    this.cleanups.push(
      this.channel.on('message', (m, from) => this.received(m, from)),
      // A peer joined (or this guest reached the host): swap snapshots,
      // so both sides end up with everything (DESIGN.md section 3.6).
      this.channel.on('join', (peer) => this.channel.send({ t: 'sync', snapshot: this.model.snapshot() }, { to: peer.id })),
      this.session.on('peers', () => this.prunePeers()),
    );
    // Made after the session opened: ask the host for what it has.
    const host = this.session.role === 'guest' ? this.session.host?.() : null;
    if (host) {
      this.send({ t: 'sync', snapshot: this.model.snapshot(), want: true }, { to: host.id });
    }
  }

  /** @private */
  send(message, opts = {}) {
    try {
      this.channel.send(message, opts);
    } catch {
      // a closed session: the change stays local
    }
  }

  /** @private A message from a peer: validated before anything uses it. */
  received(m, from) {
    if (!m || typeof m !== 'object' || typeof from !== 'string') {
      return;
    }
    if (m.t === 'op') {
      const changed = this.model.apply(m.op);
      if (changed?.length) {
        if (m.op.t === 'put') {
          this.dropLive(m.op.item.author, m.op.item.id);
        }
        this.render();
        this.emit('change', { source: 'remote' });
      }
    } else if (m.t === 'sync') {
      if (m.want === true && this.session.role === 'host') {
        this.send({ t: 'sync', snapshot: this.model.snapshot() }, { to: from });
      }
      const before = this.model.items.size;
      const ops = this.model.merge(m.snapshot);
      if (ops?.length) {
        // The hub tells everyone else what this peer brought (a reconnect).
        if (this.session.role === 'host') {
          for (const op of ops) {
            this.send({ t: 'op', op });
          }
        }
        this.render();
        this.emit('change', { source: 'remote', added: this.model.items.size - before });
      }
    } else if (m.t === 'cur') {
      this.remoteCursor(from, m);
    } else if (m.t === 'ink') {
      this.remoteInk(from, m);
    }
  }

  /** @private Runs a local change and sends its operation. */
  local(make) {
    let op;
    try {
      op = make();
    } catch (e) {
      if (e instanceof WhiteboardError) {
        this.emit('error', e);
        return null;
      }
      throw e;
    }
    if (op) {
      this.send({ t: 'op', op });
      this.render();
      this.emit('change', { source: 'local' });
    }
    return op;
  }

  /** @private Forget cursors and live ink of peers who left. */
  prunePeers() {
    const here = new Set(this.session.peers().map((p) => p.id));
    for (const [id, c] of this.cursors) {
      if (!here.has(id)) {
        clearTimeout(c.timer);
        c.node.remove();
        this.cursors.delete(id);
      }
    }
    for (const [key, ink] of this.liveInk) {
      if (!here.has(key.split(':')[0])) {
        ink.node.remove();
        this.liveInk.delete(key);
      }
    }
    for (const [id, c] of this.cursors) {
      const p = this.session.peers().find((q) => q.id === id);
      if (p) {
        this.styleCursor(c, p);
      }
    }
  }

  // ── DOM ──────────────────────────────────────────────────────────────────

  /** @private */
  buildDom(withToolbar) {
    this.host = document.createElement('collab-whiteboard');
    this.host.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:5;display:block';
    this.root = this.host.attachShadow({ mode: 'open' });
    this.root.append(htmlEl('style', {}, STYLE));
    this.board = svgEl('svg', { class: 'board' });
    this.defs = svgEl('defs');
    this.capture = svgEl('rect', { class: 'capture', x: '-50000', y: '-50000', width: '100000', height: '100000' });
    this.layer = svgEl('g', { class: 'layer' });
    this.itemsGroup = svgEl('g', { class: 'items' });
    this.liveGroup = svgEl('g', { class: 'live' });
    this.layer.append(this.itemsGroup, this.liveGroup);
    this.board.append(this.defs, this.capture, this.layer);
    this.cursorLayer = htmlEl('div', { class: 'cursors' });
    this.toolbarBox = htmlEl('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Whiteboard', hidden: !withToolbar });
    this.popover = htmlEl('div', { class: 'pop', hidden: true });
    this.root.append(this.board, this.cursorLayer, this.toolbarBox, this.popover);
    this.container.append(this.host);
    for (const [name, svg] of this.stickers) {
      this.defs.append(this.symbol(name, svg));
    }
    this.renderToolbar();
  }

  /** @private A sticker as a <symbol id="sticker-name">. */
  symbol(name, svg = this.stickers.get(name) ?? PLACEHOLDER) {
    const s = svgEl('symbol', { id: `sticker-${name}`, viewBox: '0 0 24 24' });
    s.innerHTML = svg;
    return s;
  }

  /** @private */
  renderToolbar() {
    if (!this.toolbarBox || this.toolbarBox.hidden) {
      return;
    }
    const s = this.strings;
    const button = (name, label, icon, opts = {}) => {
      const b = htmlEl('button', { type: 'button', title: label, 'aria-label': label, 'aria-pressed': opts.pressed === undefined ? undefined : String(opts.pressed), disabled: opts.disabled }, icon);
      b.addEventListener('click', opts.run);
      return b;
    };
    const parts = [];
    for (const t of this.tools) {
      parts.push(
        button(t, s[t], `<svg viewBox="0 0 24 24">${ICONS[t]}</svg>`, {
          pressed: this.tool === t,
          disabled: this.readOnlyFlag && t !== 'pointer',
          run: () => {
            if (t === 'sticker' && this.tool === 'sticker') {
              this.togglePopover('sticker');
              return;
            }
            this.setTool(t);
            if (t === 'sticker') {
              this.togglePopover('sticker');
            }
          },
        }),
      );
    }
    if (this.readOnlyFlag) {
      parts.push(htmlEl('div', { class: 'locked' }, ''));
      parts[parts.length - 1].textContent = s.readOnly;
    } else {
      parts.push(htmlEl('hr'));
      const sw = button('color', s.color, `<span class="swatch" style="background:${this.style.color}"></span>`, { run: () => this.togglePopover('color') });
      parts.push(sw);
      parts.push(button('undo', s.undo, `<svg viewBox="0 0 24 24">${ICONS.undo}</svg>`, { disabled: !this.model.undoStack.length, run: () => this.undo() }));
      parts.push(button('redo', s.redo, `<svg viewBox="0 0 24 24">${ICONS.redo}</svg>`, { disabled: !this.model.redoStack.length, run: () => this.redo() }));
    }
    this.toolbarBox.replaceChildren(...parts);
  }

  /** @private The colour or sticker chooser beside the toolbar. */
  togglePopover(kind) {
    if (!this.popover.hidden && this.popover.dataset.kind === kind) {
      this.popover.hidden = true;
      return;
    }
    this.popover.dataset.kind = kind;
    const items = [];
    if (kind === 'color') {
      for (const c of PALETTE) {
        const b = htmlEl('button', { type: 'button', 'aria-label': c, 'aria-pressed': String(c === this.style.color) }, `<span class="swatch" style="background:${c}"></span>`);
        b.addEventListener('click', () => {
          this.setStyle({ color: c });
          this.popover.hidden = true;
        });
        items.push(b);
      }
    } else {
      for (const name of this.stickers.keys()) {
        const b = htmlEl('button', { type: 'button', 'aria-label': name, title: name, 'aria-pressed': String(name === this.style.sticker) }, `<svg viewBox="0 0 24 24" width="24" height="24"><use href="#sticker-${name}"/></svg>`);
        b.addEventListener('click', () => {
          this.setStyle({ sticker: name });
          this.popover.hidden = true;
        });
        items.push(b);
      }
    }
    this.popover.replaceChildren(...items);
    const at = kind === 'color' ? this.toolbarBox.querySelector('[aria-label="' + this.strings.color + '"]') : this.toolbarBox.children[this.tools.indexOf('sticker')];
    this.popover.style.top = `${this.toolbarBox.offsetTop + (at?.offsetTop ?? 0)}px`;
    this.popover.hidden = false;
  }

  /** @private The adapter's transform on the drawing layer, and the cursors. */
  place() {
    const t = this.adapter.transform() ?? { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    this.matrix = t;
    // The adapter says the content is not shown now (an editor's data tab).
    this.host.style.display = t.hidden ? 'none' : 'block';
    if (t.hidden && this.tool !== 'pointer') {
      this.setTool('pointer');
    }
    this.layer.setAttribute('transform', `matrix(${t.a} ${t.b} ${t.c} ${t.d} ${t.e} ${t.f})`);
    // Drawings and cursors only inside the adapter's clip rectangle, if any.
    const clip = this.adapter.clip?.() ?? null;
    let path = '';
    if (clip) {
      const r = this.host.getBoundingClientRect();
      const right = Math.max(0, r.width - clip.x - clip.width);
      const bottom = Math.max(0, r.height - clip.y - clip.height);
      path = `inset(${Math.max(0, clip.y)}px ${right}px ${bottom}px ${Math.max(0, clip.x)}px)`;
    }
    this.board.style.clipPath = path;
    this.cursorLayer.style.clipPath = path;
    // The toolbar sits at the side of the area the chart is shown in (the
    // window's edge, below an editor's tab bar), never over the chart.
    const left = Math.round(clip ? Math.max(0, clip.x) : 0) + 8;
    const top = Math.round(clip ? Math.max(0, clip.y) : 0) + 8;
    this.toolbarBox.style.left = `${left}px`;
    this.toolbarBox.style.top = `${top}px`;
    this.popover.style.left = `${left + 44}px`;
    for (const c of this.cursors.values()) {
      this.moveCursor(c);
    }
    if (this.editing) {
      this.placeTextarea();
    }
  }

  /** @private Element-box CSS pixels to content units. */
  toContent(x, y) {
    const { a, b, c, d, e, f } = this.matrix;
    const det = a * d - b * c || 1;
    const px = x - e;
    const py = y - f;
    return { x: (d * px - c * py) / det, y: (a * py - b * px) / det };
  }

  /** @private Content units to element-box CSS pixels. */
  toBox(x, y) {
    const { a, b, c, d, e, f } = this.matrix;
    return { x: a * x + c * y + e, y: b * x + d * y + f };
  }

  /** @private Pointer event to content units. */
  eventPoint(ev) {
    const r = this.host.getBoundingClientRect();
    return this.toContent(ev.clientX - r.left, ev.clientY - r.top);
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  /** @private Redraws the items that changed (by comparing stamps). */
  render() {
    if (this.destroyed) {
      return;
    }
    const live = this.model.live();
    const seen = new Set();
    let previous = null;
    for (const item of live) {
      seen.add(item.id);
      let entry = this.nodes.get(item.id);
      if (!entry || entry.stamp !== item.stamp) {
        const node = this.itemNode(item);
        if (entry) {
          entry.node.replaceWith(node);
        }
        entry = { node, stamp: item.stamp };
        this.nodes.set(item.id, entry);
      }
      // Drawing order: oldest stamp first.
      const want = previous ? previous.nextSibling : this.itemsGroup.firstChild;
      if (want !== entry.node) {
        this.itemsGroup.insertBefore(entry.node, want);
      }
      previous = entry.node;
    }
    for (const [id, entry] of this.nodes) {
      if (!seen.has(id)) {
        entry.node.remove();
        this.nodes.delete(id);
      }
    }
    this.renderToolbar();
  }

  /** @private One item's SVG. Text goes in as textContent only. */
  itemNode(item) {
    const g = svgEl('g', { class: `item ${item.kind}-item`, 'data-id': item.id });
    if (item.kind === 'ink') {
      const d = inkPath(item.points);
      g.append(
        svgEl('path', { class: 'hit', d, fill: 'none', stroke: 'transparent', 'stroke-width': item.width + 10, 'stroke-linecap': 'round' }),
        svgEl('path', { d, fill: 'none', stroke: item.color, 'stroke-width': item.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      );
    } else if (item.kind === 'text') {
      const text = svgEl('text', { x: item.x, y: item.y, 'font-size': item.size, fill: item.color, 'dominant-baseline': 'hanging' });
      item.text.split('\n').forEach((line, i) => {
        const span = svgEl('tspan', { x: item.x, dy: i === 0 ? 0 : '1.2em' });
        span.textContent = line || ' ';
        text.append(span);
      });
      g.append(text);
    } else {
      const known = this.stickers.has(item.name);
      if (!known && !this.defs.querySelector(`#sticker-${item.name}`)) {
        this.defs.append(this.symbol(item.name, PLACEHOLDER));
      }
      g.append(svgEl('use', { href: `#sticker-${item.name}`, x: item.x - item.size / 2, y: item.y - item.size / 2, width: item.size, height: item.size }));
    }
    return g;
  }

  /** @private The items' bounds in content units, with a margin. */
  bounds(items) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const add = (x, y, pad) => {
      x0 = Math.min(x0, x - pad);
      y0 = Math.min(y0, y - pad);
      x1 = Math.max(x1, x + pad);
      y1 = Math.max(y1, y + pad);
    };
    for (const i of items) {
      if (i.kind === 'ink') {
        for (let k = 0; k < i.points.length; k += 2) {
          add(i.points[k], i.points[k + 1], i.width);
        }
      } else if (i.kind === 'text') {
        const lines = i.text.split('\n');
        add(i.x, i.y, 0);
        add(i.x + Math.max(...lines.map((l) => l.length)) * i.size * 0.6, i.y + lines.length * i.size * 1.2, 0);
      } else {
        add(i.x, i.y, i.size / 2);
      }
    }
    if (!Number.isFinite(x0)) {
      return { x: 0, y: 0, width: 1, height: 1 };
    }
    return { x: x0 - 4, y: y0 - 4, width: x1 - x0 + 8, height: y1 - y0 + 8 };
  }

  // ── Cursors and live ink ─────────────────────────────────────────────────

  /** @private */
  remoteCursor(from, m) {
    let c = this.cursors.get(from);
    if (m.hide === true) {
      if (c) {
        c.node.hidden = true;
      }
      return;
    }
    if (!finite(m.x) || !finite(m.y)) {
      return;
    }
    const peer = this.session.peers().find((p) => p.id === from);
    if (!c) {
      const node = htmlEl('div', { class: 'cursor' });
      node.append(htmlEl('div', {}, '<svg width="16" height="20" viewBox="0 0 16 20"><path d="M1 1l13 9-6 1.2L5 18z" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>'), htmlEl('span'));
      this.cursorLayer.append(node);
      c = { node };
      this.cursors.set(from, c);
      this.styleCursor(c, peer ?? { name: '', color: '#8b8d98' });
    }
    c.x = m.x;
    c.y = m.y;
    c.node.hidden = false;
    this.moveCursor(c);
    clearTimeout(c.timer);
    c.timer = setTimeout(() => (c.node.hidden = true), 5000);
  }

  /** @private */
  styleCursor(c, peer) {
    const color = COLOR.test(peer.color ?? '') ? peer.color : '#8b8d98';
    c.node.querySelector('path').setAttribute('fill', color);
    const label = c.node.querySelector('span');
    label.textContent = typeof peer.name === 'string' ? peer.name.slice(0, 40) : '';
    label.style.background = color;
    label.hidden = !label.textContent;
  }

  /** @private */
  moveCursor(c) {
    const p = this.toBox(c.x, c.y);
    c.node.style.transform = `translate(${p.x}px, ${p.y}px)`;
  }

  /** @private Ink a peer is drawing now (lossy; replaced by the item). */
  remoteInk(from, m) {
    if (!ID.test(m.id ?? '') || !Number.isInteger(m.seq) || !Array.isArray(m.pts) || m.pts.length > 400 || m.pts.length % 2 || !m.pts.every((n) => finite(n))) {
      return;
    }
    if (!COLOR.test(m.color ?? '') || !finite(m.width, 0.5, 64) || this.model.items.has(m.id)) {
      return;
    }
    const key = `${from}:${m.id}`;
    let ink = this.liveInk.get(key);
    if (!ink) {
      if (this.liveInk.size > 50) {
        return;
      }
      ink = { node: svgEl('path', { fill: 'none', stroke: m.color, 'stroke-width': m.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.8 }), points: [], seq: -1 };
      this.liveGroup.append(ink.node);
      this.liveInk.set(key, ink);
    }
    if (m.seq <= ink.seq || ink.points.length > LIMITS.points * 2) {
      return; // late or out of order
    }
    ink.seq = m.seq;
    ink.points.push(...m.pts);
    ink.node.setAttribute('d', inkPath(ink.points));
    clearTimeout(ink.timer);
    ink.timer = setTimeout(() => this.dropLive(from, m.id), 10000);
  }

  /** @private */
  dropLive(author, id) {
    const key = `${author}:${id}`;
    const ink = this.liveInk.get(key);
    if (ink) {
      clearTimeout(ink.timer);
      ink.node.remove();
      this.liveInk.delete(key);
    }
  }

  // ── Input ────────────────────────────────────────────────────────────────

  /** @private */
  wireInput() {
    const listen = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this.cleanups.push(() => target.removeEventListener(type, fn, opts));
    };
    // Cursors in every mode: watched on the container, never taken.
    listen(this.container, 'pointermove', (ev) => this.sendCursor(ev), { capture: true, passive: true });
    listen(this.container, 'pointerleave', () => this.send({ t: 'cur', hide: true }, { fast: true }));
    listen(this.board, 'pointerdown', (ev) => this.down(ev));
    listen(this.board, 'pointermove', (ev) => this.move(ev));
    listen(this.board, 'pointerup', (ev) => this.up(ev));
    listen(this.board, 'pointercancel', (ev) => this.up(ev, true));
    listen(window, 'keydown', (ev) => this.key(ev), { capture: true });
  }

  /** @private At most 30 a second, over the fast channel. */
  sendCursor(ev) {
    const now = performance.now();
    if (now - this.lastCursorSent < 33) {
      return;
    }
    this.lastCursorSent = now;
    const p = this.eventPoint(ev);
    this.send({ t: 'cur', x: round1(p.x), y: round1(p.y) }, { fast: true });
  }

  /** @private The item under a pointer event (not the capture rectangle). */
  itemAt(ev) {
    for (const node of this.root.elementsFromPoint(ev.clientX, ev.clientY)) {
      const g = node.closest?.('.item');
      if (g && this.itemsGroup.contains(g)) {
        return this.model.get(g.dataset.id);
      }
    }
    return null;
  }

  /** @private */
  down(ev) {
    if (this.tool === 'pointer' || this.readOnlyFlag || ev.button > 0) {
      return;
    }
    ev.preventDefault();
    this.popover.hidden = true;
    this.board.setPointerCapture?.(ev.pointerId);
    const p = this.eventPoint(ev);
    const hit = this.itemAt(ev);
    if (this.tool === 'pen') {
      this.inkSeq += 1;
      this.drawing = { id: `${this.model.peerId}.${this.model.counter + 1}`, points: [p.x, p.y], sent: 0, seq: 0 };
      this.drawing.node = svgEl('path', { fill: 'none', stroke: this.style.color, 'stroke-width': this.style.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
      this.liveGroup.append(this.drawing.node);
      this.drawing.node.setAttribute('d', inkPath(this.drawing.points));
    } else if (this.tool === 'eraser') {
      this.erasing = new Set();
      this.eraseAt(ev);
    } else if ((this.tool === 'text' && hit?.kind === 'text') || (this.tool === 'sticker' && hit?.kind === 'sticker')) {
      this.dragging = { item: hit, from: p, moved: false };
    } else if (this.tool === 'text') {
      this.pendingText = p;
    } else if (this.tool === 'sticker') {
      this.local(() => this.model.add({ kind: 'sticker', x: round1(p.x), y: round1(p.y), size: 32, name: this.style.sticker }));
    }
  }

  /** @private */
  move(ev) {
    if (this.drawing) {
      const p = this.eventPoint(ev);
      const pts = this.drawing.points;
      const lx = pts[pts.length - 2];
      const ly = pts[pts.length - 1];
      if (Math.hypot(p.x - lx, p.y - ly) < 0.5 || pts.length >= LIMITS.points * 2) {
        return;
      }
      pts.push(p.x, p.y);
      this.drawing.node.setAttribute('d', inkPath(pts));
      // The new points to the others, a few at a time (lossy is fine).
      if (pts.length - this.drawing.sent >= 8) {
        this.sendInk();
      }
    } else if (this.erasing) {
      this.eraseAt(ev);
    } else if (this.dragging) {
      const p = this.eventPoint(ev);
      const d = this.dragging;
      const dx = p.x - d.from.x;
      const dy = p.y - d.from.y;
      if (!d.moved && Math.hypot(dx, dy) < 2) {
        return;
      }
      d.moved = true;
      const node = this.nodes.get(d.item.id)?.node;
      node?.setAttribute('transform', `translate(${dx} ${dy})`);
      d.dx = dx;
      d.dy = dy;
    }
  }

  /** @private */
  sendInk() {
    const d = this.drawing;
    const from = Math.max(0, d.sent - 2); // overlap one point so segments join
    const pts = d.points.slice(from, from + 400).map(round1);
    d.sent = from + pts.length;
    this.send({ t: 'ink', id: d.id, seq: d.seq++, pts, color: this.style.color, width: this.style.width }, { fast: true });
  }

  /** @private */
  up(ev, cancelled = false) {
    if (this.drawing) {
      const d = this.drawing;
      this.drawing = null;
      d.node.remove();
      if (!cancelled) {
        this.local(() => this.model.add({ kind: 'ink', points: simplifyPoints(d.points), color: this.style.color, width: this.style.width }));
      }
    } else if (this.erasing) {
      const ids = [...this.erasing];
      this.erasing = null;
      for (const id of ids) {
        this.nodes.get(id)?.node.classList.remove('erasing');
        if (!cancelled) {
          this.local(() => this.model.remove(id));
        }
      }
    } else if (this.dragging) {
      const d = this.dragging;
      this.dragging = null;
      this.nodes.get(d.item.id)?.node.removeAttribute('transform');
      if (d.moved && !cancelled) {
        this.local(() => this.model.change(d.item.id, { x: round1(d.item.x + d.dx), y: round1(d.item.y + d.dy) }));
      } else if (!d.moved && d.item.kind === 'text' && !cancelled) {
        this.editText(d.item);
      }
    } else if (this.pendingText && !cancelled) {
      const p = this.pendingText;
      this.pendingText = null;
      this.editText(null, p);
    }
  }

  /** @private Marks the items under the eraser; they go on pointer up. */
  eraseAt(ev) {
    const hit = this.itemAt(ev);
    if (hit && !this.erasing.has(hit.id)) {
      this.erasing.add(hit.id);
      this.nodes.get(hit.id)?.node.classList.add('erasing');
    }
  }

  /** @private A text box over the note being written (a new one at `at`). */
  editText(item, at) {
    this.finishText();
    const ta = htmlEl('textarea', { class: 'note', maxlength: String(LIMITS.text), rows: '1', 'aria-label': this.strings.typeHere, placeholder: this.strings.typeHere });
    ta.value = item?.text ?? '';
    this.editing = { item, x: item?.x ?? at.x, y: item?.y ?? at.y, size: item?.size ?? this.style.size, color: item?.color ?? this.style.color, node: ta };
    if (item) {
      this.nodes.get(item.id)?.node.setAttribute('opacity', '0');
    }
    ta.style.color = this.editing.color;
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.finishText(false);
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.finishText(true);
      }
    });
    ta.addEventListener('input', () => this.sizeTextarea());
    ta.addEventListener('blur', () => this.finishText(true));
    this.root.append(ta);
    this.placeTextarea();
    ta.focus();
  }

  /** @private */
  placeTextarea() {
    const e = this.editing;
    const p = this.toBox(e.x, e.y);
    const scale = Math.hypot(this.matrix.a, this.matrix.b) || 1;
    e.node.style.left = `${p.x - 5}px`;
    e.node.style.top = `${p.y - 3}px`;
    e.node.style.fontSize = `${e.size}px`;
    e.node.style.transform = `scale(${scale})`;
    this.sizeTextarea();
  }

  /** @private */
  sizeTextarea() {
    const ta = this.editing?.node;
    if (ta) {
      const lines = ta.value.split('\n');
      ta.style.width = `${Math.max(4, ...lines.map((l) => l.length + 1)) * 0.62}em`;
      ta.style.height = `${lines.length * 1.2 + 0.4}em`;
    }
  }

  /** @private Commits (or drops) the text being written. */
  finishText(commit = true) {
    const e = this.editing;
    if (!e) {
      return;
    }
    this.editing = null;
    e.node.remove();
    if (e.item) {
      this.nodes.get(e.item.id)?.node.removeAttribute('opacity');
    }
    const text = e.node.value.replace(/\s+$/, '').slice(0, LIMITS.text);
    if (!commit) {
      return;
    }
    if (e.item && !text) {
      this.local(() => this.model.remove(e.item.id));
    } else if (e.item && text !== e.item.text) {
      this.local(() => this.model.change(e.item.id, { text }));
    } else if (!e.item && text) {
      this.local(() => this.model.add({ kind: 'text', x: round1(e.x), y: round1(e.y), size: e.size, text, color: e.color }));
    }
  }

  /** @private Keys only while drawing, so the page keeps its own. */
  key(ev) {
    if (this.tool === 'pointer' || this.editing || ev.target?.closest?.('input, textarea, [contenteditable]')) {
      return;
    }
    const ctrl = ev.ctrlKey || ev.metaKey;
    let handled = true;
    if (ev.key === 'Escape') {
      this.setTool('pointer');
    } else if (ctrl && !ev.shiftKey && (ev.key === 'z' || ev.key === 'Z')) {
      this.undo();
    } else if (ctrl && (ev.key === 'y' || ev.key === 'Y' || (ev.shiftKey && (ev.key === 'z' || ev.key === 'Z')))) {
      this.redo();
    } else {
      handled = false;
    }
    if (handled) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  }

  /** @private */
  emit(event, detail) {
    for (const cb of this.listeners.get(event) ?? []) {
      try {
        cb(detail);
      } catch (e) {
        console.error(e);
      }
    }
  }
}

/**
 * Creates a whiteboard over `container` (DESIGN.md section 5.2).
 * @returns {Whiteboard}
 */
export function createWhiteboard(container, options) {
  return new Whiteboard(container, options);
}

// ── Frame board (inkpad) ──────────────────────────────────────────────────────

/** The width of the frame in board units; its height is `FRAME_UNITS / aspect`. */
export const FRAME_UNITS = 1000;

/**
 * The largest rectangle of the given aspect (width / height) centred in a
 * `width` x `height` box: {x, y, width, height} in the box's pixels.
 */
export function letterbox(width, height, aspect) {
  if (!(width > 0) || !(height > 0) || !(aspect > 0) || !Number.isFinite(aspect)) {
    return { x: 0, y: 0, width: Math.max(width || 0, 0), height: Math.max(height || 0, 0) };
  }
  const w = Math.min(width, height * aspect);
  const h = w / aspect;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

/**
 * An adapter that maps board units (the frame is FRAME_UNITS wide) onto the
 * letterboxed frame inside `element`: the page viewport for the presenter,
 * the displayed video for a viewer.
 *
 * @param {HTMLElement} element the box the frame is shown in
 * @param {() => number} aspect frame width / height, read on every layout
 * @returns the adapter, plus `update()` to call when the aspect changes
 */
export function frameAdapter(element, aspect) {
  const callbacks = new Set();
  const rect = () => letterbox(element.clientWidth, element.clientHeight, aspect());
  return {
    element,
    transform: () => {
      const r = rect();
      const s = r.width / FRAME_UNITS || 1;
      return { a: s, b: 0, c: 0, d: s, e: r.x, f: r.y };
    },
    clip: rect,
    onChange: (cb) => {
      callbacks.add(cb);
      let ro = null;
      if (typeof ResizeObserver === 'function') {
        ro = new ResizeObserver(() => cb());
        ro.observe(element);
      }
      return () => {
        callbacks.delete(cb);
        ro?.disconnect();
      };
    },
    update: () => callbacks.forEach((cb) => cb()),
  };
}

// ── Host-side gate (inkpad) ───────────────────────────────────────────────────

/**
 * A Session `accept` callback for the host: while `drawing()` is false,
 * viewers' changes (ops, ink, snapshots with items) are dropped, so a
 * modified viewer cannot bypass the lock; cursors still pass. Whatever the
 * state, one peer sends at most `opsPerSecond` ops a second. Messages on
 * other channels pass.
 *
 * @param {() => boolean} drawing whether viewers may change the board
 * @param {{channel?: string, opsPerSecond?: number, now?: () => number}} [options]
 */
export function drawingGate(drawing, { channel = 'wb', opsPerSecond = 50, now = () => Date.now() } = {}) {
  const buckets = new Map(); // peer -> {tokens, at}
  return (name, message, from) => {
    if (name !== channel) {
      return true;
    }
    const t = message?.t;
    if (t === 'cur') {
      return true;
    }
    if (!drawing()) {
      // A join or a first request carries an empty snapshot and is harmless.
      return t === 'sync' && Array.isArray(message.snapshot?.items) && message.snapshot.items.length === 0 && message.snapshot.clear?.[0] === 0;
    }
    if (t !== 'op') {
      return true;
    }
    const at = now();
    const b = buckets.get(from) ?? { tokens: opsPerSecond, at };
    b.tokens = Math.min(opsPerSecond, b.tokens + ((at - b.at) / 1000) * opsPerSecond);
    b.at = at;
    buckets.set(from, b);
    if (b.tokens < 1) {
      return false;
    }
    b.tokens -= 1;
    return true;
  };
}
