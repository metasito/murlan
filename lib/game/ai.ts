// Bot heuristics. `lib/game/autoMove.ts` is the only module that calls into this one
// (`tests/engine/matchState.test.ts`); relative imports for the same reason it gives.
import { getBotPersonality } from "./botPersonalities.ts";
import {
  cardStrength,
  DECK_BY_STRENGTH,
  emptyRankTally,
  getAllValidPlays,
  getRankStrength,
  RANK_SLOTS,
  teamForSeat,
} from "./gameEngine.ts";
import type {
  AIDifficulty,
  Card,
  Combination,
  ExchangePhase,
  GameState,
  Player,
} from "./gameEngine.ts";

/**
 * How many cards stronger than `strength` are neither played nor in `myHand` —
 * that is, how many could still beat it in someone else's hand.
 *
 * At two seats twenty-six cards are never dealt (`dealCards` excludes them), so they
 * are counted here as outstanding. That errs towards caution — the bot may hold
 * back a card that was actually unbeatable — and never towards over-confidence,
 * which is the only direction that loses a hand it should have won.
 *
 * An absent `played` means nothing is known to have been played, which is what a
 * state rehydrated from before the tally existed must look like.
 */
export function outstandingAbove(
  strength: number,
  played: number[] | undefined,
  myHand: Card[]
): number {
  const out = outstandingTally(played, myHand);
  let total = 0;
  for (let i = strength + 1; i < RANK_SLOTS; i++) total += out[i];
  return total;
}

/** How many of each rank are neither played nor in `myHand`. */
function outstandingTally(played: number[] | undefined, myHand: Card[]): number[] {
  const mine = emptyRankTally();
  for (const card of myHand) mine[getRankStrength(card.rank)] += 1;
  return DECK_BY_STRENGTH.map((total, i) =>
    Math.max(0, total - (played?.[i] ?? 0) - mine[i])
  );
}

/**
 * Whether four of some rank are still unaccounted for, so an opponent could be
 * holding a bomb.
 *
 * `docs/GAME-RULES.md` §7.2: a bomb beats any single, pair, triple or straight of any
 * size, at any time — including a joker played as a single. So rank alone never
 * makes a card safe, and this is the half a tally can still answer exactly.
 */
export function bombPossible(played: number[] | undefined, myHand: Card[]): boolean {
  const out = outstandingTally(played, myHand);
  return out.some((n, i) => DECK_BY_STRENGTH[i] === 4 && n === 4);
}

function scorePlayForDump(play: Combination): number {
  const cardCount = play.cards.length;
  const hasHighCards = play.cards.some((c) => c.rank === "2" || c.isJoker);
  const avgStrength = play.strength / Math.max(cardCount, 1);
  return cardCount * 3 - avgStrength * 0.3 - (hasHighCards ? 5 : 0);
}

/** Spends a card worth hoarding: a 2, a joker, or a whole bomb. */
function isPremiumPlay(play: Combination): boolean {
  return (
    play.type === "bomb" ||
    play.type === "royal_straight" ||
    play.cards.some((c) => c.rank === "2" || c.isJoker)
  );
}

/**
 * The play to make when hoarding: shedding as many cards as possible on a
 * lead, answering as cheaply as possible otherwise. `null` when every legal
 * play is premium.
 */
function cheapestPlain(plays: Combination[], isNewRound: boolean): Combination | null {
  const plain = plays.filter((p) => !isPremiumPlay(p));
  if (plain.length === 0) return null;
  return [...plain].sort(
    isNewRound
      ? (a, b) => b.cards.length - a.cards.length || a.strength - b.strength
      : (a, b) => a.strength - b.strength
  )[0];
}

/**
 * Applies a personality's two knobs to the strategy tier's choice. Both only
 * re-rank plays the tier already had in hand, so nothing here can produce an
 * illegal play — `plays` is `getAllValidPlays`' output, untouched.
 */
export function applyPersonality(
  choice: Combination | null,
  plays: Combination[],
  isNewRound: boolean,
  traits: { aggression: number; unpredictability: number; difficulty: AIDifficulty },
  rng: () => number
): Combination | null {
  let result = choice;

  if (result === null) {
    // The tier would pass. An aggressive personality contests the round instead.
    // Leading a round is never a pass, so this only ever runs when responding.
    if (!isNewRound && rng() < traits.aggression) {
      // Strength only compares within a shape, so answer in kind before
      // reaching for a bomb — the tier's emergency branch owns those.
      const inKind = plays.filter((p) => p.type !== "bomb" && p.type !== "royal_straight");
      const pool = inKind.length > 0 ? inKind : plays;
      const plain = pool.filter((p) => !isPremiumPlay(p));
      result = [...(plain.length > 0 ? plain : pool)].sort((a, b) => a.strength - b.strength)[0] ?? null;
    }
  } else if (isPremiumPlay(result) && rng() >= traits.aggression) {
    result = cheapestPlain(plays, isNewRound) ?? result;
  }

  if (result && rng() < traits.unpredictability) {
    const self = result;
    const alts = plays.filter(
      (p) => p !== self && p.type === self.type && p.cards.length === self.cards.length
    );
    if (alts.length > 0) {
      result = alts[Math.min(alts.length - 1, Math.floor(rng() * alts.length))];
    }
  }

  // Last, below the unpredictability knob: that knob swaps a play for a
  // same-shape alternative, premium ones included, so a floor placed any
  // earlier is overwritten by it.
  if (traits.difficulty === "hard" && result && isPremiumPlay(result)) {
    result = cheapestPlain(plays, isNewRound) ?? result;
  }

  return result;
}

