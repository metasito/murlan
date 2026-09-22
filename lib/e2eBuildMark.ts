// Leaves a string in a bundle built with any test-only flag and nothing in one built without:
// the flags are inlined at build time and the minifier drops the dead branch.
// `scripts/e2eBuildMark.mjs` reads the built output for it; `tests/tooling/e2eBuildMark.test.ts` fails
// if the app reads a flag this condition does not name.
if (
  process.env.EXPO_PUBLIC_E2E_FAST === '1' ||
  process.env.EXPO_PUBLIC_E2E_REDUCE_MOTION === '1'
) {
  (globalThis as { murlanE2EBuild?: string }).murlanE2EBuild = 'murlan-e2e-build';
}
