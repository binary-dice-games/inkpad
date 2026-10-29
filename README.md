# inkpad

inkpad turns a shared tab, window or screen into a shared whiteboard. The
presenter opens the presenter page, picks what to share with the browser's own
picker (so native applications work too) and draws in the same window; viewers
open a link (nothing to install), watch a low-frame-rate WebRTC video of it, and
draw on the same board. There is no server: the site is static, peers find each
other through public WebTorrent trackers with sealed offers, and the board is a
layer of data on top of the video, not part of it. The collab code is copied (not
referenced) from [nymph](https://github.com/binary-dice-games/nymph) and adapted.

**Status:** working end to end on Chromium: the collab core, the presenter page,
the viewer app, and the scripts and workflows for the Pages site (CI passes on
Linux, macOS and Windows; the Pages workflow has not run yet). Not done: tests on
real phones and other browsers, the load test with many viewers, a clear message
for a version mismatch. See [spec/INDEX.md](spec/INDEX.md).

**How it works.** The **presenter page** (`present.html`) is host and console in
one: **Start sharing** opens the picker (a tab, a window or a whole screen), the
page shows what is shared with the whiteboard on top, and gives the viewer link.
Nothing is drawn on the shared surface itself, because capture would record it:
the presenter draws on a live copy next to it. Viewers open the link on the
viewer page (`index.html`). Both are served from GitHub Pages
(`spec/06_static_presenter`). There used to be a Chrome extension; it was removed
because the page does the same and more.

## Using the board

Keys 1-6 pick the tool (1 pointer, 2 line, 3 text, 4 sticker, 5 eraser, 6 colour); pressing the
same number again goes through its options. Drag your own items to move them, right click to
remove them; stickers and images scale with Shift+drag and turn with Ctrl+drag. The wheel zooms
at the pointer (0 resets), and image files can be dropped on the board. **Ask for a turn** (lower
left) queues you to speak; the presenter can remove anyone.

## Build and test

```
cmake -S . -B build                       # installs npm dependencies on first run
cmake --build build --target check        # lint, typecheck, format check
cmake --build build --target site         # the whole Pages site in site/
ctest --test-dir build -C Debug --output-on-failure --parallel
```

Needs Node.js 20+; the browser tests need Chrome. Details in
[docs/building.md](docs/building.md).

## Layout

| Path | Contents |
|------|----------|
| `packages/collab-session/` | Serverless WebRTC rooms and video |
| `packages/collab-whiteboard/` | Whiteboard |
| `viewer/` | The viewer app (`main.ts`) and the presenter page (`present.ts`, `share-host.ts`) |
| `packages/defaults/` | Trackers, ICE servers, video presets, `stage` message, invite links |
| `tests/` | Vitest unit tests, Chrome WebRTC tests, fake tracker |
| `cmake/` | CMake modules (Node discovery, `inkpad_add_test`) |
| `spec/` | Design and plan documents, one folder per project |
| `docs/` | User and developer documentation |

## Further Documentation

| File | Contents |
|------|----------|
| [docs/building.md](docs/building.md) | Prerequisites, build, check and test |
| [docs/testing.md](docs/testing.md) | How to run the tests, how the browser tests work, how to try the presenter page by hand |
| [docs/manual-testing.md](docs/manual-testing.md) | Checklist for real networks and the real picker |
| [docs/publishing.md](docs/publishing.md) | Publishing the Pages site |
| [docs/privacy.md](docs/privacy.md) | Where the privacy policy lives, in short |
| [spec/INDEX.md](spec/INDEX.md) | Index of the project specifications |
| [NOTICE](NOTICE) | Code copied from nymph |
| [CHANGELOG.md](CHANGELOG.md) | User-facing changes |

# MIT License © 2026 Carlos Lopez
