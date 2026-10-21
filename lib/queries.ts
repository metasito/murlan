import { useQuery, type QueryClient, type UseQueryOptions, type UseQueryResult } from "@tanstack/react-query";
import type { GetRoute, ParamsOf, QueryOf, ResOf } from "@/shared/http";
import { api, apiPath } from "./query-client";

/** A cacheable read: a GET in the contract, named by its path under /api, that takes no query string. */
export type Read = GetRoute extends infer R
  ? R extends `GET /api/${infer P}`
    ? QueryOf<R & GetRoute> extends undefined
      ? P
      : never
    : never
  : never;

type RouteOf<P extends Read> = Extract<GetRoute, `GET /api/${P}`>;
type Params<P extends Read> = keyof ParamsOf<RouteOf<P>> extends never ? [] : [params: ParamsOf<RouteOf<P>>];
export type Answer<P extends Read> = ResOf<RouteOf<P>>;
/** A read whose answer is a list of rows with ids, which a pushed row can be seated in. */
export type ListRead = { [P in Read]: Answer<P> extends readonly { id: string }[] ? P : never }[Read];
export type Row<P extends ListRead> = Answer<P>[number];

declare const read: unique symbol;
/** One cache entry: the URL it is read from, and at the type level which read answers it. */
export type ApiKey<P extends Read = Read> = readonly [url: string] & { readonly [read]: P };

export function queryKey<P extends Read>(path: P, ...[params]: Params<P>): ApiKey<P> {
  return [apiPath(path, params as Record<string, string> | undefined)] as unknown as ApiKey<P>;
}

export function useApi<P extends Read>(
  key: ApiKey<P>,
  options: Omit<UseQueryOptions<Answer<P>>, "queryKey" | "queryFn"> = {}
): UseQueryResult<Answer<P>> {
  return useQuery<Answer<P>>({ ...options, queryKey: key, queryFn: () => api(key) });
}

export const ladderBoards = {
  global: queryKey("ratings/leaderboard"),
  friends: queryKey("ratings/leaderboard/friends"),
} as const;
const ladder = Object.values(ladderBoards);
const friendLists = [queryKey("friends"), queryKey("friends/requests"), queryKey("friends/sent")];

/** What each event can have moved, the server being the one who knows by how much. */
export const stale = {
  afterRound: [
    queryKey("stats/me"),
    queryKey("stats/history"),
    queryKey("stats/achievements"),
    queryKey("ratings/me"),
    ...ladder,
  ],
  /** The ladder is the only cached list that carries the viewer's own name. */
  afterRename: ladder,
  /** A push to a socket that was down reaches nobody and is never retried. */
  onReconnect: [...friendLists, queryKey("friends/invites")],
  friendAccepted: friendLists,
} as const satisfies Record<string, readonly ApiKey[]>;

export function markStale(qc: QueryClient, keys: readonly ApiKey[]): void {
  for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
}
