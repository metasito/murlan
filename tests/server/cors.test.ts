// tests/server/cors.test.ts — the allowlist trusted any http://localhost:* origin
// with credentials, in production too, so anything a user ran locally could
// drive their live session. The dev loop needs it; production must not have it.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isAllowedOrigin, trustProxySetting } from "../../server/cors.ts";

// @types/node declares NODE_ENV readonly, so it needs the index signature.
function setNodeEnv(value: string | undefined): void {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = value;
}

const saved = {
  NODE_ENV: process.env.NODE_ENV,
  PUBLIC_HOST: process.env.PUBLIC_HOST,
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
};

function restore(): void {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("isAllowedOrigin", () => {
  beforeEach(() => {
    process.env.PUBLIC_HOST = "murlan.example.app";
    delete process.env.ALLOWED_ORIGINS;
  });

  afterEach(restore);

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

  test("ALLOWED_ORIGINS adds full origins beside PUBLIC_HOST", () => {
    setNodeEnv("production");
    process.env.ALLOWED_ORIGINS = "https://a.example.com, http://b.example.com:8080";
    assert.equal(isAllowedOrigin("https://a.example.com"), true);
    assert.equal(isAllowedOrigin("http://b.example.com:8080"), true);
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

describe("trustProxySetting", () => {
  afterEach(restore);

  test("trusts the manifest's proxy hops in production", () => {
    const { proxyHops } = JSON.parse(
      readFileSync(path.resolve(import.meta.dirname, "..", "..", "deploy", "runtime.json"), "utf8")
    );
    setNodeEnv("production");
    assert.equal(trustProxySetting(), proxyHops);
  });

  test("trusts no proxy in development", () => {
    setNodeEnv("development");
    assert.equal(trustProxySetting(), false);
  });
});
