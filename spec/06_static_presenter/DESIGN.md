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
`getDisplayMedia`), an always-on-top console (section 6), removing the extension.
The extension stays as an optional front-end for tab capture.

## 2. Components

| Piece | Where | Responsibility |
|---|---|---|
| `ShareHost` | `extension/src/share-host.ts` (shared) | Host session, `ctl`/`stage` messages, lock, kick, pause. Usable without a tab and without a board keeper |
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
  takes `keeper: false` and a `clearBoard` callback (`Whiteboard.clear`).
- The viewer link uses the page's own origin and path (`present.html` replaced by
  the site root), so a self-hosted site works without settings.

## 3. Capture

`navigator.mediaDevices.getDisplayMedia` with `video: true`, `audio: false`,
`selfBrowserSurface: 'exclude'` (the presenter page is not offered, it would film
itself), `surfaceSwitching: 'include'` (Chrome's "share this tab instead") and
`monitorTypeSurfaces: 'include'`.

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

Settings: name, colour and "viewers may draw" in `localStorage`; trackers, ICE
servers and video limits are the defaults of `packages/defaults` (the options
page of the extension does not apply here; a settings panel is a later addition).

## 5. Security and privacy

- Same posture as the viewer: no server, token only in the fragment, the CSP of
  the viewer, no analytics.
- The picker is the browser's: the page cannot capture anything the user did not
  choose, and the browser shows its own "sharing" indicator.
- The viewer link carries no presenter key; there is none.

## 6. Not done here, and why

- **Always-on-top console** (Document Picture-in-Picture): the whiteboard binds to
  its own document; moving it to a second document needs work in the copied
  whiteboard code. For a screen share the PiP window would also be captured.
- **Audio**: `getDisplayMedia` can carry tab or system audio; the session would
  send it as a second track. Later.
- **Removing the extension**: it still provides the shortcut and tab capture with
  no picker. Nothing in this project depends on it.

## 7. Testing

Unit (Vitest): `fitScale`, `surfaceWarning`, and `ShareHost` without a tab and
without a keeper. Browser (Chrome, local fake tracker, `getDisplayMedia` replaced
by a canvas stream, since the real picker cannot be driven): the built
`present.html` starts a session, a viewer joins through `index.html`, video
arrives, drawings go both ways, pause and end reach the viewer. The real picker is
on the manual checklist.
