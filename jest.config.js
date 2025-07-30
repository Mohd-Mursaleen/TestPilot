// jest.config.js
export default {
  testEnvironment: "node", // Use "jsdom" for projects that manipulate the DOM
  verbose: true, // Display detailed information during tests
  testTimeout: 180000,
  extensionsToTreatAsEsm: ['.js'],
  globals: {
    'ts-jest': {
      useESM: true
    }
  },
  moduleNameMapping: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  }
};
