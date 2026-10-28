// MIT License © 2026 Carlos Lopez
import type { Session } from '@inkpad/collab-session';
import type { ProxyHooks } from '@inkpad/collab-session/session-proxy';
import type { Snapshot, WhiteboardModel } from './collab-whiteboard.js';

export interface BoardKeeper {
  readonly model: WhiteboardModel;
  snapshot(): Snapshot;
  /** Pass to `serveSessionProxy(session, port, keeper.hooks)`. */
  readonly hooks: Required<ProxyHooks>;
}

export function createBoardKeeper(session: Session, options?: { channel?: string }): BoardKeeper;
