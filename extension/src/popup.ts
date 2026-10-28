// MIT License © 2026 Carlos Lopez
/**
 * @file The toolbar popup: start and stop a share, copy the link and give the
 * presenter's commands. Opening it grants `activeTab` for the current tab,
 * which is also how a lost overlay is put back after a navigation.
 */
import { IDLE_UI } from './messages';
import type { BackgroundMessage, Command, OffscreenMessage, UiState, Untargeted } from './messages';
import { canInject } from './state';
import { loadSettings } from './settings';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

let ui: UiState = { ...IDLE_UI };
let tab: chrome.tabs.Tab | undefined;

async function toBackground<T>(message: Untargeted<BackgroundMessage>): Promise<T> {
  return (await chrome.runtime.sendMessage({ target: 'background', ...message })) as T;
}

async function toOffscreen(command: Command): Promise<void> {
  const message: OffscreenMessage = { target: 'offscreen', type: 'command', command };
  await chrome.runtime.sendMessage(message);
  await refresh();
}

function show(id: string, visible: boolean): void {
  $(id).hidden = !visible;
}

function render(): void {
  const live = ui.phase === 'live' || ui.phase === 'paused';
  show('idle', !live);
  show('live', live);
  if (!live) {
    const ok = canInject(tab?.url);
    show('restricted', !ok);
    $('restricted').textContent = ok
      ? ''
      : 'Chrome does not let extensions use this page. Open a regular web page to share it.';
    ($('start') as HTMLButtonElement).disabled = !ok;
    return;
  }
  const n = ui.viewers.length;
  $('state').textContent =
    `${ui.paused ? 'Paused' : 'Sharing'} · ${n} viewer${n === 1 ? '' : 's'}` +
    (ui.tabId !== tab?.id ? ' (another tab)' : '');
  ($('link') as HTMLInputElement).value = ui.link ?? '';
  const list = $('viewers');
  list.replaceChildren(
    ...ui.viewers.map((v) => {
      const li = document.createElement('li');
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = /^#[0-9a-fA-F]{6}$/.test(v.color) ? v.color : '#8b8d98';
      const name = document.createElement('span');
      name.textContent = v.name || 'Viewer';
      name.style.flex = '1';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '✕';
      remove.title = 'Remove viewer';
      remove.setAttribute('aria-label', `Remove ${v.name || 'viewer'}`);
      remove.addEventListener('click', () => void toOffscreen({ cmd: 'remove', id: v.id }));
      li.append(swatch, name, remove);
      return li;
    }),
  );
  ($('drawing') as HTMLInputElement).checked = ui.drawing;
  ($('lock') as HTMLInputElement).checked = ui.locked;
  $('pause').textContent = ui.paused ? 'Resume' : 'Pause';
  show('problem', ui.problem === 'no-tracker');
  $('problem').textContent = 'No tracker could be reached; this network may block them.';
  show('reattach', !ui.overlay && ui.tabId === tab?.id);
}

async function refresh(): Promise<void> {
  ui = (await toBackground<UiState | undefined>({ type: 'status' })) ?? { ...IDLE_UI };
  render();
}

async function start(): Promise<void> {
  if (tab?.id === undefined) {
    return;
  }
  const error = $('error');
  error.hidden = true;
  const settings = await loadSettings();
  if (settings.keepAcrossNavigation) {
    // Must run in this click: the permission prompt needs the user gesture.
    await chrome.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
  }
  const result = await toBackground<{ ok: boolean; message?: string; overlay?: boolean }>({
    type: 'start',
    tabId: tab.id,
  });
  if (!result.ok) {
    error.textContent = result.message ?? 'Could not start sharing.';
    error.hidden = false;
  }
  await refresh();
}

async function main(): Promise<void> {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $('version').textContent = `v${chrome.runtime.getManifest().version}`;

  $('start').addEventListener('click', () => void start());
  $('stop').addEventListener('click', async () => {
    await toBackground({ type: 'stop' });
    await refresh();
  });
  $('copy').addEventListener('click', async () => {
    const link = $('link') as HTMLInputElement;
    try {
      await navigator.clipboard.writeText(link.value);
      $('copy').textContent = 'Copied';
    } catch {
      link.select();
      $('copy').textContent = document.execCommand('copy') ? 'Copied' : 'Ctrl+C';
    }
    setTimeout(() => ($('copy').textContent = 'Copy'), 1500);
  });
  $('drawing').addEventListener('change', (e) =>
    toOffscreen({ cmd: 'drawing', on: (e.target as HTMLInputElement).checked }),
  );
  $('lock').addEventListener('change', (e) =>
    toOffscreen({ cmd: 'lock', on: (e.target as HTMLInputElement).checked }),
  );
  $('pause').addEventListener('click', () => toOffscreen({ cmd: 'pause', on: !ui.paused }));
  $('newLink').addEventListener('click', () => toOffscreen({ cmd: 'newLink' }));
  $('reattachButton').addEventListener('click', async () => {
    await toBackground({ type: 'reattach' });
    setTimeout(() => void refresh(), 300);
  });
  $('settings').addEventListener('click', (e) => {
    e.preventDefault();
    void chrome.runtime.openOptionsPage();
  });

  await refresh();
  // Opening the popup grants access to this tab: put a lost overlay back.
  if ((ui.phase === 'live' || ui.phase === 'paused') && !ui.overlay && ui.tabId === tab?.id) {
    await toBackground({ type: 'reattach' });
    setTimeout(() => void refresh(), 300);
  }
  setInterval(() => void refresh(), 1500);
}

void main();
