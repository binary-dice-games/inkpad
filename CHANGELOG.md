# Changelog

All notable user-facing changes to inkpad are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Chrome extension for the presenter: share the active tab (a few frames per
  second, configurable) with a viewer link, and open the presenter console in a
  window of its own to draw on the video and manage the session (kick, lock,
  pause, clear, end). Nothing is added to the shared page. Settings page.
- Viewer page: join a link, watch the shared tab and draw on it (pen, text,
  stickers, emoticons); with the presenter key it is the presenter console. See
  who is here and how the connection goes; join with a code when the network
  blocks the trackers (the presenter pastes it under "Join codes" in the popup).
- Serverless collaboration core: sessions over WebRTC with a low-frame-rate
  video track and a shared whiteboard (ink, text, stickers and emoticons),
  adapted from nymph.

- Privacy policy page on the viewer site.

### Fixed

- Viewers and the console could not connect through the public trackers (only join codes
  worked): offers were too large for the trackers. They are now compressed.

- Connection diagnostics: the extension's offscreen page and the viewer write one line per
  step of making a connection to the browser console, prefixed `[inkpad]`.

### Removed

- The C++ `inkpad` library and executable; the project is now TypeScript.
