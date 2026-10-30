// MIT License © 2026 Carlos Lopez
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryNetwork, createSession } from '@inkpad/collab-session';
import type { Session } from '@inkpad/collab-session';
import { WhiteboardModel } from '@inkpad/collab-whiteboard';
import { PROTOCOL, cleanStage } from '@inkpad/defaults';
import type { Stage } from '@inkpad/defaults';
import { ShareHost } from '../../viewer/src/share-host';
import { DEFAULT_SETTINGS } from '../../viewer/src/settings';
import type { Settings } from '../../viewer/src/settings';
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

  async function start(
    settings: Partial<Settings> = {},
    clearBoard?: () => void,
    video?: boolean,
  ): Promise<ShareHost> {
    const host = await ShareHost.start({
      settings: { ...DEFAULT_SETTINGS, name: 'Pat', ...settings },
      clearBoard,
      video,
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

  /** What the host's own app receives on the whiteboard channel (what the gate let through). */
  function wbInbox(host: ShareHost): unknown[] {
    const inbox: unknown[] = [];
    host.session.channel('wb').on('message', (m) => inbox.push(m));
    return inbox;
  }

  it('builds the link from the viewer base and the session token', async () => {
    const host = await start({ viewerBase: 'https://example.github.io/inkpad/' });
    expect(host.link()).toBe(`https://example.github.io/inkpad/#inkpad=${host.session.token}`);
    expect(host.ui()).toMatchObject({ phase: 'live', viewers: [], drawing: true });
  });

  it('carries custom trackers in the link, and no presenter key', async () => {
    const host = await start({ trackers: ['ws://127.0.0.1:9'] });
    expect(host.link()).toContain('tr=ws');
    expect(host.link()).not.toContain('presenter');
  });

  it('tells a viewer the stage when it joins', async () => {
    const host = await start({ viewersMayDraw: false });
    const inbox = wbInbox(host);
    const { guest, stages } = await join(host, 'Ana');
    await until(() => stages.length > 0, 'stage');
    expect(stages[0]?.drawing).toBe(false);

    const model = new WhiteboardModel(guest.me.id);
    guest.channel('wb').send({ t: 'op', op: model.add(stroke) });
    await settle();
    expect(inbox).toEqual([]);

    await host.command({ cmd: 'drawing', on: true });
    await until(() => stages.at(-1)?.drawing === true, 'drawing on');
    guest.channel('wb').send({ t: 'op', op: model.add(stroke) });
    await until(() => inbox.length === 1, 'stroke accepted');
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

  it('ignores the old presenter channel: nobody can command the host', async () => {
    const host = await start();
    const { guest } = await join(host, 'Ana');
    const to = guest.host()!.id;
    guest.channel('ctl').send({ t: 'cmd', command: { cmd: 'lock', on: true } }, { to });
    guest.channel('ctl').send({ t: 'cmd', command: { cmd: 'end' } }, { to });
    guest.channel('ctl').send('hello', { to });
    await settle(80);
    expect(host.ui().locked).toBe(false);
    expect(host.ui().phase).toBe('live');
    expect(host.ui().viewers).toHaveLength(1);
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

  it('starts a session without video that tells viewers, and lets the presenter pick each canvas background', async () => {
    const host = await start({}, undefined, false);
    const fallback = ['whiteboard', 'blackboard', 'wall', 'cork', 'whiteboard'];
    expect(host.ui()).toMatchObject({ video: false, backgrounds: fallback, phase: 'live' });
    const { stages } = await join(host, 'Ana');
    await until(() => stages.length > 0, 'stage');
    expect(stages[0]).toMatchObject({ video: false, backgrounds: fallback });

    await host.command({ cmd: 'background', page: 2, name: 'cork' });
    await until(() => stages.at(-1)?.backgrounds?.[2] === 'cork', 'background changed');
    expect(host.ui().backgrounds).toEqual([
      'whiteboard',
      'blackboard',
      'cork',
      'cork',
      'whiteboard',
    ]);
    await expect(host.command({ cmd: 'background', page: 0, name: 'lava' })).rejects.toThrow(
      /background/,
    );
    // No video to show in a session without it, and no sixth canvas.
    await expect(host.command({ cmd: 'background', page: 0, name: 'video' })).rejects.toThrow(
      /background/,
    );
    await expect(host.command({ cmd: 'background', page: 5, name: 'wall' })).rejects.toThrow(
      /canvas/,
    );
    expect(host.ui().backgrounds[0]).toBe('whiteboard');
  });

  it('shows the video on canvas 1 and the backgrounds on the others when there is video', async () => {
    const host = await start();
    const { stages } = await join(host, 'Ana');
    await until(() => stages.length > 0, 'stage');
    expect(stages[0]).not.toHaveProperty('video');
    expect(stages[0]?.backgrounds).toEqual(['video', 'whiteboard', 'blackboard', 'wall', 'cork']);
    expect(host.ui().video).toBe(true);

    await host.command({ cmd: 'background', page: 0, name: 'wall' });
    await host.command({ cmd: 'background', page: 3, name: 'video' });
    await until(() => stages.at(-1)?.backgrounds?.[3] === 'video', 'backgrounds changed');
    expect(host.ui().backgrounds).toEqual(['wall', 'whiteboard', 'blackboard', 'video', 'cork']);
  });

  it('issues a new link without dropping the people already there', async () => {
    const host = await start();
    await join(host, 'Ana');
    const before = host.link();
    await host.command({ cmd: 'newLink' });
    expect(host.link()).not.toBe(before);
    expect(host.ui().viewers).toHaveLength(1);
  });

  it('follows the captured size: viewport changes update the stage', async () => {
    const host = await start();
    const { stages } = await join(host, 'Ana');
    await until(() => stages.length > 0, 'stage');
    await host.command({ cmd: 'viewport', w: 700, h: 900 });
    await until(() => stages.at(-1)?.w === 700, 'new viewport');
    expect(stages.at(-1)?.aspect).toBeCloseTo(700 / 900);
    await host.command({ cmd: 'viewport', w: -1, h: 5 });
    await host.command({ cmd: 'viewport', w: Number.NaN, h: 5 });
    expect(host.stage()).toMatchObject({ w: 700, h: 900 });
  });

  it('pauses and resumes: viewers are told', async () => {
    const host = await start();
    const { stages } = await join(host, 'Ana');
    await until(() => stages.length > 0, 'stage');
    await host.command({ cmd: 'pause', on: true });
    await until(() => stages.at(-1)?.state === 'paused', 'paused');
    expect(host.ui()).toMatchObject({ phase: 'paused', paused: true });
    await host.command({ cmd: 'pause', on: false });
    await until(() => stages.at(-1)?.state === 'live', 'live again');
    expect(host.ui().phase).toBe('live');
  });

  it('clears the board through the owner', async () => {
    let cleared = 0;
    const host = await start({}, () => (cleared += 1));
    await host.command({ cmd: 'clear' });
    expect(cleared).toBe(1);
  });

  it('clears only the drawings through the owner', async () => {
    const calls: string[] = [];
    const host = await ShareHost.start({
      settings: { ...DEFAULT_SETTINGS, name: 'Pat' },
      clearBoard: () => calls.push('all'),
      clearDrawings: () => calls.push('drawings'),
      rendezvous: [{ kind: 'memory', network }],
    });
    opened.push(host);
    await host.command({ cmd: 'clearDrawings' });
    expect(calls).toEqual(['drawings']);
    await host.command({ cmd: 'clear' });
    expect(calls).toEqual(['drawings', 'all']);
  });

  it('reports changes to listeners until stopped', async () => {
    const host = await start();
    const seen: number[] = [];
    host.onChange((ui) => seen.push(ui.viewers.length));
    await join(host, 'Ana');
    await until(() => seen.includes(1), 'one viewer');
    host.setProblem('capture-ended');
    expect(host.ui().problem).toBe('capture-ended');
  });

  it('rejects an unknown command', async () => {
    const host = await start();
    await expect(host.command({ cmd: 'format-disk' } as never)).rejects.toThrow(/unknown/);
  });

  it('ends the share: viewers see `ended`, then the room closes', async () => {
    const host = await start();
    const { stages } = await join(host, 'Ana');
    await until(() => stages.length > 0, 'stage');
    host.stop();
    await until(() => stages.at(-1)?.state === 'ended', 'ended');
    expect(host.ui().phase).toBe('idle');
    host.stop(); // idempotent
  });
});
