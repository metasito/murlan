// tests/usernameRule.test.ts — registration and a rename accept exactly the
// same names, and the screen can say which rule a name broke.
//
// #399's own definition of done asks that rename validation be "the same code
// registration uses, not a second copy". The server already does that —
// `RenameSchema` references `RegisterSchema.shape.username`. The client could
// not, because the rule lived in a zod schema behind `server/`, and the only
// thing it can read back from a rejected request is `INVALID_PAYLOAD`, which
// `validate` returns for a name that is too short *and* for one with a slash in
// it. Naming the two apart to the player meant either a second copy of the rule
// or one rule both sides read; this pins that it is the second.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  USERNAME_MIN,
  USERNAME_MAX,
  USERNAME_PATTERN,
  usernameProblem,
} from "../shared/username.ts";
import { RegisterSchema } from "../server/schemas.ts";

/** Names that must be accepted, and names that must not, with why. */
const CASES: [string, ReturnType<typeof usernameProblem>][] = [
  ["ana", null],
  ["Ana_Besi_99", null],
  ["a".repeat(USERNAME_MAX), null],
  ["ab", "tooShort"],
  ["", "tooShort"],
  ["a".repeat(USERNAME_MAX + 1), "tooLong"],
  ["ana besi", "invalidChars"],
  ["ana-besi", "invalidChars"],
  ["anà", "invalidChars"],
  ["ana/../etc", "invalidChars"],
];

describe("one username rule, read by both sides", () => {
  test("names the rule a name broke, or none", () => {
    for (const [name, expected] of CASES) {
      assert.equal(usernameProblem(name), expected, `usernameProblem(${JSON.stringify(name)})`);
    }
  });

  // The floor. Two rules that agree today drift the moment one is edited, and
  // nothing else in the tree compares them — the server test suite only ever
  // asks the server, and a screen test only ever asks the client.
  test("agrees with the schema registration validates against, name for name", () => {
    for (const [name] of CASES) {
      const accepted = RegisterSchema.shape.username.safeParse(name).success;
      assert.equal(
        accepted,
        usernameProblem(name) === null,
        `${JSON.stringify(name)}: schema says ${accepted}, the shared rule disagrees`
      );
    }
  });

  test("the schema is built from the shared rule rather than restating it", () => {
    // A copy that happens to hold the same numbers passes both tests above, so
    // this reads the constants back out of the file that would hold a copy.
    const source = readSchemaSource();
    assert.match(
      source,
      /from "\.\.\/shared\/username\.ts"/,
      "server/schemas.ts no longer reads the shared rule"
    );
    // Every bound on a username field, anywhere in the file — a copy in
    // `LoginSchema` drifts from `RegisterSchema` just as quietly as one inside
    // it, and that is how this test found one. The chain is read from
    // `z.string()` to the end of its own calls, so the `password` beneath it is
    // not swept in.
    for (const [, chain] of source.matchAll(
      /username:\s*z\.string\(\)((?:\s*\.\w+\([^)]*\))*)/g
    )) {
      for (const [, bound] of chain.matchAll(/\.(?:min|max)\((\d+)\)/g)) {
        assert.equal(
          bound,
          "1",
          `server/schemas.ts bounds a username with a literal ${bound} beside the shared rule`
        );
      }
    }
  });

  test("the pattern is anchored, so a valid prefix cannot carry anything after it", () => {
    assert.ok(USERNAME_PATTERN.source.startsWith("^"));
    assert.ok(USERNAME_PATTERN.source.endsWith("$"));
    // `.test` on a global regex carries `lastIndex` and answers differently
    // every other call, which is exactly the shape a shared regex invites.
    assert.ok(!USERNAME_PATTERN.global);
    assert.equal(usernameProblem("ana\nbesi"), "invalidChars");
  });

  test("the bounds are a range, not two numbers that happen to be ordered", () => {
    assert.ok(USERNAME_MIN >= 1);
    assert.ok(USERNAME_MAX > USERNAME_MIN);
  });
});

function readSchemaSource(): string {
  return readFileSync(new URL("../server/schemas.ts", import.meta.url), "utf8");
}
