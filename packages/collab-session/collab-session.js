// MIT License © 2026 Binary Dice Games (adapted by Carlos Lopez for inkpad)
/**
 * @file collab-session.js Rooms of peers talking over WebRTC data
 * channels and one video track, with no server of their own.
 *
 * Provenance: copied from binary-dice-games/nymph, web/collab/collab-session.js
 * at commit 13de939afdd5b52f35b1bbd8ef90cd677c3ae844 (2026-10). Changes:
 * invite fragment `inkpad=`, protocol `inkpad/1`, presenter wording, and
 * video (`setMedia`, `mediaParams`, the `track` event); see
 * spec/01_core_features/DESIGN.md section 4.1. It imports nothing.
 *
 *   import { createSession } from './collab-session.js';
 *   const host = await createSession({ role: 'host', me: { name: 'Ana', color: '#e5484d' },
 *     rendezvous: [{ kind: 'torrent', urls: ['wss://tracker.example'] }] });
 *   location.hash = host.inviteFragment();   // inkpad=<token>
 *   host.channel('chat').on('message', (m, from) => ...);
 *
 * One host, any number of guests, in a star: each guest has one link, to
 * the host, which relays what a guest sends to everyone. Peers find each
 * other through a rendezvous (WebTorrent trackers, manual codes, a
 * BroadcastChannel between tabs, or anything with the same interface);
 * what a rendezvous carries is sealed with a key derived from the room's
 * token, so it learns nothing.
 */

export const PROTOCOL_VERSION = 1;

/**
 * Diagnostics. A session's `log` option (a function taking the same arguments as
 * console.log) receives one line per step of making a connection: tracker sockets,
 * announces, offers and answers, ICE and channel states, links opening and closing.
 * Nothing secret is logged: no token, no SDP, no message contents. (inkpad addition)
 */
let dbg = () => {};

/** Short form of a peer or offer id for the log. */
const short = (id) => String(id ?? '').slice(0, 8);

/** A failure the user can act on: `reason` is a stable code. */
export class SessionError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

const CHANNEL = /^[A-Za-z0-9-]{1,32}$/;
const PEER = /^[A-Za-z0-9_-]{4,40}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
/** Bytes per data channel message (DESIGN.md section 3.5). */
export const FRAME_BYTES = 16 * 1024;
/** The largest message, as the app's open limit. */
export const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const COMPRESS_OVER = 4 * 1024;
const FAST_BUFFER_LIMIT = 256 * 1024;

// ── Bytes ─────────────────────────────────────────────────────────────────────

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

export function toBase64Url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text)) {
    throw new SessionError('bad-code', 'This code is damaged: copy it again, whole.');
  }
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; ++i) {
    out[i] = s.charCodeAt(i);
  }
  return out;
}

function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

function randomId(bytes = 8) {
  return toBase64Url(randomBytes(bytes));
}

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

const compress = (bytes) => pipe(bytes, new CompressionStream('deflate-raw'));
async function decompress(bytes, limit = MAX_MESSAGE_BYTES) {
  const out = await pipe(bytes, new DecompressionStream('deflate-raw'));
  if (out.length > limit) {
    throw new SessionError('too-large', 'a message is larger than allowed');
  }
  return out;
}

// ── Room keys (DESIGN.md section 3.1) ─────────────────────────────────────────

/** A new room token: 128 random bits, base64url. */
export function newToken() {
  return toBase64Url(randomBytes(16));
}

/** Whether `token` is a well-formed room token. */
export function isToken(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{22}$/.test(token);
}

/**
 * The keys of a room: `topic` (20 bytes, hex, names the swarm) and `seal`
 * (AES-GCM), both by HKDF-SHA-256 from the token.
 */
export async function roomKeys(token) {
  if (!isToken(token)) {
    throw new SessionError('bad-token', 'This invite link is not complete: ask for it again.');
  }
  const base = await crypto.subtle.importKey('raw', fromBase64Url(token), 'HKDF', false, ['deriveBits', 'deriveKey']);
  const salt = utf8.encode('collab-session/1');
  const topicBits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: utf8.encode('topic') }, base, 160);
  const seal = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8.encode('seal') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const topic = [...new Uint8Array(topicBits)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { topic, seal };
}

/** Sealed messages above this many bytes of JSON are deflated first (an SDP shrinks about 4 times). */
const SEAL_COMPRESS_OVER = 256;
/** The most a sealed message may unfold to. */
const SEAL_MAX_BYTES = 1 << 20;

/**
 * Encrypts a JSON value with the room's key: base64url(iv || ciphertext). The plaintext is a
 * flag byte (1: deflated) and the JSON. inkpad addition: public trackers drop an announce of
 * more than about 12 KB, and three offers with a video line are about 29 KB uncompressed.
 */
export async function sealMessage(keys, value) {
  const iv = randomBytes(12);
  const json = utf8.encode(JSON.stringify(value));
  const squeeze = json.length > SEAL_COMPRESS_OVER;
  const body = squeeze ? await compress(json) : json;
  const plain = new Uint8Array(1 + body.length);
  plain[0] = squeeze ? 1 : 0;
  plain.set(body, 1);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(keys.topic) }, keys.seal, plain);
  const out = new Uint8Array(12 + data.byteLength);
  out.set(iv);
  out.set(new Uint8Array(data), 12);
  return toBase64Url(out);
}

/** The JSON value sealMessage() sealed, or null when it was not sealed with this room's key. */
export async function unsealMessage(keys, text) {
  try {
    const bytes = fromBase64Url(text);
    if (bytes.length < 13) {
      return null;
    }
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: utf8.encode(keys.topic) }, keys.seal, bytes.subarray(12)));
    const body = plain[0] === 1 ? await decompress(plain.subarray(1), SEAL_MAX_BYTES) : plain.subarray(1);
    return JSON.parse(fromUtf8.decode(body));
  } catch {
    return null;
  }
}

// ── Framing (DESIGN.md section 3.5) ───────────────────────────────────────────

const FLAG_COMPRESSED = 1;
const FLAG_CHUNK = 2;
const CHUNK_HEADER = 9; // flags, message id (u32), index (u16), count (u16)

/** Splits one JSON message into frames (Uint8Array, at most FRAME_BYTES each). */
export async function encodeFrames(value, { fast = false, ids = { next: 1 } } = {}) {
  let body = utf8.encode(JSON.stringify(value));
  if (body.length > MAX_MESSAGE_BYTES) {
    throw new SessionError('too-large', `a message is larger than ${MAX_MESSAGE_BYTES} bytes`);
  }
  let flags = 0;
  if (!fast && body.length > COMPRESS_OVER) {
    const packed = await compress(body);
    if (packed.length < body.length) {
      body = packed;
      flags |= FLAG_COMPRESSED;
    }
  }
  if (body.length + 1 <= FRAME_BYTES) {
    const frame = new Uint8Array(body.length + 1);
    frame[0] = flags;
    frame.set(body, 1);
    return [frame];
  }
  if (fast) {
    throw new SessionError('too-large', `a fast message must fit ${FRAME_BYTES - 1} bytes`);
  }
  const per = FRAME_BYTES - CHUNK_HEADER;
  const count = Math.ceil(body.length / per);
  const id = ids.next++ >>> 0;
  const frames = [];
  for (let i = 0; i < count; ++i) {
    const part = body.subarray(i * per, (i + 1) * per);
    const f = new Uint8Array(CHUNK_HEADER + part.length);
    const v = new DataView(f.buffer);
    f[0] = flags | FLAG_CHUNK;
    v.setUint32(1, id);
    v.setUint16(5, i);
    v.setUint16(7, count);
    f.set(part, CHUNK_HEADER);
    frames.push(f);
  }
  return frames;
}

