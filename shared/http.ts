// The HTTP contract, the twin of shared/protocol.ts: every player route, the shape
// it answers as JSON delivers it — not shared/schema.ts's row types, because a
// `Date` column arrives here as an ISO string — and the schemas its input passes.
import type { z } from "zod";
import type { RouteParameters } from "express-serve-static-core";
import type { GameMode } from "../lib/game/gameEngine.ts";
import type { ReplayDto, ReplaySummary } from "../lib/game/replay.ts";
import * as S from "./httpSchemas.ts";

export interface UserStatsDto {
  userId: string;
  roundsPlayed: number;
  roundsWon: number;
  matchesWon: number;
  currentStreak: number;
  bestStreak: number;
  dailyStreak: number;
  bombsPlayed: number;
  updatedAt: string;
}

export interface RatingDto {
  season: string;
  rating: number;
  rounds: number;
  /** True until the record is long enough to list publicly. */
  provisional: boolean;
}

export interface LeaderboardEntryDto {
  rank: number;
  userId: string;
  username: string;
  rating: number;
  rounds: number;
}

export interface AchievementStatusDto {
  id: string;
  nameKey: string;
  descKey: string;
  unlocked: boolean;
  unlockedAt: string | null;
}

export interface FriendInfo {
  id: string;
  username: string;
  lastSeen: string | null;
}

/** One pending friend request, as `/api/friends/requests` and `/api/friends/sent` serve it. */
export interface FriendRequestInfo {
  id: string;
  username: string;
  createdAt: string | null;
}

/**
 * The friend events, whose rows are the ones the fetch would have returned.
 *
 * A client that receives one can seat it in the cache on the frame the banner
 * goes up, instead of waiting out the round trip an invalidation only starts.
 * Both rows are optional: the banner has to keep working against a server that
 * predates them, and against any path that creates a row without emitting.
 */
export interface FriendRequestIncoming {
  from: string;
  request?: FriendRequestInfo;
}

export interface FriendRequestAccepted {
  by: string;
  friend?: FriendInfo;
}

export interface HistoryParticipantDto {
  name: string | null;
  bot: boolean;
}

export interface RoundHistoryDto {
  id: string;
  userId: string;
  finishedAt: string;
  gameMode: GameMode;
  placement: number;
  playerCount: number;
  points: number;
  opponents: unknown[];
  participants: HistoryParticipantDto[];
  replayId: string | null;
  /** Null for a round the ladder did not rate — never 0, which is a rated round that moved nobody. */
  ratingDelta: number | null;
  /** True when this seat left before the round finished — docs/GAME-RULES.md § Decisions. */
  abandoned: boolean;
}

/** Everything a signed-in client is told about itself; register, login and /me cannot answer it differently. */
export interface SessionUserDto {
  id: string;
  username: string;
  tutorialSeenAt: string | null;
  email: string | null;
  emailVerified: boolean;
}

export interface GameInviteDto {
  id: string;
  roomCode: string;
  fromUsername: string;
  createdAt: string;
}

export interface UserSearchHit {
  id: string;
  username: string;
}

export interface SocketTicketDto {
  ticket: string;
  expiresAt: number;
}

export interface FriendRequestSent {
  ok: true;
  username: string;
}

export type Ok = { ok: true };

/** Every body built by server/shared/payload.ts — a refusal, or a 2xx notice — plus validate()'s field errors. */
export interface ErrorBody {
  code: string;
  message: string;
  params?: Record<string, string | number>;
  details?: Record<string, string[] | undefined>;
}

declare const res: unique symbol;

export interface Endpoint<
  Res,
  Body extends z.ZodTypeAny | undefined = undefined,
  Query extends z.ZodTypeAny | undefined = undefined,
> {
  readonly body?: Body;
  readonly query?: Query;
  readonly [res]?: Res;
}

const ep =
  <Res>() =>
  <B extends z.ZodTypeAny | undefined = undefined, Q extends z.ZodTypeAny | undefined = undefined>(
    parts: { body?: B; query?: Q } = {}
  ): Endpoint<Res, B, Q> =>
    parts;

/**
 * The player API, keyed `"METHOD /path"`: server/http/mount.ts mounts each key and nothing else
 * under /api. Admin routes are deliberately absent — this table reaches the client's types, and
 * /admin is not to be named there.
 */
