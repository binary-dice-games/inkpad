# video-quality spike

Measures how sharp a text-heavy page looks to a viewer, and how fast it sharpens once the page
stops moving. It sends a 1080p/1440p/4K text scene through the same canvas relay and WebRTC path
the extension uses, between two pages of Playwright's Chromium, then compares what arrives with
the original, on the text pixels only (0 is perfect), at 1, 3, 6 and 10 seconds after the scene
went still. Results are in `spec/03_tab_streaming/DESIGN.md` section 4.

```
node spikes/video-quality/run.mjs "name:w=1920&h=1080&bitrate=2000000&hint=detail&codecs=video/AV1,video/VP8"
```

Query keys: `w`, `h` (the scene), `maxw`, `maxh` (the relay's downscale), `fps`, `bitrate`,
`hint`, `codecs` (preference order, also used on the viewer's offer), `scale`.
Environment: `LOGS=1` prints the sessions' connection logs, `DUMP=1` the raw statistics and SDP.

Not part of the build or the tests (it is slow and measures, it does not assert).
