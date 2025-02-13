// Mock chrome API
global.chrome = {
  runtime: {
    onMessage: {
      addListener: jest.fn()
    },
    onSuspend: {
      addListener: jest.fn()
    }
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