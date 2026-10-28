// MIT License © 2026 Carlos Lopez
import type { ChannelApi, Peer, Session, SessionStateEvent } from './collab-session.js';

/** The part of a chrome.runtime.Port the proxy uses. */
export interface ProxyPort {
  postMessage(message: unknown): void;
  onMessage: {
    addListener(cb: (message: unknown) => void): void;
    removeListener?(cb: (message: unknown) => void): void;
  };
  onDisconnect?: { addListener(cb: () => void): void };
}

/** The session surface a whiteboard view needs. */
export interface SessionProxy {
  readonly role: 'host' | 'guest';
  readonly me: Peer;
  state: { state: SessionStateEvent['state']; locked?: boolean };
  peers(): Peer[];
  host(): Peer | null;
  channel(name: string): ChannelApi;
  on(event: 'peers', cb: (peers: Peer[]) => void): () => void;
  on(event: 'state', cb: (e: SessionStateEvent) => void): () => void;
}

export interface ProxyHooks {
  /** Sees what the view sends (to keep state in the serving context). */
  tap?(channel: string, message: unknown, options: { to: string | null; fast: boolean }): void;
  /** The view started listening to `channel`; `send` delivers a message to it. */
  onAttach?(channel: string, send: (message: unknown) => void): void;
  onDetach?(channel: string): void;
}

/** Two joined in-memory ports (tests). */
export function memoryPortPair(): [
  ProxyPort & { disconnect(): void },
  ProxyPort & { disconnect(): void },
];

/** Serves one view over `port`; returns a function that stops serving. */
export function serveSessionProxy(
  session: Session,
  port: ProxyPort,
  hooks?: ProxyHooks,
): () => void;

/** @throws {Error} if no session answers within `timeoutMs` (default 5000) */
export function connectSessionProxy(
  port: ProxyPort,
  options?: { timeoutMs?: number },
): Promise<SessionProxy>;
