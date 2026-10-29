// MIT License © 2026 Carlos Lopez
/**
 * @file The presenter's side of a share, free of chrome.* APIs so it runs in
 * the offscreen document and in tests: the host session, the board keeper,
 * the presenter key and the commands of the console, the lock on viewers'
 * drawing and the `stage` messages.
 */
import { createSession } from '@inkpad/collab-session';
import type { Peer, RendezvousSpec, Session } from '@inkpad/collab-session';
import { drawingGate } from '@inkpad/collab-whiteboard';
import { createBoardKeeper } from '@inkpad/collab-whiteboard/board-keeper';
import type { BoardKeeper } from '@inkpad/collab-whiteboard/board-keeper';
import {
  CTL_CHANNEL,
  PROTOCOL,
  STAGE_CHANNEL,
  cleanCtl,
  inviteLink,
  newPresenterKey,
  safeEqual,
  toMediaParams,
} from '@inkpad/defaults';
import type { PresenterCommand, Stage } from '@inkpad/defaults';
import { IDLE_UI } from './messages';
import type { Command, UiState } from './messages';
import type { Settings } from './settings';

export interface ShareHostOptions {
  settings: Settings;
  /** The shared tab; absent when the source is not a tab (the presenter page). */
  tabId?: number;
  /** Replaces the trackers in `settings` (tests use the memory network). */
  rendezvous?: RendezvousSpec[];
  /** Called when the console asks to end the session; the owner then calls `stop()`. */
  onEnd?: () => void;
  /** Where the console page lives (the extension's `viewer.html`); defaults to the viewer base. */
  consoleBase?: string;
  /**
   * Whether to keep the board here (default true). A page that mounts its own whiteboard on
   * `session` passes false: two boards on one host session would answer every sync twice.
   */
  keeper?: boolean;
  /** Clears the board when `keeper` is false; the owner's whiteboard does it. */
  clearBoard?: () => void;
}

const DEFAULT_ASPECT_W = 1280;
const DEFAULT_ASPECT_H = 720;

/**
 * One share: created by `ShareHost.start`, ended by `stop`. Listeners of
 * `onChange` get a fresh `UiState` after every change.
 */
export class ShareHost {
  readonly session: Session;
  /** The board kept for late joiners; null when the owner mounts its own whiteboard. */
  readonly keeper: BoardKeeper | null;
  readonly tabId: number | null;
  /** The secret of the console link (section 4.5 of spec/01_core_features/DESIGN.md). */
  readonly presenterKey = newPresenterKey();
  private readonly settings: Settings;
  private readonly onEnd: () => void;
  private readonly consoleBase: string;
  private readonly clearOwnBoard: (() => void) | undefined;
  private drawing: boolean;
  private paused = false;
  private problem: string | null = null;
  private viewport = { w: DEFAULT_ASPECT_W, h: DEFAULT_ASPECT_H };
  private source: MediaStream | null = null;
  /** Peer ids that proved they hold the presenter key. */
  private readonly presenters = new Set<string>();
  private readonly listeners = new Set<(ui: UiState) => void>();
  private readonly gate = drawingGate(() => this.drawing);
  private stopped = false;

