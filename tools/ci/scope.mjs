/**
 * Which suites a change runs, for ci.yml's scope job: `node tools/ci/scope.mjs <base>` prints
 * `app=`, `harness=`, `scans=` and `native=` lines for `$GITHUB_OUTPUT`. It runs before any
 * `npm ci`, so it imports only `node:` modules and repository files that do the same.
 *
 * Every rule is an allowlist of what may skip, so a path no rule names runs the suite.
 */
import { readFileSync } from "node:fs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { changedFiles, git } from "../loop/cli.mjs";
import { needsNative, patchReader } from "./nativeScope.mjs";

/**
 * Prose the suite asserts *on* is not prose to this decision: `rulesAreSingleSourced.test.ts`
 * reads RULES.md, CLAUDE.md, the command files and docs/agents/, and `docs/**` TypeScript is in
 * tsconfig.json. Derived by `tests/tooling/ciScope.test.ts`, which reds on a path it misses.
 */
export const ASSERTED_PROSE =
  /^(docs\/agents\/|docs\/(PRIVACY|GAME-RULES|WEB-PERF|ARCHITECTURE|BRIEF|BETA-PLAYTEST|DISCONNECT-POLICY)\.md$|docs\/.*\.tsx?$|\.claude\/commands\/|CLAUDE\.md$)/;

export const PROSE = /^(docs\/|\.claude\/)|\.md$/;

/**
 * Deliberately the loop's *tests* and not the loop: `tools/ci/e2ePort.mjs` imports `reap.mjs` and
 * `scripts/contextSurface.mjs` imports `loop-derive.mjs`, so the loop's source can stop the browser
 * suite booting. Nothing imports a test.
 */
export const QUEUE_LOOP_TESTS = /^tools\/loop\/tests\//;

/**
 * What the loop's suite (docs/agents/checks.md) asserts on beyond its own code: the protocol
 * files, `.claude/settings.json`'s hook paths, package.json's script names, and ci.yml, whose job
 * names `check-steps.mjs` pins each delegated step to. Derived by `tests/tooling/ciScope.test.ts`.
 */
export const HARNESS =
  /^(tools\/loop\/|scripts\/lib\/(entry|proc|blockingStdout)\.mjs$|scripts\/nodeTest\.mjs$|tools\/ci\/(preflightMemory|native-budget|e2e-budget|e2e-shard|e2ePortRange|budget-gate)\.mjs$|tests\/helpers\/(importShellGuard\.ts|processWorlds\.ts|filesRunReporter\.mjs|fileDeadline\.mjs|runWatch\.mjs|exitGuard\.mjs|exitWatch\.mjs)$|docs\/agents\/|\.claude\/|CLAUDE\.md$|package\.json$|jest\.config\.js$|\.github\/workflows\/ci\.yml$)/;

/**
 * `scans` holds `docReferences.test.ts` and the other scans that list the repository from its
 * root: they reach every tracked path, so any change runs them.
 *
 * @param {string[]} changed
 * @returns {{app: boolean, harness: boolean, scans: boolean}}
 */
export function scopeOf(changed) {
  const only = (re) => changed.length > 0 && changed.every((f) => re.test(f));
  return {
    app: changed.some((f) => ASSERTED_PROSE.test(f)) || !(only(PROSE) || only(QUEUE_LOOP_TESTS)),
    harness: changed.some((f) => HARNESS.test(f)),
    scans: changed.length > 0,
  };
}

/** From `base` itself, not the merge base: a push's `before` is the commit it replaced. */
export const SCOPE_CHANGES = Object.freeze({ range: "..", worktree: false, untracked: false });

const EVERYTHING = { app: true, harness: true, scans: true, native: true };

/** @param {string} base */
export function scopeAt(base, at = git()) {
  try {
    const changed = changedFiles(at, { ...SCOPE_CHANGES, base });
    process.stderr.write(`Changed files:\n${changed.join("\n")}\n`);
    const before = changed.includes("package.json") ? at(["show", `${base}:package.json`]) : "";
    const readPatch = patchReader((rev, f) => at(["show", `${rev}:${f}`]), base);
    return { ...scopeOf(changed), native: needsNative(changed, before, readFileSync("package.json", "utf8"), readPatch) };
  } catch (err) {
    process.stderr.write(`No change set from ${base} — running everything: ${err?.message ?? err}\n`);
    return EVERYTHING;
  }
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const scope = process.argv[2] ? scopeAt(process.argv[2]) : EVERYTHING;
  for (const [key, value] of Object.entries(scope)) console.log(`${key}=${value}`);
}
