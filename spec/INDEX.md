# Specification index

One row per project. Add a row when you create a project folder; update
the status and topics as it progresses. See "spec/" in `CLAUDE.md`.

| Project | Status | Summary | Topics |
|---|---|---|---|
| [01_core_features](01_core_features/) | Implemented | Product definition, architecture, JS/TS repo setup, and the collab core copied from nymph (serverless session + whiteboard). | architecture, collab-session, whiteboard, security, tooling, testing |
| [02_presenter_extension](02_presenter_extension/) | In progress | MV3 Chrome extension: captures the tab, hosts the session, gives the viewer and console links, popup and settings. No overlay on the page. | extension, popup, permissions, options, console |
| [03_tab_streaming](03_tab_streaming/) | In progress (capture works; load test open) | Tab capture and low-fps configurable WebRTC video; the overlay-in-video spike that led to the console design. | tabCapture, WebRTC, fps, bitrate, codecs |
| [04_viewer_site](04_viewer_site/) | In progress (viewer and console work; Pages deployment and version mismatch open) | The viewer app: video plus interactive whiteboard, on GitHub Pages and inside the extension; with the presenter key it is the presenter console. | viewer, console, GitHub Pages, mobile, CSP, versioning |
| [05_release_pipeline](05_release_pipeline/) | Implemented, workflows untested | CI, Pages deploy, extension packaging and release. | CI, release, Web Store, privacy |
| [06_static_presenter](06_static_presenter/) | Implemented, manual picker checks open | The presenter as a static page: the browser's picker (tab, window, screen) as video source, host and console in one page; no extension needed. | presenter, getDisplayMedia, GitHub Pages, native apps |
