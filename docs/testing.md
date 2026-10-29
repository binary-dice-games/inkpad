# inkpad — Testing

How to test inkpad: the automated suites, how the browser tests work, how to try the
extension by hand, and what is not covered. For the pre-release checklist on real
networks see [manual-testing.md](manual-testing.md); for setting up the toolchain see
[building.md](building.md).

## In five minutes

```
cmake -S . -B build                                   # installs npm dependencies the first time
npx playwright-core install chromium                  # once: the browser the extension test loads
cmake --build build --target check                    # lint, typecheck, format
ctest --test-dir build -C Debug --output-on-failure --parallel
```

All 12 tests should pass in about 35 seconds. (`-C Debug` is needed with Visual Studio and
Xcode generators and harmless elsewhere.) If they do, the core, the extension, the viewer
and the site all work on your machine.

## What each test covers

Unit tests run in Node, with no browser. They use an in-memory network instead of WebRTC.

| ctest name | File | What it checks |
|---|---|---|
| `session` | `tests/unit/session.test.ts` | Room tokens, sealing, message framing; a host with guests: roster, relaying, targeted messages, lock, remove, protocol refusal |
| `board_keeper` | `tests/unit/board-keeper.test.ts` | The host keeps the drawings and sends them to late joiners; a locked viewer's changes are dropped |
| `whiteboard_model` | `tests/unit/whiteboard-model.test.ts` | Drawings converge in any order; undo, clear, limits, validation; frame geometry; the drawing gate and its rate limit |
| `whiteboard_dom` | `tests/unit/whiteboard-dom.test.ts` | The whiteboard in a simulated DOM: emoticon stickers, read-only mode, the frame adapter |
| `defaults` | `tests/unit/defaults.test.ts` | Video settings, the `stage` and `ctl` messages, presenter keys, invite links |
| `extension_settings` | `tests/unit/extension-settings.test.ts` | Settings validation, the share state machine, which tabs can be shared |
| `share_host` | `tests/unit/share-host.test.ts` | The presenter's side: links, stage messages, drawing lock, the presenter key and every console command, malformed messages |
| `viewer_model` | `tests/unit/viewer-model.test.ts` | The viewer's messages and decisions that need no page |
| `release` | `tests/unit/release.test.ts` | The extension audit, zip packaging, release notes, the Pages site and its smoke check, the viewer address fixed at build time |

Browser tests drive a real Chromium and real WebRTC over loopback.

| ctest name | File | What it checks |
|---|---|---|
| `webrtc` | `tests/e2e/webrtc.test.ts` | Video over real WebRTC at a capped frame rate; drawings both ways and between viewers; the data link without video; that a tracker sees only sealed data |
| `extension` | `tests/e2e/extension.test.ts` | The built extension, with real tab capture: sharing, the console, viewers, drawing, the presenter's commands, resize, join codes, touch, accessibility (see below) |
| `site` | `tests/e2e/site.test.ts` | The Pages site served like GitHub Pages: the viewer at `/` and `/v1/`, the 404 redirect that keeps an invite, the privacy page |

The `extension` test is the one to read to see the product working. In one session it
checks that:

- nothing is added to the shared page, and the page stays usable;
- the video shows the shared page and none of the drawings (with a control: a coloured
  box put into the page does appear in the video);
- the video keeps the tab's shape and the delivered frame rate is near the setting;
- a drawing lands at the same place of the frame in windows of different shapes;
- the presenter's commands work (drawing off, pause, clear, remove, end), and a console
  link with the wrong key is only a viewer;
- a viewer can join with a code when no tracker is reachable;
- touch drawing works on a phone-sized screen, and an axe-core run finds no
  accessibility violations;
- the viewer bundle stays under 150 KB gzipped, and there are no content security
  policy violations.

## Running parts of the suite

