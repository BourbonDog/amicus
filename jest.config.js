// The hermetic config/keys pin (tests/setup/hermetic-config-dir.js) protects the UNIT
// suite only. The integration rails run *.integration.test.js with REAL creds (the paid
// `test:integration:live` rail) or a parent-process credential scrub (the keyless
// `test:integration` rail), and must manage their own credential env — so the pin is
// omitted when jest is invoked to run integration tests. Detected from argv, which
// carries the rails' `--testMatch=**/tests/**/*.integration.test.js` override.
const runningIntegration = process.argv.some((a) => a.includes('integration.test.js'));

module.exports = {
  testEnvironment: 'node',
  // Pin config/keys dirs to a per-worker scratch dir so no unit test can touch the real
  // ~/.config/amicus. Unit runs only — see the runningIntegration note above.
  ...(runningIntegration ? {} : { setupFiles: ['<rootDir>/tests/setup/hermetic-config-dir.js'] }),
  testMatch: ['**/tests/**/*.test.js'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '\\.integration\\.test\\.js$',
    'worktrees'
  ],
  collectCoverageFrom: [
    'src/**/*.js',
    'bin/**/*.js',
    'electron/**/*.js',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  verbose: true
};
