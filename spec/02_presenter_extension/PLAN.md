# 02_presenter_extension — implementation plan

Design: [DESIGN.md](DESIGN.md). Depends on `01_core_features` steps 1–3.
Follow in order; update the plan before diverging; record results.

## Step 1 — Extension skeleton and state machine

**Goal:** MV3 shell that starts/stops a share with no video yet.
**Deliverables:** manifest, service worker state machine, offscreen document
hosting a host `Session`, popup with start/stop and copy link, badge.
**Tests:** state-machine unit tests; Playwright: start produces a link, a
guest in the memory/fake-tracker network joins, stop ends the room.
**Result:** Done. Manifest, service worker state machine (`state.ts`,
`background.ts`), offscreen document hosting `ShareHost`, popup, badge,
shortcut. Divergence: the overlay connects to the offscreen document directly,
the service worker does not relay (DESIGN section 2 and 9).

## Step 2 — Overlay and SessionProxy

**Goal:** Whiteboard usable on the presenter's page.
**Deliverables:** content script, shadow-DOM overlay, Port relay,
`SessionProxy`, snapshot-on-attach, navigation re-attach, pointer pass-through,
restricted-page handling.
**Tests:** draw with each tool; reload and cross-origin navigate; page remains
clickable in pointer mode; restricted page message.
**Result:** Done. Overlay in a shadow root under `<html>`, connected through
`connectSessionProxy`; drawings survive reloads through the board keeper;
re-injection on `tabs.onUpdated`; pointer mode leaves the page clickable;
restricted pages refused with a message. Verified in Chromium with the unpacked
extension (`tests/e2e/extension.test.ts`): pen stroke, viewer sticker, same-origin
reload, tab close. Not yet tested: the other tools, a cross-origin navigation
(needs the all-sites permission), and the overlay's control bar and popup UI
(only their commands are).

## Step 3 — Toolbar, people panel, controls

**Goal:** Full presenter UX.
**Deliverables:** ported toolbar, sticker chooser, people list, lock/remove/
new link, pause, hide overlay, shortcuts, remembered position.
**Tests:** lock drops viewer ops host-side; remove/new-link behaviour; hide
overlay does not stop sync.
**Result:** Done, except the whiteboard toolbar stays at the left edge (not
draggable): people panel, lock, remove, new link, pause, hide drawings, stop,
control bar position remembered, three shortcuts. Lock, remove and new link are
tested on `ShareHost`, lock also in the browser; hide drawings and the shortcuts
are untested.

## Step 4 — Options and permissions

**Goal:** Settings and the optional host permission flow.
**Deliverables:** options page, `storage.sync` schema with validation,
permission prompt, first-run consent panel.
**Tests:** invalid settings rejected; live video-parameter changes reach the
offscreen doc; permission-denied path keeps working (re-click to re-attach).
**Result:** Done. Options page with validated `storage.sync` settings
(trackers, STUN/TURN, video, name, colour, viewer page), the optional all-sites
permission requested from the popup click, consent notice. The live
video-parameter check and the permission-denied path wait for video
(step 5); settings validation is unit tested.

## Step 5 — Integrate video

Wire in `03_tab_streaming` (its steps 2–3), then run the combined e2e.
**Result:** _pending_

## Completion Criteria

- Presenter can start, draw, share a link, lock/remove viewers and stop,
  surviving page navigation.
- All tests pass in CI; manual checklist done on Chrome stable.