```
ctest --test-dir build -C Debug -R share_host          # one test by name
ctest --test-dir build -C Debug -L e2e                 # only the browser tests (label: e2e or unit)
npm test                                               # all unit tests, with Vitest directly
npm run test:e2e                                       # all browser tests
npx vitest run --project unit tests/unit/share-host.test.ts
npx vitest run --project e2e tests/e2e/extension.test.ts -t "touch"     # one test by title
npm run check                                          # lint, typecheck, format
```

Run a single browser test while you work on it: the `extension` test takes about 30
seconds in full. It builds the extension and the viewer itself before it starts, so you
do not need to build first.

## What the browser tests need

- **Chrome** for `webrtc` and `site`. The tests look for it in the usual install places;
  set `INKPAD_CHROME` to its path if yours is elsewhere.
- **Playwright's Chromium** for `extension`: `npx playwright-core install chromium`. Branded
  Chrome (since version 137) ignores the command-line switch that loads an unpacked
  extension, so this test cannot use it.
- No internet. The tests start their own tracker (`tests/support/fake-tracker.ts`), serve
  pages from a loopback server, and turn off STUN. They never touch public trackers.

Some things about how the `extension` test works, in case it surprises you:

- It builds a test version of the extension (`npm run build:extension:e2e`) with a fixed
  key, so its id is always `blbkchnaiknoghiidahgeefienkhpfcl`, and with host access to
  loopback so the service worker can read the address of the tab. The shipped extension
  has neither.
- Chrome gives `tabCapture` only to an extension a person has just clicked. Automation
  cannot click, so the test starts Chromium with `--allowlisted-extension-id=<that id>`,
  which skips the click. The capture itself is real: the video the tests look at is the
  tab's actual pixels.
- Messages are sent to the extension from a page of the extension itself, the same way
  the popup does.

## Writing tests

The rules (they are also in `CLAUDE.md`):

- Add every test file to `tests/CMakeLists.txt` with `inkpad_add_test(<name> <file>)`, and
  `PROJECT e2e` for browser tests. ctest runs each in its own process, in parallel.
- No fixed ports (listen on port 0), no fixed temp directory names, no fixed sleeps. Wait
  for the condition: `until(() => ..., 'what', timeoutMs)` from `tests/support/wait.ts`,
  or `expect.poll` in browser tests.
- Never use the internet or public trackers.
- Test the behaviour you changed, and try to see the test fail without the change.

Helpers: `tests/support/rooms.ts` (`TestRoom`: a host and guests on an in-memory
network), `fake-tracker.ts`, `browser.ts` (serves the repository and launches Chrome),
`extension.ts` (launches Chromium with the extension loaded).

## Trying it by hand

Do this before a release, and any time you change something automation cannot see: what
the page looks like, real networks, a real click.

1. **Build the extension and the viewer**
   ```
   npm run build:extension
   npm run build:viewer
   ```
2. **Serve the viewer locally.** The hosted viewer does not exist yet, so run your own:
   ```
   python -m http.server 8080 --directory viewer/dist
   ```
   (or `npx serve viewer/dist -l 8080`). Leave it running.
3. **Load the extension.** In Chrome open `chrome://extensions`, turn on *Developer mode*,
   choose *Load unpacked*, and pick `extension/dist`. Pin its icon.
4. **Point it at your viewer.** Open the extension's *Settings* and set *Viewer page* to
   `http://localhost:8080/`. (Only `https` is accepted for a viewer page, except for
   `localhost` and `127.0.0.1`, which is why this works.) Save.
5. **Share a page.** Open any ordinary web page (not a `chrome://` page or the Web Store),
   click the inkpad icon and choose *Share this tab*. The icon shows a red dot.
6. **Open the console.** Click *Open console*. A window opens, joins in a few seconds and
   shows your page with a toolbar. Draw with the pen.
7. **Join as a viewer.** Copy the viewer link from the popup and open it in a different
   Chrome window or profile, so you can see both at once. Enter a name. You should see the
   page and your drawing.
