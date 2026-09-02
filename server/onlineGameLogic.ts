// Pure helpers used by server/socket.ts, kept here so a test can reach them
// without pulling storage/db/session — and the pg pool they build at import —
// onto a path that needs none of it.
import { botSeatIndex, botSeatKey, isBotSeatKey } from "./botSeat.ts";
import type { ScoreLine } from "../lib/matchState.ts";
import { botSeatNames, getBotPersonality } from "../lib/botPersonalities.ts";
import type { BotPersonalityId } from "../lib/botPersonalities.ts";
import { foldHandIntoMatch, resolveMatchFor } from "../lib/gameEngine.ts";
import type { GameState, GameMode, MatchLength } from "../lib/gameEngine.ts";
import type { GameResult } from "../lib/achievements.ts";
import { exchangeAnnounceMs } from "../lib/exchangeCeremony.ts";
import { z } from "zod";

/** seat -> userId from the persisted map, dropping any entry that is not one. */
export function readPersistedPlayerMap(storedMap: unknown): Record<number, string> {
  const map: Record<number, string> = {};
  if (storedMap && typeof storedMap === "object" && !Array.isArray(storedMap)) {
    for (const [key, value] of Object.entries(storedMap as Record<string, unknown>)) {
      const seat = Number(key);
      if (Number.isInteger(seat) && seat >= 0 && typeof value === "string") {
        map[seat] = value;
      }
    }
  }
  return map;
}

/** The seat a given user occupies, or null if they are not seated at all. */
export function seatOfUser(
  playerMap: Record<number, string>,
  userId: string
): number | null {
  const entry = Object.entries(playerMap).find(([, uid]) => uid === userId);
  return entry ? Number(entry[0]) : null;
}

/**
 * The key a seat's score accumulates under: the seated userId, or the
 * `bot:<seat>` sentinel for a seat vacated to AI takeover.
 */
export function scoreKeyForSeat(
  playerMap: Record<number, string>,
  seat: number
): string {
  return playerMap[seat] ?? botSeatKey(seat);
}

/**
 * The seat a viewer should see as "mine". Server-authoritative — this is
 * what sanitizeStateForPlayer stamps onto every game:state as
 * `viewerSeatIndex`, so the client never has to guess (and never falls back
 * to seat 0 when it doesn't know).
 */
export function findViewerSeat(
  playerMap: Record<number, string>,
  viewerUserId: string
): number | null {
  return seatOfUser(playerMap, viewerUserId);
}

/** The shape of GameState.exchangePhase, restated because the two cards are
 * `unknown` here on purpose: this helper only decides whether to forward
 * them, never reads one. */
export interface VisibleExchangePhaseInput {
  active: boolean;
  winnerIdx: number;
  loserIdx: number;
  bothJokersException: boolean;
  cardFromLoser: unknown;
  cardToLoser?: unknown;
  settledAt?: number;
}

/**
 * Whether the ceremony that reads `cardToLoser` is still on screen. An
 * unstamped closed phase reads as over: with no window to be inside, a seat
 * that never watched the trade cross is told nothing.
 *
 * The window has to outlast `STATE_ACK_TIMEOUT_MS`, because `sendGameStateTo`
 * owes one resend to a client that never acknowledged the settle and that
 * resend re-derives from live state — answering it after the window would hand
 * over half a trade, which `OnlineGameContext`'s `cardReceived || cardGiven`
 * guard raises as a one-legged ceremony rather than refusing. That ordering is
 * asserted in `tests/exchangeVisibility.test.ts` rather than added to the window
 * here, so the two clocks stay independent of each other.
 */
function ceremonyRunning(phase: VisibleExchangePhaseInput, now: number): boolean {
  if (phase.active || phase.settledAt === undefined) return false;
  return now - phase.settledAt < exchangeAnnounceMs(phase.bothJokersException);
}

/**
 * Stamps `settledAt`, on the state itself so it rides the persisted phase.
 *
 * `broadcastGameState` is the caller rather than each of the three places a
 * phase closes: a settle nobody broadcasts is not one any seat can be shown,
 * and one funnel cannot be half-updated the way three call sites can. That
 * wiring is pinned by `tests/exchangeVisibility.test.ts`.
 */
export function markExchangeSettled(
  phase: Pick<VisibleExchangePhaseInput, "active" | "settledAt"> | undefined,
  now: number = Date.now()
): void {
  if (!phase) return;
  if (phase.active) delete phase.settledAt;
  else phase.settledAt ??= now;
}

