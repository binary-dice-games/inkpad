// MIT License © 2026 Carlos Lopez
/**
 * @file The options page: edits the settings in chrome.storage.sync. Whatever
 * is typed goes through `cleanSettings`, and the form is filled again from
 * what was kept, so rejected entries visibly disappear.
 */
import { UPLINK_WARNING_KBPS, uplinkKbps } from '@inkpad/defaults';
import {
  DEFAULT_SETTINGS,
  cleanSettings,
  cleanTrackers,
  formatIceLines,
  loadSettings,
  parseIceLines,
  saveSettings,
} from './settings';
import type { Settings } from './settings';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const input = (id: string): HTMLInputElement => $<HTMLInputElement>(id);

function fill(s: Settings): void {
  input('name').value = s.name;
  input('color').value = s.color;
  input('viewersMayDraw').checked = s.viewersMayDraw;
  input('keepAcrossNavigation').checked = s.keepAcrossNavigation;
  input('fps').value = String(s.video.fps);
  input('maxWidth').value = String(s.video.maxWidth);
  input('maxHeight').value = String(s.video.maxHeight);
  input('bitrateKbps').value = String(s.video.bitrateKbps);
  input('viewerBase').value = s.viewerBase;
  $<HTMLTextAreaElement>('trackers').value = s.trackers.join('\n');
  $<HTMLTextAreaElement>('iceServers').value = formatIceLines(s.iceServers);
  uplink();
}

/** The settings as typed (not yet validated). */
function read(): unknown {
  return {
    name: input('name').value,
    color: input('color').value,
    viewersMayDraw: input('viewersMayDraw').checked,
    keepAcrossNavigation: input('keepAcrossNavigation').checked,
    video: {
      fps: input('fps').valueAsNumber,
      maxWidth: input('maxWidth').valueAsNumber,
      maxHeight: input('maxHeight').valueAsNumber,
      bitrateKbps: input('bitrateKbps').valueAsNumber,
    },
    viewerBase: input('viewerBase').value,
    trackers: cleanTrackers($<HTMLTextAreaElement>('trackers').value) ?? [],
    iceServers: parseIceLines($<HTMLTextAreaElement>('iceServers').value),
  };
}

/** The uplink a star of 10 viewers needs, with a warning above the threshold. */
function uplink(): void {
  const s = cleanSettings(read());
  const kbps = uplinkKbps(10, s.video);
  const el = $('uplink');
  el.textContent = `With 10 viewers you upload about ${(kbps / 1000).toFixed(1)} Mbit/s (one stream per viewer).`;
  el.classList.toggle('warn', kbps > UPLINK_WARNING_KBPS);
}

function status(text: string): void {
  $('status').textContent = text;
}

async function main(): Promise<void> {
  fill(await loadSettings());
  for (const id of ['fps', 'bitrateKbps']) {
    input(id).addEventListener('input', uplink);
  }
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const saved = await saveSettings(read());
      fill(saved);
      status('Saved.');
    } catch (err) {
      status(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  $('reset').addEventListener('click', async () => {
    fill(await saveSettings(DEFAULT_SETTINGS));
    status('Defaults restored.');
  });
}

void main();
