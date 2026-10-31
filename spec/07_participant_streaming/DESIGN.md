# 07_participant_streaming - anyone can stream, the host picks what is on screen

Builds on `spec/01_core_features/DESIGN.md` (star session, board units, `stage`, section 4.1
media hooks), `spec/03_tab_streaming/DESIGN.md` (video parameters, codecs) and
`spec/06_static_presenter/DESIGN.md` (the presenter page, display capture, backgrounds per
canvas, a board without video). Where this document and those disagree, this one wins.

## 1. Purpose and scope

Today only the host (presenter) shares a video, chosen on the start page, and a session either
has video for its whole life or none. This project makes video a thing anybody does at any time
during a session:

- Every participant (host and guests) has a **Share screen / Stop sharing** button. It opens the
  same browser picker the host uses today (`startDisplayCapture`, `spec/06` section 3).
- Several participants may offer a stream at once; **one stream is active** at a time. The host
  picks it from a list of the streams on offer (or none).
- A new canvas background, **screen**, shows the active stream, or black when none is active.
- The star stays: a guest sends its stream only to the host; the host sends only the active
  stream to everybody. To keep latency low the host **forwards the encoded frames of a guest's
  stream as they arrive**: no decoding, no re-encoding, no jitter buffer on the relay path.
- The start page only starts a session. Every session starts as a board; streams come and go
  inside it.

Out of scope: audio, more than one stream shown at once (picture in picture, grids),
simulcast or per-viewer quality, phones as senders (no `getDisplayMedia`; the button is hidden
there, section 7), recording.

## 2. Vocabulary

| Term | Meaning |
|---|---|
| **Stream** | One participant's display capture, identified by its owner's peer id (one stream per participant). |
| **Offered** | The owner is capturing and the host knows; nothing is sent unless the host asks (section 5.3). |
| **Previewed** | Sent to the host only, so the host can look before showing it. At most one at a time. |
| **Active** | The stream on the screen background, sent to everybody. At most one per session. |
| **Uplink** | A guest's send-only video transceiver to the host (new). |
| **Downlink** | The host's send-only video transceiver to each guest (exists today). |

## 3. User experience

### 3.1 Start page

One action: **Start session** (name, colour, "viewers may draw", Settings, as today). The
**Start sharing** and **Start a board without video** buttons go; the notice about what the
picker exposes moves to the share button (section 3.2). The backup dialog (Resume / Start new)
is unchanged.

### 3.2 Share button (everyone)

In the bar of both pages: **Share screen**. Pressing it opens the picker (the click is the user
gesture the picker needs). Once a surface is picked the button reads **Stop sharing**, and a
small status shows the stream's state for its owner: *Offered* ("the presenter can show it"),
*Previewed by the presenter*, or *On screen for everybody*. The page warns about a whole-screen
share as today (`surfaceWarning`). The browser's own "Stop sharing" and closing the shared window
end the stream like the button does. Starting and stopping can happen any number of times.

The first press in a page shows, once, the notice "Everything in what you share can be shown to
everyone in this session" with **Continue** / **Cancel**.

### 3.3 Streams list (host only)

A **Screen** section in the host panel:

- One row per offered stream: owner name and colour, surface kind (tab, window, screen) and size,
  with **Preview** (toggle) and **Show**. The host's own stream is listed like any other (marked
  "you"); it previews locally at no cost.
- A **None** row: no active stream (the screen background goes black).
- The active row is highlighted; **Show** on another row switches.
- The preview appears as a small video in the panel.

When a stream becomes active and the canvas the host is on does not show **screen**, the panel
offers a one-click "Show the screen on this canvas" (it does not change backgrounds by itself,
the host may want the stream on another canvas).

Automatic choices (the host can always change them):

- The host's own new stream becomes active when nothing is active (the host pressed the button,
  the intent is clear).
- A guest's stream never becomes active by itself; the host gets a toast "Ana offers a screen"
  with **Preview** and **Show**.
- When the active stream ends (owner stops, leaves or is removed) the active stream becomes
  none; there is no automatic fallback to another stream.

### 3.4 Screen background

`screen` joins whiteboard, blackboard, wall and cork in **Background of canvas N** and replaces
today's `video` value. It shows the active stream's video letterboxed (object-fit contain) in the
board frame on black, or plain black when none is active (with a faint "Nothing is being shared"
for the host only). The `<video>` and the sheet stay in the `#zoom` element, so zoom and layout
work as today.

Default backgrounds: canvas 1 `screen`, then whiteboard, blackboard, wall, cork. Canvas 1 being
black at the start is the cost of "share and it shows" working with no extra click. (Open
question 1.)

### 3.5 Frame aspect

