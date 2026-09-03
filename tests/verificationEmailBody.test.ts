// tests/verificationEmailBody.test.ts — #894 review, finding 2: registration
// is neutral by design (#897), so a verification mail can now land in a
// mailbox that never asked to create an account (a stranger registered with
// someone else's address). The mail must name the account it verifies, so
// the real owner of the address can tell a stranger's pending signup apart
// from their own — redeeming the wrong one loses their own email claim
// (server/storage.ts's markEmailVerified).
import { test } from "node:test";
import assert from "node:assert/strict";
import { verificationEmailBody } from "../server/routes.ts";

test("names the account the code belongs to", () => {
  const body = verificationEmailBody("mallory1", "123456");
  assert.match(body, /@mallory1/, "the mail must name the account, not just say 'a code'");
});

test("carries the token", () => {
  const body = verificationEmailBody("mallory1", "123456");
  assert.ok(body.includes("123456"), "the token must still be in the body");
});

test("tells an unintended reader what to do — nothing", () => {
  const body = verificationEmailBody("mallory1", "123456");
  assert.match(body, /if it was not you/i);
});

test("two different registrations render two distinguishable mails", () => {
  const victimsOwn = verificationEmailBody("realvictim", "111111");
  const strangers = verificationEmailBody("mallory1", "222222");
  assert.notEqual(victimsOwn, strangers);
  assert.match(victimsOwn, /@realvictim/);
  assert.match(strangers, /@mallory1/);
});
