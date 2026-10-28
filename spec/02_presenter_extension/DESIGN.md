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
| Service worker | extension | Orchestrator and state machine; handles action click, commands, `tabs.onUpdated/onRemoved`; obtains the tab-capture stream id; creates/closes the offscreen doc; relays Ports |
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
2. First run per tab: confirmation panel ("everything in this tab will be
   visible to anyone with the link").
3. Service worker: `chrome.tabCapture.getMediaStreamId({targetTabId})`,
   creates the offscreen document, passes the id.
4. Offscreen: acquires the stream, creates the host session, publishes the
   invite fragment.
5. Service worker injects the content script (`chrome.scripting.executeScript`)
   and opens a Port; overlay shows the share panel with the link
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
  *pause video*, *hide overlay*, *stop*. Draggable, snaps to edges,
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
