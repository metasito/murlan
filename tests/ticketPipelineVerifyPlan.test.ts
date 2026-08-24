// tests/ticketPipelineVerifyPlan.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { pickVerifyChecks } from "../lib/ticketPipeline/verifyPlan.ts";

describe("picking verify checks by files touched", () => {
  test("pure lib/ logic gets the node --test loop only", () => {
    const checks = pickVerifyChecks(["lib/gameEngine.ts", "lib/rating.ts"]);
    assert.deepEqual(checks, [`node --test "tests/**/*.test.ts"`]);
  });

  test("a native component gets jest added", () => {
    const checks = pickVerifyChecks(["components/GameTable.tsx"]);
    assert.ok(checks.includes("npx jest components tests"));
  });

  test("anything under app/ or with layout in the name gets Playwright added", () => {
    const checks = pickVerifyChecks(["app/index.tsx"]);
    assert.ok(checks.some((c) => c.includes("playwright")));
  });

  test("locale files get the i18n test added", () => {
    const checks = pickVerifyChecks(["locales/it.ts"]);
    assert.ok(checks.some((c) => c.includes("i18n.test.ts")));
  });

  test("touching lib/theme.ts adds the token/contrast floors", () => {
    const checks = pickVerifyChecks(["lib/theme.ts"]);
    assert.ok(checks.some((c) => c.includes("tokenRoles.test.ts")));
  });

  test("checks never duplicate across overlapping file categories", () => {
    const checks = pickVerifyChecks(["lib/gameEngine.ts", "lib/rating.ts", "lib/theme.ts"]);
    assert.equal(checks.length, new Set(checks).size);
  });

  test("an unrecognized file still gets the baseline node --test loop", () => {
    const checks = pickVerifyChecks(["README.md"]);
    assert.ok(checks.includes(`node --test "tests/**/*.test.ts"`));
  });
});
