// tests/renameCopy.test.ts — the four ways a rename can fail read as four
// different sentences.
//
// Copy that distinguishes nothing looks exactly like copy that works: every
// path shows *a* message, every locale has *a* string, and the player is told
// "something went wrong" four times. So the assertion is that the sentences
// differ from each other, in every language, rather than that each exists.
//
// Two of the four come from the server as codes and two are decided on the
// device, because `validate` answers a name that is too short and a name with a
// slash in it with the same `INVALID_PAYLOAD`.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SUPPORTED_LOCALES, catalogs, type Locale } from "../shared/i18n.ts";
import { usernameProblem } from "../shared/username.ts";

/** Every distinct thing a player can be told about a refused rename. */
const FAILURE_KEYS = [
  // Decided on the device, from the shared rule.
  "profile.renameTooShort",
  "profile.renameTooLong",
  "profile.renameInvalidChars",
  // Decided by the server, as codes it already emits.
  "server.USERNAME_TAKEN",
  "server.RENAME_RATE_LIMITED",
  // …and the one for a failure that was not the server answering at all.
  "profile.renameFailed",
] as const;

describe("a refused rename says which refusal it was", () => {
  test("every failure has a sentence in every locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of FAILURE_KEYS) {
        const value = catalogs[locale as Locale][key];
        assert.ok(value, `${locale} is missing ${key}`);
        assert.ok(value.trim().length > 0, `${locale}'s ${key} is blank`);
      }
    }
  });

  test("no two of them are the same sentence, in any locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const seen = new Map<string, string>();
      for (const key of FAILURE_KEYS) {
        const value = catalogs[locale as Locale][key];
        const first = seen.get(value);
        assert.equal(
          first,
          undefined,
          `${locale}: ${key} and ${first} are the same sentence, so the player cannot tell them apart`
        );
        seen.set(value, key);
      }
    }
  });

  // The two length messages are the only ones carrying a number, and a number
  // hardcoded into the copy drifts the moment the rule moves.
  test("the length messages interpolate the bound rather than naming it", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const table = catalogs[locale as Locale];
      assert.match(table["profile.renameTooShort"], /\{\{min\}\}/, locale);
      assert.match(table["profile.renameTooLong"], /\{\{max\}\}/, locale);
      assert.ok(!/\d/.test(table["profile.renameTooShort"]), `${locale} hardcodes the minimum`);
      assert.ok(!/\d/.test(table["profile.renameTooLong"]), `${locale} hardcodes the maximum`);
    }
  });

  // The floor: each device-side message has to be reachable, or it is copy for
  // a state the screen can never show.
  test("each device-side message answers a name that really produces it", () => {
    assert.equal(usernameProblem("ab"), "tooShort");
    assert.equal(usernameProblem("a".repeat(31)), "tooLong");
    assert.equal(usernameProblem("ana besi"), "invalidChars");
  });

  // `tests/native/renameFailureCopy.test.tsx` proves the five sentences differ
  // once a refusal reaches `serverErrorMessage`. Nothing there proves the
  // screen calls it, and no test can drive the control to find out (#523), so
  // the last link is read from source: a `catch` that rendered its own fallback
  // would collapse taken and rate-limited into one sentence with every other
  // test still green.
  test("the rename's catch renders what the server said", () => {
    const source = readFileSync(new URL("../app/(online)/profile.tsx", import.meta.url), "utf8");
    assert.match(
      source,
      /catch[\s\S]{0,120}setError\(serverErrorMessage\(/,
      "profile.tsx no longer routes a refused rename through serverErrorMessage"
    );
  });
});
