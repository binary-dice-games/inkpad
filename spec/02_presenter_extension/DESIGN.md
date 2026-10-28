# 02_presenter_extension — Chrome extension (presenter side)

Builds on `spec/01_core_features/DESIGN.md` (architecture, collab core).
Video details are in `spec/03_tab_streaming/DESIGN.md`.

## 1. Purpose and scope

The Manifest V3 extension a presenter installs. It enables inkpad on the active
tab, shows the whiteboard overlay and toolbar, hosts the collab session, and
produces the share link. Only the presenter needs it.

Out of scope: viewer UI (`04`), capture/encoding internals (`03`), store
publishing (`05`).

## 2. Components

| Component | Runs in | Responsibility |
|---|---|---|
| Service worker | extension | Orchestrator and state machine; handles action click, commands, `tabs.onUpdated/onRemoved`; obtains the tab-capture stream id; creates/closes the offscreen doc. It is not a relay: the overlay's Port goes straight to the offscreen document, because `runtime.onConnect` reaches every extension page, and a sleeping worker would drop the Port |
| Offscreen document | extension (reasons `USER_MEDIA`, `WEB_RTC`) | Collab session (host), `MediaStream`, whiteboard model + snapshot, tracker sockets |
| Content script `overlay` | shared tab, top frame, isolated world | Shadow-DOM overlay: whiteboard view, toolbar, share panel, indicator |
| Popup | extension | Start/stop, link copy, people list, quick settings |
| Options page | extension | Settings (section 6) |

The service worker is stateless between wake-ups: durable state is in
`chrome.storage.session` (`{tabId, token, phase}`) and the offscreen doc.

### State machine

`idle → starting → live ⇄ paused → ending → idle`. One shared tab at a time.
Starting a new share in another tab asks to end the first.

## 3. Start / stop flow

1. User clicks the toolbar action (or shortcut, default `Alt+Shift+I`). This
   grants `activeTab` and the user gesture needed by `tabCapture`.
2. Confirmation: the popup always shows the notice (the Start button is the confirmation); the shortcut starts a share only after one confirmed start (`consented` in `storage.local`), otherwise it opens the popup. The notice reads ("everything in this tab will be
   visible to anyone with the link").
3. Service worker: `chrome.tabCapture.getMediaStreamId({targetTabId})`,
   creates the offscreen document, passes the id.
4. Offscreen: acquires the stream, creates the host session, publishes the
   invite fragment.
5. Service worker injects the content script (`chrome.scripting.executeScript`)
   and the overlay connects a Port to the offscreen document; overlay shows the share panel with the link
   `<viewerBase>/#inkpad=<token>` and *Copy*.
6. Stop (button, Esc-hold, closing the tab, or removing the extension)
   sends `stage.state=ended` and `end`, closes links, removes the overlay and
   closes the offscreen document.

## 4. Overlay

- Host element appended to `document.documentElement` (not `body`), with a
  closed shadow root, `position: fixed; inset: 0; z-index: 2147483647`, and
  `pointer-events: none` except on toolbar and while a drawing tool is active.
  Appending to `documentElement` matters for capture (spec/03 section 3).
- **Toolbar** (nymph look, ported): pointer, pen, text, sticker (with chooser),
  eraser, colour swatch and palette, undo, redo, clear, plus inkpad extras:
  *people* (count, lock viewers, remove, new link), *share* (link, copy),
  *pause video*, *hide overlay*, *stop*. The control bar (everything but the drawing tools) is draggable, remembered per origin in `storage.local`,
  collapsible; position remembered per origin in `chrome.storage.local`.
- **Pointer mode** keeps the page fully interactive; `Esc` returns to it.
- **Remote activity** is drawn live: viewer cursors with name labels, live
  ink, items. A subtle "N viewers" pill is always visible.
- **Hide overlay** hides drawings locally only. The model keeps syncing and
  viewers still see everything; useful for interacting with the page.
- Keyboard shortcuts from nymph (undo/redo, Esc) plus `chrome.commands` for
  toggle overlay and toggle pause. The overlay swallows keys only while the
  text tool is editing.
- Dark scheme and keyboard focus styling follow nymph.
- Re-injected on top-frame `tabs.onUpdated` (`status: loading`) for the
  shared tab; iframes are not overlaid (v1). Receives a model snapshot and
  `stage` state on attach.
- `chrome://`, Web Store and other restricted pages cannot be injected; the
  popup explains this instead of failing silently.

## 5. Permissions

Required: `activeTab`, `tabCapture`, `offscreen`, `scripting`, `storage`.
Optional host permission `<all_urls>`, requested when starting the first share
via a "Keep overlay across navigation" prompt: without it `activeTab` is
dropped on cross-origin navigation and the overlay disappears until the user
clicks the action again (capture itself continues). No remote code, no
analytics, network access only to trackers (WebSocket) and ICE servers.

## 6. Settings (options page, `chrome.storage.sync`)

| Setting | Default |
|---|---|
| Viewer base URL | the project's GitHub Pages URL |
| Trackers | list from `packages/defaults` (editable) |
| ICE servers (STUN/TURN) | public STUN, TURN empty |
| Frame rate, max resolution, max bitrate | see `spec/03` section 4 |
| Viewers may draw on start | on |
| Display name / colour | random friendly name, random colour |
| Toolbar language strings | English (strings table, i18n-ready) |

Settings take effect live where possible (video parameters) or on the next
share.

## 7. Failure behaviour

- Capture fails/revoked: `phase` returns to `idle`, badge turns red, popup
  shows the reason; overlay removed.
- No tracker reachable after 10 s: panel shows "no-tracker" with the manual
  code option (nymph carries this over).
- Offscreen doc crash: service worker detects the closed Port, ends the share
  cleanly; drawings are lost (not persisted by design).
- Page navigation: the session is unaffected; overlay re-attaches within a
  frame or two of `DOMContentLoaded`.

## 8. Testing

Vitest for the state machine and `SessionProxy`; Playwright with the unpacked
extension for start/stop, navigation re-attach, pointer pass-through, toolbar
actions and lock enforcement. See `spec/01_core_features/DESIGN.md` section 6.

## 9. Implementation notes (project 02, steps 1 to 4)

- `ShareHost` (`extension/src/share-host.ts`) is the whole presenter side without chrome.* calls, so it is unit tested; `offscreen.ts` only connects it to messages and ports.
- The host's `accept` callback lets viewers speak only on the `wb` channel (through `drawingGate`), so a viewer cannot send `stage` messages to the other viewers through the host relay.
- `stage.state` is `live`, `paused` or `ended`; the viewport size comes from the overlay (`viewport` command, 200 ms debounce) until the capture of `spec/03_tab_streaming` supplies it.
- An extension cannot read the URL of a tab it has no access to. The tab the share starts from has it (popup or shortcut grants `activeTab`); after a cross-origin navigation it is hidden unless the optional all-sites access was granted, so `canInject` then says no and the popup offers "Show it again".
- Deferred: the whiteboard's own toolbar stays at the left edge (making it draggable means changing the copied whiteboard); video integration waits for `spec/03_tab_streaming` steps 2 and 3.
- The e2e build (`--e2e`) adds host access to loopback and leaves the overlay's shadow root open; the shipped build has neither.