export const HTTP = {
  "POST /api/auth/register": ep<ErrorBody>()({ body: S.RegisterSchema }),
  "POST /api/auth/login": ep<SessionUserDto>()({ body: S.LoginSchema }),
  "POST /api/auth/logout": ep<Ok>()(),
  "POST /api/push/token": ep<Ok>()({ body: S.PushTokenSchema }),
  "GET /api/auth/me": ep<SessionUserDto>()(),
  "POST /api/auth/change-password": ep<Ok>()({ body: S.ChangePasswordSchema }),
  "POST /api/auth/add-email": ep<SessionUserDto>()({ body: S.AddEmailSchema }),
  "POST /api/auth/verify-email": ep<Ok>()({ body: S.VerifyEmailSchema }),
  "POST /api/auth/resend-verification": ep<Ok>()(),
  "POST /api/auth/request-password-reset": ep<Ok>()({ body: S.RequestPasswordResetSchema }),
  "POST /api/auth/reset-password": ep<Ok>()({ body: S.ResetPasswordSchema }),
  "POST /api/auth/socket-ticket": ep<SocketTicketDto>()(),
  "PATCH /api/users/me": ep<SessionUserDto>()({ body: S.RenameSchema }),
  "POST /api/users/me/tutorial-seen": ep<Ok>()(),
  "DELETE /api/users/me": ep<ErrorBody>()(),
  "GET /api/friends": ep<FriendInfo[]>()(),
  "GET /api/friends/requests": ep<FriendRequestInfo[]>()(),
  "GET /api/friends/invites": ep<GameInviteDto[]>()(),
  "DELETE /api/friends/invites/:roomCode": ep<Ok>()(),
  "GET /api/users/search": ep<UserSearchHit>()({ query: S.UserSearchQuery }),
  "GET /api/friends/sent": ep<FriendRequestInfo[]>()(),
  "POST /api/friends/add": ep<FriendRequestSent>()({ body: S.AddFriendSchema }),
  "DELETE /api/friends/requests/:id": ep<Ok>()(),
  "POST /api/friends/accept/:id": ep<Ok>()(),
  "POST /api/friends/decline/:id": ep<Ok>()(),
  "DELETE /api/friends/:friendUserId": ep<Ok>()(),
  "GET /api/stats/me": ep<UserStatsDto>()(),
  "GET /api/stats/history": ep<RoundHistoryDto[]>()(),
  "GET /api/stats/achievements": ep<AchievementStatusDto[]>()(),
  "GET /api/ratings/me": ep<RatingDto>()(),
  "GET /api/ratings/leaderboard": ep<LeaderboardEntryDto[]>()(),
  "GET /api/ratings/leaderboard/friends": ep<LeaderboardEntryDto[]>()(),
  "GET /api/replays": ep<ReplaySummary[]>()(),
  "GET /api/replays/:id": ep<ReplayDto>()(),
  "POST /api/client-errors": ep<void>()({ body: S.ClientErrorSchema }),
  "POST /api/bug-reports": ep<Ok>()({ body: S.BugReportSchema }),
} as const;

export type Route = keyof typeof HTTP;
export type GetRoute = Extract<Route, `GET ${string}`>;
export type ResOf<K extends Route> = NonNullable<(typeof HTTP)[K][typeof res]>;
type BodySchema<K extends Route> = (typeof HTTP)[K] extends Endpoint<unknown, infer B, z.ZodTypeAny | undefined> ? B : never;
type QuerySchema<K extends Route> = (typeof HTTP)[K] extends Endpoint<unknown, z.ZodTypeAny | undefined, infer Q> ? Q : never;
export type BodyOf<K extends Route> = BodySchema<K> extends z.ZodTypeAny ? z.input<BodySchema<K>> : undefined;
export type QueryOf<K extends Route> = QuerySchema<K> extends z.ZodTypeAny ? z.input<QuerySchema<K>> : undefined;
/** What the server holds once validate()/validateQuery() have run. */
export type ParsedBodyOf<K extends Route> = BodySchema<K> extends z.ZodTypeAny ? z.output<BodySchema<K>> : undefined;
export type ParsedQueryOf<K extends Route> = QuerySchema<K> extends z.ZodTypeAny ? z.output<QuerySchema<K>> : undefined;
export type PathOf<K extends Route> = K extends `${string} ${infer P}` ? P : never;
export type ParamsOf<K extends Route> = RouteParameters<PathOf<K>>;
/**
 * What a server value may be before JSON.stringify: a Date wherever the DTO says string. Loose
 * on purpose — a Date is accepted for any string field, which catches renames, missing fields and
 * wrong primitives but not "a Date in a non-date string", and none exists.
 */
export type Sendable<T> = T extends string
  ? string | Date
  : T extends (infer U)[]
    ? Sendable<U>[]
    : T extends object
      ? { [P in keyof T]: Sendable<T[P]> }
      : T;
