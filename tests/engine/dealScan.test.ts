// tests/engine/dealScan.test.ts — the source scans split out of deal.test.ts so the mutation run keeps that file's behaviour tests
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blankCommentsAndStrings, sourcesUnder } from "../helpers/sourceScan.ts";
import { dealCards } from "../../lib/game/gameEngine.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// #806: the deal moved from 21 to 14 each at two seats (docs/GAME-RULES.md § Decisions,
// 2026-08-31) and left a stale "12" behind in docs/GAME-RULES.md §4, next to a
// correct "26" three lines up in §3 — a number in a spec that disagrees with
// itself is the kind of thing that gets read once and believed. This reads
// both clauses back out of the file and checks them against `dealCards`'s
// own arithmetic, rather than against each other, so a future deal-size
// change that updates one clause and misses the other still reds here.
describe("docs/GAME-RULES.md's undealt-card figure agrees with dealCards's own arithmetic (#806)", () => {
  const rules = readFileSync(path.join(repoRoot, "docs", "GAME-RULES.md"), "utf8");

  test("§3's own count of undealt cards matches what dealCards(2) actually excludes", () => {
    const clause = rules.match(/remaining (\d+) are left face down and unused/);
    assert.ok(clause, "§3's undealt-card clause was not found — has the wording moved?");
    assert.equal(Number(clause![1]), dealCards(2).excluded.length);
  });

  test("§4's own count of undealt cards matches what dealCards(2) actually excludes", () => {
    const clause = rules.match(/end up in the (\d+) undealt cards/);
    assert.ok(clause, "§4's undealt-card clause was not found — has the wording moved?");
    assert.equal(Number(clause![1]), dealCards(2).excluded.length);
  });
});

describe("dealFirstSeatFor: nothing routes around it (#803)", () => {
  const ENGINE = "lib/game/gameEngine.ts";
  const callingFiles = sourcesUnder(repoRoot, ["app", "components", "context", "lib", "server"])
    .filter(([, text]) => /\bnextDealFirstSeat\s*\(/.test(blankCommentsAndStrings(text)))
    .map(([rel]) => rel);
  const nextDealFirstSeatCallers = callingFiles.filter((rel) => rel !== ENGINE);

  test("nextDealFirstSeat is called from nowhere but dealFirstSeatFor's own body", () => {
    assert.ok(callingFiles.includes(ENGINE), `the scan did not see ${ENGINE}'s own call: it is not reading the sources`);
    assert.deepEqual(
      nextDealFirstSeatCallers,
      [],
      "a bare nextDealFirstSeat call outside lib/game/gameEngine.ts can rotate a deal that should " +
        `have reset instead — route it through dealFirstSeatFor: ${nextDealFirstSeatCallers.join(", ")}`
    );
  });

  test("all four sites that decide a deal's first seat route through dealFirstSeatFor", () => {
    const serverSrc = readFileSync(path.join(repoRoot, "server", "game", "tableVotes.ts"), "utf8");
    const newTableSrc = readFileSync(path.join(repoRoot, "server", "game", "tableState.ts"), "utf8");
    const offlineSrc = readFileSync(path.join(repoRoot, "lib", "game", "matchFlow.ts"), "utf8");
    // The two sites that must tell a continuing match from a finished one —
    // the ones #803's blind critique found disagreeing.
    assert.match(serverSrc, /dealFirstSeatFor\(game\.matchOver,/);
    assert.match(offlineSrc, /dealFirstSeatFor\(match\.over,/);
    // The two sites that start a match from nothing, where `matchOver` is
    // unconditionally true — a literal `dealFirstSeat: 0` would read the same
    // today, but would stop being the one place this decision is made.
    assert.match(newTableSrc, /dealFirstSeatFor\(true, 0,/);
    assert.match(offlineSrc, /dealFirstSeatFor\(true, 0,/);
  });
});

describe("the rules screen's undealt count", () => {
  const locales = ["en", "it", "sq"] as const;

  test("every locale takes it from the deal rather than stating a number", () => {
    for (const locale of locales) {
      const src = readFileSync(path.join(repoRoot, "locales", `${locale}.ts`), "utf8");
      const answer = /"rules\.faq\.a2": "([^\n]*)",$/m.exec(src)?.[1];
      assert.ok(answer, `${locale}.ts has no rules.faq.a2`);
      assert.ok(
        answer.includes("{{undealt}}"),
        `${locale}'s a2 must carry the {{undealt}} placeholder`
      );
      assert.ok(
        !/\b(12|26)\b/.test(answer),
        `${locale}'s a2 states an undealt count as a literal`
      );
    }
  });

  test("app/rules.tsx fills the placeholder from dealCards", () => {
    const src = readFileSync(path.join(repoRoot, "app", "rules.tsx"), "utf8");
    assert.match(src, /dealCards\(2\)\.excluded\.length/);
    assert.match(src, /undealt:\s*HEADS_UP_UNDEALT/);
  });
});