Board units depend on the frame's aspect (`spec/01` section 4.2). Today the aspect follows the
capture; with streams switching, the drawings would jump at every switch. So the **board frame
has a fixed aspect for the whole session**: 16:9 (`STAGE_ASPECT`), and each stream is letterboxed
into it. Boards opened from a file keep their own aspect if they carry one. (Open question 2.)

### 3.6 Owner's own view

The owner of the active stream is not sent its own stream back (it would only waste its
downlink): its screen background shows its local capture (`srcObject` = its own stream), as the
host page does today for the host. Everybody else gets the relayed copy.

## 4. Architecture

```
 guest A (source) --uplink: encoded VP8--> HOST --downlink, same frames--> guest B, C, ...
                                            |  (encoded transform: no decode, no jitter buffer)
                                            +--> decoder (only for the host's own view)
 guest D (offered, not asked) --uplink paused (encodings active:false)--> HOST
```

### 4.1 Transceivers: no renegotiation

Links are negotiated once (the guest offers, the host answers; there is no renegotiation code in
`collab-session`, and adding it would be the largest change). So every guest offer carries **two**
video transceivers from the start:

1. `recvonly` (downlink), as today;
2. `sendonly` with no track (uplink), identified by its `mid` order (second video m-line).

The host answers the first `sendonly` (as today) and the second `recvonly`. Starting a stream is
then `replaceTrack(track)` on the uplink sender and stopping is `replaceTrack(null)`; nothing is
renegotiated. The host's own capture goes to the downlinks the same way it does today.

The second m-line changes the offer shape, so the protocol id becomes `inksplat/2` (the handshake
refuses mismatches; one Pages site serves both pages, so a mismatch is a stale tab).

### 4.2 The relay: encoded frames, forwarded

WebRTC in a browser does not expose RTP packets, but it does expose **encoded frames** through
encoded transforms (`RTCRtpScriptTransform` in a worker where available, else Chrome's
`createEncodedStreams()`, which needs `encodedInsertableStreams: true` on the
`RTCPeerConnection`). Frames reach the receiver transform once the packets of a frame are
assembled, before the jitter buffer and the decoder, and leave the sender transform to the
packetizer and pacer: this is the closest the platform comes to forwarding packets, and it adds
no decode, encode or buffering delay. On the host:

- **Receiver transform** on every uplink: each frame of the *active* stream is copied to every
  downlink's sender transform (except the source's own link) and then written on to the host's
  own decoder (which drives the host's screen and preview). Frames of a previewed stream go only
  to the decoder.
- **Sender transform** on every downlink: in *local* mode it passes the host's own encoder
  frames (the host's stream is active); in *relay* mode it drops them and writes the forwarded
  ones; with no active stream it writes nothing.
- A downlink needs a track for its transform to run: in relay mode it carries a cheap
  placeholder track (a still 2x2 track whose frames are dropped). The spike (plan step 1) picks
  the placeholder that keeps the sender running in a background tab without timers (candidates:
  `VideoTrackGenerator`/`MediaStreamTrackGenerator` written from the transform worker, a
  `captureStream` of a static canvas, the received track itself).

Rules the relay keeps:

- **One codec.** Forwarded frames are only decodable if every leg uses the same codec. The host
  answers every transceiver of every link with the session codec first: the first entry of the
  host's codec setting both sides support, **VP8 by default** (VP9 and AV1 frames carry
  dependency descriptors and scalability metadata that the spike must prove survive forwarding
  before they are allowed). A link that ends up with another codec gets the fallback below.
- **Switch on a key frame.** When the active stream changes (to or from the host's own stream as
  well), each downlink drops frames until the first key frame of the new source, so no decoder
  is fed deltas of another encoder. The host requests that key frame at once (4.3).
- **Metadata.** Forwarded frames are written with the downlink's own SSRC, payload type and a
  continuous RTP timestamp base (`setMetadata` where needed); the spike confirms what Chrome
  rewrites itself.

**Fallback** (no encoded transforms, a codec mismatch, or the spike shows a blocker on a
browser): the host attaches the received track to the downlink with `replaceTrack` and the
browser decodes and re-encodes it. It works everywhere and costs one decode, one encode per link
and a jitter buffer; the relay mode is chosen per link and logged (`relay: forward|reencode`).

### 4.3 Key frames

A decoder needs a key frame to start: when a guest begins receiving the active stream (it
joined, the active stream changed, or it lost packets and its browser sent a PLI). The host
cannot make the source's encoder produce one through the forwarding, so:

- The host's sender transform hears key frame requests (`keyframerequest` on
  `RTCRtpScriptTransformer`, where available) and forwards them to the source: on its uplink
  receiver (`sendKeyFrameRequest()`), or, where that is missing, as a `keyframe` message on the
  `screen` channel (section 5) to which the source answers with `generateKeyFrame()` or by
  toggling its encoding `active` off and on (both make Chrome send a key frame).