/** Reassembles frames of one link into messages (in order, reliable frames). */
export class FrameDecoder {
  constructor() {
    this.partial = new Map();
  }

  /** The message a frame completes, `undefined` while it waits, or throws on a bad frame. */
  async push(data) {
    const f = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (f.length < 1) {
      throw new SessionError('bad-frame', 'empty frame');
    }
    const flags = f[0];
    let body;
    if (flags & FLAG_CHUNK) {
      if (f.length < CHUNK_HEADER) {
        throw new SessionError('bad-frame', 'short chunk');
      }
      const v = new DataView(f.buffer, f.byteOffset, f.byteLength);
      const id = v.getUint32(1);
      const index = v.getUint16(5);
      const count = v.getUint16(7);
      if (count < 2 || count > Math.ceil(MAX_MESSAGE_BYTES / (FRAME_BYTES - CHUNK_HEADER)) + 1 || index >= count) {
        throw new SessionError('bad-frame', 'bad chunk count');
      }
      let p = this.partial.get(id);
      if (!p) {
        if (index !== 0 || this.partial.size >= 4) {
          throw new SessionError('bad-frame', 'chunk out of order');
        }
        p = { count, parts: [], size: 0 };
        this.partial.set(id, p);
      }
      if (index !== p.parts.length || count !== p.count) {
        this.partial.delete(id);
        throw new SessionError('bad-frame', 'chunk out of order');
      }
      p.parts.push(f.slice(CHUNK_HEADER));
      p.size += f.length - CHUNK_HEADER;
      if (p.size > MAX_MESSAGE_BYTES) {
        this.partial.delete(id);
        throw new SessionError('too-large', 'a message is larger than allowed');
      }
      if (p.parts.length < count) {
        return undefined;
      }
      this.partial.delete(id);
      body = new Uint8Array(p.size);
      let at = 0;
      for (const part of p.parts) {
        body.set(part, at);
        at += part.length;
      }
    } else {
      body = f.subarray(1);
    }
    if (flags & FLAG_COMPRESSED) {
      body = await decompress(body);
    }
    try {
      return JSON.parse(fromUtf8.decode(body));
    } catch {
      throw new SessionError('bad-frame', 'not JSON');
    }
  }
}

// ── Links (DESIGN.md section 3.3) ─────────────────────────────────────────────

/**
 * What every link offers the session: send(frame, fast), `onframe(frame,
 * fast)`, `onopen()`, `onclose(reason)`, close(), buffered(fast) and
 * stats() → {path}. A link is open once both its channels are.
 */
class LinkBase {
  constructor() {
    this.onframe = () => {};
    this.onopen = () => {};
    this.onclose = () => {};
    this.isOpen = false;
    this.closed = false;
  }

  opened() {
    if (!this.isOpen && !this.closed) {
      this.isOpen = true;
      this.onopen();
    }
  }

  ended(reason) {
    if (!this.closed) {
      this.closed = true;
      this.isOpen = false;
      this.onclose(reason);
    }
  }

  buffered() {
    return 0;
  }

  async stats() {
    return { path: 'local' };
  }
}

/** Two links joined in memory (tests). */
class MemoryLink extends LinkBase {
  send(frame, fast) {
    if (!this.isOpen || !this.other) {
      throw new SessionError('closed', 'the link is closed');
    }
    const other = this.other;
    const copy = frame.slice();
    queueMicrotask(() => other.isOpen && other.onframe(copy, fast));
  }

  close() {
    const other = this.other;
    this.ended('closed');
    if (other) {
      queueMicrotask(() => other.ended('remote-closed'));
    }
  }
}

/** A pair of joined memory links. */
export function memoryLinkPair() {
  const a = new MemoryLink();
  const b = new MemoryLink();
  a.other = b;
  b.other = a;
  queueMicrotask(() => {
    a.opened();
    b.opened();
  });
  return [a, b];
}

