// tests/tooling/preflightMemoryIsWired.test.ts — every suite runner refuses on a starved machine.
//
// The check is only worth what it is wired into. The node suite ran unguarded for as long as
// `scripts/preflightMemory.mjs` existed, and paid for it: twenty whole test files failing at once,
// two of them with 0xC0000142 — Windows for "no memory to start a process" — read as a regression
// (#625).
//
// It lives beside `jest.config.js`, `tests/e2e/playwright.config.ts` and `package.json` rather than
// in the loop's suite, because those three are what it asserts on and a change to any of them runs
// this suite. Read from `package.json` rather than listed here: a hand-written list is a claim that
// nothing fails when a fourth runner is added, and `loop:test` was added as exactly that.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const at = (rel: string) => readFileSync(path.join(root, rel), "utf8");

/** What a command has to mention to be running a suite rather than describing one. */
const RUNNERS = /\bnode --test\b|\bjest\b|\bplaywright test\b/;

/**
 * A Playwright config may inherit its `globalSetup` by spreading another one — the perf config is
 * `{...base}` over `playwright.config.ts` — so the guard is inherited and the word is not in the
 * file. Follow the relative imports one config deep rather than reading the text alone.
 */
function declaresPreflight(config: string, seen = new Set<string>()): boolean {
  if (seen.has(config)) return false;
  seen.add(config);
  const text = at(config);
  if (/preflightMemory/.test(text)) return true;
  return [...text.matchAll(/from "(\.[^"]+)"/g)].some((m) =>
    declaresPreflight(path.posix.join(path.posix.dirname(config), m[1]), seen)
  );
}

describe("the memory preflight", () => {
  test("stands in front of every suite runner package.json defines", () => {
    const scripts: Record<string, string> = JSON.parse(at("package.json")).scripts;
    const guarded = (name: string) => {
      // `node --test` has no globalSetup, so its guard is an npm lifecycle script. `pre<name>` and
      // not a wrapper: npm runs it for `npm run <name>` and for `agent:check`, which shells the
      // same script, and neither can be invoked in a way that skips it.
      if (/preflightMemory/.test(scripts[`pre${name}`] ?? "")) return true;
      // jest and Playwright carry theirs in their own config's globalSetup instead.
      if (/\bjest\b/.test(scripts[name])) return /preflightMemory/.test(at("jest.config.js"));
      if (/\bplaywright test\b/.test(scripts[name])) {
        const config = /--config\s+(\S+)/.exec(scripts[name])?.[1];
        return config ? declaresPreflight(config) : false;
      }
      return false;
    };

    const runners = Object.keys(scripts).filter((n) => RUNNERS.test(scripts[n]) && !n.startsWith("pre"));
    assert.ok(runners.length >= 4, `found ${runners.length} suite runners; the pattern has drifted`);
    assert.deepEqual(
      runners.filter((n) => !guarded(n)),
      [],
      "a suite runner can start on a machine with no memory left to start a process on"
    );
  });

  // Named in `pretest` is not the same as running when `pretest` runs: the script decides whether
  // to check itself from `process.argv[1]`, and a guard that got that wrong would be a silent no-op
  // wearing the name of a check. Under `CI` the verdict is fixed, so this is the one spawn that
  // says the same thing on every machine.
  test("runs, and decides, when it is the one invoked", () => {
    const ran = spawnSync(process.execPath, [path.join(root, "scripts/preflightMemory.mjs")], {
      encoding: "utf8",
      env: { ...process.env, CI: "1" },
    });
    assert.equal(ran.status, 0, `the preflight refused a CI run: ${ran.stderr}`);
    assert.match(ran.stdout, /^preflight:/m, "running the script decided nothing");
  });
});
