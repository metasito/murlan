# 06 — HTTP: a shared client/server contract, `routes.ts` split, auth guard, wire-type homes

IDs: L-034, L-051, L-052, L-053, L-054, L-068, L-129. All line numbers are re-checked at MAIN `a1d0ebb5`.

## 1. Summary

- **Now:** the socket protocol has a contract (`shared/protocol.ts`, `shared/socketSchemas.ts`). HTTP has none. The server's route table is a 1086-line `server/http/routes.ts`. The client spells each URL, response type and cache key by hand at about 60 sites, using three fetch paths. Four DTOs are written twice and drift without a compile error. The auth guard is proved by an AST scan of that one file. `shared/` reaches into `lib/wire.ts`, a client module, and `lib/game` reaches into the client's `lib/i18n.ts`.
- **After:** `shared/http.ts` becomes the HTTP twin of `shared/protocol.ts`. It is one runtime table keyed `"METHOD /path"`, with the response DTO, request schema and path params of each route. The server mounts through a thin `on`/`onSignedIn` adapter, split into one file per area. The client calls `api(key, input)` and `useApi(key)`, with named invalidation sets. Under the guard tests, a walk of the live Express router replaces the AST scan.
- **Why:** one root cause, a missing HTTP contract module, explains five of the seven entries: type drift (L-053), key and fetch sprawl (L-068), per-route plumbing and `userId!` (L-034), a guard proof pinned to a file (L-051) and type homes in the wrong layer (L-052). L-129 is the lint half of L-052. L-054 is two small defects fixed as the auth file is rewritten.
- The account-recovery handlers keep their exact reply-versus-work order: CONTEXT.md and ADR-0007 decide that, and nothing here merges them. The five client recovery screens keep their own request blocks: CONTEXT.md:120-126 rejects a shared hook, and nothing here adds one.
- Four tickets: 1 S, 2 M, 1 L.

## 2. Current shape (evidence at MAIN)

**Server: `server/http/routes.ts` (1086 lines)**
- **Limiters.** 13 limiter constants at :135-355, each with its rationale.
- **Helpers.** Helpers at :359-453: `sessionUser`, the mail bodies and senders, `requireAdmin`, `requireAuth`, `rollbackRegistration`.
- **Route bodies.** 41 route bodies at :472-1082: auth, account, friends, stats, ladder, admin, replays and reports. The leaderboards (:979-987) are split from `ratings/me` (:957) by the admin block (:965-977).
- **`http.Server`.** `createServer(app)` runs at :1084, so the route file builds the server.
- **Non-null assertions.** `req.session.userId!` appears 26 times, for example :586, :609, :641, :707, :862, :984.
- **Repeated user lookup.** The "getUser, missing → 401" check is written out at :596-600 (`/me`), :611-615, :643-647 and :708-712.
  - `/me` re-implements `requireAuth` inline (:592-595).
  - On a deleted account, `/me` answers `USER_NOT_FOUND` (:598), where every other route answers `NOT_AUTHENTICATED`.
- **Duplicated sign-in.** The regenerate → revoke prior sid → set userId → save sequence appears twice: register :497-527 and login :547-567.
- **Password hashing.** `bcrypt.hash(…, 10)` appears three times: :481, :623, :772.
- **Logout (L-054).** :576 calls `req.session.destroy(async () => …)`, ignores the error argument and replies `{ ok: true }` anyway.
- **Handshake (L-054).** `server/socket/socket.ts:116-118` passes socket.io's `next` straight into `sessionMiddleware`. A pg store error therefore reaches the client's `connect_error` as the raw driver message. Only the second middleware maps thrown errors to `AUTH_UNAVAILABLE` (:162-166).

**Server ↔ client types (L-053)**
- **Hand-copied DTOs.** These server views have separate client copies: `server/game/ratings.ts:19-37` (`RatingView`, `LeaderboardEntry`), `server/game/stats.ts:180-183` (`UserStatsView`, whose `updatedAt: Date` serialises to a string), `stats.ts:220-226` (`AchievementStatus`) and `server/http/roundHistoryView.ts:18-34`. The client copies are in `lib/wire.ts:5-91`.
- **Undeclared client types.** The invite rows are declared only on the client (`context/SocketContext.tsx:65` `InviteRow`), and the server returns `createdAt: Date` (`server/store/friendStore.ts:223-225`). `sessionUser` (routes.ts:359-367) is mirrored by `lib/authUser.ts:1-8`.
- **Already shared.** Friend DTOs already cross the boundary: `server/store/friendRows.ts:8` and `server/socket/friendships.ts:8` import `lib/wire.ts`. Replay DTOs live in `lib/game/replay.ts:13-41` and the server imports them (`server/game/replays.ts:6`).
- **Request schemas.** They live in `server/http/schemas.ts`, which only the server can see. The client's bodies are untyped object literals (`context/AuthContext.tsx:134-179`).
- **Dead field.** `ServerPayload.error` (`shared/protocol.ts:43-49`) has no producer. Its only readers are `lib/i18n.ts:166,186`.

**Client (L-068)**
- **URL literals.** There are about 60 `"/api/…"` literals in `app/`, `context/`, `lib/` and `components/`. About 30 of them are query keys or invalidations.
- **Keys and types.** The key is the URL: the default queryFn joins `queryKey` with "/" (`lib/query-client.ts:52`). The same key is typed `{ id: string }[]` at `app/index.tsx:391` and `FriendRequestInfo[]` in `app/(online)/friends.tsx:79-81`.
- **Invalidation.** Invalidation sets are written out at each use: `context/OnlineGameContext.tsx:683-687` (after a round), `context/SocketContext.tsx:102-107,300` (on reconnect) and `:355-376,389,408,416` (friend events). `app/(online)/friends.tsx:108-146,194` has its own. Two partial key helpers exist: `lib/ladderQuery.ts` and `lib/game/replay.ts:70`.
- **Three fetch paths.**
  - `apiRequest` over `expo/fetch` (`lib/query-client.ts:1,27-43`).
  - `fetchMe` over global `fetch` (`context/AuthContext.tsx:50-60`).
  - `fetchSocketTicket` over global `fetch` (`lib/socket.ts:52-69`).
  - The last two say they avoid `apiRequest` so they can tell a 401 from a transient failure. `apiRequest` already throws `ApiError` with `.status` (`lib/apiError.ts:9-26`), so the distinction is available through it. Only the fetch *implementation* still differs (see §10).

