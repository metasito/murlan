// Pure, dependency-free helpers used by server/socket.ts. server/socket.ts
// transitively imports storage/db/session/etc, whose own relative imports
// lack the explicit `.ts` extensions Node's native TS loader requires — so it
// cannot be imported by the plain `node --test` runner used in tests/. This
// module imports nothing beyond an equally pure sibling, so it can be, and
// server/socket.ts imports these rather than reimplementing them so tests
// exercise the exact code path the server runs.
import { botSeatNames, getBotPersonality } from "../lib/botPersonalities.ts";
import type { BotPersonalityId } from "../lib/botPersonalities.ts";
import { scoreHand, addHandScores, resolveMatch, resolveTeamMatch } from "../lib/gameEngine.ts";
import type { GameState, GameMode, MatchLength } from "../lib/gameEngine.ts";
import type { GameResult } from "../lib/achievements.ts";

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
  return playerMap[seat] ?? `bot:${seat}`;
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

/**
 * Strips vacated (`bot:<seat>`) entries out of a per-hand score breakdown
 * before it is merged into a match's cumulative scores. A bot-controlled
 * seat must never accumulate match points or become eligible to win the
 * match under the departed human's username.
 */
export function excludeBotSeats(
  handByKey: Record<string, number>
): Record<string, number> {
  const scorable: Record<string, number> = {};
  for (const [key, points] of Object.entries(handByKey)) {
    if (key.startsWith("bot:")) continue;
    scorable[key] = points;
  }
  return scorable;
}

/** The shape of GameState.exchangePhase, restated so this module keeps its
 * "no imports at all" property (see the header). `cardFromLoser` is `unknown`
 * here on purpose: this helper only decides whether to forward it. */
export interface VisibleExchangePhaseInput {
  active: boolean;
  winnerIdx: number;
  loserIdx: number;
  bothJokersException: boolean;
  cardFromLoser: unknown;
}

/**
 * The part of an exchange phase a given seat is allowed to see.
 *
 * Only the two people in the exchange have any use for `cardFromLoser`: the
 * winner's ExchangeModal shows the card they were handed, and the loser is
 * entitled to see the card taken off them. Every other seat needs the two seat
 * indices and the both-jokers flag — all the announcement banner reads — and
 * once the phase has closed nobody needs the card at all.
 */
export function visibleExchangePhase(
  phase: VisibleExchangePhaseInput | undefined,
  viewerSeatIndex: number | null
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

  if (phase.active && isParticipant) visible.cardFromLoser = phase.cardFromLoser;
  return visible;
}

/**
 * True when a table was contested by enough real people for its outcome to be
 * worth recording in stats / match history / achievements.
 *
 * A private room of one human plus bots stays fully playable — practice
 * against the AI is a feature — but the human's wins there are guaranteed
 * points, which would trivially unlock `match_champion`, `iron_will` and
 * endless streaks. This is about what gets *recorded*, never about what is
 * allowed.
 *
 * The line is bot *majority*: 1 human + 3 bots and 1 human + 2 bots are out;
 * an even split (1 v 1, 2 v 2) still counts. Seats vacated mid-game count as
 * bots, so "invite three friends, have them all leave" is not a route back to
 * the same free points.
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

/** The match bookkeeping that outlives the hand on the table. */
export interface PersistedMatch {
  playerMap: Record<number, string>;
  scores: Record<string, number>;
  gameMode: GameMode;
  matchLength: MatchLength;
  matchTarget: number;
  maxPlayers: number;
  isPublic: boolean;
}

/**
 * The stored `game_state` blob: everything about a live table except the room
 * id that keys it and the `updated_at` the abandoned-game sweep filters on.
 *
 * One versioned document rather than a column each, so a
 * `GAME_SCHEMA_VERSION` bump refuses a stale row whole; a column outside it
 * would be rehydrated alongside the state the bump just rejected. It also
 * costs nothing to add a field to, where a new column cannot be written until
 * someone runs `db:push` on Replit and every persist fails silently until they
 * do.
 *
 * `gameState` is nested, not spread: `GameState` has its own `gameMode`, so a
 * flat envelope would have the match's overwrite the hand's.
 */
