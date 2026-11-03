// tests/server/storeInfo.test.ts — what the key-value store's INFO reports, served on /metrics, and a
// store unlike deploy/runtime.json's named at once without stopping the server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "@prometheus-io/client";
import runtime from "../../deploy/runtime.json" with { type: "json" };
import { checkStore, parseInfo } from "../../server/store/storeInfo.ts";
import { noteStoreInfo } from "../../server/shared/metrics.ts";
import { logger } from "../../server/shared/logger.ts";

const info = ({ engine = "server_name:valkey\r\nvalkey_version:9.1.3", policy = "noeviction" } = {}) =>
  [
    "# Server",
    "redis_version:7.2.4",
    engine,
    "",
    "# Clients",
    "blocked_clients:2",
    "# Memory",
    "used_memory:1048576",
    "maxmemory:268435456",
    `maxmemory_policy:${policy}`,
    "# Stats",
    "rejected_connections:3",
    "evicted_keys:4",
    "",
  ].join("\r\n");

async function value(name: string, labels: Record<string, string> = {}): Promise<number | undefined> {
  const metric = (await register.getMetricsAsJSON()).find((m) => m.name === name);
  return (metric?.values as { value: number; labels: Record<string, string> }[] | undefined)?.find((v) =>
    Object.entries(labels).every(([k, l]) => v.labels[k] === l)
  )?.value;
}

test("the manifest names the store this server is built for", () => {
  assert.deepEqual(runtime.keyValue, { engine: "valkey", major: 9, maxmemoryPolicy: "noeviction" });
});

test("INFO's fields are read across its sections, and its headings and blank lines skipped", () => {
  const parsed = parseInfo(info());
  assert.equal(parsed.server_name, "valkey");
  assert.equal(parsed.maxmemory_policy, "noeviction");
  assert.equal(parsed.evicted_keys, "4");
  assert.equal(Object.keys(parsed).some((k) => k.startsWith("#") || k === ""), false);
});

test("/metrics serves the store's memory, evictions, clients, engine and version from its last INFO", async () => {
  noteStoreInfo(parseInfo(info()));
  assert.equal(await value("store_used_memory_bytes"), 1048576);
  assert.equal(await value("store_maxmemory_bytes"), 268435456);
  assert.equal(await value("store_evicted_keys"), 4);
  assert.equal(await value("store_blocked_clients"), 2);
  assert.equal(await value("store_rejected_connections"), 3);
  assert.equal(await value("store_info", { engine: "valkey", version: "9.1.3", maxmemory_policy: "noeviction" }), 1);
  noteStoreInfo(null);
  assert.ok(Number.isNaN(await value("store_used_memory_bytes")), "a store no longer answering is still reported");
  assert.equal(await value("store_info", { engine: "valkey" }), undefined, "a store no longer answering still names its engine");
});

for (const [why, reply, reason] of [
  ["an evicting policy", info({ policy: "allkeys-lru" }), "maxmemory_policy"],
  ["another engine", info({ engine: "" }), "engine"],
  ["an older Valkey", info({ engine: "server_name:valkey\r\nvalkey_version:8.1.4" }), "major"],
] as const) {
  test(`a store with ${why} logs an error and counts it, and throws nothing`, async (t) => {
    const before = (await value("store_misconfigured_total", { reason })) ?? 0;
    const errors = t.mock.method(logger, "error", () => undefined);
    assert.doesNotThrow(() => checkStore(parseInfo(reply)));
    assert.equal(errors.mock.callCount(), 1);
    assert.equal(await value("store_misconfigured_total", { reason }), before + 1);
  });
}

test("the store the manifest names passes with nothing logged or counted", async (t) => {
  const before = await register.getSingleMetricAsString("store_misconfigured_total");
  const errors = t.mock.method(logger, "error", () => undefined);
  checkStore(parseInfo(info()));
  assert.equal(errors.mock.callCount(), 0);
  assert.equal(await register.getSingleMetricAsString("store_misconfigured_total"), before);
});
