// tests/cors.test.ts — the allowlist trusted any http://localhost:* origin
// with credentials, in production too, so anything a user ran locally could
// drive their live session. The dev loop needs it; production must not have it.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore — .ts extension required by Node's type-stripping loader
import { isAllowedOrigin } from "../server/cors.ts";

// @types/node declares NODE_ENV readonly, so it needs the index signature.
function setNodeEnv(value: string | undefined): void {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = value;
}

const saved = {
  NODE_ENV: process.env.NODE_ENV,
  REPLIT_DOMAINS: process.env.REPLIT_DOMAINS,
  REPLIT_DEV_DOMAIN: process.env.REPLIT_DEV_DOMAIN,
};

describe("isAllowedOrigin", () => {
  beforeEach(() => {
    process.env.REPLIT_DOMAINS = "murlan.example.app";
    delete process.env.REPLIT_DEV_DOMAIN;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test("localhost is allowed in development", () => {
    setNodeEnv("development");
    assert.equal(isAllowedOrigin("http://localhost:8081"), true);
    assert.equal(isAllowedOrigin("http://127.0.0.1:5000"), true);
  });

  test("localhost is refused in production", () => {
    setNodeEnv("production");
    assert.equal(isAllowedOrigin("http://localhost:8081"), false);
    assert.equal(isAllowedOrigin("http://127.0.0.1:5000"), false);
  });

  test("the real deployment origin is allowed in production", () => {
    setNodeEnv("production");
    assert.equal(isAllowedOrigin("https://murlan.example.app"), true);
  });

  test("an unrelated origin is refused either way", () => {
    for (const env of ["development", "production"]) {
      setNodeEnv(env);
      assert.equal(isAllowedOrigin("https://evil.example.com"), false);
    }
  });

  test("a missing Origin header stays allowed — native clients send none", () => {
    setNodeEnv("production");
    assert.equal(isAllowedOrigin(undefined), true);
    assert.equal(isAllowedOrigin(null), true);
  });
});
