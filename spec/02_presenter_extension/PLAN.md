# 02_presenter_extension — implementation plan

Design: [DESIGN.md](DESIGN.md). Depends on `01_core_features` steps 1–3.
Follow in order; update the plan before diverging; record results.

## Step 1 — Extension skeleton and state machine

**Goal:** MV3 shell that starts/stops a share with no video yet.
**Deliverables:** manifest, service worker state machine, offscreen document
hosting a host `Session`, popup with start/stop and copy link, badge.
**Tests:** state-machine unit tests; Playwright: start produces a link, a
guest in the memory/fake-tracker network joins, stop ends the room.
**Result:** _pending_

## Step 2 — Overlay and SessionProxy

**Goal:** Whiteboard usable on the presenter's page.
**Deliverables:** content script, shadow-DOM overlay, Port relay,
`SessionProxy`, snapshot-on-attach, navigation re-attach, pointer pass-through,
restricted-page handling.
**Tests:** draw with each tool; reload and cross-origin navigate; page remains
clickable in pointer mode; restricted page message.
**Result:** _pending_

## Step 3 — Toolbar, people panel, controls

**Goal:** Full presenter UX.
**Deliverables:** ported toolbar, sticker chooser, people list, lock/remove/
new link, pause, hide overlay, shortcuts, remembered position.
**Tests:** lock drops viewer ops host-side; remove/new-link behaviour; hide
overlay does not stop sync.
**Result:** _pending_

## Step 4 — Options and permissions

**Goal:** Settings and the optional host permission flow.
**Deliverables:** options page, `storage.sync` schema with validation,
permission prompt, first-run consent panel.
**Tests:** invalid settings rejected; live video-parameter changes reach the
offscreen doc; permission-denied path keeps working (re-click to re-attach).
**Result:** _pending_

## Step 5 — Integrate video

Wire in `03_tab_streaming` (its steps 2–3), then run the combined e2e.
**Result:** _pending_

## Completion Criteria

- Presenter can start, draw, share a link, lock/remove viewers and stop,
  surviving page navigation.
- All tests pass in CI; manual checklist done on Chrome stable.