export interface PersistedEnvelope<S> {
  schemaVersion: number;
  gameState: S;
  handFlags: HandFlags;
  dealFirstSeat: number;
  match: PersistedMatch;
}

export function packPersistedState<S extends object>(
  gameState: S,
  handFlags: HandFlags,
  dealFirstSeat: number,
  match: PersistedMatch
): PersistedEnvelope<S> {
  return { schemaVersion: GAME_SCHEMA_VERSION, gameState, handFlags, dealFirstSeat, match };
}

export type PersistedRestore<S> =
  | ({ ok: true } & Omit<PersistedEnvelope<S>, "schemaVersion">)
  | { ok: false; reason: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSeatCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Reads a stored blob back, or says why it cannot be. Every field is checked
 * against the shape the restore path assumes: the blob is `unknown` however
 * the column is typed, and a value that reaches `resolveMatch` malformed
 * produces a NaN comparison instead of a refused row.
 */
export function unpackPersistedState<S>(persisted: unknown): PersistedRestore<S> {
  if (!isPlainObject(persisted)) return { ok: false, reason: "not an object" };
  if (persisted.schemaVersion !== GAME_SCHEMA_VERSION) {
    return { ok: false, reason: `schema version ${String(persisted.schemaVersion)}` };
  }
  if (!isPlainObject(persisted.gameState)) return { ok: false, reason: "no game state" };
  if (!isPlainObject(persisted.handFlags)) return { ok: false, reason: "no hand flags" };
  if (!isSeatCount(persisted.dealFirstSeat)) return { ok: false, reason: "no deal rotation" };

  const match = persisted.match;
  if (!isPlainObject(match)) return { ok: false, reason: "no match state" };
  if (!isPlainObject(match.scores) || !Object.values(match.scores).every(Number.isFinite)) {
    return { ok: false, reason: "scores are not all numbers" };
  }
  if (match.gameMode !== "free_for_all" && match.gameMode !== "teams") {
    return { ok: false, reason: `game mode ${String(match.gameMode)}` };
  }
  if (match.matchLength !== "match" && match.matchLength !== "single") {
    return { ok: false, reason: `match length ${String(match.matchLength)}` };
  }
  if (!isSeatCount(match.matchTarget) || match.matchTarget < 1) {
    return { ok: false, reason: `match target ${String(match.matchTarget)}` };
  }
  if (!isSeatCount(match.maxPlayers) || match.maxPlayers < 1) {
    return { ok: false, reason: `max players ${String(match.maxPlayers)}` };
  }
  if (typeof match.isPublic !== "boolean") return { ok: false, reason: "no visibility" };

  return {
    ok: true,
    gameState: persisted.gameState as S,
    handFlags: persisted.handFlags as HandFlags,
    dealFirstSeat: persisted.dealFirstSeat,
    match: {
      playerMap: readPersistedPlayerMap(match.playerMap),
      scores: match.scores as Record<string, number>,
      gameMode: match.gameMode,
      matchLength: match.matchLength,
      matchTarget: match.matchTarget,
      maxPlayers: match.maxPlayers,
      isPublic: match.isPublic,
    },
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
    roster.push({
      seatIndex: seat,
      // Synthetic id: bot seats must never collide with a real user id, and the
      // scoring path already excludes ids with this prefix.
      userId: `bot:${seat}`,
      username: names[i],
      isBot: true,
      personality,
    });
  });
  return roster.sort((a, b) => a.seatIndex - b.seatIndex);
}

