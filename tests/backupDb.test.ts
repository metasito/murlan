// tests/backupDb.test.ts — the backup script refuses loudly rather than quietly,
// pruning never empties the directory, and a dump actually restores.
//
// docs/DEPLOY-RUNBOOK.md tells an operator to trust this file before a
// destructive db:push, so the failure that matters is the silent one: exiting 0
// having written nothing, or writing to a database that was never reachable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import pg from "pg";
import { hasDatabase, skipMessage, startTestServer } from "./helpers/testServer.ts";
import { DUMP_NAME, dumpName } from "../scripts/backupNaming.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repoRoot, "scripts", "backup-db.mjs");
const pruneScript = path.join(repoRoot, "scripts", "prune-backups.mjs");

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

// scripts/prune-backups.mjs — retention, exercised against a scratch directory
// full of empty files named the way scripts/backup-db.mjs names real dumps.
// Age comes from the filename, not the filesystem, so these need no clock
// tricks: a fake "30 days ago" name is exactly as old as a real one.
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}
function runPrune(dir: string, env: Record<string, string | undefined> = {}) {
  return spawnSync(process.execPath, [pruneScript, dir], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

test("prune deletes dumps past the retention window and keeps the rest", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "murlan-prune-"));
  try {
    const old = dumpName(daysAgo(30));
    const withinWindow = dumpName(daysAgo(3));
    const newest = dumpName(daysAgo(0));
    for (const name of [old, withinWindow, newest]) {
      writeFileSync(path.join(dir, name), "not a real dump, just a name to prune by");
    }

    const { status } = runPrune(dir, { BACKUP_RETENTION_DAYS: "7" });
    assert.equal(status, 0);

    const remaining = readdirSync(dir).sort();
    assert.deepEqual(remaining, [withinWindow, newest].sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The floor named in #39.
test("prune never deletes the most recent dump, however old it is", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "murlan-prune-"));
  try {
    const names = [1000, 999, 998].map((n) => dumpName(daysAgo(n)));
    for (const name of names) writeFileSync(path.join(dir, name), "x");
    const mostRecent = [...names].sort().at(-1)!;

    const { status } = runPrune(dir, { BACKUP_RETENTION_DAYS: "1" });
    assert.equal(status, 0);

    const remaining = readdirSync(dir);
    assert.deepEqual(
      remaining,
      [mostRecent],
      "every dump was past the retention window, but the most recent one must survive"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prune is a no-op, not a failure, against a directory that does not exist yet", () => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "murlan-prune-")), "never-created");
  const { status } = runPrune(dir);
  assert.equal(status, 0);
});

test("prune refuses a nonsensical retention window rather than silently pruning nothing or everything", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "murlan-prune-"));
  try {
    writeFileSync(path.join(dir, dumpName(new Date())), "x");
    const { status, stderr } = runPrune(dir, { BACKUP_RETENTION_DAYS: "not-a-number" });
    assert.notEqual(status, 0);
    assert.match(stderr, /BACKUP_RETENTION_DAYS/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// docs/DEPLOY-RUNBOOK.md's scheduled run command sets no BACKUP_RETENTION_DAYS,
// so the default is the retention production actually gets. A default with no
// test on it can drift to a value that never deletes anything (e.g. beyond
// any real dump's age) and stay green.
test("prune's default retention (BACKUP_RETENTION_DAYS unset) deletes past 14 days and keeps within it", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "murlan-prune-"));
  try {
    const old = dumpName(daysAgo(20));
    const withinWindow = dumpName(daysAgo(5));
    const newest = dumpName(daysAgo(0));
    for (const name of [old, withinWindow, newest]) {
      writeFileSync(path.join(dir, name), "x");
    }

    const { BACKUP_RETENTION_DAYS: _unused, ...envWithoutRetention } = process.env;
    const { status } = spawnSync(process.execPath, [pruneScript, dir], {
      env: envWithoutRetention,
      encoding: "utf8",
    });
    assert.equal(status, 0);

    const remaining = readdirSync(dir).sort();
    assert.deepEqual(remaining, [withinWindow, newest].sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// #39. Needs a real Postgres plus pg_dump/psql on PATH — both required by
// the script itself, so their absence here would mean the environment could
// never take or restore a real backup either.
test("a dump restores into an empty database with matching account and rating row counts", async (t) => {
  if (!hasDatabase()) {
    t.skip(skipMessage());
    return;
  }

  const baseUrl = process.env.DATABASE_URL!;
  const server = await startTestServer();
  const admin = new pg.Pool({ connectionString: baseUrl });
  const dumpDir = mkdtempSync(path.join(tmpdir(), "murlan-dump-"));
  let restoreDb: string | null = null;

  try {
    for (const username of ["restore_user_a", "restore_user_b"]) {
      const res = await fetch(`${server.url}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: `${username}_${Date.now()}`, password: "password123" }),
      });
      assert.equal(res.status, 200, await res.text());
    }
    await admin.query(
      `INSERT INTO "${server.schema}".user_ratings (user_id, season, rating)
       SELECT id, 'test-season', 1200 FROM "${server.schema}".users`
    );
    // connect-pg-simple's own table (server/session.ts) — the reason
    // backup-db.mjs dumps the whole database instead of a schema-driven table
    // list. A restore proof that never looks at it would stay green against a
    // dump that silently excludes it. The two registrations above already
    // seeded it via express-session's own writes; this row is on top of
    // those, so the count asserted below is whatever that total is, not a
    // literal this test invents.
    await admin.query(
      `INSERT INTO "${server.schema}".session (sid, sess, expire)
       VALUES ('backup-test-sid', '{}', now() + interval '1 day')`
    );

    const before = {
      users: (await admin.query(`SELECT count(*)::int AS n FROM "${server.schema}".users`)).rows[0]
        .n,
      ratings: (
        await admin.query(`SELECT count(*)::int AS n FROM "${server.schema}".user_ratings`)
      ).rows[0].n,
      sessions: (
        await admin.query(`SELECT count(*)::int AS n FROM "${server.schema}".session`)
      ).rows[0].n,
    };
    assert.equal(before.users, 2);
    assert.equal(before.ratings, 2);
    assert.ok(before.sessions >= 1, "the session row this test inserted must be present");

    // No explicit outfile: this is what proves the pruner's DUMP_NAME regex
    // actually matches what backup-db.mjs writes by default, not just what
    // this test's own fixtures are named.
    const dump = spawnSync(process.execPath, [script], {
      env: { ...process.env, DATABASE_URL: baseUrl },
      encoding: "utf8",
      cwd: dumpDir,
    });
    // The child here is node running backup-db.mjs, which itself spawns
    // pg_dump — so a missing pg_dump surfaces as backup-db.mjs's own exit 1
    // and stderr message, not as this spawnSync's own `.error`.
    if (dump.status !== 0 && /pg_dump is not on PATH/.test(dump.stderr ?? "")) {
      t.skip("pg_dump not on PATH — cannot prove restore in this environment");
      return;
    }
    assert.equal(dump.status, 0, dump.stderr);

    const written = readdirSync(path.join(dumpDir, "backups"));
    assert.equal(written.length, 1, "backup-db.mjs must write exactly one dump per run");
    assert.match(
      written[0],
      DUMP_NAME,
      "backup-db.mjs's default filename must match what prune-backups.mjs recognizes"
    );
    const dumpFile = path.join(dumpDir, "backups", written[0]);

    const maintenanceUrl = new URL(baseUrl);
    maintenanceUrl.pathname = "/postgres";
    const maintenance = new pg.Pool({ connectionString: maintenanceUrl.toString() });
    restoreDb = `murlan_restore_test_${Date.now()}`;
    try {
      await maintenance.query(`CREATE DATABASE "${restoreDb}"`);
    } finally {
      await maintenance.end();
    }

    const restoreUrl = new URL(baseUrl);
    restoreUrl.pathname = `/${restoreDb}`;
    const restore = spawnSync("psql", [restoreUrl.toString(), "-v", "ON_ERROR_STOP=1", "-f", dumpFile], {
      encoding: "utf8",
    });
    if ((restore.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      t.skip("psql not on PATH — cannot prove restore in this environment");
      return;
    }
    assert.equal(restore.status, 0, restore.stderr);

    const restored = new pg.Pool({ connectionString: restoreUrl.toString() });
    try {
      const after = {
        users: (
          await restored.query(`SELECT count(*)::int AS n FROM "${server.schema}".users`)
        ).rows[0].n,
        ratings: (
          await restored.query(`SELECT count(*)::int AS n FROM "${server.schema}".user_ratings`)
        ).rows[0].n,
        sessions: (
          await restored.query(`SELECT count(*)::int AS n FROM "${server.schema}".session`)
        ).rows[0].n,
      };
      assert.deepEqual(after, before, "restored row counts must match the source exactly");
    } finally {
      await restored.end();
    }
  } finally {
    if (restoreDb) {
      const maintenanceUrl = new URL(baseUrl);
      maintenanceUrl.pathname = "/postgres";
      const cleanup = new pg.Pool({ connectionString: maintenanceUrl.toString() });
      await cleanup
        .query(`DROP DATABASE IF EXISTS "${restoreDb}" WITH (FORCE)`)
        .catch(() => {});
      await cleanup.end();
    }
    rmSync(dumpDir, { recursive: true, force: true });
    await admin.end();
    await server.stop();
  }
});
