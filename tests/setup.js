// Mock window and SCRAPER_CONFIG globally
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
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    onSuspend: {
      addListener: jest.fn()
    },
    sendMessage: jest.fn(),
    getManifest: () => ({ version: '1.0.0' }),
    getURL: (path) => `chrome-extension://id/${path}`,
    lastError: null
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
    download: jest.fn(),
    onChanged: {
      addListener: jest.fn()
    },
    cancel: jest.fn()
  },
  management: {
    getSelf: jest.fn(cb => cb({ installType: 'development' }))
  }
};

// Mock fetch
global.fetch = jest.fn(() => 
  Promise.resolve({
    ok: true,
    text: () => Promise.resolve('<html><body>Test</body></html>')
  })
);

// Mock DOMParser
global.DOMParser = class {
  parseFromString(str) {
    return {
      querySelectorAll: () => []
    };
  }
};

// Mock performance API
global.performance = {
  memory: {
    usedJSHeapSize: 900,
    jsHeapSizeLimit: 1000
  },
  now: jest.fn().mockReturnValue(0)
};

// Mock document
document.body.innerHTML = ''; 