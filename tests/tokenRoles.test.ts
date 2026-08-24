// tests/tokenRoles.test.ts — React Native renders an invalid or invisible
// colour as nothing at all: no warning, no fallback. TypeScript cannot catch
// it (any string is a valid colour) and neither can a render test (the element
// mounts fine — it is simply not visible).
//
// This pins the half a linter cannot see: whether a token is being used in the
// role it was designed for. The stringified-token half ("Colors.success" in
// quotes) is caught by no-restricted-syntax in eslint.config.js.
//
// The fill set is derived, not listed: a translucent token counts as a fill
// unless it is explicitly blessed as text below. A newly added translucent
// token therefore defaults to the safe side instead of silently escaping.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Colors, Scrim, Highlight, Lantern } from "../lib/tokens.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Translucent tokens that really are text colours. Both are pinned for
 * contrast against bg, bgCard and felt by tests/contrast.test.ts — that is
 * what makes them legible enough to read, and what a fill token has never
 * been checked for.
 */
const TEXT_TOKENS_WITH_ALPHA = new Set(["textSecondary", "textMuted"]);

const PALETTES: Record<string, Record<string, string>> = {
  Colors,
  Scrim,
  Highlight,
  Lantern,
};

function alphaOf(value: string): number {
  const m = /^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/.exec(value);
  return m ? Number(m[1]) : 1;
}

/** `${palette}.${key}` for every token that must never carry text or an icon. */
function fillOnlyTokens(): Set<string> {
  const out = new Set<string>();
  for (const [palette, table] of Object.entries(PALETTES)) {
    for (const [key, value] of Object.entries(table)) {
      if (typeof value !== "string" || alphaOf(value) >= 1) continue;
      if (palette === "Colors" && TEXT_TOKENS_WITH_ALPHA.has(key)) continue;
      out.add(`${palette}.${key}`);
    }
  }
  return out;
}

function sourceFiles(): [string, string][] {
  return ["app", "components"].flatMap((dir) =>
    readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
      .map((f): [string, string] => [
        path.posix.join(dir, f.split(path.sep).join("/")),
        readFileSync(path.join(repoRoot, dir, f), "utf8"),
      ])
  );
}

// A style property named exactly `color`, or a JSX `color=`/`tintColor=`/
// `placeholderTextColor=` prop (icons and placeholders take their colour that
// way too). `backgroundColor:` / `borderColor:` and the rest carry a capital
// C, so they never match.
const COLOUR_PROPERTY = /(?<![A-Za-z])(color|tintColor|placeholderTextColor)\s*[:=]\s*/g;

/**
 * The text from just after a matched property's `:`/`=` up to the top-level
 * comma, semicolon, or enclosing closer — i.e. the whole right-hand side,
 * not just its first token. This is what lets a ternary's untaken branch, or
 * a JSX `{…}` expression, still be scanned.
 */
