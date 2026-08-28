// tests/e2eSentinels.test.ts — UI copy the browser suite reads as a boolean.
//
// The suite drives the real UI as a user sees it, so naming a control by its visible text is
// deliberate and not what this guards. What this guards is copy doing duty as a *protocol*: a
// label compared for equality to decide whether something is legal, allowed or finished.
//
// A sentinel is allowed to exist; it has to be declared once, and a copy edit to it has to
// fail here rather than in a spec that can only report it as a rules violation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankComments } from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const E2E = path.join(repoRoot, "tests", "e2e");

/** Every sentinel the suite is allowed to hold, and the locale key each one mirrors. */
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

/** Every `"key": "value"` in a locale module, which is one flat object of string literals. */
function localeEntries(): Map<string, string> {
  const source = readFileSync(path.join(repoRoot, "locales", "it.ts"), "utf8");
  const out = new Map<string, string>();
  for (const m of source.matchAll(/"([\w.]+)":\s*"((?:[^"\\]|\\.)*)"/g)) {
    out.set(m[1], m[2].replace(/\\"/g, '"'));
  }
  return out;
}

function localeValue(key: string): string {
  const value = localeEntries().get(key);
  assert.ok(value !== undefined, `locales/it.ts has no key ${key}`);
  return value;
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

/**
 * A comparison that is asking which control it is looking at rather than deciding something.
 * Each entry: file, locale key, and why it is not a sentinel.
 */
const COMPARED_BUT_NOT_A_SENTINEL: [string, string, string][] = [
  [
    "tests/e2e/gameSettingsSheet.spec.ts",
    "gameSettingsSheet.title",
    "asks which control has focus, not whether something is legal — the same identity the file " +
      "takes by role five times over, and there is no locator query for `document.activeElement`",
  ],
];

/** The literal sits either side of an equality operator, or inside a substring test. */
function comparesTo(line: string, literal: string): boolean {
  const q = literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    String.raw`[!=]==?\s*["'\`]${q}["'\`]` +
      String.raw`|["'\`]${q}["'\`]\s*[!=]==?` +
      String.raw`|\.(?:includes|startsWith|endsWith)\(\s*["'\`]${q}["'\`]\s*\)`
  ).test(line);
}

test("no new copy is compared for equality without being declared a sentinel", () => {
  // Keyed by the sentence, not by the key that names it: four keys carry "Impostazioni",
  // and a comparison cannot say which one it meant.
  const compared = new Map<string, string[]>();
  for (const [key, value] of localeEntries()) {
    if (value.length > 3) compared.set(value, [...(compared.get(value) ?? []), key]);
  }
  const claimOf = (file: string, value: string) => [file, value].join("\t");
  const allowed = new Set(
    COMPARED_BUT_NOT_A_SENTINEL.map(([file, key]) => claimOf(file, localeValue(key)))
  );
  const offenders: string[] = [];
  const unused = new Set(allowed);

  for (const file of e2eFiles()) {
    const rel = path.relative(repoRoot, file).split(path.sep).join("/");
    const lines = blankComments(readFileSync(file, "utf8")).split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const [value, keys] of compared) {
        if (!line.includes(value) || !comparesTo(line, value)) continue;
        const claim = claimOf(rel, value);
        if (allowed.has(claim)) unused.delete(claim);
        else offenders.push(`${rel}:${i + 1} compares "${value}" (${keys.join(", ")})`);
      }
    });
  }

  assert.deepEqual(
    offenders,
    [],
    "this copy is deciding something, which makes it a harness sentinel. Declare it in " +
      "tests/e2e/helpers/labels.ts and add it to SENTINELS above, or — if it is naming a " +
      "control rather than deciding — say so in COMPARED_BUT_NOT_A_SENTINEL:\n  " +
      offenders.join("\n  ")
  );
  assert.deepEqual(
    [...unused],
    [],
    "COMPARED_BUT_NOT_A_SENTINEL claims a comparison that is no longer there; delete the entry"
  );
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
