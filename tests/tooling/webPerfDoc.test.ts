import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const doc = readFileSync(path.join(repoRoot, "docs/WEB-PERF.md"), "utf8");
const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};

test("docs/WEB-PERF.md names the Expo SDK package.json is on", () => {
  const major = Number(pkg.dependencies.expo.match(/\d+/)?.[0]);
  assert.ok(major > 0, `no expo version in package.json: ${pkg.dependencies.expo}`);

  const stated = doc.match(/on \*\*Expo SDK (\d+)\*\*/)?.[1];
  assert.ok(stated, "docs/WEB-PERF.md no longer says which Expo SDK the app is on");
  assert.equal(Number(stated), major, "docs/WEB-PERF.md names a different Expo SDK than package.json");

  const mentioned = [...doc.matchAll(/SDK (\d+)/g)].map((m) => Number(m[1]));
  assert.deepEqual(
    mentioned.filter((n) => n !== major),
    [],
    "docs/WEB-PERF.md mentions an Expo SDK the app is not on"
  );
});
