// Pure helpers used by the server's game and socket modules, kept here so a test can reach them
// without pulling storage/db/session onto a path that needs none of it.
import { botSeatKey, isBotSeatKey } from "../../lib/game/botSeat.ts";
import type { ScoreLine, WireExchangePhase } from "../../shared/protocol.ts";
import { botSeatNames, getBotPersonality } from "../../lib/game/botPersonalities.ts";
import type { BotPersonalityId } from "../../lib/game/botPersonalities.ts";
import { foldRound } from "../../lib/game/gameEngine.ts";
import type { ExchangePhase, GameState, GameMode, MatchLength, SeatScoring } from "../../lib/game/gameEngine.ts";
import type { GameResult } from "../../lib/achievements.ts";
import { exchangeAnnounceMs } from "../../lib/timeline/exchangeTimeline.ts";

import type { RoundFlags } from "../../shared/persistedEnvelope.ts";

/** The seat a given user occupies, or null if they are not seated at all. */
export function seatOfUser(
  playerMap: Readonly<Record<number, string>>,
  userId: string
): number | null {
  const entry = Object.entries(playerMap).find(([, uid]) => uid === userId);
  return entry ? Number(entry[0]) : null;
}

/**
 * The key a seat's score accumulates under: the seated userId, or the
 * `bot:<seat>` sentinel for a seat vacated to a bot.
 */
export function scoreKeyForSeat(
  playerMap: Readonly<Record<number, string>>,
  seat: number
): string {
  return playerMap[seat] ?? botSeatKey(seat);
}

/**
 * A seat's cumulative total, merging a departed player's frozen row with
 * the bot's own — the one shared resolver every reader of `cumulativeScores`
 * goes through, so a seat's total cannot be computed one way here and
 * another way there.
 */
export function seatTotal(
  cumulativeScores: Readonly<Record<string, number>>,
  playerMap: Readonly<Record<number, string>>,
  vacatedSeats: ReadonlyMap<number, { userId: string; username: string }>,
  seat: number
): number {
  const key = scoreKeyForSeat(playerMap, seat);
  const vacated = vacatedSeats.get(seat);
  return vacated
    ? (cumulativeScores[vacated.userId] ?? 0) + (cumulativeScores[key] ?? 0)
    : (cumulativeScores[key] ?? 0);
}

/**
 * Whether the ceremony that reads `cardToLoser` is still on screen. An
 * unstamped closed phase reads as over: with no window to be inside, a seat
 * that never watched the exchange cross is told nothing.
 *
 * The window has to outlast `STATE_ACK_TIMEOUT_MS`, because `sendGameStateTo`
 * owes one resend to a client that never acknowledged the settle and that
 * resend re-derives from live state — answering it after the window would hand
 * over half an exchange, which `exchangeAnnouncementOf` raises as a one-legged
 * ceremony rather than refusing. That ordering is
 * asserted in `tests/server/exchangeVisibility.test.ts` rather than added to the window
 * here, so the two clocks stay independent of each other.
 */
function ceremonyRunning(phase: Extract<ExchangePhase, { kind: "settled" }>, now: number): boolean {
  if (phase.settledAt === undefined) return false;
  return now - phase.settledAt < settledCeremonyMs();
}

/** How long a giveback's ceremony runs: the window above, and the wait before the next seat moves. */
export function settledCeremonyMs(): number {
  return exchangeAnnounceMs(false);
}

/**
 * Stamps `settledAt`, on the state itself so it rides the persisted phase.
 *
 * `publishState` is the caller rather than each of the three places a
 * phase closes: a settle nobody broadcasts is not one any seat can be shown,
 * and one funnel cannot be half-updated the way three call sites can. That
 * wiring is pinned by `tests/server/exchangeVisibility.test.ts`.
 */
export function markExchangeSettled(phase: ExchangePhase | undefined, now: number): void {
  if (phase?.kind === "settled") phase.settledAt ??= now;
}

/**
 * The part of an exchange phase a given seat is allowed to see.
 *
 * `cardFromLoser` goes to the whole table while the phase is open. It is not a
 * secret to withhold: `docs/GAME-RULES.md` §10.1 makes it compulsory and automatic —
 * the loser's single highest card — so any seat derives it from the rules alone,
 * and #602 needs it on the felt for every seat. It stops being sent once the
 * phase closes, when there is nothing left to read it for.
 *
 * `cardToLoser` is the opposite: a card the winner *chose* out of their own
 * hand, which no rule determines, so while the phase is open sending it would
 * leak that hand. Closing the phase lifts that, but only for as long as the
 * ceremony is on screen — `exchangePhase` is never cleared, so the phase's own
 * flag would keep the card public for the rest of the round. The two
 * participants keep it either way: it came out of one's hand into the other's.
 *
 * Every seat also gets the phase's kind and the two seat indices — all the
 * announcement banner reads from them.
 */
