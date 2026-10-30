# 06_static_presenter - presenter as a static web page

Builds on `spec/01_core_features/DESIGN.md` (session, presenter role),
`spec/02_presenter_extension/DESIGN.md` (`ShareHost`, console),
`spec/03_tab_streaming/DESIGN.md` (video parameters) and
`spec/04_viewer_site/DESIGN.md` (the viewer app and the Pages site).

## 1. Purpose and scope

The presenter side as a page of the same static site as the viewer
(`<site>/present.html`). The presenter opens it, presses **Start sharing**, and
the browser's own picker (`getDisplayMedia`) offers a tab, a window or a whole
screen. The chosen surface is the video; the page is host **and** console in one.
No extension is needed, and native applications can be shared (the extension can
only capture tabs).

Why: the extension's only job was getting a tab stream, and the console had to
be a separate window anyway (`spec/02` section 1: a drawing on the shared page
would be captured). Everything else it does is already browser-neutral code.

Out of scope: audio (as in `spec/03`), phones as presenters (no
`getDisplayMedia`), an always-on-top console (section 6).

The Chrome extension this page replaces was removed (section 8).

## 2. Components

| Piece | Where | Responsibility |
|---|---|---|
| `ShareHost` | `viewer/src/share-host.ts` | Host session, `stage` messages, lock, kick, pause; ignores everything but `wb` from guests |
| Display capture | `viewer/src/display-capture.ts` | Opens the picker, reports the surface kind, size and when the user stops sharing; pure helpers for the size limit and the warnings |
| Presenter page | `viewer/src/present.ts`, `present.html` | Start screen, host session, preview video with the whiteboard over it, panel, link |

### One page, no second peer

In the extension the console joins the host as a *guest* with the presenter key.
Here the page *is* the host: the whiteboard is created on the host session (the
whiteboard already supports the host role, it serves late joiners), so the
presenter's drawing needs no round trip and the preview is the local stream with
no delay. Consequences:

- No console link and no presenter key handshake; the panel calls `ShareHost`
  directly. The panel has the same controls as the console's.
- No board keeper: the whiteboard on the host session keeps the board. `ShareHost`
  takes a `clearBoard` callback (`Whiteboard.clear`).
- The viewer link uses the page's own origin and path (`present.html` replaced by
  the site root), so a self-hosted site works without settings.

## 3. Capture

