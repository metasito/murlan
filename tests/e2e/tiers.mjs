// Which run a spec file belongs to. The tier is the filename suffix: a rename to or from
// `.nightly.spec.ts` is the only way to change one, so every change of tier shows in the diff.

/** Report-only, out of PR CI: the parity and pixel specs, run by playwright.parity.config.ts. */
export const NIGHTLY = /\.nightly\.spec\.ts$/;
/** Recorded only by playwright.perf.config.ts. */
export const PERF = /(^|\/)webPerf\.spec\.ts$/;
/** Playwright's default testMatch. */
export const SPEC = /\.(spec|test)\.[cm]?[jt]sx?$/;

/**
 * What the PR run executes: Playwright's default match minus NIGHTLY and PERF.
 * @param {string} file
 */
export const prSpec = (file) => SPEC.test(file) && !NIGHTLY.test(file) && !PERF.test(file);
