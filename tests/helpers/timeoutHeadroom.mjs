// The one rule both unit suites' time limits answer to: tests/native/harness/timeoutHeadroomEnvironment.mjs
// applies it to jest's tests and hooks, tests/helpers/timeoutHeadroomReporter.mjs to node:test's tests.

/**
 * A test that spends more than this share of its own time limit fails, though it finished. CI's
 * runners run a test several times slower than a developer's machine, and one runner several times
 * slower than the next (run 41610488122: a native test that takes 1.4 s locally crossed jest's 5 s),
 * so a test that sits inside its limit only on a quiet day is caught on the run that makes it slow.
 *
 * Size a limit at twice `1 / HEADROOM_SHARE` times the slowest CI run measured, so the slowest run
 * seen still sits at half this share.
 */
export const HEADROOM_SHARE = 0.25;

/**
 * @param {number} spentMs
 * @param {number} limitMs
 */
export const overHeadroom = (spentMs, limitMs) => Number.isFinite(limitMs) && spentMs > limitMs * HEADROOM_SHARE;

/**
 * @param {string} what
 * @param {number} spentMs
 * @param {number} limitMs
 */
export const headroomMessage = (what, spentMs, limitMs) =>
  `${what} took ${Math.round(spentMs)} ms, over ${HEADROOM_SHARE * 100}% of its ${limitMs} ms time limit: ` +
  `a loaded CI runner can take it past that limit. Make it cheaper, or give it a limit of ` +
  `${Math.ceil((2 * spentMs) / HEADROOM_SHARE / 1000)} s or more (tests/helpers/timeoutHeadroom.mjs).`;