8. **Check what matters:**
   - the shared page itself shows nothing extra, and you can still click and scroll it;
   - the video follows the page a moment late, a few frames a second;
   - strokes drawn in the console appear on the viewer at once, and strokes drawn by the
     viewer appear in the console;
   - the video never shows any drawing (draw over a plain page and look closely);
   - in the console: remove the viewer, lock, turn off *Viewers can draw* (the viewer's
     tools go grey), pause, clear, and *End session*.
9. Try the cases in [manual-testing.md](manual-testing.md): another network, a phone, a
   browser other than Chrome, many viewers, closing the laptop lid.

Without internet the public trackers are not reachable. Use *Join codes* (the waiting
screen of the viewer, and the popup) to connect anyway.

### If something does not work

| What you see | Likely cause |
|---|---|
| *Share this tab* is greyed out, or says Chrome does not allow this page | The tab is a `chrome://` page, the Web Store or another page extensions cannot use |
| "This tab shows the viewer or the console" | You tried to share a page of your own viewer or console |
| The viewer waits for the presenter and gives up | The network blocks the trackers (use a code), the link is old, or the session is locked |
| The viewer says the presenter did not answer, and everything else looks right | The two sides run different versions of inkpad |
| The console opens but shows no video and no controls | The presenter key in the link is wrong or the share has ended; start again |
| The popup says the video stopped | The capture could not restart after a resize; stop sharing and start again |
| Nothing at all happens after clicking the icon | Open the extension's service worker console (below) and look for errors |

Connection logs: both the viewer/console page (F12) and the extension's *offscreen.html*
(`chrome://extensions` → inkpad → *Inspect views*) write `[inkpad]` lines to the console, one
per step. A healthy join reads, on the viewer: `tracker: connected to ...`, `announce with 3
offers`, `answer received from ...`, `ICE connection: connected`, `data channel open: fast`,
`session state: open`. Where it stops tells you the stage that fails:

| Last line you see | The problem is |
|---|---|
| `tracker: closed ... code 1006`, repeated | The tracker is unreachable (blocked, down or DNS) |
| `announce with 3 offers` and nothing after | The tracker dropped the announce, or nobody is in the room: check the presenter's log shows `offer received from` |
| presenter: `offer received`, but no `answer sent` | The presenter could not answer: the line after says why |
| `answer received`, then `ICE connection: failed` | The two networks cannot reach each other: try another network or a TURN server |
| `link open` but never `session state: open` | The protocol versions differ (the presenter refuses the hello) |

Nothing secret is logged: no link, token, presenter key, SDP or message contents.

Where to look:

- `chrome://extensions` → inkpad → *Inspect views*: *service worker* (starting and stopping)
  and *offscreen.html* (the connections and the capture; it exists only while sharing).
- The console and viewer are ordinary pages: press F12 in them.
- `chrome://webrtc-internals` shows the connections, frame rates and bitrates.

## What is not covered

Be careful with these; nothing tests them automatically:

- A real click on the popup's *Share this tab*, and the shortcuts (Alt+Shift+I, Alt+Shift+P).
- Real window resizing, zoom, and a cross-origin navigation of the shared tab.
- Real networks: public trackers over time, NATs, TURN, corporate proxies.
- Browsers other than Chromium, real phones, screen readers.
- How sharp the video looks on a real display, in real Chrome with real encoders: the
  automated tests only measure it in headless Chromium. `spikes/video-quality/` measures a
  text page's sharpness over time (`node spikes/video-quality/run.mjs "name:w=1920&h=1080&..."`).
- Many viewers (the design aims at about 10) and long sessions.
- The Pages and release workflows: they have not run yet (CI has, on all three systems).
- A viewer on another protocol version: it only sees "the presenter did not answer".

## Continuous integration

`.github/workflows/ci.yml` runs the same steps on Linux, macOS and Windows: configure,
`check`, the extension and viewer builds, the extension audit and the whole ctest suite.
Its history and the problems it found are in
[../spec/05_release_pipeline/PLAN.md](../spec/05_release_pipeline/PLAN.md).
