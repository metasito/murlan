import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles } from "../helpers/trackedFiles.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");

const REDIS_REF = /(?:[\w.-]+\/)*redis:\d[\w.-]*(?:@sha256:[0-9a-f]{64})?/g;
const SERVICE = /\n      redis:\n        image: [^\n]+\n(?:        [^\n]*\n)*?          --health-cmd "redis-cli ping"\n/g;

// A workflow's `services:` image cannot read a variable, so each one repeats dev-stack.mjs's
// REDIS_IMAGE and this holds them to it.
test("every Redis image is dev-stack.mjs's REDIS_IMAGE, pinned, at the manifest's major", () => {
  const image = /^const REDIS_IMAGE = "([^"]+)";$/m.exec(read("scripts/dev-stack.mjs"))?.[1];
  assert.ok(image, "scripts/dev-stack.mjs names no REDIS_IMAGE");
  const refs = trackedFiles(repoRoot, ".github", "scripts").filter((f) => /\.(ya?ml|sh|mjs|js|ts)$/.test(f)).flatMap((file) =>
    [...read(file).matchAll(REDIS_REF)].map(([ref]) => ({ file, ref })),
  );
  const count = (file: string) => refs.filter((r) => r.file === file).length;
  assert.ok(count(".github/workflows/ci.yml") >= 2, "ci.yml: the Redis services of verify and build");
  assert.ok(count(".github/workflows/soak.yml") >= 1, "soak.yml: its Redis service");
  assert.ok(count(".github/workflows/mutation.yml") >= 1, "mutation.yml: its Redis service");
  assert.ok(count("scripts/dev-stack.mjs") >= 1, "dev-stack.mjs: the Redis it runs");
  assert.deepEqual(refs.filter((r) => r.ref !== image).map((r) => `${r.file}: ${r.ref}`), []);
  assert.match(image, /^[^@]+:[\w.-]+@sha256:[0-9a-f]{64}$/, "a mirror's tag can be repointed; the digest is the image that was verified");
  const major = Number(/redis:(\d+)/.exec(image)?.[1]);
  assert.equal(major, JSON.parse(read("deploy/runtime.json")).redis, "deploy/runtime.json's redis major");
});

test("every workflow's Redis service waits for a PING before the job starts", () => {
  for (const [file, services] of [[".github/workflows/ci.yml", 2], [".github/workflows/soak.yml", 1], [".github/workflows/mutation.yml", 1]] as const) {
    const src = read(file);
    assert.equal(src.match(SERVICE)?.length ?? 0, services, `${file}: a Redis service without its health command`);
    assert.match(src, /\n      REDIS_URL: redis:\/\/localhost:6379\/\d+\n/, `${file}: the jobs are not handed REDIS_URL`);
  }
});
