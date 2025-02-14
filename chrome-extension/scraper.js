console.log('scraper.js loaded');

// Move all base scraping functionality here
class SiteScraper {
  constructor() {
    // Ensure SCRAPER_CONFIG exists
    if (!window?.SCRAPER_CONFIG) {
      window.SCRAPER_CONFIG = {
        version: '1.0.4',
        features: {
          rateLimit: true,
          memoryManagement: true,
          assetCaching: true
        }
      };
    }
    this.version = window.SCRAPER_CONFIG.version;
    this.lastUpdated = new Date().toISOString();
    this.lastSync = new Date().toISOString();
    
    // Initialize rate limiting
    this.rateLimit = {
      requests: 0,
      lastReset: Date.now(),
      maxRequests: 30,
      windowMs: 1000
    };

    // Initialize memory management
    this.memoryThreshold = 0.8;
    this.maxCacheSize = 1000;
    this.batchSize = 5;

    // Initialize collections
    this.openTabs = new Set();
    this.assets = new Set();
    this.htmlContent = new Map();
    this.objectUrls = new Set();
    this.timeouts = new Set();
    this.visitedUrls = new Set();
    this.pageQueue = [];
    this.cache = new Map();
    this.downloadQueue = [];

    // Log initialization
    this.devLog('Base scraper initialized with version:', this.version);
  }

  normalizeUrl(url) {
    try {
      if (!url) throw new Error('URL cannot be empty');
      if (url.startsWith('//')) url = 'https:' + url;
      if (url.startsWith('/')) url = this.baseUrl + url;
      return new URL(url).toString();
    } catch (error) {
      throw new Error(`Invalid URL: ${url}`);
    }
  }

