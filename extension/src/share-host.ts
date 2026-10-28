// MIT License © 2026 Carlos Lopez
/**
 * @file The presenter's side of a share, free of chrome.* APIs so it runs in
 * the offscreen document and in tests: the host session, the board keeper,
 * the lock on viewers' drawing, the `stage` messages and the commands the
 * presenter can give.
 */
import { createSession } from '@inkpad/collab-session';
import type { Peer, RendezvousSpec, Session } from '@inkpad/collab-session';
import { serveSessionProxy } from '@inkpad/collab-session/session-proxy';
import type { ProxyPort } from '@inkpad/collab-session/session-proxy';
import { drawingGate } from '@inkpad/collab-whiteboard';
import { createBoardKeeper } from '@inkpad/collab-whiteboard/board-keeper';
import type { BoardKeeper } from '@inkpad/collab-whiteboard/board-keeper';
import { PROTOCOL, STAGE_CHANNEL, inviteLink } from '@inkpad/defaults';
import type { Stage } from '@inkpad/defaults';
import { IDLE_UI } from './messages';
import type { Command, UiState } from './messages';
import type { Settings } from './settings';

export interface ShareHostOptions {
  settings: Settings;
  tabId: number;
  /** Replaces the trackers in `settings` (tests use the memory network). */
  rendezvous?: RendezvousSpec[];
}

const DEFAULT_ASPECT_W = 1280;
const DEFAULT_ASPECT_H = 720;

/**
 * One share: created by `ShareHost.start`, ended by `stop`. Listeners of
 * `onChange` get a fresh `UiState` after every change.
 */
export class ShareHost {
  readonly session: Session;
  readonly keeper: BoardKeeper;
  readonly tabId: number;
  private readonly settings: Settings;
  private drawing: boolean;
  private paused = false;
  private overlay = false;
  private problem: string | null = null;
  private viewport = { w: DEFAULT_ASPECT_W, h: DEFAULT_ASPECT_H };
  private readonly listeners = new Set<(ui: UiState) => void>();
  private stopped = false;

  private constructor(session: Session, settings: Settings, tabId: number) {
    this.session = session;
    this.settings = settings;
    this.tabId = tabId;
    this.drawing = settings.viewersMayDraw;
    this.keeper = createBoardKeeper(session);
    session.channel(STAGE_CHANNEL).on('join', (peer) => this.sendStage(peer.id));
    session.on('peers', () => this.changed());
    session.on('state', () => this.changed());
    session.on('status', (e) => {
      if (e.stage === 'no-tracker') {
        this.problem = 'no-tracker';
        this.changed();
      } else if (e.stage === 'tracker' && this.problem === 'no-tracker') {
        this.problem = null;
        this.changed();
      }
    });
  }

  /**
   * Starts the host session for the tab.
   * @throws {SessionError} when WebRTC is missing
   */
  static async start(options: ShareHostOptions): Promise<ShareHost> {
    const { settings } = options;
    let host: ShareHost | null = null;
    const session = await createSession({
      role: 'host',
      protocol: PROTOCOL,
      me: { name: settings.name, color: settings.color },
      iceServers: settings.iceServers,
      rendezvous: options.rendezvous ?? [
        { kind: 'torrent', urls: settings.trackers },
        { kind: 'manual' },
      ],
      accept: (channel, message, from) => host?.accept(channel, message, from) ?? false,
    });
    host = new ShareHost(session, settings, options.tabId);
    return host;
  }

  private gate = drawingGate(() => this.drawing);

  /**
   * Which of a viewer's messages are delivered: only the whiteboard's, and
   * those while viewers may draw (the gate). `stage` and everything else is
   * the presenter's alone, so a viewer cannot speak for the presenter.
   */
  private accept(channel: string, message: unknown, from: string): boolean {
    return channel === 'wb' && this.gate(channel, message, from);
  }

  /** The stage as viewers see it. */
  stage(): Stage {
    const { w, h } = this.viewport;
    return {
      aspect: w / h,
      w,
      h,
      fps: this.settings.video.fps,
      state: this.stopped ? 'ended' : this.paused ? 'paused' : 'live',
      drawing: this.drawing,
    };
  }

  private sendStage(to?: string): void {
    try {
      this.session.channel(STAGE_CHANNEL).send(this.stage(), to ? { to } : {});
    } catch {
      // an ended session
    }
  }

  /** The link to give viewers. */
  link(): string {
    return inviteLink(this.settings.viewerBase, this.session.inviteFragment());
  }

  /** The state the popup and overlay show. */
  ui(): UiState {
    if (this.stopped) {
      return { ...IDLE_UI };
    }
    return {
      phase: this.paused ? 'paused' : 'live',
      tabId: this.tabId,
      link: this.link(),
      viewers: this.session
        .peers()
        .filter((p: Peer) => p.role === 'guest')
        .map((p) => ({ id: p.id, name: p.name, color: p.color, path: p.path })),
      locked: this.session.locked,
      drawing: this.drawing,
      paused: this.paused,
      overlay: this.overlay,
      problem: this.problem,
    };
  }

  /** Listens to changes; returns the function that stops listening. */
  onChange(cb: (ui: UiState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private changed(): void {
    const ui = this.ui();
    for (const cb of [...this.listeners]) {
      cb(ui);
    }
  }

  /** Tells the host whether the overlay is attached to the tab. */
  setOverlay(attached: boolean): void {
    this.overlay = attached;
    this.changed();
  }

  /**
   * Runs a presenter command.
   * @throws {Error} on a malformed command
   */
  async command(command: Command): Promise<void> {
    if (this.stopped) {
      return;
    }
    switch (command.cmd) {
      case 'lock':
        this.session.lock(command.on);
        break;
      case 'drawing':
        this.drawing = command.on;
        this.sendStage();
        break;
      case 'pause':
        this.paused = command.on;
        this.sendStage();
        break;
      case 'newLink':
        await this.session.newInvite();
        break;
      case 'remove':
        this.session.remove(command.id);
        break;
      case 'viewport':
        if (
          Number.isFinite(command.w) &&
          Number.isFinite(command.h) &&
          command.w >= 1 &&
          command.h >= 1 &&
          command.w <= 16384 &&
          command.h <= 16384
        ) {
          this.viewport = { w: Math.round(command.w), h: Math.round(command.h) };
          this.sendStage();
        }
        break;
      default:
        throw new Error('unknown command');
    }
    this.changed();
  }

  /**
   * Serves the overlay (or another view) on `port`, with the kept drawings.
   * @returns the function that stops serving
   */
  serve(port: ProxyPort): () => void {
    return serveSessionProxy(this.session, port, this.keeper.hooks);
  }

  /** Ends the share: viewers are told, links close. Idempotent. */
  stop(): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.sendStage(); // state `ended`, ahead of the session's own `end`
    this.changed();
    this.session.close();
    this.listeners.clear();
  }
}
