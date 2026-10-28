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

Keep brief Doxygen comments on public APIs, classes and module contracts:
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
`inkpad_add_test(<name> <sources>)` in `tests/CMakeLists.txt`.

# inkpad Coding Style Guide

## General

- Match the style of nearby files first; keep changes minimal and focused.
- Preserve existing public API names and behavior unless asked.
- Prefer readable, explicit code. Use ASCII by default.

## C++ Style

- Follow `.clang-format` exactly: 2-space indent, no tabs, attached braces,
  `Type* ptr`, sorted includes.
- Start files with `// MIT License © 2026 Carlos Lopez`.
- Add `@file` / `@brief` Doxygen comments to public headers.
- Project includes before standard library includes; prefer explicit includes.
- Namespace `inkpad`, with a closing namespace comment.
- `snake_case` types, functions and variables; trailing underscore on member
  fields (`running_`); descriptive local names.
- Public methods: contract comments (`@param`, `@return`, failure behavior).
  Throw `std::runtime_error`-derived errors; use `std::optional` over sentinels.
- Never poll a plain `bool` written by another thread; use atomics or
  condition variables. Keep lock scope tight.

## Platform Support

Targets **Linux, macOS and Windows (MSVC)**; CI builds and tests each
(`.github/workflows/ci.yml`). Prefer a small `#if defined(_WIN32)` guard in a
shared file over splitting files. Do not assume code that compiles on
GCC/Clang compiles on MSVC.

## Testing Style (GoogleTest)

- `TEST` / `TEST_F` with descriptive names; `ASSERT_*` for preconditions,
  `EXPECT_*` after.
- ctest runs every test case as its own process, in parallel: no fixed TCP
  ports (bind port 0), no shared fixed temp directory names (include
  `current_test_info()->name()`), no fixed sleeps (wait on the condition with
  a bounded timeout).

## Dependencies

Third-party code lives in `extern/` as git submodules (`.gitmodules`). Do not
edit files under `extern/`. Initialize lazily with
`inkpad_ensure_submodules(extern/<name>)`.

## Behavioral Rules

- No broad stylistic rewrites; no renaming existing APIs.
- Mirror the style of sibling files when adding sources, bindings or tests.
