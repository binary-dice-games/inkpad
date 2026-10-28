# 05_release_pipeline — implementation plan

Design: [DESIGN.md](DESIGN.md). Start after `01_core_features` step 1; finish
after `04_viewer_site` step 1.

## Step 1 — CI

**Goal:** Cross-OS verification.
**Deliverables:** updated `ci.yml` (matrix, lint, typecheck, test, build, size
budget), Linux e2e job.
**Tests:** CI green; a deliberately failing test turns it red (verified once).
**Result:** Written, not verified. `ci.yml` runs on Linux, macOS and Windows:
configure (npm ci), lint/typecheck/format, the Chromium install, the extension and
viewer builds, the extension audit and the whole ctest suite, including the browser
tests on every OS (the design said Linux only; they are cheap enough to try
everywhere). It passed on Linux and macOS for the first JS commit; since then GitHub
has not started any job because of an account billing block, and the Windows job
failed at `npm ci` with no log (the CMake step now prints npm's output). No commit
with the extension, capture or viewer has been through CI.

## Step 2 — Pages deployment

**Goal:** Viewer published from `main`.
**Deliverables:** `pages.yml`, `404.html` fragment-preserving redirect,
versioned paths, `viewerBase` injection.
**Tests:** post-deploy smoke test loads the page and parses a dummy fragment.
**Result:** Scripts done and tested, workflow written but never run.
`scripts/build-site.mjs` (viewer at `/` and `/v1/`, archived majors, `404.html` with
the base path, `privacy.html`, `.nojekyll`), `scripts/smoke-site.mjs` (viewer page,
script, versioned copy, privacy page, a missing page must be the 404 page), the
build-time `INKPAD_VIEWER_BASE`, and `pages.yml` (build, deploy, smoke with retries).
Tested locally: the site builds with the base path, a local server that behaves like
Pages passes the smoke check, and the check fails when a page is missing or the
site is unreachable; in Chromium, against a server that serves the site under
`/inkpad/` like Pages, the 404 page sends a lost invite to the site root keeping the
fragment, the viewer loads at `/` and `/v1/` and the privacy page loads, with no CSP
violation. Not tested: the workflow itself, or Pages on a private repository (needs a
paid plan).

## Step 3 — Extension package and release

**Goal:** Reproducible store zip and GitHub release.
**Deliverables:** `package` script, manifest/permission audit script, release
workflow, `docs/publishing.md`, `docs/privacy.md`.
**Tests:** audit script fails on an added permission; zip contents verified.
**Result:** Scripts done and tested, workflow written but never run. The audit
(`scripts/audit-extension.mjs`) fails on an added or missing permission, host
access, content scripts, a key, a wrong version, a missing file, a loosened CSP,
`eval`, `new Function`, `importScripts`, remote scripts and source maps; the real
build passes it. The package script builds, audits and zips reproducibly (the same
SHA-256 in two runs); `release-notes.mjs` takes the CHANGELOG section of the tag;
`release.yml` checks the tag against the package version, runs every check and
test, packages and creates the GitHub release. `docs/publishing.md` has the listing,
permission justifications, data disclosures and the release steps; the privacy
policy is a static page. Not done: the Web Store upload (manual by design) and
screenshots.

## Completion Criteria

- A tag produces a verified zip and a deployed matching viewer path with no
  manual steps except the Web Store upload.
