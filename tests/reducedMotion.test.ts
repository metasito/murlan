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
    else if (entry.name.endsWith(".tsx")) out.push(rel);
  }
  return out;
}

/** Reanimated's animation builders. Any of them puts a value in motion. */
const ANIMATES = /\bwith(Timing|Spring|Repeat|Sequence|Decay)\s*\(/;

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
    if (!/\bwithRepeat\s*\(/.test(source)) continue;
    if (source.includes("usePrefersReducedMotion")) continue;
    offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `endless animation with no reduced-motion path: ${offenders.join(", ")}`);
});
