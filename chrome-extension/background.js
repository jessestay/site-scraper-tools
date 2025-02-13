// Service worker for potential future functionality 

// Track active downloads
const activeDownloads = new Set();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'download') {
    try {
      chrome.downloads.download({
        url: request.url,
        filename: request.filename,
        saveAs: true
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          activeDownloads.add(downloadId);
          sendResponse({ success: true, downloadId });
        }
      });
      return true; // Keep the message channel open for async response
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }
});

// Clean up completed downloads
chrome.downloads.onChanged.addListener(({ id, state }) => {
  if (state?.current === 'complete' || state?.current === 'interrupted') {
    activeDownloads.delete(id);
  }
});

// Clean up on extension unload
chrome.runtime.onSuspend.addListener(() => {
  for (const downloadId of activeDownloads) {
    chrome.downloads.cancel(downloadId).catch(console.error);
  }
}); 