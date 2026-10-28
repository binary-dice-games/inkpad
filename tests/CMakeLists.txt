inkpad_add_test(session tests/unit/session.test.ts)
inkpad_add_test(session_proxy tests/unit/session-proxy.test.ts)
inkpad_add_test(whiteboard_model tests/unit/whiteboard-model.test.ts)
inkpad_add_test(whiteboard_dom tests/unit/whiteboard-dom.test.ts)
inkpad_add_test(defaults tests/unit/defaults.test.ts)
inkpad_add_test(extension_settings tests/unit/extension-settings.test.ts)
inkpad_add_test(share_host tests/unit/share-host.test.ts)

# Browser tests: webrtc needs Chrome (INKPAD_CHROME); extension needs Playwright's
# Chromium (`npx playwright-core install chromium`), see docs/building.md.
inkpad_add_test(webrtc tests/e2e/webrtc.test.ts PROJECT e2e)
inkpad_add_test(extension tests/e2e/extension.test.ts PROJECT e2e)
