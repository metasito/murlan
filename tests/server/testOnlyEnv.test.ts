import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afkTimeoutMs } from "../../server/game/gameTimers.ts";
import { sendMail } from "../../server/http/mail.ts";
import { maxFrom } from "../../server/http/rateLimit.ts";
import { testOnlyEnv } from "../../server/http/testOnlyEnv.ts";
import { logger } from "../../server/shared/logger.ts";

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
