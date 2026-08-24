// tests/verifyScript.test.ts — `verify` cannot quietly drop lint again.
//
// #296: `verify` ran typecheck, test and test:native but not lint — the check
// CLAUDE.md documents as the one most likely to fail late in CI, and, being
// last there, the most expensive place to discover it. This pins that
// `verify` runs lint, last, so the cheap checks still fail fast first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function chainOf(script: string): string[] {
  return script.split("&&").map((s) => s.trim());
}

/** The invariant this file pins: `verify` runs lint, and runs it last. */
function checkChain(chain: string[]): string | null {
  if (!chain.includes("npm run lint")) return "verify does not run lint at all";
  if (chain.at(-1) !== "npm run lint") return "lint does not run last";
  return null;
}

test("verify runs lint, last", () => {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const verify = pkg.scripts?.verify;
  assert.ok(typeof verify === "string" && verify.length > 0, "package.json has no verify script to pin");
  const failure = checkChain(chainOf(verify));
  assert.equal(failure, null, `${failure}: ${verify}`);
});

// Floor: the check above must actually fail on the chain #296 shipped with,
// and on lint present but not last — not just pass on whatever verify says today.
test("the pin fails on the chain it exists to catch", () => {
  assert.equal(
    checkChain(chainOf("npm run typecheck && npm run test && npm run test:native")),
    "verify does not run lint at all"
  );
  assert.equal(
    checkChain(chainOf("npm run lint && npm run typecheck && npm run test && npm run test:native")),
    "lint does not run last"
  );
});
