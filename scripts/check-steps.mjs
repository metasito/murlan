/**
 * Which check runs where, as data. `scripts/agent-check.mjs` runs the `local` ones;
 * `.github/workflows/ci.yml` runs the `ci` ones in the job each names.
 *
 * The split is by cost, not by importance: measured on a green run, the three local steps are 47s
 * of runner time against 249s for the delegated three, and that pair of suites is what starves
 * this machine. `npm test` also skips its integration suites here — they need the Postgres only
 * the `verify` job has. `tests/agentCheckDelegation.test.ts` pins every delegated step to a real
 * `run:` in that workflow: a check nobody runs is worse than no check.
 */
export const STEPS = [
  { name: "typecheck", args: ["run", "typecheck"], where: "local" },
  { name: "typecheck:strict", args: ["run", "typecheck:strict"], where: "local" },
  { name: "lint", args: ["run", "lint"], where: "local" },
  { name: "test", args: ["test"], where: "ci", job: "verify" },
  { name: "test:native", args: ["run", "test:native"], where: "ci", job: "native" },
  { name: "test:e2e", args: ["run", "test:e2e"], where: "ci", job: "browser" },
];

export const cmd = (step) => `npm ${step.args.join(" ")}`;
export const LOCAL = STEPS.filter((s) => s.where === "local");
export const DELEGATED = STEPS.filter((s) => s.where === "ci");