/** The seat across the table, or `undefined` in any game without teams. */
function partnerSeat(state: GameState, seat: number): number | undefined {
  const count = state.players.length;
  const team = teamForSeat(seat, count, state.gameMode);
  if (team === undefined) return undefined;
  const partner = state.players.findIndex(
    (_, i) => i !== seat && teamForSeat(i, count, state.gameMode) === team
  );
  return partner === -1 ? undefined : partner;
}

/** What a bot at `seat` is allowed to read about the rest of the table. */
export function opponentsOf(
  state: GameState,
  seat: number
): { handCounts: number[]; partnerHoldsTop: boolean } {
  const partner = partnerSeat(state, seat);
  const handCounts = state.players
    .filter((_, i) => i !== seat && i !== partner)
    .map((p) => p.hand.length);
  return {
    // `Math.min()` of nothing is Infinity, which reads as "no one is close".
    handCounts: handCounts.length > 0 ? handCounts : [0],
    // Two things stop "my partner played last" from meaning "my partner holds
    // the round": `lastPlayedBy` still names the winner once everyone has
    // passed, and `processPass` gives the lead to the next seat *still holding
    // cards*, so a partner who has gone out would hand it to an opponent.
    partnerHoldsTop:
      partner !== undefined &&
      state.lastPlayedBy === partner &&
      state.lastPlayedCombination !== null &&
      (state.players[partner]?.hand.length ?? 0) > 0,
  };
}

/**
 * The one card the exchange reveals to the loser: its own former best,
 * which the winner now holds. Winner-side knowledge (what it gave back) is
 * deliberately not surfaced — a bot's own giveback is always its weakest
 * eligible card (`pickGivebackCard`), so the winner can never hold anything
 * weaker than it; a floor built on that fact would never fire. Nobody
 * outside the exchange is party to this, and the both-jokers exception
 * moves no card at all (docs/GAME-RULES.md §10), so the loser learns nothing
 * then either.
 */
export function knownOpponentExchangeCard(
  exchangePhase: ExchangePhase | undefined,
  seat: number
): Card | undefined {
  if (!exchangePhase || exchangePhase.bothJokersException) return undefined;
  if (seat !== exchangePhase.loserIdx) return undefined;
  return exchangePhase.cardFromLoser;
}

/** Whether leading `play`'s single card loses outright to `known`. */
export function losesLeadToExchangeCard(play: Combination, known: Card): boolean {
  return play.cards.length === 1 && cardStrength(play.cards[0]) < cardStrength(known);
}

// Same tally `outstandingAbove` reads above, at the card's own rank: same
// caution (a suit undealt at two seats reads as "still out"), never the
// reverse.
export function isExchangeCardStillOut(
  card: Card,
  playedRanks: number[] | undefined,
  hand: Card[]
): boolean {
  return outstandingTally(playedRanks, hand)[cardStrength(card)] > 0;
}

/**
 * The AI's move for `player`, or null to pass. `rng` is a parameter so that
 * personalities can vary their play without making the engine untestable —
 * tests inject a fixed sequence and stay deterministic.
 */
