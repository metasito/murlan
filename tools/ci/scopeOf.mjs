/**
 * Which suites a change set runs, as a pure decision: tools/ci/scope.mjs reads the change set for
 * ci.yml's scope job, and the base's tools/ci/test-verdict.mjs holds the run to it. It imports
 * nothing, so the verdict can run it from a `git archive` of tools/ci alone.
 *
 * Every rule is an allowlist of what may skip, so a path no rule names runs the suite.
 */

/**
 * Prose the suite asserts *on* is not prose to this decision: `rulesAreSingleSourced.test.ts`
 * reads RULES.md, CLAUDE.md, the command files and docs/agents/, and `docs/**` TypeScript outside
 * `docs/research/` is in tsconfig.json. Derived by `tests/tooling/ciScope.test.ts`, which reds on a path it misses.
 */
export const ASSERTED_PROSE =
  /^(docs\/agents\/|docs\/(PRIVACY|GAME-RULES|WEB-PERF|ARCHITECTURE|BRIEF|BETA-PLAYTEST|DISCONNECT-POLICY)\.md$|docs\/adr\/README\.md$|docs\/(?!research\/).*\.tsx?$|\.claude\/commands\/|CLAUDE\.md$|CONTEXT\.md$|README\.md$)/;

export const PROSE = /^(docs\/|\.claude\/)|\.md$/;

/**
 * Deliberately the loop's *tests* and not the loop: `scripts/contextSurface.mjs` imports
 * `loop-derive.mjs`, so the loop's source can stop the browser suite booting. Nothing imports a test.
 */
export const QUEUE_LOOP_TESTS = /^tools\/loop\/tests\//;

/**
 * What the loop's suite (docs/agents/loop-harness.md) asserts on beyond its own code: the protocol
 * files, `.claude/settings.json`'s hook paths, package.json's script names, and ci.yml, whose job
 * names `check-steps.mjs` pins each delegated step to. Derived by `tests/tooling/ciScope.test.ts`.
 */
export const HARNESS =
  /^(tools\/loop\/|scripts\/lib\/(entry|proc|blockingStdout)\.mjs$|scripts\/nodeTest\.mjs$|tools\/ci\/(preflightMemory|native-budget|results-writer|results-node-reporter|e2e-budget|e2e-shard|e2ePortRange|e2eOwner|budget-gate)\.mjs$|tests\/helpers\/(importShellGuard\.ts|processWorlds\.ts|filesRunReporter\.mjs|fileDeadline\.mjs|runWatch\.mjs|exitGuard\.mjs|exitWatch\.mjs|timeoutHeadroom\.mjs|timeoutHeadroomReporter\.mjs)$|docs\/agents\/|\.claude\/|CLAUDE\.md$|package\.json$|jest\.config\.js$|\.github\/workflows\/ci\.yml$)/;

/**
 * `scans` holds `docReferences.test.ts` and the other scans that list the repository from its
 * root: they reach every tracked path, so any change runs them.
 *
 * @param {string[]} changed
 * @returns {{app: boolean, harness: boolean, scans: boolean}}
 */
export function scopeOf(changed) {
  const only = (/** @type {RegExp} */ re) => changed.length > 0 && changed.every((f) => re.test(f));
  return {
    app: changed.some((f) => ASSERTED_PROSE.test(f)) || !(only(PROSE) || only(QUEUE_LOOP_TESTS)),
    harness: changed.some((f) => HARNESS.test(f)),
    scans: changed.length > 0,
  };
}

/**
 * The one map from a scope to the jobs it runs: ci.yml's scope job prints it as `jobs`, each job's
 * `if:` reads its own key (tests/tooling/ciScope.test.ts), and the base's verdict holds a skipped
 * job to the base's copy.
 * @type {Readonly<Record<string, (scope: ReturnType<typeof scopeOf>) => boolean>>}
 */
export const JOBS = Object.freeze({
  verify: (s) => s.app || s.scans,
  native: (s) => s.app,
  harness: (s) => s.harness,
  "harness-windows": (s) => s.harness,
  lint: (s) => s.app,
  browser: (s) => s.app,
  build: (s) => s.app,
});

/** @param {ReturnType<typeof scopeOf>} scope @returns {Record<string, boolean>} */
export const jobsOf = (scope) => Object.fromEntries(Object.entries(JOBS).map(([job, runs]) => [job, runs(scope)]));
