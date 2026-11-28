/** Jest config — unit tests for pure vault/wallet logic only (no RN imports).
 *  ESM-only deps (`uuid` v14, `ed25519-hd-key`) break Jest's CJS runtime:
 *  `uuid` is mapped to the top-level v8 CJS build (tests only need its
 *  v1/v4 helpers), and ESM-only packages are transformed with babel-jest
 *  instead of ignored with the rest of node_modules. Test-only config —
 *  the app bundle is unaffected. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
    '^.+\\.jsx?$': 'babel-jest',
  },
  transformIgnorePatterns: ['/node_modules/(?!ed25519-hd-key|@noble|uuid|@nktkas/hyperliquid|@nktkas/rews|decimal\\.js|valibot)'],
  moduleNameMapper: {
    '^uuid$': '<rootDir>/node_modules/uuid/dist/index.js',
  },
};
