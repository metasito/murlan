import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolvePoolMax } from "../../server/store/db.ts";
import { DEFAULT_POOL_MAX as SOCKET_ADAPTER_POOL_MAX } from "../../server/socket/socketAdapter.ts";
import { PLATFORM_GRACE_MS } from "../../server/http/shutdown.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const read = (...parts: string[]) => readFileSync(path.join(repoRoot, ...parts), "utf8");
const manifest = JSON.parse(read("deploy", "runtime.json"));

test("the engines floor is the manifest's Node major", () => {
  const floor = JSON.parse(read("package.json")).engines.node;
  assert.match(floor, /^>=\d+$/, "engines.node stays a floor");
  assert.equal(Number(floor.slice(2)), manifest.node);
});

test("CI's build job runs the manifest's Node", () => {
  const ci = read(".github", "workflows", "ci.yml");
  const job = ci.slice(ci.indexOf("\n  build:\n"));
  const version = job.match(/node-version:\s*"?(\d+)"?/);
  assert.ok(version, "the build job sets no node-version");
  assert.equal(Number(version[1]), manifest.node);
});

test(".replit, while it exists, deploys the manifest's majors", () => {
  const modules = read(".replit").match(/^modules\s*=\s*\[([^\]]*)\]/m);
  assert.ok(modules, ".replit has no modules line");
  assert.match(modules[1], new RegExp(`"nodejs-${manifest.node}"`));
  assert.match(modules[1], new RegExp(`"postgresql-${manifest.postgres}"`));
});

test("the shutdown budget is sized to the manifest's SIGTERM grace", () => {
  assert.equal(PLATFORM_GRACE_MS, manifest.sigtermGraceMs);
});

test("one instance's connections fit the manifest's ceiling", () => {
  const ownership = read("server", "game", "gameOwnership.ts");
  assert.equal(ownership.match(/new Client\(/g)?.length, 1, "game ownership holds one Client");
  assert.doesNotMatch(ownership, /new Pool\(/);

  const total = resolvePoolMax(undefined) + SOCKET_ADAPTER_POOL_MAX + 1;
  assert.ok(
    total <= manifest.pgConnectionsPerInstance,
    `the pools hold ${total} connections; the host allows ${manifest.pgConnectionsPerInstance}`
  );
});
