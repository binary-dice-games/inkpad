# 01_core_features — product, architecture and collab core

> **Update: the Chrome extension, the presenter console, the presenter key, the `ctl` channel and the board keeper described here were removed; the presenter page replaced them (`spec/06_static_presenter/DESIGN.md` section 8). The rest (session, star topology, whiteboard, security of the link) still holds.**

Foundation project. It defines what inkpad is, how the pieces fit, the repo
and tooling, and the **collab core** (session + whiteboard) that every other
project builds on. Related projects:

| Project | Covers |
|---|---|
| `spec/02_presenter_extension/` | Chrome extension: overlay, toolbar, share controls |
| `spec/03_tab_streaming/` | Tab capture and low-fps WebRTC video |
| `spec/04_viewer_site/` | Static viewer page on GitHub Pages |
| `spec/05_release_pipeline/` | CI, Pages deploy, Web Store packaging |

## 1. Purpose and scope

inkpad turns a browser tab into a shared whiteboard. A **presenter** with the
Chrome extension enables it on the active tab. The extension:

1. Gives the presenter a **console**: a separate window that shows the video and
   the whiteboard (pointer, pen, text, stickers/emoticons, eraser, undo/redo,
   colours) and the presenter's controls. Nothing is injected into the shared tab.
2. Streams the tab's pixels to **viewers** over WebRTC, at a low, configurable
   frame rate.
3. Produces a **collab link**. Viewers open it in any modern browser, with no
   extension. They see the video plus the same whiteboard and can draw on it.

Drawings are **never part of the video**. They travel as data and each peer
renders them locally on top of the video, the presenter's console included.
The presenter does not draw on the live page: tab capture records whatever is
rendered in the tab, an overlay included, and the browser has no way to exclude
it (see `spec/03_tab_streaming/PLAN.md` step 1).

Non-goals (v1): audio, recording, persistence of drawings, accounts, a server
of our own, more than ~10 viewers, non-Chromium presenters, remote control of
the presenter's page, multi-tab sharing.

## 2. Origin: copy of nymph, not a dependency

The collab code is **copied** from `binary-dice-games/nymph`
(`web/collab/collab-session.js`, `web/collab/collab-whiteboard.js`, and the
ideas in nymph `spec/18_collaboration/DESIGN.md`). inkpad never references
nymph at build or run time. Copied files keep a provenance header (source path,
commit, date) and nymph's MIT notice in `NOTICE`. Divergence is allowed; the
header is how to diff against upstream.

Reused unchanged in concept: serverless signaling through public WebTorrent
trackers with sealed (AES-GCM) offers, manual-code fallback, star topology
(host = presenter), `reliable` + `fast` data channels, 16 KiB framing,
last-writer-wins whiteboard with Lamport stamps and tombstones, roster,
lock/remove/new-link, 500-entry/2000-item/5000-point limits.

## 3. Architecture

```
 Presenter's Chrome                                   Viewers' browsers (no extension)
┌───────────────────────────────────────────┐        ┌──────────────────────────────┐
│ Shared tab (untouched: no overlay)        │        │ viewer page (GitHub Pages)   │
│        │ chrome.tabCapture                │        │  <video> + whiteboard        │
│ ┌──────▼─────────┐   ┌─────────────────┐  │        │  collab-session (guest)      │
│ │ service worker │──►│ offscreen doc   │◄─┼────────┴──────────────▲───────────────┘
│ │ (orchestrator) │   │ session (host), │  │   WebRTC: video track + reliable/fast
│ └──────▲─────────┘   │ board keeper,   │  │   data channels (star, 1 link per peer)
│        │ popup       │ MediaStream     │  │
│ ┌──────┴─────────┐   └────────▲────────┘  │   signaling: sealed offers/answers via
│ │ popup / options│            │ WebRTC    │   public WebTorrent trackers (wss) only
│ └────────────────┘   ┌────────┴────────┐  │
│  Console window ◄────┤ viewer.html     │  │   The console is a guest with the
│  (extension page)    │ + presenter key │  │   presenter key, in its own window.
│                      └─────────────────┘  │
└───────────────────────────────────────────┘
```

