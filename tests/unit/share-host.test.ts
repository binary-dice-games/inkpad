// MIT License © 2026 Carlos Lopez
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryNetwork, createSession } from '@inkpad/collab-session';
import type { Session } from '@inkpad/collab-session';
import { connectSessionProxy, memoryPortPair } from '@inkpad/collab-session/session-proxy';
import { WhiteboardModel } from '@inkpad/collab-whiteboard';
import { PROTOCOL, cleanStage } from '@inkpad/defaults';
import type { Stage } from '@inkpad/defaults';
import { ShareHost } from '../../extension/src/share-host';
import { DEFAULT_SETTINGS } from '../../extension/src/settings';
import type { Settings } from '../../extension/src/settings';
import { settle, until } from '../support/wait';

const stroke = { kind: 'ink', points: [0, 0, 20, 20], color: '#e5484d', width: 3 };

describe('ShareHost', () => {
  const network = createMemoryNetwork();
  const opened: { stop(): void }[] = [];
  const guests: Session[] = [];

  afterEach(() => {
    opened.splice(0).forEach((h) => h.stop());
    guests.splice(0).forEach((g) => g.close());
  });

  async function start(settings: Partial<Settings> = {}): Promise<ShareHost> {
    const host = await ShareHost.start({
      settings: { ...DEFAULT_SETTINGS, name: 'Pat', ...settings },
      tabId: 42,
      rendezvous: [{ kind: 'memory', network }],
    });
    opened.push(host);
    return host;
  }

  async function join(host: ShareHost, name: string): Promise<{ guest: Session; stages: Stage[] }> {
    const guest = await createSession({
      role: 'guest',
      token: host.session.token,
      protocol: PROTOCOL,
      me: { name, color: '#e5484d' },
      rendezvous: [{ kind: 'memory', network }],
    });
    guests.push(guest);
    const stages: Stage[] = [];
    guest.channel('stage').on('message', (m) => {
      const stage = cleanStage(m);
      if (stage) stages.push(stage);
    });
    await until(() => guest.host(), 'guest reached the host');
    return { guest, stages };
  }

  it('builds the link from the viewer base and the session token', async () => {
    const host = await start({ viewerBase: 'https://example.github.io/inkpad/' });
    expect(host.link()).toBe(`https://example.github.io/inkpad/#inkpad=${host.session.token}`);
    expect(host.ui()).toMatchObject({ phase: 'live', tabId: 42, viewers: [], drawing: true });
  });

  it('tells a viewer the stage when it joins', async () => {
    const host = await start();
    const { stages } = await join(host, 'Ana');
    await until(() => stages.length > 0, 'stage message');
    expect(stages[0]).toMatchObject({ state: 'live', drawing: true, w: 1280, h: 720 });
    expect(stages[0]?.aspect).toBeCloseTo(16 / 9);
  });

  it('lists viewers and reports changes', async () => {
    const host = await start();
    const seen: number[] = [];
    host.onChange((ui) => seen.push(ui.viewers.length));
    await join(host, 'Ana');
    await until(() => host.ui().viewers.length === 1, 'viewer in the list');
    expect(host.ui().viewers[0]).toMatchObject({ name: 'Ana' });
    expect(seen).toContain(1);
  });

  it('follows the page size: viewport changes update the stage', async () => {
    const host = await start();
    const { stages } = await join(host, 'Ana');
    await host.command({ cmd: 'viewport', w: 1000, h: 500 });
    await until(() => stages.some((s) => s.w === 1000), 'new stage');
    expect(stages.at(-1)?.aspect).toBe(2);
    await host.command({ cmd: 'viewport', w: Number.NaN, h: 5 });
    await host.command({ cmd: 'viewport', w: 99999, h: 5 });
    expect(host.stage()).toMatchObject({ w: 1000, h: 500 });
  });

  it('pauses and resumes', async () => {
    const host = await start();
    const { stages } = await join(host, 'Ana');
    await host.command({ cmd: 'pause', on: true });
    expect(host.ui()).toMatchObject({ phase: 'paused', paused: true });
    await until(() => stages.at(-1)?.state === 'paused', 'paused stage');
    await host.command({ cmd: 'pause', on: false });
    await until(() => stages.at(-1)?.state === 'live', 'live stage');
  });

  it("drops viewers' drawing while it is off, and accepts it again when on", async () => {
    const host = await start({ viewersMayDraw: false });
    const { guest, stages } = await join(host, 'Ana');
    await until(() => stages.length > 0, 'stage');
    expect(stages[0]?.drawing).toBe(false);

    const model = new WhiteboardModel(guest.me.id);
    guest.channel('wb').send({ t: 'op', op: model.add(stroke) });
    await settle();
    expect(host.keeper.model.live()).toHaveLength(0);

    await host.command({ cmd: 'drawing', on: true });
    await until(() => stages.at(-1)?.drawing === true, 'drawing on');
    guest.channel('wb').send({ t: 'op', op: model.add(stroke) });
    await until(() => host.keeper.model.live().length === 1, 'stroke accepted');
  });

  it('does not let a viewer speak on the stage channel or any other host channel', async () => {
    const host = await start();
    const a = await join(host, 'Ana');
    const b = await join(host, 'Ben');
    await until(() => b.stages.length > 0, 'stage');
    const before = b.stages.length;
    const other: unknown[] = [];
    b.guest.channel('chat').on('message', (m) => other.push(m));
    a.guest
      .channel('stage')
      .send({ aspect: 1, w: 1, h: 1, fps: 1, state: 'ended', drawing: false });
    a.guest.channel('chat').send('hi');
    await settle(100);
    expect(b.stages.length).toBe(before);
    expect(other).toEqual([]);
  });

  it('removes a viewer and locks the room', async () => {
    const host = await start();
    const { guest } = await join(host, 'Ana');
    await until(() => host.ui().viewers.length === 1, 'viewer');
    await host.command({ cmd: 'lock', on: true });
    expect(host.ui().locked).toBe(true);
    await host.command({ cmd: 'remove', id: guest.me.id });
    await until(() => host.ui().viewers.length === 0, 'viewer removed');
  });

  it('issues a new link without dropping the people already there', async () => {
    const host = await start();
    await join(host, 'Ana');
    const before = host.link();
    await host.command({ cmd: 'newLink' });
    expect(host.link()).not.toBe(before);
    expect(host.ui().viewers).toHaveLength(1);
  });

  it('serves the overlay with the kept drawings and takes its commands', async () => {
    const host = await start();
    const [viewPort, servePort] = memoryPortPair();
    host.serve(servePort);
    const proxy = await connectSessionProxy(viewPort);
    expect(proxy.role).toBe('host');
    const received: unknown[] = [];
    proxy.channel('wb').on('message', (m) => received.push(m));
    await until(() => received.length > 0, 'snapshot for the overlay');
    const model = new WhiteboardModel(proxy.me.id);
    proxy.channel('wb').send({ t: 'op', op: model.add(stroke) });
    await until(() => host.keeper.model.live().length === 1, 'keeper has the overlay stroke');
  });

  it('ends the share: viewers see `ended`, then the room closes', async () => {
    const host = await start();
    const { guest, stages } = await join(host, 'Ana');
    const ended = new Promise<string>((resolve) =>
      guest.on('state', (e) => e.state === 'ended' && resolve(e.reason ?? '')),
    );
    host.stop();
    expect(await ended).toBe('host-ended');
    expect(stages.at(-1)?.state).toBe('ended');
    expect(host.ui().phase).toBe('idle');
    host.stop(); // idempotent
  });
});
