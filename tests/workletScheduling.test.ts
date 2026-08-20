// tests/workletScheduling.test.ts — nothing schedules back to JS with the deprecated call.
//
// `runOnJS` is `@deprecated` in react-native-worklets in favour of `scheduleOnRN`,
// and a future major removes it. Nothing else in the toolchain objects: it type-checks,
// it lints clean, and it keeps working until the version bump that deletes it stops the
// banner and the pile animating. So the property is checked by reading the source.
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

const sources = [...sourcesUnder("app"), ...sourcesUnder("components"), ...sourcesUnder("lib")];

test("no source calls the deprecated runOnJS", () => {
  const offenders = sources.filter((rel) =>
    /\brunOnJS\b/.test(readFileSync(path.join(repoRoot, rel), "utf8"))
  );

  assert.deepEqual(
    offenders,
    [],
    `these still schedule with the deprecated runOnJS: ${offenders.join(", ")}. ` +
      `Import scheduleOnRN from react-native-worklets and call it as scheduleOnRN(fn, ...args).`
  );
});

// The floor: a scan that reads nothing passes vacuously. These two are the
// animation callbacks it exists to hold, so it has to be reading them. A third
// file scheduling back to JS is fine and not this test's business.
test("the files that schedule back to JS are in the scanned set", () => {
  const schedulers = sources.filter((rel) =>
    /\bscheduleOnRN\b/.test(readFileSync(path.join(repoRoot, rel), "utf8"))
  );

  for (const rel of ["components/NotificationBanner.tsx", "components/table/pile.tsx"]) {
    assert.ok(schedulers.includes(rel), `${rel} no longer schedules back to JS at all`);
  }
});
