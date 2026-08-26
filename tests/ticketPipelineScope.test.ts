// tests/ticketPipelineScope.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { filesNamedIn } from "../lib/ticketPipeline/gate.ts";

describe("the files a ticket names", () => {
  // The pre-flight gate has no diff to read, so it reads the ticket. A Ground truth table names
  // every file worth reading — which is why the file *count* cannot run on this list, only the
  // path patterns over the handful of files that carry a design decision.
  test("finds paths written in prose and in a table", () => {
    const named = filesNamedIn(
      ["| `shared/schema.ts` | the tables |", "", "Also touches server/socket.ts and package.json."].join("\n")
    );
    assert.deepEqual(named.sort(), ["package.json", "server/socket.ts", "shared/schema.ts"]);
  });

  test("reports each path once however often it is mentioned", () => {
    assert.deepEqual(filesNamedIn("lib/a.ts, then lib/a.ts again, and lib/a.ts"), ["lib/a.ts"]);
  });

  test("a ticket naming no file yields an empty list rather than throwing", () => {
    assert.deepEqual(filesNamedIn("Make the button blue."), []);
  });

  // Prose about a package is not a manifest change; the dependency rule needs both, and this is
  // the half that must not fire on its own.
  test("a bare word that is not a path is not one", () => {
    assert.deepEqual(filesNamedIn("Reads well. Uses expo-router. Node 22."), []);
  });
});
