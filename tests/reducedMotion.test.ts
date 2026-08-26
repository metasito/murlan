// tests/reducedMotion.test.ts — nothing animates behind the setting's back.
//
// lib/accessibility.ts gives every component one hook, `usePrefersReducedMotion`,
// which already folds the OS preference and the player's in-app override
// together. tests/native/motionPreference.test.tsx proves the hook resolves
// correctly; nothing proved the screens ask it. Three did not — the home
// screen's floating cards and the result screen's glow both looped forever
// with `withRepeat(..., -1)`, which is the exact thing the setting exists to
// stop.
//
// Structural, like tests/orientation.test.ts: the property is about how the
// source is written, so it is checked by reading it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourcesUnder(rel));
    else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) out.push(rel);
  }
  return out;
}

/**
 * Every animation builder either library offers. Reanimated's are what the app
 * uses; React Native's own `Animated` is here because a file built on it was
 * invisible to a Reanimated-only pattern, and looped forever behind the
 * setting's back for exactly that reason.
 */
const ANIMATES =
  /\bwith(Timing|Spring|Repeat|Sequence|Decay)\s*\(|\bAnimated\.(timing|spring|decay|loop|sequence|parallel|stagger)\s*\(/;

// These two are a coarse outer net, kept as a whole-file check even though
// the per-call-site scanner below is the one that actually pins the
// property: they still catch the wholesale removal of the hook from a file,
// and a brand-new file that animates with no trace of it anywhere.
test("every screen and component that animates reads the motion preference", () => {
  const offenders: string[] = [];
  for (const rel of [...sourcesUnder("app"), ...sourcesUnder("components")]) {
    const source = readFileSync(path.join(repoRoot, rel), "utf8");
    if (!ANIMATES.test(source)) continue;
    if (source.includes("usePrefersReducedMotion")) continue;
    offenders.push(rel);
  }

  assert.deepEqual(
    offenders,
    [],
    `these animate without ever asking whether the player wants motion: ${offenders.join(", ")}. ` +
      `Read usePrefersReducedMotion from lib/accessibility and set the final value directly ` +
      `when it is true.`
  );
});

// The looping ones are the ones that matter most: an entrance is over in half a
// second, a `withRepeat(..., -1)` never is.
test("nothing loops forever without checking first", () => {
  const offenders: string[] = [];
  for (const rel of [...sourcesUnder("app"), ...sourcesUnder("components")]) {
    const source = readFileSync(path.join(repoRoot, rel), "utf8");
    if (!/\bwithRepeat\s*\(|\bAnimated\.loop\s*\(/.test(source)) continue;
    if (source.includes("usePrefersReducedMotion")) continue;
    offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `endless animation with no reduced-motion path: ${offenders.join(", ")}`);
});

/** Blanks out line and block comments, preserving line numbers and string contents. */
function stripComments(source: string): string {
  return source.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, (m) => m.replace(/[^\n]/g, " "));
}

/**
 * Every top-level `{ … }` block in the source — a function/component body,
 * a hook body, a top-level `if` — brace-balanced and skipping quoted
 * strings, so a `{` inside a string or a JSX text node cannot desync the
 * count. Returned with each block's start offset, since the same block text
 * can occur more than once in a file.
 */
export function topLevelBlocks(source: string): { start: number; text: string }[] {
  const blocks: { start: number; text: string }[] = [];
  let depth = 0;
  let quote = "";
  let blockStart = -1;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{" || c === "(" || c === "[") {
      if (c === "{" && depth === 0) blockStart = i;
      depth++;
      continue;
    }
    if (c === "}" || c === ")" || c === "]") {
      depth--;
      if (c === "}" && depth === 0 && blockStart !== -1) {
        blocks.push({ start: blockStart, text: source.slice(blockStart, i + 1) });
        blockStart = -1;
      }
      continue;
    }
  }
  return blocks;
}

/** One `reduceMotion`-consulting expression referenced, or the hook itself. */
const CONSULTS_PREFERENCE = /usePrefersReducedMotion|\breduceMotion\b|\breduced\b/;

/** `line: preview` for every top-level block that animates without consulting the preference in that same block. */
export function ungatedAnimationBlocks(source: string): string[] {
  const clean = stripComments(source);
  const out: string[] = [];
  for (const { start, text } of topLevelBlocks(clean)) {
    if (!ANIMATES.test(text)) continue;
    if (CONSULTS_PREFERENCE.test(text)) continue;
    const line = clean.slice(0, start).split("\n").length;
    out.push(`${line}: ${text.slice(0, 60).replace(/\s+/g, " ").trim()}…`);
  }
  return out;
}

// Per-call-site: a file that calls usePrefersReducedMotion once (or even
// just mentions the name in a stray comment) exempted every animation in it
// under the two whole-file tests above — including a second, unrelated
// function in the same file that animates and never touches the preference.
test("every function that animates, specifically, reads the motion preference", () => {
  const offenders: string[] = [];
  for (const rel of [...sourcesUnder("app"), ...sourcesUnder("components")]) {
    const source = readFileSync(path.join(repoRoot, rel), "utf8");
    for (const hit of ungatedAnimationBlocks(source)) {
      offenders.push(`${rel}:${hit}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these animate without consulting the motion preference in the same function:\n${offenders.join("\n")}`
  );
});

test("the per-function scanner matches an unguarded animation and ignores a stray comment", () => {
  assert.deepEqual(
    ungatedAnimationBlocks("function A() {\n  withTiming(1);\n}\n"),
    ["1: { withTiming(1); }…"]
  );
  assert.deepEqual(
    ungatedAnimationBlocks(
      "function A() {\n  const reduceMotion = usePrefersReducedMotion();\n  withTiming(reduceMotion ? 0 : 1);\n}\n"
    ),
    []
  );
  assert.deepEqual(
    ungatedAnimationBlocks("// usePrefersReducedMotion is used elsewhere\nfunction A() {\n  withTiming(1);\n}\n"),
    ["2: { withTiming(1); }…"]
  );
});

// Reanimated's declarative layout animations are not in the regex above, and
// a file that calls the hook once passes it however many animations ignore
// the answer. These are per-occurrence: an `entering=` or `exiting=` either
// reads the preference itself, or is handed a value that did.
const LAYOUT_ANIMATION = /\b(entering|exiting)=\{([^}]*)\}/g;

/** `line: attr` for every layout animation that plays whatever the player asked for. */
export function ungatedLayoutAnimations(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(LAYOUT_ANIMATION)) {
    const value = m[2].trim();
    if (value.includes("reduceMotion")) continue;
    // `entering={entering}` is gated where that name is defined.
    if (/^[A-Za-z_$][\w$]*$/.test(value)) {
      const decl = new RegExp(String.raw`\b(const|let)\s+${value}\s*=([^;]*)`).exec(source);
      if (decl && decl[2].includes("reduceMotion")) continue;
    }
    out.push(`${source.slice(0, m.index).split("\n").length}: ${m[0]}`);
  }
  return out;
}

test("no layout animation plays past the motion preference", () => {
  const offenders: string[] = [];
  for (const rel of [...sourcesUnder("app"), ...sourcesUnder("components")]) {
    for (const hit of ungatedLayoutAnimations(readFileSync(path.join(repoRoot, rel), "utf8"))) {
      offenders.push(`${rel}:${hit}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these cross-fade regardless of what the player asked for:\n${offenders.join("\n")}`
  );
});

test("the layout-animation scanner matches a real ungated use", () => {
  assert.deepEqual(
    ungatedLayoutAnimations("      entering={FadeIn.duration(400)}\n"),
    ["1: entering={FadeIn.duration(400)}"]
  );
  assert.deepEqual(
    ungatedLayoutAnimations("      entering={reduceMotion ? undefined : FadeIn.duration(400)}\n"),
    []
  );
  assert.deepEqual(
    ungatedLayoutAnimations("const entering = reduceMotion ? undefined : FadeIn;\n<X entering={entering} />\n"),
    []
  );
});

// ─── The three moments (#200) ──────────────────────────────────────────────
//
// The generic scans above already cover every source file, these new ones
// included — a moment that stopped consulting the preference would already
// fail one of them. Named per moment anyway, so a regression here reads as
// "the deal" or "the bomb", not as a line number in a directory-wide sweep.

test("the deal — hand.tsx's stagger and drop both skip under reduced motion", () => {
  const source = readFileSync(path.join(repoRoot, "components/table/hand.tsx"), "utf8");
  assert.deepEqual(ungatedAnimationBlocks(source), []);
});

test("the bomb — kick (useTableFeedback.ts) and flare/wave/spark (moments.tsx) all skip under reduced motion", () => {
  const feedback = readFileSync(path.join(repoRoot, "components/useTableFeedback.ts"), "utf8");
  const moments = readFileSync(path.join(repoRoot, "components/table/moments.tsx"), "utf8");
  assert.deepEqual(ungatedAnimationBlocks(feedback), []);
  assert.deepEqual(ungatedAnimationBlocks(moments), []);
});

test("the flush — the sweep (moments.tsx) and the pile's own catch (pile.tsx) both skip under reduced motion", () => {
  const moments = readFileSync(path.join(repoRoot, "components/table/moments.tsx"), "utf8");
  const pile = readFileSync(path.join(repoRoot, "components/table/pile.tsx"), "utf8");
  assert.deepEqual(ungatedAnimationBlocks(moments), []);
  assert.deepEqual(ungatedAnimationBlocks(pile), []);
});
