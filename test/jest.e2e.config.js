/* eslint-env node */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '..',
  testRegex: '.e2e.spec.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.(t|j)s',
    '!src/**/*.spec.ts',
    '!src/**/*.interface.ts',
    '!src/**/index.ts',
  ],
  coverageDirectory: './coverage-e2e',
  testEnvironment: 'node',
  testTimeout: 30000, // 30 seconds for E2E tests
  maxWorkers: 1, // Run E2E tests sequentially to avoid port conflicts
  // E2E tests need real uWebSockets.js, not mocks
  automock: false,
  // Ignore __mocks__ directory for E2E tests
  modulePathIgnorePatterns: ['<rootDir>/src/__mocks__'],
  // Force exit after tests complete (common for E2E tests with servers)
  forceExit: true,
};
