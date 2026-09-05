// #839 — measures whether a heads-up (2-seat) Murlan match is actually as
// one-sided as it reads, and which of three named mechanisms produces it:
// the exchange compounding every manche between the same two seats
// (docs/RULES.md §10), half the deck going undealt at two players
// (lib/gameEngine.ts's dealCards), or the default bot personality being the
// passive one (lib/botPersonalities.ts).
//
// Calls the real engine and the real bot AI through
// tests/helpers/offlineMatch.ts's `simulateOfflineMatch` — no copy of
// either, per the ticket's own constraint. `aiRng` (added to that harness
// for this ticket) makes a whole match, deal and personality knobs both,
// reproducible from one seed, per `aiChoosePlay`'s own injectable `rng`.
//
// Run: node --experimental-strip-types scripts/measureHeadsUpBalance.ts
// Flags (all optional, see `parseArgs`): --seed --dealN --matchN2p
// --matchN4p --personalityN
import { pathToFileURL } from "node:url";
import { dealCards, type Card } from "../lib/gameEngine.ts";
import {
  BOT_PERSONALITIES,
  DEFAULT_BOT_PERSONALITY,
  type BotPersonalityId,
} from "../lib/botPersonalities.ts";
import {
  simulateOfflineMatch,
  withSeededDeals,
  type OfflinePlayerSetup,
  type SimulateMatchResult,
} from "../tests/helpers/offlineMatch.ts";
import { mulberry32 } from "../tests/helpers.ts";

interface Options {
  seed: number;
  dealN: number;
  matchN2p: number;
  matchN4p: number;
  personalityN: number;
}

function parseArgs(argv: string[]): Options {
  const read = (name: string, fallback: number) => {
    const at = argv.indexOf(`--${name}`);
    if (at === -1) return fallback;
    const value = Number(argv[at + 1]);
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    seed: read("seed", 1),
    dealN: read("dealN", 20000),
    matchN2p: read("matchN2p", 3000),
    matchN4p: read("matchN4p", 1000),
    personalityN: read("personalityN", 1200),
  };
}

// ─── Small stats helpers ────────────────────────────────────────────────────

const isTopCard = (c: Card) => c.isJoker || c.rank === "2";

function mean(xs: number[]): number {
  return xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/**
 * Wilson score interval rather than a normal approximation: several of the
 * proportions below (e.g. "all six top cards in one hand") are rare enough
 * that a normal interval can go negative or past 1, which a Wilson interval
 * cannot.
 */
function wilson(k: number, n: number, z = 1.96): { p: number; low: number; high: number } {
  if (n === 0) return { p: NaN, low: NaN, high: NaN };
  const phat = k / n;
  const denom = 1 + (z * z) / n;
  const center = phat + (z * z) / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat)) / n + (z * z) / (4 * n * n));
  return { p: phat, low: Math.max(0, (center - margin) / denom), high: Math.min(1, (center + margin) / denom) };
}

function pct(p: number): string {
  return Number.isFinite(p) ? `${(p * 100).toFixed(1)}%` : "n/a";
}

function fmtWilson(k: number, n: number): string {
  const { p, low, high } = wilson(k, n);
  return `${pct(p)} (n=${n}, 95% CI ${pct(low)}-${pct(high)})`;
}

// ─── Measurement 1: deal concentration, before any exchange ────────────────

function measureDealConcentration(playerCount: number, n: number, seed: number) {
  const perSeat: number[] = [];
  const histogramOfMax = new Map<number, number>();
  let allSixOneSeat = 0;
  let maxAtLeastFour = 0;

  for (let i = 0; i < n; i++) {
    const { hands } = withSeededDeals(seed * 7919 + i, () => dealCards(playerCount));
    const counts = hands.map((h) => h.filter(isTopCard).length);
    for (const c of counts) perSeat.push(c);
    const max = Math.max(...counts);
    histogramOfMax.set(max, (histogramOfMax.get(max) ?? 0) + 1);
    if (max === 6) allSixOneSeat++;
    if (max >= 4) maxAtLeastFour++;
  }

  return {
    playerCount,
    n,
    meanPerSeat: mean(perSeat),
    stdevPerSeat: stdev(perSeat),
    histogramOfMax,
    allSixOneSeat,
    maxAtLeastFour,
  };
}

// ─── Shared match running ───────────────────────────────────────────────────

