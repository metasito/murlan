// tests/e2eSentinels.test.ts — UI copy the browser suite reads as a boolean.
//
// The suite drives the real UI as a user sees it, so naming a control by its visible text is
// deliberate and not what this guards. What this guards is copy doing duty as a *protocol*: a
// label compared for equality to decide whether something is legal, allowed or finished.
//
// A sentinel is allowed to exist; it has to be declared once, and a copy edit to it has to
// fail here rather than in a spec that can only report it as a rules violation.
//
// What it does not see, stated rather than left to be discovered: a comparison against an
// interpolated template — `desc === `${prefix} scambio`` — because the sentence it ends up
// holding is not in the source. A sentinel resolved through an import is not seen either;
// the shared ones live in `tests/e2e/helpers/labels.ts`, and this refuses a second spelling
// of any of them.
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
  YOUR_TURN_PREFIX: "gameTable.a11yYourTurn",
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
    "tests/e2e/exchangeAnnounceNodes.spec.ts",
    "exchangeAnnouncement.closeA11yLabel",
    "picks the close button out of an accessibility tree, where a node carries a name and " +
      "nothing else — the same identity `getByRole` takes by name elsewhere in the file, and " +
      "there is no locator query for a CDP node",
  ],
  [
    "tests/e2e/gameSettingsSheet.spec.ts",
    "gameSettingsSheet.title",
    "asks which control has focus, not whether something is legal — the same identity the file " +
      "takes by role five times over, and there is no locator query for `document.activeElement`",
  ],
];

/**
 * `NAME -> "the sentence"` for every module-level `const` in `source` bound
 * once to a plain string literal.
 *
 * A spec that uses a sentence twice hoists it, which is the natural thing to
 * do and the thing that hid it: the declaration carries no operator and the
 * comparison carries no literal, so neither line is one this scan can read.
 *
 * A name assigned more than once is dropped rather than guessed at, and a
 * template holding `${` is not a literal at all.
 */
export function literalConsts(source: string): Map<string, string> {
  const found = new Map<string, string>();
  const rebound = new Set<string>();
  for (const m of source.matchAll(/^\s*(?:const|let)\s+(\w+)\s*=\s*(["'`])((?:[^\\]|\\.)*?)\2\s*;?\s*$/gm)) {
    const [, name, quote, value] = m;
    if (found.has(name)) rebound.add(name);
    if (quote === "`" && value.includes("${")) rebound.add(name);
    found.set(name, value);
  }
  for (const name of rebound) found.delete(name);
  return found;
}

/**
 * Puts every hoisted name in a file back as the literal it holds, so a
 * comparison against the name reads as a comparison against the sentence.
 *
 * One alternation of the names this file actually declares, built once:
 * matching every word of every line instead ran the whole sweep at twice the
 * cost for the same answer.
 */
function inlinerFor(consts: Map<string, string>): (line: string) => string {
  if (consts.size === 0) return (line) => line;
  const names = new RegExp(`\\b(${[...consts.keys()].join("|")})\\b`, "g");
  return (line) =>
    line.replace(names, (name) => `"${consts.get(name)!.replace(/"/g, '\\"')}"`);
}

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
    const source = blankComments(readFileSync(file, "utf8"));
    const inline = inlinerFor(literalConsts(source));
    source.split(/\r?\n/).forEach((raw, i) => {
      // Substituted before the `includes` pre-filter, not after: the whole
      // point is that the sentence is not on this line.
      const line = inline(raw);
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

test("a hoisted sentence is read as the sentence", () => {
  assert.deepEqual(
    [...literalConsts('const A = "Chiudi";\nlet b = `Gioca`;\n').entries()],
    [
      ["A", "Chiudi"],
      ["b", "Gioca"],
    ]
  );
  // Two bindings, and the scan cannot say which one reaches the comparison.
  assert.deepEqual([...literalConsts('const A = "x";\nconst A = "y";\n').keys()], []);
  // Interpolated, so its value is not in the source at all.
  assert.deepEqual([...literalConsts("const A = `${p} scambio`;\n").keys()], []);
  // A call, an object, a concatenation: not a literal binding.
  assert.deepEqual([...literalConsts('const A = t("k");\nconst B = "a" + b;\n').keys()], []);
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
