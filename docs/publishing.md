# inkpad — Publishing

inkpad is a static site: the viewer page, the presenter page, a 404 page that
keeps an invite in the address, and the privacy policy. There is nothing else to
publish and no store listing.

## The site

The `pages` workflow publishes the site from `main` to GitHub Pages. It builds
`scripts/build-site.mjs`, deploys, and then runs `scripts/smoke-site.mjs` against
the deployed address (it retries for a few minutes while the deploy reaches the
edges).

The site holds the viewer and the presenter page at the root and a copy of both
under `/v<N>/`, where N is the major of the wire protocol (`PROTOCOL` in
`packages/defaults`). Pages replaces the whole site on every deploy, so when the
protocol changes to N+1, first copy the last build of the old site into
`site-archive/v<N>/` (build it with `npm run build:site` at the old commit), so
that links made with the old protocol keep a matching viewer.

Pages for a private repository needs a paid GitHub plan; for a public one it is
free. The presenter page makes viewer links on the address it is served from, so
a fork or a custom domain needs no setting.

## Check by hand

After a deploy, open the site, start a session from `present.html`, join from
another browser, and walk through [manual-testing.md](manual-testing.md).
