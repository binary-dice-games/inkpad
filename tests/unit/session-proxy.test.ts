// MIT License © 2026 Carlos Lopez
import { afterEach, describe, expect, it } from 'vitest';
import {
  connectSessionProxy,
  memoryPortPair,
  serveSessionProxy,
} from '@inkpad/collab-session/session-proxy';
import { createBoardKeeper } from '@inkpad/collab-whiteboard/board-keeper';
import { WhiteboardModel, drawingGate } from '@inkpad/collab-whiteboard';
import { settle, until } from '../support/wait';
import { TestRoom } from '../support/rooms';

const stroke = { kind: 'ink', points: [0, 0, 20, 20], color: '#e5484d', width: 3 };

describe('session proxy and board keeper', () => {
  const room = new TestRoom();
  afterEach(() => {
    room.close();
    room.sessions.length = 0;
  });

  it('gives the view the host identity, roster and messages', async () => {
    const host = await room.start();
    const ana = await room.join('Ana');
    await until(() => ana.host(), 'guest reached host');

    const [viewPort, servePort] = memoryPortPair();
    serveSessionProxy(host, servePort);
    const proxy = await connectSessionProxy(viewPort);
    expect(proxy.role).toBe('host');
    expect(proxy.me.id).toBe(host.me.id);
    await until(() => proxy.peers().length === 2, 'roster in the view');

    const fromGuest: unknown[] = [];
    proxy.channel('wb').on('message', (m, from) => fromGuest.push({ m, from }));
    const atGuest: unknown[] = [];
    ana.channel('wb').on('message', (m, from) => atGuest.push({ m, from }));

    ana.channel('wb').send({ t: 'cur', x: 1, y: 2 });
    proxy.channel('wb').send({ t: 'cur', x: 3, y: 4 });
    await until(() => fromGuest.length === 1 && atGuest.length === 1, 'both directions');
    expect(fromGuest[0]).toEqual({ m: { t: 'cur', x: 1, y: 2 }, from: ana.me.id });
    expect(atGuest[0]).toEqual({ m: { t: 'cur', x: 3, y: 4 }, from: host.me.id });
  });

  it('times out when nobody serves the port', async () => {
    const [viewPort] = memoryPortPair();
    await expect(connectSessionProxy(viewPort, { timeoutMs: 30 })).rejects.toThrow(/no session/);
  });

  it('keeps the drawings across a view that goes away and comes back', async () => {
    const host = await room.start();
    const keeper = createBoardKeeper(host);
    const ana = await room.join('Ana');
    await until(() => ana.host(), 'guest reached host');

    // First view draws something; the keeper sees it through the tap.
    const [v1, s1] = memoryPortPair();
    const stop1 = serveSessionProxy(host, s1, keeper.hooks);
    const proxy1 = await connectSessionProxy(v1);
    const model1 = new WhiteboardModel(proxy1.me.id);
    const wb1 = proxy1.channel('wb');
    const op = model1.add(stroke);
    wb1.send({ t: 'op', op });
    await until(() => keeper.model.live().length === 1, 'keeper has the stroke');

    // The page navigates: the view disconnects.
    stop1();

    // A guest draws while no view is attached.
    const guestModel = new WhiteboardModel(ana.me.id);
    ana.channel('wb').send({ t: 'op', op: guestModel.add({ ...stroke, color: '#30a46c' }) });
    await until(() => keeper.model.live().length === 2, 'keeper merged the viewer stroke');

    // The re-attached view is sent everything.
    const [v2, s2] = memoryPortPair();
    serveSessionProxy(host, s2, keeper.hooks);
    const proxy2 = await connectSessionProxy(v2);
    const received: unknown[] = [];
    proxy2.channel('wb').on('message', (m) => received.push(m));
    await until(() => received.length > 0, 'snapshot for the new view');
    const sync = received[0] as { t: string; snapshot: { items: unknown[] } };
    expect(sync.t).toBe('sync');
    expect(sync.snapshot.items).toHaveLength(2);
  });

  it('sends a snapshot to a viewer who joins while no view is attached', async () => {
    const host = await room.start();
    const keeper = createBoardKeeper(host);
    keeper.model.apply(new WhiteboardModel('seed-peer').add(stroke));

    const late = await room.join('Late');
    const got: { t: string; snapshot?: { items: unknown[] } }[] = [];
    late.channel('wb').on('message', (m) => got.push(m as (typeof got)[number]));
    await until(() => got.some((m) => m.t === 'sync'), 'snapshot at join');
    expect(got.find((m) => m.t === 'sync')?.snapshot?.items).toHaveLength(1);
  });

  it("drops locked viewers' changes at the host and keeps cursors", async () => {
    let drawing = false;
    const host = await room.start({ accept: drawingGate(() => drawing) });
    const keeper = createBoardKeeper(host);
    const ana = await room.join('Ana');
    await until(() => ana.host(), 'guest reached host');

    const anaModel = new WhiteboardModel(ana.me.id);
    ana.channel('wb').send({ t: 'op', op: anaModel.add(stroke) });
    const cursors: unknown[] = [];
    host.channel('wb').on('message', (m) => (m as { t: string }).t === 'cur' && cursors.push(m));
    ana.channel('wb').send({ t: 'cur', x: 1, y: 1 });
    await until(() => cursors.length === 1, 'cursor passes the lock');
    await settle();
    expect(keeper.model.live()).toHaveLength(0);

    drawing = true;
    ana.channel('wb').send({ t: 'op', op: anaModel.add(stroke) });
    await until(() => keeper.model.live().length === 1, 'change accepted once unlocked');
  });
});