/** One RTCPeerConnection with its `reliable` and `fast` channels. */
class WebRtcLink extends LinkBase {
  constructor(pc) {
    super();
    this.pc = pc;
    this.reliable = pc.createDataChannel('reliable', { negotiated: true, id: 0 });
    this.fast = pc.createDataChannel('fast', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    for (const ch of [this.reliable, this.fast]) {
      ch.binaryType = 'arraybuffer';
      ch.onopen = () => {
        dbg('data channel open:', ch.label);
        if (this.reliable.readyState === 'open' && this.fast.readyState === 'open') {
          this.opened();
        }
      };
      ch.onclose = () => this.ended('closed');
      ch.onmessage = (e) => typeof e.data !== 'string' && this.onframe(new Uint8Array(e.data), ch === this.fast);
    }
    pc.addEventListener('connectionstatechange', () => {
      dbg('peer connection:', pc.connectionState);
      if (pc.connectionState === 'failed') {
        this.ended(this.isOpen ? 'network' : 'ice-failed');
        pc.close();
      } else if (pc.connectionState === 'closed') {
        this.ended('closed');
      }
    });
    pc.addEventListener('iceconnectionstatechange', () => {
      dbg('ICE connection:', pc.iceConnectionState);
      // A network change: try a restart once while still connected.
      if (pc.iceConnectionState === 'disconnected' && this.isOpen && !this.restarted && typeof pc.restartIce === 'function') {
        this.restarted = true;
        pc.restartIce();
      } else if (pc.iceConnectionState === 'connected') {
        this.restarted = false;
      }
    });
  }

  send(frame, fast) {
    const ch = fast ? this.fast : this.reliable;
    if (ch.readyState !== 'open') {
      throw new SessionError('closed', 'the link is closed');
    }
    ch.send(frame);
  }

  buffered(fast) {
    return (fast ? this.fast : this.reliable).bufferedAmount;
  }

  close() {
    this.ended('closed');
    try {
      this.pc.close();
    } catch {
      // already closed
    }
  }

  /** Whether the selected candidate pair goes through a TURN relay. */
  async stats() {
    try {
      const report = await this.pc.getStats();
      let pair = null;
      report.forEach((s) => {
        if (s.type === 'transport' && s.selectedCandidatePairId) {
          pair = report.get(s.selectedCandidatePairId);
        }
      });
      if (!pair) {
        report.forEach((s) => {
          if (s.type === 'candidate-pair' && (s.selected || (s.nominated && s.state === 'succeeded'))) {
            pair = s;
          }
        });
      }
      if (!pair) {
        return { path: null };
      }
      const local = report.get(pair.localCandidateId);
      const remote = report.get(pair.remoteCandidateId);
      const relayed = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
      return { path: relayed ? 'relay' : 'direct', rtt: pair.currentRoundTripTime };
    } catch {
      return { path: null };
    }
  }
}

/** Waits for ICE gathering, at most `ms` (DESIGN.md section 4: untrickled offers). */
function gathered(pc, ms = 3000) {
  if (pc.iceGatheringState === 'complete') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    const timer = setTimeout(done, ms);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/**
 * The video of a session. The host holds one MediaStream and puts its video
 * track on a transceiver of every link; a guest asks for video by adding a
 * receive-only transceiver to each offer. Links without a RTCPeerConnection
 * (memory, broadcast) carry no video.
 */
class MediaController {
  constructor(role, emit) {
    this.role = role;
    this.emit = emit;
    this.stream = null;
    this.params = {};
    this.senders = new Set();
  }

  /** Guest: before createOffer. */
  prepareOffer(pc) {
    if (this.role !== 'guest') {
      return;
    }
    const transceiver = pc.addTransceiver('video', { direction: 'recvonly' });
    this.offerOrder(transceiver);
    pc.addEventListener('track', (e) => {
      if (e.track.kind === 'video') {
        this.emit('track', e.streams[0] ?? new MediaStream([e.track]));
      }
    });
  }

  /** Host: after setRemoteDescription(offer), before createAnswer. */
  prepareAnswer(pc) {
    if (this.role !== 'host') {
      return;
    }
    const transceiver = pc.getTransceivers().find((t) => t.receiver.track.kind === 'video');
    if (!transceiver) {
      return;
    }
    transceiver.direction = 'sendonly';
    const { sender } = transceiver;
    this.senders.add(sender);
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
        this.senders.delete(sender);
      }
    });
    this.codecs(transceiver);
    sender.replaceTrack(this.track()).catch(() => {});
    this.apply(sender);
  }

  track() {
    return this.stream?.getVideoTracks()[0] ?? null;
  }

  /** Host: the stream to send, or null to send nothing. */
  setMedia(stream) {
    this.stream = stream;
    const track = this.track();
    if (track && this.params.contentHint) {
      track.contentHint = this.params.contentHint;
    }
    for (const sender of this.senders) {
      sender.replaceTrack(track).catch(() => {});
    }
  }

  /** Host: {fps, maxBitrate, scale, contentHint}, applied to every sender now and later. */
  setParams(params) {
    this.params = { ...this.params, ...params };
    const track = this.track();
    if (track && this.params.contentHint) {
      track.contentHint = this.params.contentHint;
    }
    for (const sender of this.senders) {
      this.apply(sender);
    }
  }

  /** @private */
  apply(sender) {
    const { fps, maxBitrate, scale } = this.params;
    const p = sender.getParameters();
    if (!p.encodings?.length) {
      p.encodings = [{}];
    }
    const enc = p.encodings[0];
    if (fps) enc.maxFramerate = fps;
    if (maxBitrate) enc.maxBitrate = maxBitrate;
    if (scale) enc.scaleResolutionDownBy = Math.max(1, scale);
    p.degradationPreference = 'maintain-resolution';
    sender.setParameters(p).catch(() => {});
  }

  /**
   * @private Guest: lists the preferred codecs first in the offer. The sender uses the first codec of
   * the offer it supports, so the order has to be set here and cannot be left to the host's answer.
   */
  offerOrder(transceiver) {
    const wanted = this.videoCodecs;
    if (!wanted?.length || typeof RTCRtpReceiver?.getCapabilities !== 'function') {
      return;
    }
    const all = RTCRtpReceiver.getCapabilities('video')?.codecs ?? [];
    const rank = (c) => {
      const i = wanted.findIndex((m) => m.toLowerCase() === c.mimeType.toLowerCase());
      return i < 0 ? wanted.length : i;
    };
    try {
      transceiver.setCodecPreferences([...all].sort((a, b) => rank(a) - rank(b)));
    } catch (e) {
      dbg('video codec order not applied:', e?.message ?? e);
    }
  }

  /** @private Preferred codecs by MIME type (e.g. 'video/VP9'), the rest after. */
  codecs(transceiver) {
    const wanted = this.params.codecs;
    if (!wanted?.length || typeof RTCRtpSender?.getCapabilities !== 'function') {
      return;
    }
    const all = RTCRtpSender.getCapabilities('video')?.codecs ?? [];
    const rank = (c) => {
      const i = wanted.findIndex((m) => m.toLowerCase() === c.mimeType.toLowerCase());
      return i < 0 ? wanted.length : i;
    };
    try {
      transceiver.setCodecPreferences([...all].sort((a, b) => rank(a) - rank(b)));
      dbg('video codec preference:', wanted.join(', '));
    } catch (e) {
      // unsupported: the browser's own order stays
      dbg('video codec preference not applied:', e?.message ?? e);
    }
  }
}

/** A new offering link: its link and its full offer SDP. */
async function makeOffer(iceServers, gatherMs, media) {
  const pc = new RTCPeerConnection({ iceServers });
  const link = new WebRtcLink(pc);
  media?.prepareOffer(pc);
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc, gatherMs);
  return { link, pc, sdp: pc.localDescription.sdp };
}

/** The answering side of `offerSdp`: its link and its full answer SDP. */
async function makeAnswer(iceServers, offerSdp, gatherMs, media) {
  const pc = new RTCPeerConnection({ iceServers });
  const link = new WebRtcLink(pc);
  await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
  media?.prepareAnswer(pc);
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc, gatherMs);
  return { link, pc, sdp: pc.localDescription.sdp };
}

// ── Rendezvous (DESIGN.md section 3.4) ────────────────────────────────────────
//
// A rendezvous gets links to the other side. start(ctx) with ctx: {role,
// peerId, keys, protocol, iceServers, link(link), status(stage, detail),
// wantsLinks()}; stop(). It calls ctx.link() for each new link; the
// session does the rest (hello, roster). A guest's rendezvous stops
// looking while ctx.wantsLinks() is false.

/**
 * The WebTorrent tracker protocol over wss: guests announce sealed offers
 * in the room's swarm; the host answers them through the tracker.
 */
