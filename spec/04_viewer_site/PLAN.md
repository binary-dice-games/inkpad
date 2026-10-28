# 04_viewer_site — implementation plan

Design: [DESIGN.md](DESIGN.md). Depends on `01_core_features` steps 1–3.

## Step 1 — Shell, join flow and status handling

**Goal:** Page that joins a session and reports status.
**Deliverables:** landing page, fragment parsing, name/colour form, guest
session, status messages, manual-code fallback UI.
**Tests:** status mapping unit tests; e2e join against a host in the fake
tracker network; invalid token.
**Result:** Done, except the manual-code fallback UI. Landing page, name and
colour form (remembered in `localStorage`, with a guard for blocked storage),
join over the default trackers (or the ones in the link), friendly messages for
every session state and error (`viewer/src/model.ts`, unit tested), and an
end-to-end join in Chromium against the real extension.

## Step 2 — Video stage and aligned whiteboard

**Goal:** Video with whiteboard overlay aligned to it.
**Deliverables:** `<video>` stage, letterbox rectangle math, whiteboard
adapter, placeholders, fullscreen.
**Tests:** rectangle math across aspects/resizes; e2e alignment of a drawn item
with a known fixture frame position.
**Result:** Done. Video in a letterboxed stage, the whiteboard laid out on the
video's own aspect (the `stage` aspect before the first frame), placeholders for
waiting, paused and ended, full screen. Verified that the video follows the
tab's aspect; the position of a drawing against a known spot in the frame is not
tested.

## Step 3 — Toolbar, permissions, mobile

**Goal:** Full viewer interaction.
**Deliverables:** shared toolbar, drawing-disabled state, people list, touch
handling, quality hint, accessibility pass.
**Tests:** locked viewer cannot draw (and ops are rejected host-side);
mobile-emulation drawing e2e.
**Result:** Partly done. The package toolbar, the drawing-disabled state (tools
disabled and a message), a people count, and the whole presenter console panel
(kick, drawing, lock, pause, clear, end, wrong key falls back to a viewer) with
end-to-end tests. Not done: the viewers' list for plain viewers, the connection
quality hint, the touch and accessibility passes, a mobile-emulation test.

## Step 4 — Versioning and CSP

**Goal:** Safe, compatible hosting.
**Deliverables:** protocol-mismatch screen with versioned paths, CSP meta,
size-budget check.
**Tests:** mismatch e2e with a stub host reporting another `protocol`; CSP
violations fail the e2e run; size budget in CI.
**Result:** Partly done. Content security policy in a `<meta>` tag (no
violation on the viewer or the console in the end-to-end test) and a bundle of 68
KB (22.7 KB gzipped) checked against the 150 KB budget by a test. Not done: the
protocol-mismatch screen with versioned paths (needs the Pages deployment).

## Completion Criteria

- A viewer on desktop or phone can open a link, watch and draw, and sees clear
  messages for every failure state.
- Bundle within budget; deployed through the pipeline in `05`.
