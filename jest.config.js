// Native-renderer tests. These run the app's code through React Native's own
// renderer with Platform.OS set to ios/android, which is the one thing the
// Playwright web suite structurally cannot do: react-native-web resolves a
// different module graph and takes the other side of every Platform branch.
//
// Every suite runs twice, once per platform, so a branch that is correct on
// Android and wrong on iOS shows up as one red project rather than a pass.
//
// Tests are .test.tsx on purpose: `npm test` globs tests/**/*.test.ts and must
// not pick these up, since Node's type stripper cannot load react-native.
const project = (platform) => ({
  preset: `jest-expo/${platform}`,
  displayName: platform,
  rootDir: __dirname,
  testMatch: ['<rootDir>/tests/native/**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/tests/native/setup.ts'],
});

module.exports = {
  projects: [project('ios'), project('android')],
};