**Guard proof (L-051)**
- **What the scan reads.** `tests/helpers/routeMountings.ts:6,16-38` reads only `server/http/routes.ts`, looking for `app.<verb>("literal", …)`. `tests/server/routesAuthenticated.test.ts` pins exact PUBLIC, SIGNED_IN and ADMIN lists against that scan.
- **What it misses.** A route in any other file or Router is invisible to it. Today that is `server/http/appLinks.ts:10,16` and `server/app.ts:150,168,229`.
- **Other scans pinned to the same path.** Six other source scans name the path `server/http/routes.ts`. A split must move each one without letting it pass on an empty read:
  - `tests/server/authReplyBeforeMail.test.ts:17`
  - `tests/server/rateLimiterFactory.test.ts:15,69`
  - `tests/server/sessionRevocation.test.ts:61`
  - `tests/server/validate.test.ts:28`
  - `tests/server/logRedaction.test.ts:217`
  - `tests/server/verificationEmailBody.test.ts:10` (an import)

**Import graph (L-052, L-129)**
- **The cycle.** The type-only cycle is `lib/game/gameEngine` → `botPersonalities.ts:7` → `lib/i18n.ts` → (:32) `shared/protocol.ts` → (:7) `lib/wire.ts` → (:3) `gameEngine`.
- **Imports to retarget.** `TranslationKey` is imported from the client's `lib/i18n` at `lib/game/{botPersonalities:7,placement:4,rating:3}` and `lib/{achievements:20,cosmetics:13,cardNames:9}`. `shared/i18n.ts:12` already exports it.
- **Lint glob gap.** The eslint audio-owner rule (`eslint.config.js:25-44`, applied at :153-155) misses `modules/`. `tests/tooling/audioOwners.test.ts` re-derives the same owner table and adds `modules/`.
- **What `shared/` may import.** `shared/` legitimately imports `lib/game/*`: `shared/protocol.ts:5-6` and `shared/schema.ts`. A blanket `shared/` ban on `lib/` is therefore wrong (verify's correction).

## 3. Alternatives considered

**A. A `RouteSpec` table (the ledger's proposal).** `{ method, path, access, limiters, body, handle }` plus `mount(app, specs)`, which installs the guard from `access`.
- Deepest on the server.
- The chain order differs per route on purpose:
  - register: `authLimiter → validate → registerEmailLimiter`, because the email limiter keys on the parsed body;
  - rename: `requireAuth → validate → renameLimiter`, so a typo does not spend the budget;
  - push: `requireAuth → pushLimiter → validate`.
  - A `limiters` field therefore needs before- and after-validate slots, so the abstraction leaks the thing it hides.
- Each of the six source scans would have to learn a new shape.
- Verify's `fix_ok` already called it "a bigger abstraction than the problem needs".
- It gives the client nothing.

**B. A runtime contract in `shared/`, a thin typed adapter on the server, and the guard proved from the live router (picked).**
- `shared/http.ts` exports `HTTP`, a const table keyed `"POST /api/auth/login"`. Each value carries the request schema at runtime and the response DTO as a phantom type.
- The server mounts each route with `on(app, key, ...chain, handler)` or `onSignedIn(...)`. The chain stays plain Express middleware, in today's exact order. The handler's `res.json` is typed from the contract. `onSignedIn` puts `requireAuth` first and passes `userId: string`.
- The client imports only *types* from `shared/http.ts` and calls `api(key, input)` and `useApi(key)`.
- The guard is proved by walking `app.router.stack` of an app built by the real `mountApi`. The same walk proves the mounted `/api` set equals `Object.keys(HTTP)`.

**C. Types only (verify's "cheaper slice").** Server functions import the `lib/wire` DTOs, `routes.ts` splits by area, and the scans are widened to a directory.
- Least churn.
- Client bodies, paths and keys stay untyped and spread out.
- The guard is still a text scan, now of a directory.
- Fixes L-053 only halfway and leaves L-068 alone.

| | A RouteSpec | **B contract + `on`** | C types only |
|---|---|---|---|
| Depth (what a caller must know) | server: little; client: unchanged | server: the key and its chain; client: the key | server: unchanged; client: unchanged |
| Locality of a route's facts | one spec | key in one table, chain beside the handler | spread out as now |
| Seam | `mount` plus specs (one adapter: hypothetical) | `HTTP`, used by two adapters (server `on`, client `api`): a real seam | none new |
| Middleware-order risk | high (re-expressed) | none (the chain is copied verbatim) | none |
| Guard proof | type plus scan | the live router, file-agnostic | a text scan |
| Migration cost | L+ | L (server) + 2×M (client) | M |

**B wins.** Its seam has two adapters, so it is real. It keeps the per-route chain that CONTEXT.md and ADR-0007 treat as load-bearing. It turns the guard from a scan into a derived fact, which is CLAUDE.md's "no self-defeating safeguards".

For the client transport there were two designs:
- **(i)** An `Outcome<T>` union returned by `request`.
- **(ii)** Keep throwing `ApiError` and let the two raw callers read `.status`.

(ii) is picked. Every existing screen's error path (`serverErrorMessage`, `lib/apiError.ts:52-56`) already handles `ApiError`. `fetchMe`'s 401 → `null` / other → `undefined` contract then fits in three lines over `api()`. An `Outcome` would rewrite all five recovery screens, which CONTEXT.md:120-126 asks to leave alone.

## 4. Target design

### 4.1 `shared/http.ts`: the contract (new; absorbs `lib/wire.ts`)

```ts
import type { z } from "zod";
import type { RouteParameters } from "express-serve-static-core"; // already installed via @types/express
import * as S from "./httpSchemas.ts";

// DTOs moved verbatim from lib/wire.ts, plus the ones only the server declared today:
export interface SessionUserDto { id: string; username: string; tutorialSeenAt: string | null; email: string | null; emailVerified: boolean }
export interface UserStatsDto { … }   export interface RatingDto { … }   export interface LeaderboardEntryDto { … }
export interface AchievementStatusDto { … }   export interface RoundHistoryDto { … }   export interface HistoryParticipantDto { … }
export interface FriendInfo { … }   export interface FriendRequestInfo { … }   export interface FriendRequestIncoming { … }   export interface FriendRequestAccepted { … }
export interface GameInviteDto { id: string; roomCode: string; fromUsername: string; createdAt: string }
export interface UserSearchHit { id: string; username: string }
export type Ok = { ok: true };
/** Every non-2xx JSON body: what server/socket/payload.ts builds, plus validate()'s field errors. */
export interface ErrorBody { code: string; message: string; params?: Record<string, string | number>; details?: Record<string, string[]> }

declare const res: unique symbol;
export interface Endpoint<Res, Body extends z.ZodTypeAny | undefined = undefined, Query extends z.ZodTypeAny | undefined = undefined> {
  readonly body?: Body; readonly query?: Query; readonly [res]?: Res;
}
const ep = <Res>() => <B extends z.ZodTypeAny | undefined = undefined, Q extends z.ZodTypeAny | undefined = undefined>(
  parts: { body?: B; query?: Q } = {}): Endpoint<Res, B, Q> => parts;

/** The player API. Admin routes are deliberately absent: this table reaches the client's types, and /admin is not to be named there. */
export const HTTP = {
  "POST /api/auth/register": ep<ErrorBody>()({ body: S.RegisterSchema }),       // 202 CHECK_YOUR_EMAIL
  "POST /api/auth/login": ep<SessionUserDto>()({ body: S.LoginSchema }),
  "POST /api/auth/logout": ep<Ok>()(),
  "GET /api/auth/me": ep<SessionUserDto>()(),
  "GET /api/friends/requests": ep<FriendRequestInfo[]>()(),
  "DELETE /api/friends/requests/:id": ep<Ok>()(),
  "GET /api/users/search": ep<UserSearchHit>()({ query: S.UserSearchQuery }),
  "POST /api/client-errors": ep<void>()({ body: S.ClientErrorSchema }),          // 204
  // … one entry for each of the 38 player routes in routesAuthenticated.test.ts's PUBLIC + SIGNED_IN lists
} as const;

export type Route = keyof typeof HTTP;
export type GetRoute = Extract<Route, `GET ${string}`>;
export type ResOf<K extends Route> = NonNullable<(typeof HTTP)[K][typeof res]>;
export type BodyOf<K extends Route> = (typeof HTTP)[K]["body"] extends z.ZodTypeAny ? z.input<NonNullable<(typeof HTTP)[K]["body"]>> : undefined;
export type QueryOf<K extends Route> = (typeof HTTP)[K]["query"] extends z.ZodTypeAny ? z.input<NonNullable<(typeof HTTP)[K]["query"]>> : undefined;
export type PathOf<K extends Route> = K extends `${string} ${infer P}` ? P : never;
export type ParamsOf<K extends Route> = RouteParameters<PathOf<K>>;
/** What a server value may be before JSON.stringify: a Date wherever the DTO says string. */
export type Sendable<T> = T extends string ? string | Date : T extends (infer U)[] ? Sendable<U>[] : T extends object ? { [P in keyof T]: Sendable<T[P]> } : T;
```

**Invariants**
- `shared/http.ts` imports only `zod` types, `shared/*` and `lib/game/*`. Lint enforces this (§4.5).
- The client imports it with `import type` only, so neither the table nor the schemas enter the bundle. The bundle budget (`npm run bundle:budget`) catches a regression.
- **Known looseness of `Sendable`:** a `Date` is accepted wherever any string field is declared. It catches renames, missing fields and wrong primitives. It does not catch "a Date in a non-date string", and none exists today.

**`shared/httpSchemas.ts` (moved from `server/http/schemas.ts`).** It mirrors `shared/socketSchemas.ts`.
- `BUG_REPORT_LIMITS` moves with it from `server/http/bugReports.ts:26`, which then imports it.
- New schemas for the two inline checks: `UserSearchQuery` (from routes.ts:887) and `RoomCodeParam` (:878).

**Moves out of `shared/protocol.ts`**
- `FriendRequestIncoming` and `FriendRequestAccepted` are now imported from `./http.ts`. A moved import does not move the protocol hash (`tests/server/protocolVersion.test.ts:12`).
- `ServerPayload.error` is deleted. That bumps `PROTOCOL_VERSION` to 7 with a new hash. `MIN_PROTOCOL_VERSION` stays, because nothing ever sent `error`.

### 4.2 Server adapter: `server/http/mount.ts` and `server/http/access.ts` (new)

```ts
// access.ts
export function requireAuth(req, res, next): void;          // 401 NOT_AUTHENTICATED; unchanged behaviour, now exported
export function requireAdmin(req, res, next): Promise<void>; // 404 text/plain for anon and non-admin; unchanged
/** The signed-in account's row, or null after replying 401 NOT_AUTHENTICATED. */
export function loadUser(res: Response, userId: string): Promise<User | null>;

// mount.ts
type Req<K extends Route> = Request<ParamsOf<K>, Sendable<ResOf<K>> | ErrorBody, z.output<…body…>, z.output<…query…>>;
type Res<K extends Route> = Response<Sendable<ResOf<K>> | ErrorBody>;
export type Handler<K extends Route> = (req: Req<K>, res: Res<K>) => void | Promise<void>;
export type SignedInHandler<K extends Route> = (req: Req<K>, res: Res<K>, userId: string) => void | Promise<void>;

export function on<K extends Route>(app: Express, key: K, ...chain: [...RequestHandler[], Handler<K>]): void;
/** Mounts requireAuth first, then the chain; the handler receives the session's userId. */
export function onSignedIn<K extends Route>(app: Express, key: K, ...chain: [...RequestHandler[], SignedInHandler<K>]): void;
```

**Contract for callers**
1. **The key is the only spelling of the route.** `on` splits it into method and path at mount time. A key not in `HTTP` is a compile error.
2. **The body schema must be validated in the chain.** If `HTTP[key].body` is set, the chain must contain `validate(HTTP[key].body)`.
   - `validate()` (`server/http/validate.ts`) stamps its schema on the returned function.
   - Otherwise `on` throws at mount, so `createApp` fails at boot and the unit walker test (§6) fails.
   - Position in the chain is free, which keeps the per-route order that rename and register depend on.
   - The same rule applies to `query`, with `validateQuery(schema)`.
3. **Guard placement.** `onSignedIn` always mounts `requireAuth` as the first layer. It reads `req.session.userId as string` once, in the one place `requireAuth` has just guaranteed it. This removes all 26 `!`.
4. **Admin and non-API routes stay plain `app.get`** with `requireAdmin` (`/admin`, `/api/admin/version`, `/health`, the app links). They are not in `HTTP`, so their existence never reaches client types.
5. **Errors.** An async handler that rejects reaches `errorHandler` exactly as today (Express 5 forwards rejections). `on` adds no try/catch.

`server/http/accountSession.ts` (new):

```ts
/** Regenerates the session (fixation defence), revokes the prior sid's sockets (fire-and-forget, as today),
 *  sets userId and saves. Rejects with SignInError{ stage: "regenerate" | "save" } — nothing is sent on rejection. */
export function signIn(req: Request, userId: string): Promise<void>;
export function hashPassword(plain: string): Promise<string>;   // bcrypt cost 10
```

**Ordering a caller must keep:** the reply goes after `await signIn(...)`, and register's token mint goes after the reply. Today's order is :518 then :523. `authReplyBeforeMail` keeps proving it.

**Area files.** Each exports `mountX(app: Express): void` and owns its limiters (the limiters partition cleanly by area). `server/http/routes/index.ts` exports `mountApi(app)`, which calls them in today's registration order. `server/app.ts` calls `mountApi(app)` and does its own `createServer(app)`.

| file | routes | limiters |
|---|---|---|
| `routes/auth.ts` | register, login, logout, me, change-password, add-email, verify-email, resend-verification, request-password-reset, reset-password, socket-ticket | auth, loginUsername (+ decoy hash), passwordResetRequest, resetPassword, changePassword, registerEmail, addEmail, resendVerification, ticket |
| `routes/account.ts` | PATCH/DELETE users/me, tutorial-seen, push/token | rename, push |
| `routes/friends.ts` | friends/*, users/search, invites | friend |
| `routes/profile.ts` | stats/me, stats/history, stats/achievements, ratings/me, leaderboard, leaderboard/friends | — |
| `routes/replays.ts` | replays, replays/:id | — |
| `routes/reports.ts` | client-errors, bug-reports | errorReport |
| `routes/admin.ts` | /admin, /api/admin/version (plain `app.get`, `requireAdmin`) | — |
| `accountMail.ts` | `verificationEmailBody`, `passwordResetEmailBody`, `mailLocale`, both senders (the tests import these) | — |

Each ADR-0007 "Box N" comment moves with its handler, unchanged. CONTEXT.md:115 and `docs/adr/0007…md:11` get the new file path. That is a pointer edit, not a change to the decision.

**Behaviour changes. These are deliberate and pinned red to green.**
- `GET /api/auth/me` mounts through `onSignedIn` plus `loadUser`.
  - A deleted account now answers `401 NOT_AUTHENTICATED`, not `USER_NOT_FOUND`. The client cannot tell the difference: `fetchMe` maps every 401 to `null`.
  - The guard test moves `/me` from PUBLIC to SIGNED_IN.
- **Logout (L-054).** A `session.destroy` error is logged and answered `500 INTERNAL_SERVER_ERROR`, without revoking.
  - The session still stands, so "ok" would be false. This follows the route's own rule at :573-574 ("the client then keeps both").
- **Handshake (L-054).** `socket.ts:116-118` maps a `sessionMiddleware` error to `next(new Error(AUTH_UNAVAILABLE))` and logs it.
  - The client already treats it correctly: `SocketContext.tsx:314-325` backs off and retries everything except `CLIENT_OUTDATED`, and an unavailable store is transient. So the "no client consumer" half needs no client change. The consumer is the retry loop.

### 4.3 Client: `lib/query-client.ts` (transport) and `lib/queries.ts` (keys)

```ts
// lib/query-client.ts — keeps its path: 20 native tests and tests/native/setup.ts:124-130 already route expo/fetch through it
export function getApiUrl(): string;                                   // unchanged
export function urlOf<K extends Route>(key: K, params?: ParamsOf<K>, query?: QueryOf<K>): string; // fills :name with encodeURIComponent
/** Resolves the parsed JSON (undefined for 204/empty); throws ApiError(status, payload, text) on non-2xx;
 *  rethrows the fetch's own error when the server was not reached. Always credentials: "include". */
export function api<K extends Route>(key: K, input?: { params?: ParamsOf<K>; query?: QueryOf<K>; body?: BodyOf<K> }): Promise<ResOf<K>>;
export const queryClient: QueryClient;  // default queryFn = ({ queryKey: [k, params] }) => api(k, { params })

// lib/queries.ts
export function queryKey<K extends GetRoute>(key: K, params?: ParamsOf<K>): readonly [K] | readonly [K, ParamsOf<K>];
export function useApi<K extends GetRoute>(key: K, opts?: { params?: ParamsOf<K>; enabled?: boolean; staleTime?: number; refetchOnWindowFocus?: boolean }): UseQueryResult<ResOf<K>>;
export const stale = {
  afterRound: ["GET /api/stats/me", "GET /api/stats/history", "GET /api/stats/achievements", "GET /api/ratings/me",
               "GET /api/ratings/leaderboard", "GET /api/ratings/leaderboard/friends"],
  onReconnect: ["GET /api/friends", "GET /api/friends/requests", "GET /api/friends/sent", "GET /api/friends/invites"],
  friendAccepted: ["GET /api/friends", "GET /api/friends/requests", "GET /api/friends/sent"],
} as const satisfies Record<string, readonly GetRoute[]>;
export function invalidate(qc: QueryClient, routes: readonly GetRoute[]): void;   // prefix match: [k] covers [k, params]
```

**Invariants**
- **Cache keys.** A cache key is the contract key, so the key and the response type cannot disagree (the `{id}[]` / `FriendRequestInfo[]` split disappears). Prefix invalidation still works because param variants are `[k, params]`.
- **Deleted helpers.** `apiRequest`, `getQueryFn`, `lib/ladderQuery.ts` and `replayQueryKey` (`lib/game/replay.ts:70`) are deleted. Their callers use `api`, `useApi` and `queryKey`.
- **Raw fetches.** `fetchMe` and `fetchSocketTicket` take their URL from `urlOf` and their type from `ResOf`. They keep global `fetch` until the owner rules (§10). If the ruling is yes, each becomes `try { return await api(k) } catch (e) { return e instanceof ApiError && e.status === 401 ? null : undefined }`.
- **Recovery screens.** The five recovery screens keep their own request blocks and success paths. Only `apiRequest("POST", "/api/…", body)` becomes `api("POST /api/…", { body })`. The #897 enumeration-safety behaviour in `app/auth.tsx` and `app/recover.tsx` is untouched (CONTEXT.md:120-126).

### 4.4 What is deleted

- **Server files.** `server/http/routes.ts`, `server/http/schemas.ts` (moved), `lib/wire.ts` (moved), `tests/helpers/routeMountings.ts`.
- **Server repetition.** All 26 `req.session.userId!` and the inline `/me` guard; the duplicated sign-in sequence; two of the three `bcrypt.hash` sites.
- **Client.** About 60 `/api/` literals, `apiRequest`, `getQueryFn`, `lib/ladderQuery.ts` and `replayQueryKey`.
- **Tests.** `tests/tooling/audioOwners.test.ts`.
- **Contract field.** `ServerPayload.error`.

### 4.5 Import-graph rules (L-052, L-129)

- **Retargets.** `lib/game/{botPersonalities,placement,rating}.ts` and `lib/{achievements,cosmetics,cardNames}.ts` take `TranslationKey` from `shared/i18n`. `cardNames` keeps `TFn` from `lib/i18n`. This cuts the cycle at its only lib/game → client edge.
- **eslint, `modules/`.** `modules/**/*.{ts,tsx}` joins the client import-rule glob (`eslint.config.js:153`).
- **eslint, `shared/**`.** `@typescript-eslint/no-restricted-imports` with a pattern group `["**/lib/*", "!**/lib/game", "!**/lib/game/*"]`. `shared/` may import the domain, never client modules. That is the corrected form of the ledger's ban.
- **eslint, `lib/game/**`.** A block banning `**/lib/i18n` and `../i18n`.
  - **Trap:** a later flat-config block *replaces* the rule's options (`eslint.config.js:82`). This block must therefore restate `paletteLayers(null)` together with the i18n ban, or lib/game silently loses the audio-owner rule.
- **Message pointer.** `ONLY_OWNERS` (`eslint.config.js:24`) stops pointing at the deleted test.

## 5. Migration (each step leaves main green)

**Step 1 — T1: wire-type homes and lint**
- Retarget the six `TranslationKey` imports.
- Move `lib/wire.ts` to `shared/http.ts`, DTOs only for now, and update its 13 importers.
- Make `RatingView`, `LeaderboardEntry` and `AchievementStatus` aliases of the shared DTOs (identical shapes).
- Delete `ServerPayload.error`. Bump the protocol and record the hash.
- Add the eslint blocks, delete `audioOwners`, and add an ESLint positive-control test.
- Deletes: `lib/wire.ts`, `audioOwners.test.ts`, the cycle, and 3 duplicate server interfaces.

**Step 2 — T2: server contract and split**

Each bullet is one commit pair in one PR.
- **(a) Pin.** Add `tests/helpers/mountedRoutes.ts`, the Express-router walker, and point `routesAuthenticated.test.ts` at `mountApi`'s output (today: `registerRoutes(express())`). Green on old code. Then delete `routeMountings.ts`.
- **(b) Fixes, red then green.**
  - `/me` on a deleted account answers `NOT_AUTHENTICATED`.
  - Logout with a failing destroy answers 500.
  - A handshake whose session store fails answers `AUTH_UNAVAILABLE`.
- **(c) Contract and schemas.** Add the `HTTP` table, `shared/httpSchemas.ts`, `access.ts`, `mount.ts` and `accountSession.ts`.
- **(d) Move.** Move the routes area by area into `routes/*.ts`, switching each to `on`/`onSignedIn`. Fix compile errors where server views do not satisfy `Sendable<DTO>`; that is the drift L-053 is about, now visible. `createServer` moves to `app.ts`.
- **(e) Retarget the scans.** Point the six source scans at the route directory, each with a floor (§6).
- Deletes: `routes.ts`, `server/http/schemas.ts`, `routeMountings.ts`, the 26 `!`, and the duplicated sign-in sequence.

**Step 3 — T3: client reads**
- Add `queryKey`, `useApi`, `stale` and `invalidate`. Migrate every `useQuery`, `setQueryData` and `invalidateQueries` site.
- Make the default queryFn contract-driven.
- Deletes: `ladderQuery.ts`, `replayQueryKey`, `getQueryFn`, about 30 key literals, and the per-site type parameters.

**Step 4 — T4: client writes**
- Add `api()`. Migrate every `apiRequest` call site.
- Point `fetchMe` and `fetchSocketTicket` at `urlOf` and `ResOf`.
- Deletes: `apiRequest` and about 30 URL literals.

## 6. No-regression strategy

- **T1.**
  - `npm run typecheck` is the main check: moving a type is green or red at compile time.
  - Add `tests/ui-rules/importLayersLint.test.ts` on the pattern of `tests/ui-rules/noticePaintLint.test.ts`. It runs `ESLint.lintText` on four synthetic sources:
    - `modules/x/index.ts` importing `react-native-audio-api` → error;
    - `shared/x.ts` importing `../lib/i18n` → error;
    - `shared/x.ts` importing `../lib/game/gameEngine` → clean;
    - `lib/game/x.ts` importing `../i18n` → error.
  - Run red before the config change and green after. This replaces `audioOwners`' coverage, `modules/` included.
  - `tests/ui-rules/layering.test.ts` stays (upward imports).
  - `protocolVersion.test.ts` forces the bump.
- **T2. The walker replaces the scan.**
  - `mountedRoutes(app)` walks `app.router.stack` (Express 5.2.1) and returns `{ route: "VERB /path", guards: ("requireAuth"|"requireAdmin")[] }[]`.
  - It matches guards by function identity against `access.ts` exports, and throws on a sub-Router layer, so it reds and never under-reports.
  - Unit test: `const app = express(); mountApi(app)`.
    - Positive control: a fixture app with one guarded and one bare route.
    - The PUBLIC, SIGNED_IN and ADMIN lists, which are the deliberate authority and stay in the test.
    - `/api` routes minus ADMIN must equal `Object.keys(HTTP)` both ways, so the contract cannot omit or invent a route.
  - Integration test (`tests/integration/`, through `createApp`): every mounted route outside `/api` and ADMIN is in an explicit `NON_API` list (`/health`, the two `/.well-known` files, `*path` or `/`), and `/health` must be seen. This closes L-051's "mounted elsewhere" gap for the whole app.
- **T2. The six source scans.** All read `readdirSync("server/http/routes")`, plus `accountSession.ts` where relevant. Each keeps a floor that the directory listing cannot shrink.
  - `rateLimiterFactory`: limiter floor ≥ 13 summed over the directory; "every routes/ file was read" replaces "routes.ts was read".
  - `authReplyBeforeMail`: finds the handler of `on*(app, "POST /api/auth/register", …)` in `routes/auth.ts`. In the PR description, prove it is still red by swapping the reply and mint lines.
  - `sessionRevocation`:
    - **Trap:** `signIn` moves `.session.regenerate(` out of the route bodies, so register and login would vanish from the scan, and the ≥ 6 floor fails or, worse, the floor is lowered.
    - Add `signIn` to the session-ending names, and add a test that `signIn`'s body revokes, on the model of `evictUser` at :53-58.
  - `validate.test`: "no `req.body as`" runs over the directory, and its `mounts()` tsc fixture adds an `on()` mount.
  - `logRedaction`: must-read `http/routes/auth.ts`.
  - `verificationEmailBody`: imports `accountMail.ts`.
- **T2. Behaviour.** The integration suites run unchanged except for imports, and they are the pin that the move changed nothing: auth, rename, addEmail, verifyEmailLimiter, passwordReset, `authRoutesLimited`, sessionRevocation, friends. Run them locally with `DATABASE_URL` from `dev-stack.mjs`.
- **T3 / T4.**
  - Native tests that assert `apiRequest('POST', '/api/…', …)` or `setQueryData(['/api/…'])` change to the contract-key form. About 20 files, all under `tests/native/`.
  - A new native test pins `invalidate(qc, stale.afterRound)` from `OnlineGameContext`'s round-over handler, since that refresh is the one that has silently gone missing before.
  - `docReferences.test.ts` catches stale doc paths.
  - Runtime and layout are visible only to `tests/e2e/` (web): sign-in, friends, profile and ladder specs on CI.
  - Native cookie behaviour is not visible to any CI check (all Maestro flows are offline), hence §10.

## 7. Coverage table

| ID | covered by | note |
|---|---|---|
| L-034 | T2 (step 2) | Area files, `onSignedIn` (removes 26 `!`), `loadUser` (the 4 repeated lookups, `/me` code), `accountSession.signIn`/`hashPassword`, `createServer` → `app.ts`. The recovery state machine is not merged (CONTEXT.md:112-118). The full RouteSpec is rejected per verify `fix_ok` (§3). |
| L-051 | T2 (step 2a, 2e) | A live-router walk replaces the AST scan. It is file- and Router-agnostic, and the integration half covers routes outside `routes/`. The verify correction (the scan is pinned to `server/http/routes.ts`; the gap is other files) is addressed. |
| L-052 | T1 (step 1) | `TranslationKey` retargets cut the cycle. The `lib/wire` DTOs move to `shared/http.ts`, so no shared → client edge is left. Moving `RoundOverPayload` is not needed: `shared` → `lib/game` is allowed. |
| L-053 | T1 (DTO homes, dead `error`) + T2 (contract, `Sendable` typing, schemas to `shared/httpSchemas.ts`) | Verify's partial: the friend and replay DTOs were already shared and are kept. Drift becomes a compile error on both sides. |
| L-054 | T2 (step 2b) | Handshake store error → `AUTH_UNAVAILABLE`; logout destroy error logged and answered 500. The "no client consumer" claim needs no change: the retry loop at `SocketContext.tsx:314-325` is the right consumer for a transient refusal (evidence §4.2). |
| L-068 | T3 (keys, `useApi`, `stale`) + T4 (`api()`, raw fetches typed) | Staged as verify suggested. The 401-versus-unreachable distinction is kept through `ApiError.status`. Unifying the fetch implementation is an owner decision (§10). No shared hook for the auth screens. |
| L-129 | T1 (step 1) | `modules/` added to the eslint glob, `audioOwners` deleted and replaced by an ESLint positive control. The `shared/` ban is rewritten to allow `lib/game` (verify's correction). `layering.test.ts`'s upward half stays: it already covers context, components, app and server. |

## 8. Proposed tickets

### T1 — Wire types live in `shared/`: break the lib/game → client-i18n cycle and lint the layers (size: S)

- **Files:** `lib/game/{botPersonalities,placement,rating}.ts`, `lib/{achievements,cosmetics,cardNames}.ts`, `lib/wire.ts` (deleted), `shared/http.ts` (new, DTOs only), `shared/protocol.ts`, `tests/fixtures/protocolHashes.json`, `lib/i18n.ts:166,186`, `server/game/{ratings,stats}.ts`, `server/store/friendRows.ts`, `server/socket/friendships.ts`, the 13 `lib/wire` importers, `eslint.config.js`, `tests/tooling/audioOwners.test.ts` (deleted), `tests/ui-rules/importLayersLint.test.ts` (new).
- **Blocked by:** within this area, none. Across areas: **server-output**, if its ticket edits `shared/protocol.ts` (the `PROTOCOL_VERSION` and `protocolHashes.json` collision). Order the two; whichever lands second rebases the bump. **static-checks**, if it edits `eslint.config.js`.
- **Definition of done:**
  - [ ] No `lib/**` or `shared/**` file imports `TranslationKey` from `lib/i18n`.
  - [ ] `lib/wire.ts` is gone; `shared/http.ts` holds every DTO it held.
  - [ ] `RatingView`, `LeaderboardEntry` and `AchievementStatus` are the shared DTOs, not copies.
  - [ ] `ServerPayload.error` and its two readers are gone; `PROTOCOL_VERSION` is 7 with its hash; `MIN_PROTOCOL_VERSION` is unchanged.
  - [ ] eslint: `modules/` is in the client import-rule glob; there is a `shared/**` block (lib/game allowed, other lib banned) and a `lib/game/**` block (lib/i18n banned) that restates `paletteLayers(null)`.
  - [ ] `importLayersLint.test.ts` runs the four ESLint cases (§6), red before the config change and green after; `audioOwners.test.ts` is deleted; `ONLY_OWNERS` no longer cites it.
- **While iterating:** `npx tsc --noEmit` and `node --test tests/ui-rules/importLayersLint.test.ts tests/server/protocolVersion.test.ts tests/ui-rules/layering.test.ts`.
- **Before pushing:** `npm run lint`, `npm run typecheck:strict`, and the changed tests.

### T2 — The HTTP contract on the server: `shared/http.ts` table, typed `on`/`onSignedIn`, `routes.ts` split by area, guard proved from the live router (size: L)

- **Files:** `shared/http.ts` (table added), `shared/httpSchemas.ts` (moved from `server/http/schemas.ts`), `server/http/bugReports.ts`, `server/http/{access,mount,accountSession,accountMail}.ts` (new), `server/http/routes/{index,auth,account,friends,profile,replays,reports,admin}.ts` (new), `server/http/routes.ts` (deleted), `server/http/validate.ts` (stamps its schema; adds `validateQuery`), `server/app.ts`, `server/socket/socket.ts:116-118`, `server/game/{stats,ratings}.ts` and `server/http/roundHistoryView.ts` (types satisfy `Sendable`), `tests/helpers/mountedRoutes.ts` (new), `tests/helpers/routeMountings.ts` (deleted), `tests/server/{routesAuthenticated,authReplyBeforeMail,rateLimiterFactory,sessionRevocation,validate,logRedaction,verificationEmailBody}.test.ts`, one integration test for the non-API walk and the handshake, `CONTEXT.md:115`, `docs/adr/0007-…md:11`, `docs/ARCHITECTURE.md:118`.
- **Blocked by:** T1. Across areas: **server-output**, if it edits `server/socket/socket.ts`'s handshake middleware or `payload()`. **server-runtime**, if it edits `server/app.ts`'s `createApp`.
- **Definition of done:**
  - [ ] `server/http/routes.ts` no longer exists; every player route is mounted by `on`/`onSignedIn` with its key from `HTTP`; each route's middleware chain is in today's order.
  - [ ] No `req.session.userId!` remains under `server/http/`; `onSignedIn` mounts `requireAuth` first.
  - [ ] `on` throws at mount when a contract body or query schema has no matching `validate`/`validateQuery` in the chain, and a unit test shows it.
  - [ ] `mountedRoutes` walker:
    - [ ] has a positive control;
    - [ ] the unit test pins the PUBLIC, SIGNED_IN and ADMIN lists and proves the mounted `/api` set equals `HTTP` both ways;
    - [ ] the integration test proves every non-`/api` route is in an explicit list and that `/health` was seen.
  - [ ] Red then green:
    - [ ] `/me` for a deleted account answers 401 `NOT_AUTHENTICATED`;
    - [ ] logout with a failing `session.destroy` logs and answers 500;
    - [ ] a handshake whose session store errors gets `connect_error` `AUTH_UNAVAILABLE`.
  - [ ] Register and login share `accountSession.signIn`; the reply-then-mint order is unchanged, and `authReplyBeforeMail` is shown red by a line swap (PR description).
  - [ ] `sessionRevocation` counts `signIn` as session-ending and asserts that it revokes; its floor stays ≥ 6.
  - [ ] Each retargeted scan reads the directory and keeps a floor.
  - [ ] `createServer` is called in `server/app.ts`.
  - [ ] ADR-0007 Box comments travel with their handlers; CONTEXT.md and the ADR name the new path; no recovery handler is merged with another.
- **While iterating:** `npx tsc --noEmit` and `node --test tests/server/routesAuthenticated.test.ts tests/server/authReplyBeforeMail.test.ts tests/server/sessionRevocation.test.ts tests/server/rateLimiterFactory.test.ts tests/server/validate.test.ts`.
- **Before pushing:** `npm run lint`, `npm run typecheck:strict`, and the integration suites for auth, rename, addEmail, verifyEmailLimiter, passwordReset, sessionRevocation, friends and intentAcknowledged, run locally against `dev-stack.mjs`'s `DATABASE_URL`.

### T3 — Client reads go through the contract: `queryKey`, `useApi` and named invalidation sets (size: M)

- **Files:**
  - `lib/queries.ts` (new), `lib/query-client.ts` (contract-driven default queryFn; `getQueryFn` deleted), `lib/ladderQuery.ts` (deleted), `lib/game/replay.ts:70`;
  - `app/profile.tsx:545-554`, `app/index.tsx:389-397`, `app/(online)/{friends,history,leaderboard,room,replay}.tsx`;
  - `context/SocketContext.tsx:102-107,136-143,300,355-416`, `context/OnlineGameContext.tsx:683-687`;
  - the `tests/native/*` that seed or assert query keys.
- **Blocked by:** T2, for the `HTTP` table. Across areas: any **client** ticket that edits `context/SocketContext.tsx` or `context/OnlineGameContext.tsx`. These files are shared, so the two must be ordered, never parallel.
- **Definition of done:**
  - [ ] No query key, `setQueryData` or `invalidateQueries` under `app/`, `context/`, `lib/` or `components/` spells an `/api/` literal.
  - [ ] Every `useQuery` over the API is `useApi(key)`, typed from `ResOf`.
  - [ ] `stale.afterRound`, `stale.onReconnect` and `stale.friendAccepted` are the only invalidation lists for those events.
  - [ ] A native test pins that round-over invalidates `stale.afterRound`.
  - [ ] `ladderQuery.ts`, `replayQueryKey` and `getQueryFn` are deleted.
- **While iterating:** `npx tsc --noEmit` and `npx jest tests/native/<touched>`.
- **Before pushing:** `npm run lint` and `npm run test:native:related`. The e2e shards run on CI.

### T4 — Client writes go through the contract: `api(key, input)` replaces `apiRequest`; the raw fetches take their URL and type from it (size: M)

- **Files:**
  - `lib/query-client.ts` (`api`, `urlOf`; `apiRequest` deleted), `lib/socket.ts:52-69`, `context/AuthContext.tsx:50-60,134-200`;
  - `app/{recover,verify-email,profile}.tsx`, `app/(online)/friends.tsx:108-194`, `context/SocketContext.tsx:206`, `lib/{tutorialSeen,errorReporting}.ts`, `lib/device/pushRegistration.ts`, `components/SettingsModal.tsx:104,156`;
  - the native tests that mock or assert `apiRequest`.
- **Blocked by:** T3, which edits the same files. Across areas: **client** tickets touching `AuthContext` or `SocketContext`.
- **Definition of done:**
  - [ ] No `/api/` literal remains under `app/`, `context/`, `lib/` or `components/`, except in comments.
  - [ ] Every request body is typed `BodyOf<K>`, and a wrong field is a tsc error (shown by an `@ts-expect-error` line in a type fixture).
  - [ ] `api` resolves `undefined` for a 204, throws `ApiError` with status and payload on a non-2xx, and rethrows the network error. Each case has a native test.
  - [ ] `fetchMe` and `fetchSocketTicket` take their URL from `urlOf` and their type from `ResOf`, keep global `fetch` (§10), and keep their 401 → `null` / other → `undefined` contracts, pinned by the existing `authBoot` tests.
  - [ ] The five recovery screens keep their own blocks and success actions; only the call expression changes.
- **While iterating:** `npx tsc --noEmit` and `npx jest tests/native/{accountRecovery,authBoot,authLogout,registerCheckEmail,renameAccount,friendsActionFailure,errorReporting}.test.tsx`.
- **Before pushing:** `npm run lint`, `npm run test:native:related` and `npm run bundle:budget`, which proves the contract stayed type-only in the bundle.

## 9. Cross-area contracts

- **server-output:**
  - `shared/protocol.ts`: T1 deletes `ServerPayload.error` and bumps to `PROTOCOL_VERSION` 7. If server-output reshapes `ServerPayload` or the refusal payloads, one ticket must be ordered after the other on `protocolHashes.json`.
  - T2 takes `ErrorBody` as `payload()`'s return plus `details`. If server-output changes `payload()`, `ErrorBody` follows it.
  - T2 edits `server/socket/socket.ts:116-118`, the handshake session middleware only. The handshake is the refusal channel's sibling, so the order there matters too.
- **client:**
  - T3 and T4 edit `context/SocketContext.tsx`, `context/OnlineGameContext.tsx` and `context/AuthContext.tsx`.
  - Client's L-061 (re-export slice hooks) and L-144 (parts 1–2) touch the same files, so each pair must have a blocked-by edge.
  - Client F26, logout clearing local state in `finally`, is compatible with T2's logout 500, and either order works.
  - I provide `useApi`, `stale` and `api` for any client work that adds a request.
- **server-runtime:** T2 moves `createServer(app)` into `server/app.ts`'s `createApp` and replaces `registerRoutes` with `mountApi`.
- **static-checks / test-harness:**
  - T1 owns the eslint blocks for `modules/`, `shared/**` and `lib/game/**`, and deletes `audioOwners.test.ts`.
  - T2 introduces `tests/helpers/mountedRoutes.ts`, which any other route-coverage scan should reuse instead of reading files.
  - Any static-checks ticket editing `eslint.config.js` must be ordered against T1.
- **engine / lastMove / time:** none. `shared/http.ts` may import `lib/game/*` types (`GameMode`), so a rename there reaches T1's file.

## 10. Owner decisions needed

1. **One fetch implementation on native (L-068's last third).** `fetchMe` and `fetchSocketTicket` use global `fetch`; every other call, login included, uses `expo/fetch`.
   - Moving the two onto `api()` makes one transport, so cookie handling cannot diverge.
   - No CI check exercises a signed-in native session: every Maestro flow is offline (`.maestro/*.yaml`), and on web both are the same fetch.
   - T4 therefore keeps them on global `fetch`, typed and URL'd from the contract.
   - **Asked:** may a follow-up switch them to `api()`, verified on your iOS device (sign in, cold-start, open Online)?
   - Recommendation: yes. It is three lines each, and the 401 distinction survives through `ApiError.status`.

Not owner decisions, decided here on technical grounds:
- `/me`'s deleted-account code becomes `NOT_AUTHENTICATED`, which no client distinguishes.
- Logout answers 500 when the destroy fails.
- `ServerPayload.error` is deleted (no producer).
- The RouteSpec `access` field is replaced by the router walk.
- CONTEXT.md and ADR-0007 get a file-path edit only. Their decisions stand unchanged.
