// `server/game` is the table; `socket/` and `http/` are transports above it. Each edge
// upward is listed by name, so a new one and a removed one both fail here.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { moduleEdges } from "../helpers/moduleEdges.ts";
import { sourcesUnder } from "../helpers/sourceScan.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const UPWARD = /^server\/(socket|http)\//;

const upwardEdges = (sources: [string, string][]) =>
  sources
    .flatMap(([file, text]) =>
      moduleEdges(file, text, { types: true })
        .filter((e) => e.local && UPWARD.test(e.to))
        .map((e) => `${path.posix.basename(file)} -> ${e.to.slice("server/".length)}.ts`)
    )
    .sort();

test("an upward edge is seen by any spelling of its specifier", () => {
  const planted = (spec: string) => upwardEdges([["server/game/gameTurn.ts", `import "${spec}";`]]);
  assert.deepEqual(planted("@/server/socket/plant"), ["gameTurn.ts -> socket/plant.ts"]);
  assert.deepEqual(planted("../socket/plant"), ["gameTurn.ts -> socket/plant.ts"]);
  assert.deepEqual(planted("../../server/http/plant"), ["gameTurn.ts -> http/plant.ts"]);
  assert.deepEqual(planted("./plant"), []);
});

test("server/game reaches socket/ and http/ only through these edges", () => {
  const edges = upwardEdges(sourcesUnder(REPO, ["server/game"]));
  assert.deepEqual(edges, [
    "gamePersistence.ts -> http/clock.ts",
    "gameTimers.ts -> http/clock.ts",
    "gameTimers.ts -> http/testOnlyEnv.ts",
    "gameTurn.ts -> http/clock.ts",
    "ratings.ts -> http/clock.ts",
    "retention.ts -> http/bugReports.ts",
    "retention.ts -> http/clientErrors.ts",
    "retention.ts -> http/clock.ts",
    "retention.ts -> http/serverErrors.ts",
    "retention.ts -> socket/ticket.ts",
    "roundOver.ts -> http/clock.ts",
    "roundResults.ts -> http/clock.ts",
    "stats.ts -> http/clock.ts",
    "tableHandOff.ts -> http/clock.ts",
    "tableHandlers.ts -> socket/socketTable.ts",
    "tableLifecycle.ts -> socket/seating.ts",
    "tableLifecycle.ts -> socket/socketTable.ts",
    "tableRouter.ts -> http/clock.ts",
    "tableRuntime.ts -> socket/socketTypes.ts",
  ]);
});
