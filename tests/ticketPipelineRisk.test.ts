import test from "node:test";
import assert from "node:assert/strict";

import { readSecondOpinion, riskyPaths } from "../lib/ticketPipeline/risk.ts";

test("a diff of screens and copy costs no second pass", () => {
  assert.deepEqual(
    riskyPaths(["app/index.tsx", "components/GameTable.tsx", "locales/en.ts", "docs/RULES.md"]),
    []
  );
});

test("the rules, the server, the wire and the pipeline each earn one", () => {
  assert.deepEqual(riskyPaths(["lib/gameEngine.ts"]), ["lib/gameEngine.ts"]);
  assert.deepEqual(riskyPaths(["server/routes.ts"]), ["server/"]);
  assert.deepEqual(riskyPaths(["lib/ticketPipeline/land.ts"]), ["lib/ticketPipeline/"]);
  assert.deepEqual(riskyPaths([".github/workflows/ci.yml"]), [".github/"]);
});

// `shared/schema.ts` matches the exact entry and the `shared/` prefix both, and a caller that
// deduplicated by file rather than by rule would report one path and understate the diff.
test("a file under two rules reports both, and each rule reports once", () => {
  assert.deepEqual(riskyPaths(["shared/schema.ts", "shared/events.ts"]), [
    "shared/schema.ts",
    "shared/",
  ]);
});

// The runner shells out to git, which answers with forward slashes — but this repo is worked
// on Windows and a caller normalising paths itself would hand this backslashes.
test("a Windows-shaped path is still recognised", () => {
  assert.deepEqual(riskyPaths(["server\\socket.ts"]), ["server/"]);
});

test("an explicit hold holds, and carries its reason", () => {
  const opinion = readSecondOpinion("Long analysis.\n\nVERDICT: HOLD — the exchange runs twice");
  assert.equal(opinion.verdict, "hold");
  assert.equal(opinion.reason, "the exchange runs twice");
});

test("a hold with no reason still holds", () => {
  assert.equal(readSecondOpinion("VERDICT: HOLD").verdict, "hold");
});

test("the last verdict line wins, so quoting the instruction does not decide the run", () => {
  const reply = "I was told to answer `VERDICT: HOLD — like this`.\n\nVERDICT: LAND";
  assert.equal(readSecondOpinion(reply).verdict, "land");
});

// The direction this is required to fail in: the owner's standing decision is that the
// pipeline merges its own work, so a reader that never answers must not be able to park the
// queue. Every one of these is a reviewer failing, and every one of them lands.
test("a reply with no verdict line lands rather than parking the ticket", () => {
  for (const reply of ["", "   ", "I ran out of context mid-sentence and", "VERDICTish: HOLD"]) {
    assert.equal(readSecondOpinion(reply).verdict, "land", JSON.stringify(reply));
  }
});
