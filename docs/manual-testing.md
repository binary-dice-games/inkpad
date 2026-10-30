# inkpad — Manual testing

Automated tests run on one machine with a fake tracker. These checks need real
networks and are done before a release. Record the date, browsers and result
in the release notes.

## Setup

Two machines (or one machine and a phone) on **different networks**, the
presenter on Chrome.

## Checklist

| # | Check | Expected |
|---|-------|----------|
| 1 | Presenter starts a share and copies the link; viewer opens it | Viewer joins within ~10 s; presenter sees one viewer |
| 2 | Public trackers: block all but one in settings, retry | Still joins |
| 3 | Block all trackers (offline DNS) | Viewer shows `no-tracker` after ~30 s; manual codes join |
| 4 | Viewer on a phone hotspot (symmetric NAT likely) | Joins, or reports `ice-failed`; with TURN configured it joins and `path` is `relay` |
| 5 | Viewer behind a corporate proxy blocking `wss` | Reports `no-tracker`; manual codes work |
| 6 | Viewer on Firefox, Safari (macOS and iOS), Chrome Android | Video plays, drawing works |
| 7 | 10 viewers at the default 3 fps / 600 kbps | No link drops in 5 minutes; presenter uplink about 6 Mbps |
| 8 | Presenter closes the laptop lid for 20 s, reopens | Viewers reconnect or see "presenter left" after 60 s |
| 9 | Presenter locks viewers' drawing | Viewers' tools disable; a modified client's strokes are dropped |
| 10 | Presenter generates a new link | Old link no longer joins; current viewers stay |
| 11 | Tracker view: inspect the tracker's traffic | Only opaque sealed payloads; no token, no SDP |
| 12 | On `present.html`, **Start sharing** and pick a tab | The page shows the tab's video with the board on top; the shared tab shows nothing extra; the viewer link is given |
| 13 | Draw on the presenter page with a mouse, and with a pen or touch (a tablet) | Strokes appear on viewers' screens at once; the video follows a moment later |
| 14 | Resize the shared window, or change its zoom | The viewers' video takes the new shape within a few seconds; drawings keep their place on screen |
| 15 | Share a tab, then navigate it to another site | The share goes on |
| 16 | Share a page that plays video or animates | Frame rate stays near the setting; the presenter's CPU stays reasonable |
| 17 | Reload the presenter page | The session ends (viewers see "presenter left"); **Start sharing** makes a new link |
| 18 | Keep the presenter page in the background while the shared window is in front | Viewers keep getting frames |
| 20 | Viewer on a network that blocks the tracker, joining with a code | The code, the answer and Connect work; video and drawing follow |
| 21 | Viewer with a screen reader and keyboard only | Join form, toolbar and people list are reachable and named |
| 22 | Share a page full of small text (a code editor, a document) on a 1440p or 4K screen, and a HiDPI laptop | The viewer reads the text at full size within a second or two of the page going still; moving content may be soft meanwhile |
| 23 | Open `present.html`, **Start sharing**, pick a tab / a window / a whole screen / a native app | The picker offers all four and not the presenter page's own tab; a viewer joins and sees the choice; sharing a whole screen shows the "whole screen" warning |
| 24 | Presenter page: share a still window (nothing moving), then join a viewer after a minute | The late viewer gets a first frame within a few seconds |
| 25 | Presenter page: put the page in the background (shared window in front) for 5 minutes while the shared window animates | Viewers keep getting frames at about the set rate; their drawings still reach the page |
| 26 | Presenter page: click the browser's "Stop sharing", then **Share again** | Viewers see "paused", then the new source on the same link |
| 27 | Presenter page: Settings, mouse pointer **Hidden**, then share a window and move the mouse over it | Viewers do not see the pointer; "Always shown" brings it back at the next **Share again** |
| 28 | Fold **Tools** and **Controls** on the presenter page, and **Tools** on the viewer; reload | The toolbar and panel stay out of the way and come back with their buttons; the choice is remembered |
| 29 | On a viewer and on the presenter page press 2, 2, 2, 2, then 3, 3 and 4, 4, 6 | The line goes thin/normal/thick, text small/medium/large, the sticker and colour change; the toolbar icons show the choice |
| 30 | Draw a line and a sticker, drag them, right click them; try someone else's | Yours move and disappear; theirs do not. Shift+drag scales and Ctrl+drag turns a sticker |
| 31 | Drop a photo from the file manager on the board (viewer and presenter); move, turn, delete it | It appears for everyone, and late joiners see it |
| 32 | Wheel over a spot of a busy video, draw, zoom out | The zoom is centred on the pointer; drawings stay on the same part of the picture |
| 33 | Two viewers with different tools and one with an avatar | Others see each tool's cursor shape; the avatar replaces the name |
| 34 | Three people ask for a turn; the first ends it; the presenter removes the second | The queue in the lower left updates everywhere; the speaker's cursor is larger, with a pulsing border on its name tag or avatar |
| 35 | Set the link lifetime to 1 minute, start, wait, try to join | The page says the link expired and the join fails; **New link** works for a new viewer |
| 36 | **Start a board without video**; a viewer joins; the presenter cycles the background | Viewer and presenter show a sheet (no video, no waiting message); whiteboard, blackboard, wall and cork follow on both |
| 37 | Drop a photo, a PDF, a zip, a text file and a 10 MB file on the board | The first four are pinned (border, shadow, pin) with previews; the big one is refused with a message |
| 38 | On a viewer, drag a pinned PDF onto the desktop, a folder, and a mail or chat web page; double click another | A copy with the right name and contents lands (the desktop and folder in Chrome or Edge; web pages in Chrome and Firefox); double click downloads it |
| 39 | Join a viewer after files were pinned | The late viewer sees the prints and can drag the files out within a few seconds |
| 40 | Drop a PDF, a .docx, a .pptx and an .xlsx on the board | The cards show the first page of the PDF and the thumbnail or the first lines of the others; an old .doc shows only the card |
| 41 | Presenter controls: **QR code**; scan it with an iPad or phone camera | The device opens the viewer link and joins; **Copy image** pastes a QR image into a chat or document |
| 42 | Press 6 repeatedly and draw with white on the blackboard and on the whiteboard | The eighth colour is white; it is visible on the blackboard, and white text has a dark outline on light backgrounds |
| 19 | Pause, resume, clear and end from the presenter page | Viewers see the placeholder, the video, an empty board and the end message |

## Known untested areas (from nymph)

Public trackers over time, real NATs, Firefox, Safari, phones and TURN: these
are what this checklist covers.
