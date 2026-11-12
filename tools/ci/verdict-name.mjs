/**
 * Apart from tools/ci/verdict-check.mjs so target-freeze.mjs can import it: target-freeze evaluates
 * a head's copy with only its relative imports, and verdict-check's reach tests/e2e/tiers.mjs, a
 * target a pull request may retire.
 */
export const CHECK = "Test verdict";
