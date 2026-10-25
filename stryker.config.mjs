// Weekly mutation testing (.github/workflows/mutation.yml): a measurement, never a gate.
import { readdirSync } from "node:fs";
import path from "node:path";

export const TEST_DIRS = ["tests/engine", "tests/bots", "tests/server"];

/**
 * Kept out of the run because they call git, which the sandbox is not a checkout of, or read source
 * text, which is instrumented there: a scan's kill is a false kill. Static on purpose, never "whatever
 * failed the dry run" — tests/tooling/mutationScans.test.ts proves every entry scans.
 */
export const SCANS = [
  "tests/bots/botFill.test.ts",
  "tests/bots/botPersonalities.test.ts",
  "tests/bots/botSearchTimeout.test.ts",
  "tests/engine/deal.test.ts",
  "tests/engine/matchState.test.ts",
  "tests/engine/sharedGameFlow.test.ts",
  "tests/server/activeGameStoreScan.test.ts",
  "tests/server/dbPush.test.ts",
  "tests/server/dbTls.test.ts",
  "tests/server/deployRuntime.test.ts",
  "tests/server/exchangeVisibility.test.ts",
  "tests/server/historyBound.test.ts",
  "tests/server/layering.test.ts",
  "tests/server/logRedaction.test.ts",
  "tests/server/noEnvReadAtImport.test.ts",
  "tests/server/pgConnections.test.ts",
  "tests/server/protocolEvents.test.ts",
  "tests/server/protocolVersion.test.ts",
  "tests/server/rateLimiterFactory.test.ts",
  "tests/server/rejoinFailure.test.ts",
  "tests/server/retentionOffWritePath.test.ts",
  "tests/server/seatAllocation.test.ts",
  "tests/server/seating.test.ts",
  "tests/server/serverLoadable.test.ts",
  "tests/server/sessionRevocation.test.ts",
  "tests/server/socketErrorLogging.test.ts",
  "tests/server/socketEvents.test.ts",
  "tests/server/storedShapeVersions.test.ts",
  "tests/server/tableOwnership.test.ts",
  "tests/server/tableRuntimeScan.test.ts",
  "tests/server/testOnlyEnv.test.ts",
  "tests/server/usernameRule.test.ts",
];

export const testFiles = TEST_DIRS.flatMap((dir) =>
  readdirSync(path.join(import.meta.dirname, dir))
    .filter((name) => name.endsWith(".test.ts"))
    .map((name) => `${dir}/${name}`),
)
  .filter((file) => !SCANS.includes(file))
  .sort();

export const MUTATE = ["lib/game/**/*.ts", "server/game/**/*.ts"];

export default {
  testRunner: "tap",
  tap: { testFiles },
  mutate: MUTATE,
  coverageAnalysis: "perTest",
  // Scoped to what is mutated: the default reaches public/index.html, where Stryker's Babel 8 meets
  // babel-preset-expo's Babel 7.
  disableTypeChecks: "{lib/game,server/game}/**/*.ts",
  reporters: ["clear-text", "json", "progress-append-only"],
  clearTextReporter: { logTests: false },
  ignorePatterns: ["/ios", "/android", "/assets", "/public", "/reports"],
  concurrency: 4,
  dryRunTimeoutMinutes: 20,
  tempDirName: ".stryker-tmp",
  incrementalFile: "reports/stryker-incremental.json",
};
