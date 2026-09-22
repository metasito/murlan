// tests/tooling/shellClaims.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("no document claims Windows PowerShell 5.1", () => {
  // docs/adr and docs/plans are dated records, not live instructions — same scope
  // rulesAreSingleSourced.test.ts's INSTRUCTION_FILES draws.
  const hits = execSync(
    'git grep -n -i -E "powershell 5\\.1|ps 5\\.1" -- "*.md" ":!docs/adr" ":!docs/plans" || true',
    { cwd: root, encoding: "utf8" },
  ).trim();
  assert.equal(hits, "", `the shell is pwsh 7:\n${hits}`);
});
