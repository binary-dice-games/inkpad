// MIT License © 2026 Carlos Lopez
/**
 * @file The share state machine: `idle -> starting -> live <-> paused ->
 * ending -> idle`, one shared tab at a time (spec/02_presenter_extension
 * section 2).
 */

export type Phase = 'idle' | 'starting' | 'live' | 'paused' | 'ending';

export interface ShareState {
  phase: Phase;
  /** The shared tab, or null while idle. */
  tabId: number | null;
}

export type ShareEvent =
  | { type: 'start'; tabId: number }
  | { type: 'started' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  /** Starting failed, or the stop finished. */
  | { type: 'stopped' };

export const IDLE: Readonly<ShareState> = { phase: 'idle', tabId: null };

/**
 * The state after `event`. An event that does not apply in the current phase
 * (for example `pause` while idle) leaves the state as it is.
 */
export function transition(state: ShareState, event: ShareEvent): ShareState {
  switch (event.type) {
    case 'start':
      return state.phase === 'idle' ? { phase: 'starting', tabId: event.tabId } : state;
    case 'started':
      return state.phase === 'starting' ? { ...state, phase: 'live' } : state;
    case 'pause':
      return state.phase === 'live' ? { ...state, phase: 'paused' } : state;
    case 'resume':
      return state.phase === 'paused' ? { ...state, phase: 'live' } : state;
    case 'stop':
      return state.phase === 'idle' || state.phase === 'ending'
        ? state
        : { ...state, phase: 'ending' };
    case 'stopped':
      return state.phase === 'idle' ? state : { ...IDLE };
  }
}

/** Whether a tab with this URL can be captured (not a browser page, not the Web Store). */
export function canCapture(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === 'file:') {
    return true;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  const host = parsed.hostname;
  return (
    host !== 'chromewebstore.google.com' &&
    !(host === 'chrome.google.com' && parsed.pathname.startsWith('/webstore'))
  );
}

/** Why a tab cannot be shared. */
export type TargetProblem = { reason: 'restricted' | 'console'; message: string };

/**
 * Checks a tab before sharing it: capturable, and not a viewer or console page
 * (`viewerBase` and `consoleBase` are their addresses without the hash), which
 * would show the share to itself.
 *
 * @returns the problem, or null when the tab can be shared
 */
export function checkTarget(
  url: string | undefined,
  pages: { viewerBase: string; consoleBase: string },
): TargetProblem | null {
  const unhash = (u: string): string => u.split('#')[0] ?? u;
  if (url && [pages.viewerBase, pages.consoleBase].some((p) => unhash(url) === unhash(p))) {
    return {
      reason: 'console',
      message: 'This tab shows the viewer or the console. Share the page you want to present.',
    };
  }
  if (!canCapture(url)) {
    return {
      reason: 'restricted',
      message: 'Chrome does not let extensions use this page. Open a regular web page.',
    };
  }
  return null;
}
