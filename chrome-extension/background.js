// Import required scripts
self.importScripts('jszip.min.js', 'scraper.js');

// Service worker for potential future functionality 

// Track active downloads and scraping state
const activeDownloads = new Set();
let currentScraper = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    if (request.action === 'startScraping') {
      // Keep message channel open
      const timeoutId = setTimeout(() => {
        sendResponse({ success: false, error: 'Operation timed out' });
      }, 30000);

      if (currentScraper) {
        sendResponse({ success: false, error: 'A scraping session is already in progress' });
        return true;
      }

      // Create new scraper instance
      currentScraper = new SiteScraper(request.baseUrl);
      
      currentScraper.scrape()
        .then(() => {
          clearTimeout(timeoutId);
          currentScraper = null;
          sendResponse({ success: true });
        })
        .catch(error => {
          clearTimeout(timeoutId);
          currentScraper = null;
          sendResponse({ success: false, error: error.message });
        });
      return true;
    }
    else if (request.action === 'stopScraping') {
      if (currentScraper) {
        currentScraper.stop();
        currentScraper = null;
      }
      sendResponse({ success: true });
      return true;
    }
    else if (request.action === 'download') {
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
        return true;
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    }
  } catch (error) {
    console.error('Message handler error:', error);
    sendResponse({ success: false, error: error.message });
  }
  return true;
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
  if (currentScraper) {
    currentScraper.stop();
  }
}); 