Key decisions (the *why*):

- **Session lives in the offscreen document, not the page.** Page CSP can block
  WebSockets to trackers; the page navigates and reloads (killing links);
  MV3 service workers sleep and cannot hold `RTCPeerConnection`. The offscreen
  document survives navigation and owns the capture stream anyway.
- **The board keeper in the offscreen document holds the drawings** while no
  console is open, so late joiners get a snapshot and drawings survive the
  console being closed and reopened.
- **Overlay talks to the session through a `SessionProxy`** (a `Port` relay via
  the service worker) that implements the same `channel()`/`on()` surface the
  whiteboard expects from a `Session`: `serveSessionProxy(session, port, hooks)`
  in the offscreen document, `connectSessionProxy(port)` in the overlay
  (`packages/collab-session/session-proxy.js`). The copied whiteboard needs no
  changes for this.
- **Star topology, presenter is host.** Same reason as nymph: the presenter
  holds the truth and one NAT path per viewer. Cost: uplink = viewers × video
  bitrate, hence the low-fps default and ~10-viewer target (see
  `spec/03_tab_streaming/DESIGN.md`).
- **The presenter is a peer with a key.** The console is the viewer app opened with a
  second secret (the presenter key); the host trusts that peer's `ctl` commands.
  See section 4.5.
- **Viewers are first-class drawers.** Unlike nymph (guests view only), any peer
  may add/modify/delete any item. The presenter can *lock* viewers to
  pointer-only at any time (host-enforced, see 4.3).
- **Whiteboard coordinates are frame-relative** (4.2), so the same drawing
  lines up on the presenter's page and on every viewer's video.

## 4. Collab core contract

Lives in `packages/` (see 5). Changes versus nymph are listed explicitly.

### 4.1 `collab-session` (copy)

Same public API as nymph (`createSession`, `Session`, `channel`, `peers`,
`lock`, `remove`, `newInvite`, `inviteFragment`, `manual`, events). Changes:

| Change | Reason |
|---|---|
| Fragment key is `inkpad=<token>` (not `collab=`) | Avoid clashing with nymph links |
| `media` option: host passes a `MediaStream` (or track source); guest passes `onTrack` | Video, see below |
| Guest offers always include a `recvonly` video transceiver | Offers are guest-made; the host attaches its track to that transceiver before answering |
| Tracker list and ICE servers come from options, defaults in `packages/defaults` | Configurable in extension options |
| Protocol id `inkpad/1` | Handshake refuses mismatches |

Media hooks (contract, details in `spec/03_tab_streaming/DESIGN.md`):

- Host: `session.setMedia(stream | null)` attaches/replaces the sender track on
  every link (current and future) via `RTCRtpTransceiver`/`replaceTrack`.
  `session.mediaParams({fps,maxBitrate,scale})` sets sender parameters live.
- Guest: `session.on('track', (stream) => ...)`.
- A link is "open" once data channels are open; video may arrive later or
  never (e.g., presenter paused). Failure to negotiate video does not close
  the data link.

### 4.2 `collab-whiteboard` (copy, adapted)

Same tools, data model, merge rules and limits as nymph. Changes:

- **Board units.** Item coordinates, stroke width and text/sticker size are in
  units where the **frame width = 1000**. Frame height in units is
  `1000 / aspect`. The *stage* message (4.3) carries `aspect`. Items are not
  rescaled if the aspect later changes (page layout reflows anyway); content
  outside the new frame is clipped, not deleted.
- **Adapter** maps board units to the host element: the page viewport on the
  presenter, the letterboxed `<video>` rectangle on viewers.
- **Stickers.** Built-in SVG set is extended with emoticon faces (smile,
  laugh, wink, sad, surprised, angry, cool, thinking) next to nymph's check,
  cross, question, star, heart, thumbs-up, warning, arrow. Peers send names
  only, never SVG (nymph decision: emoji glyphs differ per OS). The text tool
  still accepts emoji characters.
