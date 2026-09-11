// Every escape from the timing scale, across the whole component tree: a rule
// `eslint.config.js` cannot see, so it is counted here rather than linted.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { componentSources, scanSources } from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// A module-level `..._MS` constant assigned a literal — the shape every
// escape from `Motion`/`Reading`/`Hold` takes (#829). `eslint.config.js`
// refuses a bare number for a timing but not a number behind a name, so this
// is what the linter cannot see: FLIGHT_MS derived from `Motion.duration`
// does not match (the `=` is followed by `Motion`, not a digit), which is the
// point — a name alone is not an escape, only a name holding its own number.
const MOTION_ESCAPE_DECL =
  /^[ \t]*(?:export\s+)?(?:const|let|var)\s+[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_MS(?:\s*:\s*number)?\s*=(?=\s*\d)/gm;

// #829 judged every `_MS` constant in components/ against the scale and left
// the pile below one of two ways: renamed onto Motion/Reading, or kept with a
// comment stating why it is a one-off (ROUND_WINNER_MS, SPARK_LEAD_MS and
// SPARK_PHASE_MS are the pattern to match). This is the count that judgement
// left standing — not zero, CLAUDE.md allows a component-local one-off — so
// that the next one added is a decision this test makes someone write down,
// rather than a drift nobody notices until the next audit.
describe("a duration off the scale is a counted decision, not a silent drift", () => {
  test("components/ holds exactly the number #829 left", () => {
    const hits = scanSources(MOTION_ESCAPE_DECL, componentSources(repoRoot));
    assert.equal(
      hits.length,
      23,
      "a `_MS` constant was added to (or removed from) components/ — fold it onto " +
        "Motion/Reading/Hold, or update this pin with a comment at the constant saying " +
        "why it stays a one-off:\n" + hits.join("\n")
    );
  });

  test("the scan fires on a real declaration, not just this file's fixtures", () => {
    // The exact shape #829 found and fixed: a bare literal behind a name,
    // before FLIGHT_MS was made to derive from Motion.duration.travel.
    const planted: [string, string][] = [
      ["components/table/example.tsx", "export const FLIGHT_MS = 380;"],
    ];
    assert.deepEqual(scanSources(MOTION_ESCAPE_DECL, planted), [
      "components/table/example.tsx: export const FLIGHT_MS =",
    ]);
  });

  test("a step derived from Motion is not an escape", () => {
    const planted: [string, string][] = [
      ["components/table/example.tsx", "export const FLIGHT_MS: number = Motion.duration.travel;"],
    ];
    assert.deepEqual(scanSources(MOTION_ESCAPE_DECL, planted), []);
  });

  test("a comment or a string holding the same text is not a declaration", () => {
    // Text presence is not reachability: a decoy that only a naive scan would fall for.
    const planted: [string, string][] = [
      [
        "components/table/example.tsx",
        [
          "// const EXAMPLE_MS = 500; — left as a note, never declared",
          '  const label = "const EXAMPLE_MS = 500;";',
        ].join("\n"),
      ],
    ];
    assert.deepEqual(scanSources(MOTION_ESCAPE_DECL, planted), []);
  });
});
