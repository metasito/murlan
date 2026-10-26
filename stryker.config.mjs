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
  "tests/bots/botFillScan.test.ts",
  "tests/bots/botPersonalitiesScan.test.ts",
  "tests/bots/botSearchTimeoutScan.test.ts",
  "tests/engine/dealScan.test.ts",
  "tests/engine/matchStateScan.test.ts",
  "tests/engine/sharedGameFlowScan.test.ts",
  "tests/server/activeGameStoreScan.test.ts",
  "tests/server/dbPush.test.ts",
  "tests/server/dbTlsScan.test.ts",
  "tests/server/deployRuntime.test.ts",
  "tests/server/exchangeVisibilityScan.test.ts",
  "tests/server/historyBound.test.ts",
  "tests/server/layering.test.ts",
  "tests/server/logRedactionScan.test.ts",
  "tests/server/noEnvReadAtImport.test.ts",
  "tests/server/pgConnections.test.ts",
  "tests/server/protocolEvents.test.ts",
  "tests/server/protocolVersion.test.ts",
  "tests/server/rateLimiterFactory.test.ts",
  "tests/server/rejoinFailure.test.ts",
  "tests/server/retentionOffWritePath.test.ts",
  "tests/server/seatAllocationScan.test.ts",
  "tests/server/seating.test.ts",
  "tests/server/serverLoadable.test.ts",
  "tests/server/sessionRevocation.test.ts",
  "tests/server/socketErrorLogging.test.ts",
  "tests/server/socketEvents.test.ts",
  "tests/server/storedShapeVersions.test.ts",
  "tests/server/tableOwnershipScan.test.ts",
  "tests/server/tableRuntimeScan.test.ts",
  "tests/server/testOnlyEnvScan.test.ts",
  "tests/server/usernameRule.test.ts",
];

/**
 * Behaviour tests of mutated code that live outside TEST_DIRS, named one by one: the dirs they sit in
 * hold mostly scans. tests/tooling/mutationScans.test.ts proves each exists and does not scan.
 */
export const EXTRA_TESTS = ["tests/ui-rules/scorePillStandings.test.ts"];

export const testFiles = [
  ...TEST_DIRS.flatMap((dir) =>
    readdirSync(path.join(import.meta.dirname, dir))
      .filter((name) => name.endsWith(".test.ts"))
      .map((name) => `${dir}/${name}`),
  ),
  ...EXTRA_TESTS,
]
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
