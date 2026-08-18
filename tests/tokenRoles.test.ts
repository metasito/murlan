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
import { Colors, Scrim, Highlight } from "../lib/tokens.ts";

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

// A style property named exactly `color`, or a JSX `color=` prop (icons take
// their glyph colour that way). `backgroundColor:` / `borderColor:` and the
// rest carry a capital C, so they never match.
const TEXT_COLOUR_USE = /(?<![A-Za-z])color\s*[:=]\s*\{?\s*(Colors|Scrim|Highlight)\.([A-Za-z0-9_]+)/g;

describe("design tokens are used in the role they were designed for", () => {
  test("no fill, border or scrim token is used as a text or icon colour", () => {
    const fills = fillOnlyTokens();
    const offenders: string[] = [];

    for (const [file, src] of sourceFiles()) {
      for (const m of src.matchAll(TEXT_COLOUR_USE)) {
        const token = `${m[1]}.${m[2]}`;
        if (!fills.has(token)) continue;
        const line = src.slice(0, m.index).split("\n").length;
        const value = PALETTES[m[1]][m[2]];
        offenders.push(`${file}:${line} — color: ${token} (${value})`);
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

  // Colors.danger clears 4.5:1 on nothing the app draws it on — 4.07 on
  // bgCard, 3.66 on bgSurface, 2.98 on the felt. tests/contrast.test.ts lists
  // it as large-text-only; this is the half that checks the size.
  test("Colors.danger is never the colour of a body-size text style", () => {
    const BODY_SIZED = /\.\.\.Type\.(body|caption|small)|fontSize:\s*(FontSize\.(xs|sm)|\d|1[0-3])\b/;
    const offenders: string[] = [];

    for (const [file, src] of sourceFiles()) {
      for (const block of src.matchAll(/\{[^{}]*\}/g)) {
        if (!/(?<![A-Za-z])color:\s*Colors\.danger\b/.test(block[0])) continue;
        if (!BODY_SIZED.test(block[0])) continue;
        offenders.push(`${file}:${src.slice(0, block.index).split("\n").length}`);
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `Colors.danger below 18pt (or 14pt bold) never reaches 4.5:1:\n${offenders.join("\n")}`
    );
  });

  test("the scanner actually matches a text colour use", () => {
    // Without this the regex could silently stop matching and the suite would
    // still be green — the exact failure mode this file exists to prevent.
    const hits = sourceFiles().reduce(
      (n, [, src]) => n + [...src.matchAll(TEXT_COLOUR_USE)].length,
      0
    );
    assert.ok(hits > 20, `expected many token-driven text colours, found ${hits}`);
  });
});
