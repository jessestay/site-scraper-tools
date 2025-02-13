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
      addListener: jest.fn()
    },
    onSuspend: {
      addListener: jest.fn()
    },
    sendMessage: jest.fn()
  },
  downloads: {
    download: jest.fn(),
    onChanged: {
      addListener: jest.fn()
    },
    cancel: jest.fn()
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