class TorrentRendezvous {
  constructor(spec) {
    this.urls = (spec.urls ?? []).filter((u) => /^wss?:\/\//.test(u));
    this.announceMs = spec.announceMs ?? { host: 15000, guest: 4000 };
    this.gatherMs = spec.gatherMs ?? 3000;
    this.offers = spec.offers ?? 3;
    // inkpad addition: the tracker protocol has no time to live a client can set, so this is how
    // long we stay announced (0: until stopped); then we tell the trackers we are gone.
    this.ttlMs = spec.ttlMs ?? 0;
    this.sockets = new Map();
    this.pending = new Map(); // offer id -> {link, pc, at}
    this.seen = new Set();
    this.tryingUntil = 0;
  }

  start(ctx) {
    this.ctx = ctx;
    this.stopped = false;
    // A tracker peer id is 20 characters; this one says nothing about us.
    this.trackerId = `-CS0001-${randomId(9).slice(0, 12)}`;
    this.infoHash = String.fromCharCode(...ctx.keys.topic.match(/../g).map((h) => parseInt(h, 16)));
    if (!this.urls.length) {
      ctx.status('no-tracker', 'No tracker is configured.');
      return;
    }
    for (const url of this.urls) {
      this.connect(url, 0);
    }
    this.timer = setInterval(() => this.announceAll(), ctx.role === 'host' ? this.announceMs.host : this.announceMs.guest);
    if (this.ttlMs > 0) {
      this.ttlTimer = setTimeout(() => this.expire(), Math.min(this.ttlMs, 2 ** 31 - 1));
    }
    this.noTracker = setTimeout(() => {
      if (![...this.sockets.values()].some((s) => s.readyState === 1)) {
        ctx.status('no-tracker', 'No tracker could be reached.');
      }
    }, 10000);
  }

  /** @private The time to live is over: leave the swarm and stop looking for peers. */
  expire() {
    dbg('tracker: time to live over, leaving the swarm');
    for (const ws of this.sockets.values()) {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ action: 'announce', info_hash: this.infoHash, peer_id: this.trackerId, uploaded: 0, downloaded: 0, left: 0, event: 'stopped', numwant: 0, offers: [] }));
      }
    }
    this.stop();
    this.ctx.status('expired', 'The trackers no longer know this room: no new people can join with the link.');
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    clearTimeout(this.noTracker);
    clearTimeout(this.ttlTimer);
    for (const ws of this.sockets.values()) {
      try {
        ws.close();
      } catch {
        // closing
      }
    }
    this.sockets.clear();
    for (const p of this.pending.values()) {
      p.link.close();
    }
    this.pending.clear();
  }

  /** @private */
  connect(url, attempt) {
    if (this.stopped) {
      return;
    }
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      return;
    }
    this.sockets.set(url, ws);
    dbg('tracker: connecting to', url);
    ws.onopen = () => {
      dbg('tracker: connected to', url);
      attempt = 0;
      this.ctx.status('tracker', url);
      this.announce(ws);
    };
    ws.onmessage = (e) => this.received(ws, e.data);
    ws.onclose = (e) => {
      dbg('tracker: closed', url, 'code', e.code, e.reason || '(no reason)');
      if (this.sockets.get(url) === ws && !this.stopped) {
        dbg('tracker: retry in', Math.min(60000, 2000 * 2 ** attempt) / 1000, 's');
        // Back off: 2, 4, 8 ... 60 seconds.
        setTimeout(() => this.connect(url, attempt + 1), Math.min(60000, 2000 * 2 ** attempt));
      }
    };
    ws.onerror = () => dbg('tracker: error on', url, '(the browser gives no detail)');
  }

  /** @private */
  announceAll() {
    // Offers not answered in a minute are given up.
    const now = Date.now();
    for (const [id, p] of this.pending) {
      if (now - p.at > 60000) {
        p.link.close();
        this.pending.delete(id);
      }
    }
    for (const ws of this.sockets.values()) {
      if (ws.readyState === 1) {
        this.announce(ws);
      }
    }
  }

  /** @private The host just stays in the swarm; a guest brings offers. */
  async announce(ws) {
    const base = { action: 'announce', info_hash: this.infoHash, peer_id: this.trackerId, uploaded: 0, downloaded: 0, left: 0, event: 'started' };
    // A guest whose link to the host is opening makes no new offers for a while.
    if (this.ctx.role === 'host' || !this.ctx.wantsLinks() || Date.now() < this.tryingUntil) {
      dbg('tracker: announce (waiting, no offers)', ws.url);
      ws.send(JSON.stringify({ ...base, numwant: 0, offers: [] }));
      return;
    }
    const made = await Promise.all(
      Array.from({ length: this.offers }, async () => {
        try {
          const { link, pc, sdp } = await makeOffer(this.ctx.iceServers, this.gatherMs, this.ctx.media);
          const offerId = String.fromCharCode(...randomBytes(20).map((b) => 33 + (b % 94)));
          const sealed = await sealMessage(this.ctx.keys, { p: this.ctx.protocol, from: this.ctx.peerId, role: 'guest', kind: 'offer', sdp, ts: Date.now() });
          this.pending.set(offerId, { link, pc, at: Date.now() });
          return { offer: { type: 'offer', sdp: sealed }, offer_id: offerId };
        } catch (e) {
          dbg('could not make an offer:', e?.message ?? e);
          return null; // no WebRTC: the session reports it
        }
      }),
    );
    const offers = made.filter(Boolean);
    if (ws.readyState === 1 && !this.stopped) {
      dbg('tracker: announce with', offers.length, 'offers', ws.url);
      ws.send(JSON.stringify({ ...base, numwant: offers.length, offers }));
    }
  }

  /** @private */
  async received(ws, data) {
    let m;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    if (m['failure reason'] || m.warning_message) {
      dbg('tracker says:', m['failure reason'] ?? m.warning_message, ws.url);
    }
    if (m.info_hash !== this.infoHash || m.peer_id === this.trackerId) {
      return;
    }
    if (m.offer && this.ctx.role === 'host' && typeof m.offer.sdp === 'string' && typeof m.offer_id === 'string') {
      const sealed = await unsealMessage(this.ctx.keys, m.offer.sdp);
      if (!this.fresh(sealed, 'offer', 'guest')) {
        dbg('offer from a guest ignored (not sealed for this room, old, repeated or another protocol)');
        return;
      }
      dbg('offer received from', short(sealed.from), 'via', ws.url);
      this.ctx.status('offer', sealed.from);
      try {
        const { link, sdp } = await makeAnswer(this.ctx.iceServers, sealed.sdp, this.gatherMs, this.ctx.media);
        const answer = await sealMessage(this.ctx.keys, { p: this.ctx.protocol, from: this.ctx.peerId, role: 'host', kind: 'answer', sdp, ts: Date.now() });
        this.ctx.link(link);
        if (ws.readyState === 1) {
          dbg('answer sent to', short(sealed.from), 'via', ws.url);
          ws.send(JSON.stringify({ action: 'announce', info_hash: this.infoHash, peer_id: this.trackerId, to_peer_id: m.peer_id, answer: { type: 'answer', sdp: answer }, offer_id: m.offer_id }));
        }
      } catch (e) {
        dbg('could not answer an offer:', e?.message ?? e);
      }
    } else if (m.answer && this.ctx.role === 'guest' && typeof m.answer.sdp === 'string') {
      const pending = this.pending.get(m.offer_id);
      if (!pending) {
        dbg('answer for an offer that is no longer pending (dropped)');
        return;
      }
      const sealed = await unsealMessage(this.ctx.keys, m.answer.sdp);
      if (!this.fresh(sealed, 'answer', 'host')) {
        dbg('answer ignored (not sealed for this room, old, repeated or another protocol)');
        return;
      }
      dbg('answer received from', short(sealed.from), 'via', ws.url);
      // One answer is enough: the other offers are given up, and no new
      // ones go out while this link opens.
      this.pending.delete(m.offer_id);
      for (const p of this.pending.values()) {
        p.link.close();
      }
      this.pending.clear();
      this.tryingUntil = Date.now() + 15000;
      pending.link.closed || pending.link.isOpen || this.watchTry(pending.link);
      this.ctx.status('answer', sealed.from);
      try {
        await pending.pc.setRemoteDescription({ type: 'answer', sdp: sealed.sdp });
        this.ctx.link(pending.link);
      } catch (e) {
        dbg('could not use the answer:', e?.message ?? e);
        pending.link.close();
      }
    }
  }

  /** @private Offers again as soon as the link being tried fails. */
  watchTry(link) {
    const check = setInterval(() => {
      if (link.closed || link.isOpen) {
        clearInterval(check);
        if (link.closed) {
          this.tryingUntil = 0;
        }
      }
    }, 250);
  }

  /** @private A sealed signal of this room, protocol and role, recent and not seen before. */
  fresh(s, kind, role) {
    if (!s || s.kind !== kind || s.role !== role || typeof s.sdp !== 'string' || !PEER.test(s.from ?? '') || s.from === this.ctx.peerId) {
      return false;
    }
    if (typeof s.ts !== 'number' || Math.abs(Date.now() - s.ts) > 5 * 60000) {
      return false;
    }
    if (s.p !== this.ctx.protocol) {
      this.ctx.status('protocol', `Another version (${String(s.p).slice(0, 20)}) is in this room: reload the page to join it.`);
      return false;
    }
    const key = `${s.from}:${s.ts}:${s.sdp.length}`;
    if (this.seen.has(key)) {
      return false;
    }
    this.seen.add(key);
    return true;
  }
}

