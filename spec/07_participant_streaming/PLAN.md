# 07_participant_streaming - plan

Design: `spec/07_participant_streaming/DESIGN.md`. Follow the steps in order; update this plan
before diverging from it and record each step's result when done.

## 1. Spike: forwarding encoded frames

**Goal:** prove (or rule out) DESIGN section 4.2 in Chrome before any product code: frames
received on one peer connection, written unchanged into the sender of another, decode at the
far end; switching sources on a key frame works; key frame requests reach the source.
**Deliverables:** a throwaway page under `tests/support/` (three peer connections in one page:
source, host, viewer); a short results note appended to this step: which API
(`RTCRtpScriptTransform`, `createEncodedStreams`), which placeholder track keeps the sender
running in a background tab, what metadata must be set, which key frame APIs work, and whether
VP9/AV1 survive forwarding. If a blocker appears, update DESIGN section 4.2 (fallback only, or a
different approach) before step 2.
**Tests:** `tests/e2e/relay-spike.test.ts` (Chrome): the viewer decodes frames of the source's
colour; after a switch to a second source it decodes the second colour with no corrupt frames;
added under `inksplat_add_test(... PROJECT e2e)`.
**Result:** done; the approach holds with these changes (DESIGN 4.2, 4.3): `RTCRtpScriptTransform`
accepts frames from another peer connection but never sends them, so the relay uses
`createEncodedStreams()`; the placeholder is a `MediaStreamTrackGenerator` (no track breaks
switches); each output's RTP timestamps are rewritten (without it one switch in two froze);
`generateKeyFrame()` is missing in Chrome 153, so key frames are forced by toggling the sender's
encoding, with retries. VP9 and AV1 were not tried: forwarding uses VP8. The page is
`tests/e2e/pages/relay-spike.html`, kept with its test as a check of the browser.

## 2. Stage, backgrounds and the `screen` channel

**Goal:** the data model of DESIGN sections 3.4, 3.5 and 5 without any video change.
**Deliverables:** `packages/defaults`: `screen` background (replaces `video`; `video` read as
`screen`), `Stage.screen`, `video`/`paused` removed, `STAGE_ASPECT`, new defaults; `screen`
message types and `cleanScreenMessage`; board files read `video` as `screen`.
**Tests:** `tests/unit/defaults.test.ts` and `tests/unit/board-archive.test.ts` extended: cleaning,
defaults, old values mapped.
**Result:** done. `video` of stages and board files is read as `screen`; the `paused` state is
refused (None replaces it).

## 3. Uplink transceiver in the session

**Goal:** guests can send video to the host without renegotiation (DESIGN 4.1); protocol
`inksplat/2`.
**Deliverables:** `MediaController` changes in `collab-session.js` (header records them): second
video transceiver in guest offers, host answers it `recvonly`; `setUplink`, `uplinkParams`,
host `uplink` event; `collab-session.d.ts` with TSDoc.
**Tests:** `tests/e2e/session-uplink.test.ts` (Chrome, fake tracker): a guest's canvas stream
arrives at the host with the guest's id; `active: false` stops it; `setUplink(null)` ends it; a
`inksplat/1` peer is refused.
**Result:** done, with step 4 (one `MediaController`). The session API differs from the
design's first draft (no `uplink` event; `uplink(peerId)` and `uplinkParams(peerId, ...)`), see
DESIGN section 6. The `inksplat/1` refusal is the existing protocol check, not a new test.
Tests: `tests/e2e/streams.test.ts`.

## 4. Relay in the session and `viewer/src/relay.ts`

