# 02_presenter_extension — Chrome extension (presenter side)

> **Removed: the extension no longer exists. The presenter page (`spec/06_static_presenter/DESIGN.md`) replaced it; `ShareHost` lives on in `viewer/src/share-host.ts`. This document is kept as history.**

Builds on `spec/01_core_features/DESIGN.md` (architecture, collab core, presenter
role) and `spec/03_tab_streaming/DESIGN.md` (capture). The viewer and the
presenter console are in `spec/04_viewer_site/DESIGN.md`.

## 1. Purpose and scope

The Manifest V3 extension a presenter installs. It **captures the active tab,
hosts the session and gives the links**. It puts nothing into the shared page:
the whiteboard is drawn in the **presenter console**, a separate window that is
the viewer app with presenter powers. Only the presenter needs the extension.

Why no overlay on the page: tab capture records everything rendered in the tab,
so an overlay would be in the video (spike, `spec/03_tab_streaming/PLAN.md`
step 1). Hiding it per frame made it blink; Element Capture is not available for
`chrome.tabCapture`. Products such as Zoom avoid this with an OS flag that
excludes their annotation window from capture; the browser has no equivalent, so
inkpad draws somewhere else. The cost: the presenter draws on a copy of the page
that is a fraction of a second behind, not on the page itself.

Out of scope: viewer UI and console UI (`04`), capture internals (`03`), store
publishing (`05`).

## 2. Components

| Component | Runs in | Responsibility |
|---|---|---|
| Service worker | extension | Orchestrator and state machine; shortcuts; tab events; the capture stream id; creates/closes the offscreen doc; opens the console window; tab-size changes |
| Offscreen document | extension (reasons `USER_MEDIA`, `WEB_RTC`) | Host session (`ShareHost`), board keeper, tab capture stream, tracker sockets |
| Popup | extension | Start/stop, the two links, viewers, commands, Open console |
| Options page | extension | Settings (section 5) |
| Console page | extension (`viewer.html`) | The viewer app with presenter powers; opens from the popup in its own window |

The service worker is stateless between wake-ups: the phase and tab are in
`chrome.storage.session`; the share lives in the offscreen document.

### State machine

`idle -> starting -> live <-> paused -> ending -> idle`. One shared tab at a time.
Starting another share ends the first.

## 3. Start / stop flow

1. The user clicks the toolbar action (or the shortcut, default `Alt+Shift+I`).
   This grants `activeTab` and the user gesture `tabCapture` needs.
2. The popup shows the notice ("everything in this tab will be visible to anyone
   with the link"); its Start button is the confirmation. The shortcut starts a
   share only after one confirmed start, otherwise it opens the popup.
3. Refused targets: browser pages and the Web Store (not capturable), and any
   tab showing the viewer or console of **this** session (it would film
   itself).
4. Service worker: `chrome.tabCapture.getMediaStreamId({targetTabId})`, creates
   the offscreen document, sends the stream id, the tab size and the settings.
5. Offscreen: captures the stream, creates the host session and board keeper,
   makes the viewer link and the console link.
6. The popup shows both links. **Open console** opens the console in a popup
   window (`chrome.windows.create`).
7. Stop (popup, console "End", shortcut, closing the shared tab) sends
   `stage.state=ended` and `end`, closes the links, stops the capture and closes
   the offscreen document.

The two links: the **viewer link** is for everyone; the **console link** carries
the presenter key and is private. The console is an extension page
(`chrome-extension://<id>/viewer.html#...`), so it opens without the hosted
viewer being reachable.

## 4. Permissions

`activeTab`, `tabCapture`, `offscreen`, `storage`. No host permissions, no
`scripting`, no content script. Network access is to trackers (WebSocket) and
ICE servers only. No remote code, no analytics.

## 5. Settings (options page, `chrome.storage.sync`)

| Setting | Default |
|---|---|
| Viewer base URL | the project's GitHub Pages URL |
| Trackers | list from `packages/defaults` (editable; non-default lists travel in the viewer link) |
| ICE servers (STUN/TURN) | public STUN, TURN empty |
| Frame rate, max resolution, max bitrate | see `spec/03` section 4 |
| Viewers may draw on start | on |
| Display name / colour | `Presenter`, blue |

Settings take effect live where possible (video parameters) or on the next
share.

## 6. Failure behaviour

- Capture fails or is revoked: back to `idle`, red badge, the popup shows why.
- No tracker reachable after 10 s: the popup shows `no-tracker` (manual codes are
  a later addition).
- Offscreen document crash: the service worker notices and ends the share.
  Drawings are lost (not persisted by design).
- The shared tab navigates: capture and session are unaffected (nothing was
  injected). A resize of the window re-fits the capture constraints.

## 7. Testing

Vitest for the state machine, settings and `ShareHost`; Chromium with the
unpacked extension for start/stop, links, video reaching a viewer and the
console. See `spec/01_core_features/DESIGN.md` section 6.

## 8. Implementation notes

- `ShareHost` (`extension/src/share-host.ts`) is the whole presenter side without
  chrome.* calls, so it is unit tested; `offscreen.ts` only connects it to
  messages.
- The host's `accept` callback is the gate: viewers speak only on the `wb`
  channel (through `drawingGate`); `ctl` messages are handled inside it and
  never delivered or relayed. See `spec/01_core_features/DESIGN.md` section 4.5.
- An extension cannot read the URL of a tab it has no access to. The tab the
  share starts from has it (popup or shortcut grants `activeTab`).
- History: steps 1 to 4 first built an on-page overlay (content script, session
  proxy, board keeper hooks). It was removed when the console replaced it; the
  board keeper stays so late joiners get the drawings while no console is open.
- `ShareHost` is also used by the static presenter page (`spec/06_static_presenter`), without a
  tab and without the board keeper (`tabId` optional, `keeper: false`).
