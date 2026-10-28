// MIT License © 2026 Carlos Lopez
/**
 * @file The offscreen document: it owns the host session and the tab capture.
 * A service worker sleeps and cannot hold WebRTC links or a capture stream, so
 * the session, the board keeper and the video live here. The service worker
 * and the popup reach it through runtime messages.
 */
import { SessionError } from '@inkpad/collab-session';
import { startCapture } from './capture';
import type { Capture } from './capture';
import { IDLE_UI } from './messages';
import type { Command, OffscreenMessage, StartResult } from './messages';
import { ShareHost } from './share-host';

let share: ShareHost | null = null;
let capture: Capture | null = null;

function stopShare(): void {
  share?.stop();
  share = null;
  capture?.stop();
  capture = null;
}

async function start(message: Extract<OffscreenMessage, { type: 'start' }>): Promise<StartResult> {
  stopShare();
  try {
    capture = await startCapture(message.streamId, message.tab, message.settings.video);
    const host = await ShareHost.start({
      settings: message.settings,
      tabId: message.tabId,
      consoleBase: message.consoleBase,
      // The console asked to end the session: the service worker stops everything.
      onEnd: () => {
        chrome.runtime.sendMessage({ target: 'background', type: 'stop' }).catch(() => {});
      },
    });
    share = host;
    host.setSource(capture.stream);
    await host.command({ cmd: 'viewport', w: message.tab.width, h: message.tab.height });
    return { ok: true, ui: host.ui() };
  } catch (e) {
    stopShare();
    const reason = e instanceof SessionError ? e.reason : 'capture';
    return { ok: false, reason, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Runs a popup command; a pause also tells the service worker (the badge). */
async function runCommand(host: ShareHost, command: Command): Promise<void> {
  await host.command(command);
  if (command.cmd === 'pause') {
    chrome.runtime
      .sendMessage({ target: 'background', type: 'paused', on: command.on })
      .catch(() => {});
  }
}

/** Asks the service worker for a new capture id of the shared tab. */
async function freshStreamId(): Promise<string> {
  const answer = (await chrome.runtime.sendMessage({ target: 'background', type: 'captureId' })) as
    { ok: true; id: string } | { ok: false; message?: string } | undefined;
  if (!answer?.ok) {
    throw new Error(answer?.message ?? 'no capture id');
  }
  return answer.id;
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
    case 'acceptCode': {
      if (!share) {
        return { ok: false, message: 'Not sharing.' };
      }
      try {
        return { ok: true, answer: await share.acceptCode(message.code) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    }
    case 'resize': {
      if (!share || !capture) {
        return { ok: false, message: 'no share' };
      }
      await share.command({ cmd: 'viewport', w: message.width, h: message.height });
      try {
        await capture.restart(freshStreamId, { width: message.width, height: message.height });
        share.setProblem(null);
        return { ok: true };
      } catch (e) {
        share.setProblem('capture-lost');
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    }
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
