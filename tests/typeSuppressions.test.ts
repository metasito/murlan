// tests/typeSuppressions.test.ts — no `@ts-ignore` or `@ts-nocheck` anywhere.
//
// `@ts-ignore` silences whatever error lands on the next line, including one
// that arrives long after the line was written: 32 of these accumulated in
// tests/, and repointing one import at a missing module produced 108 errors
// elsewhere and none at the site that caused them. `@ts-expect-error` is
// allowed because it is self-cancelling — it goes red once the error it names
// is gone.
//
// eslint.config.js bans the same shape via @typescript-eslint/ban-ts-comment,
// which is what an editor reports as you type. `npx expo lint` passes ESLint
// only `app` and `components` (@expo/cli DEFAULT_INPUTS), so that rule never
// reaches tests/ in CI, and this is the copy that does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { areasOf } from "../scripts/checkStrictIndexed.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Build output and vendored code. Anything unrecognised is scanned. */
const SKIP = new Set([
  "node_modules",
  "dist",
  "server_dist",
  "static-build",
  "test-results",
  "playwright-report",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(repoRoot, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      return e.name.startsWith(".") || SKIP.has(e.name) ? [] : sourceFiles(rel);
    }
    return /\.tsx?$/.test(e.name) ? [rel] : [];
  });
}

/** A comment that opens with the directive — the only shape TypeScript honours. */
const BANNED = /^\s*(?:\/\/|\/\*)\s*@ts-(?:ignore|nocheck)\b/;

test("the scan matches the directive it exists to find", () => {
  for (const shape of ["// @ts-ignore", "  //@ts-ignore reason", "/* @ts-nocheck */"]) {
    assert.ok(BANNED.test(shape), `the detector no longer matches ${shape}`);
  }
  assert.ok(!BANNED.test("// @ts-expect-error — reason"), "@ts-expect-error must stay allowed");
});

test("no source file suppresses type errors with @ts-ignore or @ts-nocheck", () => {
  const files = sourceFiles(".").map((f) => f.slice(2));
  assert.ok(files.length > 200, `only ${files.length} files scanned — the walk found nothing`);

  const found = files.flatMap((rel) => {
    const source = readFileSync(path.join(repoRoot, rel), "utf8");
    return source
      .split("\n")
      .map((line, i) => (BANNED.test(line) ? `${rel}:${i + 1} — ${line.trim()}` : ""))
      .filter(Boolean);
  });

  assert.deepEqual(
    found,
    [],
    "these suppress every future error on the following line, not just today's. Use " +
      "`@ts-expect-error <reason>`, which fails once the error it names is gone — or fix the type"
  );
});

/**
 * A non-null assertion (`x!`) silences noUncheckedIndexedAccess the same way
 * `@ts-ignore` silences any other error — without narrowing anything. The
 * ratchet's own areas (tsconfig.strictIndexed.json's `include`) already had
 * some before it arrived (`req.session.userId!`, `process.env.X!` — property
 * gaps the flag doesn't touch), so this cannot ban the shape outright; it
 * ratchets instead, the same way the tsconfig does: this count, per file, is
 * the ceiling, and only ever moves down.
 */
const NON_NULL_ASSERTION = /[A-Za-z0-9_$)\]]!(?:[.,;)\]]|$)/;

const NON_NULL_ASSERTION_BASELINE: Record<string, number> = {
  "server/routes.ts": 23,
  "server/schemaDdl.ts": 1,
  "server/session.ts": 1,
  "server/ticket.ts": 1,
  "context/GameContext.tsx": 2,
  "context/OnlineGameContext.tsx": 2,
};

test("no new non-null assertion in the noUncheckedIndexedAccess ratchet's areas", () => {
  const config = JSON.parse(
    readFileSync(path.join(repoRoot, "tsconfig.strictIndexed.json"), "utf8")
  );
  const areas = areasOf(config);
  assert.ok(areas.length > 0, "the ratchet's include list is empty — nothing to check here either");

  const counts: Record<string, number> = {};
  for (const area of areas) {
    for (const rel of sourceFiles(area)) {
      const source = readFileSync(path.join(repoRoot, rel), "utf8");
      const hits = source.split("\n").filter((line) => NON_NULL_ASSERTION.test(line)).length;
      if (hits > 0) counts[rel] = hits;
    }
  }

  const over = Object.entries(counts)
    .filter(([file, count]) => count > (NON_NULL_ASSERTION_BASELINE[file] ?? 0))
    .map(([file, count]) => `${file}: ${count} (baseline ${NON_NULL_ASSERTION_BASELINE[file] ?? 0})`);

  assert.deepEqual(
    over,
    [],
    "new non-null assertion(s) in a noUncheckedIndexedAccess-ratcheted area — narrow instead, " +
      "or if this genuinely predates the ratchet reaching this file, raise its baseline here"
  );
});
