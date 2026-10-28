# inkpad — Publishing

How a release is made, and what the Chrome Web Store listing needs. The release
workflow does everything except the upload to the Web Store, which stays manual:
store credentials are not kept in CI.

## Cutting a release

1. Move the entries under `## [Unreleased]` in `CHANGELOG.md` to a new
   `## [X.Y.Z] - date` section.
2. Set `"version": "X.Y.Z"` in `package.json`. The extension takes its version from
   it; a store upload needs a higher version than the last one.
3. Commit, then tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. The `release` workflow then:
   - refuses a tag that is not the package version;
   - takes the release text from the CHANGELOG section (and fails if it is missing
     or empty);
   - runs the checks and all tests, including the browser tests;
   - builds the extension, audits it and zips it;
   - creates the GitHub release with `inkpad-extension-X.Y.Z.zip` and its `.sha256`.
5. Upload the zip in the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole),
   fill the listing from this page, and submit for review.

The zip is reproducible: building the same commit gives the same bytes, so the
checksum in the release can be checked by building locally with
`npm run package` (the output is in `release/`).

## The site

The `pages` workflow publishes the viewer from `main` to GitHub Pages: the latest
viewer at the root and a copy under `/v<N>/` for protocol major N. Pages replaces the
whole site on every deploy, so when the protocol changes to N+1, first copy the
last build of the old viewer into `site-archive/v<N>/` (build it with
`npm run build:viewer` at the old commit) so that extensions of the old major keep a
matching viewer.

Pages for a private repository needs a paid GitHub plan; for a public one it is free.
The extension links to `https://<owner>.github.io/<repo>/` by default; set the
repository variable `INKPAD_VIEWER_BASE` (an address ending with `/`) to use another
address, such as a custom domain. The address is fixed into the extension when it is
built.

## What the audit checks

`npm run audit:extension` (also run by CI and the release) fails if the built
extension:

- asks for any permission other than the four below, or for host permissions,
  content scripts, a key, web-accessible resources or a looser content security
  policy;
- has a version other than the package's, or names a file that is missing;
- contains `eval(`, `new Function(`, `importScripts(`, a remote `<script src>`, source
  maps or source map references.

| Permission | Why (this text goes in the store's permission justifications) |
|---|---|
| `activeTab` | Gives access to the tab the user shares, when they click the extension or use its shortcut. |
| `tabCapture` | Records the shared tab to send it to the people with the link. |
| `offscreen` | A hidden page that holds the peer-to-peer connections and the capture, which a service worker cannot. |
| `storage` | Keeps the user's settings (name, colour, video quality, trackers). |

## Store listing

**Name:** inkpad

**Short description (up to 132 characters):** Share a tab live and draw on it together. Peer to peer, no account, no server;
viewers need no extension.

**Description:**

> inkpad turns a browser tab into a shared whiteboard. Click the extension, share the tab you
> want to present, and send the link. Anyone with the link sees your tab and can draw on it
> with you: pen, text, stickers and emoticons. You manage the session from a console window:
> remove people, lock the session, pause, clear the drawings or end it.
>
> There is no inkpad server and no account. Connections go directly between you and your
> viewers, and the video is only a few frames a second, so it works on modest connections.
> Viewers need only a browser.
>
> The video of your tab and the drawings are never stored. Everything visible in the shared
> tab is visible to anyone with the link: share it only with people you trust.

**Category:** Productivity. **Language:** English.

**Single purpose** (the store asks for one): share the active tab live with a drawing layer
that all participants can use.

**Privacy policy URL:** `https://<owner>.github.io/<repo>/privacy.html`. The text is in
`viewer/src/site/privacy.html`.

**Data disclosures** (the store's questionnaire): no personal data is collected or transmitted
to the developer. Website content (the shared tab's picture) is sent peer to peer to the
people the user gives the link to, which is the extension's purpose. Network addresses are
visible to the other side of a connection, to the public trackers, and to the STUN servers.
Nothing is sold, used for unrelated purposes or used for creditworthiness.

**Remote code:** none. All code is in the package.

**Screenshots to take** (1280×800): the popup with a live share; the console with a drawing
on a shared page; the viewer on a phone; the options page.

## After publishing

Install the store version in a clean profile and walk through `docs/manual-testing.md`.
