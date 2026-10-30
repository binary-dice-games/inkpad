// MIT License © 2026 Binary Dice Games (adapted for inksplat)

export const PROTOCOL_VERSION: number;
export const FRAME_BYTES: number;
export const MAX_MESSAGE_BYTES: number;

/** A failure the user can act on; `reason` is a stable code. */
export class SessionError extends Error {
  constructor(reason: string, message?: string);
  reason: string;
}

export interface Presence {
  name: string;
  color: string;
}

export interface Peer extends Presence {
  id: string;
  role: 'host' | 'guest';
  path: 'direct' | 'relay' | 'local' | null;
}

export interface RoomKeys {
  topic: string;
  seal: CryptoKey;
}

export interface SessionStateEvent {
  state: 'connecting' | 'open' | 'reconnecting' | 'ended';
  locked?: boolean;
  reason?: string;
  message?: string;
}

export interface SessionStatusEvent {
  stage: string;
  detail?: string;
}

export interface ChannelApi {
  readonly name: string;
  /** Sends to everyone, or only to `to`; `fast` is unordered and may be dropped. */
  send(message: unknown, options?: { to?: string | null; fast?: boolean }): void;
  on(event: 'message', cb: (message: unknown, from: string) => void): () => void;
  on(event: 'join', cb: (peer: Peer) => void): () => void;
}

export interface MediaParams {
  /** Maximum frame rate of the sent video. */
  fps?: number;
  /** Maximum bitrate in bits per second. */
  maxBitrate?: number;
  /** Downscale factor, at least 1. */
  scale?: number;
  contentHint?: 'detail' | 'text' | 'motion' | '';
  /** MIME types in order of preference (e.g. `video/VP9`); used for links made afterwards. */
  codecs?: string[];
}

export type RendezvousSpec =
  | {
      kind: 'torrent';
      urls: string[];
      announceMs?: { host: number; guest: number };
      gatherMs?: number;
      offers?: number;
      /** How long to stay announced to the trackers, in ms; 0 (default) until stopped. */
      ttlMs?: number;
    }
  | { kind: 'manual'; gatherMs?: number }
  | { kind: 'broadcast' }
  | { kind: 'memory'; network: MemoryNetwork }
  | { start(ctx: unknown): void; stop(): void; retry?(): void };

export interface SessionOptions {
  role: 'host' | 'guest';
  /** Required for a guest; a host makes one. */
  token?: string;
  peerId?: string;
  /** Default `inksplat/1`. */
  protocol?: string;
  me?: Partial<Presence>;
  rendezvous?: RendezvousSpec[];
  iceServers?: RTCIceServer[];
  /** Host: filters guests' messages before they are delivered or relayed. */
  accept?: (channel: string, message: unknown, from: string) => boolean;
  connectTimeoutMs?: number;
  reconnectMs?: number;
  /**
   * Guest: video codecs by MIME type in order of preference (e.g. `video/VP9`), listed first in
   * the offer; the presenter sends with the first one it supports.
   */
  videoCodecs?: string[];
  /**
   * Receives one line per step of making a connection (arguments as for console.log):
   * trackers, announces, offers, answers, ICE and channel states. No secrets are logged.
   */
  log?: (...args: unknown[]) => void;
}

export interface MemoryNetwork {
  rendezvous(): unknown;
}

export class Session {
  readonly role: 'host' | 'guest';
  readonly me: Peer;
  token: string;
  state: SessionStateEvent['state'];
  locked: boolean;
  /** Only when a manual rendezvous is configured. */
  manual: {
    offerCode(): Promise<string>;
    acceptOffer(code: string): Promise<string>;
    acceptAnswer(code: string): Promise<void>;
  } | null;
  /** `inksplat=<token>`. */
  inviteFragment(): string;
  peers(): Peer[];
  host(): Peer | null;
  channel(name: string): ChannelApi;
  on(event: 'peers', cb: (peers: Peer[]) => void): () => void;
  on(event: 'state', cb: (e: SessionStateEvent) => void): () => void;
  on(event: 'status', cb: (e: SessionStatusEvent) => void): () => void;
  on(event: 'error', cb: (e: SessionError | Error) => void): () => void;
  /** Guest: the presenter's video. */
  on(event: 'track', cb: (stream: MediaStream) => void): () => void;
  setMe(me: Partial<Presence>): void;
  /** Host: no new joins while locked. */
  lock(on: boolean): void;
  /** Host: closes a guest's link and refuses its id from now on. */
  remove(id: string): void;
  /** Host: a new token; people already here stay. */
  newInvite(): Promise<string>;
  /** Host: the stream whose video goes to every viewer; null stops the video. */
  setMedia(stream: MediaStream | null): void;
  /** Host: sender parameters, applied live. */
  mediaParams(params: MediaParams): void;
  close(): void;
  refreshPaths(): Promise<void>;
}

/**
 * Creates and starts a session.
 * @throws {SessionError} on a bad role or token, or when WebRTC is needed and missing
 */
export function createSession(options: SessionOptions): Promise<Session>;

export function newToken(): string;
export function isToken(token: unknown): boolean;
export function roomKeys(token: string): Promise<RoomKeys>;
export function sealMessage(keys: RoomKeys, value: unknown): Promise<string>;
export function unsealMessage(keys: RoomKeys, text: string): Promise<unknown>;
export function encodeFrames(
  value: unknown,
  options?: { fast?: boolean; ids?: { next: number } },
): Promise<Uint8Array[]>;
export function toBase64Url(bytes: Uint8Array): string;
export function fromBase64Url(text: string): Uint8Array;

export class FrameDecoder {
  /** The decoded message, or undefined while chunks are missing. Throws on a bad frame. */
  push(frame: Uint8Array): Promise<unknown>;
}

export function memoryLinkPair(): [unknown, unknown];
export function createMemoryNetwork(): MemoryNetwork;
