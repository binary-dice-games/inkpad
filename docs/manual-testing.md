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
| 12 | Share a tab from the popup (a real click), then **Open console** | The console opens in its own window, joins, shows the tab's video; the shared page shows nothing extra |
| 13 | Draw in the console with a mouse, and with a pen or touch (tablet console link) | Strokes appear on viewers' screens at once; the video follows a moment later |
| 14 | Resize the shared window, or change its zoom | The viewers' video takes the new shape within a few seconds; drawings keep their place on screen |
| 15 | Share a tab, then navigate it to another site | The share goes on; after a cross-origin navigation a later resize keeps the old video shape |
| 16 | Share a page that plays video or animates | Frame rate stays near the setting; the presenter's CPU stays reasonable |
| 17 | Close the console window, reopen it with **Open console** | Drawings are still there |
| 18 | Switch to the console tab while the shared tab stays in the background | Viewers keep getting frames |
| 19 | Pause, resume, clear and end from the console | Viewers see the placeholder, the video, an empty board and the end message |

## Known untested areas (from nymph)

Public trackers over time, real NATs, Firefox, Safari, phones and TURN: these
are what this checklist covers.
