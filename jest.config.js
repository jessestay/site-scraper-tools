export default {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.js$': ['babel-jest', { rootMode: 'upward' }]
  },
  moduleNameMapper: {
    '^chrome-extension/(.*)$': '<rootDir>/chrome-extension/$1'
  },
  moduleDirectories: ['node_modules', '<rootDir>'],
  setupFiles: ['./tests/setup.js'],
  collectCoverage: true,
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(source-map|source-map-support)/)'
  ],
  moduleFileExtensions: ['js', 'json', 'jsx'],
  testPathIgnorePatterns: ['/node_modules/'],
  verbose: true
}; 