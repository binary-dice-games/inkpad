# 03_tab_streaming — tab capture and low-fps WebRTC video

Builds on `spec/01_core_features/DESIGN.md` (session, star topology, media
hooks in 4.1) and `spec/02_presenter_extension/DESIGN.md` (offscreen document).

## 1. Purpose and scope

Capture the shared tab's pixels and deliver them to viewers as a WebRTC video
track. The video is only a **background**: low frame rate, modest bitrate,
configurable. Drawings are not in it.

Out of scope: audio (v1), recording, simulcast/SFU, adaptive per-viewer quality
beyond what WebRTC does natively.

## 2. Capture

Chosen: `chrome.tabCapture` (design session answer), no picker.

1. Service worker calls `chrome.tabCapture.getMediaStreamId({targetTabId})`
   from a user gesture.
2. Offscreen document calls `getUserMedia({video: {mandatory:
   {chromeMediaSource:'tab', chromeMediaSourceId: id, maxFrameRate: fps,
   maxWidth, maxHeight}}})`.
3. The `MediaStream` is handed to `session.setMedia()`.

Tab capture mutes local tab audio unless re-routed; since v1 has no audio, the
tab is captured with `audio:false`, which leaves the presenter's sound alone.
Capture keeps working across navigations of the same tab. Resolution follows
the tab's viewport size and changes when the presenter resizes the window; the
`stage` message carries the new `aspect`.

## 3. The overlay-in-video problem (key risk)

`tabCapture` records the rendered tab, **including our injected overlay**. If
unhandled, viewers would see the presenter's drawings twice (once in the video,
once from their own whiteboard layer, offset by video latency) plus the toolbar.

Candidate solutions, in preference order, decided by a **spike (plan step 1)**:

| Option | How | Pros / cons |
|---|---|---|
| A. Element Capture | Overlay lives outside `<body>` (as a child of `<html>`); the captured track is restricted to `document.body` with `RestrictionTarget`/`restrictTo()` | Exact: overlay never in pixels. Needs the capture track in the page context and a recent Chrome; `body` must cover the viewport (we force `min-height:100vh` via adopted style only if absent) and fixed/popup content outside body is lost |
| B. Hide-on-capture | Overlay layer is drawn at near-zero opacity changes only when frames are grabbed (frame-by-frame via `ImageCapture`/`MediaStreamTrackProcessor` with the overlay hidden for that paint) | Works on any page; costs a flicker risk and more CPU |
| C. Visual masking | Presenter-side overlay is rendered but video is composited to hide it (not possible without access to pixels) | Rejected |
| D. Accept duplication | Presenter's drawing is part of the video, viewers hide *presenter-authored* items | Rejected: breaks interaction and alignment |

Gate: if neither A nor B passes the spike (no overlay pixels in captured frames
on a pixel-diff test, no visible flicker), **stop and revise this design** with
the user before building anything on top (the fallback is a fallback to a
region/element-based capture UX).

## 4. Encoding and bandwidth

Defaults and bounds live in `packages/defaults` and the options page.

| Parameter | Default | Range | Applied via |
|---|---|---|---|
| Frame rate | 3 fps | 0.5–15 | `maxFrameRate` on capture + sender `maxFramerate` |
| Max resolution | 1280×720 (never upscale) | 640×360–1920×1080 | capture constraints + `scaleResolutionDownBy` |
| Max bitrate | 600 kbps | 100–3000 | `RTCRtpSender.setParameters().encodings[0].maxBitrate` |
| Content hint | `detail` | `detail`/`text`/`motion` | `track.contentHint` |

Notes:

- `contentHint = 'detail'` and `degradationPreference =
  'maintain-resolution'` keep text legible at low fps.
- A static page produces almost no frames; Chrome may stop delivering. The
  offscreen doc forces a keyframe-bearing refresh at least every 2 s so late
  joiners and recovering links get a picture (`requestFrame` via a canvas
  `captureStream(0)` relay if needed).
- Codec preference order: AV1 (if hardware/screen-content support), VP9, H.264,
  VP8, set with `setCodecPreferences`. Decided by spike data; default VP9.
- Budget rule of thumb: uplink = viewers × bitrate, so 10 viewers at 600 kbps ≈
  6 Mbps. The options page shows this estimate live and warns above ~4 Mbps.
- Pause: `track.enabled=false` / replace sender track with `null`; `stage.state`
  becomes `paused` so viewers show "presenter paused" rather than a frozen
  frame. Resume restores and requests a keyframe.

## 5. Viewer-side contract

Viewers receive a `MediaStream` through `session.on('track')` and attach it to
a muted `<video playsinline>`. Presentation rules (implemented in
`spec/04_viewer_site`): letterbox with `object-fit: contain`; the whiteboard
adapter maps board units to the displayed video rectangle; on a `stage.aspect`
change the rectangle is recomputed.

## 6. Failure behaviour

- Capture ends (tab closed, `track.onended`): share ends, `stage.state=ended`.
- Per-viewer congestion: WebRTC lowers bitrate/fps itself; the host does not
  disconnect slow viewers. Data channels are independent of video.
- Viewer without video yet: whiteboard still works over a blank background with
  a "waiting for presenter video" message.

## 7. Testing

- Spike harness with pixel-diff (frames with and without overlay).
- Playwright e2e: fixture page animating a counter; viewer asserts frames
  arrive and fps is within configured bounds (±1) using
  `getStats()` (`framesPerSecond`, `bytesSent`).
- Bitrate cap test: measured outbound bitrate ≤ cap + 20%.
- Pause/resume and resize tests assert `stage` transitions.