/**
 * Scoring key -> team id, for the seated humans only. Vacated (`bot:<seat>`)
 * seats are left out on purpose: they are already excluded from
 * `cumulativeScores` (see `excludeBotSeats`), so including them here would add
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
  const resolution =
    gameMode === "teams" && Object.keys(teamOfKey).length > 0
      ? resolveTeamMatch(scores, teamOfKey, target, playerCount)
      : resolveMatch(scores, target, playerCount);
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
}

export interface ScoreboardRow {
  seatIndex: number;
  userId: string | null;
  username: string;
  points: number;
  total: number;
}

export interface ResolveHandEndResult {
  handByKey: Record<string, number>;
  cumulativeScores: Record<string, number>;
  matchOver: boolean;
  matchTarget: number;
  matchWinners: string[];
  isDraw: boolean;
  detailed: ScoreboardRow[];
  byName: Record<string, number>;
  winnerNames: string[];
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

  // rankings hold engine player ids ("player_0"); score by seat -> user so the
  // scoreboard is keyed by a real identity instead of an engine id wearing a
  // username label.
  const seatOfEngineId = new Map<string, number>();
  state.players.forEach((p, idx) => seatOfEngineId.set(p.id, idx));

  const handByEngineId = scoreHand(state.rankings, state.players.length);
  const handByKey: Record<string, number> = {};
  for (const [engineId, points] of Object.entries(handByEngineId)) {
    const seat = seatOfEngineId.get(engineId);
    if (seat === undefined) continue;
    handByKey[scoreKeyForSeat(playerMap, seat)] = points;
  }

  // A vacated seat is scored under `bot:<seat>` (see scoreKeyForSeat) purely
  // so the per-hand breakdown has something to key off of. It must never
  // accumulate towards the match, or a bot can cross the match target and be
  // announced as the winner under the departed human's username.
  const scorableHandByKey = excludeBotSeats(handByKey);
  const cumulativeScores = addHandScores(input.cumulativeScores, scorableHandByKey);

  let matchOver = false;
  let matchTarget = input.matchTarget;
  let matchWinners: string[] = [];
  let isDraw = false;

  if (matchLength === "single") {
    // A quick game is one manche: whoever took it has won the match — and in
    // teams mode the manche is taken by a pair, not by the seat that emptied
    // its hand first (docs/RULES.md §11).
    matchOver = true;
    const topSeat = seatOfEngineId.get(state.rankings[0] ?? "");
    const winningTeam = topSeat === undefined ? undefined : state.players[topSeat]?.team;
    if (topSeat === undefined) {
      matchWinners = [];
    } else if (gameMode === "teams" && winningTeam) {
      matchWinners = Object.entries(teamKeyMap(playerMap, state.players))
        .filter(([, team]) => team === winningTeam)
        .map(([key]) => key);
    } else {
      matchWinners = [scoreKeyForSeat(playerMap, topSeat)];
    }
  } else {
    // Teams mode races to the target as a *pair* (docs/RULES.md §11: the two
    // partners' placement points are summed), so the match must be resolved on
    // the team total and both partners reported as winners. Free-for-all is
    // unchanged.
    const teamOfKey = teamKeyMap(playerMap, state.players);
    const resolution =
      gameMode === "teams" && Object.keys(teamOfKey).length > 0
        ? resolveTeamMatch(cumulativeScores, teamOfKey, matchTarget, state.players.length)
        : resolveMatch(cumulativeScores, matchTarget, state.players.length);
    if (resolution) {
      if (resolution.newTarget !== null) {
        matchTarget = resolution.newTarget;
      } else {
        matchOver = true;
        isDraw = resolution.isDraw;
        matchWinners = resolution.winners;
      }
    }
  }

  // Wire format: the clients index the scoreboard by display name.
  const byName: Record<string, number> = {};
  const detailed: ScoreboardRow[] = state.players.map((p, seat) => {
    const key = scoreKeyForSeat(playerMap, seat);
    const total = cumulativeScores[key] ?? 0;
    byName[p.name] = total;
    return {
      seatIndex: seat,
      userId: playerMap[seat] ?? null,
      username: p.name,
      points: handByKey[key] ?? 0,
      total,
    };
  });

  const winnerNames = matchWinners
    .map((key) => detailed.find((d) => scoreKeyForSeat(playerMap, d.seatIndex) === key)?.username)
    .filter((n): n is string => !!n);

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
    const emptiedOwnHand = state.players[seat].hand.length === 0;
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
    byName,
    winnerNames,
    gameResults,
    recordable: isContestedTable(humanSeats, botSeats),
  };
}
