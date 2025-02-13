class SiteScraper {
  constructor(baseUrl) {
    if (!baseUrl) {
      throw new Error('Base URL is required');
    }
    
    try {
      this.baseUrl = new URL(baseUrl).origin;
    } catch (error) {
      throw new Error('Invalid base URL provided');
    }
    
    this.visited = new Set();
    this.toVisit = new Set();
    this.assets = new Set();
    this.isRunning = true;
    this.htmlContent = new Map();
    this.processedUrls = new Set();
    this.openTabs = new Set();
    this.objectUrls = new Set();
    this.timeouts = new Set();
    this.selectors = {
      'img[src]': 'src',
      'script[src]': 'src',
      'link[rel="stylesheet"]': 'href',
      'link[rel="icon"]': 'href',
      'video[src]': 'src',
      'audio[src]': 'src',
      'source[src]': 'src',
      'iframe[src]': 'src'
    };
    this.cleanupHandlers = new Set();
  }

  normalizeUrl(url) {
    try {
      const parsed = new URL(url, this.baseUrl);
      return parsed.origin + parsed.pathname.replace(/\/$/, '');
    } catch (e) {
      console.error('Invalid URL:', url);
      return null;
    }
  }

  registerCleanup(handler) {
    this.cleanupHandlers.add(handler);
  }

  async cleanup() {
    try {
      // Run all cleanup handlers
      await Promise.all(Array.from(this.cleanupHandlers).map(handler => handler()));
      
      // Clean up tabs
      for (const tabId of this.openTabs) {
        try {
          await chrome.tabs.remove(tabId);
        } catch (e) {
          console.error('Error closing tab:', e);
        }
      }
      
      // Clean up object URLs
      for (const url of this.objectUrls) {
        URL.revokeObjectURL(url);
      }
      
      // Clear timeouts
      for (const timeout of this.timeouts) {
        clearTimeout(timeout);
      }
      
      this.openTabs.clear();
      this.objectUrls.clear();
      this.timeouts.clear();
      this.cleanupHandlers.clear();
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }

  updateProgress(message) {
    const progress = {
      action: 'progress',
      message,
      queued: this.toVisit.size,
      processed: this.processedUrls.size,
      assets: this.assets.size,
      totalAssets: this.assets.size + this.toVisit.size,
      status: this.isRunning ? 'running' : 'stopped'
    };
    
    chrome.runtime.sendMessage(progress).catch(error => 
      console.error('Progress update failed:', error)
    );
  }

  async waitForPageLoad(tabId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error('Page load timeout'));
      }, 30000);
      
      this.timeouts.add(timeout);

      function listener(id, info) {
        if (id === tabId && info.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(resolve, 1000);
        }
      }
      
      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  async createTab(url) {
    try {
      const tab = await chrome.tabs.create({ url, active: false });
      this.openTabs.add(tab.id);
      return tab.id;
    } catch (error) {
      console.error('Tab creation failed:', error);
      throw error;
    }
  }

  async scrape() {
    try {
      let retryCount = 0;
      const maxRetries = 3;
      
      // Add initial URL
      const currentUrl = this.baseUrl;
      this.toVisit.add(this.normalizeUrl(currentUrl));
      
      while (this.toVisit.size > 0 && this.isRunning) {
        const url = Array.from(this.toVisit)[0];
        this.toVisit.delete(url);
        
        if (this.processedUrls.has(url)) continue;
        
        try {
          await this.processUrl(url);
          retryCount = 0; // Reset retry count on success
        } catch (error) {
          console.error(`Error processing ${url}:`, error);
          if (retryCount < maxRetries) {
            retryCount++;
            this.toVisit.add(url); // Re-queue for retry
            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
          }
        }
      }

      if (this.isRunning) {
        this.updateProgress('Creating zip file...');
        await this.downloadAll();
      }
    } finally {
      await this.cleanup();
    }
  }

  async findAssets(doc, baseUrl, currentTabId) {
    try {
      // Execute in the tab context instead
      const result = await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        func: (selectors) => {
          const assets = new Set();
          // Process standard assets
          for (const [selector, attr] of Object.entries(selectors)) {
            document.querySelectorAll(selector).forEach(el => {
              const url = el.getAttribute(attr);
              if (url) assets.add(url);
            });
          }
          // Process background images
          document.querySelectorAll('*').forEach(el => {
            const style = window.getComputedStyle(el);
            const backgroundImage = style.backgroundImage;
            if (backgroundImage && backgroundImage !== 'none') {
              const matches = backgroundImage.match(/url\(['"]?([^'"]+)['"]?\)/g);
              if (matches) {
                matches.forEach(match => {
                  const url = match.replace(/url\(['"]?([^'"]+)['"]?\)/, '$1');
                  assets.add(url);
                });
              }
            }
          });
          return Array.from(assets);
        },
        args: [this.selectors]
      });

      const urls = result[0].result;
      urls.forEach(url => {
        const fullUrl = this.normalizeUrl(url);
        if (fullUrl?.startsWith(this.baseUrl)) {
          this.assets.add(fullUrl);
        }
      });
    } catch (error) {
      console.error('Error finding assets:', error);
    }
  }

  async findAndQueueLinks(doc, currentUrl) {
    const links = doc.querySelectorAll('a[href]');
    for (const a of links) {
      try {
        const href = a.getAttribute('href');
        const url = this.normalizeUrl(href);
        
        if (url && url.startsWith(this.baseUrl) && 
            !this.processedUrls.has(url) && 
            !this.toVisit.has(url) &&
            !url.includes('#') && 
            !url.includes('wp-admin') && 
            !url.includes('wp-login') && 
            !url.includes('?') && 
            !url.match(/\.(jpg|jpeg|png|gif|css|js|xml|pdf)$/i)) {
          this.toVisit.add(url);
          this.updateProgress(`Queued: ${url}`);
        }
      } catch (e) {
        console.error('Error processing link:', a.href, e);
      }
    }
  }

  urlToPath(url) {
    const parsed = new URL(url);
    let path = parsed.pathname;
    
    // Handle the root URL
    if (path === '/') {
      return 'index.html';
    }
    
    // Remove leading slash
    path = path.substring(1);
    
    // If it's not a file (no extension), treat as directory and add index.html
    if (!path.includes('.')) {
      path = path + '/index.html';
    }
    
    return path;
  }

  async downloadAll() {
    const zip = new JSZip();
    let downloadUrl = null;
    
    try {
      // Add HTML files
      for (const [url, { content, title }] of this.htmlContent) {
        const path = this.urlToPath(url);
        this.updateProgress(`Adding HTML: ${path}`);
        zip.file(path, content);
      }
      
      // Download and add assets
      let processedAssets = 0;
      const totalAssets = this.assets.size;
      
      for (const url of this.assets) {
        try {
          processedAssets++;
          this.updateProgress(`Processing asset ${processedAssets}/${totalAssets}: ${url}`);
          const response = await fetch(url);
          const blob = await response.blob();
          const path = this.urlToPath(url);
          zip.file(path, blob);
        } catch (error) {
          console.error(`Error downloading asset ${url}:`, error);
        }
      }
      
      this.updateProgress('Generating zip file...');
      const content = await zip.generateAsync({type: 'blob'});
      downloadUrl = URL.createObjectURL(content);
      this.objectUrls.add(downloadUrl);  // Track for cleanup
      
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: 'download',
          url: downloadUrl,
          filename: 'site-archive.zip'
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(response);
          }
        });
      });
    } finally {
      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
        this.objectUrls.delete(downloadUrl);
      }
    }
  }

  stop() {
    this.isRunning = false;
    this.cleanup().catch(console.error);
  }

  async processUrl(url) {
    let currentTabId = null;
    try {
      this.updateProgress(`Fetching: ${url}`);
      currentTabId = await this.createTab(url);
      await this.waitForPageLoad(currentTabId);
      
      const result = await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        func: () => ({
          html: document.documentElement.outerHTML,
          title: document.title
        })
      });
      
      const { html, title } = result[0].result;
      this.htmlContent.set(url, {
        content: html,
        title: title
      });
      this.processedUrls.add(url);
      
      // Parse HTML in the context where DOMParser is available
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      await this.findAssets(doc, url, currentTabId);
      await this.findAndQueueLinks(doc, url);
    } finally {
      if (currentTabId) {
        await chrome.tabs.remove(currentTabId).catch(console.error);
        this.openTabs.delete(currentTabId);
      }
      await new Promise(resolve => {
        const timeout = setTimeout(resolve, 500);
        this.timeouts.add(timeout);
      });
    }
  }
}

// Prevent multiple simultaneous scraping sessions
let isScrapingInProgress = false;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scrape') {
    if (isScrapingInProgress) {
      sendResponse({ success: false, error: 'A scraping session is already in progress' });
      return true;
    }
    
    isScrapingInProgress = true;
    const scraper = new SiteScraper(request.baseUrl);
    
    scraper.scrape()
      .then(() => {
        isScrapingInProgress = false;
        sendResponse({ success: true });
      })
      .catch(error => {
        isScrapingInProgress = false;
        sendResponse({ success: false, error: error.message });
      });
    return true;
  } else if (request.action === 'stop') {
    if (self.currentScraper) {
      self.currentScraper.stop();
      isScrapingInProgress = false;
    }
  }
}); 