export function visibleExchangePhase(
  phase: ExchangePhase | undefined,
  viewerSeatIndex: number | null,
  now: number
): WireExchangePhase | undefined {
  if (!phase) return undefined;
  const { winnerIdx, loserIdx } = phase;
  switch (phase.kind) {
    case "twoJokers":
      return { kind: "twoJokers", winnerIdx, loserIdx };
    case "open":
      return { kind: "open", winnerIdx, loserIdx, cardFromLoser: phase.cardFromLoser };
    case "settled": {
      const isParticipant = viewerSeatIndex === winnerIdx || viewerSeatIndex === loserIdx;
      const { cardToLoser } = phase;
      return cardToLoser && (isParticipant || ceremonyRunning(phase, now))
        ? { kind: "settled", winnerIdx, loserIdx, cardToLoser }
        : { kind: "settled", winnerIdx, loserIdx };
    }
  }
}

/**
 * True when a table was contested by enough real people to record in stats,
 * history and achievements. About what gets *recorded*, never what is allowed:
 * one human plus bots stays fully playable.
 *
 * The line is bot *majority* — an even split (1v1, 2v2) still counts. Seats
 * vacated mid-match count as bots, so having friends leave is not a route to
 * free points.
 */
export function isContestedTable(humanSeats: number, botSeats: number): boolean {
  return botSeats <= humanSeats;
}


export interface SeatEntry {
  seatIndex: number;
  userId: string;      // for bots, `botSeatKey(seat)`
  username: string;
  isBot: boolean;
  personality?: BotPersonalityId;
}

/**
 * The full seat roster a match starts with: the seated humans, plus — when
 * `fillWithBots` is requested — a bot seat for every gap up to `maxPlayers`.
 *
 * Pure function so room:start's seat-assignment logic (which of the humans
 * plus bots occupies which engine seat) is unit-testable without spinning up
 * a socket server. server/socket/socket.ts imports this rather than reimplementing
 * it, so tests exercise the exact code path the server runs.
 */
export function buildSeatRoster(
  humans: { seatIndex: number; userId: string; username: string }[],
  maxPlayers: number,
  opts: { fillWithBots?: boolean; botPersonality?: string }
): SeatEntry[] {
  const roster: SeatEntry[] = humans
    .map((h) => ({ ...h, isBot: false }))
    .sort((a, b) => a.seatIndex - b.seatIndex);
  if (!opts.fillWithBots) return roster;

  const taken = new Set(roster.map((r) => r.seatIndex));
  const personality = getBotPersonality(opts.botPersonality).id;
  const emptySeats = Array.from({ length: maxPlayers }, (_, s) => s).filter((s) => !taken.has(s));
  const names = botSeatNames(emptySeats.map(() => personality));

  emptySeats.forEach((seat, i) => {
    const username = names[i];
    if (username === undefined) {
      throw new Error(`botSeatNames returned ${names.length} names for ${emptySeats.length} seats`);
    }
    roster.push({
      seatIndex: seat,
      userId: botSeatKey(seat),
      username,
      isBot: true,
      personality,
    });
  });
  return roster.sort((a, b) => a.seatIndex - b.seatIndex);
}

/**
 * The two engine-seat-indexed maps a match starts from: which seat a human
 * holds, and which seats were dealt to a bot before anyone could vacate one.
 * Keyed by position in `roster`, not `r.seatIndex` — that position is the
 * engine seat index (`startRound` assigns seats the same way), so a gap
 * in the DB's own seat numbering cannot shift either map onto the wrong
 * player. `tableState.ts` `newTable` calls this rather than walking the roster
 * inline, so a test can drive the same function it does.
 */
export function seatAssignmentsFromRoster(roster: SeatEntry[]): {
  playerMap: Record<number, string>;
  botSeatsAtStart: Set<number>;
} {
  const humanSeats: Record<number, string> = {};
  const botSeatsAtStart = new Set<number>();
  roster.forEach((r, idx) => {
    if (r.isBot) botSeatsAtStart.add(idx);
    else humanSeats[idx] = r.userId;
  });
  return { playerMap: humanSeats, botSeatsAtStart };
}

