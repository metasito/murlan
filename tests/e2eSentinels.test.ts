// tests/e2eSentinels.test.ts — UI copy the browser suite reads as a boolean.
//
// The suite drives the real UI as a user sees it, so naming a control by its visible text is
// deliberate and not what this guards. What this guards is copy doing duty as a *protocol*: a
// label compared for equality to decide whether something is legal, allowed or finished.
//
// #492 changed one such label for a good reason and three browser shards went red with
// "No combination in hand satisfies GIOCA, and PASSA is disabled — the rules guarantee one of
// those always holds". Not one of them named a label, a locale or a copy change; the first said
// the rules were broken. A sentinel is allowed to exist, but it has to be declared once, and a
// copy change has to fail as a copy change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankComments } from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const E2E = path.join(repoRoot, "tests", "e2e");

/**
 * Every sentinel the suite is allowed to hold, and the locale key each one mirrors. The check
 * below reads the key from `locales/it.ts` and refuses a sentinel that has drifted from it, so
 * a copy change fails here — once, saying what it is — rather than three times somewhere that
 * reports a rules violation.
 */
const SENTINELS: Record<string, string> = {
  GIOCA_VALID_LABEL: "gameTable.playA11yValid",
};

function e2eFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) out.push(full);
    }
  };
  walk(E2E);
  return out;
}

/** `"key": "value"` from a locale module, which is a flat object of string literals. */
function localeValue(key: string): string {
  const source = readFileSync(path.join(repoRoot, "locales", "it.ts"), "utf8");
  const m = new RegExp(String.raw`"${key}":\s*"((?:[^"\\]|\\.)*)"`).exec(source);
  assert.ok(m, `locales/it.ts has no key ${key}`);
  return m[1].replace(/\\"/g, '"');
}

test("every sentinel still says what the locale says", () => {
  for (const [name, key] of Object.entries(SENTINELS)) {
    const source = blankComments(readFileSync(path.join(E2E, "helpers", "labels.ts"), "utf8"));
    const m = new RegExp(String.raw`${name}\s*=\s*"((?:[^"\\]|\\.)*)"`).exec(source);
    assert.ok(m, `tests/e2e/helpers/labels.ts no longer declares ${name}`);
    assert.equal(
      m[1],
      localeValue(key),
      `${name} is a harness sentinel and ${key} has changed under it. This is a copy change, ` +
        `not a rules failure: update the constant, and check nothing else read the old wording.`
    );
  }
});

test("a sentinel is declared once, and nowhere else spells it out", () => {
  const declared = Object.keys(SENTINELS).map((name) => localeValue(SENTINELS[name]));
  const offenders: string[] = [];
  for (const file of e2eFiles()) {
    const rel = path.relative(repoRoot, file).split(path.sep).join("/");
    if (rel.endsWith("tests/e2e/helpers/labels.ts")) continue;
    const source = blankComments(readFileSync(file, "utf8"));
    for (const sentence of declared) {
      if (source.includes(sentence)) offenders.push(`${rel}: "${sentence}"`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "import the sentinel from tests/e2e/helpers/labels.ts instead of spelling it out:\n  " +
      offenders.join("\n  ")
  );
});
