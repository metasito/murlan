/**
 * Which check runs where. `agent-check.mjs` runs the `local` ones; `ci.yml` runs the `ci` ones in
 * the job each names, with the Postgres the integration suites need and this machine has not.
 * `tests/agentCheckDelegation.test.ts` pins each delegated step to a real command in that workflow.
 */
export const STEPS = [
  { name: "typecheck", args: ["run", "typecheck"], where: "local" },
  { name: "typecheck:strict", args: ["run", "typecheck:strict"], where: "local" },
  { name: "lint", args: ["run", "lint"], where: "local" },
  { name: "comments", args: ["run", "check:comments"], where: "local" },
  { name: "test", args: ["test"], where: "ci", job: "verify" },
  { name: "test:native", args: ["run", "test:native"], where: "ci", job: "native" },
  { name: "test:e2e", args: ["run", "test:e2e"], where: "ci", job: "browser" },
];

export const cmd = (step) => `npm ${step.args.join(" ")}`;
/** What a step announces itself with, so a test can tell that none of them ran. */
export const BANNER = "=== ";
export const LOCAL = STEPS.filter((s) => s.where === "local");
export const DELEGATED = STEPS.filter((s) => s.where === "ci");
