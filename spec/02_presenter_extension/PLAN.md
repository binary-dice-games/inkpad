# 02_presenter_extension — implementation plan

Design: [DESIGN.md](DESIGN.md). Depends on `01_core_features`. Follow in order;
update the plan before diverging; record results.

## Step 1 — Extension skeleton and state machine

**Goal:** MV3 shell that starts/stops a share.
**Deliverables:** manifest, service worker state machine, offscreen document
hosting a host `Session`, popup with start/stop and copy link, badge, shortcut.
**Tests:** state-machine unit tests; the unpacked extension starts a share and
a viewer joins.
**Result:** Done.

## Step 2 — On-page overlay (superseded)

**Goal:** Whiteboard on the presenter's page.
**Result:** Built (content script, shadow-DOM overlay, session proxy, re-injection
on navigation) and verified in Chromium, then **removed in step 5**: tab capture
records the overlay, and every fix cost either a blink or a fragile architecture
(`spec/03_tab_streaming/PLAN.md` step 1). The board keeper and the session proxy
package stay in the repo; the keeper is used, the proxy is not.

## Step 3 — People panel and controls (superseded in place)

**Goal:** Presenter commands.
**Result:** Lock, drawing on/off, pause, remove, new link and stop exist as
`ShareHost` commands; the popup drives them. The overlay's control bar went with
the overlay; the console (project 04) is the other place for them.

## Step 4 — Options and permissions

**Goal:** Settings.
**Result:** Done: options page with validated `storage.sync` settings. The
optional all-sites permission was only for the overlay and is gone in step 5.

## Step 5 — Console instead of overlay

**Goal:** Presenter draws in a separate window; nothing is injected into the page.
**Deliverables:** presenter key and `ctl` channel in `ShareHost` (auth, kick, end,
clear, lock, drawing, pause); remove `overlay.ts`, re-injection, the
`scripting` and optional host permissions; two links in the popup and an **Open
console** button; refuse to share a tab that shows this session's viewer;
`viewer.html` bundled into the extension.
**Tests:** `ShareHost` presenter auth and commands (unit); popup/console e2e in
Chromium: console draws, clears, kicks, ends.
**Result:** Done. `ShareHost` has the presenter key, the `ctl` channel (handled
inside the host's `accept` and never relayed), kick, end, clear, lock, drawing
and pause; the overlay, re-injection, the `scripting` and optional host
permissions are gone; the popup shows both links and **Open console**
(`chrome.windows.create`); the viewer app is bundled as `viewer.html`; a tab that
shows this session's viewer or console is refused. Unit tests (19 on
`ShareHost`, three of its authorization checks mutation-tested) and the
Chromium end-to-end test (`tests/e2e/extension.test.ts`).

## Step 6 — Video

Wire in `03_tab_streaming` steps 2 and 3, then run the combined e2e.
**Result:** Done: the extension captures the tab and the combined e2e runs in
Chromium (see `spec/03_tab_streaming/PLAN.md`).

## Completion Criteria

- The presenter can start, open the console, draw, kick, clear and end; viewers
  see the video and the board.
- Nothing is injected into the shared page.
- All tests pass; manual checklist done on Chrome stable.
