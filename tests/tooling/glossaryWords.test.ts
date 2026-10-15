// tests/tooling/glossaryWords.test.ts — a word CONTEXT.md retires appears nowhere it can drift back in.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");

// Third-party text checked in as it was received: the design prototypes, the vendored skills, the lockfile.
const VENDORED = ["tests/e2e/fixtures/", ".claude/skills/", "package-lock.json"];
const CODE = /\.(?:[cm]?[jt]sx?)$/;

const AVOID_LINE = /^_Avoid_:\s*(.*)$/;

/** Every _Avoid_ entry in CONTEXT.md; an entry with a bracketed note has a meaning elsewhere. */
function avoidEntries(context: string): { word: string; retired: boolean }[] {
  return context
    .split("\n")
    .flatMap((line) => AVOID_LINE.exec(line)?.[1].split(/,(?![^(]*\))/) ?? [])
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => ({ word: entry.replace(/\s*\(.*\)$/, ""), retired: !entry.includes("(") }));
}

const letter = (c: string) => (c.toLowerCase() === c.toUpperCase() ? c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : `[${c.toLowerCase()}${c.toUpperCase()}]`);

/**
 * Matches the word as prose or as part of an identifier (`isFooBar`, `foo_bar`, `foo-bar`), with
 * its inflections. An all-capitals word is an acronym and matches only in capitals, or a two-letter
 * one would match every Italian word spelled the same.
 */
function wordPattern(word: string): RegExp {
  if (word === word.toUpperCase()) return new RegExp(`(?:(?<![\\p{L}\\p{N}])|(?<=\\p{Ll}))${word}s?(?![\\p{L}\\p{N}])`, "gu");
  const body = [...word].map((c) => (/[\s-]/.test(c) ? "[\\s_-]?" : letter(c))).join("");
  return new RegExp(`(?:(?<!\\p{L})|(?<=\\p{Ll})(?=\\p{Lu}))${body}(?:s|es|d|ed|ing)?(?!\\p{Ll})`, "gu");
}

function localeText(): string {
  return readdirSync(path.join(repoRoot, "locales"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => [...read(`locales/${f}`).matchAll(/:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join("\n"))
    .join("\n");
}

const STRING = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\\n]|\\.)*)`/g;

/** The hit is inside a string literal that quotes the shipped UI copy (a selector, an expected label). */
function quotesLocale(line: string, at: number, locales: string): boolean {
  for (const m of line.matchAll(STRING)) {
    if (at < m.index! || at >= m.index! + m[0].length) continue;
    const quoted = (m[1] ?? m[2] ?? m[3]).replace(/\.\*|\\[sdw]\+?|[\^$]/g, "").trim();
    if (quoted && locales.includes(quoted)) return true;
  }
  return false;
}

/** Code reaches prose only through comments and strings; outside them, a two-word phrase can be a statement such as `return x`. */
function inCodeProse(line: string, at: number): boolean {
  const before = line.slice(0, at);
  if (before.includes("//") || /^\s*(?:\/\*|\*)/.test(line)) return true;
  return [...line.matchAll(STRING)].some((m) => at > m.index! && at < m.index! + m[0].length);
}

/** The hit is inside a `*"…"*` verbatim quote of a rules source. */
function insideSourceQuote(line: string, at: number): boolean {
  for (const m of line.matchAll(/\*"[^"]*"\*/g)) if (at > m.index! && at < m.index! + m[0].length) return true;
  return false;
}

function findHits(file: string, text: string, words: RegExp[], locales: string): string[] {
  const hits: string[] = [];
  text.split("\n").forEach((line, i) => {
    if (file === "CONTEXT.md" && AVOID_LINE.test(line)) return;    for (const re of words) {
      for (const m of line.matchAll(re)) {
        if (file === "docs/GAME-RULES.md" && insideSourceQuote(line, m.index!)) continue;
        if (quotesLocale(line, m.index!, locales)) continue;
        if (CODE.test(file) && /\s/.test(m[0]) && !inCodeProse(line, m.index!)) continue;
        hits.push(`${file}:${i + 1}: "${m[0]}" — ${line.trim().slice(0, 120)}`);
      }
    }
  });
  return hits;
}

describe("a word CONTEXT.md retires stays retired", () => {
  const context = read("CONTEXT.md");
  const entries = avoidEntries(context);
  const retired = entries.filter((e) => e.retired).map((e) => e.word);
  const words = retired.map(wordPattern);

  test("every _Avoid_ line is read, and some of its words are retired", () => {
    const lines = context.split("\n").filter((l) => l.startsWith("_Avoid_:")).length;
    assert.ok(lines >= 1, "CONTEXT.md has no _Avoid_ lines to derive the words from");
    assert.ok(entries.length >= lines, "an _Avoid_ line parsed to no entries");
    assert.ok(retired.length >= 1, "no _Avoid_ entry is retired, so this guard checks nothing");
  });

  test("the matcher flags each retired word in prose and in an identifier", () => {
    for (const word of retired) {
      const camel = word.replace(/[\s-](\p{L})/gu, (_, c: string) => c.toUpperCase());
      const ident = `const is${camel[0].toUpperCase()}${camel.slice(1)} = 1;`;
      for (const sample of [`// a ${word} here`, ident]) {
        assert.equal(findHits("x.ts", sample, [wordPattern(word)], "").length, 1, `${word} unflagged in: ${sample}`);
      }
    }
  });

  test("a planted retired word in an ordinary source file is caught, with every exemption in force", () => {
    // Spelled in two halves so this file does not trip the scan it tests.
    const word = "man" + "che";
    assert.ok(retired.includes(word), "CONTEXT.md no longer retires the word this test plants");
    const planted = `export function scoreRound() {\n  // the ${word} ends here\n  return ${word};\n}`;
    assert.equal(findHits("lib/game/gameEngine.ts", planted, words, localeText()).length, 2);
  });

  test("no tracked file outside locales/ and vendored sources uses one", () => {
    const locales = localeText();
    const files = execSync("git ls-files -z", { cwd: repoRoot, encoding: "utf8" })
      .split("\0")
      .filter((f) => f && !f.startsWith("locales/") && !VENDORED.some((v) => f.startsWith(v)))
      .filter((f) => existsSync(path.join(repoRoot, f)));
    assert.ok(files.length > 100, "git ls-files listed almost nothing");
    const hits = files.flatMap((file) => {
      const buf = readFileSync(path.join(repoRoot, file));
      return buf.includes(0) ? [] : findHits(file, buf.toString("utf8"), words, locales);
    });
    assert.deepEqual(hits, [], `Retired words (CONTEXT.md § The game) — use the canonical term:\n${hits.join("\n")}`);
  });
});