/**
 * Two codes copied by hand: the guest's offer code to the host, the host's
 * answer code back (DESIGN.md section 3.4).
 */
class ManualRendezvous {
  constructor(spec) {
    this.gatherMs = spec.gatherMs ?? 3000;
  }

  start(ctx) {
    this.ctx = ctx;
  }

  stop() {
    this.pending?.link.close();
    this.pending = null;
  }

  /** @private */
  async code(value) {
    return toBase64Url(await compress(utf8.encode(await sealMessage(this.ctx.keys, value))));
  }

  /** @private */
  async read(code, kind, role) {
    let sealed;
    try {
      sealed = fromUtf8.decode(await decompress(fromBase64Url(code.trim()), 1 << 20));
    } catch {
      throw new SessionError('bad-code', 'This code is damaged: copy it again, whole.');
    }
    const s = await unsealMessage(this.ctx.keys, sealed);
    if (!s || s.kind !== kind || s.role !== role || typeof s.sdp !== 'string') {
      throw new SessionError('bad-code', kind === 'offer' ? 'This is not a join code of this session.' : 'This is not the answer code of this session.');
    }
    if (s.p !== this.ctx.protocol) {
      throw new SessionError('protocol', 'The other side runs another version: both of you, reload the page.');
    }
    return s;
  }

  /** Guest: the code to send to the host. */
  async offerCode() {
    this.pending?.link.close();
    const { link, pc, sdp } = await makeOffer(this.ctx.iceServers, this.gatherMs, this.ctx.media);
    this.pending = { link, pc };
    return this.code({ p: this.ctx.protocol, from: this.ctx.peerId, role: 'guest', kind: 'offer', sdp, ts: Date.now() });
  }

  /** Host: takes a guest's code; returns the answer code to send back. */
  async acceptOffer(code) {
    const s = await this.read(code, 'offer', 'guest');
    const { link, sdp } = await makeAnswer(this.ctx.iceServers, s.sdp, this.gatherMs, this.ctx.media);
    this.ctx.link(link);
    return this.code({ p: this.ctx.protocol, from: this.ctx.peerId, role: 'host', kind: 'answer', sdp, ts: Date.now() });
  }

  /** Guest: takes the host's answer code; the link opens. */
  async acceptAnswer(code) {
    if (!this.pending) {
      throw new SessionError('bad-code', 'Make a join code first.');
    }
    const s = await this.read(code, 'answer', 'host');
    await this.pending.pc.setRemoteDescription({ type: 'answer', sdp: s.sdp });
    this.ctx.link(this.pending.link);
    this.pending = null;
  }
}

/** A link over a BroadcastChannel, between tabs of one browser. */
class BroadcastLink extends LinkBase {
  constructor(bc, self, other) {
    super();
    this.bc = bc;
    this.self = self;
    this.other = other;
  }

  send(frame, fast) {
    if (!this.isOpen) {
      throw new SessionError('closed', 'the link is closed');
    }
    this.bc.postMessage({ k: 'frame', from: this.self, to: this.other, fast, frame });
  }

  close() {
    if (!this.closed) {
      try {
        this.bc.postMessage({ k: 'bye', from: this.self, to: this.other });
      } catch {
        // the channel is closed
      }
    }
    this.ended('closed');
  }
}

/** Tabs of one browser find each other on a BroadcastChannel named by the topic. */
class BroadcastRendezvous {
  start(ctx) {
    this.ctx = ctx;
    this.links = new Map();
    this.bc = new BroadcastChannel(`inkpad-session:${ctx.keys.topic}`);
    this.bc.onmessage = (e) => this.received(e.data);
    if (ctx.role === 'guest') {
      this.knock = () => ctx.wantsLinks() && this.bc.postMessage({ k: 'knock', from: ctx.peerId });
      this.knock();
      this.timer = setInterval(this.knock, 1000);
    }
  }

  stop() {
    clearInterval(this.timer);
    for (const l of this.links.values()) {
      l.close();
    }
    this.links.clear();
    this.bc?.close();
  }

  /** @private */
  received(m) {
    if (!m || typeof m !== 'object' || m.from === this.ctx.peerId) {
      return;
    }
    if (m.k === 'knock' && this.ctx.role === 'host' && PEER.test(m.from ?? '')) {
      if (this.links.get(m.from)?.isOpen) {
        return;
      }
      this.bc.postMessage({ k: 'welcome', from: this.ctx.peerId, to: m.from });
      this.open(m.from);
    } else if (m.k === 'welcome' && m.to === this.ctx.peerId && this.ctx.role === 'guest' && this.ctx.wantsLinks()) {
      this.open(m.from);
    } else if (m.to === this.ctx.peerId) {
      const link = this.links.get(m.from);
      if (m.k === 'frame' && link?.isOpen && m.frame instanceof Uint8Array) {
        link.onframe(m.frame, !!m.fast);
      } else if (m.k === 'bye' && link) {
        this.links.delete(m.from);
        link.ended('remote-closed');
      }
    }
  }

  /** @private */
  open(other) {
    this.links.get(other)?.ended('replaced');
    const link = new BroadcastLink(this.bc, this.ctx.peerId, other);
    this.links.set(other, link);
    this.ctx.link(link);
    queueMicrotask(() => link.opened());
  }
}

/**
 * An in-memory network for tests: sessions with `{kind: 'memory',
 * network}` on the same network and topic find each other at once.
 */
export function createMemoryNetwork() {
  const rooms = new Map();
  return {
    rendezvous() {
      return {
        start(ctx) {
          this.ctx = ctx;
          const room = rooms.get(ctx.keys.topic) ?? { host: null, guests: new Set() };
          rooms.set(ctx.keys.topic, room);
          this.room = room;
          if (ctx.role === 'host') {
            room.host = this;
            for (const g of room.guests) {
              g.reach();
            }
          } else {
            room.guests.add(this);
            this.reach();
          }
        },
        reach() {
          const host = this.room.host;
          if (host && this.ctx.wantsLinks()) {
            const [a, b] = memoryLinkPair();
            this.ctx.link(a);
            host.ctx.link(b);
          }
        },
        retry() {
          this.reach();
        },
        stop() {
          if (this.room.host === this) {
            this.room.host = null;
          }
          this.room.guests.delete(this);
        },
      };
    },
  };
}

function makeRendezvous(spec) {
  if (spec && typeof spec.start === 'function') {
    return spec; // an embedder's own
  }
  switch (spec?.kind) {
    case 'torrent':
      return new TorrentRendezvous(spec);
    case 'manual':
      return new ManualRendezvous(spec);
    case 'broadcast':
      return new BroadcastRendezvous();
    case 'memory':
      return spec.network.rendezvous();
    default:
      throw new SessionError('config', `unknown rendezvous kind ${spec?.kind}`);
  }
}

// ── Session (DESIGN.md section 3.5) ───────────────────────────────────────────

function cleanPresence(me) {
  const name = typeof me?.name === 'string' ? me.name.replace(/[\u0000-\u001f]/g, '').slice(0, 40) : '';
  const color = COLOR.test(me?.color ?? '') ? me.color : '#8b8d98';
  return { name, color };
}

/**
 * A room, seen from one peer. Created by createSession().
 */