- **Permissions.** Nymph's `readOnly` is local. inkpad enforces the lock on
  the host: `drawingGate(() => drawing)` is the session's `accept` callback and
  drops viewers' ops, live ink and non-empty snapshots while drawing is off
  (cursors and empty join requests still pass), and rate-limits ops to 50/s per
  peer. Viewers learn the state from `stage.drawing` and set the whiteboard's
  `readOnly` from it, so no separate `perm` message exists.
- **Snapshot on join.** The host sends the full model snapshot to a new
  viewer on the reliable channel (nymph already merges snapshots). While the
  overlay is detached (page loading) the **board keeper**
  (`packages/collab-whiteboard/board-keeper.js`) does this: it is a headless
  `WhiteboardModel` next to the host session that merges viewers' changes and
  hands a snapshot to the overlay when it attaches.
- **Frame adapter.** `frameAdapter(element, aspect)` and `letterbox()` map
  board units to the letterboxed frame inside an element.
- **Clear** affects everyone and is allowed to viewers only while drawing is on.

- **Numbered tools and options.** The toolbar order gives the shortcuts (1 pointer, 2 pen,
  3 text, 4 sticker, 5 eraser, last the colour). A number selects the tool; pressing it
  again cycles its options (pen thin/normal/thick = 2/4/8 units, text 18/28/44, each
  sticker, the palette). Options are local style, never synced.
- **Own items.** Items carry `author`; the author can drag them (pointer tool, or the
  tool that made them), and right click removes them. Shift+drag scales and Ctrl/Alt+drag
  rotates stickers and images about their centre (`rot` degrees, absent when 0). The
  model still lets any peer change any item (last writer wins); "own" is a UI rule.
- **Images.** `image` items hold a small PNG/JPEG/WebP data URL (at most 300 000
  characters, 20 per board); a dropped file is scaled down in the browser until it fits.
  They travel in ops and snapshots like any item, so late joiners get them.
- **Zoom.** Lives in the frame adapter, not in the items: `zoomAt`/`panBy` change a view
  (scale 1-8, always covering the box) that is folded into `transform()` and `clip()`, and
  applied as a CSS transform to the `content` element (the video). Drawings and picture
  therefore zoom together; cursors are sent in board units, so they are unaffected.
- **Cursors.** `cur` messages carry the sender's `tool`; receivers draw that tool's icon
  with its hot spot on the point. Avatars (`avatar` messages, a small data URL, at most
  16 000 characters) replace the name; the host re-sends known avatars to late joiners
  (`of` = owner, accepted only from the host).
- **Turn queue.** The host keeps the queue (`queue` message with peer ids, accepted only
  from the host and refused by the gate when a guest sends it); guests send `turn`
  (`join`/`leave`) to the host. The host drops people who leave and can remove anyone. The
  first id has the turn: its cursor gets a ring and a larger shape. Turn requests and
  avatars pass the drawing gate even when viewers cannot draw.

### 4.3 Channels and messages

| Channel | Transport | Direction | Purpose |
|---|---|---|---|
| `$` | reliable | both | nymph control (hello, welcome, roster, refuse, locked, end, removed) |
| `wb` | reliable + fast | both | whiteboard ops, snapshots, cursors, live ink (nymph protocol); plus `avatar`, `turn` (guest to host) and `queue` (host to all), and the tool in `cur` |
| `ctl` | reliable | guest ↔ host only | presenter auth and commands (4.5); never relayed |
| `stage` | reliable | host → guests | `{aspect, w, h, fps, state: live\|paused\|ended, drawing:boolean, title?}`; resent on join and on every change |

`stage.title` is optional, off by default (page titles can be private).

### 4.5 Presenter role

The host makes a second 128-bit secret, the **presenter key**, besides the room
token. The console link is `<viewer>#inkpad=<token>&presenter=<key>`; the viewer
link has no key. After joining, the console sends `{t:'auth', key}` on `ctl`
(the channel runs inside the DTLS-encrypted link to a host the sealed signaling
already authenticated). The host compares it in constant time, remembers that
peer id as a presenter, and answers `{t:'role', presenter:true|false}`. The host
stamps every sender id, so a viewer cannot pose as the console.

