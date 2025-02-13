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
    this.visitedUrls = new Set();
    this.pageQueue = [];
    this.baseUrl = '';
    this.cache = new Map();
    this.downloadQueue = [];
    this.batchSize = 5; // Process in smaller batches
    this.memoryThreshold = 0.8; // 80% memory usage threshold
    this.rateLimit = {
      requests: 0,
      lastReset: Date.now(),
      maxRequests: 30, // per window
      windowMs: 1000 // 1 second
    };
    console.log('Base scraper initialized with version:', this.version);
  }

  async scrapeSite(startUrl) {
    console.log(`Starting scrape of ${startUrl}`);
    this.baseUrl = new URL(startUrl).origin;
    this.pageQueue.push(startUrl);
    
    while (this.pageQueue.length > 0) {
      const url = this.pageQueue.shift();
      if (this.visitedUrls.has(url)) continue;

      try {
        console.log(`Fetching: ${url}`);
        const response = await fetch(url);
        if (!response.ok) {
          console.warn(`Failed to fetch ${url}: ${response.status}`);
          continue;
        }

        const html = await response.text();
        
        // Store in cache
        const path = this.getPathFromUrl(url);
        this.cache.set(path, {
          content: html,
          url: url,
          contentType: 'text/html'
        });
        
        // Parse and find assets
        const doc = new DOMParser().parseFromString(html, 'text/html');
        await this.extractAssets(doc, url);
        
        // Find links
        const links = doc.querySelectorAll('a[href]');
        for (const link of links) {
          const href = new URL(link.href, url).toString();
          if (this.shouldProcessUrl(href)) {
            this.pageQueue.push(href);
          }
        }

        this.visitedUrls.add(url);
        console.log(`Processed ${url}, cache size: ${this.cache.size}`);

      } catch (error) {
        console.error(`Error processing ${url}:`, error);
      }
    }

    return this.prepareDownloads();
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
    console.log('Creating downloads...');
    if (this.cache.size === 0) {
        throw new Error('No files found in cache');
      }

    const downloads = [];
    for (const [path, { content, contentType }] of this.cache.entries()) {
      downloads.push({
        path,
        content,
        contentType
      });
    }

    console.log(`Prepared ${downloads.length} files for download`);
    return downloads;
  }

  cleanup() {
    console.log('Cleaning up...');
    this.visitedUrls.clear();
    this.pageQueue = [];
    this.cache.clear();
    this.downloadQueue = [];
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
    if (performance.memory) {
      return performance.memory.usedJSHeapSize / 
             performance.memory.jsHeapSizeLimit > this.memoryThreshold;
    }
    return false;
  }

  async cleanupMemory() {
    this.pageQueue = [...new Set(this.pageQueue)]; // Remove duplicates
    if (global.gc) global.gc(); // Request garbage collection if available
  }

  async checkRateLimit() {
    const now = Date.now();
    if (now - this.rateLimit.lastReset > this.rateLimit.windowMs) {
      this.rateLimit.requests = 0;
      this.rateLimit.lastReset = now;
    }

    if (this.rateLimit.requests >= this.rateLimit.maxRequests) {
      const waitTime = this.rateLimit.windowMs - (now - this.rateLimit.lastReset);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.checkRateLimit();
    }

    this.rateLimit.requests++;
  }

  async fetch(url) {
    await this.checkRateLimit();
    return fetch(url);
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