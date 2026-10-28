// MIT License © 2026 Carlos Lopez
import type { Session } from '@inkpad/collab-session';
import type { Snapshot, WhiteboardModel } from './collab-whiteboard.js';

export interface BoardKeeper {
  readonly model: WhiteboardModel;
  snapshot(): Snapshot;
}

/** Keeps the whiteboard of a host session; see board-keeper.js. */
export function createBoardKeeper(session: Session, options?: { channel?: string }): BoardKeeper;
