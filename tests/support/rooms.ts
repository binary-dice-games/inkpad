// MIT License © 2026 Carlos Lopez
import { createMemoryNetwork, createSession } from '@inksplat/collab-session';
import type { Session, SessionOptions } from '@inksplat/collab-session';

/** A host and guests in one in-memory room (no WebRTC). */
export class TestRoom {
  readonly network = createMemoryNetwork();
  readonly sessions: Session[] = [];
  host!: Session;

  private options(extra: Partial<SessionOptions>): SessionOptions {
    return {
      rendezvous: [{ kind: 'memory', network: this.network }],
      ...extra,
    } as SessionOptions;
  }

  async start(extra: Partial<SessionOptions> = {}): Promise<Session> {
    this.host = await createSession(
      this.options({ role: 'host', me: { name: 'Host', color: '#3e63dd' }, ...extra }),
    );
    this.sessions.push(this.host);
    return this.host;
  }

  async join(name: string, extra: Partial<SessionOptions> = {}): Promise<Session> {
    const guest = await createSession(
      this.options({
        role: 'guest',
        token: this.host.token,
        me: { name, color: '#e5484d' },
        ...extra,
      }),
    );
    this.sessions.push(guest);
    return guest;
  }

  close(): void {
    for (const s of this.sessions) {
      s.close();
    }
  }
}
