// tests/dbResetGuard.test.ts — the destructive reset must be impossible to
// trigger by accident: typing `npm run db:reset` instead of `db:push` must
// not silently pass the script's own --yes guard and wipe whatever
// DATABASE_URL points at (production, on Replit). These tests pin the guard
// AND the fact that the convenience wrapper does not defeat it.
//
// Every case here exits before the script ever opens a pg connection, so no
// database is required — DATABASE_URL is set to a value that would fail to
// connect precisely so a regression that reaches the query shows up as a
// failure rather than a silent pass.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repoRoot, "scripts", "reset-db.mjs");

/** Runs the script and returns { code, stderr } without throwing. */
function run(env: Record<string, string> = {}, args: string[] = []) {
  // Start from the real environment, then neutralise both gate variables, so
  // a shell that happens to have them set cannot make these cases pass or
  // fail for the wrong reason. They are overwritten rather than deleted
  // because NODE_ENV is non-optional in NodeJS.ProcessEnv.
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "development",
    ALLOW_DESTRUCTIVE: "",
    DATABASE_URL: "postgres://unreachable.invalid:1/none",
    ...env,
  };

  try {
    execFileSync(process.execPath, [script, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnv,
    });
    return { code: 0, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stderr?: string };
    return { code: e.status ?? -1, stderr: e.stderr ?? "" };
  }
}

describe("db reset guard", () => {
  test("refuses without ALLOW_DESTRUCTIVE, even with --yes", () => {
    const { code, stderr } = run({}, ["--yes"]);
    assert.equal(code, 1);
    assert.match(stderr, /ALLOW_DESTRUCTIVE/);
  });

  test("refuses with ALLOW_DESTRUCTIVE but no --yes", () => {
    const { code, stderr } = run({ ALLOW_DESTRUCTIVE: "1" }, []);
    assert.equal(code, 1);
    assert.match(stderr, /--yes/);
  });

  test("refuses under NODE_ENV=production however it is invoked", () => {
    const { code, stderr } = run(
      { NODE_ENV: "production", ALLOW_DESTRUCTIVE: "1" },
      ["--yes"]
    );
    assert.equal(code, 1);
    assert.match(stderr, /production/);
  });

  test("the npm script does not supply the opt-in", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8")
    ) as { scripts: Record<string, string> };
    const dbReset = pkg.scripts["db:reset"];
    assert.ok(dbReset, "db:reset script is missing");
    assert.ok(
      !dbReset.includes("ALLOW_DESTRUCTIVE"),
      "db:reset must not set ALLOW_DESTRUCTIVE — the guard would be pointless"
    );
    assert.ok(
      !dbReset.includes("--yes"),
      "db:reset must not pass --yes — the guard would be pointless"
    );
  });
});
