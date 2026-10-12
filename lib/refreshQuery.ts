import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Marks `queryKey` stale and refetches it. A bare `invalidateQueries` joins a first load still in
 * flight instead of replacing it (query-core `Query.fetch` cancels only a query holding data), so
 * that load's pre-write answer lands, reads as fresh under `staleTime: Infinity`, and stays.
 */
export async function refreshQuery(qc: QueryClient, queryKey: QueryKey): Promise<void> {
  await qc.cancelQueries({ queryKey, predicate: (q) => q.state.data === undefined });
  await qc.invalidateQueries({ queryKey });
}
