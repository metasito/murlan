// tests/loopProtectedPaths.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PROTECTED } from "../scripts/loop-gate.mjs";

/**
 * The list an agent reads and the list a program enforces are two lists the moment nothing
 * compares them. They had already drifted: `server/schemaDdl.ts` was the justification quoted in
 * the gate's own docstring and in CLAUDE.md, and was in neither list — a second `CREATE TABLE`
 * could have landed autonomously with every check green.
 */
describe("the protected paths CLAUDE.md states and the gate enforces", () => {
  const claude = readFileSync("CLAUDE.md", "utf8");
  // Stops at the auth clause: that one is a rule about content, not a path, and the gate decides
  // it on the changed lines rather than by name.
  const para = /Never autonomously change ([\s\S]*?), or anything under/.exec(claude);

  test("CLAUDE.md still states the rule this pins", () => {
    assert.ok(para, "the 'Never autonomously change ... or anything under' rule left CLAUDE.md");
  });

  test("the two lists are the same list", () => {
    const stated = [...(para?.[1] ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    assert.deepEqual([...stated].sort(), [...PROTECTED].sort());
  });

  test("the list is not empty, so this is not comparing nothing to nothing", () => {
    assert.ok(PROTECTED.length >= 7, `only ${PROTECTED.length} protected paths`);
  });
});
