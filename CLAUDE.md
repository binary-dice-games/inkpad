# Documentation & Project Files Maintenance

## README.md — keep it concise

`README.md` is the first file agents read each conversation: a quick overview,
core build commands, and links to `docs/` for details. **Do not inline long
how-to content into README.md.**

- Keep it under ~200 lines.
- Detailed setup belongs in `docs/building.md`.
- When you add or change a feature, update the relevant section in
  `README.md` (or the relevant `docs/` file). Do not leave stale content.
- If you add a new `docs/` file, add a row for it in the "Further
  Documentation" table in `README.md`.

## CHANGELOG.md — user-facing change log

After completing any task that changes code, add an entry under
`## [Unreleased]` in `CHANGELOG.md`.

- Keep entries very brief: *what* was done, not *how* or *why*.
- Record only changes that affect users (public API, CLI, build outputs,
  runtime behavior). Not internal refactors, test-only or docs-only changes.
- Group under `### Added`, `### Changed`, `### Fixed`, `### Deprecated`,
  `### Removed`, following [Keep a Changelog](https://keepachangelog.com/).

## Code documentation

Keep brief doc comments (JSDoc/TSDoc) on public APIs, classes and module contracts:
intent, parameters, return values, failure modes.

## spec/ — project specifications

Design and plan documents live in `spec/`, one folder per project, never next
to the code. A project is a coherent piece of work with its own design and plan.

```
spec/
  INDEX.md                 one row per project: status, summary, topics
  01_core_features/
    DESIGN.md
    PLAN.md
  02_<descriptive_name>/
```

- **Folder names:** two-digit number in start order, underscore, short
  snake_case description. Never renumber or rename an existing folder.
- **`spec/INDEX.md`:** one row per project: folder, status, one-sentence
  summary, topics. Keep it short enough to read in full.
- **Which files to read:** `spec/INDEX.md` first, then only the folder of the
  project you work on plus folders whose topics match the code you change.
- **A new project:** create the next-numbered folder when the user asks for a
  design or plan for new work. Its `DESIGN.md` links to earlier projects'
  documents rather than copying them.
- **Links:** cite files by path, e.g. `spec/01_core_features/DESIGN.md section 3`.

### DESIGN.md — project architecture

Purpose and scope, key abstractions, public API contract, and the *why*
behind non-obvious decisions. Do not restate what the code says.
Read it before changing code it covers; update it after any change to the
architecture or public API. Create it only when asked (the `/design` skill
runs an interactive design session).

### PLAN.md — implementation plan

An intro pointing to `DESIGN.md`, then numbered steps, each with **Goal**,
**Deliverables** and **Tests**, ending with **Completion Criteria**. Follow the
steps in order; update the plan *before* diverging from it; record each
step's result when done. Create it only when asked.

## Startup reading

At the start of every conversation read `README.md` and `spec/INDEX.md`. For
task-specific details read that `spec/` folder, the relevant `docs/` file and
the in-code documentation.

## Tests

Always write automated tests for new or modified behavior. Add a test with
`inkpad_add_test(<name> <test file>)` in `tests/CMakeLists.txt`.

# inkpad Coding Style Guide

## General

- Match the style of nearby files first; keep changes minimal and focused.
- Preserve existing public API names and behavior unless asked.
- Prefer readable, explicit code. Use ASCII by default.

## TypeScript / JavaScript Style

- Code is TypeScript (strict) except the files copied from nymph and the small
  shared packages that ship as plain JS with `.d.ts` files. Prettier
  (`.prettierrc.json`) and ESLint (`eslint.config.js`) are authoritative:
  2-space indent, single quotes, trailing commas, sorted imports by hand.
- Start files with `// MIT License © 2026 Carlos Lopez` (copied files keep
  their upstream header plus a provenance note).
- Add `@file` doc comments to modules and JSDoc/TSDoc to public APIs: intent,
  parameters, return value, failure modes (`@throws`).
- `camelCase` functions and variables, `PascalCase` types and classes,
  `UPPER_SNAKE` constants. Prefer `undefined`/`null` results and discriminated
  unions over sentinel values; throw `Error` subclasses with a stable `reason`.
- No polling of shared state without a bounded timeout; use events or
  promises. Keep async critical sections short.
- Files under `packages/collab-session/collab-session.js` and
  `packages/collab-whiteboard/collab-whiteboard.js` are copies of nymph code
  (see `NOTICE`): change them only for inkpad needs, record the change in the
  header, keep them excluded from Prettier/ESLint.

## Platform Support

Targets **Linux, macOS and Windows**; CI builds and tests each
(`.github/workflows/ci.yml`). Node 20+ and npm are required; the browser tests
need Chrome (set `INKPAD_CHROME` to its path if it is not in a standard
location). Use `node:path`, never hard-coded separators.

## Build Entry

CMake is the entry point: configuring runs `npm ci`/`npm install` when
`node_modules` is missing; `cmake --build build --target check` runs lint,
typecheck and the format check; `ctest` runs the tests. Direct `npm run ...`
scripts are fine while developing.

## Testing Style (Vitest)

- `describe` / `it` with descriptive names; unit tests in `tests/unit/`,
  browser tests in `tests/e2e/`, helpers in `tests/support/`.
- Register every test file with `inkpad_add_test(<name> <file> [PROJECT e2e])`
  in `tests/CMakeLists.txt`. ctest runs each in its own process, in parallel:
  no fixed TCP ports (listen on port 0), no shared fixed temp directory names,
  no fixed sleeps (wait on the condition with `until(...)` and a bounded
  timeout). Never use public trackers or the internet in tests: use
  `FakeTracker`.

## Dependencies

npm packages are pinned by `package-lock.json`; add runtime dependencies only
with good reason (the shipped pages have none beyond the
packages in `packages/`). Do not edit files under `node_modules/`. Code copied
from other projects goes in `packages/` with a provenance header and a
`NOTICE` entry.

## Behavioral Rules

- No broad stylistic rewrites; no renaming existing APIs.
- Mirror the style of sibling files when adding sources, bindings or tests.
