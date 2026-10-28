// MIT License © 2026 Carlos Lopez
/**
 * @file board-keeper.js A whiteboard model without a screen, kept next to the
 * host session. The overlay (a view) comes and goes with page loads; the
 * keeper holds the drawings meanwhile, merges viewers' changes, and hands a
 * snapshot to a view that attaches.
 *
 * Wire it with `serveSessionProxy(session, port, keeper.hooks)`. When no
 * view is attached the keeper also does what a whiteboard does for joining
 * viewers: it sends them a snapshot and answers their `want` requests.
 */

import { WhiteboardModel } from './collab-whiteboard.js';

/**
 * @param {import('@inkpad/collab-session').Session} session the host session
 * @param {{channel?: string}} [options]
 */
export function createBoardKeeper(session, { channel = 'wb' } = {}) {
  const model = new WhiteboardModel(session.me.id);
  const ch = session.channel(channel);
  let views = 0;

  /** Merges a whiteboard message (from a viewer, or from the view). */
  const observe = (m) => {
    if (!m || typeof m !== 'object') {
      return;
    }
    if (m.t === 'op') {
      model.apply(m.op);
    } else if (m.t === 'sync') {
      model.merge(m.snapshot);
    }
  };

  ch.on('message', (m, from) => {
    observe(m);
    if (views === 0 && m?.t === 'sync' && m.want === true) {
      ch.send({ t: 'sync', snapshot: model.snapshot() }, { to: from });
    }
  });
  ch.on('join', (peer) => {
    if (views === 0) {
      ch.send({ t: 'sync', snapshot: model.snapshot() }, { to: peer.id });
    }
  });

  return {
    model,
    snapshot: () => model.snapshot(),
    /** Hooks for `serveSessionProxy`. */
    hooks: {
      tap(c, m) {
        if (c === channel) {
          observe(m);
        }
      },
      onAttach(c, send) {
        if (c === channel) {
          views += 1;
          send({ t: 'sync', snapshot: model.snapshot() });
        }
      },
      onDetach(c) {
        if (c === channel) {
          views = Math.max(0, views - 1);
        }
      },
    },
  };
}
