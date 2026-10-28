# 05_release_pipeline — CI, Pages deploy, Web Store packaging

Builds on `spec/01_core_features/DESIGN.md` section 5 (tooling).

## 1. Scope

Automate verification and delivery of the two shipped artifacts: the viewer
site (GitHub Pages) and the extension package (Chrome Web Store zip). Mirrors
the approach nymph used for its release pipeline, without referencing it.

## 2. CI (`.github/workflows/ci.yml`)

Matrix Linux, macOS, Windows: install, lint, typecheck, unit/integration
tests, build extension and viewer, size budget, `cmake --build`/`ctest` entry.
Playwright e2e on Linux (Chromium with xvfb) required; macOS/Windows e2e
optional-nightly. No tests may depend on public trackers or the internet.

## 3. Pages deployment

- Workflow `pages.yml`: on push to `main`, `scripts/build-site.mjs` assembles the
  site and it is deployed to the `github-pages` environment, then
  `scripts/smoke-site.mjs` checks the deployed address (with retries).
  Tags do not deploy: every build already contains the viewer at the root
  and under `/v<N>/`, N being the protocol major.
- Pages replaces the whole site on each deploy, so older majors are kept in
  `site-archive/v<N>/` in the repo and copied in. When the protocol major
  changes, the last build of the old viewer goes there first.
- Static only: `index.html`, `viewer.js`, `404.html` with a small script that
  sends a lost invite (`#inkpad=...`) to the site root keeping the fragment
  (the base path is filled in at build time, `/<repo>/` on a project site),
  `privacy.html`, and `.nojekyll`.
- The extension's default `viewerBase` is fixed at build time from
  `INKPAD_VIEWER_BASE` (the release workflow sets it to the repository's Pages
  address, or to the repository variable of the same name for a custom
  domain), so forks point at their own site.
- Pages for a private repository needs a paid plan.

## 4. Extension packaging

- `npm run package` builds the extension, runs `scripts/audit-extension.mjs`,
  and writes a reproducible `inkpad-extension-<version>.zip` (sorted names, fixed
  timestamps) with its `.sha256` into `release/`. The audit asserts that the
  manifest permissions equal the documented set (`spec/02` section 4: `activeTab`,
  `tabCapture`, `offscreen`, `storage`), that there are no host permissions,
  content scripts or keys, that the version is the package's, and that the code
  has no `eval`, remote script or source maps.
- Release workflow on tag: build, test, attach the zip and SHA-256 to the
  GitHub release, update `CHANGELOG.md` section. Web Store upload stays a manual
  step in v1 (store credentials are not put in CI); `docs/publishing.md`
  records the listing text, privacy disclosures and screenshots checklist.
- Privacy policy: a static page (`viewer/src/site/privacy.html`, served at
  `privacy.html`; `docs/privacy.md` points to it): no data collected by inkpad;
  describes trackers, STUN/TURN and IP exposure.

## 5. Versioning

SemVer. Protocol id (`inkpad/1`) changes only on incompatible wire changes and
bumps the Pages major path. Extension and viewer minor/patch versions are
independently compatible within a protocol.

## 6. Licensing

MIT, `NOTICE` for code copied from nymph (provenance in file headers). CI
checks that copied files keep their headers.
