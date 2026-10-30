# 01_core_features — implementation plan

Design: [DESIGN.md](DESIGN.md). Follow the steps in order; update this plan
before diverging; record each step's result when done.

## Step 1 — Retire the C++ skeleton, set up the JS/TS workspace

**Goal:** Repo builds and tests through CMake with a TypeScript toolchain.
**Deliverables:** npm workspaces (`packages/*`, `extension`, `viewer`),
tsconfig, ESLint/Prettier, esbuild scripts, Vitest; top-level
`CMakeLists.txt` targets `extension`, `viewer`, `check`, `test` calling npm;
CI matrix updated; C++ dirs removed; `CLAUDE.md`, `README.md`,
`docs/building.md` updated (user approves the CLAUDE.md edit).
**Tests:** a trivial Vitest suite run via `ctest`; CI green on Linux, macOS,
Windows.
**Result:** Done. npm workspace (`packages/*`), strict TypeScript, ESLint,
Prettier, Vitest 3. C++ skeleton, `.clang-format` and the googletest submodule
removed. CMake (`LANGUAGES NONE`) installs npm dependencies on configure, has
a `check` target and registers tests through `inksplat_add_test` (ctest). The
`extension` and `viewer` targets are deferred to projects 02 and 04, which have
sources to build. CI runs on Linux, macOS and Windows. `CLAUDE.md`, README and
`docs/building.md` updated. Verified locally on Windows only; the Linux and macOS CI jobs have not run yet.

## Step 2 — Copy and adapt `collab-session`

**Goal:** Session package with inksplat protocol and media hooks.
**Deliverables:** `packages/collab-session` with provenance header, `NOTICE`,
`.d.ts`; `inksplat=` fragment, protocol `inksplat/1`, `setMedia`, `mediaParams`,
guest `track` event, `recvonly` video transceiver; `packages/defaults`.
**Tests:** framing/seal/replay tests; host+guests over memory network and the
fake tracker; video track reaches guest in Chromium (Playwright); data link
survives video failure.
**Result:** Done. Copied at nymph commit 13de939. Changes: `inksplat=`
fragment, `inksplat/1`, presenter wording, `MediaController` (`setMedia`,
`mediaParams` incl. codec preference, guest `track` event, guest `recvonly`
video transceiver added to every offer, host attaches its track before
answering). `packages/defaults` added. Verified in Chrome: real video frames
reach a viewer at a capped rate and the data link works with no video.

## Step 3 — Copy and adapt `collab-whiteboard`

**Goal:** Whiteboard with board units, emoticon stickers, host-enforced
permissions, snapshot on join.
**Deliverables:** `packages/collab-whiteboard`, `.d.ts`, `SessionProxy` helper,
sticker set, `perm` message, `accept` filter.
**Tests:** convergence under reordering/duplication; locked viewer ops are
dropped by the host; board-unit round-trips at several aspects; limits.
**Result:** Done. Board units (`FRAME_UNITS`, `letterbox`, `frameAdapter`),
eight emoticon stickers, `drawingGate` (host-side lock and rate limit; viewers
follow `stage.drawing`, so no `perm` message), `SessionProxy`
(`serveSessionProxy`/`connectSessionProxy`) and the board keeper (snapshot
for a re-attached overlay). Divergence from the plan: the keeper is new,
the `perm` message was dropped (see DESIGN section 4.2).

## Step 4 — Fake tracker and e2e harness

**Goal:** Deterministic multi-peer tests.
**Deliverables:** `tests/support/fake-tracker`, Playwright fixtures that load
the unpacked extension and open viewer contexts, `docs/manual-testing.md`.
**Tests:** harness self-test (two guests join, exchange `wb` ops).
**Result:** Done. `FakeTracker` (local WebTorrent tracker), a static file
server and Chrome launcher, `tests/e2e/webrtc.test.ts` (video, board in both
directions, viewer-to-viewer relay, tracker sees only sealed data) and
`docs/manual-testing.md`. Divergence: playwright-core drives an installed Chrome
instead of `@playwright/test` with a downloaded Chromium; the unpacked-extension
fixtures arrive with project 02.

## Completion Criteria

- Packages 2 and 3 pass unit and integration suites on all three OSes.
- `cmake --build` and `ctest` drive the whole JS toolchain.
- Projects 02–05 can start against stable package APIs.
