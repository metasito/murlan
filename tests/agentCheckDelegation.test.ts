// tests/agentCheckDelegation.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STEPS, LOCAL, DELEGATED, cmd } from "../scripts/check-steps.mjs";

type Step = { name: string; args: string[]; where: "local" | "ci"; job?: string };
const steps = STEPS as Step[];
const delegated = DELEGATED as Step[];

const raw = readFileSync(".github/workflows/ci.yml", "utf8");
// Comments stripped first: this workflow explains itself at length, and a command named in a
// comment is not a command anything runs.
const ci = raw.replace(/^\s*#.*$/gm, "");

const runs = (command: string) =>
  new RegExp(`(?:^|\\s)${command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`, "m").test(ci);

describe("a check delegated to CI is a check CI runs", () => {
  for (const step of delegated) {
    test(`ci.yml runs \`${cmd(step)}\``, () => {
      assert.ok(runs(cmd(step)), `${cmd(step)} is delegated to ci.yml but no step there runs it`);
    });

    test(`ci.yml defines the \`${step.job}\` job`, () => {
      assert.ok(
        new RegExp(`^  ${step.job}:$`, "m").test(ci),
        `check-steps.mjs sends ${step.name} to a job "${step.job}" that ci.yml does not define`
      );
    });
  }

  test("every step declares where it runs, and a delegated one names its job", () => {
    for (const s of steps) {
      assert.ok(s.where === "local" || s.where === "ci", `${s.name} has no where`);
      if (s.where === "ci") assert.ok(s.job, `${s.name} is delegated but names no job`);
    }
  });

  // The floor. With both lists free to empty themselves, "everything is delegated" and
  // "nothing is delegated" both pass every assertion above while checking nothing.
  test("both sides of the split are non-empty", () => {
    assert.ok(LOCAL.length > 0, "no step runs before the push");
    assert.ok(delegated.length > 0, "nothing is delegated, so this guard proves nothing");
  });

  test("the match would catch a delegated command CI does not run", () => {
    assert.equal(runs("npm run definitely-not-a-real-script"), false);
    // And it does not accept the command only because a comment mentions it.
    assert.equal(/npm run verify/.test(raw) && runs("npm run verify"), false);
  });
});