  private constructor(session: Session, options: ShareHostOptions) {
    this.session = session;
    this.settings = options.settings;
    this.tabId = options.tabId ?? null;
    this.clearOwnBoard = options.clearBoard;
    this.onEnd = options.onEnd ?? (() => {});
    this.consoleBase = options.consoleBase ?? options.settings.viewerBase;
    this.drawing = options.settings.viewersMayDraw;
    this.keeper = options.keeper === false ? null : createBoardKeeper(session);
    session.mediaParams(toMediaParams(options.settings.video));
    session.channel(STAGE_CHANNEL).on('join', (peer) => this.sendStage(peer.id));
    session.on('peers', (peers) => {
      const here = new Set(peers.map((p) => p.id));
      for (const id of this.presenters) {
        if (!here.has(id)) {
          this.presenters.delete(id);
        }
      }
      this.changed();
    });
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
      log: (...args: unknown[]) => console.log('[inkpad]', ...args),
      me: { name: settings.name, color: settings.color },
      iceServers: settings.iceServers,
      rendezvous: options.rendezvous ?? [
        { kind: 'torrent', urls: settings.trackers },
        { kind: 'manual' },
      ],
      accept: (channel, message, from) => host?.accept(channel, message, from) ?? false,
    });
    host = new ShareHost(session, options);
    return host;
  }

  /**
   * Which of a guest's messages are delivered or relayed. `ctl` is handled
   * here and never delivered. Only the whiteboard channel passes, and for a
   * viewer only while viewers may draw (the gate); a presenter always may.
   * `stage` and everything else is the host's alone, so nobody can speak for
   * the presenter.
   */
  private accept(channel: string, message: unknown, from: string): boolean {
    if (channel === CTL_CHANNEL) {
      this.control(message, from);
      return false;
    }
    if (channel !== 'wb') {
      return false;
    }
    return this.presenters.has(from) || this.gate(channel, message, from);
  }

  /** A `ctl` message from `from`: the key, or a command of an authenticated presenter. */
  private control(raw: unknown, from: string): void {
    const message = cleanCtl(raw);
    if (!message || this.stopped) {
      return;
    }
    if (message.t === 'auth') {
      const ok = safeEqual(message.key, this.presenterKey);
      if (ok) {
        this.presenters.add(from);
      }
      this.reply({ t: 'role', presenter: ok }, from);
      this.changed();
    } else if (message.t === 'cmd' && this.presenters.has(from)) {
      this.run(message.command, from);
    }
  }

  private reply(message: unknown, to: string): void {
    try {
      this.session.channel(CTL_CHANNEL).send(message, { to });
    } catch {
      // the peer left or the session ended
    }
  }

  /** Runs a command of the console. */
  private run(command: PresenterCommand, from: string): void {
    switch (command.cmd) {
      case 'lock':
        this.session.lock(command.on);
        break;
      case 'drawing':
        this.drawing = command.on;
        this.sendStage();
        break;
      case 'pause':
        this.setPaused(command.on);
        break;
      case 'remove':
        if (command.id !== from) {
          this.session.remove(command.id);
        }
        break;
      case 'clear':
        this.clearBoard();
        break;
      case 'end':
        this.onEnd();
        break;
    }
    this.changed();
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

  private trackerList(): { trackers: readonly string[] } {
    return { trackers: this.settings.trackers };
  }

  /** The link to give viewers. */
  link(): string {
    return inviteLink(this.settings.viewerBase, this.session.inviteFragment(), this.trackerList());
  }

  /**
   * The console link, on the console base (the extension's own `viewer.html`).
   * It carries the presenter key: keep it private.
   */
  consoleLink(): string {
    return inviteLink(this.consoleBase, this.session.inviteFragment(), {
      ...this.trackerList(),
      presenterKey: this.presenterKey,
    });
  }

  /** The state the popup shows. */
  ui(): UiState {
    if (this.stopped) {
      return { ...IDLE_UI };
    }
    return {
      phase: this.paused ? 'paused' : 'live',
      tabId: this.tabId,
      link: this.link(),
      consoleLink: this.consoleLink(),
      viewers: this.session
        .peers()
        .filter((p: Peer) => p.role === 'guest' && !this.presenters.has(p.id))
        .map((p) => ({ id: p.id, name: p.name, color: p.color, path: p.path })),
      locked: this.session.locked,
      drawing: this.drawing,
      paused: this.paused,
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

  /** Shows (or clears, with null) a problem in the popup, such as a lost capture. */
  setProblem(problem: string | null): void {
    this.problem = problem;
    this.changed();
  }

  /** The captured tab, sent to viewers while the share is not paused; null sends nothing. */
  setSource(stream: MediaStream | null): void {
    this.source = stream;
    this.applyMedia();
  }

  private applyMedia(): void {
    this.session.setMedia(this.paused ? null : this.source);
  }

  private setPaused(on: boolean): void {
    this.paused = on;
    this.applyMedia();
    this.sendStage();
  }

  /** Clears the whiteboard for everyone (the host's own clear stamp). */
  private clearBoard(): void {
    if (!this.keeper) {
      this.clearOwnBoard?.();
      return;
    }
    const op = this.keeper.model.clear();
    try {
      this.session.channel('wb').send({ t: 'op', op });
    } catch {
      // an ended session
    }
  }

  /**
   * Runs a command of the popup.
   * @throws {Error} on a malformed command
   */
  async command(command: Command): Promise<void> {
    if (this.stopped) {
      return;
    }
    switch (command.cmd) {
      case 'newLink':
        await this.session.newInvite();
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
      case 'lock':
      case 'drawing':
      case 'pause':
      case 'remove':
      case 'clear':
        this.run(command, '');
        return;
      default:
        throw new Error('unknown command');
    }
    this.changed();
  }

  /**
   * Joins a viewer who cannot reach a tracker: takes the code the viewer made
   * and returns the answer code to send back.
   * @throws {SessionError} for a damaged code or one of another session
   */
  async acceptCode(code: string): Promise<string> {
    if (this.stopped || !this.session.manual) {
      throw new Error('this session cannot take codes');
    }
    return this.session.manual.acceptOffer(code.trim());
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