function captureRhs(src: string, start: number): string {
  let i = start;
  while (i < src.length && /\s/.test(src[i])) i++;
  // A JSX expression container closes itself. Without this the capture treats the attribute's own
  // `}` as nesting, runs past the element, and reports tokens from lines the property never named.
  const container = src[i] === "{";
  let depth = 0;
  let quote = "";
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{" || c === "(" || c === "[") { depth++; continue; }
    if (c === "}" || c === ")" || c === "]") {
      if (depth === 0) break;
      depth--;
      if (container && depth === 0) { i++; break; }
      continue;
    }
    if (depth === 0 && (c === "," || c === ";")) break;
  }
  return src.slice(start, i);
}

/** `[line, property, palette, key]` for every fill-set token reference on a colour property's right-hand side, anywhere in it. */
function colourPropertyTokenUses(source: string): [number, string, string, string][] {
  const out: [number, string, string, string][] = [];
  for (const m of source.matchAll(COLOUR_PROPERTY)) {
    const rhs = captureRhs(source, m.index + m[0].length);
    const line = source.slice(0, m.index).split("\n").length;
    for (const tokenMatch of rhs.matchAll(/(Colors|Scrim|Highlight)\.([A-Za-z0-9_]+)/g)) {
      out.push([line, m[1], tokenMatch[1], tokenMatch[2]]);
    }
  }
  return out;
}

/** Font sizes below WCAG's large-text bar. 19 is 14pt bold, 24 is 18pt. */
const LARGE_ENOUGH = 19;

/** `file:line` for every style object that paints small text in Colors.danger. */
function smallDangerText(files: [string, string][]): string[] {
  const out: string[] = [];
  for (const [file, src] of files) {
    for (const block of src.matchAll(/\{[^{}]*\}/g)) {
      if (!/(?<![A-Za-z])color:\s*Colors\.danger\b/.test(block[0])) continue;
      // Only a size the style states itself can clear the bar: one inherited,
      // or held in a sibling style object, cannot be read from here.
      const size = /\bfontSize:\s*(\d+)/.exec(block[0]);
      if (size && Number(size[1]) >= LARGE_ENOUGH) continue;
      out.push(`${file}:${src.slice(0, block.index).split("\n").length}`);
    }
  }
  return out;
}

describe("design tokens are used in the role they were designed for", () => {
  test("no fill, border or scrim token is used as a text or icon colour", () => {
    const fills = fillOnlyTokens();
    const offenders: string[] = [];

    for (const [file, src] of sourceFiles()) {
      for (const [line, property, palette, key] of colourPropertyTokenUses(src)) {
        const token = `${palette}.${key}`;
        if (!fills.has(token)) continue;
        const value = PALETTES[palette][key];
        offenders.push(`${file}:${line} — ${property}: ${token} (${value})`);
      }
    }

    assert.deepEqual(
      offenders,
      [],
      "a translucent fill token used as a text or icon colour renders as near-nothing:\n" +
        offenders.join("\n")
    );
  });

  test("the fill set is non-empty and excludes the blessed text tokens", () => {
    // Guards the derivation itself: if alphaOf stopped matching, every token
    // would look opaque and the scan above would pass while checking nothing.
    const fills = fillOnlyTokens();
    assert.ok(fills.size > 10, `expected many translucent tokens, found ${fills.size}`);
    assert.ok(fills.has("Colors.goldMuted"));
    assert.ok(fills.has("Highlight.faint"));
    assert.ok(fills.has("Scrim.heavy"));
    assert.ok(!fills.has("Colors.textMuted"), "textMuted is a text colour, not a fill");
    assert.ok(!fills.has("Colors.gold"), "opaque tokens are not fills");
  });

  // Colors.danger clears 4.5:1 on no surface this app has — 4.07 on bgCard,
  // 3.66 on bgSurface, 2.98 on the felt. tests/contrast.test.ts lists it as
  // large-text-only; this is the half that checks the size. WCAG's large bar
  // is 18pt, or 14pt bold, which in React Native's units is 24 and 19.
  test("Colors.danger is never the colour of a small text style", () => {
    const offenders = smallDangerText(sourceFiles());
    assert.deepEqual(
      offenders,
      [],
      `Colors.danger below the large-text bar never reaches 4.5:1:\n${offenders.join("\n")}`
    );
  });

  test("the danger scanner matches a real small use", () => {
    // Without this the size regex could stop matching and the test above would
    // pass on a screen full of small red text.
    assert.deepEqual(
      smallDangerText([["x.tsx", "  a: { ...Type.body, color: Colors.danger },\n"]]),
      ["x.tsx:1"]
    );
    assert.deepEqual(
      smallDangerText([["x.tsx", "  a: { fontSize: 16, color: Colors.danger },\n"]]),
      ["x.tsx:1"]
    );
    assert.deepEqual(
      smallDangerText([["x.tsx", "  a: { fontSize: 24, color: Colors.danger },\n"]]),
      []
    );
    assert.deepEqual(
      smallDangerText([["x.tsx", "  a: { backgroundColor: Colors.danger },\n"]]),
      []
    );
    // The size can live in a different object from the colour, so a style
    // that states none of its own is flagged rather than assumed large.
    assert.deepEqual(
      smallDangerText([["x.tsx", '  { rank: "JKR", color: Colors.danger },\n']]),
      ["x.tsx:1"]
    );
  });

  test("the scanner actually matches a text colour use", () => {
    // Without this the regex could silently stop matching and the suite would
    // still be green — the exact failure mode this file exists to prevent.
    const hits = sourceFiles().reduce(
      (n, [, src]) => n + colourPropertyTokenUses(src).length,
      0
    );
    assert.ok(hits > 20, `expected many token-driven text colours, found ${hits}`);
  });

  test("a JSX colour prop's capture stops at its own closing brace", () => {
    const element = `<Ionicons color={Colors.gold} />
      <View style={styles.rule} />
    </View>
    const styles = { rule: { borderColor: Colors.border }, edge: { borderColor: Colors.goldBorder } }`;
    assert.deepEqual(colourPropertyTokenUses(element).map((u) => u[3]), ["gold"]);
  });

  test("the right-hand-side scanner catches a ternary's untaken branch, tintColor and placeholderTextColor", () => {
    assert.deepEqual(
      colourPropertyTokenUses("{ color: active ? Colors.gold : Colors.goldMuted }").map((u) => u[3]),
      ["gold", "goldMuted"]
    );
    assert.deepEqual(
      colourPropertyTokenUses('<Icon tintColor={Colors.goldMuted} />').map((u) => u[3]),
      ["goldMuted"]
    );
    assert.deepEqual(
      colourPropertyTokenUses('<TextInput placeholderTextColor={Colors.goldMuted} />').map((u) => u[3]),
      ["goldMuted"]
    );
    assert.deepEqual(
      colourPropertyTokenUses("<Icon color={on ? Colors.gold : Colors.border} />").map((u) => u[3]),
      ["gold", "border"]
    );
    assert.deepEqual(
      colourPropertyTokenUses("{ backgroundColor: Colors.goldMuted }"),
      []
    );
  });
});
