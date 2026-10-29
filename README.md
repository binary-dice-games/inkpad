# inkpad

inkpad is a Chrome extension that turns the active tab into a shared
whiteboard. The presenter shares a tab and draws in a console window; viewers
open a link (no extension needed), watch a low-frame-rate WebRTC video of the
tab, and draw on the same board. There is no server: peers find each other through public
WebTorrent trackers with sealed offers, and the board is a layer of data on top
of the video, not part of it. The collab code is copied (not referenced) from
[nymph](https://github.com/binary-dice-games/nymph) and adapted.

**Status:** working end to end on Chromium: the collab core, the presenter
extension with tab streaming and the console, the viewer app, and the scripts and
workflows for the Pages site and releases (CI passes on Linux, macOS and Windows; the Pages and release workflows have not run yet). Not
done: tests on real phones and other browsers, the load test with many viewers, a
clear message for a version mismatch. See [spec/INDEX.md](spec/INDEX.md).

**How it works.** The extension captures the tab and hosts the session; it adds
nothing to the page, because tab capture would record it. The presenter draws in
the console, so they draw on a copy of the page that is a moment behind.

## Build and test

```
cmake -S . -B build                       # installs npm dependencies on first run
cmake --build build --target check        # lint, typecheck, format check
cmake --build build --target extension    # unpacked extension in extension/dist
cmake --build build --target viewer       # the viewer for GitHub Pages in viewer/dist
ctest --test-dir build -C Debug --output-on-failure --parallel
```

Needs Node.js 20+; the browser tests need Chrome. Details in
[docs/building.md](docs/building.md).

## Layout

| Path | Contents |
|------|----------|
| `packages/collab-session/` | Serverless WebRTC rooms and video |
| `packages/collab-whiteboard/` | Whiteboard, board keeper |
| `extension/` | The Chrome extension (capture, session host, popup, options) |
| `viewer/` | The viewer app, also the presenter console |
| `packages/defaults/` | Trackers, ICE servers, video presets, `stage` and `ctl` messages, invite links |
| `tests/` | Vitest unit tests, Chrome WebRTC tests, fake tracker |
| `cmake/` | CMake modules (Node discovery, `inkpad_add_test`) |
| `spec/` | Design and plan documents, one folder per project |
| `docs/` | User and developer documentation |

## Further Documentation

| File | Contents |
|------|----------|
| [docs/building.md](docs/building.md) | Prerequisites, build, check and test |
| [docs/testing.md](docs/testing.md) | How to run the tests, how the browser tests work, how to try the extension by hand |
| [docs/manual-testing.md](docs/manual-testing.md) | Release checklist for real networks |
| [docs/publishing.md](docs/publishing.md) | Making a release, the Pages site, the Web Store listing and permissions |
| [docs/privacy.md](docs/privacy.md) | Where the privacy policy lives, in short |
| [spec/INDEX.md](spec/INDEX.md) | Index of the project specifications |
| [NOTICE](NOTICE) | Code copied from nymph |
| [CHANGELOG.md](CHANGELOG.md) | User-facing changes |

# MIT License © 2026 Carlos Lopez
