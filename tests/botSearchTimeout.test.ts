// tests/botSearchTimeout.test.ts — #770: `stallMs`, `maxStatesWithoutProgress`
// and `maxTotalMs` all compare table descriptions *between* calls to
// `playOrPass`, so none of them can see time spent inside one call. A turn
// whose card search grinds is invisible to all three, and the only recorded
// instance of #770 surfaced as a bare 300s Playwright timeout with `""` for a
// URL. `SearchTimeoutError` is the bound on one search; these tests hold it to
// being a bound on the *search* rather than on a single candidate, and hold
// its default to staying under the deadline it exists to fire before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { driveGameToCompletion, SearchTimeoutError, StuckError } from "./e2e/helpers/bot.ts";
import { GIOCA_VALID_LABEL } from "./e2e/helpers/labels.ts";
import { TABLE, HAND_CARDS } from "./e2e/helpers/selectors.ts";
import { blankComments } from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A numeric `const` read out of source, because the declaring module cannot be imported here. */
function sourceConstant(relPath: string, name: string): number {
  const source = blankComments(readFileSync(path.join(repoRoot, relPath), "utf8"));
  const found = source.match(new RegExp(`\\b${name}\\s*=\\s*([0-9_]+)`));
  assert.ok(found, `${relPath} no longer declares a numeric ${name}`);
  return Number(found[1].replace(/_/g, ""));
}

test("the search budget is derived from the deadline it must fire before, not asserted", () => {
  const humanTurnMs = sourceConstant("app/game.tsx", "HUMAN_TURN_SECONDS") * 1_000;
  const budgetMs = sourceConstant("tests/e2e/helpers/bot.ts", "DEFAULT_SEARCH_BUDGET_MS");

  assert.ok(
    budgetMs < humanTurnMs,
    `DEFAULT_SEARCH_BUDGET_MS (${budgetMs}ms) must name a stalled search before app/game.tsx's ` +
      `HUMAN_TURN_SECONDS (${humanTurnMs}ms) auto-passes the turn out from under it`
  );
  // The third copy of the same deadline: tableFit drives it out for real.
  assert.equal(
    sourceConstant("tests/e2e/tableFit.spec.ts", "OFFLINE_CLOCK_MS"),
    humanTurnMs,
    "tests/e2e/tableFit.spec.ts's OFFLINE_CLOCK_MS has drifted from HUMAN_TURN_SECONDS"
  );
});

const YOUR_TURN_DESC =
  "È il tuo turno. Luan ha giocato Re di Cuori. Luan ha 5 carte in mano. Hai 4 carte in mano.";
const AFTER_PLAY_DESC =
  "Hai giocato Asso di Fiori. Luan ha 5 carte in mano. Hai 3 carte in mano.";

/**
 * Four distinct ranks, every one above the Re on the table, so `playOrPass`
 * tries four singles and forms no pair, triple or bomb — a candidate count the
 * assertions below can be exact about.
 */
const HAND = ["Asso di Fiori", "2 di Picche", "Jolly nero", "Jolly rosso"];

interface FakeOptions {
  /**
   * Fake milliseconds each DOM read costs. The clock is stubbed rather than
   * waited on, so how long a search *appears* to take is exact instead of
   * being whatever the machine running this was doing at the time.
   */
  stepMs?: number;
  /** Which candidate GIOCA accepts, 1-based. Zero for none. */
  acceptNth?: number;
  /** Every card click fails, as a selection cleared out from under the driver does. */
  handVanishes?: boolean;
}

interface Fake {
  page: Page;
  lines: string[];
  isFinished: () => Promise<boolean>;
  /** Candidates that got as far as asking GIOCA. */
  combos: () => number;
  restore: () => void;
}

