// tests/server/verificationEmailBody.test.ts — #894 review, finding 2: registration
// is neutral by design (#897), so a verification mail can now land in a
// mailbox that never asked to create an account (a stranger registered with
// someone else's address). The mail must name the account it verifies, so
// the real owner of the address can tell a stranger's pending signup apart
// from their own — redeeming the wrong one loses their own email claim
// (server/store/userStore.ts's markEmailVerified).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mailLocale, passwordResetEmailBody, verificationEmailBody } from "../../server/http/routes.ts";

const TOKEN_LINE = /:\n\n(\S+)\n\n/;

for (const [locale, verifyText, resetText] of [
  ["en", /your verification code is/, /password reset code is/],
  ["it", /il tuo codice di verifica è/, /reimpostare la password/],
  ["sq", /kodi yt i verifikimit është/, /rivendosur fjalëkalimin/],
] as const) {
  test(`writes both mails in ${locale}, the code alone on its line`, () => {
    const verify = verificationEmailBody("mallory1", "123456", locale);
    assert.match(verify, verifyText);
    assert.match(verify, /@mallory1/);
    assert.equal(verify.match(TOKEN_LINE)?.[1], "123456");
    assert.match(verify, /\b15\b/);
    const reset = passwordResetEmailBody("abc123", locale);
    assert.match(reset, resetText);
    assert.equal(reset.match(TOKEN_LINE)?.[1], "abc123");
    assert.match(reset, /\b30\b/);
  });
}

test("an unknown or missing locale falls back to English", () => {
  for (const value of ["fr", "", undefined, 42, null]) assert.equal(mailLocale(value), "en");
  assert.equal(mailLocale("sq"), "sq");
  assert.equal(
    verificationEmailBody("mallory1", "123456", mailLocale("fr")),
    verificationEmailBody("mallory1", "123456", "en")
  );
});

test("names the account the code belongs to", () => {
  const body = verificationEmailBody("mallory1", "123456", "en");
  assert.match(body, /@mallory1/, "the mail must name the account, not just say 'a code'");
});

test("carries the token", () => {
  const body = verificationEmailBody("mallory1", "123456", "en");
  assert.ok(body.includes("123456"), "the token must still be in the body");
});

test("tells an unintended reader what to do — nothing", () => {
  const body = verificationEmailBody("mallory1", "123456", "en");
  assert.match(body, /if it was not you/i);
});

test("two different registrations render two distinguishable mails", () => {
  const victimsOwn = verificationEmailBody("realvictim", "111111", "en");
  const strangers = verificationEmailBody("mallory1", "222222", "en");
  assert.notEqual(victimsOwn, strangers);
  assert.match(victimsOwn, /@realvictim/);
  assert.match(strangers, /@mallory1/);
});
