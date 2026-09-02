// A `MURLAN_*` timeout set by a test reaches the server no matter which modules
// are already loaded. Every integration suite depends on this: each assigns to
// `process.env` in its own module body, which ESM runs after every hoisted
// import. The mechanism is documented on `timeoutFromEnv` in
// `server/gameTimers.ts`.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// The hoisted import an integration test has, standing in for all of them. It
// reaches `gameTimers` through `onlineGameLogic`, which is the edge that made
// this fail; importing `gameTimers` directly would test a weaker claim.
import "../server/gameRoom.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TIMERS_SOURCE = path.join(repoRoot, "server/gameTimers.ts");

/**
 * Every env-backed timeout the module exports, read from its own source rather
 * than listed here. A hand-kept list is a check that silently stops covering
 * the timeout added after it was written.
 */
function declaredTimeouts(): { fn: string; env: string }[] {
  const source = readFileSync(TIMERS_SOURCE, "utf8");
  return [
    ...source.matchAll(/^export const (\w+) = \(\) =>\s*timeoutFromEnv\("(\w+)"/gm),
  ].map((m) => ({ fn: m[1], env: m[2] }));
}

describe("a timeout set after the server is loaded", () => {
  test("is the value the server actually uses", async () => {
    const timers = await import("../server/gameTimers.ts");
    const before = timers.disconnectGraceMs();
    process.env.MURLAN_DISCONNECT_GRACE_MS = "500";
    try {
      assert.equal(
        timers.disconnectGraceMs(),
        500,
        "the grace was frozen when some module imported gameTimers, so a test " +
          "that shortens it is still waiting on the production default"
      );
    } finally {
      delete process.env.MURLAN_DISCONNECT_GRACE_MS;
    }
    assert.equal(timers.disconnectGraceMs(), before, "the default did not come back");
  });

  test("every one of them, not just the one that broke", async () => {
    const timers = (await import("../server/gameTimers.ts")) as unknown as Record<
      string,
      () => number
    >;
    const declared = declaredTimeouts();
    assert.ok(declared.length >= 5, `found ${declared.length} env-backed timeouts to check`);
    for (const { fn, env: name } of declared) {
      const read = timers[fn];
      assert.equal(typeof read, "function", `${fn} is declared in the source but not exported`);
      const before = read();
      process.env[name] = "777";
      try {
        assert.equal(read(), 777, `${name} is frozen; a test cannot shorten it`);
      } finally {
        delete process.env[name];
      }
      // …and it is genuinely re-read rather than stuck on the last thing set.
      assert.equal(read(), before, `${name} kept the test's value after it was unset`);
    }
  });

  /**
   * The floor under both cases above: they pass just as well if the module
   * simply has no env-derived value left to freeze. This is what says the
   * mechanism is still there and still live.
   */
  test("no env-derived timeout is captured at module scope", () => {
    const declared = readFileSync(path.join(repoRoot, "server/gameTimers.ts"), "utf8");
    assert.deepEqual(
      declared.match(/^export const \w+\s*=\s*timeoutFromEnv\(/gm) ?? [],
      [],
      "a timeout is read at module scope again, so whether a test can shorten it " +
        "depends on who imported gameTimers first"
    );
    assert.ok(
      /timeoutFromEnv\(/.test(declared),
      "nothing reads the environment here any more, so the cases above prove nothing"
    );

    // Reading it live and then freezing the result one file over is the same
    // defect relocated, and the check above cannot see it.
    const readers = new RegExp(
      `\\b(${declaredTimeouts()
        .map(({ fn }) => fn)
        .join("|")})\\(\\)`
    );
    const captured: string[] = [];
    for (const file of readdirSync(path.join(repoRoot, "server"))) {
      if (!file.endsWith(".ts") || file === "gameTimers.ts") continue;
      const source = readFileSync(path.join(repoRoot, "server", file), "utf8");
      for (const [i, line] of source.split("\n").entries()) {
        if (/^(export )?const \w+(: *[\w<>[\]| ]+)? *=/.test(line) && readers.test(line)) {
          captured.push(`server/${file}:${i + 1}`);
        }
      }
    }
    assert.deepEqual(
      captured,
      [],
      "a timeout is read once into a module-scope constant, which freezes it again " +
        "for every caller of that module"
    );
  });
});
