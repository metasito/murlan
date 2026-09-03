// tests/emailNudge.test.ts — the profile-screen add-email card's visibility
// rule (#863). No React involved: app/profile.tsx renders the card straight
// off this predicate, so a bug here is a bug there.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { shouldShowAddEmailCard } from "../lib/emailNudge.ts";

describe("shouldShowAddEmailCard", () => {
  test("present for an account that has never had an email — the beta migration cohort", () => {
    assert.equal(shouldShowAddEmailCard({ email: null }), true);
  });

  // The shape an upgrade actually produces: AuthContext hydrates from an
  // AsyncStorage entry written before `email` existed on AuthUser, so the field
  // is absent rather than null until /api/auth/me answers. Hiding the card
  // there hides it from the only cohort it is for.
  test("present for a cached user written before the field existed", () => {
    assert.equal(shouldShowAddEmailCard({}), true);
  });

  test("absent for an account that already has one, verified", () => {
    assert.equal(shouldShowAddEmailCard({ email: "player@example.test" }), false);
  });
});
