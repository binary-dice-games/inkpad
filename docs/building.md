# inkpad — Building

inkpad is TypeScript/JavaScript. CMake is the entry point and calls npm.
It runs on **Linux, macOS and Windows**.

## Prerequisites

| Tool | Minimum version | Notes |
|------|----------------|-------|
| Node.js | 20 | with npm |
| CMake | 3.14 | entry point for check and test |
| Google Chrome | recent | only for the browser tests in `tests/e2e/` |

Configuring runs `npm ci` (or `npm install` without a lock file) when
`node_modules/` is missing.

## Build, check and test

```
cmake -S . -B build
cmake --build build --target check        # lint, typecheck, format check
ctest --test-dir build -C Debug --output-on-failure --parallel
```

`-C Debug` matters with multi-config generators (Visual Studio, Xcode).

Without CMake, from the repository root:

```
npm run check          # eslint, tsc, prettier --check
npm test               # unit tests (Vitest, project "unit")
npm run test:e2e       # browser tests (project "e2e"), needs Chrome
```

## Options

| Option | Default | Meaning |
|--------|---------|---------|
| `INKPAD_BUILD_TESTS` | ON when top level | Register the tests with ctest |

| Environment variable | Meaning |
|----------------------|---------|
| `INKPAD_CHROME` | Path of the Chrome executable for the browser tests (otherwise standard install paths, then Playwright's `chrome` channel) |

## Layout

| Path | Contents |
|------|----------|
| `packages/collab-session/` | Serverless WebRTC rooms and video (copied from nymph, adapted) and the session proxy |
| `packages/collab-whiteboard/` | Whiteboard overlay (copied from nymph, adapted) and the board keeper |
| `packages/defaults/` | Trackers, ICE servers, video presets, `stage` message, invite links |
| `tests/unit/` | Vitest unit and integration tests (memory network) |
| `tests/e2e/` | Chrome tests: real WebRTC through a local fake tracker |
| `tests/support/` | Fake tracker, browser launcher, room helpers |

The extension (`extension/`) and the viewer (`viewer/`) are added by projects
`02_presenter_extension` and `04_viewer_site`.

## Tests never use the network

Browser tests start `FakeTracker` (a local WebTorrent tracker) and serve the
packages from a loopback HTTP server. Real NATs, public trackers and TURN are
a manual check: see [manual-testing.md](manual-testing.md).
