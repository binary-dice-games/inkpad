# inkpad

inkpad is a Chrome extension that turns the active tab into a shared
whiteboard. The presenter draws on an overlay; viewers open a link (no
extension needed), watch a low-frame-rate WebRTC video of the tab, and draw on
the same board. There is no server: peers find each other through public
WebTorrent trackers with sealed offers, and the board is a layer of data on top
of the video, not part of it. The collab code is copied (not referenced) from
[nymph](https://github.com/binary-dice-games/nymph) and adapted.

**Status:** the collab core is implemented (`spec/01_core_features`): serverless
sessions with video, the whiteboard, the session proxy and board keeper. The
extension, tab streaming, viewer site and release pipeline are specified, not
built yet. See [spec/INDEX.md](spec/INDEX.md).

## Build and test

```
cmake -S . -B build                       # installs npm dependencies on first run
cmake --build build --target check        # lint, typecheck, format check
ctest --test-dir build -C Debug --output-on-failure --parallel
```

Needs Node.js 20+; the browser tests need Chrome. Details in
[docs/building.md](docs/building.md).

## Layout

| Path | Contents |
|------|----------|
| `packages/collab-session/` | Serverless WebRTC rooms and video, session proxy |
| `packages/collab-whiteboard/` | Whiteboard overlay, board keeper |
| `packages/defaults/` | Trackers, ICE servers, video presets, `stage` message, invite links |
| `tests/` | Vitest unit tests, Chrome WebRTC tests, fake tracker |
| `cmake/` | CMake modules (Node discovery, `inkpad_add_test`) |
| `spec/` | Design and plan documents, one folder per project |
| `docs/` | User and developer documentation |

## Further Documentation

| File | Contents |
|------|----------|
| [docs/building.md](docs/building.md) | Prerequisites, build, check and test |
| [docs/manual-testing.md](docs/manual-testing.md) | Release checklist for real networks |
| [spec/INDEX.md](spec/INDEX.md) | Index of the project specifications |
| [NOTICE](NOTICE) | Code copied from nymph |
| [CHANGELOG.md](CHANGELOG.md) | User-facing changes |

# MIT License © 2026 Carlos Lopez
