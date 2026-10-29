// MIT License © 2026 Carlos Lopez
import { WebSocketServer, WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';

interface Announce {
  action?: string;
  info_hash?: string;
  peer_id?: string;
  to_peer_id?: string;
  offer_id?: string;
  offers?: { offer: unknown; offer_id: string }[];
  answer?: unknown;
}

/**
 * A WebTorrent tracker that only introduces peers: it keeps a swarm per
 * info_hash and relays offers and answers, like the public trackers do. Tests
 * use it so they never touch the internet.
 */
export class FakeTracker {
  private readonly server: WebSocketServer;
  private readonly swarms = new Map<string, Map<string, WebSocket>>();
  /** Every message the tracker has received (to check what a tracker could see). */
  readonly seen: string[] = [];
  /** Messages larger than this many bytes are dropped, as public trackers do (0: no limit). */
  maxMessageBytes = 0;
  /** How many messages were dropped for their size. */
  dropped = 0;

  private constructor(server: WebSocketServer) {
    this.server = server;
    server.on('connection', (ws) => this.connection(ws));
  }

  /** Starts a tracker on a free port of the loopback interface. */
  static async start(): Promise<FakeTracker> {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    return new FakeTracker(server);
  }

  get url(): string {
    return `ws://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  /** Number of peers in a swarm, or in all of them. */
  peers(infoHash?: string): number {
    if (infoHash !== undefined) {
      return this.swarms.get(infoHash)?.size ?? 0;
    }
    return [...this.swarms.values()].reduce((n, s) => n + s.size, 0);
  }

  async stop(): Promise<void> {
    for (const client of this.server.clients) {
      client.terminate();
    }
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private connection(ws: WebSocket): void {
    const joined: { hash: string; id: string }[] = [];
    ws.on('message', (data) => {
      const text = data.toString();
      if (this.maxMessageBytes > 0 && text.length > this.maxMessageBytes) {
        this.dropped += 1;
        return;
      }
      this.seen.push(text);
      let m: Announce;
      try {
        m = JSON.parse(text) as Announce;
      } catch {
        return;
      }
      if (m.action !== 'announce' || !m.info_hash || !m.peer_id) {
        return;
      }
      const swarm = this.swarms.get(m.info_hash) ?? new Map<string, WebSocket>();
      this.swarms.set(m.info_hash, swarm);
      if (!swarm.has(m.peer_id)) {
        joined.push({ hash: m.info_hash, id: m.peer_id });
      }
      swarm.set(m.peer_id, ws);

      if (m.to_peer_id) {
        // An answer to one peer's offer.
        swarm.get(m.to_peer_id)?.send(
          JSON.stringify({
            action: 'announce',
            info_hash: m.info_hash,
            peer_id: m.peer_id,
            offer_id: m.offer_id,
            answer: m.answer,
          }),
        );
        return;
      }
      const others = [...swarm.entries()].filter(([id]) => id !== m.peer_id);
      (m.offers ?? []).forEach((o, i) => {
        // Each offer goes to a different peer, as a tracker does.
        const target = others[i % Math.max(others.length, 1)];
        target?.[1].send(
          JSON.stringify({
            action: 'announce',
            info_hash: m.info_hash,
            peer_id: m.peer_id,
            offer_id: o.offer_id,
            offer: o.offer,
          }),
        );
      });
      ws.send(
        JSON.stringify({
          action: 'announce',
          info_hash: m.info_hash,
          interval: 120,
          complete: swarm.size,
          incomplete: 0,
        }),
      );
    });
    ws.on('close', () => {
      for (const { hash, id } of joined) {
        const swarm = this.swarms.get(hash);
        if (swarm?.get(id) === ws) {
          swarm.delete(id);
        }
      }
    });
  }
}
