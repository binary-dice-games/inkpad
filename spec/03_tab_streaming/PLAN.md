# 03_tab_streaming — implementation plan

Design: [DESIGN.md](DESIGN.md). Depends on `01_core_features` steps 1–2 and
`02_presenter_extension` step 1.

## Step 1 — Spike: overlay-free capture

**Goal:** Decide option A or B in DESIGN section 3, with data.
**Deliverables:** throwaway extension prototype, pixel-diff test, findings
appended to this plan (and DESIGN updated with the chosen option).
**Tests:** captured frames contain no overlay pixels; no flicker over a
60-second run on a scrolling page and a video page.
**Result:** _pending — gate: stop and consult the user if both fail._

## Step 2 — Capture to host session

**Goal:** Tab pixels flow into `session.setMedia`.
**Deliverables:** offscreen capture module, constraints from settings,
resolution-change handling and `stage` updates, 2 s refresh, pause/resume.
**Tests:** e2e frames reach a Playwright guest; resize updates `aspect`.
**Result:** _pending_

## Step 3 — Bitrate/fps control

**Goal:** Configurable low-fps stream.
**Deliverables:** sender parameter application (live), codec preferences,
content hint, bandwidth estimate in options page.
**Tests:** measured fps and bitrate within bounds for 3 presets (1, 3, 10 fps);
live change takes effect without reconnect.
**Result:** _pending_

## Step 4 — Multi-viewer load

**Goal:** Validate the ~10 viewer target.
**Deliverables:** soak test with 10 headless guests, CPU/uplink measurements
recorded in `docs/`, default tuning.
**Tests:** 10 guests for 5 minutes at defaults: no link drops, CPU of the
offscreen doc under an agreed ceiling (recorded in this step).
**Result:** _pending_

## Completion Criteria

- Viewers see the tab without overlay artifacts at the configured fps/bitrate.
- Pause/resume, resize and tab-close behave per DESIGN section 6.
