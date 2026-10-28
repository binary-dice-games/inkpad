// MIT License © 2026 Carlos Lopez
/**
 * @file The offscreen document: it owns the host session for the shared tab.
 * A service worker sleeps and cannot hold WebRTC links, and the page reloads,
 * so the session, the board keeper and (later) the capture stream live here.
 * The overlay in the page connects to it directly through a runtime port.
 */
import { SessionError } from '@inkpad/collab-session';
import { IDLE_UI, OVERLAY_PORT } from './messages';
import type {
  Command,
  OffscreenMessage,
  PortControlMessage,
  PortUiMessage,
  StartResult,
  UiState,
} from './messages';
import { ShareHost } from './share-host';

let share: ShareHost | null = null;
let unsubscribe: (() => void) | null = null;
const ports = new Set<chrome.runtime.Port>();

function broadcast(ui: UiState): void {
  const message: PortUiMessage = { k: 'ui', ui };
  for (const port of ports) {
    try {
      port.postMessage(message);
    } catch {
      ports.delete(port);
    }
  }
}

function stopShare(): void {
  unsubscribe?.();
  unsubscribe = null;
  share?.stop();
  share = null;
  broadcast({ ...IDLE_UI });
  for (const port of ports) {
    port.disconnect();
  }
  ports.clear();
}

async function start(message: Extract<OffscreenMessage, { type: 'start' }>): Promise<StartResult> {
  stopShare();
  try {
    const host = await ShareHost.start({ settings: message.settings, tabId: message.tabId });
    share = host;
    unsubscribe = host.onChange(broadcast);
    return { ok: true, ui: host.ui() };
  } catch (e) {
    const reason = e instanceof SessionError ? e.reason : 'error';
    return { ok: false, reason, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Runs a presenter command; a pause also tells the service worker (the badge). */
async function runCommand(host: ShareHost, command: Command): Promise<void> {
  await host.command(command);
  if (command.cmd === 'pause') {
    chrome.runtime
      .sendMessage({ target: 'background', type: 'paused', on: command.on })
      .catch(() => {});
  }
}

async function handle(message: OffscreenMessage): Promise<unknown> {
  switch (message.type) {
    case 'start':
      return start(message);
    case 'stop':
      stopShare();
      return { ok: true };
    case 'status':
      return share?.ui() ?? { ...IDLE_UI };
    case 'command':
      if (share) {
        await runCommand(share, message.command);
      }
      return share?.ui() ?? { ...IDLE_UI };
    case 'overlay':
      share?.setOverlay(message.attached);
      return { ok: true };
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const m = message as OffscreenMessage | undefined;
  if (m?.target !== 'offscreen' || sender.id !== chrome.runtime.id) {
    return false;
  }
  handle(m).then(sendResponse, (e: unknown) =>
    sendResponse({
      ok: false,
      reason: 'error',
      message: e instanceof Error ? e.message : String(e),
    }),
  );
  return true;
});

// The overlay of the shared tab (top frame only) connects here.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== OVERLAY_PORT) {
    return;
  }
  const sender = port.sender;
  if (
    !share ||
    sender?.id !== chrome.runtime.id ||
    sender.tab?.id !== share.tabId ||
    sender.frameId !== 0
  ) {
    port.disconnect();
    return;
  }
  const host = share;
  ports.add(port);
  host.setOverlay(true);
  const stopServing = host.serve(port);
  port.postMessage({ k: 'ui', ui: host.ui() } satisfies PortUiMessage);
  port.onMessage.addListener((raw: unknown) => {
    const m = raw as PortControlMessage | undefined;
    if (m?.k === 'ctl') {
      runCommand(host, m.command).catch(() => {});
    } else if (m?.k === 'stopShare') {
      chrome.runtime.sendMessage({ target: 'background', type: 'stop' }).catch(() => {});
    }
  });
  port.onDisconnect.addListener(() => {
    stopServing();
    ports.delete(port);
    if (share === host && ports.size === 0) {
      host.setOverlay(false);
    }
  });
});