`navigator.mediaDevices.getDisplayMedia` with `video: true`, `audio: false`,
`selfBrowserSurface: 'exclude'` (the presenter page is not offered, it would film
itself), `surfaceSwitching: 'include'` (Chrome's "share this tab instead") and
`monitorTypeSurfaces: 'include'`. The video constraint carries `cursor`
(`always`, `motion` or `never`) from the settings, so the mouse pointer is
optional in the shared video; it is applied when the picker opens, hence at the
next **Share again**, and a browser or source may ignore it.

Unlike `spec/03` there is **no canvas relay**: the track goes straight to the
senders. The relay needed timers, and a background tab's timers are throttled;
the presenter page is usually in the background while the shared window is in
front. Frame rate and bitrate come from the sender parameters
(`session.mediaParams`, already used). The size limit of the video settings
becomes `scale` (>= 1, computed from the track's own size by `fitScale`), so a 4K
screen is sent reduced and a small one is never upscaled.

Risks, confirmed by hand (`docs/manual-testing.md`): a still screen delivers a
first frame to a late joiner (Chrome refreshes screencast frames when a sink is
added); the frame rate holds with the page in the background.

### When the source ends

The user clicks the browser's "Stop sharing", or the shared window closes: the
track `ended`. The session stays open, the stage becomes `paused`, the page says
the capture ended and offers **Share again** (new picker, same session, same
link). **End session** closes everything.

### Seeing yourself

Window and tab sharing capture only that surface, so the page can sit next to or
over it. Sharing a **whole screen** captures the page too when it is on that
screen (a hall of mirrors). The page reads `displaySurface` from the track
settings and warns on `monitor` (`surfaceWarning`): put this window on another
screen, or share a window or tab instead.

## 4. Page behaviour

1. **Start**: name and colour (kept in `localStorage`), "viewers may draw", and
   **Start sharing** with the notice that everything in the chosen surface is
   visible to anyone with the link. The picker opens from this click (a user
   gesture is required).
2. **Live**: full-window preview with the whiteboard over it and its toolbar; a
   bar with **Copy viewer link**, the number of people and the panel (viewers
   with Remove, Viewers can draw, Lock, Pause/Resume, Share again, Clear, End).
   Shows the warnings of section 3.
3. **Ended**: "Session over" with **Start again**.

Closing the page ends the session (viewers see `host-gone`).

`present.html?tr=wss://...` (repeatable) replaces the public trackers, and the viewer
link then carries them (the same `tr` rule as `spec/01_core_features/DESIGN.md`).

### QR code of the link

**QR code** in the controls opens a dialog with the viewer link as a QR code (black on white
with its quiet zone, error correction M, drawn as one SVG path; `viewer/src/qr.ts`, encoded by
the `qrcode-generator` package) so a phone or tablet joins by pointing its camera at the screen.
It shows the link as it is when the button is pressed (so after **New link** too), and **Copy
image** puts a PNG of it on the clipboard. A link too long for a QR code (many custom trackers)
is refused with a message.

### A board without video

**Start a board without video** starts the same session with no capture: `ShareHost.start({video:
false})`, no `setMedia`, and the `stage` message says `video: false` plus a `background`
(`whiteboard`, `blackboard`, `wall`, `cork`; the presenter picks it, viewers cannot). Both pages
then hide the `<video>` and show a sheet of the stage's aspect (16:9 unless a capture said
otherwise), letterboxed in the window, with that background (`viewer/src/sheet.ts`: CSS gradients
and inline SVG noise and lighting filters, no image files; the wall and cork multiply a lit rough surface over their colour). The `<video>` and the sheet sit in one `#zoom` element,
which is what the wheel zooms, so the drawings stay on the sheet. Pause, Share again and the
video limits do not apply; adding video to a running board is not supported.

### Link lifetime

The WebTorrent tracker protocol has no time to live a client can set: a tracker forgets a peer
when it stops announcing or on its own schedule. `trackerTtlMinutes` (default 60, 0 = no
limit) is how long the host stays announced (`ttlMs` of the `torrent` rendezvous); then it
sends `event: stopped` and stops, the page shows that the link expired, and **New link**
(a new token, a new announce) lets more people in. People already connected stay.

### Settings and folding

The dialog is a compact window with three tabs (**General**, **Video**, **Connection**;
arrow keys move between them) and a fixed button row (Restore defaults, Cancel, Save),
so it fits without scrolling on a laptop and on a phone-sized window.

A **Settings** dialog (start screen and live panel) holds the
settings (name, colour, viewers may draw, frame rate, size and bitrate limits,
trackers, link lifetime, avatar, ICE servers) plus the pointer mode, validated by
`cleanSettings` and kept in `localStorage` (`viewer/src/present-settings.ts`).
Video limits reach a running share at once (`mediaParams`); the rest applies from
the next session (connection, name) or share (pointer).

The **Tools** button folds the whiteboard toolbar away and **Controls** folds the
panel, so neither hides the view; both states are remembered. Folding the tools
also returns to the pointer tool. The toolbar lives in the whiteboard's shadow
root and is hidden with `display: none`, not the `hidden` attribute (the board
stops redrawing a hidden toolbar).

## 5. Security and privacy

- Same posture as the viewer: no server, token only in the fragment, the CSP of
  the viewer, no analytics.
- The picker is the browser's: the page cannot capture anything the user did not
  choose, and the browser shows its own "sharing" indicator.
- The viewer link carries no presenter key; there is none.

## 6. Not done here, and why

- **Live pointer change**: `applyConstraints({cursor})` is not reliable across browsers.

- **Always-on-top console** (Document Picture-in-Picture): the whiteboard binds to
  its own document; moving it to a second document needs work in the copied
  whiteboard code. For a screen share the PiP window would also be captured.
- **Audio**: `getDisplayMedia` can carry tab or system audio; the session would
  send it as a second track. Later.

## 7. Testing

Unit (Vitest): `fitScale`, `surfaceWarning`, and `ShareHost` without a tab and
without a keeper. Browser (Chrome, local fake tracker, `getDisplayMedia` replaced
by a canvas stream, since the real picker cannot be driven): the built
`present.html` starts a session, a viewer joins through `index.html`, video
arrives, drawings go both ways, pause and end reach the viewer. The real picker is
on the manual checklist.

## 8. Removal of the extension

The extension (`spec/02_presenter_extension`) was removed once the page worked:
the page does the same, also shares windows and native applications, and needs no
store listing, no permissions and no second code path. What went with it:

- the extension itself (service worker, offscreen document, popup, options, the
  tab-capture canvas relay, the share state machine and its `chrome.*` settings
  storage), its build, audit and packaging scripts, the release workflow and the
  Web Store text;
- the **presenter console** as a separate guest, so the **presenter key**, the
  `ctl` channel (`auth`, `role`, commands), `?presenter=` in links and the
  `viewer.html` console mode. The host page calls `ShareHost` directly, and the host
  now ignores everything a guest sends outside `wb`;
- the **board keeper**: the page's own whiteboard on the host session keeps the
  board for late joiners.

What stayed: `ShareHost` (now `viewer/src/share-host.ts`, without tab, key or
keeper), the validation of settings (`viewer/src/settings.ts`, minus the
`chrome.storage` part), and the session and whiteboard packages. The viewer's
browser tests, which used the extension as a host, now use the presenter page
(`tests/support/presenter-site.ts`).

The viewer also gets a **Tools** button that folds the whiteboard toolbar away
(remembered in `localStorage`), like the presenter page; both share
`viewer/src/fold.ts`.
