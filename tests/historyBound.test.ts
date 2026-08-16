// tests/historyBound.test.ts — match_history is pruned on every write, and the
// same bound has to govern the read.
//
// If the read limit were larger, the profile would list rows that the next
// game is about to delete — history that appears to vanish on its own. If it
// were smaller, rows deliberately kept would be invisible and the pruning
// would be doing work nobody benefits from. Neither shows up as an error, so
// the two are pinned to one constant here.
//
// server/stats.ts imports pg at module scope, so it cannot be loaded without a
// database. Read as source instead: this is a structural claim about the file,
// not a behavioural one about a query.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(repoRoot, "server", "stats.ts"), "utf8");

describe("match history stays bounded", () => {
  test("the bound is declared exactly once", () => {
    const declarations = source.match(/const MAX_HISTORY_ROWS_PER_USER\s*=/g) ?? [];
    assert.equal(declarations.length, 1, "the bound must have a single definition");
  });

  test("both the prune and the read use it, and neither hardcodes a number", () => {
    const uses = source.match(/limit\(?\s*:?\s*MAX_HISTORY_ROWS_PER_USER/g) ?? [];
    assert.ok(
      uses.length >= 2,
      `expected the prune and the read to share the bound, found ${uses.length} use(s)`
    );
    const hardcoded = source.match(/limit\(?\s*:?\s*\d+/g) ?? [];
    assert.deepEqual(hardcoded, [], `a numeric limit bypasses the shared bound: ${hardcoded}`);
  });

  test("pruning happens in the same transaction as the insert that triggers it", () => {
    // A prune outside the transaction can interleave with a concurrent write
    // and delete a row that was just added for another game.
    const tx = source.slice(source.indexOf("tx.insert(matchHistory)"));
    const pruneAt = tx.indexOf("delete(matchHistory)");
    assert.ok(pruneAt > 0, "no prune found after the history insert");
    const txEnd = tx.indexOf("});", pruneAt);
    assert.ok(txEnd > pruneAt, "the prune appears to fall outside the transaction block");
    assert.ok(
      tx.slice(0, pruneAt).includes("tx\n") || tx.slice(0, pruneAt).includes("tx."),
      "the prune must run on the transaction handle, not the pool"
    );
  });

  test("the bound is a sane size for a display list", () => {
    const value = Number(/const MAX_HISTORY_ROWS_PER_USER\s*=\s*(\d+)/.exec(source)![1]);
    assert.ok(value >= 20 && value <= 200, `${value} rows is not a display list`);
  });
});
