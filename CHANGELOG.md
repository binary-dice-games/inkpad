# Changelog

All notable user-facing changes to inkpad are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Numbered tool shortcuts: 1 pointer, 2 line, 3 text, 4 stickers, 5 eraser, 6 colour. Pressing a number again goes through the options of that tool (line: thin, normal, thick; text: small, medium, large; each sticker; each colour); the toolbar shows the option in use. `0` resets the zoom.
- Drag your own lines, text, stickers and images to move them; right click removes them. Stickers and images scale with Shift+drag and turn with Ctrl (or Alt)+drag.
- Zoom with the mouse wheel at the pointer (and move with the middle button, or by dragging when zoomed in); the drawings stay where they are on the video.
- Drop an image file on the board to add it as a drawing item.
- Other people's cursors take the shape of their active tool; an optional avatar (set in the join form or the presenter settings) replaces the name on the cursor.
- Turn queue in the lower left corner: ask for a turn, end it or leave the queue; the queue shows name and avatar on each person's colour, and the cursor of whoever has the turn is larger and ringed. The presenter can remove anyone.
- Setting for how long the viewer link stays valid on the trackers (one hour by default, 0 for no limit); a **New link** button in the controls renews it.

- Presenter page on the viewer site (`present.html`): start a session and choose what to share with the browser's picker (a tab, a window,
  a whole screen, native applications included). The page is presenter and
  console in one: draw over the live preview, copy the viewer link, and manage
  viewers (remove, lock, pause, clear, end). The mouse pointer can be hidden in the
  shared video; a Settings dialog sets name, colour, video limits, trackers and
  STUN/TURN servers; the tools and the controls panel can be folded away.
- Viewer page: join a link, watch the shared tab and draw on it (pen, text,
  stickers, emoticons), and fold the toolbar away. See who is here and how the
  connection goes; join with a code when the network blocks the trackers (the
  presenter pastes it under "Join codes" in the controls).
- Serverless collaboration core: sessions over WebRTC with a low-frame-rate
  video track and a shared whiteboard (ink, text, stickers and emoticons),
  adapted from nymph.

- Privacy policy page on the viewer site.

### Fixed

- Blurry video: the shared tab is now sent at the screen's own resolution (HiDPI included, up
  to 4K) instead of being shrunk to 1280x720, and AV1 or H.264 is used instead of VP8, so
  text is sharp as soon as the page stops moving. The default bitrate cap is 1500 kbps.
- Viewers and the console could not connect through the public trackers (only join codes
  worked): offers were too large for the trackers. They are now compressed.

- Connection diagnostics: the extension's offscreen page and the viewer write one line per
  step of making a connection to the browser console, prefixed `[inkpad]`.

### Removed

- The C++ `inkpad` library and executable; the project is now TypeScript.
