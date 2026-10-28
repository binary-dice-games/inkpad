// Spike (throwaway): gets a tab capture id and starts the offscreen document.
globalThis.results = { log: [], stats: null };

chrome.runtime.onMessage.addListener((m) => {
  if (m?.target !== 'sw') return;
  if (m.type === 'log') globalThis.results.log.push(m.text);
  if (m.type === 'stats') globalThis.results.stats = m.stats;
});

globalThis.run = async (tabId, mode, seconds, limits, view) => {
  globalThis.results = { log: [], stats: null };
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  if (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'spike',
    });
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  await chrome.runtime.sendMessage({ target: 'offscreen', type: 'run', streamId, mode, seconds, limits, view });
};
