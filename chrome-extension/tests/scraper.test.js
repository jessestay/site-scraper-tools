import { SiteScraper } from '../scraper.js';

describe('SiteScraper', () => {
  let scraper;
  
  beforeEach(() => {
    // Mock window and SCRAPER_CONFIG
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

    scraper = new SiteScraper('https://example.com');
  });

  describe('normalizeUrl', () => {
    test('handles valid URLs', () => {
      expect(scraper.normalizeUrl('https://example.com/page')).toBe('https://example.com/page');
      expect(scraper.normalizeUrl('//example.com/page')).toBe('https://example.com/page');
      expect(scraper.normalizeUrl('/page')).toBe('https://example.com/page');
    });

    test('handles invalid URLs', () => {
      expect(() => scraper.normalizeUrl('invalid')).toThrow();
      expect(() => scraper.normalizeUrl('')).toThrow();
    });
  });

  describe('processUrl', () => {
    test('handles page load timeout', async () => {
      chrome.tabs.create.mockResolvedValue({ id: 1 });
      
      // Simulate timeout
      jest.useFakeTimers();
      const processPromise = scraper.processUrl('https://example.com');
      jest.advanceTimersByTime(31000);
      
      await expect(processPromise).rejects.toThrow('Page load timeout');
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
      const mockAssets = [
        'image.jpg',
        'script.js',
        'styles.css',
        'favicon.ico',
        'video.mp4'
      ];

      chrome.scripting.executeScript.mockResolvedValue([{
        result: mockAssets
      }]);

      await scraper.findAssets(null, 'https://example.com', 1);
      
      mockAssets.forEach(asset => {
        expect(scraper.assets.has(`https://example.com/${asset}`)).toBe(true);
      });
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
      global.fetch = jest.fn();
      global.FileReader = class {
        readAsDataURL() {
          setTimeout(() => this.onload({ target: { result: 'data:mock' } }), 0);
        }
      };
    });

    test('creates downloads for batches', async () => {
      const mockAssets = Array.from({ length: 60 }, (_, i) => ({
        url: `asset${i}.jpg`,
        size: 100 * 1024
      }));

      mockAssets.forEach(asset => {
        scraper.assets.add(`https://example.com/${asset.url}`);
        global.fetch.mockImplementationOnce(() => 
          Promise.resolve({
            ok: true,
            blob: () => Promise.resolve(new Blob(['.'.repeat(asset.size)]))
          })
        );
      });

      await scraper.downloadAll();

      // Verify download messages were sent
      const downloadMessages = chrome.runtime.sendMessage.mock.calls
        .filter(call => call[0].action === 'download');
      expect(downloadMessages.length).toBeGreaterThan(1);
    });

    test('handles download errors gracefully', async () => {
      // Mock a failed download
      chrome.runtime.sendMessage.mockImplementation((msg, callback) => {
        callback({ success: false, error: 'Mock download error' });
      });

      scraper.assets.add('https://example.com/test.jpg');
      global.fetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(['test']))
      });

      await expect(scraper.downloadAll()).rejects.toThrow('Download failed');
    });

    test('handles runtime errors', async () => {
      // Mock a runtime error
      chrome.runtime.sendMessage.mockImplementation((msg, callback) => {
        chrome.runtime.lastError = { message: 'Mock runtime error' };
        callback(null);
      });

      scraper.assets.add('https://example.com/test.jpg');
      global.fetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(['test']))
      });

      await expect(scraper.downloadAll()).rejects.toThrow('Chrome runtime error');
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
  beforeEach(() => {
    // Mock chrome.management API
    global.chrome.management = {
      getSelf: jest.fn()
    };
  });

  test('enables dev logging in development mode', () => {
    chrome.management.getSelf.mockImplementation(cb => 
      cb({ installType: 'development' })
    );
    
    const scraper = new SiteScraper('https://example.com');
    const consoleSpy = jest.spyOn(console, 'log');
    
    scraper.devLog('test message');
    expect(consoleSpy).toHaveBeenCalledWith(
      '[Scraper Debug]',
      'test message'
    );
  });

  test('disables dev logging in production mode', () => {
    chrome.management.getSelf.mockImplementation(cb => 
      cb({ installType: 'normal' })
    );
    
    const scraper = new SiteScraper('https://example.com');
    const consoleSpy = jest.spyOn(console, 'log');
    
    scraper.devLog('test message');
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});

describe('downloadAll with logging', () => {
  beforeEach(() => {
    // Setup dev mode
    chrome.management.getSelf.mockImplementation(cb => 
      cb({ installType: 'development' })
    );
    
    // Mock performance API
    global.performance = {
      now: jest.fn().mockReturnValue(0)
    };
    
    document.body.innerHTML = '';
  });

  test('logs progress in dev mode', async () => {
    const consoleSpy = jest.spyOn(console, 'log');
    
    // Add some test content
    scraper.htmlContent.set('https://example.com', {
      content: '<html></html>',
      title: 'Test'
    });
    
    await scraper.downloadAll();
    
    expect(consoleSpy).toHaveBeenCalledWith(
      '[Scraper Debug]',
      'Start',
      expect.any(String)
    );
    
    expect(consoleSpy).toHaveBeenCalledWith(
      '[Scraper Debug]',
      'Complete',
      expect.stringContaining('Total time')
    );
  });

  test('tracks asset processing statistics', async () => {
    scraper.assets.add('https://example.com/large.jpg');
    scraper.assets.add('https://example.com/small.jpg');
    
    // Mock one large file and one successful file
    global.fetch
      .mockResolvedValueOnce(Promise.resolve({
        ok: true,
        blob: () => Promise.resolve(new Blob(['.'.repeat(10 * 1024 * 1024)]))
      }))
      .mockResolvedValueOnce(Promise.resolve({
        ok: true,
        blob: () => Promise.resolve(new Blob(['.'.repeat(1024)]))
      }));
    
    await scraper.downloadAll();
    
    const statusText = document.querySelector('div').textContent;
    expect(statusText).toContain('Download complete');
    
    // Verify stats were logged
    const consoleSpy = jest.spyOn(console, 'log');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Assets Progress'),
      expect.stringContaining('Processed: 1, Skipped: 1')
    );
  });
}); 