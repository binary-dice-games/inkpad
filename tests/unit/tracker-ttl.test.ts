// MIT License © 2026 Carlos Lopez
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSession } from '@inkpad/collab-session';
import type { Session } from '@inkpad/collab-session';
import { ShareHost } from '../../viewer/src/share-host';
import { DEFAULT_SETTINGS } from '../../viewer/src/settings';
import { FakeTracker } from '../support/fake-tracker';
import { settle, until } from '../support/wait';

describe('tracker lifetime', () => {
  // Nobody joins here, so no connection is made: the session only needs WebRTC to be there.
  const global = globalThis as { RTCPeerConnection?: unknown };
  const had = global.RTCPeerConnection;
  beforeAll(() => {
    global.RTCPeerConnection ??= class {};
  });
  afterAll(() => {
    global.RTCPeerConnection = had;
  });

  let tracker: FakeTracker;
  const closers: { close(): void }[] = [];

  beforeEach(async () => {
    tracker = await FakeTracker.start();
  });

  afterEach(async () => {
    closers.splice(0).forEach((c) => c.close());
    await tracker.stop();
  });

  async function host(ttlMs: number): Promise<Session> {
    const session = await createSession({
      role: 'host',
      rendezvous: [{ kind: 'torrent', urls: [tracker.url], ttlMs }],
    });
    closers.push(session);
    return session;
  }

  it('leaves the swarm when the time to live is over and says so', async () => {
    const session = await host(150);
    const stages: string[] = [];
    session.on('status', (e) => stages.push(e.stage));
    await until(() => tracker.peers() === 1, 'the host announced');
    await until(() => stages.includes('expired'), 'expired');
    await until(() => tracker.peers() === 0, 'the tracker forgot the host');
    expect(tracker.seen.some((m) => m.includes('"event":"stopped"'))).toBe(true);
  });

  it('stays announced without a time to live', async () => {
    const session = await host(0);
    const stages: string[] = [];
    session.on('status', (e) => stages.push(e.stage));
    await until(() => tracker.peers() === 1, 'the host announced');
    await settle(300);
    expect(tracker.peers()).toBe(1);
    expect(stages).not.toContain('expired');
  });

  it('is a problem on the presenter page until there is a new link', async () => {
    const share = await ShareHost.start({
      settings: { ...DEFAULT_SETTINGS, trackers: [tracker.url], trackerTtlMinutes: 0.003 },
      rendezvous: [{ kind: 'torrent', urls: [tracker.url], ttlMs: 400 }],
    });
    closers.push({ close: () => share.stop() });
    await until(() => share.ui().problem === 'tracker-expired', 'link expired');
    await share.command({ cmd: 'newLink' });
    expect(share.ui().problem).toBeNull();
    await until(() => tracker.peers() === 1, 'announced again with the new link');
  });
});
