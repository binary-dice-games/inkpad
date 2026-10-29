# 06_static_presenter - plan

Design: `spec/06_static_presenter/DESIGN.md`. Follow the steps in order.

## 1. ShareHost without a tab or keeper

**Goal:** `ShareHost` runs in a page that has no tab and mounts its own whiteboard.
**Deliverables:** `tabId` optional, `keeper?: boolean` (default true),
`clearBoard?: () => void`; `UiState.tabId` stays `number | null`.
**Tests:** `tests/unit/share-host.test.ts`: without a keeper `clear` calls the
callback; the ui has `tabId: null`.
**Result:** done.

## 2. Display capture module

**Goal:** the picker, the surface facts and the pure helpers.
**Deliverables:** `viewer/src/display-capture.ts` (`startDisplayCapture`,
`fitScale`, `surfaceWarning`).
**Tests:** `tests/unit/display-capture.test.ts`.
**Result:** done.

## 3. Presenter page and build

**Goal:** `present.html` in the Pages site, not in the extension.
**Deliverables:** `viewer/src/present.ts`, `present.html`; `buildViewer` builds
them (option `present`, off for the extension); `build-site` and `smoke-site`
cover it; the viewer's landing links to it.
**Tests:** `tests/e2e/present.test.ts`.
**Result:** done.

## 4. Documentation

**Goal:** README, docs, changelog, spec index.
**Deliverables:** README overview and layout; `docs/manual-testing.md` rows for
the real picker, still screen and background tab; CHANGELOG.
**Result:** done.

## Completion Criteria

`npm run check`, unit and browser tests pass; `present.html` is on the built
site; the manual checks of section 3 of the design are recorded in
`docs/manual-testing.md`.