function tableOf(playerCount: number, personalities?: (BotPersonalityId | undefined)[]): OfflinePlayerSetup[] {
  return Array.from({ length: playerCount }, (_, i) => ({
    name: `Bot${i}`,
    type: "ai" as const,
    personality: personalities?.[i],
  }));
}

function runMatches(
  players: OfflinePlayerSetup[],
  n: number,
  seedBase: number
): SimulateMatchResult[] {
  const results: SimulateMatchResult[] = [];
  for (let i = 0; i < n; i++) {
    results.push(
      simulateOfflineMatch({
        seed: seedBase + i,
        players,
        gameMode: "free_for_all",
        length: "match",
        // See the file banner: this is what makes the AI's aggression/
        // unpredictability knobs, not just the deal, reproducible from `seed`.
        aiRng: (s) => mulberry32(s + 1),
      })
    );
  }
  return results;
}

function seatOfWinner(engineId: string): number {
  return Number(engineId.split("_")[1]);
}

// ─── Measurements 2 & 3: exchange compounding and the winner streak ───────

interface CompoundingAndStreak {
  manche0TopCards: number[][];
  deltaByMancheIndex: Map<number, number[]>;
  streakRepeats: number;
  streakTransitions: number;
}

/**
 * `results` all come from symmetric tables (every seat the same personality),
 * so any measured skew is the format's own mechanics, not a personality gap.
 */
function measureCompoundingAndStreak(results: SimulateMatchResult[], playerCount: number): CompoundingAndStreak {
  const manche0TopCards: number[][] = [];
  const deltaByMancheIndex = new Map<number, number[]>();
  let streakRepeats = 0;
  let streakTransitions = 0;

  for (const r of results) {
    for (let i = 0; i < r.manches.length; i++) {
      const m = r.manches[i];
      if (i === 0) {
        manche0TopCards.push(m.topCardCounts);
      } else if (playerCount === 2) {
        const prevWinnerSeat = seatOfWinner(r.manches[i - 1].rankings[0]);
        const otherSeat = prevWinnerSeat === 0 ? 1 : 0;
        const delta = m.topCardCounts[prevWinnerSeat] - m.topCardCounts[otherSeat];
        const bucket = deltaByMancheIndex.get(i) ?? [];
        bucket.push(delta);
        deltaByMancheIndex.set(i, bucket);
      }

      if (i > 0) {
        streakTransitions++;
        if (seatOfWinner(m.rankings[0]) === seatOfWinner(r.manches[i - 1].rankings[0])) {
          streakRepeats++;
        }
      }
    }
  }

  return { manche0TopCards, deltaByMancheIndex, streakRepeats, streakTransitions };
}

// ─── Measurement 4: win rate per personality, bot vs bot at two seats ─────

interface PersonalityRow {
  personality: BotPersonalityId;
  wins: number;
  losses: number;
  draws: number;
  n: number;
}

/** Each personality as seat 0, `DEFAULT_BOT_PERSONALITY` as seat 1 — the
 * matchup the owner's report actually played (one human, one default bot),
 * with the human side replaced by every named personality in turn so
 * `drita`'s own row is also this loop's symmetric control. */
function measurePersonalityVsDefault(n: number, seed: number): PersonalityRow[] {
  return BOT_PERSONALITIES.map((personality, idx) => {
    const players = tableOf(2, [personality.id, DEFAULT_BOT_PERSONALITY]);
    const results = runMatches(players, n, seed * 4102541 + idx * 1_000_000);
    let wins = 0;
    let losses = 0;
    let draws = 0;
    for (const r of results) {
      if (r.isDraw) draws++;
      else if (r.winners.includes("player_0")) wins++;
      else losses++;
    }
    return { personality: personality.id, wins, losses, draws, n };
  });
}

// ─── Report ──────────────────────────────────────────────────────────────