- A viewer whose screen shows no decoded frame 1 s after the active stream changed or it joined
  asks the host the same way (covers browsers that do not surface the PLI).
- Requests to a source are coalesced: at most one per 500 ms, so one lossy viewer cannot flood
  the source and, through it, everybody else with key frames.

### 4.4 Rate and quality

Without transcoding the source's encoder serves everybody: its rate follows its own uplink to
the host, capped by the **host's** video settings (frame rate, bitrate, size limit, content hint;
`spec/03` section 4), which the host sends to the source in the `send` command. A viewer on a
slower link than the source's loses frames and asks for key frames (coalesced, 4.3); the frame
rate is low by design (`spec/03`), so this stays within the bitrate cap. Per-viewer adaptation
would need simulcast or transcoding and is out of scope. The host's own stream keeps today's
per-link encoders.

## 5. Protocol

### 5.1 Channel `screen` (reliable)

| Message | Direction | Meaning |
|---|---|---|
| `{cmd: 'offer', surface, w, h}` | guest -> host | I am capturing (surface `browser\|window\|monitor`). Repeated on size change. |
| `{cmd: 'withdraw'}` | guest -> host | I stopped. Also implied when the guest leaves. |
| `{cmd: 'send', on, params}` | host -> one guest | Start (`on: true`) or stop sending on your uplink, with the host's `MediaParams`. |
| `{cmd: 'keyframe'}` | host -> one guest | Send a key frame now (fallback of 4.3). |
| `{cmd: 'keyframe'}` | guest -> host | I need a key frame of the active stream. |

The host's `accept` filter (`ShareHost.accept`, today `wb` only) also lets `screen` through,
checked: only the five shapes above, only from the sender's own id, an `offer` only within the
size limits. The host never relays `screen` messages (they are point to point). A guest's
`offer` gives it no power: only the host's `send` makes its uplink carry anything, and only the
host chooses the active stream.

### 5.2 Stage

`Stage` (`packages/defaults/src/index.ts`) changes:

- `video?: false` goes (every session is the same kind).
- `backgrounds` entries: `screen` replaces `video`; a stage or board file with `video` is read as
  `screen` (`cleanCanvasBackground`).
- New `screen?: {owner: string, name: string, w: number, h: number}`: the active stream, absent
  when none. Viewers use `owner` to know whether it is their own (3.6) and to show "Ana is on
  screen"; `w`/`h` lay out the letterbox before the first frame.
- `aspect` is the fixed frame aspect (3.5), no longer the capture's.
- `state` keeps `live | ended`; `paused` goes (choosing **None** is the pause).

### 5.3 Who sends what

| Stream state | Owner's uplink | Host downlinks |
|---|---|---|
| Offered | track attached, encoding `active: false` (nothing on the wire) | - |
| Previewed | `active: true` | - |
| Active | `active: true` | forwarded frames, except to the owner |

Keeping offered streams paused bounds the host's downlink bandwidth to two incoming streams
(active + preview) however many people offer, and nobody's screen leaves their machine before
the host asks. Switching from offered to sending costs one message round trip and one key frame.

## 6. Components

| Piece | Where | Change |
|---|---|---|
| `MediaController` | `packages/collab-session/collab-session.js` (nymph copy) | Uplink transceiver in guest offers; host receives uplinks; encoded-transform hooks; record in the header |
| `Session` API | `collab-session.d.ts` | New calls below |
| Relay | `viewer/src/relay.ts` (+ `relay-worker.ts` for `RTCRtpScriptTransform`) | Frame forwarding, key frame gating and coalescing, mode per link |
| `ShareHost` | `viewer/src/share-host.ts` | Streams list, active / preview state, `screen` channel, stage changes |
| Stream sharing (both pages) | `viewer/src/share-button.ts` (new) | Button, picker, owner status, `screen` messages on the guest side |
| Backgrounds | `packages/defaults`, `viewer/src/sheet.ts` | `screen`, black fill, fixed aspect |
| Pages | `present.ts`/`.html`, `main.ts`/`index.html` | Start page reduced, share button, host Screen panel |

New `Session` API (contract; the d.ts gets TSDoc):

```ts
// guest
setUplink(stream: MediaStream | null): void;            // own capture on the uplink, paused
uplinkParams(params: MediaParams & { active: boolean }): void;
// host
on(event: 'uplink', cb: (peerId: string, stream: MediaStream | null) => void): () => void;
setRelay(source: { peerId: string } | { local: true } | null): void; // what downlinks carry
requestKeyFrame(peerId: string): void;
// both
on(event: 'keyframe-request', cb: (from: string) => void): () => void;
```

