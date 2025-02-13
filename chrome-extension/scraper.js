class SiteScraper {
  constructor(baseUrl) {
    this.baseUrl = new URL(baseUrl).origin;
    this.visited = new Set();
    this.toVisit = new Set();
    this.assets = new Set();
    this.isRunning = true;
    this.htmlContent = new Map();
    this.processedUrls = new Set();
    this.openTabs = new Set();
    this.objectUrls = new Set();
    this.timeouts = new Set();
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

  async cleanup() {
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
  }

  updateProgress(message) {
    chrome.runtime.sendMessage({
      action: 'progress',
      message: `${message}\nQueued: ${this.toVisit.size}, Processed: ${this.processedUrls.size}`,
      queued: this.toVisit.size,
      processed: this.processedUrls.size
    }).catch(error => console.error('Progress update failed:', error));
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
    let currentTabId = null;
    try {
      const currentUrl = window.location.href;
      this.toVisit.add(this.normalizeUrl(currentUrl));
      window.currentScraper = this;

      while (this.toVisit.size > 0 && this.isRunning) {
        const url = Array.from(this.toVisit)[0];
        this.toVisit.delete(url);
        
        if (this.processedUrls.has(url)) continue;
        
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
          
          const doc = new DOMParser().parseFromString(html, 'text/html');
          await this.findAssets(doc, url);
          await this.findAndQueueLinks(doc, url);
          
          await chrome.tabs.remove(currentTabId);
          this.openTabs.delete(currentTabId);
          currentTabId = null;
          
          await new Promise(resolve => {
            const timeout = setTimeout(resolve, 500);
            this.timeouts.add(timeout);
          });
        } catch (error) {
          console.error(`Error processing ${url}:`, error);
          if (currentTabId) {
            await chrome.tabs.remove(currentTabId).catch(console.error);
            this.openTabs.delete(currentTabId);
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

  async findAssets(doc, baseUrl) {
    // Standard assets
    const selectors = {
      'img[src]': 'src',
      'script[src]': 'src',
      'link[rel="stylesheet"]': 'href',
      'link[rel="icon"]': 'href',
      'video[src]': 'src',
      'audio[src]': 'src',
      'source[src]': 'src',
      'iframe[src]': 'src'
    };

    for (const [selector, attr] of Object.entries(selectors)) {
      doc.querySelectorAll(selector).forEach(el => {
        const url = el.getAttribute(attr);
        if (url) {
          const fullUrl = this.normalizeUrl(url);
          if (fullUrl?.startsWith(this.baseUrl)) {
            this.assets.add(fullUrl);
          }
        }
      });
    }

    // CSS background images
    doc.querySelectorAll('*').forEach(el => {
      const style = window.getComputedStyle(el);
      const backgroundImage = style.backgroundImage;
      if (backgroundImage && backgroundImage !== 'none') {
        const matches = backgroundImage.match(/url\(['"]?([^'"]+)['"]?\)/g);
        if (matches) {
          matches.forEach(match => {
            const url = match.replace(/url\(['"]?([^'"]+)['"]?\)/, '$1');
            const fullUrl = this.normalizeUrl(url);
            if (fullUrl?.startsWith(this.baseUrl)) {
              this.assets.add(fullUrl);
            }
          });
        }
      }
    });
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
    const downloadUrl = URL.createObjectURL(content);
    
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'download',
        url: downloadUrl,
        filename: 'site-archive.zip'
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          URL.revokeObjectURL(downloadUrl);
          resolve(response);
        }
      });
    });
  }

  stop() {
    this.isRunning = false;
    this.cleanup().catch(console.error);
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
    if (window.currentScraper) {
      window.currentScraper.stop();
      isScrapingInProgress = false;
    }
  }
}); 