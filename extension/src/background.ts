// MIT License © 2026 Carlos Lopez
/**
 * @file The service worker: the orchestrator. It starts and stops shares, gets
 * the tab capture id, tells the capture when the tab changes size, shows the
 * badge and handles the shortcuts. It is stateless between wake-ups: the phase
 * and tab are kept in chrome.storage.session and the share itself lives in the
 * offscreen document. Nothing is injected into the shared page.
 */
import { IDLE_UI } from './messages';
import type {
  BackgroundMessage,
  OffscreenMessage,
  StartResult,
  UiState,
  Untargeted,
} from './messages';
import { loadSettings } from './settings';
import { IDLE, checkTarget, transition } from './state';
import type { ShareEvent, ShareState } from './state';

const OFFSCREEN_PATH = 'offscreen.html';
const CONSOLE_PATH = 'viewer.html';
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

async function showBadge(state: ShareState): Promise<void> {
  const text = state.phase === 'live' ? '●' : state.phase === 'paused' ? 'II' : '';
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: '#e5484d' });
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

/** A tab capture id (the typings only have `getMediaStreamId` with a callback). */
function captureId(tabId: number): Promise<string> {
  return new Promise<string>((resolve, reject) =>
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) =>
      chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(id),
    ),
  );
}

// ── Start and stop ───────────────────────────────────────────────────────────

type Started = { ok: true; ui: UiState } | { ok: false; reason: string; message: string };

async function start(tabId: number): Promise<Started> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  const settings = await loadSettings();
  const consoleBase = chrome.runtime.getURL(CONSOLE_PATH);
  const problem = tab
    ? checkTarget(tab.url, { viewerBase: settings.viewerBase, consoleBase })
    : { reason: 'restricted' as const, message: 'That tab is gone.' };
  if (problem) {
    return { ok: false, ...problem };
  }
  if ((await getState()).phase !== 'idle') {
    await stop();
  }
  await apply({ type: 'start', tabId });
  try {
    // Must come from the click or shortcut that gave us the tab (activeTab).
    const streamId = await captureId(tabId);
    await ensureOffscreen();
    const result = await toOffscreen<StartResult>({
      type: 'start',
      tabId,
      settings,
      streamId,
      tab: { width: tab?.width ?? 1280, height: tab?.height ?? 720 },
      consoleBase,
    });
    if (!result.ok) {
      throw Object.assign(new Error(result.message), { reason: result.reason });
    }
    await apply({ type: 'started' });
    return { ok: true, ui: result.ui };
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

/** Tells the capture the shared tab has another shape (the window was resized). */
async function tabResized(): Promise<void> {
  const state = await getState();
  if (state.tabId === null || (state.phase !== 'live' && state.phase !== 'paused')) {
    return;
  }
  const tab = await chrome.tabs.get(state.tabId).catch(() => undefined);
  if (tab?.width && tab.height) {
    await toOffscreen({ type: 'resize', width: tab.width, height: tab.height }).catch(
      () => undefined,
    );
  }
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
      case 'captureId': {
        // activeTab lasts while the tab stays on its page; after a cross-origin
        // navigation there is no new id and the capture cannot be restarted.
        const state = await getState();
        if (state.tabId === null) {
          return { ok: false, message: 'no share' };
        }
        try {
          return { ok: true, id: await captureId(state.tabId) };
        } catch (e) {
          return { ok: false, message: e instanceof Error ? e.message : String(e) };
        }
      }
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

// The shared tab was closed: end the share.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getState();
  if (state.tabId === tabId && state.phase !== 'idle') {
    await stop();
  }
});

// The window of the shared tab changed size, or the tab loaded a page: re-fit the capture.
chrome.windows.onBoundsChanged.addListener(() => void tabResized());
chrome.tabs.onUpdated.addListener((_tabId, change) => {
  if (change.status === 'complete') {
    void tabResized();
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
  } else if (command === 'toggle-pause' && active) {
    const ui = await status();
    await toOffscreen({ type: 'command', command: { cmd: 'pause', on: !ui.paused } });
  }
});
