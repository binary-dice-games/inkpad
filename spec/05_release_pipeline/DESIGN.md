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

- Workflow `pages.yml`: on push to `main` build `viewer/` and publish to the
  `github-pages` environment (latest channel); on tags `vX.Y.Z` also publish
  under `/vX/` (major) so older extensions keep a matching viewer.
- Static only: `index.html`, hashed JS/CSS, `404.html` that redirects keeping
  the fragment, no Jekyll (`.nojekyll`).
- The repo's Pages URL is the default `viewerBase` baked into
  `packages/defaults` at build time (injected from a repo variable so forks
  work).

## 4. Extension packaging

- `npm run package` produces `inkpad-extension-<version>.zip` from
  `extension/dist`: manifest version synced with `package.json`, no source
  maps unless requested, no remote code, checked by a script that asserts
  manifest permissions equal the documented set (`spec/02` section 5).
- Release workflow on tag: build, test, attach the zip and SHA-256 to the
  GitHub release, update `CHANGELOG.md` section. Web Store upload stays a manual
  step in v1 (store credentials are not put in CI); `docs/publishing.md`
  records the listing text, privacy disclosures and screenshots checklist.
- Privacy policy page (`docs/privacy.md`, also served on Pages): no data
  collected by inkpad; describes trackers, STUN/TURN and IP exposure.

## 5. Versioning

SemVer. Protocol id (`inkpad/1`) changes only on incompatible wire changes and
bumps the Pages major path. Extension and viewer minor/patch versions are
independently compatible within a protocol.

## 6. Licensing

MIT, `NOTICE` for code copied from nymph (provenance in file headers). CI
checks that copied files keep their headers.
