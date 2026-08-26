// tests/ticketPipelineScope.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { filesNamedIn, outgrewItsTicket } from "../lib/ticketPipeline/gate.ts";

describe("whether a finished diff outgrew its ticket", () => {
  test("escalates a change spanning more than 6 files with no recorded decision", () => {
    const result = outgrewItsTicket({
      filesTouched: Array.from({ length: 7 }, (_, i) => `components/File${i}.tsx`),
      body: "Rename a prop across the codebase.",
    });
    assert.equal(result.escalate, true);
    assert.match(result.reason, /7 files/);
  });

  // Every user-facing string is keyed in all three locales, and `it.ts`/`sq.ts` are
  // `Record<keyof typeof en, string>`, so a gap is a compile error rather than a decision. Counted
  // separately they spend three of the six the threshold allows, and #349 — a chip label, four
  // real files — escalated at seven.
  test("the three locale files count as the one edit the compiler forces", () => {
    const result = outgrewItsTicket({
      filesTouched: [
        "components/GameTable.tsx",
        "components/table/pile.tsx",
        "components/gameTableModel.ts",
        "lib/gameEngine.ts",
        "locales/en.ts",
        "locales/it.ts",
        "locales/sq.ts",
      ],
      body: "Name the player who made the play now on the felt.",
    });
    assert.equal(result.escalate, false, result.reason);
  });

  test("collapsing the locales does not hide a genuinely broad change", () => {
    const result = outgrewItsTicket({
      filesTouched: [
        ...Array.from({ length: 6 }, (_, i) => `components/File${i}.tsx`),
        "locales/en.ts",
        "locales/it.ts",
        "locales/sq.ts",
      ],
      body: "Rename a prop across the codebase.",
    });
    assert.equal(result.escalate, true);
    assert.match(result.reason, /7 files/);
  });

  test("a recorded decision is what a broad change needs, and clears it", () => {
    const result = outgrewItsTicket({
      filesTouched: Array.from({ length: 20 }, (_, i) => `components/File${i}.tsx`),
      body: "Per docs/adr/0004-prop-rename.md, rename it everywhere.",
    });
    assert.equal(result.escalate, false, result.reason);
  });
});

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