/**
 * `botSeatsAtStart`, read back from a restored game rather than a fresh
 * roster. `personality` is set once, at `seatAssignmentsFromRoster` time, for
 * a born-bot seat only — `vacateSeat` flips a human seat to a bot without ever
 * setting it — and rides every round's persisted envelope after that, so it
 * survives a restart the roster itself does not.
 */
export function botSeatsFromPersonality(players: readonly { personality?: BotPersonalityId }[]): Set<number> {
  const seats = new Set<number>();
  players.forEach((p, seat) => {
    if (p.personality !== undefined) seats.add(seat);
  });
  return seats;
}

export interface ResolveRoundEndInput {
  state: GameState;
  playerMap: Readonly<Record<number, string>>;
  cumulativeScores: Readonly<Record<string, number>>;
  matchTarget: number;
  matchLength: MatchLength;
  gameMode: GameMode;
  roundFlags: RoundFlags;
  /** seat -> the userId who walked out on the round still holding cards. */
  abandonedSeats: ReadonlyMap<number, string>;
  /**
   * Seats dealt to a bot when this match's roster was built — never a human's
   * seat this match, unlike one `playerMap` merely no longer names. Defaults
   * to none, which treats every bot seat as a vacated one (the conservative
   * answer for a caller that does not know the difference) for win eligibility.
   */
  botSeatsAtStart?: Set<number>;
  /**
   * Seats a human has left this match, by seat — set at vacate and never
   * cleared while the seat stays open, so a departed player's row can be
   * found across rounds even once `playerMap` has forgotten them. Defaults to
   * none.
   */
  vacatedSeats?: ReadonlyMap<number, { userId: string; username: string }>;
}

export interface ResolveRoundEndResult {
  roundByKey: Record<string, number>;
  cumulativeScores: Record<string, number>;
  matchOver: boolean;
  matchTarget: number;
  matchWinners: string[];
  isDraw: boolean;
  detailed: ScoreLine[];
  /** The match winners as engine player ids — the space `finishingOrder` is in. */
  winnerEngineIds: string[];
  gameResults: GameResult[];
  /** Whether the table was contested by enough real people to record. */
  recordable: boolean;
}

/**
 * How each seat scores online: under its seated userId, or `bot:<seat>` once its human left. A seat
 * becomes a bot scoring exactly as one born a bot (docs/GAME-RULES.md § Decisions, the disconnect
 * policy), but only a born bot's key may be crowned — never a seat a human left — and a departed
 * player's frozen row still counts for the seat's team.
 */
export function seatScoringOf(
  game: Pick<ResolveRoundEndInput, "state" | "playerMap" | "botSeatsAtStart" | "vacatedSeats">
): SeatScoring[] {
  const botSeatsAtStart = game.botSeatsAtStart ?? new Set<number>();
  return game.state.players.map((p, seat) => {
    const key = scoreKeyForSeat(game.playerMap, seat);
    return {
      engineId: p.id,
      key,
      team: p.team,
      crownable: !isBotSeatKey(key) || botSeatsAtStart.has(seat),
      frozenKey: game.vacatedSeats?.get(seat)?.userId,
    };
  });
}

/**
 * Everything a round's end decides: the per-round and cumulative scoreboard,
 * whether the match is over (or escalates to a new target), who won, and the
 * per-seat results stats/ratings/replays read from. Pure — server/socket/socket.ts
 * `handleRoundOver` is left owning the broadcast, persistence and the actual
 * (fire-and-forget) stats/ratings/replay writes.
 */
