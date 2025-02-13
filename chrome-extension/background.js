// Import required scripts
self.importScripts('jszip.min.js', 'scraper.js');

// Service worker for potential future functionality 

// Track active downloads and scraping state
const activeDownloads = new Set();
let currentScraper = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    if (request.action === 'startScraping') {
      if (currentScraper) {
        sendResponse({ 
          success: false, 
          error: 'A scraping session is already in progress. Please wait for it to complete.' 
        });
        return true;
      }

      // Create new scraper instance
      currentScraper = new SiteScraper(request.baseUrl);
      
      currentScraper.scrape()
        .then(() => {
          currentScraper = null;
          sendResponse({ success: true });
        })
        .catch(error => {
          currentScraper = null;
          sendResponse({ success: false, error: error.message });
        });
      return true;
    }
    else if (request.action === 'stopScraping') {
      if (currentScraper) {
        currentScraper.stop();
        currentScraper = null;
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'No active scraping session' });
      }
      return true;
    }
    else if (request.action === 'download') {
      try {
        // Convert data URL back to blob
        const byteString = atob(request.data.split(',')[1]);
        const mimeString = request.data.split(',')[0].split(':')[1].split(';')[0];
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
          ia[i] = byteString.charCodeAt(i);
        }
        const blob = new Blob([ab], { type: mimeString });
        
        // Create download
        const url = URL.createObjectURL(blob);
        
        chrome.downloads.download({
          url: url,
          filename: request.filename,
          saveAs: true
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            console.error('Download error:', chrome.runtime.lastError);
            URL.revokeObjectURL(url);
            sendResponse({ 
              success: false, 
              error: chrome.runtime.lastError.message 
            });
            return;
          }
          
          URL.revokeObjectURL(url);
          sendResponse({ 
            success: true, 
            downloadId: downloadId 
          });
        });
        
        return true; // Keep message channel open
      } catch (error) {
        console.error('Background script error:', error);
        sendResponse({ 
          success: false, 
          error: error.message 
        });
        return true;
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
    currentScraper = null;
  }
}); 