export class Session {
  constructor(options, keys) {
    this.role = options.role;
    this.token = options.token;
    this.keys = keys;
    this.protocol = options.protocol ?? 'inkpad/1';
    this.iceServers = options.iceServers ?? [];
    this.accept = options.accept ?? (() => true);
    this.me = { id: options.peerId ?? randomId(8), ...cleanPresence(options.me), role: this.role };
    /** This tab's session object: a reload is a new instance of the same peer. */
    this.instance = randomId(8);
    if (!PEER.test(this.me.id)) {
      throw new SessionError('config', 'a peer id is 4 to 40 letters, digits, "_" and "-"');
    }
    this.specs = options.rendezvous ?? [];
    this.reconnectMs = options.reconnectMs ?? 60000;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 30000;
    this.listeners = new Map();
    this.channels = new Map();
    this.links = new Map(); // peer id -> {link, decoder, peer, bad: []}
    this.unnamed = new Set(); // links before their hello
    this.roster = new Map([[this.me.id, { ...this.me, path: null }]]);
    this.removed = new Set();
    this.locked = false;
    this.state = 'connecting';
    this.frameIds = { next: 1 };
    this.rendezvous = [];
    this.manual = null;
    this.media = new MediaController(this.role, (event, detail) => this.emit(event, detail));
    this.media.videoCodecs = options.videoCodecs;
  }

  /**
   * Host: sets the stream whose video track goes to every viewer (current
   * and future); null stops sending video. Links that cannot carry video
   * ignore it.
   */
  setMedia(stream) {
    this.hostOnly();
    this.media.setMedia(stream);
  }

  /**
   * Host: sender parameters, applied live. `fps` (max frame rate),
   * `maxBitrate` (bits per second), `scale` (>= 1, downscale factor),
   * `contentHint` ('detail' | 'text' | 'motion') and `codecs` (MIME types in
   * order of preference, used for links made afterwards).
   */
  mediaParams(params) {
    this.hostOnly();
    this.media.setParams(params ?? {});
  }

  // ── Public API ───────────────────────────────────────────────────────

  /** `inkpad=<token>`, for the host app's invite link. */
  inviteFragment() {
    return `inkpad=${this.token}`;
  }

  /** Everyone in the room, this peer included: {id, name, color, role, path}. */
  peers() {
    return [...this.roster.values()].map((p) => ({ ...p }));
  }

  /** The host's peer entry, or null before a guest has reached it. */
  host() {
    return this.peers().find((p) => p.role === 'host') ?? null;
  }

  /**
   * A named channel: send(message, {to, fast}), on('message', (m, from)),
   * on('join', (peer)).
   */
  channel(name) {
    if (!CHANNEL.test(name)) {
      throw new SessionError('config', `bad channel name ${name}`);
    }
    if (!this.channels.has(name)) {
      const listeners = { message: new Set(), join: new Set() };
      this.channels.set(name, {
        listeners,
        api: {
          name,
          send: (message, opts = {}) => this.send(name, message, opts),
          on: (event, cb) => {
            listeners[event]?.add(cb);
            return () => listeners[event]?.delete(cb);
          },
        },
      });
    }
    return this.channels.get(name).api;
  }

