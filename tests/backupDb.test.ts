// tests/backupDb.test.ts — the backup script refuses loudly rather than quietly.
//
// docs/DEPLOY-RUNBOOK.md tells an operator to trust this file before a
// destructive db:push, so the failure that matters is the silent one: exiting 0
// having written nothing, or writing to a database that was never reachable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repoRoot, "scripts", "backup-db.mjs");

function run(env: Record<string, string | undefined>) {
  const { DATABASE_URL, ...rest } = process.env;
  return spawnSync(process.execPath, [script], {
    env: { ...rest, ...env },
    encoding: "utf8",
    cwd: repoRoot,
  });
}

test("refuses without DATABASE_URL, non-zero and by name", () => {
  const { status, stderr } = run({});
  assert.equal(status, 1, "a backup script that exits 0 with no database is the failure mode");
  assert.match(stderr, /DATABASE_URL/);
  assert.match(stderr, /Nothing was written/);
});

// The floor: without this, the assertion above is equally satisfied by a script
// that refuses unconditionally and can never take a backup at all.
test("that refusal is conditional on DATABASE_URL being absent", () => {
  const { stderr } = run({
    DATABASE_URL: "postgresql://nobody@127.0.0.1:1/nowhere",
    PGCONNECT_TIMEOUT: "2",
  });
  assert.doesNotMatch(
    stderr,
    /DATABASE_URL is not set/,
    "the guard fired with DATABASE_URL set, so it is not testing what it claims to"
  );
});