export function aiChoosePlay(
  player: Player,
  lastPlayed: Combination | null,
  isNewRound: boolean,
  otherPlayersHandCount: number[],
  requireCard?: Card,
  rng: () => number = Math.random,
  partnerHoldsTop = false,
  playedRanks?: number[],
  knownOpponentCard?: Card
): Combination | null {
  const plays = getAllValidPlays(player.hand, lastPlayed, isNewRound, requireCard);
  if (plays.length === 0) return null;

  const personality = getBotPersonality(player.personality);
  const diff = personality.difficulty;
  const myCards = player.hand.length;
  const minOpponent = Math.min(...otherPlayersHandCount);

  const knownCard =
    knownOpponentCard && isExchangeCardStillOut(knownOpponentCard, playedRanks, player.hand)
      ? knownOpponentCard
      : undefined;

  // Every tier's floor (#907): never lead into a known, still-live loss when
  // a lead without that problem is legal. Only bears on a lead: a response
  // is not "leading into" anything.
  const safeLeads = knownCard && isNewRound ? plays.filter((p) => !losesLeadToExchangeCard(p, knownCard)) : [];
  const leadPlays = isNewRound && safeLeads.length > 0 ? safeLeads : plays;

  /**
   * Whether leading this card takes the round on everything a tally can see:
   * no higher card is outstanding, and no rank is missing all four, so no
   * opponent can be holding a bomb (`docs/GAME-RULES.md` §7.2 — a bomb beats any
   * single, joker included).
   *
   * Singles only. A multi-card shape is also beaten by a higher shape of its
   * own size, which a rank tally cannot rule out.
   *
   * The one thing ranks cannot exclude is a royal straight, which needs five
   * consecutive cards of a single suit and so turns on suits this tally
   * deliberately does not hold. That is the residual risk, and it is a cheap
   * one: it is the strongest hand in the game (§7.4), so drawing one out to
   * answer a single card is a trade worth inducing.
   */
  const takesTheRound = (play: Combination) =>
    play.cards.length === 1 &&
    outstandingAbove(cardStrength(play.cards[0]), playedRanks, player.hand) === 0 &&
    !bombPossible(playedRanks, player.hand);

  // Universal: if this play empties the hand, always do it. No personality
  // declines to win, so this returns before the knobs are applied.
  const finishingPlays = plays.filter((p) => p.cards.length === myCards);
  if (finishingPlays.length > 0) {
    return finishingPlays[0];
  }

  // Beating the partner takes the round off the team that already had it, so
  // no tier answers and no knob contests. Below the finishing branch on
  // purpose: emptying the hand ends the manche in the team's favour, which is
  // not contesting anything. A new round cannot be passed at all.
  if (partnerHoldsTop && !isNewRound) return null;

  const withPersonality = (choice: Combination | null) =>
    applyPersonality(choice, leadPlays, isNewRound, personality, rng);

  if (diff === "easy") {
    return withPersonality([...leadPlays].sort((a, b) => a.strength - b.strength)[0]);
  }

  // A lead nothing left can answer takes the round for free, so holding it back
  // wins nothing and costs the lead. Cheapest such card first — the point is to
  // take the round, not to spend the best card doing it. Above the knobs
  // deliberately: aggression and unpredictability exist to colour a judgement
  // call, and this is as close to a counted one as the tally gets.
  if (isNewRound) {
    const certain = leadPlays.filter(takesTheRound);
    if (certain.length > 0) {
      return certain.sort((a, b) => a.strength - b.strength)[0];
    }
  }

  const bombs = leadPlays.filter(
    (p) => p.type === "bomb" || p.type === "royal_straight"
  );
  const normal = leadPlays.filter(
    (p) => p.type !== "bomb" && p.type !== "royal_straight"
  );

  if (diff === "medium") {
    const pool = normal.length > 0 ? normal : bombs;
    if (isNewRound && myCards > 8 && normal.length > 0) {
      const multi = normal.filter((p) => p.cards.length >= 2);
      if (multi.length > 0)
        return withPersonality(
          multi.sort((a, b) => b.cards.length - a.cards.length || a.strength - b.strength)[0]
        );
    }
    return withPersonality(pool.sort((a, b) => a.strength - b.strength)[0]);
  }

  // ── Hard AI ──────────────────────────────────────────────────────────────
  const conservative = normal.filter(
    (p) => !p.cards.some((c) => c.rank === "2" || c.isJoker)
  );
  const withHighCards = normal.filter((p) =>
    p.cards.some((c) => c.rank === "2" || c.isJoker)
  );

  // Emergency: opponent about to finish — use lowest bomb immediately. The one
  // decision no personality softens, or a cautious bot hoards a bomb into a loss.
  if (minOpponent <= 1 && !isNewRound && bombs.length > 0) {
    return bombs.sort((a, b) => a.strength - b.strength)[0];
  }

  if (isNewRound) {
    const near3 = leadPlays.filter((p) => p.cards.length >= myCards - 2);
    if (near3.length > 0)
      return withPersonality(near3.sort((a, b) => b.cards.length - a.cards.length)[0]);

    const candidates = conservative.length > 0 ? conservative : normal.length > 0 ? normal : bombs;
    if (candidates.length > 0)
      return withPersonality(candidates.sort((a, b) => scorePlayForDump(b) - scorePlayForDump(a))[0]);

    return withPersonality([...leadPlays].sort((a, b) => scorePlayForDump(b) - scorePlayForDump(a))[0]);
  }

  if (myCards <= 4 && normal.length > 0) {
    return withPersonality(normal.sort((a, b) => a.strength - b.strength)[0]);
  }

  if (conservative.length > 0) {
    return withPersonality(conservative.sort((a, b) => a.strength - b.strength)[0]);
  }

  if ((myCards <= 6 || minOpponent <= 3) && withHighCards.length > 0) {
    return withPersonality(withHighCards.sort((a, b) => a.strength - b.strength)[0]);
  }

  if (minOpponent <= 3 && bombs.length > 0) {
    return withPersonality(bombs.sort((a, b) => a.strength - b.strength)[0]);
  }

  return withPersonality(null);
}