Presenter commands on `ctl` (accepted only from authenticated peers):
`lock{on}`, `drawing{on}`, `pause{on}`, `remove{id}`, `clear`, `end`. The
host's `accept` callback handles every `ctl` message itself and returns false, so
it is never delivered to other listeners or relayed to other viewers. More than
one console may be open (the key is the capability). `newLink` in the popup
changes the room token only; connected consoles stay.

### 4.4 Security and privacy

- The link is the permission (as in nymph). Token and presenter key only in the
  URL fragment, so GitHub Pages never sees them. The presenter key is a bearer
  secret: whoever has the console link is a presenter. The presenter can lock,
  remove a viewer, or issue a new link.
- Trackers see topic hash and IPs, not the token, video, or drawings.
- **Everything visible in the tab is shared with everyone holding the link.**
  The extension requires an explicit start action, shows a persistent
  "sharing" badge and in-page indicator, and offers *Pause* (stop sending
  video) at any time.
- Guest messages are validated, size-limited, rate-limited (50 whiteboard
  ops/s) and never touch the page DOM except through the whiteboard's
  `textContent` and named-sticker rendering.
- Video and data are DTLS/SRTP encrypted; DTLS fingerprint travels inside the
  sealed SDP.
- Star topology: only the presenter's browser learns viewer IPs (and each
  viewer learns the presenter's). The share dialog states this.

## 5. Repository, language, tooling

Answers recorded from the design session: **JS/TS, CMake only wraps it.**

```
packages/
  collab-session/      copied from nymph (JS + .d.ts), adapted per 4.1
  collab-whiteboard/   copied from nymph (JS + .d.ts), adapted per 4.2
  defaults/            tracker list, ICE servers, limits, fps presets (TS)
extension/             MV3 extension (spec/02, spec/03) — TypeScript
viewer/                static viewer site (spec/04) — TypeScript
tests/                 unit (Vitest), browser e2e (Vitest + playwright-core driving
                       Chrome), local fake tracker
CMakeLists.txt         top-level entry: target `check` calls npm; ctest runs Vitest
                       (`inkpad_add_test`); `extension`/`viewer` targets come with
                       projects 02 and 04
```

- npm workspaces, TypeScript (strict), Vitest, playwright-core driving an
  installed Chrome (also with the unpacked extension, from project 02), ESLint
  + Prettier. esbuild bundling arrives with the extension and viewer.
- The C++ skeleton (`include/`, `src/`, `app/`, `.clang-format` rules in
  `CLAUDE.md`) is **retired** in the first plan step; CLAUDE.md's C++ style,
  GoogleTest and `inkpad_add_test` sections are replaced by JS/TS equivalents
  (`inkpad_add_test` is a ctest wrapper over Vitest files). `extern/` and the
  googletest submodule are removed.
- No runtime dependencies in the shipped extension and viewer beyond the two
  copied packages (keeps the Web Store review and the Pages payload small).

## 6. Testing strategy

- Unit: framing, sealing, whiteboard merge/convergence, board-unit math,
  permission enforcement.
- Integration: host + N guests over `createMemoryNetwork` and a local fake
  WebTorrent tracker (WebSocket, port 0). No public trackers in CI.
- E2E: Playwright launches Chromium with the extension, opens a fixture page,
  starts sharing, opens the viewer in a second context, asserts video frames
  arrive and drawings sync both ways. Real NAT/TURN/public-tracker checks are
  a manual checklist (`docs/manual-testing.md`).

## 7. Open risks

1. Overlay appears in captured video — see `spec/03_tab_streaming/DESIGN.md`
   section 3; gated by plan step 1 of that project.
2. Public trackers may disappear or rate-limit; mitigated by several trackers
   plus manual codes (carried over from nymph).
3. Viewers behind symmetric NAT need TURN; v1 ships STUN only, TURN optional.
