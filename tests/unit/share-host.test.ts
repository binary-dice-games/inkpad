// MIT License © 2026 Carlos Lopez
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryNetwork, createSession } from '@inkpad/collab-session';
import type { Session } from '@inkpad/collab-session';
import { WhiteboardModel } from '@inkpad/collab-whiteboard';
import { PROTOCOL, cleanCtl, cleanStage, parseInvite } from '@inkpad/defaults';
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

  async function start(settings: Partial<Settings> = {}, onEnd?: () => void): Promise<ShareHost> {
    const host = await ShareHost.start({
      settings: { ...DEFAULT_SETTINGS, name: 'Pat', ...settings },
      tabId: 42,
      onEnd,
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

  describe('presenter role', () => {
    async function console_(host: ShareHost, key = host.presenterKey) {
      const { guest, stages } = await join(host, 'Console');
      const roles: boolean[] = [];
      guest.channel('ctl').on('message', (m) => {
        const msg = cleanCtl(m);
        if (msg?.t === 'role') roles.push(msg.presenter);
      });
      const hostId = guest.host()!.id;
      const ctl = guest.channel('ctl');
      return {
        guest,
        stages,
        roles,
        auth: () => ctl.send({ t: 'auth', key }, { to: hostId }),
        command: (command: unknown) => ctl.send({ t: 'cmd', command }, { to: hostId }),
      };
    }

    it('puts the key in the console link only', async () => {
      const host = await start({ viewerBase: 'https://example.github.io/inkpad/' });
      expect(host.link()).not.toContain('presenter=');
      const link = host.consoleLink();
      expect(parseInvite(new URL(link).hash)).toMatchObject({
        token: host.session.token,
        presenterKey: host.presenterKey,
      });
      expect(host.ui().consoleLink).toBe(link);
    });

    it('accepts the key and answers with the role', async () => {
      const host = await start();
      const c = await console_(host);
      c.auth();
      await until(() => c.roles.length > 0, 'role reply');
      expect(c.roles).toEqual([true]);
    });

    it("refuses a wrong key and ignores that peer's commands", async () => {
      const host = await start();
      const c = await console_(host, 'A'.repeat(22));
      c.auth();
      await until(() => c.roles.length > 0, 'role reply');
      expect(c.roles).toEqual([false]);
      c.command({ cmd: 'lock', on: true });
      c.command({ cmd: 'end' });
      await settle(80);
      expect(host.ui().locked).toBe(false);
    });

    it('ignores commands from a peer that never authenticated', async () => {
      const ended = vi.fn();
      const host = await start({}, ended);
      const c = await console_(host);
      c.command({ cmd: 'lock', on: true });
      c.command({ cmd: 'end' });
      await settle(80);
      expect(host.ui().locked).toBe(false);
      expect(ended).not.toHaveBeenCalled();
    });

    it('runs lock, drawing, pause, remove, clear and end for the presenter', async () => {
      const ended = vi.fn();
      const host = await start({}, ended);
      const viewer = await join(host, 'Ana');
      const c = await console_(host);
      c.auth();
      await until(() => c.roles.length > 0, 'role reply');

      c.command({ cmd: 'lock', on: true });
      await until(() => host.ui().locked, 'locked');
      c.command({ cmd: 'drawing', on: false });
      await until(() => !host.ui().drawing, 'drawing off');
      await until(() => viewer.stages.at(-1)?.drawing === false, 'viewers told');
      c.command({ cmd: 'pause', on: true });
      await until(() => host.ui().paused, 'paused');
      c.command({ cmd: 'pause', on: false });
      await until(() => !host.ui().paused, 'resumed');

      // The board: a stroke (drawing back on), then the presenter clears it for everyone.
      c.command({ cmd: 'drawing', on: true });
      await until(() => host.ui().drawing, 'drawing on');
      const model = new WhiteboardModel(viewer.guest.me.id);
      viewer.guest.channel('wb').send({ t: 'op', op: model.add(stroke) });
      await until(() => host.keeper.model.live().length === 1, 'stroke');
      const cleared: unknown[] = [];
      viewer.guest.channel('wb').on('message', (m) => {
        const msg = m as { t: string; op?: { t: string } };
        if (msg.t === 'op' && msg.op?.t === 'clear') cleared.push(m);
      });
      c.command({ cmd: 'clear' });
      await until(() => host.keeper.model.live().length === 0, 'cleared');
      await until(() => cleared.length === 1, 'clear reached the viewer');

      c.command({ cmd: 'remove', id: viewer.guest.me.id });
      await until(() => host.ui().viewers.every((v) => v.name !== 'Ana'), 'viewer removed');

      c.command({ cmd: 'end' });
      await until(() => ended.mock.calls.length === 1, 'end requested');
    });

    it('lets the presenter draw while viewers are locked out', async () => {
      const host = await start({ viewersMayDraw: false });
      const c = await console_(host);
      c.auth();
      await until(() => c.roles.length > 0, 'role reply');
      const model = new WhiteboardModel(c.guest.me.id);
      c.guest.channel('wb').send({ t: 'op', op: model.add(stroke) });
      await until(() => host.keeper.model.live().length === 1, 'presenter stroke accepted');
    });

    it('does not let the presenter remove themself', async () => {
      const host = await start();
      const c = await console_(host);
      c.auth();
      await until(() => c.roles.length > 0, 'role reply');
      c.command({ cmd: 'remove', id: c.guest.me.id });
      await settle(80);
      // The console is not listed as a viewer, and is still connected.
      expect(host.ui().viewers).toEqual([]);
      expect(host.session.peers().map((p) => p.name)).toContain('Console');
    });

    it('never relays ctl messages to other viewers', async () => {
      const host = await start();
      const other = await join(host, 'Ben');
      const seen: unknown[] = [];
      other.guest.channel('ctl').on('message', (m) => seen.push(m));
      const c = await console_(host);
      c.auth();
      await until(() => c.roles.length > 0, 'role reply');
      c.guest.channel('ctl').send({ t: 'auth', key: host.presenterKey });
      c.command({ cmd: 'lock', on: true });
      await settle(100);
      expect(seen).toEqual([]);
    });

    it('rejects malformed ctl messages', async () => {
      const host = await start();
      const c = await console_(host);
      c.auth();
      await until(() => c.roles.length > 0, 'role reply');
      c.command({ cmd: 'remove', id: '../x' });
      c.command({ cmd: 'lock', on: 'yes' });
      c.command({ cmd: 'format-disk' });
      c.guest.channel('ctl').send('hello', { to: c.guest.host()!.id });
      await settle(80);
      expect(host.ui().locked).toBe(false);
    });
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
