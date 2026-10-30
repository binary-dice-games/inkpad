// MIT License © 2026 Binary Dice Games
import { afterEach, describe, expect, it } from 'vitest';
import {
  FRAME_BYTES,
  FrameDecoder,
  SessionError,
  createSession,
  encodeFrames,
  fromBase64Url,
  isToken,
  newToken,
  roomKeys,
  sealMessage,
  toBase64Url,
  unsealMessage,
} from '@inksplat/collab-session';
import type { Session } from '@inksplat/collab-session';
import { settle, until } from '../support/wait';
import { TestRoom } from '../support/rooms';

describe('tokens and sealing', () => {
  it('makes 22-character tokens that isToken accepts', () => {
    const token = newToken();
    expect(token).toHaveLength(22);
    expect(isToken(token)).toBe(true);
    expect(isToken('short')).toBe(false);
  });

  it('seals and unseals with the room key only', async () => {
    const keys = await roomKeys(newToken());
    const other = await roomKeys(newToken());
    const sealed = await sealMessage(keys, { hello: 'world' });
    expect(await unsealMessage(keys, sealed)).toEqual({ hello: 'world' });
    expect(await unsealMessage(other, sealed)).toBeNull();
  });

  it('round-trips base64url', () => {
    const bytes = Uint8Array.from([0, 1, 250, 251, 252, 253, 254, 255]);
    expect(Array.from(fromBase64Url(toBase64Url(bytes)))).toEqual(Array.from(bytes));
  });
});

describe('framing', () => {
  async function roundTrip(value: unknown): Promise<{ frames: number; value: unknown }> {
    const frames = await encodeFrames(value);
    const decoder = new FrameDecoder();
    let out: unknown;
    for (const frame of frames) {
      expect(frame.length).toBeLessThanOrEqual(FRAME_BYTES);
      out = (await decoder.push(frame)) ?? out;
    }
    return { frames: frames.length, value: out };
  }

  it('sends a small message in one frame', async () => {
    const r = await roundTrip({ c: 'wb', m: { t: 'cur', x: 1, y: 2 } });
    expect(r.frames).toBe(1);
    expect(r.value).toEqual({ c: 'wb', m: { t: 'cur', x: 1, y: 2 } });
  });

  it('chunks a large incompressible message and reassembles it', async () => {
    const noise = Array.from({ length: 20000 }, (_, i) => (i * 2654435761) % 1000003);
    const r = await roundTrip({ c: 'wb', m: noise });
    expect(r.frames).toBeGreaterThan(1);
    expect(r.value).toEqual({ c: 'wb', m: noise });
  });

  it('rejects an empty frame', async () => {
    await expect(new FrameDecoder().push(new Uint8Array(0))).rejects.toBeInstanceOf(SessionError);
  });
});

describe('room over the memory network', () => {
  const room = new TestRoom();
  afterEach(() => {
    room.close();
    room.sessions.length = 0;
  });

  it('puts the guests in the host roster with their names', async () => {
    const host = await room.start();
    const ana = await room.join('Ana');
    await room.join('Ben');
    await until(() => host.peers().length === 3, 'three peers');
    expect(
      host
        .peers()
        .map((p) => p.name)
        .sort(),
    ).toEqual(['Ana', 'Ben', 'Host']);
    await until(() => ana.peers().length === 3, 'guest roster');
    expect(ana.host()?.name).toBe('Host');
    expect(host.inviteFragment()).toBe(`inksplat=${host.token}`);
  });

  it('relays a guest message to the other guests, stamped with the sender', async () => {
    const host = await room.start();
    const ana = await room.join('Ana');
    const ben = await room.join('Ben');
    await until(() => host.peers().length === 3, 'three peers');
    await until(() => ben.host(), 'ben reached the host');

    const got: { m: unknown; from: string }[] = [];
    ben.channel('wb').on('message', (m, from) => got.push({ m, from }));
    const atHost: string[] = [];
    host.channel('wb').on('message', (_m, from) => atHost.push(from));

    ana.channel('wb').send({ t: 'hi' });
    await until(() => got.length === 1 && atHost.length === 1, 'delivery');
    expect(got[0]).toEqual({ m: { t: 'hi' }, from: ana.me.id });
    expect(atHost[0]).toBe(ana.me.id);
  });

  it('delivers a targeted message to one peer only', async () => {
    const host = await room.start();
    const ana = await room.join('Ana');
    const ben = await room.join('Ben');
    await until(() => host.peers().length === 3 && ana.host() && ben.host(), 'room ready');
    const seen: string[] = [];
    ana.channel('x').on('message', () => seen.push('ana'));
    ben.channel('x').on('message', () => seen.push('ben'));
    host.channel('x').send('only ben', { to: ben.me.id });
    await until(() => seen.length > 0, 'delivery');
    await settle();
    expect(seen).toEqual(['ben']);
  });

  it('drops guest messages the accept filter refuses', async () => {
    const host = await room.start({ accept: (_c, m) => (m as { ok?: boolean }).ok === true });
    const ana = await room.join('Ana');
    await until(() => ana.host(), 'guest reached host');
    const got: unknown[] = [];
    host.channel('wb').on('message', (m) => got.push(m));
    ana.channel('wb').send({ ok: false });
    ana.channel('wb').send({ ok: true });
    await until(() => got.length > 0, 'delivery');
    await settle();
    expect(got).toEqual([{ ok: true }]);
  });

  it('refuses new joins while locked, and a removed peer', async () => {
    const host = await room.start();
    const ana = await room.join('Ana', { peerId: 'ana-fixed-id' });
    await until(() => ana.host(), 'guest reached host');
    host.lock(true);
    const late = await room.join('Late');
    const ended = new Promise<string>((resolve) =>
      late.on('state', (e) => e.state === 'ended' && resolve(e.reason ?? '')),
    );
    expect(await ended).toBe('locked');

    host.lock(false);
    host.remove('ana-fixed-id');
    const removed = new Promise<string>((resolve) =>
      ana.on('state', (e) => e.state === 'ended' && resolve(e.reason ?? '')),
    );
    expect(await removed).toBe('removed');
    await until(() => host.peers().length === 1, 'roster without the removed peer');
  });

  it('tells guests when the presenter ends the session', async () => {
    const host = await room.start();
    const ana = await room.join('Ana');
    await until(() => ana.host(), 'guest reached host');
    const ended = new Promise<string>((resolve) =>
      ana.on('state', (e) => e.state === 'ended' && resolve(e.reason ?? '')),
    );
    host.close();
    expect(await ended).toBe('host-ended');
  });

  it('refuses a guest speaking another protocol', async () => {
    await room.start();
    const old = await room.join('Old', { protocol: 'inksplat/0' });
    const ended = new Promise<string>((resolve) =>
      old.on('state', (e) => e.state === 'ended' && resolve(e.reason ?? '')),
    );
    expect(await ended).toBe('protocol');
  });

  it('only a host may lock, remove, or set media', async () => {
    await room.start();
    const ana: Session = await room.join('Ana');
    expect(() => ana.lock(true)).toThrow(SessionError);
    expect(() => ana.setMedia(null)).toThrow(SessionError);
    expect(() => ana.mediaParams({ fps: 3 })).toThrow(SessionError);
  });

  it('rejects a guest without a token', async () => {
    await expect(createSession({ role: 'guest' })).rejects.toMatchObject({ reason: 'bad-token' });
  });
});
