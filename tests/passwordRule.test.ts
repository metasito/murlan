// The password floor, which three routes share: register, change and reset all
// reuse `RegisterSchema.shape.password`.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ChangePasswordSchema, RegisterSchema, ResetPasswordSchema } from "../server/schemas.ts";

const ok = { username: "player", email: "player@example.com" };

describe("what a password must be", () => {
  // OWASP ASVS 5.0 V6.2.1.
  test("seven characters is refused, eight is accepted", () => {
    assert.equal(RegisterSchema.safeParse({ ...ok, password: "1234567" }).success, false);
    assert.equal(RegisterSchema.safeParse({ ...ok, password: "12345678" }).success, true);
  });

  test("the ceiling still holds", () => {
    assert.equal(RegisterSchema.safeParse({ ...ok, password: "x".repeat(101) }).success, false);
  });

  test("changing and resetting a password answer to the same floor", () => {
    assert.equal(
      ChangePasswordSchema.safeParse({ currentPassword: "1234567", newPassword: "1234567" }).success,
      false
    );
    assert.equal(
      ResetPasswordSchema.safeParse({ token: "t".repeat(32), newPassword: "1234567" }).success,
      false
    );
  });
});