/**
 * The part of an exchange phase a given seat is allowed to see.
 *
 * `cardFromLoser` goes to the whole table while the phase is open. It is not a
 * secret to withhold: `docs/RULES.md` §10.1 makes it compulsory and automatic —
 * the loser's single highest card — so any seat derives it from the rules alone,
 * and #602 needs it on the felt for every seat. It stops being sent once the
 * phase closes, when there is nothing left to read it for.
 *
 * `cardToLoser` is the opposite: a card the winner *chose* out of their own
 * hand, which no rule determines, so while the phase is open sending it would
 * leak that hand. Closing the phase lifts that, but only for as long as the
 * ceremony is on screen — `exchangePhase` is never cleared, so the phase's own
 * flag would keep the card public for the rest of the manche. The two
 * participants keep it either way: it came out of one's hand into the other's.
 *
 * Every seat also gets the two seat indices and the both-jokers flag — all the
 * announcement banner reads from them.
 */
export function visibleExchangePhase(
  phase: VisibleExchangePhaseInput | undefined,
  viewerSeatIndex: number | null,
  now: number = Date.now()
): Record<string, unknown> | undefined {
  if (!phase) return undefined;

  const visible: Record<string, unknown> = {
    active: phase.active,
    winnerIdx: phase.winnerIdx,
    loserIdx: phase.loserIdx,
    bothJokersException: phase.bothJokersException,
  };

  const isParticipant =
    viewerSeatIndex !== null &&
    (viewerSeatIndex === phase.winnerIdx || viewerSeatIndex === phase.loserIdx);

  const maySeeChosenCard = isParticipant || ceremonyRunning(phase, now);

  if (phase.active) visible.cardFromLoser = phase.cardFromLoser;
  if (maySeeChosenCard && phase.cardToLoser !== undefined) {
    visible.cardToLoser = phase.cardToLoser;
  }
  return visible;
}

/**
 * True when a table was contested by enough real people to record in stats,
 * history and achievements. About what gets *recorded*, never what is allowed:
 * one human plus bots stays fully playable.
 *
 * The line is bot *majority* — an even split (1v1, 2v2) still counts. Seats
 * vacated mid-game count as bots, so having friends leave is not a route to
 * free points.
 */
export function isContestedTable(humanSeats: number, botSeats: number): boolean {
  return botSeats <= humanSeats;
}

/**
 * Bumped whenever the persisted shape of a game stops being safe to restore
 * verbatim (e.g. a change to how many cards are dealt per player). A row
 * written under an older version can hold hands that no longer match the
 * current rules — rehydrating it deals a silently corrupt game instead of
 * crashing, so it must be rejected, not restored.
 */
export const GAME_SCHEMA_VERSION = 2;

export type HandFlags = Record<number, { bomb: boolean; joker: boolean }>;

/**
 * The match bookkeeping that outlives the hand on the table, declared once:
 * this schema is what a stored row is parsed with on restore, and
 * `PersistedMatch` is the shape the write side is held to. A new field is
 * added here and nowhere else.
 */
export const persistedMatchSchema = z.object({
  playerMap: z.unknown().transform(readPersistedPlayerMap),
  scores: z.record(
    z
      .number({
        required_error: "scores are missing",
        invalid_type_error: "scores are not all numbers",
      })
      .finite("scores are not all numbers"),
    { required_error: "scores are not all numbers", invalid_type_error: "scores are not all numbers" },
  ),
  gameMode: z.enum(["free_for_all", "teams"], {
    errorMap: (_iss, ctx) => ({ message: `game mode ${String(ctx.data)}` }),
  }),
  matchLength: z.enum(["match", "single"], {
    errorMap: (_iss, ctx) => ({ message: `match length ${String(ctx.data)}` }),
  }),
  matchTarget: z
    .number({ required_error: "match target missing", invalid_type_error: "match target missing" })
    .int("match target missing")
    .min(1, "match target missing"),
  maxPlayers: z
    .number({ required_error: "max players missing", invalid_type_error: "max players missing" })
    .int("max players missing")
    .min(1, "max players missing"),
  // Defaulted rather than required: a row written before the field existed
  // restores as a match with no manches behind it, which costs the results
  // board one number and never the hand.
  handsPlayed: z.number().int().min(0).catch(0).default(0),
}, { required_error: "no match state", invalid_type_error: "no match state" });

