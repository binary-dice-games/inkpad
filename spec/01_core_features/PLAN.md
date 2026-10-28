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
**Result:** _pending_

## Step 2 — Copy and adapt `collab-session`

**Goal:** Session package with inkpad protocol and media hooks.
**Deliverables:** `packages/collab-session` with provenance header, `NOTICE`,
`.d.ts`; `inkpad=` fragment, protocol `inkpad/1`, `setMedia`, `mediaParams`,
guest `track` event, `recvonly` video transceiver; `packages/defaults`.
**Tests:** framing/seal/replay tests; host+guests over memory network and the
fake tracker; video track reaches guest in Chromium (Playwright); data link
survives video failure.
**Result:** _pending_

## Step 3 — Copy and adapt `collab-whiteboard`

**Goal:** Whiteboard with board units, emoticon stickers, host-enforced
permissions, snapshot on join.
**Deliverables:** `packages/collab-whiteboard`, `.d.ts`, `SessionProxy` helper,
sticker set, `perm` message, `accept` filter.
**Tests:** convergence under reordering/duplication; locked viewer ops are
dropped by the host; board-unit round-trips at several aspects; limits.
**Result:** _pending_

## Step 4 — Fake tracker and e2e harness

**Goal:** Deterministic multi-peer tests.
**Deliverables:** `tests/support/fake-tracker`, Playwright fixtures that load
the unpacked extension and open viewer contexts, `docs/manual-testing.md`.
**Tests:** harness self-test (two guests join, exchange `wb` ops).
**Result:** _pending_

## Completion Criteria

- Packages 2 and 3 pass unit and integration suites on all three OSes.
- `cmake --build` and `ctest` drive the whole JS toolchain.
- Projects 02–05 can start against stable package APIs.
