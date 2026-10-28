inkpad_add_test(session tests/unit/session.test.ts)
inkpad_add_test(session_proxy tests/unit/session-proxy.test.ts)
inkpad_add_test(whiteboard_model tests/unit/whiteboard-model.test.ts)
inkpad_add_test(whiteboard_dom tests/unit/whiteboard-dom.test.ts)
inkpad_add_test(defaults tests/unit/defaults.test.ts)

# Browser tests need Chrome (INKPAD_CHROME, see docs/building.md).
inkpad_add_test(webrtc tests/e2e/webrtc.test.ts PROJECT e2e)
