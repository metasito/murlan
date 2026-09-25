import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkBootEnv } from "../../server/http/bootEnv.ts";
import { DEADLINE_SCALE } from "../helpers/client.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

test("no connection sets its own TLS; the URL's sslmode decides", () => {
  for (const file of ["store/db.ts", "socket/socketAdapter.ts", "game/gameOwnership.ts"]) {
    const src = readFileSync(path.join(repoRoot, "server", file), "utf8");
    assert.doesNotMatch(src, /\bssl\s*:/, `server/${file} sets ssl`);
  }
});

describe("checkBootEnv", () => {
  const base = { SESSION_SECRET: "s", DATABASE_URL: "postgres://u:p@db/x?sslmode=require" };
  const production = { ...base, NODE_ENV: "production", PUBLIC_HOST: "murlan.example.app" };

  test("a complete production environment boots", () => {
    assert.doesNotThrow(() => checkBootEnv(production));
  });

  test("production refuses a DATABASE_URL with no sslmode", () => {
    assert.throws(
      () => checkBootEnv({ ...production, DATABASE_URL: "postgres://u:p@db/x" }),
      /sslmode/
    );
  });

  test("sslmode=disable is an explicit choice, and allowed", () => {
    assert.doesNotThrow(() =>
      checkBootEnv({ ...production, DATABASE_URL: "postgres://u:p@db/x?sslmode=disable" })
    );
  });

  test("production refuses a missing PUBLIC_HOST", () => {
    assert.throws(() => checkBootEnv({ ...production, PUBLIC_HOST: undefined }), /PUBLIC_HOST/);
  });

  test("development needs neither sslmode nor PUBLIC_HOST", () => {
    assert.doesNotThrow(() =>
      checkBootEnv({ ...base, NODE_ENV: "development", DATABASE_URL: "postgres://u:p@db/x" })
    );
  });

  test("the secrets are required everywhere, PORT nowhere", () => {
    assert.throws(() => checkBootEnv({ ...base, SESSION_SECRET: undefined }), /SESSION_SECRET/);
    assert.throws(() => checkBootEnv({ ...base, DATABASE_URL: undefined }), /DATABASE_URL/);
    assert.doesNotThrow(() => checkBootEnv({ ...base, PORT: undefined }));
  });

  test("the real entry exits non-zero without SESSION_SECRET, before serving", () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "development",
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:1/unreachable",
      PORT: "0",
    };
    delete env.SESSION_SECRET;
    const run = spawnSync(process.execPath, [path.join(repoRoot, "server", "index.ts")], {
      env,
      encoding: "utf8",
      timeout: 20_000 * DEADLINE_SCALE,
    });
    assert.equal(run.signal, null, `server/index.ts was still running at the deadline:\n${run.stderr}`);
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /Missing required secret: SESSION_SECRET/);
  });
});