**Goal:** the host forwards the active stream's encoded frames to every downlink (DESIGN 4.2,
4.3), with the re-encode fallback.
**Deliverables:** encoded-transform hooks in `MediaController`; `viewer/src/relay.ts` and its
worker (forwarding, key frame gating on switch, request coalescing, per-link mode and log line);
`setRelay`, `requestKeyFrame`, `keyframe-request`; option `encodedTransforms`.
**Tests:** `tests/unit/relay.test.ts` (fake frames: fan-out except the source, drop until key
frame, coalescing at 500 ms, mode choice); `tests/e2e/relay.test.ts` (host + two guests: forward
and forced re-encode both deliver; late joiner gets a picture; local/relay switch).
**Result:** done. `FrameRouter` lives in `collab-session.js` (exported), not in
`viewer/src/relay.ts`, see DESIGN section 6; there is no `requestKeyFrame` API or
`keyframe-request` event: key frames are asked with the `key` control message and losses are
read from stats (DESIGN 4.3). Tests: `tests/unit/relay.test.ts`, `tests/e2e/streams.test.ts`.

## 5. ShareHost: streams, preview, active

**Goal:** the host's state and rules of DESIGN 3.3 and 5.3.
**Deliverables:** `ShareHost` streams list, `preview`/`show`/`none` commands, auto-active for the
host's own stream, withdraw on leave and removal, `send` messages with the host's media params,
accept filter for `screen`, stage `screen` field; Pause and Share again removed.
**Tests:** `tests/unit/share-host.test.ts` extended: every transition of the table in DESIGN 5.3,
the accept filter refusing forged or malformed `screen` messages, stage contents.
**Result:** done. **Show** on the previewed stream ends its preview (found by the end-to-end
test).

## 6. Share button and owner status (both pages)

**Goal:** anyone can start and stop sharing at any time (DESIGN 3.2, 3.6).
**Deliverables:** `viewer/src/share-button.ts` used by `present.ts` and `main.ts`: button,
one-time notice, picker, surface warning, owner status from the stage, local view of one's own
active stream, hidden without `getDisplayMedia`.
**Tests:** `tests/unit/share-button.test.ts` (status text from stage and own id, hidden without
the API); e2e in step 8.
**Result:** done. Viewers close their session on `pagehide`, so a stream on the screen goes
black at once when its owner closes the tab.

## 7. Pages: start page, Screen panel, screen background

**Goal:** the UI of DESIGN 3.1, 3.3, 3.4.
**Deliverables:** `present.html`/`present.ts`: single **Start session**, Screen section (rows,
Preview, Show, None, preview video, "show the screen on this canvas"), toasts for new offers;
`sheet.ts` and both pages: `screen` background (letterboxed video on black, fixed aspect);
Save as PNG/SVG of a screen canvas.
**Tests:** `tests/e2e/present.test.ts` updated (the start page has one start action; the
removed buttons are gone); `tests/unit/sheet.test.ts` for the letterbox inside the fixed frame.
**Result:** done. The board tests of `present.test.ts` pick the whiteboard for canvas 1 first
(`PresenterSite.startBoard`), since canvas 1 now shows the black screen; the frame adapter now
zooms `#zoom` (the screen and the sheet) instead of the video alone.

## 8. End-to-end and docs

**Goal:** the whole feature in the built site, and the docs brought up to date.
**Deliverables:** `tests/e2e/participant-streaming.test.ts` (DESIGN section 10 browser cases,
including the latency comparison); `docs/manual-testing.md` checklist items; README "How it
works" and "Using the board" sections; `spec/06_static_presenter/DESIGN.md` pointers to this
project where it is superseded; CHANGELOG entries; `spec/INDEX.md` status.
**Tests:** the new e2e file; the whole suite green on Linux, macOS and Windows CI.
**Result:** done, except the automated latency comparison (manual checklist item 72 instead,
see DESIGN section 10). CI on macOS and Windows not run from here; the suite passes on Linux
(36 ctest entries).

## Completion Criteria

- Any participant on desktop can start and stop sharing at any time; the host previews, shows
  and switches streams or shows none; the screen background shows the active stream or black.
- Guests send only to the host and only when asked; the host forwards encoded frames without
  decoding them (re-encode only as a logged fallback).
- The start page has a single start action.
- All tests above pass in CI; the manual checklist items are done on at least Chrome.
