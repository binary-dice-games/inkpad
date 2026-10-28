// MIT License © 2026 Carlos Lopez
/**
 * @file board-keeper.js A whiteboard model without a screen, kept next to the
 * host session. The host has no whiteboard view of its own (the presenter draws
 * in the console, a viewer like any other), so the keeper holds the drawings:
 * it merges everyone's changes, hands a snapshot to each peer that joins, and
 * answers their `want` requests. Drawings therefore outlive the console being
 * closed and reopened.
 */

import { WhiteboardModel } from './collab-whiteboard.js';

/**
 * @param {import('@inkpad/collab-session').Session} session the host session
 * @param {{channel?: string}} [options]
 */
export function createBoardKeeper(session, { channel = 'wb' } = {}) {
  const model = new WhiteboardModel(session.me.id);
  const ch = session.channel(channel);

  ch.on('message', (m, from) => {
    if (!m || typeof m !== 'object') {
      return;
    }
    if (m.t === 'op') {
      model.apply(m.op);
    } else if (m.t === 'sync') {
      model.merge(m.snapshot);
      if (m.want === true) {
        ch.send({ t: 'sync', snapshot: model.snapshot() }, { to: from });
      }
    }
  });
  ch.on('join', (peer) => {
    ch.send({ t: 'sync', snapshot: model.snapshot() }, { to: peer.id });
  });

  return {
    model,
    snapshot: () => model.snapshot(),
  };
}
