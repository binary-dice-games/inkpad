# 05_release_pipeline — implementation plan

Design: [DESIGN.md](DESIGN.md). Start after `01_core_features` step 1; finish
after `04_viewer_site` step 1.

## Step 1 — CI

**Goal:** Cross-OS verification.
**Deliverables:** updated `ci.yml` (matrix, lint, typecheck, test, build, size
budget), Linux e2e job.
**Tests:** CI green; a deliberately failing test turns it red (verified once).
**Result:** _pending_

## Step 2 — Pages deployment

**Goal:** Viewer published from `main` and tags.
**Deliverables:** `pages.yml`, `404.html` fragment-preserving redirect,
versioned paths, `viewerBase` injection.
**Tests:** post-deploy smoke test loads the page and parses a dummy fragment.
**Result:** _pending_

## Step 3 — Extension package and release

**Goal:** Reproducible store zip and GitHub release.
**Deliverables:** `package` script, manifest/permission audit script, release
workflow, `docs/publishing.md`, `docs/privacy.md`.
**Tests:** audit script fails on an added permission; zip contents verified.
**Result:** _pending_

## Completion Criteria

- A tag produces a verified zip and a deployed matching viewer path with no
  manual steps except the Web Store upload.
