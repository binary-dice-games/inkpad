# 03_tab_streaming — implementation plan

Design: [DESIGN.md](DESIGN.md). Depends on `01_core_features` steps 1–2 and
`02_presenter_extension` step 1.

## Step 1 — Spike: overlay-free capture

**Goal:** Decide option A or B in DESIGN section 3, with data.
**Deliverables:** throwaway extension prototype, pixel-diff test, findings
appended to this plan (and DESIGN updated with the chosen option).
**Tests:** captured frames contain no overlay pixels; no flicker over a
60-second run on a scrolling page and a video page.
**Result:** Spike run (`spikes/capture-overlay/`, Playwright Chromium, headless,
1280x720). Neither option passed the "no flicker" test, so the gate was reached
and the design changed: **no overlay on the page, the presenter draws in a
console window** (DESIGN section 3). Measurements:

- Baseline: the overlay is in 100% of captured frames (86/86). Confirmed.
- **Option A (Element Capture) is not available.** A track from
  `getUserMedia({chromeMediaSource: 'tab'})` has neither `restrictTo` nor
  `cropTo`. Even if it had, a `RestrictionTarget` cannot be sent from the page
  to the offscreen document over `chrome.runtime` messaging (it is only
  structured-cloneable), so the capture would have to live in the page.
- **Option B (hide on capture) works functionally:** 60/60 cycles at 3 Hz got a
  frame with the overlay hidden (identified by a marker block), 0 frames with
  the overlay leaking. But the overlay is hidden a median 34 ms (p95 76 ms,
  max 77 ms) per captured frame, about 10% of the time at 3 fps, and it grows
  with the frame rate. That is a visible 3 Hz blink for the presenter.
- Hiding for a single display frame instead is unreliable: only 5 of 18 cycles
  caught the hidden frame, because the capture runs at its own cadence. About
  one capture interval (~33 ms) of hiding is inherent.
- Tab capture without size constraints delivers a cropped 800x600 frame. With
  `maxWidth`/`maxHeight` set to a fit of the tab inside the limit (same aspect,
  no upscaling) the frame has the tab's own aspect (1000x700, 480x720 and
  1280x720 verified). The constraints must follow the tab size and be
  re-applied on resize.
- `--allowlisted-extension-id` lets automation capture without the activeTab
  click, so capture can be tested in CI.
- The headless frame timing is not a real display's.
- A captured tab stays `visible` and keeps producing frames with another tab in
  front (168 against 167 frames in 6 s).

## Step 2 — Capture to host session

**Goal:** Tab pixels flow into `session.setMedia`.
**Deliverables:** offscreen capture module, constraints from settings,
resolution-change handling and `stage` updates, 2 s refresh, pause/resume.
**Tests:** e2e frames reach a Playwright guest; resize updates `aspect`.
**Result:** Done (`extension/src/capture.ts`). The tab is captured with
constraints that follow its shape, relayed through a canvas (exact frame rate,
downscale, a still page repeats its last frame about once a second so a late
joiner gets a picture), and sent with `session.setMedia`. Verified in Chromium
with real tab capture: the viewer's video shows the page (bright, not black) at
the tab's own aspect and has no drawing pixels in it (with a control that a
coloured box in the page does show up). **Resize:** Chrome ignores
`applyConstraints` on a running tab capture and refuses a second capture of a
tab that is still captured, so a resize stops the capture and starts a new one
with a fresh id (the output stream stays, so viewers do not renegotiate; the last
frame shows for a moment). Tested by sending the resize message; the real
window-resize path (`windows.onBoundsChanged`) cannot be driven in headless
automation and is untested. After a cross-origin navigation `activeTab` is gone,
no new id is available and the capture keeps its old shape.

## Step 3 — Bitrate/fps control

**Goal:** Configurable low-fps stream.
**Deliverables:** sender parameter application (live), codec preferences,
content hint, bandwidth estimate in options page.
**Tests:** measured fps and bitrate within bounds for 3 presets (1, 3, 10 fps);
live change takes effect without reconnect.
**Result:** Partly done. Sender parameters (frame rate, bitrate, content hint,
codec preference VP9, H.264, VP8) are applied from the settings when the share
starts. Measured in Chromium: with 5 fps configured and a page changing 25 times
a second the viewer gets between 2 and 6.5 fps. Not done: a bitrate
measurement, the 1 and 10 fps presets, changing the settings during a share, and
the bandwidth estimate beyond the one on the options page.

## Step 4 — Multi-viewer load

**Goal:** Validate the ~10 viewer target.
**Deliverables:** soak test with 10 headless guests, CPU/uplink measurements
recorded in `docs/`, default tuning.
**Tests:** 10 guests for 5 minutes at defaults: no link drops, CPU of the
offscreen doc under an agreed ceiling (recorded in this step).
**Result:** _pending_ (not started: the 10-viewer soak test).

## Completion Criteria

- Viewers see the tab without overlay artifacts at the configured fps/bitrate.
- Pause/resume, resize and tab-close behave per DESIGN section 6.