function printHistogram(histogram: Map<number, number>, n: number, maxKey: number): void {
  for (let k = 0; k <= maxKey; k++) {
    const count = histogram.get(k) ?? 0;
    console.log(`      ${k}: ${pct(count / n)} (${count})`);
  }
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  console.log(`#839 heads-up balance measurement — seed ${opts.seed}\n`);

  // ── Measurement 1 ──────────────────────────────────────────────────────
  console.log("## 1. Top-card concentration in the deal, before any exchange\n");
  console.log("Top cards = the four 2s and two Jokers (six of 54). At 2 seats dealCards(2)");
  console.log("excludes 26 of the 54 — some top cards may not reach either hand at all; at");
  console.log("4 seats the whole deck is dealt, so all six always land somewhere.\n");
  for (const playerCount of [2, 4]) {
    const d = measureDealConcentration(playerCount, opts.dealN, opts.seed);
    console.log(`${playerCount}-seat deal (n=${d.n} deals):`);
    console.log(`  mean top cards per hand: ${d.meanPerSeat.toFixed(3)} (stdev ${d.stdevPerSeat.toFixed(3)})`);
    console.log(`  P(some seat holds >= 4 of the 6): ${fmtWilson(d.maxAtLeastFour, d.n)}`);
    console.log(`  P(some seat holds all 6): ${fmtWilson(d.allSixOneSeat, d.n)}`);
    console.log(`  distribution of the single most-loaded seat's count:`);
    printHistogram(d.histogramOfMax, d.n, 6);
    console.log("");
  }

  // ── Measurements 2 & 3 ─────────────────────────────────────────────────
  console.log("## 2 & 3. Exchange compounding and the manche-winner streak\n");
  console.log(`Symmetric tables (every seat on ${DEFAULT_BOT_PERSONALITY}), so any skew found is the`);
  console.log("format's own mechanics, not a personality gap (that is measurement 4).\n");

  const results2p = runMatches(tableOf(2), opts.matchN2p, opts.seed * 104729);
  const cs2p = measureCompoundingAndStreak(results2p, 2);

  const manche0Pooled = cs2p.manche0TopCards.flat();
  console.log(`2-seat matches (n=${results2p.length}):`);
  console.log(
    `  manche 0 (no exchange yet) top-card count per hand: mean ${mean(manche0Pooled).toFixed(3)} ` +
      `(stdev ${stdev(manche0Pooled).toFixed(3)}) — cross-check against measurement 1's 2-seat figure above.`
  );
  console.log("  reigning winner's top-card edge over the other seat, by manche index (post-exchange):");
  const indices = [...cs2p.deltaByMancheIndex.keys()].sort((a, b) => a - b);
  for (const i of indices.slice(0, 12)) {
    const deltas = cs2p.deltaByMancheIndex.get(i)!;
    console.log(`    manche ${i}: mean delta ${mean(deltas).toFixed(3)} (n=${deltas.length})`);
  }
  if (indices.length > 12) {
    const tail = indices.slice(12).flatMap((i) => cs2p.deltaByMancheIndex.get(i)!);
    console.log(`    manche 12+: mean delta ${mean(tail).toFixed(3)} (n=${tail.length}, pooled)`);
  }
  console.log(
    `  P(manche winner also wins the next manche): ${fmtWilson(cs2p.streakRepeats, cs2p.streakTransitions)}\n`
  );

  const results4p = runMatches(tableOf(4), opts.matchN4p, opts.seed * 15485863);
  const cs4p = measureCompoundingAndStreak(results4p, 4);
  console.log(`4-seat matches (n=${results4p.length}):`);
  console.log(
    `  P(manche winner also wins the next manche): ${fmtWilson(cs4p.streakRepeats, cs4p.streakTransitions)}`
  );
  console.log("  (memoryless baseline: 50% at 2 seats, 25% at 4 seats)\n");

  // ── Measurement 4 ───────────────────────────────────────────────────────
  console.log("## 4. Win rate per personality at two seats, bot vs bot\n");
  console.log(`Each personality as seat 0 against DEFAULT_BOT_PERSONALITY ("${DEFAULT_BOT_PERSONALITY}") as`);
  console.log(`seat 1 — "${DEFAULT_BOT_PERSONALITY}" vs "${DEFAULT_BOT_PERSONALITY}" is therefore also this table's own symmetric control.\n`);
  const personalityRows = measurePersonalityVsDefault(opts.personalityN, opts.seed);
  for (const row of personalityRows) {
    console.log(
      `  ${row.personality.padEnd(8)} vs ${DEFAULT_BOT_PERSONALITY}: wins ${fmtWilson(row.wins, row.n)}` +
        (row.draws > 0 ? ` (${row.draws} draws)` : "")
    );
  }

  console.log(`\nDone in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`);
}

// Only when run directly, matching tests/soak/soak.ts's own guard.
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  main();
}
