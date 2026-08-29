// tests/e2eSentinels.test.ts — UI copy the browser suite reads as a boolean.
//
// The suite drives the real UI as a user sees it, so naming a control by its visible text is
// deliberate and not what this guards. What this guards is copy doing duty as a *protocol*: a
// label compared for equality to decide whether something is legal, allowed or finished.
//
// A sentinel is allowed to exist; it has to be declared once, and a copy edit to it has to
// fail here rather than in a spec that can only report it as a rules violation.
//
// What it does not see, stated rather than left to be discovered: a sentence that only ever
// exists at runtime, and a name resolved through an import. The shared sentinels live in
// `tests/e2e/helpers/labels.ts`, and the third test below refuses a second spelling of any
// of them, which is what covers the import case.
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
    "tests/e2e/gameSettingsSheet.spec.ts",
    "gameSettingsSheet.title",
    "asks which control has focus, not whether something is legal — the same identity the file " +
      "takes by role five times over, and there is no locator query for `document.activeElement`",
  ],
];

/**
 * `NAME -> "the sentence"` for every `const` in `source` bound to a plain
 * string literal, at any indentation.
 *
 * `const` and not `let`: a `let` reassigned later would be recorded as its
 * first value forever, because a bare `X = "…"` carries no keyword to find.
 * A name declared twice is dropped rather than guessed at, and a template
 * holding `${` is not a literal at all.
 */
function literalConsts(source: string): Map<string, string> {
  const found = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const m of source.matchAll(
    /^[ \t]*(?:export\s+)?const\s+(\w+)\s*=\s*(["'`])((?:[^\\]|\\.)*?)\2\s*;?[ \t]*$/gm
  )) {
    const [, name, quote, raw] = m;
    if (found.has(name)) ambiguous.add(name);
    if (quote === "`" && raw.includes("${")) ambiguous.add(name);
    found.set(name, raw.replace(/\\(["'`\\])/g, "$1"));
  }
  for (const name of ambiguous) found.delete(name);
  return found;
}

/**
 * Puts every hoisted name in a file back as the literal it holds, so a
 * comparison against the name reads as a comparison against the sentence.
 *
 * One alternation, built once per file rather than per line, from the names
 * that file actually declares.
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
      // Both spellings of the line, because substitution can hide as well as
      // reveal: a name that is also a word of a locale sentence would rewrite
      // that sentence out of a literal sitting on the same line.
      const line = inline(raw);
      for (const [value, keys] of compared) {
        let found = raw.includes(value) && comparesTo(raw, value);
        if (!found && line !== raw) found = line.includes(value) && comparesTo(line, value);
        if (!found) continue;
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
    [...literalConsts("const A = \"Chiudi\";\nexport const B = 'Gioca';\n  const C = `Passa`;\n").entries()],
    [
      ["A", "Chiudi"],
      ["B", "Gioca"],
      ["C", "Passa"],
    ]
  );
  assert.deepEqual([...literalConsts('const A = "He said \\"hi\\"";').entries()], [["A", 'He said "hi"']]);
  // Two bindings, and the scan cannot say which one reaches the comparison.
  assert.deepEqual([...literalConsts('const A = "x";\nconst A = "y";\n').keys()], []);
  // Reassignable, so its first value is not its value at the comparison.
  assert.deepEqual([...literalConsts('let A = "x";\n').keys()], []);
  // Interpolated, so its value is not in the source at all.
  assert.deepEqual([...literalConsts("const A = `${p} scambio`;\n").keys()], []);
  // A call, an object, a concatenation: not a literal binding.
  assert.deepEqual([...literalConsts('const A = t("k");\nconst B = "a" + b;\n').keys()], []);
});

// The empty case is the load-bearing one: an alternation built from no names
// is `\b()\b`, which matches at every boundary and blanks the line.
test("the inliner puts a name back, and leaves a file with no names alone", () => {
  const inline = inlinerFor(new Map([["CLOSE", 'Chiudi "x" scambio']]));
  assert.equal(inline("n === CLOSE"), 'n === "Chiudi \\"x\\" scambio"');
  assert.equal(inline("n === CLOSER"), "n === CLOSER");
  assert.equal(inlinerFor(new Map())("n === CLOSE"), "n === CLOSE");
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
