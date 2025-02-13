class SiteScraper {
  constructor(baseUrl, options = {}) {
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
    
    // Secure dev mode validation
    this.isDevMode = false;
    this.initDevMode();
    
    this.statusTabId = null;
    this.logMessages = [];
    
    // Add URL cache
    this.urlCache = new Map();
    
    // Initialize IndexedDB
    this.dbName = 'ScrapeCache';
    this.initDb();

    // Add premium features flag
    this.isPremium = options.isPremium || false;
    this.premiumFeatures = null;

    // Move premium features to separate repo
    this.maxConcurrentDownloads = 3;
    this.compressionLevel = 1;
    this.batchSize = 250;
    
    // Add feature flags
    this.features = {
      basicScraping: true,
      basicCompression: true,
      // Premium features referenced but not implemented
      advancedSelectors: false,
      highCompression: false,
      unlimitedBatches: false
    };

    // Add queue processing settings
    this.queueChunkSize = 10; // Process 10 URLs at a time
    this.queueProcessDelay = 100; // ms between chunks
    this.processingQueue = [];
    this.isProcessingQueue = false;
  }

  devLog(...args) {
    if (this.isDevMode) {
      console.log('[Scraper Debug]', ...args);
    }
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
      this.updateProgress('Cleaning up...');
      // Run all cleanup handlers
      await Promise.all(Array.from(this.cleanupHandlers).map(handler => handler()));
      
      // Clean up tabs with retry logic, except status tab
      for (const tabId of this.openTabs) {
        // Skip the status tab
        if (tabId === this.statusTabId) continue;
        
        let success = false;
        for (let i = 0; i < 3; i++) {
          try {
            await chrome.tabs.remove(tabId);
            success = true;
            break;
          } catch (e) {
            this.devLog(`Tab removal attempt ${i + 1} failed:`, e);
            await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));
          }
        }
        if (!success) {
          console.error(`Failed to remove tab ${tabId} after 3 attempts`);
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
      
      // Clear all sets except openTabs since we want to keep track of status tab
      this.objectUrls.clear();
      this.timeouts.clear();
      this.cleanupHandlers.clear();
      
      // Remove all tabs from tracking except status tab
      const statusTab = this.statusTabId;
      this.openTabs.clear();
      if (statusTab) {
        this.openTabs.add(statusTab);
      }
      
      // Close IndexedDB connection but don't delete database yet
      if (this.db) {
        this.db.close();
        // Don't delete the database until downloads are complete
      }
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }

  async initStatusPage() {
    const maxRetries = 3;
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        // Create status page tab
        const tab = await chrome.tabs.create({
          url: chrome.runtime.getURL('status.html'),
          active: true
        });
        
        this.statusTabId = tab.id;
        this.openTabs.add(tab.id);
        
        // Wait for page to load and be ready
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            reject(new Error('Page load timeout'));
          }, 10000);

          const listener = async (tabId, info) => {
            if (tabId === tab.id && info.status === 'complete') {
              // Add extra delay to ensure content script is loaded
              await new Promise(r => setTimeout(r, 500));
              
              // Verify tab is actually ready
              if (await this.verifyStatusTab()) {
                chrome.tabs.onUpdated.removeListener(listener);
                clearTimeout(timeout);
                resolve();
              }
            }
          };
          
          chrome.tabs.onUpdated.addListener(listener);
        });
        
        return; // Success
      } catch (error) {
        lastError = error;
        this.devLog(`Tab creation attempt ${i + 1} failed:`, error);
        await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));
      }
    }
    
    throw new Error(`Failed to create status tab after ${maxRetries} attempts: ${lastError?.message}`);
  }

  async verifyStatusTab() {
    if (!this.statusTabId) return false;
    
    try {
      const tab = await chrome.tabs.get(this.statusTabId);
      if (!tab) return false;
      
      // Try a test message
      await chrome.tabs.sendMessage(this.statusTabId, { action: 'ping' });
      return true;
    } catch (error) {
      return false;
    }
  }

  async updateProgress(message) {
    const timestamp = new Date().toISOString();
    const progress = {
      timestamp,
      message,
      queued: this.toVisit.size,
      processed: this.processedUrls.size,
      assets: this.assets.size,
      totalAssets: this.assets.size + this.toVisit.size,
      status: this.isRunning ? 'running' : 'stopped'
    };

    this.logMessages.push(progress);

    if (this.statusTabId) {
      try {
        // Check if tab exists first
        const tab = await chrome.tabs.get(this.statusTabId).catch(() => null);
        if (!tab) {
          this.devLog('Status tab no longer exists');
          return;
        }

        // Wait for tab to be ready
        await new Promise(resolve => setTimeout(resolve, 100));
        
        await chrome.tabs.sendMessage(this.statusTabId, {
          action: 'updateStatus',
          data: progress,
          allMessages: this.logMessages
        }).catch(error => {
          // Only log connection errors in dev mode
          if (this.isDevMode) {
            console.debug('Status update skipped:', error.message);
          }
        });
      } catch (error) {
        // Only log other errors in dev mode
        if (this.isDevMode) {
          console.debug('Status update failed:', error);
        }
      }
    }
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
    const maxRetries = 3;
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        const tab = await chrome.tabs.create({ url, active: false });
        this.openTabs.add(tab.id);
        return tab.id;
      } catch (error) {
        lastError = error;
        this.devLog(`Tab creation attempt ${i + 1} failed:`, error);
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));
      }
    }
    
    throw new Error(`Failed to create tab after ${maxRetries} attempts: ${lastError?.message}`);
  }

  async scrape() {
    try {
      await this.initStatusPage();
      
      // Add initial URL
      const currentUrl = this.baseUrl;
      this.toVisit.add(this.normalizeUrl(currentUrl));
      
      // Start queue processor
      this.processQueue();
      
      // Monitor queue until complete
      while (this.isRunning && (this.toVisit.size > 0 || this.processingQueue.length > 0)) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        this.updateProgress(`Queued: ${this.toVisit.size}, Processing: ${this.processingQueue.length}`);
      }

      if (this.isRunning) {
        this.updateProgress('Creating downloads...');
        await this.downloadAll();
      }
    } finally {
      await this.cleanup();
    }
  }

  async processQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.isRunning && (this.toVisit.size > 0 || this.processingQueue.length > 0)) {
      try {
        // Fill processing queue
        while (this.toVisit.size > 0 && this.processingQueue.length < this.queueChunkSize) {
          const url = Array.from(this.toVisit)[0];
          this.toVisit.delete(url);
          if (!this.processedUrls.has(url)) {
            this.processingQueue.push(url);
          }
        }

        // Process chunk of URLs concurrently
        if (this.processingQueue.length > 0) {
          const chunk = this.processingQueue.splice(0, this.queueChunkSize);
          await Promise.all(chunk.map(url => this.processUrl(url)));
        }

        // Small delay between chunks to prevent browser freeze
        await new Promise(resolve => setTimeout(resolve, this.queueProcessDelay));
      } catch (error) {
        console.error('Queue processing error:', error);
        // Continue processing despite errors
      }
    }

    this.isProcessingQueue = false;
  }

  async processUrl(url) {
    // Check cache first
    const cachedData = this.urlCache.get(url);
    if (cachedData) {
      this.devLog(`Using cached data for ${url}`);
      this.processedUrls.add(url);
      
      // Process cached data
      const { html, title, links } = cachedData;
      const path = this.urlToPath(url);
      
      await this.cacheFile(path, html);
      this.htmlContent.set(url, { content: html, title });
      
      // Process links from cache
      for (const href of links) {
        try {
          const normalizedUrl = this.normalizeUrl(href);
          if (normalizedUrl && 
              normalizedUrl.startsWith(this.baseUrl) && 
              !this.processedUrls.has(normalizedUrl) && 
              !this.toVisit.has(normalizedUrl) &&
              !normalizedUrl.includes('#') && 
              !normalizedUrl.includes('wp-admin') && 
              !normalizedUrl.includes('wp-login') && 
              !normalizedUrl.includes('?') && 
              !normalizedUrl.match(/\.(jpg|jpeg|png|gif|css|js|xml|pdf)$/i)) {
            this.toVisit.add(normalizedUrl);
            this.updateProgress(`Queued from cache: ${normalizedUrl}`);
          }
        } catch (e) {
          console.error('Error processing cached link:', href, e);
        }
      }
      
      return;
    }

    // If not in cache, proceed with fetching
    let currentTabId = null;
    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount < maxRetries) {
      try {
        this.updateProgress(`Fetching: ${url}`);
        currentTabId = await this.createTab(url);
        await this.waitForPageLoad(currentTabId);
        
        // Wait for dynamic content to load
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const result = await chrome.scripting.executeScript({
          target: { tabId: currentTabId },
          func: () => {
            // Parse and process HTML in the tab context
            const doc = document;
            
            // Get all links, including those in text content
            const links = new Set();
            
            // Regular links
            doc.querySelectorAll('a[href]').forEach(a => links.add(a.href));
            
            // Find text nodes that might contain keywords
            const walker = document.createTreeWalker(
              document.body,
              NodeFilter.SHOW_TEXT,
              null,
              false
            );
            
            const keywords = new Set();
            let node;
            
            while (node = walker.nextNode()) {
              const text = node.textContent.trim();
              if (text.length > 0) {
                // Split on common delimiters and clean up
                text.split(/[\n\r,;&|]+/)
                  .map(k => k.trim())
                  .filter(k => k.length > 2) // Skip very short words
                  .forEach(keyword => keywords.add(keyword));
              }
            }
            
            // Convert keywords to URLs
            keywords.forEach(keyword => {
              const slug = keyword
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/(^-|-$)/g, '');
              
              if (slug) {
                links.add(`${window.location.origin}/${slug}`);
              }
            });
            
            return {
              html: document.documentElement.outerHTML,
              title: document.title,
              links: Array.from(links)
            };
          }
        });
        
        const { html, title, links } = result[0].result;
        const path = this.urlToPath(url);
        
        // Cache the results
        const cacheData = { html, title, links };
        this.urlCache.set(url, cacheData);
        
        // Save to IndexedDB
        const transaction = this.db.transaction(['urlCache'], 'readwrite');
        const store = transaction.objectStore('urlCache');
        await store.put({ url, data: cacheData });
        
        // Cache the HTML content
        await this.cacheFile(path, html);
        
        this.htmlContent.set(url, {
          content: html,
          title: title
        });
        this.processedUrls.add(url);
        
        // Process links
        for (const href of links) {
          try {
            const normalizedUrl = this.normalizeUrl(href);
            if (normalizedUrl && 
                normalizedUrl.startsWith(this.baseUrl) && 
                !this.processedUrls.has(normalizedUrl) && 
                !this.toVisit.has(normalizedUrl) &&
                !normalizedUrl.includes('#') && 
                !normalizedUrl.includes('wp-admin') && 
                !normalizedUrl.includes('wp-login') && 
                !normalizedUrl.includes('?') && 
                !normalizedUrl.match(/\.(jpg|jpeg|png|gif|css|js|xml|pdf)$/i)) {
              this.toVisit.add(normalizedUrl);
              this.updateProgress(`Queued: ${normalizedUrl}`);
            }
          } catch (e) {
            console.error('Error processing link:', href, e);
          }
        }

        await this.findAssets(null, url, currentTabId);
        break; // Success, exit retry loop
      } catch (error) {
        retryCount++;
        console.error(`Error processing ${url} (attempt ${retryCount}):`, error);
        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
      } finally {
        if (currentTabId) {
          await chrome.tabs.remove(currentTabId).catch(console.error);
          this.openTabs.delete(currentTabId);
        }
      }
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

      for (const asset of urls) {
        try {
          const response = await fetch(asset);
          if (response.ok) {
            const blob = await response.blob();
            const path = this.urlToPath(asset);
            await this.cacheFile(path, blob);
          }
        } catch (error) {
          this.devLog('Asset cache failed:', error);
        }
      }

      if (this.isPremium && this.advancedSelectors) {
        // Use premium selectors
        const dynamicContent = await this.advancedSelectors.findDynamicContent(doc);
        const frameworkAssets = this.advancedSelectors.extractFrameworkSpecificAssets(doc);
        const webFonts = this.advancedSelectors.findWebFonts(doc);
        
        // Add premium assets to processing
        [...dynamicContent, ...frameworkAssets, ...webFonts].forEach(url => {
          if (url?.startsWith(this.baseUrl)) {
            this.assets.add(url);
          }
        });
      }
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
    const BATCH_SIZE = 250; // Increased batch size
    const MAX_CONCURRENT = 3; // Number of concurrent zip operations
    
    try {
      if (!this.db) {
        throw new Error('Cache database not initialized');
      }

      this.updateProgress('Reading cached files...');
      
      // Get all files from cache
      const files = await new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['files'], 'readonly');
        const store = transaction.objectStore('files');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error('Failed to read from cache: ' + request.error));
      });

      if (!files || files.length === 0) {
        throw new Error('No files found in cache');
      }

      // Split files into batches
      const batches = [];
      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        batches.push(files.slice(i, i + BATCH_SIZE));
      }

      this.updateProgress(`Processing ${files.length} files in ${batches.length} batches...`);

      // Process batches concurrently
      let completedBatches = 0;
      const processBatch = async (batch, index) => {
        const zip = new JSZip();
        
        // Add all files to zip without waiting between each
        batch.forEach(file => {
          zip.file(file.path, file.content);
        });

        await this.createDownload(zip, index + 1);
        completedBatches++;
        this.updateProgress(`Completed ${completedBatches} of ${batches.length} batches`);
      };

      // Process batches with limited concurrency
      for (let i = 0; i < batches.length; i += MAX_CONCURRENT) {
        const currentBatches = batches.slice(i, i + MAX_CONCURRENT);
        await Promise.all(currentBatches.map((batch, idx) => 
          processBatch(batch, i + idx)
        ));
      }

      // After successful downloads, show completion message
      this.updateProgress('Downloads complete! You can now close this tab.');
      
      // Now we can safely delete the database
      try {
        await new Promise((resolve, reject) => {
          const request = indexedDB.deleteDatabase(this.dbName);
          request.onsuccess = resolve;
          request.onerror = reject;
        });
      } catch (error) {
        this.devLog('Failed to delete cache database:', error);
      }

      if (this.isPremium && this.compression) {
        // Use premium compression
        return this.compression.compressFiles(files);
      } else {
        // Use basic compression
        // ... existing basic compression code ...
      }

    } catch (error) {
      const errorMessage = error?.message || (typeof error === 'string' ? error : 'Unknown download error');
      this.devLog('Download failed:', {
        message: errorMessage,
        error: error
      });
      this.updateProgress(`Error creating downloads: ${errorMessage}`);
      throw new Error(`Download failed: ${errorMessage}`);
    }
  }

  async createDownload(zip, index) {
    try {
      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: {
          level: 1  // Fastest compression
        },
        streamFiles: true, // Enable streaming
        platform: 'UNIX' // Smaller zip files
      });
      
      // Convert blob to base64 data URL
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          chrome.downloads.download({
            url: reader.result,
            filename: `site-archive-part${index}.zip`,
            saveAs: true
          }, (downloadId) => {
            if (chrome.runtime.lastError) {
              reject(new Error(`Download failed: ${chrome.runtime.lastError.message}`));
              return;
            }
            resolve({ success: true, downloadId });
          });
        };
        
        reader.onerror = () => {
          reject(new Error('Failed to read zip file'));
        };
        
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      throw new Error(`Failed to create download: ${error.message}`);
    }
  }

  stop() {
    this.isRunning = false;
    this.updateProgress('Stopping scraper...');
    
    // Cancel any pending operations
    for (const timeout of this.timeouts) {
      clearTimeout(timeout);
    }
    
    // Close any open tabs except status
    for (const tabId of this.openTabs) {
      if (tabId !== this.statusTabId) {
        chrome.tabs.remove(tabId).catch(console.error);
      }
    }
    
    this.updateProgress('Scraping stopped by user. You can close this tab.');
  }

  async initDb() {
    try {
      const request = indexedDB.open(this.dbName, 2); // Increment version for new store
      
      request.onerror = (event) => {
        this.devLog('IndexedDB error:', event.target.error);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'path' });
        }
        if (!db.objectStoreNames.contains('urlCache')) {
          db.createObjectStore('urlCache', { keyPath: 'url' });
        }
      };

      this.db = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      // Load URL cache from IndexedDB
      const transaction = this.db.transaction(['urlCache'], 'readonly');
      const store = transaction.objectStore('urlCache');
      const request2 = store.getAll();
      
      request2.onsuccess = () => {
        const cachedUrls = request2.result || [];
        cachedUrls.forEach(item => {
          this.urlCache.set(item.url, item.data);
        });
        this.devLog(`Loaded ${this.urlCache.size} URLs from cache`);
      };
    } catch (error) {
      this.devLog('Failed to initialize cache:', error);
    }
  }

  async cacheFile(path, content) {
    if (!this.db) return;
    
    try {
      const transaction = this.db.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');
      await store.put({ path, content });
    } catch (error) {
      this.devLog('Cache write failed:', error);
    }
  }

  async getCachedFile(path) {
    if (!this.db) return null;
    
    try {
      const transaction = this.db.transaction(['files'], 'readonly');
      const store = transaction.objectStore('files');
      const request = store.get(path);
      
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result?.content || null);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      this.devLog('Cache read failed:', error);
      return null;
    }
  }

  async initDevMode() {
    try {
      // Try to load dev config
      const { devConfig } = await import('./config/dev.config.js').catch(() => ({
        devConfig: { devMode: false }
      }));

      // Validate security key using SHA-256
      if (devConfig.devMode && devConfig.securityKey) {
        const encoder = new TextEncoder();
        const data = encoder.encode(devConfig.securityKey);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        // Compare with known hash of your security key
        // Replace this with the hash of your actual security key
        const validHash = '1234...'; // Hash of your actual security key
        
        if (hashHex === validHash) {
          this.isDevMode = true;
          this.isPremium = true;
          this.devSettings = devConfig.settings;
          
          // Load local premium features
          await this.loadLocalPremiumFeatures();
          
          this.devLog('Development mode enabled with premium features');
        } else {
          console.warn('Invalid security key in dev config');
        }
      }
    } catch (error) {
      console.debug('Dev config not found or invalid');
    }
  }

  async loadLocalPremiumFeatures() {
    try {
      // Load from local premium features directory
      const compressionModule = await import('./premium-features/compression.js');
      const selectorsModule = await import('./premium-features/advanced-selectors.js');
      
      this.compression = new compressionModule.default();
      this.advancedSelectors = new selectorsModule.default();
      
      this.devLog('Local premium features loaded');
    } catch (error) {
      this.devLog('Error loading local premium features:', error);
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