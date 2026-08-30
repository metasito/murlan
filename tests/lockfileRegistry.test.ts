// tests/lockfileRegistry.test.ts — every tarball the lockfile names is one a
// runner outside Replit can actually fetch.
//
// `npm install` run inside Replit resolves through that host's package
// firewall and writes its address into `resolved`. The install still succeeds
// there, so the lockfile looks fine to whoever committed it — and then every
// job of every pull request fails in `npm ci` with `EAI_AGAIN`, because
// `package-firewall.replit.local` does not resolve on a GitHub runner. One
// such entry took the whole of CI down, on main and on every branch.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The one host a runner with plain internet access can reach. */
const REGISTRY = "https://registry.npmjs.org/";

interface LockEntry {
  resolved?: string;
}

describe("package-lock.json", () => {
  test("resolves every package from the public registry", () => {
    const lock = JSON.parse(readFileSync(path.join(repoRoot, "package-lock.json"), "utf8")) as {
      packages: Record<string, LockEntry>;
    };

    const offRegistry = Object.entries(lock.packages)
      .filter(([, entry]) => entry.resolved && !entry.resolved.startsWith(REGISTRY))
      .map(([name, entry]) => `${name || "<root>"} → ${entry.resolved}`);

    assert.deepEqual(
      offRegistry,
      [],
      "run `npm install` outside Replit and commit the lockfile it writes"
    );
  });
});
