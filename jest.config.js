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
// Paths are interpolated rather than written as `<rootDir>/…`: substituting
// that token puts the checkout's own separators back into the glob, and on
// Windows micromatch reads a backslash as an escape rather than a separator. A
// checkout under a path like .claude/worktrees then matches no test at all, and
// jest reports a clean "no tests found" instead of a failure.
const rootDir = __dirname.replace(/\\/g, '/');

const project = (platform) => ({
  preset: `jest-expo/${platform}`,
  displayName: platform,
  rootDir,
  testMatch: [`${rootDir}/tests/native/**/*.test.tsx`],
  setupFilesAfterEnv: [`${rootDir}/tests/native/setup.ts`],
  // react-native-worklets ships `.native.ts` files that call into a real
  // native module `setUpTests()` cannot stand in for under Jest. Its own
  // resolver strips the `.native` extension so requests resolve to the
  // plain (mockable) implementation instead — without it, requiring
  // react-native-reanimated throws before any test runs.
  resolver: require.resolve('react-native-worklets/jest/resolver'),
});

module.exports = {
  projects: [project('ios'), project('android')],
  globalSetup: `${rootDir}/scripts/preflightMemory.mjs`,
  // A worker holds a whole React Native module graph, and jest's default is one
  // per core — enough of them to exhaust a developer machine's memory.
  maxWorkers: '50%',
};
