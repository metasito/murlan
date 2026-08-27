import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Production's major (`.replit`) is the one every other Postgres in the
 * project follows. A dump is only portable backwards, so a CI client newer
 * than its service container fails the restore proof, and a dev container
 * newer than production hides a syntax error until deploy.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readRepoFile = (...parts: string[]) =>
  readFileSync(path.join(repoRoot, ...parts), "utf8");

function majors(source: string, pattern: RegExp): number[] {
  return [...source.matchAll(pattern)].map((m) => Number(m[1]));
}

describe("every Postgres in the project is production's major", () => {
  const production = majors(readRepoFile(".replit"), /modules\s*=\s*\[[^\]]*"postgresql-(\d+)"/g);

  test(".replit names exactly one", () => {
    assert.equal(production.length, 1, `.replit names ${production.length} postgresql modules`);
  });

  test("the dev container matches it", () => {
    const dev = majors(readRepoFile("scripts", "dev-stack.mjs"), /"postgres:(\d+)-alpine"/g);

    assert.ok(dev.length > 0, "dev-stack.mjs runs no Postgres image");
    assert.deepEqual(dev, production);
  });

  test("CI's service containers and its client match it", () => {
    const ci = readRepoFile(".github", "workflows", "ci.yml");
    const services = majors(ci, /image:\s*postgres:(\d+)-alpine/g);
    // The install command, not a mention of it: an error message naming the
    // package would otherwise satisfy this on its own.
    const clients = majors(ci, /apt-get install[^\n]*postgresql-client-(\d+)/g);

    assert.ok(services.length > 0, "ci.yml runs no Postgres service");
    assert.ok(clients.length > 0, "ci.yml installs no Postgres client");
    for (const major of [...services, ...clients]) {
      assert.equal(major, production[0]);
    }
  });
});
