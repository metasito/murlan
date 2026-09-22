import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afkTimeoutMs } from "../../server/game/gameTimers.ts";
import { sendMail } from "../../server/http/mail.ts";
import { maxFrom } from "../../server/http/rateLimit.ts";
import { testOnlyEnv } from "../../server/http/testOnlyEnv.ts";
import { logger } from "../../server/http/logger.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const saved = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

describe("a test-only MURLAN_* override in production", () => {
  test("is ignored by the timers and the rate limits", () => {
    process.env.NODE_ENV = "production";
    process.env.MURLAN_AFK_TIMEOUT_MS = "5";
    process.env.MURLAN_AUTH_RATE_LIMIT = "100000";
    assert.equal(afkTimeoutMs(), 30_000);
    assert.equal(maxFrom("MURLAN_AUTH_RATE_LIMIT", 100), 100);
  });

  test("still applies outside production", () => {
    process.env.NODE_ENV = "test";
    process.env.MURLAN_AFK_TIMEOUT_MS = "5";
    assert.equal(afkTimeoutMs(), 5);
  });

  test("never writes the mail sink", async (t) => {
    const sink = path.join(await mkdtemp(path.join(tmpdir(), "murlan-sink-")), "sink.jsonl");
    process.env.NODE_ENV = "production";
    process.env.MURLAN_MAIL_SINK = sink;
    process.env.RESEND_API_KEY = "key";
    process.env.MAIL_FROM_ADDRESS = "from@example.com";
    t.mock.method(globalThis, "fetch", async () => new Response("{}"));
    await sendMail("a@example.com", "subject", "token", "user-1");
    await assert.rejects(readFile(sink), { code: "ENOENT" });
  });

  test("is reported once per name", (t) => {
    process.env.NODE_ENV = "production";
    process.env.MURLAN_ONCE_PROBE = "1";
    const warn = t.mock.method(logger, "warn");
    assert.equal(testOnlyEnv("MURLAN_ONCE_PROBE"), undefined);
    assert.equal(testOnlyEnv("MURLAN_ONCE_PROBE"), undefined);
    assert.equal(warn.mock.callCount(), 1);
  });
});

// Production tuning, not a test seam: these are meant to be set on a deployment.
const PRODUCTION_CONFIG = new Set([
  "MURLAN_PG_POOL_MAX",
  "MURLAN_SOCKET_ADAPTER_POOL_MAX",
]);

function serverEnvReads(): { file: string; name: string }[] {
  const dir = path.join(repoRoot, "server");
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .flatMap((file) =>
      [...readFileSync(path.join(dir, file), "utf8").matchAll(/process\.env(?:\.|\[")(MURLAN_\w+)/g)]
        .map((m) => ({ file, name: m[1] }))
    );
}

test("every other MURLAN_* the server reads goes through testOnlyEnv", () => {
  const bare = serverEnvReads()
    .filter(({ name }) => !PRODUCTION_CONFIG.has(name))
    .map(({ file, name }) => `${file}: ${name}`);
  assert.deepEqual(bare, []);
});

test("every production-config exemption is still read by the server", () => {
  const read = new Set(serverEnvReads().map(({ name }) => name));
  assert.deepEqual([...PRODUCTION_CONFIG].filter((name) => !read.has(name)), []);
});
