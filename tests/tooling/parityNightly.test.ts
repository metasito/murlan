import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const root = path.resolve(import.meta.dirname, "..", "..");
const workflow = parse(readFileSync(path.join(root, ".github/workflows/parity-nightly.yml"), "utf8"));
const steps: { if?: string; run?: string }[] = Object.values(workflow.jobs as Record<string, { steps: [] }>).flatMap((j) => j.steps);
const scheduled = (outcome: string) => steps.filter((s) => s.if?.includes(`${outcome}()`) && s.if.includes("schedule") && s.run);

// loop-status and the run recap show an open `parity` issue to the owner; one nothing closes never clears.
test("a scheduled green closes the issue a scheduled red opened", () => {
  const [filed] = scheduled("failure");
  const title = /title="([^"]+)"/.exec(filed?.run ?? "")?.[1];
  assert.ok(title, "the failure step names the issue title it files under");
  const [cleared] = scheduled("success");
  assert.ok(cleared, "no step runs on a scheduled success");
  assert.match(cleared.run!, /--label parity --state open/);
  assert.ok(cleared.run!.includes(title), `the success step does not look for "${title}"`);
  assert.match(cleared.run!, /gh issue comment\b[\s\S]*gh issue close\b/);
});
