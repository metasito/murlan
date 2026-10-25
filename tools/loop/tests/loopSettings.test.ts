import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

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
    assert.ok(settings.autoMode.soft_deny.some((r: string) => r.includes("scripts/reset-db.mjs")));
  });

  test("every npm script and script file the settings name exists", () => {
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
    const text: string = settings.autoMode.soft_deny.join("\n");
    for (const [, name] of text.matchAll(/npm run ([\w:-]+)/g)) assert.ok(name in scripts, `npm run ${name} does not exist`);
    for (const [, file] of text.matchAll(/\b((?:scripts|tools)\/[\w./-]+\.mjs)/g)) assert.ok(existsSync(file), `${file} does not exist`);
  });

  test("skills-lock.json lists exactly the installed skills", () => {
    const lock = Object.keys(JSON.parse(readFileSync("skills-lock.json", "utf8")).skills).sort();
    const installed = readdirSync(".claude/skills", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    assert.deepEqual(lock, installed);
  });

  test("a session at the usage limit continues once it resets", () => {
    assert.equal(settings.autoContinueAtUsageLimit, true);
  });

  // The CLI clamps bashOutputMaxChars to 4000-128000 and defaults it to 30000 (2.1.296).
  test("a Bash call's inline output is capped below the CLI's default", () => {
    assert.ok(settings.bashOutputMaxChars >= 8000 && settings.bashOutputMaxChars < 30000, String(settings.bashOutputMaxChars));
  });

  test("claude.ai connectors stay off, as the checkout's local settings had them", () => {
    assert.equal(settings.disableClaudeAiConnectors, true);
  });
});
