// tests/server/dbTlsScan.test.ts — the source scan split out of dbTls.test.ts so the mutation run keeps that file's behaviour tests
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

test("no connection sets its own TLS; the URL's sslmode or rediss:// decides", () => {
  for (const file of ["store/db.ts", "store/redis.ts", "game/gameOwnership.ts"]) {
    const src = readFileSync(path.join(repoRoot, "server", file), "utf8");
    assert.doesNotMatch(src, /\b(?:ssl|tls)\s*:/, `server/${file} sets its own TLS`);
  }
});