`setMedia(stream)` stays as the host's local capture (used when `setRelay({local: true})`).
`createSession` gains `encodedTransforms?: boolean` (default on where supported) so tests can
force the fallback.

### Why the relay code lives in the session package

The transforms have to be attached when the transceivers are created (Chrome's legacy API needs
the peer connection flag at construction and `createEncodedStreams()` before any frame), which
only `MediaController` sees. The forwarding logic itself (which source, key frame gating) is
inksplat's and sits in `viewer/src/relay.ts`, passed to the session as a small interface, so the
change to the copied file stays small.

## 7. Platform notes

- Picker: desktop Chrome, Edge, Firefox, Safari. Phones and tablets have no `getDisplayMedia`:
  the share button is hidden there (feature check, not user agent), they still watch and draw.
- Encoded transforms: `RTCRtpScriptTransform` in Firefox and Safari, and in recent Chrome; older
  Chrome only has `createEncodedStreams()`. Only the host needs them for forwarding; sources and
  viewers need nothing special (they send and receive normal VP8), except the fallback key frame
  path. A host without either uses the re-encode fallback.
- Background throttling: the relay is event driven (frames arrive, frames are written); no timers
  on the frame path, in line with `spec/06` section 3.

## 8. Security and privacy

- A guest's screen leaves its machine only after it picked a surface **and** the host asked for
  it (preview or active); the owner always sees which (3.2). The host sees a preview before
  showing it to everyone.
- The host stays the only one who decides what everyone sees; guests cannot set the active
  stream, backgrounds or relay anything.
- The owner can stop at any time and the host can switch to None or remove a participant
  (removal withdraws its stream).
- Forwarded frames are opaque bytes to the host's code: it never parses them beyond the key
  frame flag in the metadata.
- Media stays DTLS-SRTP encrypted per link; the host can see every stream it relays, as today it
  sees every drawing.

## 9. What changes for existing features

- **Pause / Resume** go; **None** in the Screen list replaces them.
- **Share again** goes; Stop sharing + Share screen replace it, for anyone.
- **Start a board without video** goes; every session starts that way.
- Video settings (frame rate, bitrate, size, codec, pointer) stay host settings; for a guest's
  stream they travel in `send` (pointer is the owner's own: it applies at the owner's picker).
- Save as PNG/SVG of a `screen` canvas draws the current frame of the active stream (as `video`
  does today) or black.
- Board files: `settings.json` backgrounds with `video` read as `screen`; the format version
  stays 1.

## 10. Testing

Unit (Vitest): `screen` message cleaning and the host's accept filter; `ShareHost` stream state
(offer, preview, show, withdraw, leave, remove, host's own stream auto-active); stage with
`screen`, `video` read as `screen`, defaults; relay logic with fake frames (forward to all but
the source, drop until key frame on switch, key frame request coalescing, mode per link).

Browser (Chrome, fake tracker, `getDisplayMedia` replaced by canvas streams with distinct
colours, as in `spec/06` section 7): a host and two guests; guest A shares, the host previews and
shows it, guest B sees A's colour on a screen canvas and A sees its own; switching to the host's
stream and to None (black); A stops and the screen goes black; a guest joining late gets a
picture (key frame path); the forwarding mode is `forward` with transforms and `reencode` when
forced off, and both deliver video. A latency check: frame stamps drawn into the canvas source
are read back at guest B and compared between forward and reencode (forward must not be slower).

Manual (`docs/manual-testing.md`): real picker on each desktop OS, two networks, a lossy viewer
(key frames coalesced, others unaffected), Firefox and Safari as host.

## 11. Risks and open questions

Risks (settled by plan step 1, the spike):

- Writing a frame received on one peer connection into a sender of another: supported by Chrome
  for its own transform API; payload type, SSRC and timestamp handling must be confirmed per
  browser.
- Keeping a downlink sender running with a placeholder track in a background tab.
- Key frame request APIs differ per browser (`keyframerequest`, `sendKeyFrameRequest`,
  `generateKeyFrame`); the data channel fallback covers the gaps.

Open questions (default in brackets, used unless the user decides otherwise):

1. Canvas 1 defaults to `screen` (black until something is shown). [yes]
2. Fixed 16:9 frame for every session; alternative: the first active stream sets the aspect and
   later ones letterbox. [fixed 16:9]
3. Should the host be able to ask a guest to stop sharing (rather than just not showing it)?
   [no: the host can show None or remove the guest]
4. Should offered streams send a 1 fps thumbnail so the list has pictures without a preview?
   [no: bandwidth and privacy; Preview is one click]
