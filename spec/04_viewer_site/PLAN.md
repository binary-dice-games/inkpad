# 04_viewer_site — implementation plan

Design: [DESIGN.md](DESIGN.md). Depends on `01_core_features` steps 1–3.

## Step 1 — Shell, join flow and status handling

**Goal:** Page that joins a session and reports status.
**Deliverables:** landing page, fragment parsing, name/colour form, guest
session, status messages, manual-code fallback UI.
**Tests:** status mapping unit tests; e2e join against a host in the fake
tracker network; invalid token.
**Result:** _pending_

## Step 2 — Video stage and aligned whiteboard

**Goal:** Video with whiteboard overlay aligned to it.
**Deliverables:** `<video>` stage, letterbox rectangle math, whiteboard
adapter, placeholders, fullscreen.
**Tests:** rectangle math across aspects/resizes; e2e alignment of a drawn item
with a known fixture frame position.
**Result:** _pending_

## Step 3 — Toolbar, permissions, mobile

**Goal:** Full viewer interaction.
**Deliverables:** shared toolbar, drawing-disabled state, people list, touch
handling, quality hint, accessibility pass.
**Tests:** locked viewer cannot draw (and ops are rejected host-side);
mobile-emulation drawing e2e.
**Result:** _pending_

## Step 4 — Versioning and CSP

**Goal:** Safe, compatible hosting.
**Deliverables:** protocol-mismatch screen with versioned paths, CSP meta,
size-budget check.
**Tests:** mismatch e2e with a stub host reporting another `protocol`; CSP
violations fail the e2e run; size budget in CI.
**Result:** _pending_

## Completion Criteria

- A viewer on desktop or phone can open a link, watch and draw, and sees clear
  messages for every failure state.
- Bundle within budget; deployed through the pipeline in `05`.
