// tests/tooling/workflowScriptPathExists.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

// Nothing else checks a workflow script referenced from inside a fenced Markdown block: no lint,
// no typecheck, no grep a reader would think to run. This tethers audit.md's scriptPath to a real
// file so the two cannot drift apart silently, deriving the path from audit.md's own text.
test("the audit command's scriptPath names a file that actually exists", () => {
  const body = read(".claude/commands/audit.md");
  const match = body.match(/scriptPath:\s*"([^"]+)"/);
  assert.ok(match, "audit.md no longer names a scriptPath — did the invocation shape change?");
  const scriptPath = match![1];
  assert.ok(
    existsSync(path.join(root, scriptPath)),
    `audit.md points Workflow at "${scriptPath}", which does not exist on disk`,
  );
});
