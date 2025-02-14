import { SiteScraper } from '../scraper.js';

describe('SiteScraper', () => {
  let scraper;
  
  beforeAll(() => {
    // Ensure window.SCRAPER_CONFIG exists
    if (!global.window?.SCRAPER_CONFIG) {
      global.window = {
        SCRAPER_CONFIG: {
          version: '1.0.4',
          features: {
            rateLimit: true,
            memoryManagement: true,
            assetCaching: true
          }
        }
      };
    }
  });
  
  beforeEach(() => {
    // Mock chrome API
    global.chrome = {
      runtime: {
        getManifest: () => ({ version: '1.0.0' }),
        getURL: (path) => `chrome-extension://id/${path}`,
        lastError: null,
        sendMessage: jest.fn()
      },
      tabs: {
        create: jest.fn(),
        remove: jest.fn(),
        onUpdated: {
          addListener: jest.fn(),
          removeListener: jest.fn()
        }
      },
      scripting: {
        executeScript: jest.fn()
      },
      downloads: {
        download: jest.fn()
      },
      management: {
        getSelf: jest.fn(cb => cb({ installType: 'development' }))
      }
    };

    // Mock successful fetch
    global.fetch = jest.fn(() => 
      Promise.resolve({
        ok: true,
        blob: () => Promise.resolve(new Blob(['test'])),
        text: () => Promise.resolve('<html><body>Test</body></html>')
      })
    );

    scraper = new SiteScraper();
    scraper.baseUrl = 'https://example.com';
  });

  describe('normalizeUrl', () => {
    test('handles valid URLs', () => {
      expect(scraper.normalizeUrl('https://example.com/page')).toBe('https://example.com/page');
      expect(scraper.normalizeUrl('//example.com/page')).toBe('https://example.com/page');
      expect(scraper.normalizeUrl('/page')).toBe('https://example.com/page');
    });

    test('handles invalid URLs', () => {
      expect(() => scraper.normalizeUrl('')).toThrow('URL cannot be empty');
      expect(() => scraper.normalizeUrl('invalid')).toThrow('Invalid URL');
    });
  });

  describe('processUrl', () => {
    test('handles page load timeout', async () => {
      chrome.tabs.create.mockResolvedValue({ id: 1 });
      
      // Mock tab update listener that never completes
      chrome.tabs.onUpdated.addListener = jest.fn((listener) => {
        // Don't call listener to simulate timeout
      });
      
      // Use shorter timeout for test
      await expect(scraper.processUrl('https://example.com', 100))
        .rejects
        .toThrow('Page load timeout');
    });

    test('retries failed requests', async () => {
      const url = 'https://example.com';
      chrome.tabs.create.mockRejectedValueOnce(new Error('Network error'));
      chrome.tabs.create.mockResolvedValueOnce({ id: 1 });
      
      await scraper.processUrl(url);
      expect(chrome.tabs.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('findAssets', () => {
    test('collects all asset types', async () => {
      const html = `
        <img src="image.jpg">
        <script src="script.js"></script>
        <link rel="stylesheet" href="styles.css">
        <video src="video.mp4"></video>
        <audio src="audio.mp3"></audio>
      `;
      
      const doc = new DOMParser().parseFromString(html, 'text/html');
      await scraper.findAssets(doc, 'https://example.com');
      
      expect(scraper.assets.has('https://example.com/image.jpg')).toBe(true);
      expect(scraper.assets.has('https://example.com/script.js')).toBe(true);
      expect(scraper.assets.has('https://example.com/styles.css')).toBe(true);
      expect(scraper.assets.has('https://example.com/video.mp4')).toBe(true);
      expect(scraper.assets.has('https://example.com/audio.mp3')).toBe(true);
    });
  });

  describe('cleanup', () => {
    test('removes all tabs and clears data', async () => {
      scraper.openTabs.add(1);
      scraper.openTabs.add(2);
      
      await scraper.cleanup();
      
      expect(chrome.tabs.remove).toHaveBeenCalledTimes(2);
      expect(scraper.openTabs.size).toBe(0);
      expect(scraper.objectUrls.size).toBe(0);
      expect(scraper.timeouts.size).toBe(0);
    });
  });

  describe('downloadAll', () => {
    beforeEach(() => {
      // Reset mocks
      global.fetch.mockReset();
      chrome.runtime.sendMessage.mockReset();
      
      // Mock successful fetch by default
      global.fetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(['test']))
      });
    });

    test('creates downloads for batches', async () => {
      const mockAssets = Array.from({ length: 5 }, (_, i) => ({
        url: `asset${i}.jpg`,
        size: 100 * 1024
      }));

      mockAssets.forEach(asset => {
        scraper.assets.add(`https://example.com/${asset.url}`);
      });

      const downloads = await scraper.downloadAll();
      expect(downloads.length).toBe(mockAssets.length);
    });

    test('handles download errors gracefully', async () => {
      // Mock a failed fetch
      global.fetch.mockRejectedValueOnce(new Error('Network error'));
      
      scraper.assets.add('https://example.com/test.jpg');
      const downloads = await scraper.downloadAll();
      
      expect(downloads.length).toBe(0);
    });

    test('handles runtime errors', async () => {
      // Mock a runtime error in fetch
      global.fetch.mockImplementationOnce(() => {
        throw new Error('Runtime error');
      });

      scraper.assets.add('https://example.com/test.jpg');
      const downloads = await scraper.downloadAll();
      
      expect(downloads.length).toBe(0);
    });
  });

  describe('Rate Limiting', () => {
    test('respects rate limits', async () => {
      const startTime = Date.now();
      const requests = Array(31).fill('https://example.com/test.jpg');
      
      // Mock Date.now to advance time
      const realDateNow = Date.now;
      let currentTime = startTime;
      global.Date.now = jest.fn(() => {
        currentTime += 100;
        return currentTime;
      });

      try {
        await Promise.all(requests.map(url => scraper.fetch(url)));
        const duration = currentTime - startTime;
        expect(duration).toBeGreaterThanOrEqual(1000);
      } finally {
        global.Date.now = realDateNow;
      }
    });
  });

  describe('Memory Management', () => {
    test('handles high memory conditions', async () => {
      // Mock high memory usage
      global.performance.memory = {
        usedJSHeapSize: 900 * 1024 * 1024,
        jsHeapSizeLimit: 1000 * 1024 * 1024
      };

      const isHigh = await scraper.isMemoryHigh();
      expect(isHigh).toBe(true);

      // Test cleanup
      await scraper.cleanupMemory();
      expect(scraper.pageQueue.length).toBe(0);
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (scraper && scraper.cleanup) {
      scraper.cleanup();
    }
  });
});

describe('Development Mode', () => {
  let consoleSpy;
  
  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('enables dev logging in development mode', async () => {
    chrome.management.getSelf.mockImplementation(cb => 
      cb({ installType: 'development' })
    );
    
    const scraper = new SiteScraper();
    await scraper.devLog('test message');
    
    expect(consoleSpy).toHaveBeenCalledWith(
      '[Scraper Debug]',
      'test message'
    );
  });

  test('disables dev logging in production mode', async () => {
    chrome.management.getSelf.mockImplementation(cb => 
      cb({ installType: 'normal' })
    );
    
    const scraper = new SiteScraper();
    await scraper.devLog('test message');
    
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});

describe('downloadAll with logging', () => {
  let localScraper;
  
  beforeEach(() => {
    localScraper = new SiteScraper();
    localScraper.baseUrl = 'https://example.com';
    
    // Mock successful fetch
    global.fetch = jest.fn(() => 
      Promise.resolve({
        ok: true,
        blob: () => Promise.resolve(new Blob(['test']))
      })
    );

    // Setup dev mode
    chrome.management.getSelf.mockImplementation(cb => 
      cb({ installType: 'development' })
    );
  });

  test('logs progress in dev mode', async () => {
    localScraper.assets = new Set(['https://example.com/test.jpg']);
    const consoleSpy = jest.spyOn(console, 'log');
    
    await localScraper.downloadAll();
    
    expect(consoleSpy).toHaveBeenCalledWith(
      '[Scraper Debug]',
      'Start',
      expect.any(String)
    );
  });

  test('tracks asset processing statistics', async () => {
    localScraper.assets = new Set();
    localScraper.assets.add('https://example.com/large.jpg');
    localScraper.assets.add('https://example.com/small.jpg');
    
    const consoleSpy = jest.spyOn(console, 'log');
    
    await localScraper.downloadAll();
    
    expect(consoleSpy).toHaveBeenCalledWith(
      '[Scraper Debug]',
      'Complete',
      expect.stringContaining('Total time'),
      expect.objectContaining({
        total: 2,
        successful: 2,
        failed: 0
      })
    );
  });
}); 