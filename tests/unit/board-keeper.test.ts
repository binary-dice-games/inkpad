// MIT License © 2026 Carlos Lopez
import { afterEach, describe, expect, it } from 'vitest';
import { WhiteboardModel, drawingGate } from '@inkpad/collab-whiteboard';
import { createBoardKeeper } from '@inkpad/collab-whiteboard/board-keeper';
import { settle, until } from '../support/wait';
import { TestRoom } from '../support/rooms';

const stroke = { kind: 'ink', points: [0, 0, 20, 20], color: '#e5484d', width: 3 };

describe('board keeper', () => {
  const room = new TestRoom();
  afterEach(() => {
    room.close();
    room.sessions.length = 0;
  });

  it('keeps what viewers draw and sends it to the next one who joins', async () => {
    const host = await room.start();
    const keeper = createBoardKeeper(host);
    const ana = await room.join('Ana');
    await until(() => ana.host(), 'guest reached host');
    ana.channel('wb').send({ t: 'op', op: new WhiteboardModel(ana.me.id).add(stroke) });
    await until(() => keeper.model.live().length === 1, 'keeper has the stroke');

    const late = await room.join('Late');
    const got: { t: string; snapshot?: { items: unknown[] } }[] = [];
    late.channel('wb').on('message', (m) => got.push(m as (typeof got)[number]));
    await until(() => got.some((m) => m.t === 'sync'), 'snapshot at join');
    expect(got.find((m) => m.t === 'sync')?.snapshot?.items).toHaveLength(1);
  });

  it('answers a peer that asks for the board', async () => {
    const host = await room.start();
    const keeper = createBoardKeeper(host);
    keeper.model.apply(new WhiteboardModel('seed-peer').add(stroke));
    const ana = await room.join('Ana');
    await until(() => ana.host(), 'guest reached host');
    const got: { t: string; snapshot?: { items: unknown[] } }[] = [];
    ana.channel('wb').on('message', (m) => got.push(m as (typeof got)[number]));
    const empty = new WhiteboardModel(ana.me.id).snapshot();
    ana.channel('wb').send({ t: 'sync', want: true, snapshot: empty }, { to: ana.host()!.id });
    await until(() => got.filter((m) => m.t === 'sync').length >= 1, 'snapshot reply');
    expect(got.find((m) => m.t === 'sync')?.snapshot?.items).toHaveLength(1);
  });

  it("does not see a locked viewer's changes when the host filters them", async () => {
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
