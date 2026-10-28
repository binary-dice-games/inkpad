// MIT License © 2026 Carlos Lopez
/**
 * @file Messages between the extension's parts: popup, options, service
 * worker ("background") and offscreen document.
 */
import type { Settings } from './settings';
import type { Phase } from './state';

/** What the popup shows about the share. */
export interface UiState {
  phase: Phase;
  tabId: number | null;
  /** The link to give viewers, or null while idle. */
  link: string | null;
  /** The presenter console link (carries the presenter key), or null while idle. */
  consoleLink: string | null;
  viewers: { id: string; name: string; color: string; path: string | null }[];
  /** Whether new viewers are refused. */
  locked: boolean;
  /** Whether viewers may draw. */
  drawing: boolean;
  paused: boolean;
  /** A problem to show (for example `no-tracker`), or null. */
  problem: string | null;
}

export const IDLE_UI: Readonly<UiState> = {
  phase: 'idle',
  tabId: null,
  link: null,
  consoleLink: null,
  viewers: [],
  locked: false,
  drawing: true,
  paused: false,
  problem: null,
};

/** Commands the presenter can give from the popup. */
export type Command =
  | { cmd: 'lock'; on: boolean }
  | { cmd: 'drawing'; on: boolean }
  | { cmd: 'pause'; on: boolean }
  | { cmd: 'newLink' }
  | { cmd: 'remove'; id: string }
  | { cmd: 'clear' }
  | { cmd: 'viewport'; w: number; h: number };

/** To the service worker. */
export type BackgroundMessage =
  | { target: 'background'; type: 'start'; tabId: number }
  | { target: 'background'; type: 'stop' }
  | { target: 'background'; type: 'status' }
  /** A fresh tab capture id for the shared tab (the capture restarts after a resize). */
  | { target: 'background'; type: 'captureId' }
  /** The presenter paused or resumed the share (for the badge). */
  | { target: 'background'; type: 'paused'; on: boolean };

/** To the offscreen document. */
export type OffscreenMessage =
  | {
      target: 'offscreen';
      type: 'start';
      tabId: number;
      settings: Settings;
      /** The id from `chrome.tabCapture.getMediaStreamId`. */
      streamId: string;
      /** The tab's size in CSS pixels. */
      tab: { width: number; height: number };
      /** Where the console page lives (this extension's `viewer.html`). */
      consoleBase: string;
    }
  | { target: 'offscreen'; type: 'stop' }
  | { target: 'offscreen'; type: 'status' }
  | { target: 'offscreen'; type: 'command'; command: Command }
  /** A viewer's join code: the answer is the code to send back. */
  | { target: 'offscreen'; type: 'acceptCode'; code: string }
  /** The shared tab changed size: capture it again (with a fresh stream id) at the new shape. */
  | { target: 'offscreen'; type: 'resize'; width: number; height: number };

/** A message type without its `target` (distributes over unions). */
export type Untargeted<T> = T extends { target: string } ? Omit<T, 'target'> : never;

/** The answer to `start`: ok with the state, or why not. */
export type StartResult =
  { ok: true; ui: UiState } | { ok: false; reason: string; message: string };