function makeFake(opts: FakeOptions = {}): Fake {
  const step = opts.stepMs ?? 0;
  const acceptNth = opts.acceptNth ?? 0;
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  const tick = () => {
    now += step;
  };

  const lines: string[] = [];
  let combos = 0;
  let played = false;
  let vanished = false;

  const box = { x: 0, y: 0, width: 10, height: 10 };
  const pressable = { hover: async () => {}, boundingBox: async () => box };
  const handRead = async () => {
    tick();
    return HAND.map((label) => ({ label, selected: false }));
  };

  const locator = (selector: string) => {
    if (selector === '[data-testid="btn-rematch-no"]') {
      return { count: async () => 0, isVisible: async () => false };
    }
    if (selector === '[data-testid="start-reason-gate"]') {
      return { count: async () => 0 };
    }
    if (selector === TABLE) {
      return {
        count: async () => 1,
        getAttribute: async () => {
          tick();
          return played ? AFTER_PLAY_DESC : YOUR_TURN_DESC;
        },
      };
    }
    if (selector === HAND_CARDS) {
      return { evaluateAll: async () => handRead() };
    }
    if (selector.startsWith(HAND_CARDS)) {
      if (opts.handVanishes) {
        return {
          hover: async () => {
            vanished = true;
            throw new Error("card detached");
          },
          boundingBox: async () => box,
        };
      }
      return pressable;
    }
    if (selector === '[data-testid="btn-gioca"]') {
      return {
        ...pressable,
        getAttribute: async () => {
          combos += 1;
          if (combos === acceptNth) {
            played = true;
            return GIOCA_VALID_LABEL;
          }
          return "Gioca — non disponibile: la combinazione non è valida";
        },
      };
    }
    if (selector === '[data-testid="btn-passa"]') {
      return { ...pressable, isEnabled: async () => true };
    }
    throw new Error(`fakePage: unexpected locator "${selector}"`);
  };

  const page = {
    locator,
    mouse: { move: async () => {}, down: async () => {}, up: async () => {} },
    waitForTimeout: async () => {},
  } as unknown as Page;

  return {
    page,
    lines,
    isFinished: async () => played || vanished,
    combos: () => combos,
    restore: () => {
      Date.now = realNow;
    },
  };
}

/** Everything but the budget wide open, so only `searchBudgetMs` can end a drive. */
const OPEN = { stallMs: 60_000, maxStatesWithoutProgress: 100_000, maxTotalMs: 10_000_000 };

test("the budget bounds the whole search, not each candidate", async (t) => {
  // 4s per DOM read against a 10s budget: the third candidate's check is the
  // first to find the clock past the deadline, so two must already have run.
  // A budget re-armed per candidate would never reach it and the search would
  // run to its end — which is the mutation this asserts against.
  const fake = makeFake({ stepMs: 4_000 });
  t.after(fake.restore);

  await assert.rejects(
    () =>
      driveGameToCompletion(fake.page, {
        ...OPEN,
        isFinished: fake.isFinished,
        searchBudgetMs: 10_000,
        log: (line) => fake.lines.push(line),
      }),
    (err: unknown) => {
      assert.ok(err instanceof SearchTimeoutError, `expected SearchTimeoutError, got ${err}`);
      assert.ok(err instanceof StuckError, "SearchTimeoutError must still be a StuckError");
      assert.match((err as Error).message, /ran past 10000ms after 2 candidate\(s\)/);
      assert.match((err as Error).message, new RegExp(HAND[0]));
      return true;
    }
  );
  assert.equal(fake.combos(), 2, "the budget must span candidates, not restart at each one");
});

test("a search that fits inside its budget plays, and its duration reaches the log", async (t) => {
  const fake = makeFake({ stepMs: 100, acceptNth: 2 });
  t.after(fake.restore);

  await driveGameToCompletion(fake.page, {
    ...OPEN,
    isFinished: fake.isFinished,
    searchBudgetMs: 10_000,
    log: (line) => fake.lines.push(line),
  });

  assert.equal(fake.combos(), 2);
  const played = fake.lines.find((l) => l.startsWith("played "));
  assert.ok(played, `no play was logged: ${JSON.stringify(fake.lines)}`);
  const searched = played.match(/\[search (\d+)ms\]/);
  assert.ok(searched, `the play's log line carries no search time: "${played}"`);
  assert.ok(Number(searched[1]) > 0, "a search that read the DOM cannot have taken 0ms");
});

test("a search whose hand goes out from under it still logs how long it ran", async (t) => {
  // The branch `playOrPass` returns null on — the shape an auto-pass landing
  // mid-search produces, and the one whose duration #770 needs most.
  const fake = makeFake({ stepMs: 100, handVanishes: true });
  t.after(fake.restore);

  await driveGameToCompletion(fake.page, {
    ...OPEN,
    isFinished: fake.isFinished,
    searchBudgetMs: 10_000,
    log: (line) => fake.lines.push(line),
  });

  const abandoned = fake.lines.find((l) => l.startsWith("abandoned "));
  assert.ok(abandoned, `an abandoned search logged nothing: ${JSON.stringify(fake.lines)}`);
  const searched = abandoned.match(/\[search (\d+)ms\]/);
  assert.ok(searched, `the abandoned turn carries no search time: "${abandoned}"`);
  assert.ok(Number(searched[1]) > 0, "a search that read the DOM cannot have taken 0ms");
});