export type PersistedMatch = z.infer<typeof persistedMatchSchema>;

/**
 * The stored `game_state` blob: everything about a live table except the room
 * id that keys it and the `updated_at` the sweep filters on.
 *
 * One versioned document rather than a column each, so a `GAME_SCHEMA_VERSION`
 * bump refuses a stale row whole — and adding a field costs no `db:push`.
 *
 * `gameState` is nested, not spread: `GameState` has its own `gameMode`, which
 * a flat envelope would have the match's overwrite.
 */
export interface PersistedEnvelope<S> {
  schemaVersion: number;
  gameState: S;
  handFlags: HandFlags;
  dealFirstSeat: number;
  /**
   * The room's six-character join code. Stored here as well as in `rooms.code`
   * because a cold-start rejoin has to be able to draw the room screen when
   * that row is gone, and a code cannot be invented — an unjoinable one on
   * screen is worse than none.
   */
  joinCode: string;
  match: PersistedMatch;
}

export function packPersistedState<S extends object>(
  gameState: S,
  handFlags: HandFlags,
  dealFirstSeat: number,
  joinCode: string,
  match: PersistedMatch
): PersistedEnvelope<S> {
  return { schemaVersion: GAME_SCHEMA_VERSION, gameState, handFlags, dealFirstSeat, joinCode, match };
}

export type PersistedRestore<S> =
  | ({ ok: true } & Omit<PersistedEnvelope<S>, "schemaVersion">)
  | { ok: false; reason: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The envelope a stored row must parse into. Declared here and nowhere else:
 * `packPersistedState` writes this shape (a parity test pins its keys to the
 * schema's), `unpackPersistedState` refuses anything that does not satisfy it.
 */
export const persistedEnvelopeSchema = z.object({
  gameState: z.record(z.unknown(), {
    required_error: "no game state",
    invalid_type_error: "no game state",
  }),
  handFlags: z.record(z.unknown(), {
    required_error: "no hand flags",
    invalid_type_error: "no hand flags",
  }),
  dealFirstSeat: z
    .number({ required_error: "no deal rotation", invalid_type_error: "no deal rotation" })
    .int("no deal rotation")
    .nonnegative("no deal rotation"),
  joinCode: z
    .string({ required_error: "no join code", invalid_type_error: "no join code" })
    .min(1, "no join code"),
  match: persistedMatchSchema,
});

/**
 * Reads a stored blob back, or says why it cannot be. The version stamp is
 * checked before the parse — it answers "may this row be restored at all",
 * which a field schema cannot — and the schema's first complaint becomes the
 * reason. `gameState` and `handFlags` are only checked for being objects and
 * then cast, and `match.playerMap` is filtered entry by entry rather than
 * refused: a wholly malformed map reads back as an empty one, which the
 * caller's seat check turns into UNAUTHORIZED.
 */
export function unpackPersistedState<S>(persisted: unknown): PersistedRestore<S> {
  if (!isPlainObject(persisted)) return { ok: false, reason: "not an object" };
  if (persisted.schemaVersion !== GAME_SCHEMA_VERSION) {
    return { ok: false, reason: `schema version ${String(persisted.schemaVersion)}` };
  }
  const parsed = persistedEnvelopeSchema.safeParse(persisted);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues[0]?.message ?? "malformed envelope" };
  }
  const d = parsed.data as {
    gameState: S;
    handFlags: HandFlags;
    dealFirstSeat: number;
    joinCode: string;
    match: PersistedMatch;
  };
  return {
    ok: true,
    gameState: d.gameState,
    handFlags: d.handFlags,
    dealFirstSeat: d.dealFirstSeat,
    joinCode: d.joinCode,
    match: d.match,
  };
}

export interface SeatEntry {
  seatIndex: number;
  userId: string;      // for bots, a synthetic "bot:<seat>" id
  username: string;
  isBot: boolean;
  personality?: BotPersonalityId;
}

/**
 * The full seat roster a game starts with: the seated humans, plus — when
 * `fillWithBots` is requested — a bot seat for every gap up to `maxPlayers`.
 *
 * Pure function so room:start's seat-assignment logic (which of the humans
 * plus bots occupies which engine seat) is unit-testable without spinning up
 * a socket server. server/socket.ts imports this rather than reimplementing
 * it, so tests exercise the exact code path the server runs.
 */
