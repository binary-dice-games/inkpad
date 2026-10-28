// MIT License © 2026 Carlos Lopez
/**
 * @file session-proxy.js Lets a view in another context (the overlay in a
 * page) use the host session that lives elsewhere (the extension's offscreen
 * document). The view gets an object with the surface the whiteboard expects
 * of a session (`role`, `me`, `peers()`, `host()`, `channel()`, `on()`); the
 * real session is driven through a message port.
 *
 * A port is anything with `postMessage(msg)`, `onMessage.addListener(cb)` and
 * optionally `onDisconnect.addListener(cb)`: a chrome.runtime.Port, or a
 * MessageChannel wrapped by `memoryPortPair()` for tests.
 */

/** Two joined in-memory ports (tests). Messages are cloned and delivered asynchronously. */
export function memoryPortPair() {
  const make = () => {
    const message = new Set();
    const disconnect = new Set();
    return {
      message,
      disconnect,
      port: {
        postMessage(msg) {
          const copy = structuredClone(msg);
          queueMicrotask(() => {
            for (const cb of [...this.peer.message]) {
              cb(copy);
            }
          });
        },
        onMessage: {
          addListener: (cb) => message.add(cb),
          removeListener: (cb) => message.delete(cb),
        },
        onDisconnect: {
          addListener: (cb) => disconnect.add(cb),
          removeListener: (cb) => disconnect.delete(cb),
        },
        disconnect() {
          queueMicrotask(() => {
            for (const cb of [...this.peer.disconnect]) {
              cb();
            }
          });
        },
      },
    };
  };
  const a = make();
  const b = make();
  a.port.peer = b;
  b.port.peer = a;
  return [a.port, b.port];
}

/**
 * Real-session side: serves one view over `port`.
 *
 * @param {import('./collab-session.js').Session} session the host session
 * @param {object} port the port to the view
 * @param {{tap?: (channel: string, message: unknown, options: object) => void,
 *          onAttach?: (channel: string, send: (message: unknown) => void) => void,
 *          onDetach?: (channel: string) => void}} [hooks]
 *        `tap` sees what the view sends (to keep state); `onAttach` runs when
 *        the view starts listening to a channel, with a function that sends
 *        it a message as if from this peer; `onDetach` when the port closes
 * @returns {() => void} stops serving
 */
export function serveSessionProxy(session, port, { tap, onAttach, onDetach } = {}) {
  const post = (msg) => {
    try {
      port.postMessage(msg);
    } catch {
      // the view is gone
    }
  };
  const subscribed = new Map(); // channel -> unsubscribe[]
  const subscribe = (c) => {
    if (subscribed.has(c)) {
      return;
    }
    const ch = session.channel(c);
    subscribed.set(c, [
      ch.on('message', (m, from) => post({ k: 'msg', c, m, from })),
      ch.on('join', (peer) => post({ k: 'join', c, peer })),
    ]);
    onAttach?.(c, (m) => post({ k: 'msg', c, m, from: session.me.id }));
  };
  const onMessage = (msg) => {
    if (!msg || typeof msg !== 'object') {
      return;
    }
    if (msg.k === 'sub' && typeof msg.c === 'string') {
      try {
        subscribe(msg.c);
      } catch {
        // a bad channel name
      }
    } else if (msg.k === 'send' && typeof msg.c === 'string') {
      const options = { to: msg.opts?.to ?? null, fast: !!msg.opts?.fast };
      tap?.(msg.c, msg.m, options);
      try {
        session.channel(msg.c).send(msg.m, options);
      } catch {
        // an ended session: the view is told through the state event
      }
    }
  };
  const offs = [
    session.on('peers', (peers) => post({ k: 'peers', peers })),
    session.on('state', (state) => post({ k: 'state', state })),
  ];
  const stop = () => {
    port.onMessage.removeListener?.(onMessage);
    for (const off of offs) {
      off();
    }
    for (const [c, list] of subscribed) {
      list.forEach((off) => off());
      onDetach?.(c);
    }
    subscribed.clear();
  };
  port.onMessage.addListener(onMessage);
  port.onDisconnect?.addListener(stop);
  post({
    k: 'init',
    me: session.me,
    role: session.role,
    peers: session.peers(),
    state: { state: session.state, locked: session.locked },
  });
  return stop;
}

/**
 * View side: resolves to a session-like object once the real session has
 * answered over `port`.
 *
 * @param {object} port the port to `serveSessionProxy`
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<import('./session-proxy.js').SessionProxy>}
 * @throws {Error} if no `init` arrives in time (the service is not there)
 */
export function connectSessionProxy(port, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const listeners = { peers: new Set(), state: new Set() };
    const channels = new Map();
    let peers = [];
    let timer;
    let proxy = null;
    const emit = (event, detail) => {
      for (const cb of listeners[event]) {
        try {
          cb(detail);
        } catch (e) {
          console.error(e);
        }
      }
    };
    const channel = (name) => {
      let entry = channels.get(name);
      if (!entry) {
        const subs = { message: new Set(), join: new Set() };
        entry = {
          subs,
          api: {
            name,
            send: (m, opts = {}) =>
              port.postMessage({
                k: 'send',
                c: name,
                m,
                opts: { to: opts.to ?? null, fast: !!opts.fast },
              }),
            on: (event, cb) => {
              subs[event]?.add(cb);
              return () => subs[event]?.delete(cb);
            },
          },
        };
        channels.set(name, entry);
        port.postMessage({ k: 'sub', c: name });
      }
      return entry.api;
    };
    port.onMessage.addListener((msg) => {
      if (!msg || typeof msg !== 'object') {
        return;
      }
      if (msg.k === 'init' && !proxy) {
        clearTimeout(timer);
        peers = msg.peers;
        proxy = {
          role: msg.role,
          me: msg.me,
          state: msg.state,
          peers: () => peers.map((p) => ({ ...p })),
          host: () => peers.find((p) => p.role === 'host') ?? null,
          channel,
          on: (event, cb) => {
            listeners[event]?.add(cb);
            return () => listeners[event]?.delete(cb);
          },
        };
        resolve(proxy);
      } else if (!proxy) {
        return;
      } else if (msg.k === 'peers') {
        peers = msg.peers;
        emit('peers', proxy.peers());
      } else if (msg.k === 'state') {
        proxy.state = msg.state;
        emit('state', msg.state);
      } else if (msg.k === 'msg' || msg.k === 'join') {
        const entry = channels.get(msg.c);
        for (const cb of msg.k === 'msg' ? (entry?.subs.message ?? []) : (entry?.subs.join ?? [])) {
          try {
            if (msg.k === 'msg') {
              cb(msg.m, msg.from);
            } else {
              cb(msg.peer);
            }
          } catch (e) {
            console.error(e);
          }
        }
      }
    });
    port.onDisconnect?.addListener(() =>
      emit('state', {
        state: 'ended',
        reason: 'disconnected',
        message: 'The connection to the extension closed.',
      }),
    );
    timer = setTimeout(() => reject(new Error('no session answered the proxy')), timeoutMs);
  });
}