  async processUrl(url, timeout = 30000) {
    try {
      const tab = await chrome.tabs.create({ url });
      this.openTabs.add(tab.id);

      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Page load timeout'));
        }, timeout);

        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
          if (tabId === tab.id && info.status === 'complete') {
            clearTimeout(timeoutId);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve(tab);
          }
        });
      });
    } catch (error) {
      if (error.message.includes('Network')) {
        // Retry once
        const tab = await chrome.tabs.create({ url });
        this.openTabs.add(tab.id);
        return tab;
      }
      throw error;
    }
  }

  async findAssets(doc, baseUrl, depth = 1) {
    if (!doc || depth > 3) return;
    
    const assetSelectors = {
      'img': 'src',
      'script': 'src',
      'link[rel="stylesheet"]': 'href',
      'video': 'src',
      'audio': 'src'
    };

    for (const [selector, attr] of Object.entries(assetSelectors)) {
      const elements = doc.querySelectorAll(selector);
      elements.forEach(el => {
        try {
          const assetUrl = this.normalizeUrl(el.getAttribute(attr));
          this.assets.add(assetUrl);
        } catch (error) {
          console.warn(`Invalid asset URL: ${el.getAttribute(attr)}`);
        }
      });
    }
  }

  async devLog(...args) {
    if (!chrome?.management?.getSelf) {
      return;
    }

    return new Promise(resolve => {
      chrome.management.getSelf(info => {
        if (info?.installType === 'development') {
          console.log('[Scraper Debug]', ...args);
        }
        resolve();
      });
    });
  }

  async downloadAll() {
    await this.devLog('Start', new Date().toISOString());
    
    const downloads = [];
    for (const asset of this.assets) {
      try {
        const response = await this.fetch(asset);
        if (response.ok) {
          const blob = await response.blob();
          downloads.push({
            url: asset,
            content: blob
          });
          await this.devLog('Downloaded:', asset);
        }
      } catch (error) {
        await this.devLog('Download failed:', asset, error.message);
      }
    }

    const stats = {
      total: this.assets.size,
      successful: downloads.length,
      failed: this.assets.size - downloads.length
    };

    await this.devLog('Complete', `Total time: ${performance.now()}ms`, stats);
    return downloads;
  }

  async scrapeSite(startUrl) {
    try {
      if (!startUrl) {
        throw new Error('URL cannot be empty');
      }

      await this.devLog(`Starting scrape of ${startUrl}`);
      this.baseUrl = new URL(startUrl).origin;
      this.pageQueue.push(startUrl);
      
      while (this.pageQueue.length > 0) {
        if (await this.isMemoryHigh()) {
          await this.cleanupMemory();
        }

        const url = this.pageQueue.shift();
        if (this.visitedUrls.has(url)) continue;

        try {
          await this.devLog(`Fetching: ${url}`);
          const response = await this.fetch(url);
          const html = await response.text();
          
          const path = this.getPathFromUrl(url);
          this.cache.set(path, {
            content: html,
            url: url,
            contentType: 'text/html'
          });
          
          const doc = new DOMParser().parseFromString(html, 'text/html');
          await this.findAssets(doc, this.baseUrl);
          
          const links = doc.querySelectorAll('a[href]');
          for (const link of links) {
            try {
              const href = new URL(link.href, url).toString();
              if (this.shouldProcessUrl(href)) {
                this.pageQueue.push(href);
              }
            } catch (error) {
              await this.devLog(`Invalid link URL: ${link.href}`, error.message);
            }
          }

          this.visitedUrls.add(url);
          await this.devLog(`Processed ${url}, cache size: ${this.cache.size}`);

        } catch (error) {
          await this.devLog(`Error processing ${url}:`, error);
          throw error;
        }
      }

      return this.prepareDownloads();
    } catch (error) {
      await this.devLog('Error in scrapeSite:', error);
      throw error;
    }
  }

  async extractAssets(doc, baseUrl) {
    // Extract and cache CSS
    const styleSheets = doc.querySelectorAll('link[rel="stylesheet"]');
    for (const sheet of styleSheets) {
      await this.cacheAsset(sheet.href, baseUrl, 'text/css');
    }

    // Extract and cache JavaScript
    const scripts = doc.querySelectorAll('script[src]');
    for (const script of scripts) {
      await this.cacheAsset(script.src, baseUrl, 'application/javascript');
    }

    // Extract and cache images
    const images = doc.querySelectorAll('img[src]');
    for (const img of images) {
      await this.cacheAsset(img.src, baseUrl, 'image');
    }
  }

  async cacheAsset(url, baseUrl, type) {
    try {
      const assetUrl = new URL(url, baseUrl);
      if (!this.shouldProcessUrl(assetUrl.toString())) return;

      const response = await fetch(assetUrl);
      if (!response.ok) return;

      const content = type === 'image' ? 
        await response.blob() : 
        await response.text();

      const path = this.getPathFromUrl(assetUrl.toString());
      this.cache.set(path, {
        content,
        url: assetUrl.toString(),
        contentType: type
      });

    } catch (error) {
      console.warn(`Failed to cache asset ${url}:`, error);
    }
  }

  shouldProcessUrl(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.origin === this.baseUrl && 
             !this.visitedUrls.has(url) &&
             !url.includes('#');
    } catch {
      return false;
    }
  }

  getPathFromUrl(url) {
    const urlObj = new URL(url);
    let path = urlObj.pathname;
    
    if (path.endsWith('/') || !path.includes('.')) {
      path += 'index.html';
    }

    return path.startsWith('/') ? path.slice(1) : path;
  }

  async prepareDownloads() {
    await this.devLog('Creating downloads...');
    if (this.cache.size === 0) {
      const error = new Error('No files found in cache');
      await this.devLog('Error:', error);
      throw error;
    }

    const downloads = [];
    for (const [path, { content, contentType }] of this.cache.entries()) {
      downloads.push({
        path,
        content,
        contentType
      });
    }

    await this.devLog(`Prepared ${downloads.length} files for download`);
    return downloads;
  }

  async cleanup() {
    await this.devLog('Cleaning up...');
    
    // Clear all collections
    this.visitedUrls.clear();
    this.pageQueue = [];
    this.cache.clear();
    this.downloadQueue = [];
    this.assets.clear();
    
    // Clean up object URLs
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.objectUrls.clear();
    
    // Clear timeouts
    this.timeouts.forEach(id => clearTimeout(id));
    this.timeouts.clear();
    
    // Remove tabs
    await Promise.all(Array.from(this.openTabs).map(tabId => 
      chrome.tabs.remove(tabId).catch(() => {})
    ));
    this.openTabs.clear();
  }

  async processBatch(urls) {
    const results = [];
    for (const url of urls) {
      if (await this.isMemoryHigh()) {
        await this.cleanupMemory();
      }
      results.push(await this.processUrl(url));
    }
    return results;
  }

  async isMemoryHigh() {
    if (performance?.memory) {
      const usage = performance.memory.usedJSHeapSize / 
                   performance.memory.jsHeapSizeLimit;
      return usage > this.memoryThreshold;
    }
    return false;
  }

  async cleanupMemory() {
    await this.devLog('Starting memory cleanup...');
    
    // Remove duplicates from queue
    this.pageQueue = [...new Set(this.pageQueue)];
    
    // Clear unnecessary caches
    if (this.cache.size > this.maxCacheSize) {
      const entries = Array.from(this.cache.entries());
      const toKeep = entries.slice(-this.maxCacheSize);
      this.cache.clear();
      toKeep.forEach(([key, value]) => this.cache.set(key, value));
    }

    // Clear old object URLs
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.objectUrls.clear();

    // Request garbage collection if available
    if (global.gc) {
      global.gc();
    }

    await this.devLog('Memory cleanup completed');
  }

  async checkRateLimit() {
    const now = Date.now();
    if (now - this.rateLimit.lastReset > this.rateLimit.windowMs) {
      this.rateLimit.requests = 0;
      this.rateLimit.lastReset = now;
    }

    if (this.rateLimit.requests >= this.rateLimit.maxRequests) {
      const waitTime = this.rateLimit.windowMs - (now - this.rateLimit.lastReset);
      await new Promise(resolve => {
        const timeoutId = setTimeout(resolve, waitTime);
        this.timeouts.add(timeoutId);
      });
      return this.checkRateLimit();
    }

    this.rateLimit.requests++;
  }

  async fetch(url) {
    try {
      await this.checkRateLimit();
      const response = await fetch(url);
      if (!response.ok) {
        const error = new Error(`HTTP error! status: ${response.status}`);
        await this.devLog('Fetch failed:', url, error.message);
        throw error;
      }
      return response;
    } catch (error) {
      await this.devLog('Fetch failed:', url, error.message);
      throw error;
    }
  }
}

// Export the SiteScraper class
export { SiteScraper };

// Make it available globally for compatibility
if (typeof window !== 'undefined') {
  window.SiteScraper = SiteScraper;
} else {
  global.SiteScraper = SiteScraper; // For Node.js or other environments
} 