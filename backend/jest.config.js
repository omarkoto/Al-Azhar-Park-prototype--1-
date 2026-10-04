// Three projects so each kind of test can run on its own:
//   unit — pure logic, no database
//   e2e  — the HTTP app (Nest + supertest) against the TEST database
//   db   — schema constraints & concurrency, directly against the TEST database
const base = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testEnvironment: 'node',
  rootDir: '.',
};

/** @type {import('jest').Config} */
module.exports = {
  testTimeout: 60000,
  projects: [
    { ...base, displayName: 'unit', testMatch: ['<rootDir>/src/**/*.spec.ts'] },
    {
      ...base,
      displayName: 'e2e',
      testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts'],
      setupFiles: ['<rootDir>/test/setup-env.ts'],
      globalSetup: '<rootDir>/test/global-setup.ts',
    },
    {
      ...base,
      displayName: 'db',
      testMatch: ['<rootDir>/test/db/**/*.db-spec.ts'],
      setupFiles: ['<rootDir>/test/setup-env.ts'],
      globalSetup: '<rootDir>/test/global-setup.ts',
    },
  ],
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/*.spec.ts'],
};