export function resolveRoundEnd(input: ResolveRoundEndInput): ResolveRoundEndResult {
  const { state, playerMap, matchLength, gameMode, roundFlags, abandonedSeats } = input;
  const vacatedSeats = input.vacatedSeats ?? new Map<number, { userId: string; username: string }>();

  const seatOfEngineId = new Map<string, number>();
  state.players.forEach((p, idx) => seatOfEngineId.set(p.id, idx));

  const {
    roundByKey,
    cumulative: cumulativeScores,
    over: matchOver,
    target: matchTarget,
    winners: matchWinners,
    isDraw,
  } = foldRound(
    {
      finishingOrder: state.finishingOrder,
      playerCount: state.players.length,
      gameMode,
      length: matchLength,
    },
    { cumulative: input.cumulativeScores, target: input.matchTarget },
    seatScoringOf(input)
  );

  // One row per seat, carrying every identity the clients index it by. It was
  // once also sent as a name -> total map alongside; two seats sharing a name
  // collapsed into one entry there, silently.
  const detailed: ScoreLine[] = state.players.map((p, seat) => {
    const key = scoreKeyForSeat(playerMap, seat);
    const vacated = vacatedSeats.get(seat);
    const total = seatTotal(cumulativeScores, playerMap, vacatedSeats, seat);
    return {
      seatIndex: seat,
      engineId: p.id,
      userId: vacated?.userId ?? playerMap[seat] ?? null,
      username: p.name,
      points: roundByKey[key] ?? 0,
      total,
      vacated: vacated !== undefined,
    };
  });

  const winnerEngineIds = matchWinners
    .map((key) => detailed.find((d) => scoreKeyForSeat(playerMap, d.seatIndex) === key)?.engineId)
    .filter((id): id is string => id !== undefined);

  // Every seat carries a placement by the time a round ends — the engine fills
  // the remaining positions for anyone still holding cards, in both modes —
  // so every seated player is represented in `gameResults` and counted
  // toward `roundsPlayed`, not just the ones who actually emptied their hand.
  const playerCount = state.players.length;
  // How many seats actually emptied their hand this round, read straight off
  // the final state rather than inferred from the mode: a seat that was
  // auto-assigned its position while still holding cards never "finished",
  // and must not be counted as one of anyone's finished opponents.
  const realFinisherCount = state.players.filter((p) => p.hand.length === 0).length;

  // Placements are handed out from one explicit total order, not from each
  // seat's own index in `state.finishingOrder`: the seats that played the round out
  // in finishing order, then the abandoned ones behind them, finishing order kept
  // within each group so several walkouts fill the last slots stably. That is
  // what makes an abandonment genuinely last (docs/GAME-RULES.md § Decisions) while every
  // placement stays distinct — lib/game/rating.ts renumbers the human seats 1..n
  // by sorting on placement, so two seats sharing one would rate a quitter
  // ahead of a player who stayed to the end.
  const rankedSeats = state.finishingOrder
    .map((engineId) => seatOfEngineId.get(engineId))
    .filter((seat): seat is number => seat !== undefined);
  const orderedSeats = [
    ...rankedSeats.filter((seat) => !abandonedSeats.has(seat)),
    ...rankedSeats.filter((seat) => abandonedSeats.has(seat)),
  ];

  const gameResults: GameResult[] = orderedSeats.map((seat, idx) => {
    // A seat someone walked out on is that person's result, not a bot's:
    // keyed by the userId who left, since `bot:<seat>` is filtered out of
    // every write that reads this.
    const abandonedBy = abandonedSeats.get(seat);
    const key = abandonedBy ?? scoreKeyForSeat(playerMap, seat);
    const flags = roundFlags[seat] ?? { bomb: false, joker: false };
    const seatPlayer = state.players[seat];
    if (!seatPlayer) throw new Error(`onlineGameLogic: no player at seat ${seat}`);
    const emptiedOwnHand = seatPlayer.hand.length === 0;
    return {
      userId: key,
      placement: idx + 1,
      playerCount,
      playedBomb: flags.bomb,
      playedJoker: flags.joker,
      matchWon: !isDraw && matchWinners.includes(key),
      opponentsFinished: Math.max(realFinisherCount - (emptiedOwnHand ? 1 : 0), 0),
      abandoned: abandonedBy !== undefined,
    };
  });

  // Bot-filled tables stay fully playable, but nothing about them is
  // recorded: a private room of one human plus bots would otherwise be
  // guaranteed points and free achievements. See isContestedTable for where
  // the line sits. A seat someone walked out on is out of playerMap, but it
  // was a person's seat and its result is recorded as one — counting it as a
  // bot would turn the table bot-majority and drop every write in exactly
  // the case this gate has no business blocking.
  const humanSeats = Object.keys(playerMap).length + abandonedSeats.size;
  const botSeats = Math.max(playerCount - humanSeats, 0);

  return {
    roundByKey,
    cumulativeScores,
    matchOver,
    matchTarget,
    matchWinners,
    isDraw,
    detailed,
    winnerEngineIds,
    gameResults,
    recordable: isContestedTable(humanSeats, botSeats),
  };
}
