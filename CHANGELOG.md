# Changelog

All notable user-facing changes to inkpad are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Chrome extension for the presenter: share the active tab with a link, draw on it with
  an overlay (pen, text, stickers, emoticons), see and manage viewers (lock,
  remove, new link, pause), keep drawings across page loads, settings page.
- Serverless collaboration core: sessions over WebRTC with a low-frame-rate
  video track and a shared whiteboard (ink, text, stickers and emoticons),
  adapted from nymph.

### Removed

- The C++ `inkpad` library and executable; the project is now TypeScript.
