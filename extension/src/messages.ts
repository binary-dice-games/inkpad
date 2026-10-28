// MIT License © 2026 Carlos Lopez
/**
 * @file Messages between the extension's parts: popup, options, service
 * worker ("background"), offscreen document and the overlay in the page.
 */
import type { Settings } from './settings';
import type { Phase } from './state';

/** What the popup and overlay show about the share. */
export interface UiState {
  phase: Phase;
  tabId: number | null;
  /** The link to give viewers, or null while idle. */
  link: string | null;
  viewers: { id: string; name: string; color: string; path: string | null }[];
  /** Whether new viewers are refused. */
  locked: boolean;
  /** Whether viewers may draw. */
  drawing: boolean;
  paused: boolean;
  /** Whether the overlay is attached to the shared tab. */
  overlay: boolean;
  /** A problem to show (for example `no-tracker`), or null. */
  problem: string | null;
}

export const IDLE_UI: Readonly<UiState> = {
  phase: 'idle',
  tabId: null,
  link: null,
  viewers: [],
  locked: false,
  drawing: true,
  paused: false,
  overlay: false,
  problem: null,
};

/** Commands the presenter can give while sharing (from the popup or the overlay). */
export type Command =
  | { cmd: 'lock'; on: boolean }
  | { cmd: 'drawing'; on: boolean }
  | { cmd: 'pause'; on: boolean }
  | { cmd: 'newLink' }
  | { cmd: 'remove'; id: string }
  | { cmd: 'viewport'; w: number; h: number };

/** To the service worker. */
export type BackgroundMessage =
  | { target: 'background'; type: 'start'; tabId: number }
  | { target: 'background'; type: 'stop' }
  | { target: 'background'; type: 'status' }
  /** The overlay is missing from the shared tab (navigation): put it back. */
  | { target: 'background'; type: 'reattach' }
  /** The presenter paused or resumed the share (for the badge). */
  | { target: 'background'; type: 'paused'; on: boolean };

/** To the offscreen document. */
export type OffscreenMessage =
  | { target: 'offscreen'; type: 'start'; tabId: number; settings: Settings }
  | { target: 'offscreen'; type: 'stop' }
  | { target: 'offscreen'; type: 'status' }
  | { target: 'offscreen'; type: 'command'; command: Command }
  | { target: 'offscreen'; type: 'overlay'; attached: boolean };

/** On the overlay's port: from the offscreen document. */
export type PortUiMessage = { k: 'ui'; ui: UiState };

/** On the overlay's port: from the overlay. */
export type PortControlMessage = { k: 'ctl'; command: Command } | { k: 'stopShare' };

/** To the overlay (tabs.sendMessage). */
export type OverlayMessage = { type: 'toggle-overlay' };

/** The name of the overlay's port. */
export const OVERLAY_PORT = 'inkpad-overlay';

/** The answer to `start`: ok with the state, or why not. */
export type StartResult =
  { ok: true; ui: UiState } | { ok: false; reason: string; message: string };

/** A message type without its `target` (distributes over unions). */
export type Untargeted<T> = T extends { target: string } ? Omit<T, 'target'> : never;
