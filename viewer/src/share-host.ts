// MIT License © 2026 Carlos Lopez
/**
 * @file The presenter's side of a share, free of DOM code so it is unit
 * tested: the host session, the lock on viewers' drawing, pause, removal and
 * the `stage` messages. The presenter page mounts its own whiteboard on the
 * host session, so there is no separate console and no presenter key.
 */
import { createSession } from '@inkpad/collab-session';
import type { Peer, RendezvousSpec, Session } from '@inkpad/collab-session';
import { drawingGate } from '@inkpad/collab-whiteboard';
import {
  CANVASES,
  PROTOCOL,
  STAGE_CHANNEL,
  cleanCanvasBackground,
  defaultBackgrounds,
  inviteLink,
  toMediaParams,
} from '@inkpad/defaults';
import type { CanvasBackground, Stage } from '@inkpad/defaults';
import type { Settings } from './settings';

/** What the presenter page shows about the share. */
export interface UiState {
  phase: 'idle' | 'live' | 'paused';
  /** The link to give viewers, or null while idle. */
  link: string | null;
  viewers: { id: string; name: string; color: string; path: string | null }[];
  /** Whether new viewers are refused. */
  locked: boolean;
  /** Whether viewers may draw. */
  drawing: boolean;
  paused: boolean;
  /** Whether the session has video (false: only the board). */
  video: boolean;
  /** What each canvas shows behind the board (index 0 is canvas 1). */
  backgrounds: CanvasBackground[];
  /** A problem to show (for example `no-tracker`), or null. */
  problem: string | null;
}

export const IDLE_UI: Readonly<UiState> = {
  phase: 'idle',
  link: null,
  viewers: [],
  locked: false,
  drawing: true,
  paused: false,
  video: true,
  backgrounds: defaultBackgrounds(true),
  problem: null,
};

/** Commands the presenter page gives. */
export type Command =
  | { cmd: 'lock'; on: boolean }
  | { cmd: 'drawing'; on: boolean }
  | { cmd: 'pause'; on: boolean }
  | { cmd: 'newLink' }
  | { cmd: 'remove'; id: string }
  | { cmd: 'clear' }
  | { cmd: 'clearDrawings' }
  /** Sets what canvas `page` (0 for the first) shows: `video` (with video only) or a background. */
  | { cmd: 'background'; page: number; name: string }
  | { cmd: 'viewport'; w: number; h: number };

export interface ShareHostOptions {
  settings: Settings;
  /** Replaces the trackers in `settings` (tests use the memory network). */
  rendezvous?: RendezvousSpec[];
  /** Clears the whiteboard for everyone; the owner's whiteboard does it. */
  clearBoard?: () => void;
  clearDrawings?: () => void;
  /** `false`: a session without video, only the board; default true. */
  video?: boolean;
}

const DEFAULT_ASPECT_W = 1280;
const DEFAULT_ASPECT_H = 720;

/**
 * One share: created by `ShareHost.start`, ended by `stop`. Listeners of
 * `onChange` get a fresh `UiState` after every change.
 */
export class ShareHost {
  readonly session: Session;
  private readonly settings: Settings;
  private readonly clearBoard: () => void;
  private readonly clearDrawings: () => void;
  private drawing: boolean;
  private paused = false;
  private readonly hasVideo: boolean;
  private readonly backgrounds: CanvasBackground[];
  private problem: string | null = null;
  private viewport = { w: DEFAULT_ASPECT_W, h: DEFAULT_ASPECT_H };
  private source: MediaStream | null = null;
  private readonly listeners = new Set<(ui: UiState) => void>();
  private readonly gate = drawingGate(() => this.drawing);
  private stopped = false;

  private constructor(session: Session, options: ShareHostOptions) {
    this.session = session;
    this.settings = options.settings;
    this.clearBoard = options.clearBoard ?? (() => {});
    this.clearDrawings = options.clearDrawings ?? (() => {});
    this.drawing = options.settings.viewersMayDraw;
    this.hasVideo = options.video !== false;
    this.backgrounds = defaultBackgrounds(this.hasVideo);
    session.mediaParams(toMediaParams(options.settings.video));
    session.channel(STAGE_CHANNEL).on('join', (peer) => this.sendStage(peer.id));
    session.on('peers', () => this.changed());
    session.on('state', () => this.changed());
    session.on('status', (e) => {
      if (e.stage === 'expired') {
        this.problem = 'tracker-expired';
        this.changed();
      } else if (e.stage === 'no-tracker') {
        this.problem = 'no-tracker';
        this.changed();
      } else if (e.stage === 'tracker' && this.problem === 'no-tracker') {
        this.problem = null;
        this.changed();
      }
    });
  }

  /**
   * Starts the host session.
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
        { kind: 'torrent', urls: settings.trackers, ttlMs: settings.trackerTtlMinutes * 60_000 },
        { kind: 'manual' },
      ],
      accept: (channel, message, from) => host?.accept(channel, message, from) ?? false,
    });
    host = new ShareHost(session, options);
    return host;
  }

  /**
   * Which of a guest's messages are delivered or relayed: only the whiteboard
   * channel, and only while viewers may draw (the gate). `stage` and everything
   * else is the host's alone, so nobody can speak for the presenter.
   */
  private accept(channel: string, message: unknown, from: string): boolean {
    return channel === 'wb' && this.gate(channel, message, from);
  }

  /** Runs a command; `from` is the viewer a removal must not hit (none here). */
  private run(command: Command): void {
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
        this.session.remove(command.id);
        break;
      case 'background': {
        const name = cleanCanvasBackground(command.name, this.hasVideo);
        if (!name) {
          throw new Error('unknown background');
        }
        if (!Number.isInteger(command.page) || command.page < 0 || command.page >= CANVASES) {
          throw new Error('unknown canvas');
        }
        this.backgrounds[command.page] = name;
        this.sendStage();
        break;
      }
      case 'clear':
        this.clearBoard();
        break;
      case 'clearDrawings':
        this.clearDrawings();
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
      ...(this.hasVideo ? {} : { video: false as const }),
      backgrounds: [...this.backgrounds],
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

  /** The state the page shows. */
  ui(): UiState {
    if (this.stopped) {
      return { ...IDLE_UI };
    }
    return {
      phase: this.paused ? 'paused' : 'live',
      link: this.link(),
      viewers: this.session
        .peers()
        .filter((p: Peer) => p.role === 'guest')
        .map((p) => ({ id: p.id, name: p.name, color: p.color, path: p.path })),
      locked: this.session.locked,
      drawing: this.drawing,
      paused: this.paused,
      video: this.hasVideo,
      backgrounds: [...this.backgrounds],
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

  /** Shows (or clears, with null) a problem, such as a lost capture. */
  setProblem(problem: string | null): void {
    this.problem = problem;
    this.changed();
  }

  /** The captured screen, sent to viewers while the share is not paused; null sends nothing. */
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

  /**
   * Runs a command.
   * @throws {Error} on a malformed command
   */
  async command(command: Command): Promise<void> {
    if (this.stopped) {
      return;
    }
    switch (command.cmd) {
      case 'newLink':
        await this.session.newInvite();
        if (this.problem === 'tracker-expired') {
          this.problem = null;
        }
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
      case 'clearDrawings':
      case 'background':
        this.run(command);
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
