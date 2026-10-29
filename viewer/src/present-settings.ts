// MIT License © 2026 Carlos Lopez
/**
 * @file Settings of the presenter page (spec/06_static_presenter): the
 * extension's settings plus the mouse pointer choice, kept in `localStorage`.
 * Everything read back goes through the same validation as the extension's.
 */
import { cleanSettings } from '../../extension/src/settings';
import type { Settings } from '../../extension/src/settings';
import type { CursorMode } from './display-capture';

export interface PresenterPrefs {
  settings: Settings;
  cursor: CursorMode;
  /** The whiteboard toolbar is folded away. */
  toolsCollapsed: boolean;
  /** The controls panel is folded away. */
  panelCollapsed: boolean;
}

const KEY = 'inkpad.presenter.prefs';

/** Prefs from any stored value: every field validated, missing or invalid ones defaulted. */
export function cleanPrefs(input: unknown): PresenterPrefs {
  const o = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  return {
    settings: cleanSettings(o.settings),
    cursor: o.cursor === 'motion' || o.cursor === 'never' ? o.cursor : 'always',
    toolsCollapsed: o.toolsCollapsed === true,
    panelCollapsed: o.panelCollapsed === true,
  };
}

/** The saved prefs, or the defaults when nothing usable is stored. */
export function loadPrefs(): PresenterPrefs {
  try {
    return cleanPrefs(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return cleanPrefs(undefined); // private window, blocked storage or damaged value
  }
}

/** Stores the prefs; the page keeps working when storage is blocked. */
export function savePrefs(prefs: PresenterPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // not stored
  }
}
