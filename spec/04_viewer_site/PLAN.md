# 04_viewer_site — implementation plan

Design: [DESIGN.md](DESIGN.md). Depends on `01_core_features` steps 1–3.

## Step 1 — Shell, join flow and status handling

**Goal:** Page that joins a session and reports status.
**Deliverables:** landing page, fragment parsing, name/colour form, guest
session, status messages, manual-code fallback UI.
**Tests:** status mapping unit tests; e2e join against a host in the fake
tracker network; invalid token.
**Result:** Done. Landing page, name and colour form (remembered in
`localStorage`, with a guard for blocked storage), join over the default trackers
(or the ones in the link), friendly messages for every session state and error
(`viewer/src/model.ts`, unit tested), and end-to-end joins in Chromium against
the real extension. **Join codes** for networks that block the trackers: the
viewer makes a code on the waiting screen, the presenter pastes it under "Join
codes" in the popup and sends the answer back (`ShareHost.acceptCode`); tested
end to end with no tracker reachable, and a damaged code gets a message.

## Step 2 — Video stage and aligned whiteboard

**Goal:** Video with whiteboard overlay aligned to it.
**Deliverables:** `<video>` stage, letterbox rectangle math, whiteboard
adapter, placeholders, fullscreen.
**Tests:** rectangle math across aspects/resizes; e2e alignment of a drawn item
with a known fixture frame position.
**Result:** Done. Video in a letterboxed stage, the whiteboard laid out on the
video's own aspect (the `stage` aspect before the first frame), placeholders for
waiting, paused and ended, full screen. Verified that the video follows the
tab's aspect, and that a drawing lands at the same place of the frame (within 2%
of its position and size) in a 1280x720 console and a 700x900 viewer.

## Step 3 — Toolbar, permissions, mobile

**Goal:** Full viewer interaction.
**Deliverables:** shared toolbar, drawing-disabled state, people list, touch
handling, quality hint, accessibility pass.
**Tests:** locked viewer cannot draw (and ops are rejected host-side);
mobile-emulation drawing e2e.
**Result:** Done. The package toolbar, the drawing-disabled state, a list of who
is here with a connection hint (direct or relayed, as the host measured it), the
whole presenter console panel (kick, drawing, lock, pause, clear, end; a wrong key
falls back to a viewer) and a narrow-screen layout. End-to-end tests include
touch drawing on a phone-sized emulated screen (CDP touch events, no sideways
overflow) and an axe-core run on the join form, the session, the console panel
and the landing page, which found and fixed two contrast problems (the teal
primary button and the red danger button) and a missing landmark. Not tested:
a real phone or other browsers (manual checklist), screen-reader use.

## Step 4 — Versioning and CSP

**Goal:** Safe, compatible hosting.
**Deliverables:** protocol-mismatch screen with versioned paths, CSP meta,
size-budget check.
**Tests:** mismatch e2e with a stub host reporting another `protocol`; CSP
violations fail the e2e run; size budget in CI.
**Result:** Partly done. Content security policy in a `<meta>` tag (no
violation on the viewer or the console in the end-to-end test) and a bundle of 68
KB (22.7 KB gzipped) checked against the 150 KB budget by a test. Not done: the
protocol-mismatch screen and versioned paths. Finding: a viewer on another
protocol version never sees a mismatch message, because the host drops the
sealed offer (the copied nymph rendezvous checks the protocol before answering),
so the viewer waits and ends with "the presenter did not answer", whose text now
mentions another version. A real screen needs the rendezvous to answer
mismatching offers so that the `hello` can refuse with `protocol`; that is a
change to the copied session, to design together with the Pages versioning in
`spec/05_release_pipeline`.

## Field finding: offers too large for public trackers

The first real use of the deployed viewer could not connect through the trackers (join codes
worked). Cause, measured against the live `tracker.webtorrent.dev`: it relays an announce of
up to about 9 KB but not 18 KB, and with the video line an offer is 7 KB (721 bytes without),
so the guest's three offers were about 29 KB. Fix: sealed messages are deflated (about 4
times smaller; `packages/collab-session`, format flag byte). Regression test: the fake
tracker can drop announces over 12 KB (`tests/e2e/webrtc.test.ts`); without the fix the viewer
never connects. Also added: a `log` option on the session and `[inksplat]` console logging in the
viewer and the offscreen page; the default trackers now match nymph's (the third, from memory,
was replaced). Not verified: a connection through the real trackers after the fix (needs the
redeployed site; `tracker.openwebtorrent.com` relayed nothing in a synthetic probe and has
not been understood).

## Completion Criteria

- A viewer on desktop or phone can open a link, watch and draw, and sees clear
  messages for every failure state.
- Bundle within budget; deployed through the pipeline in `05`.
