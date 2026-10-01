// Native-renderer tests. These run the app's code through React Native's own
// renderer with Platform.OS set to ios/android, which is the one thing the
// Playwright web suite structurally cannot do: react-native-web resolves a
// different module graph and takes the other side of every Platform branch.
//
// Every suite runs twice, once per platform, so a branch that is correct on
// Android and wrong on iOS shows up as one red project rather than a pass.
//
// Tests are .test.tsx on purpose: `npm test` globs tests/**/*.test.ts and must
// not pick these up — docs/agents/checks.md, "Node's TypeScript loader".
// Paths are interpolated rather than written as `<rootDir>/…`: substituting
// that token puts the checkout's own separators back into the glob, and on
// Windows micromatch reads a backslash as an escape rather than a separator. A
// checkout under a path like .claude/worktrees then matches no test at all, and
// jest reports a clean "no tests found" instead of a failure.
const rootDir = __dirname.replace(/\\/g, '/');

const PILE_ON_ONE_PLATFORM =
  'Counts pile-card mounts and flight clocks; trick.ts, the pile, useFlightClock and CardView branch only on web, never on ios against android.';
const IOS_ONLY = {
  'everyMomentHasACaller.test.tsx':
    'Asks which moment each table change raises; nothing from GameTable to lib/device/feedback branches on ios against android.',
  'oneSoundPerMoment.test.tsx':
    'Times the effects a bot manche starts in the mocked audio graph; nothing from GameTable to lib/device/feedback branches on ios against android.',
  'pileMountsOnceFull.test.tsx': PILE_ON_ONE_PLATFORM,
  'pileMountsOnceReduced.test.tsx': PILE_ON_ONE_PLATFORM,
};

const project = (platform) => ({
  preset: `jest-expo/${platform}`,
  displayName: platform,
  rootDir,
  testMatch: [
    `${rootDir}/tests/native/**/*.test.tsx`,
    ...(platform === 'ios' ? [] : Object.keys(IOS_ONLY).map((file) => `!${rootDir}/tests/native/${file}`)),
  ],
  setupFilesAfterEnv: [`${rootDir}/tests/native/setup.ts`],
  // react-native-worklets ships `.native.ts` files that call into a real
  // native module `setUpTests()` cannot stand in for under Jest. Its own
  // resolver strips the `.native` extension so requests resolve to the
  // plain (mockable) implementation instead — without it, requiring
  // react-native-reanimated throws before any test runs.
  resolver: require.resolve('react-native-worklets/jest/resolver'),
  // jest-expo transforms Metro's default asset extensions; FLAC is one metro.config.js adds.
  transform: { '^.+\\.flac$': require.resolve('jest-expo/src/preset/assetFileTransformer.js') },
});

module.exports = {
  projects: [project('ios'), project('android')],
  reporters: process.env.CI ? ['default', `${rootDir}/tools/ci/native-budget.mjs`] : ['default'],
  globalSetup: `${rootDir}/tools/ci/preflightMemory.mjs`,
  // A worker holds a whole React Native module graph, and jest's default is one
  // per core — enough of them to exhaust a developer machine's memory.
  maxWorkers: '50%',
};
