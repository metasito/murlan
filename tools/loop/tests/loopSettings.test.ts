import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const settings = JSON.parse(readFileSync(new URL("../loop-settings.json", import.meta.url), "utf8"));

describe("loop-settings.json carries what a session no longer inherits from the owner", () => {
  test("every auto-mode list extends the shipped defaults rather than replacing them", () => {
    for (const key of ["environment", "allow", "soft_deny"]) {
      assert.ok(settings.autoMode?.[key]?.includes("$defaults"), `autoMode.${key} drops the shipped defaults`);
    }
  });

  test("the classifier is told the repo is public", () => {
    assert.ok(settings.autoMode.environment.some((e: string) => /public/i.test(e) && e.includes("metasito/murlan")));
    assert.ok(!settings.autoMode.environment.some((e: string) => /private/i.test(e)));
  });

  test("rule 6's plant-and-revert is allowed", () => {
    assert.ok(settings.autoMode.allow.some((r: string) => /plant a defect/.test(r) && /rule 6/.test(r)));
  });

  test("resetting the database still asks", () => {
    assert.ok(settings.autoMode.soft_deny.some((r: string) => r.includes("npm run db:reset")));
  });

  test("a session at the usage limit continues once it resets", () => {
    assert.equal(settings.autoContinueAtUsageLimit, true);
  });

  // The CLI clamps bashOutputMaxChars to 4000-128000 and defaults it to 30000 (2.1.296).
  test("a Bash call's inline output is capped below the CLI's default, above guard-read's old 150-line bound", () => {
    assert.ok(settings.bashOutputMaxChars >= 8000 && settings.bashOutputMaxChars < 30000, String(settings.bashOutputMaxChars));
  });

  test("the output style the cost baseline was measured under, which came from the checkout's local settings", () => {
    assert.equal(settings.outputStyle, "Concise");
    assert.equal(settings.disableClaudeAiConnectors, true);
  });
});