export function buildSeatRoster(
  humans: { seatIndex: number; userId: string; username: string }[],
  maxPlayers: number,
  opts: { fillWithBots?: boolean; botPersonality?: BotPersonalityId }
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
      // Synthetic id: bot seats must never collide with a real user id, and the
      // scoring path already excludes ids with this prefix.
      userId: `bot:${seat}`,
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
 * engine seat index (`initializeGame` assigns seats the same way), so a gap
 * in the DB's own seat numbering cannot shift either map onto the wrong
 * player. `startMatchAction` calls this rather than walking the roster
 * inline, so a test can drive the same function it does.
 */
export function seatAssignmentsFromRoster(roster: SeatEntry[]): {
  playerMap: Record<number, string>;
  botSeatsAtStart: Set<number>;
} {
  const playerMap: Record<number, string> = {};
  const botSeatsAtStart = new Set<number>();
  roster.forEach((r, idx) => {
    if (r.isBot) botSeatsAtStart.add(idx);
    else playerMap[idx] = r.userId;
  });
  return { playerMap, botSeatsAtStart };
}

/**
 * `botSeatsAtStart`, read back from a restored game rather than a fresh
 * roster. `personality` is set once, at `seatAssignmentsFromRoster` time, for
 * a born-bot seat only — `vacateSeat` flips a human seat to AI without ever
 * setting it — and rides every hand's persisted envelope after that, so it
 * survives a restart the roster itself does not.
 */
export function botSeatsFromPersonality(players: readonly { personality?: BotPersonalityId }[]): Set<number> {
  const seats = new Set<number>();
  players.forEach((p, seat) => {
    if (p.personality !== undefined) seats.add(seat);
  });
  return seats;
}

/**
 * Scoring key -> team id, for the seated humans only. Vacated (`bot:<seat>`)
 * seats are left out on purpose: they are already excluded from
 * `cumulativeScores` (see `isBotSeatKey`), so including them here would add
 * a zero-scoring member that can never win but could be named as one.
 */
export function teamKeyMap(
  playerMap: Record<number, string>,
  players: { team?: "A" | "B" }[]
): Record<string, string> {
  const map: Record<string, string> = {};
  players.forEach((p, seat) => {
    const userId = playerMap[seat];
    if (userId === undefined || !p.team) return;
    map[userId] = p.team;
  });
  return map;
}

/**
 * Whether the match a stored row belongs to had already been decided when it
 * was written. Teams races to the target as a *pair* (docs/RULES.md §11), so
 * it must be read back through the same resolver the live path uses — no
 * individual key in a pair on 11 + 11 reaches a target of 21, and restoring
 * that game as still running plays on inside a match that was already won.
 */
export function restoredMatchOver(args: {
  matchLength: MatchLength;
  gameMode: GameMode;
  handOver: boolean;
  scores: Record<string, number>;
  target: number;
  teamOfKey: Record<string, string>;
  playerCount: number;
}): boolean {
  const { matchLength, gameMode, handOver, scores, target, teamOfKey, playerCount } = args;
  if (matchLength === "single") return handOver;
  const resolution = resolveMatchFor({
    gameMode,
    cumulative: scores,
    teamOfKey,
    target,
    playerCount,
  });
  return !!resolution && resolution.newTarget === null;
}

export interface ResolveHandEndInput {
  state: GameState;
  playerMap: Record<number, string>;
  cumulativeScores: Record<string, number>;
  matchTarget: number;
  matchLength: MatchLength;
  gameMode: GameMode;
  handFlags: HandFlags;
  /** seat -> the userId who walked out on the hand still holding cards. */
  abandonedSeats: Map<number, string>;
  /**
   * Seats dealt to a bot when this match's roster was built — never a human's
   * seat this match, unlike one `playerMap` merely no longer names. Defaults
   * to none, which scores every bot seat as a vacated one (the prior
   * behaviour), so a caller that does not know the difference gets the
   * conservative answer rather than a silent new one.
   */
  botSeatsAtStart?: Set<number>;
}

export type ScoreboardRow = ScoreLine;

export interface ResolveHandEndResult {
  handByKey: Record<string, number>;
  cumulativeScores: Record<string, number>;
  matchOver: boolean;
  matchTarget: number;
  matchWinners: string[];
  isDraw: boolean;
  detailed: ScoreboardRow[];
  /** The match winners as engine player ids — the space `rankings` is in. */
  winnerEngineIds: string[];
  gameResults: GameResult[];
  /** Whether the table was contested by enough real people to record. */
  recordable: boolean;
}

/**
 * Everything a hand's end decides: the per-hand and cumulative scoreboard,
 * whether the match is over (or escalates to a new target), who won, and the
 * per-seat results stats/ratings/replays read from. Pure — server/socket.ts
 * `handleGameOver` is left owning the broadcast, persistence and the actual
 * (fire-and-forget) stats/ratings/replay writes.
 */
export function resolveHandEnd(input: ResolveHandEndInput): ResolveHandEndResult {
  const { state, playerMap, matchLength, gameMode, handFlags, abandonedSeats } = input;
  const botSeatsAtStart = input.botSeatsAtStart ?? new Set<number>();

  // rankings hold engine player ids ("player_0"); score by seat -> user so the
  // scoreboard is keyed by a real identity instead of an engine id wearing a
  // username label.
  const seatOfEngineId = new Map<string, number>();
  state.players.forEach((p, idx) => seatOfEngineId.set(p.id, idx));

  const teamOf: Record<string, string> = {};
  for (const p of state.players) {
    if (p.team) teamOf[p.id] = p.team;
  }

  const {
    handByKey,
    cumulative: cumulativeScores,
    over: matchOver,
    target: matchTarget,
    winners: matchWinners,
    isDraw,
  } = foldHandIntoMatch({
    rankings: state.rankings,
    playerCount: state.players.length,
    length: matchLength,
    gameMode,
    target: input.matchTarget,
    cumulative: input.cumulativeScores,
    keyOf: (engineId) => {
      const seat = seatOfEngineId.get(engineId);
      return seat === undefined ? null : scoreKeyForSeat(playerMap, seat);
    },
    // A `bot:<seat>` key excludes only a seat a human has left — a seat that
    // was dealt to a bot when this match started (a straight duel, or a
    // bot-filled table) is a real opponent and scores like any other.
    accumulates: (key) => {
      if (!isBotSeatKey(key)) return true;
      const seat = botSeatIndex(key);
      return seat !== null && botSeatsAtStart.has(seat);
    },
    teamOf,
  });

  // One row per seat, carrying every identity the clients index it by. It was
  // once also sent as a name -> total map alongside; two seats sharing a name
  // collapsed into one entry there, silently.
  const detailed: ScoreboardRow[] = state.players.map((p, seat) => {
    const key = scoreKeyForSeat(playerMap, seat);
    return {
      seatIndex: seat,
      engineId: p.id,
      userId: playerMap[seat] ?? null,
      username: p.name,
      points: handByKey[key] ?? 0,
      total: cumulativeScores[key] ?? 0,
    };
  });

  const winnerEngineIds = matchWinners
    .map((key) => detailed.find((d) => scoreKeyForSeat(playerMap, d.seatIndex) === key)?.engineId)
    .filter((id): id is string => id !== undefined);

  // Every seat carries a placement by the time a hand ends — the engine fills
  // the remaining positions for anyone still holding cards, in both modes —
  // so every seated player is represented in `gameResults` and counted
  // toward `gamesPlayed`, not just the ones who actually emptied their hand.
  const playerCount = state.players.length;
  // How many seats actually emptied their hand this hand, read straight off
  // the final state rather than inferred from the mode: a seat that was
  // auto-assigned its position while still holding cards never "finished",
  // and must not be counted as one of anyone's finished opponents.
  const realFinisherCount = state.players.filter((p) => p.hand.length === 0).length;

  // Placements are handed out from one explicit total order, not from each
  // seat's own index in `state.rankings`: the seats that played the hand out
  // in ranking order, then the abandoned ones behind them, ranking order kept
  // within each group so several walkouts fill the last slots stably. That is
  // what makes a forfeit genuinely last (docs/BRIEF.md §3.1) while every
  // placement stays distinct — lib/rating.ts renumbers the human seats 1..n
  // by sorting on placement, so two seats sharing one would rate a quitter
  // ahead of a player who stayed to the end.
  const rankedSeats = state.rankings
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
    const flags = handFlags[seat] ?? { bomb: false, joker: false };
    const seatPlayer = state.players[seat];
    if (!seatPlayer) throw new Error(`onlineGameLogic: no player at seat ${seat}`);
    const emptiedOwnHand = seatPlayer.hand.length === 0;
    return {
      userId: key,
      placement: idx + 1,
      playerCount,
      playedBomb: flags.bomb,
      playedJoker: flags.joker,
      matchWon: matchWinners.includes(key),
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
    handByKey,
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
