/**
 * The only module that names a `LOOP_*` variable (`tests/tooling`'s scan, `loopTestEnv.test.ts`).
 *
 * No imports: `cli.mjs`, `tools/ci/e2eGlobalTimeout.mjs` and Playwright's CommonJS loader load it.
 */

/**
 * Whether guard-bash's floor refuses a loop session to assign, export or unset `name`. Any case:
 * Windows reads `$env:loop_turns` as `LOOP_TURNS`.
 *
 * @param {string} name
 */
export const isLoopVariable = (name) => /^LOOP_\w+$/i.test(name);

const CODE_SETS = [
  /(?:process\.env\s*(?:\.\s*|\[\s*['"`])|os\.environ\s*\[\s*['"]|\$ENV\{\s*['"]?)LOOP_\w*['"`]?\s*[\]}]?\s*(?:\+|\?\?|\|\|)?=(?!=)/i,
  /os\.environ\.(?:pop|setdefault|update)\s*\([^)]*LOOP_/i,
  /(?:putenv|unsetenv)\s*\(\s*['"]LOOP_/i,
];

/**
 * Whether inline interpreter code (`node -e`, `python -c`, `perl -e`) sets or removes one of these
 * for itself and what it spawns. String concatenation is read through: `'LOOP_' + 'TURNS'`.
 *
 * @param {string} code
 */
export const codeSetsLoopVariable = (code) => CODE_SETS.some((re) => re.test(code));

const PHASES = /^[B-G]$/;
const COUNT = /^\d+$/;

/**
 * `loop` is `Boolean(LOOP_TURNS)`, the CLAUDE.md definition. A malformed value reads as null, never as a guess.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ loop: boolean, ticket: number|null, phase: "B"|"C"|"D"|"E"|"F"|"G"|null, reason: string|null, turns: number|null }}
 */
export function fromEnv(env = process.env) {
  const count = (v) => (COUNT.test(v ?? "") ? Number(v) : null);
  return {
    loop: Boolean(env.LOOP_TURNS),
    ticket: count(env.LOOP_TICKET),
    phase: PHASES.test(env.LOOP_PHASE ?? "") ? /** @type {"B"} */ (env.LOOP_PHASE) : null,
    reason: env.LOOP_REASON || null,
    turns: count(env.LOOP_TURNS),
  };
}

/**
 * What `queue-loop.mjs` spawns a session with, over `base`. Phase A is where derive() starts anyway;
 * handing it would pin a rebuilt worktree to A.
 *
 * @param {{ number: number, at?: string|null, reason?: string|null, turns: number }} o
 * @param {Record<string, string | undefined>} [base]
 */
export function spawnEnv({ number, at = null, reason = null, turns }, base = process.env) {
  return {
    ...base,
    LOOP_TURNS: String(turns),
    LOOP_TICKET: String(number),
    LOOP_PHASE: at && at !== "A" ? at : undefined,
    LOOP_REASON: reason ?? undefined,
  };
}

/**
 * The seams a test drives a loop tool through. Always `{}` in a loop session: a seam honoured there
 * would let a session point the gate at another worktree, base or tracker than its own.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ base?: string, worktree?: string, ghScript?: string, gitScript?: string }}
 */
export function testSeams(env = process.env) {
  if (env.LOOP_TURNS) return {};
  const seams = {
    base: env.LOOP_TEST_BASE,
    worktree: env.LOOP_TEST_WORKTREE,
    ghScript: env.LOOP_TEST_GH_SCRIPT,
    gitScript: env.LOOP_TEST_GIT_SCRIPT,
  };
  return Object.fromEntries(Object.entries(seams).filter(([, v]) => v));
}
