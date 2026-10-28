// MIT License © 2026 Carlos Lopez
/**
 * @file The service worker: the orchestrator. It starts and stops shares,
 * keeps the overlay on the shared tab, shows the badge and handles the
 * shortcuts. It is stateless between wake-ups: the phase and tab are kept in
 * chrome.storage.session and the share itself lives in the offscreen document.
 */
import { IDLE_UI } from './messages';
import type {
  BackgroundMessage,
  OffscreenMessage,
  OverlayMessage,
  StartResult,
  UiState,
  Untargeted,
} from './messages';
import { loadSettings } from './settings';
import { IDLE, canInject, transition } from './state';
import type { ShareEvent, ShareState } from './state';

const OFFSCREEN_PATH = 'offscreen.html';
const STATE_KEY = 'share';
const CONSENT_KEY = 'consented';

// ── State ────────────────────────────────────────────────────────────────────

async function getState(): Promise<ShareState> {
  const stored = await chrome.storage.session.get(STATE_KEY);
  return (stored[STATE_KEY] as ShareState | undefined) ?? { ...IDLE };
}

async function apply(event: ShareEvent): Promise<ShareState> {
  const next = transition(await getState(), event);
  await chrome.storage.session.set({ [STATE_KEY]: next });
  await showBadge(next);
  return next;
}

async function showBadge(state: ShareState, problem = false): Promise<void> {
  const text = problem ? '!' : state.phase === 'live' ? '●' : state.phase === 'paused' ? 'II' : '';
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: problem ? '#d97706' : '#e5484d' });
}

// ── Offscreen document ───────────────────────────────────────────────────────

async function hasOffscreen(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  return contexts.length > 0;
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) {
    return;
  }
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.WEB_RTC],
    justification: 'Holds the WebRTC connections and the tab capture of a shared whiteboard.',
  });
}

async function toOffscreen<T>(message: Untargeted<OffscreenMessage>): Promise<T> {
  return (await chrome.runtime.sendMessage({ target: 'offscreen', ...message })) as T;
}

async function status(): Promise<UiState> {
  if (!(await hasOffscreen())) {
    return { ...IDLE_UI };
  }
  return (await toOffscreen<UiState | undefined>({ type: 'status' })) ?? { ...IDLE_UI };
}

// ── Overlay ──────────────────────────────────────────────────────────────────

/** Puts the overlay in the tab; false when the page refuses (no access any more). */
async function injectOverlay(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['overlay.js'] });
    return true;
  } catch {
    return false;
  }
}

// ── Start and stop ───────────────────────────────────────────────────────────

type Started =
  { ok: true; ui: UiState; overlay: boolean } | { ok: false; reason: string; message: string };

async function start(tabId: number): Promise<Started> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (!tab || !canInject(tab.url)) {
    return {
      ok: false,
      reason: 'restricted',
      message: 'Chrome does not let extensions use this page. Open a regular web page.',
    };
  }
  const before = await getState();
  if (before.phase !== 'idle') {
    await stop();
  }
  await apply({ type: 'start', tabId });
  try {
    const settings = await loadSettings();
    await ensureOffscreen();
    const result = await toOffscreen<StartResult>({ type: 'start', tabId, settings });
    if (!result.ok) {
      throw Object.assign(new Error(result.message), { reason: result.reason });
    }
    await apply({ type: 'started' });
    const overlay = await injectOverlay(tabId);
    if (!overlay) {
      await showBadge(await getState(), true);
    }
    return { ok: true, ui: result.ui, overlay };
  } catch (e) {
    await stop();
    return {
      ok: false,
      reason: (e as { reason?: string }).reason ?? 'error',
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

async function stop(): Promise<void> {
  await apply({ type: 'stop' });
  if (await hasOffscreen()) {
    await toOffscreen({ type: 'stop' }).catch(() => undefined);
    await chrome.offscreen.closeDocument().catch(() => undefined);
  }
  await apply({ type: 'stopped' });
}

/** The overlay went missing (navigation): put it back if the tab allows. */
async function reattach(): Promise<boolean> {
  const state = await getState();
  if (state.tabId === null || (state.phase !== 'live' && state.phase !== 'paused')) {
    return false;
  }
  const tab = await chrome.tabs.get(state.tabId).catch(() => undefined);
  if (!tab || !canInject(tab.url)) {
    return false;
  }
  const ok = await injectOverlay(state.tabId);
  await showBadge(state, !ok);
  return ok;
}

// ── Events ───────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const m = message as BackgroundMessage | undefined;
  if (m?.target !== 'background' || sender.id !== chrome.runtime.id) {
    return false;
  }
  const run = async (): Promise<unknown> => {
    switch (m.type) {
      case 'start':
        await chrome.storage.local.set({ [CONSENT_KEY]: true });
        return start(m.tabId);
      case 'stop':
        await stop();
        return { ok: true };
      case 'status':
        return status();
      case 'reattach':
        return { ok: await reattach() };
      case 'paused':
        await apply({ type: m.on ? 'pause' : 'resume' });
        return { ok: true };
    }
  };
  run().then(sendResponse, (e: unknown) =>
    sendResponse({
      ok: false,
      reason: 'error',
      message: e instanceof Error ? e.message : String(e),
    }),
  );
  return true;
});

// The shared tab was closed, or it loaded another page: keep the overlay on it.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getState();
  if (state.tabId === tabId && state.phase !== 'idle') {
    await stop();
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  if (change.status !== 'complete') {
    return;
  }
  const state = await getState();
  if (state.tabId === tabId && (state.phase === 'live' || state.phase === 'paused')) {
    await reattach();
  }
});

// A browser restart drops the offscreen document and the shares with it.
chrome.runtime.onStartup.addListener(() => {
  void apply({ type: 'stopped' });
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  const state = await getState();
  const active = state.phase === 'live' || state.phase === 'paused';
  if (command === 'toggle-share') {
    if (active) {
      await stop();
    } else if (tab?.id !== undefined) {
      const consented = (await chrome.storage.local.get(CONSENT_KEY))[CONSENT_KEY] === true;
      if (consented) {
        await start(tab.id);
      } else {
        // The first share is confirmed in the popup, which explains what is shared.
        await chrome.action.openPopup().catch(() => undefined);
      }
    }
  } else if (command === 'toggle-overlay' && active && state.tabId !== null) {
    const message: OverlayMessage = { type: 'toggle-overlay' };
    await chrome.tabs.sendMessage(state.tabId, message).catch(() => undefined);
  } else if (command === 'toggle-pause' && active) {
    const ui = await status();
    await toOffscreen({ type: 'command', command: { cmd: 'pause', on: !ui.paused } });
  }
});