  /** "peers", "state" ({state, reason, message}), "status" ({stage, detail}), "error", "track" (guest: a MediaStream with the presenter's video). */
  on(event, cb) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(cb);
    return () => this.listeners.get(event)?.delete(cb);
  }

  /** Changes this peer's name and colour for everyone. */
  setMe(me) {
    Object.assign(this.me, cleanPresence({ ...this.me, ...me }));
    this.roster.set(this.me.id, { ...this.roster.get(this.me.id), name: this.me.name, color: this.me.color });
    if (this.role === 'host') {
      this.broadcastRoster();
    } else {
      this.control({ t: 'me', name: this.me.name, color: this.me.color });
    }
    this.emit('peers', this.peers());
  }

  /** Host: no new joins while locked. */
  lock(on) {
    this.hostOnly();
    this.locked = !!on;
    this.broadcastControl({ t: 'locked', on: this.locked });
  }

  /** Host: closes a guest's link and refuses its id from now on. */
  remove(id) {
    this.hostOnly();
    this.removed.add(id);
    const entry = this.links.get(id);
    if (entry) {
      this.sendControlTo(entry, { t: 'removed' });
      setTimeout(() => entry.link.close(), 200);
    }
  }

  /** Host: a new token (a new invite); people already here stay. */
  async newInvite() {
    this.hostOnly();
    this.token = newToken();
    this.keys = await roomKeys(this.token);
    this.restartRendezvous();
    return this.token;
  }

  /** Leaves the room; a host ends it for everyone. */
  close() {
    if (this.state === 'ended') {
      return;
    }
    if (this.role === 'host') {
      this.broadcastControl({ t: 'end' });
    }
    this.end('closed', this.role === 'host' ? 'You ended the session.' : 'You left the session.', 50);
  }

  /** Connection paths ({id: 'direct' | 'relay' | 'local' | null}), refreshed. */
  async refreshPaths() {
    for (const [id, entry] of this.links) {
      const { path } = await entry.link.stats();
      const p = this.roster.get(id);
      if (p && p.path !== path) {
        p.path = path;
        if (this.role === 'host') {
          this.broadcastRoster();
        }
        this.emit('peers', this.peers());
      }
    }
  }

  // ── Starting ─────────────────────────────────────────────────────────

  /** @private */
  start() {
    this.startRendezvous();
    if (this.role === 'host') {
      this.setState('open');
    } else {
      this.connectTimer = setTimeout(() => this.connectTimeout(), this.connectTimeoutMs);
    }
    this.pathTimer = setInterval(() => this.refreshPaths(), 5000);
  }

  /** @private */
  startRendezvous() {
    const ctx = {
      role: this.role,
      peerId: this.me.id,
      keys: this.keys,
      protocol: this.protocol,
      iceServers: this.iceServers,
      link: (link) => this.addLink(link),
      status: (stage, detail) => this.status(stage, detail),
      wantsLinks: () => this.role === 'host' || !this.hostLink(),
      media: this.media,
    };
    this.rendezvous = this.specs.map(makeRendezvous);
    for (const r of this.rendezvous) {
      r.start(ctx);
      if (r instanceof ManualRendezvous) {
        this.manual = {
          offerCode: () => r.offerCode(),
          acceptOffer: (code) => r.acceptOffer(code),
          acceptAnswer: (code) => r.acceptAnswer(code),
        };
      }
    }
  }

  /** @private */
  restartRendezvous() {
    for (const r of this.rendezvous) {
      r.stop();
    }
    this.startRendezvous();
  }

  /** @private The stage a guest is at, for the user. */
  status(stage, detail) {
    this.stage = stage;
    this.emit('status', { stage, detail });
    if (stage === 'protocol') {
      this.emit('error', new SessionError('protocol', detail));
    }
  }

  /** @private No link to the host in time: say which step failed. */
  connectTimeout() {
    if (this.hostLink() || this.state === 'ended') {
      return;
    }
    const why = {
      'no-tracker': ['no-tracker', 'No tracker could be reached: this network may block them. Use the join codes instead.'],
      tracker: ['no-answer', 'The presenter did not answer: the link may be old, the presenter may have left, or the session is locked.'],
      answer: ['ice-failed', 'Your network and the presenter\'s could not connect directly. Try another network (a phone hotspot), add a TURN server, or use the join codes.'],
      offer: ['ice-failed', 'Your network and the presenter\'s could not connect directly. Try another network (a phone hotspot), add a TURN server, or use the join codes.'],
    }[this.lastLinkFailure ?? this.stage] ?? ['no-answer', 'The presenter did not answer: the link may be old, the presenter may have left, or the session is locked.'];
    dbg('no connection yet:', why[0]);
    this.emit('error', new SessionError(why[0], why[1]));
    // Keep trying: the presenter may still come.
    this.connectTimer = setTimeout(() => this.connectTimeout(), this.connectTimeoutMs * 2);
  }

  // ── Links ────────────────────────────────────────────────────────────

  /** @private A link from a rendezvous: named by its hello. */
  addLink(link) {
    if (this.state === 'ended') {
      link.close();
      return;
    }
    const entry = { link, decoder: new FrameDecoder(), peer: null, bad: [], queue: Promise.resolve() };
    this.unnamed.add(entry);
    link.onframe = (frame, fast) => this.frame(entry, frame, fast);
    link.onclose = (reason) => this.linkClosed(entry, reason);
    link.onopen = () => {
      dbg('link open, waiting for hello/welcome');
      if (this.role === 'guest') {
        this.sendControlTo(entry, { t: 'hello', id: this.me.id, instance: this.instance, name: this.me.name, color: this.me.color, protocol: this.protocol, v: PROTOCOL_VERSION });
      }
    };
    if (link.isOpen) {
      link.onopen();
    }
    // A link that never says hello is dropped.
    entry.helloTimer = setTimeout(() => !entry.peer && link.close(), 15000);
  }

  /** @private The link to the host (a guest's only link). */
  hostLink() {
    for (const entry of this.links.values()) {
      if (entry.peer?.role === 'host' && entry.link.isOpen) {
        return entry;
      }
    }
    return null;
  }

  /** @private */
  linkClosed(entry, reason) {
    dbg('link closed:', reason ?? '(no reason)', entry.peer ? `peer ${short(entry.peer.id)}` : '(before hello)');
    clearTimeout(entry.helloTimer);
    this.unnamed.delete(entry);
    if (reason === 'ice-failed') {
      this.lastLinkFailure = 'answer';
    }
    if (!entry.peer || this.links.get(entry.peer.id) !== entry) {
      return;
    }
    this.links.delete(entry.peer.id);
    if (this.role === 'host') {
      this.roster.delete(entry.peer.id);
      this.broadcastRoster();
      this.emit('peers', this.peers());
    } else if (this.state !== 'ended') {
      // The host went away: look for it again, for a while.
      this.roster = new Map([[this.me.id, this.roster.get(this.me.id)]]);
      this.emit('peers', this.peers());
      this.setState('reconnecting');
      for (const r of this.rendezvous) {
        r.retry?.();
      }
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => !this.hostLink() && this.end('host-gone', 'The presenter left: the session has ended.'), this.reconnectMs);
    }
  }

  /** @private A frame from a link. */
  frame(entry, frame, fast) {
    // Reliable frames decode in order; a fast frame is whole by itself.
    const decode = async () => {
      let m;
      try {
        m = fast ? await new FrameDecoder().push(frame) : await entry.decoder.push(frame);
      } catch {
        this.badFrame(entry);
        return;
      }
      if (m !== undefined) {
        this.envelope(entry, m, fast);
      }
    };
    if (fast) {
      decode();
    } else {
      entry.queue = entry.queue.then(decode);
    }
  }

  /** @private Ten bad frames in a minute close the link. */
  badFrame(entry) {
    const now = Date.now();
    entry.bad = entry.bad.filter((t) => now - t < 60000);
    entry.bad.push(now);
    if (entry.bad.length >= 10) {
      entry.link.close();
    }
  }

  /** @private One message: {c: channel or '$', m, t?: to, f?: from (set by the host)}. */
  envelope(entry, env, fast) {
    if (!env || typeof env !== 'object' || typeof env.c !== 'string' || (env.c !== '$' && !CHANNEL.test(env.c))) {
      this.badFrame(entry);
      return;
    }
    if (env.c === '$') {
      this.controlMessage(entry, env.m);
      return;
    }
    if (!entry.peer) {
      return; // nothing before the hello
    }
    if (this.role === 'host') {
      const from = entry.peer.id; // stamped here: a guest cannot claim another sender
      const to = typeof env.t === 'string' ? env.t : null;
      if (!this.accept(env.c, env.m, from)) {
        return;
      }
      if (!to || to === this.me.id) {
        this.deliver(env.c, env.m, from);
      }
      if (to !== this.me.id) {
        const out = { c: env.c, m: env.m, f: from };
        for (const [id, other] of this.links) {
          if (id !== from && (!to || id === to)) {
            this.sendEnvelope(other, out, fast);
          }
        }
      }
    } else {
      const from = entry.peer.role === 'host' && typeof env.f === 'string' ? env.f : entry.peer.id;
      this.deliver(env.c, env.m, from);
    }
  }

  /** @private */
  deliver(channel, message, from) {
    const ch = this.channels.get(channel);
    for (const cb of ch?.listeners.message ?? []) {
      try {
        cb(message, from);
      } catch (e) {
        console.error(e);
      }
    }
  }

  /** @private */
  joined(peer) {
    for (const ch of this.channels.values()) {
      for (const cb of ch.listeners.join) {
        try {
          cb({ ...peer });
        } catch (e) {
          console.error(e);
        }
      }
    }
  }

  // ── Control ──────────────────────────────────────────────────────────

  /** @private */
  controlMessage(entry, m) {
    if (!m || typeof m.t !== 'string') {
      this.badFrame(entry);
      return;
    }
    if (this.role === 'host') {
      if (m.t === 'hello' && !entry.peer) {
        this.hello(entry, m);
      } else if (m.t === 'me' && entry.peer) {
        Object.assign(entry.peer, cleanPresence(m));
        this.roster.set(entry.peer.id, { ...this.roster.get(entry.peer.id), ...cleanPresence(m) });
        this.broadcastRoster();
        this.emit('peers', this.peers());
      }
      return;
    }
    switch (m.t) {
      case 'welcome':
        this.welcome(entry, m);
        break;
      case 'roster':
        if (entry.peer?.role === 'host' && Array.isArray(m.peers)) {
          this.setRoster(m.peers);
        }
        break;
      case 'refuse':
        entry.link.close();
        this.end(m.reason === 'protocol' ? 'protocol' : m.reason === 'locked' ? 'locked' : 'refused', String(m.message ?? 'The presenter did not let you in.').slice(0, 200));
        break;
      case 'removed':
        this.end('removed', 'The presenter removed you from the session.');
        break;
      case 'end':
        this.end('host-ended', 'The presenter ended the session.');
        break;
      case 'locked':
        this.locked = !!m.on;
        this.emit('state', { state: this.state, locked: this.locked });
        break;
      default:
        break;
    }
  }

  /** @private Host: a guest says who it is. */
  hello(entry, m) {
    clearTimeout(entry.helloTimer);
    const refuse = (reason, message) => {
      this.sendControlTo(entry, { t: 'refuse', reason, message });
      setTimeout(() => entry.link.close(), 200);
    };
    if (m.protocol !== this.protocol) {
      refuse('protocol', 'The presenter runs another version: reload the page to join.');
      return;
    }
    if (!PEER.test(m.id ?? '') || m.id === this.me.id) {
      refuse('bad', 'Bad hello.');
      return;
    }
    if (this.removed.has(m.id)) {
      refuse('removed', 'The presenter removed you from this session.');
      return;
    }
    const existing = this.links.get(m.id);
    if (this.locked && !existing) {
      refuse('locked', 'The presenter locked the session: ask them to unlock it.');
      return;
    }
    if (existing && existing.instance === m.instance && existing.link.isOpen) {
      // A second link of the same tab (it answered twice): the first stays.
      this.unnamed.delete(entry);
      entry.link.close();
      return;
    }
    if (existing) {
      // The same peer again (a reload, a new network): the new link wins.
      this.links.delete(m.id);
      existing.link.close();
    }
    this.unnamed.delete(entry);
    entry.instance = typeof m.instance === 'string' ? m.instance.slice(0, 40) : '';
    entry.peer = { id: m.id, ...cleanPresence(m), role: 'guest', path: null };
    this.links.set(m.id, entry);
    this.roster.set(m.id, { ...entry.peer });
    this.sendControlTo(entry, { t: 'welcome', host: this.roster.get(this.me.id), peers: this.peers(), locked: this.locked });
    this.broadcastRoster();
    this.emit('peers', this.peers());
    this.joined(entry.peer);
    entry.link.stats().then(({ path }) => {
      const p = this.roster.get(m.id);
      if (p && this.links.get(m.id) === entry) {
        p.path = path;
        this.broadcastRoster();
        this.emit('peers', this.peers());
      }
    });
  }

  /** @private Guest: the host let us in. */
  welcome(entry, m) {
    if (!m.host || !PEER.test(m.host.id ?? '') || entry.peer) {
      return;
    }
    clearTimeout(entry.helloTimer);
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.connectTimer);
    this.unnamed.delete(entry);
    entry.peer = { id: m.host.id, ...cleanPresence(m.host), role: 'host', path: null };
    const old = this.links.get(m.host.id);
    if (old && old !== entry) {
      old.link.close();
    }
    this.links.set(m.host.id, entry);
    // Other links still opening are not needed now.
    for (const other of [...this.unnamed]) {
      other.link.close();
    }
    this.locked = !!m.locked;
    this.setRoster(m.peers);
    this.setState('open');
    this.joined(entry.peer);
  }

  /** @private Guest: the host's roster, cleaned. */
  setRoster(list) {
    const next = new Map();
    for (const p of list.slice(0, 500)) {
      if (p && PEER.test(p.id ?? '')) {
        next.set(p.id, { id: p.id, ...cleanPresence(p), role: p.role === 'host' ? 'host' : 'guest', path: ['direct', 'relay', 'local'].includes(p.path) ? p.path : null });
      }
    }
    next.set(this.me.id, { ...(next.get(this.me.id) ?? {}), ...this.me });
    this.roster = next;
    this.emit('peers', this.peers());
  }

  /** @private */
  broadcastRoster() {
    this.broadcastControl({ t: 'roster', peers: this.peers() });
  }

  /** @private */
  broadcastControl(m) {
    for (const entry of this.links.values()) {
      this.sendControlTo(entry, m);
    }
  }

  /** @private Guest: to the host. */
  control(m) {
    const h = this.hostLink();
    if (h) {
      this.sendControlTo(h, m);
    }
  }

  /** @private */
  sendControlTo(entry, m) {
    this.sendEnvelope(entry, { c: '$', m }, false);
  }

  // ── Sending ──────────────────────────────────────────────────────────

  /** @private send() of a channel. */
  send(channel, message, { to = null, fast = false } = {}) {
    if (this.state === 'ended') {
      throw new SessionError('closed', 'the session has ended');
    }
    if (to !== null && !PEER.test(to)) {
      throw new SessionError('config', 'bad peer id');
    }
    if (this.role === 'host') {
      for (const [id, entry] of this.links) {
        if (!to || id === to) {
          this.sendEnvelope(entry, { c: channel, m: message, f: this.me.id }, fast);
        }
      }
    } else {
      const h = this.hostLink();
      if (h) {
        this.sendEnvelope(h, to ? { c: channel, m: message, t: to } : { c: channel, m: message }, fast);
      }
    }
  }

  /** @private Frames go out in order per link; fast ones are dropped for a slow peer. */
  sendEnvelope(entry, env, fast) {
    if (fast) {
      if (!entry.link.isOpen || entry.link.buffered(true) > FAST_BUFFER_LIMIT) {
        return;
      }
      encodeFrames(env, { fast: true })
        .then((frames) => entry.link.isOpen && entry.link.send(frames[0], true))
        .catch(() => {});
      return;
    }
    entry.sendQueue = (entry.sendQueue ?? Promise.resolve())
      .then(async () => {
        const frames = await encodeFrames(env, { ids: this.frameIds });
        for (const f of frames) {
          if (!entry.link.isOpen) {
            return;
          }
          // Let a large message drain rather than overfill the channel.
          while (entry.link.buffered(false) > 4 * 1024 * 1024 && entry.link.isOpen) {
            await new Promise((r) => setTimeout(r, 20));
          }
          entry.link.send(f, false);
        }
      })
      .catch((e) => this.emit('error', e));
  }

  // ── State ────────────────────────────────────────────────────────────

  /** @private */
  setState(state, extra = {}) {
    dbg('session state:', state);
    this.state = state;
    this.emit('state', { state, locked: this.locked, ...extra });
  }

  /** @private */
  end(reason, message, delay = 0) {
    if (this.state === 'ended') {
      return;
    }
    dbg('session ended:', reason);
    this.state = 'ended';
    clearTimeout(this.connectTimer);
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pathTimer);
    const finish = () => {
      for (const r of this.rendezvous) {
        r.stop();
      }
      for (const entry of [...this.links.values(), ...this.unnamed]) {
        entry.link.close();
      }
      this.links.clear();
      this.unnamed.clear();
    };
    if (delay) {
      setTimeout(finish, delay);
    } else {
      finish();
    }
    this.emit('state', { state: 'ended', reason, message });
  }

  /** @private */
  hostOnly() {
    if (this.role !== 'host') {
      throw new SessionError('config', 'only the host can do that');
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
 * Creates and starts a session (DESIGN.md section 5.1).
 *
 * @param {{role: 'host' | 'guest', token?: string, peerId?: string,
 *          protocol?: string, me?: {name, color}, rendezvous?: object[],
 *          iceServers?: RTCIceServer[], accept?: (channel, message, from) => boolean,
 *          connectTimeoutMs?: number, reconnectMs?: number}} options
 * @returns {Promise<Session>} rejects on a malformed token, a bad role, or
 *          when WebRTC is needed and missing
 */
export async function createSession(options) {
  dbg = typeof options.log === 'function' ? (...args) => options.log(...args) : () => {};
  if (options.role !== 'host' && options.role !== 'guest') {
    throw new SessionError('config', 'role is host or guest');
  }
  const token = options.token ?? (options.role === 'host' ? newToken() : null);
  if (!token) {
    throw new SessionError('bad-token', 'A guest needs the invite link\'s token.');
  }
  const needsWebRtc = (options.rendezvous ?? []).some((r) => r?.kind === 'torrent' || r?.kind === 'manual');
  if (needsWebRtc && typeof RTCPeerConnection !== 'function') {
    throw new SessionError('no-webrtc', 'This browser cannot make peer-to-peer connections (WebRTC).');
  }
  const keys = await roomKeys(token);
  dbg('session:', options.role, 'peer', short(options.peerId ?? ''), 'rendezvous', (options.rendezvous ?? []).map((r) => r.kind ?? 'custom').join('+') || 'none', 'ICE servers', (options.iceServers ?? []).length);
  const session = new Session({ ...options, token }, keys);
  session.start();
  return session;
}
