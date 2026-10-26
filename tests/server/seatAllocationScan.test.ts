// tests/server/seatAllocationScan.test.ts — the source scan split out of seatAllocation.test.ts so the mutation run keeps that file's behaviour tests
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

describe("the age the hold is measured on", () => {
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "server", "store", "friendStore.ts"),
    "utf8"
  );

  /** The `gameInvites` insert, from `.insert(gameInvites)` to its `.returning(`. */
  function inviteWrite(): string {
    const open = source.indexOf(".insert(gameInvites)");
    assert.ok(open >= 0, "friendStore.ts no longer inserts a game invite where this test looks");
    const close = source.indexOf(".returning(", open);
    assert.ok(close > open, "the game invite insert never ends");
    return source.slice(open, close);
  }

  test("comes from the database's clock, and only once", () => {
    // `created_at` defaults to `now()` on insert, and `heldSeats` reads the
    // window as an age against it. A stamp written by the app server puts two
    // clocks in one column, so rows are no longer even ordered by age.
    assert.ok(
      !/new Date\(\)/.test(inviteWrite()),
      "an invite's created_at is stamped from Node, which is not the clock the insert used"
    );
    // A hold is a cap on the room, not a lease: whatever the conflict path
    // updates, it is never the column the hold is measured from.
    const conflictUpdate = /set:\s*\{([^}]*)\}/.exec(inviteWrite())?.[1];
    assert.ok(conflictUpdate, "the invite insert no longer has an onConflictDoUpdate set");
    assert.ok(
      !/createdAt/.test(conflictUpdate),
      "the conflict path restamps created_at, so a re-invite renews a hold that must not be renewable"
    );
  });
});
