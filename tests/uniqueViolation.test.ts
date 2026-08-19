import { test } from "node:test";
import assert from "node:assert/strict";
import { __testables } from "../server/storage.ts";

const { uniqueViolation } = __testables;

// drizzle-orm wraps the driver error, so both the friend-code retry and the
// USERNAME_TAKEN 409 read the constraint through the cause chain.
test("a wrapped 23505 still names its constraint", () => {
  const pgError = Object.assign(new Error("duplicate key"), {
    code: "23505",
    constraint: "users_username_lower_uq",
  });
  assert.equal(uniqueViolation(pgError), "users_username_lower_uq");
  assert.equal(
    uniqueViolation(Object.assign(new Error("Failed query"), { cause: pgError })),
    "users_username_lower_uq"
  );
});

test("anything that is not a unique violation reads as none", () => {
  assert.equal(uniqueViolation(new Error("boom")), undefined);
  assert.equal(uniqueViolation(undefined), undefined);
  assert.equal(
    uniqueViolation(Object.assign(new Error("no such table"), { code: "42P01" })),
    undefined
  );
  // A 23505 with no constraint name cannot be routed, and must not be guessed.
  assert.equal(uniqueViolation(Object.assign(new Error("dup"), { code: "23505" })), undefined);
});
