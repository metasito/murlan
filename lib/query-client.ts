import { fetch } from "expo/fetch";
import { QueryClient } from "@tanstack/react-query";
import type { BodyOf, ParamsOf, QueryOf, ResOf, Route } from "@/shared/http";
import { ApiError, parseServerPayload } from "./apiError";
import type { Answer, ApiKey, Read } from "./queries";

export function getApiUrl(): string {
  const host = process.env.EXPO_PUBLIC_DOMAIN;

  if (!host) {
    // Web build served from the same origin — use the current origin for relative API calls
    if (typeof window !== "undefined") {
      return window.location.origin;
    }
    throw new Error("EXPO_PUBLIC_DOMAIN is not set");
  }

  return new URL(host.includes("://") ? host : `https://${host}`).href;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new ApiError(res.status, parseServerPayload(text), text);
  }
}

/** A contract route named by its method and its path under /api, the way lib/queries.ts names a read. */
export type Call = Route extends infer R ? (R extends `${infer M} /api/${infer P}` ? `${M} ${P}` : never) : never;
export type RouteOf<C extends Call> = C extends `${infer M} ${infer P}` ? Extract<Route, `${M} /api/${P}`> : never;
export type Reply<C extends Call> = ResOf<RouteOf<C>>;
export type Sent<C extends Call> = BodyOf<RouteOf<C>>;

type Fields<K extends Route> = (BodyOf<K> extends undefined ? unknown : { body: BodyOf<K> }) &
  (keyof ParamsOf<K> extends never ? unknown : { params: ParamsOf<K> }) &
  (QueryOf<K> extends undefined ? unknown : { query: QueryOf<K> });
type Input<C extends Call> = Fields<RouteOf<C>>;
type Args<C extends Call> = object extends Input<C> ? [] : [input: Input<C>];

/** `/api/<path>` with each `:name` filled from `params`. */
export function apiPath(path: string, params?: Record<string, string>): string {
  return `/api/${path.replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(params![name]))}`;
}

function split(call: string): [method: string, path: string] {
  const space = call.indexOf(" ");
  return [call.slice(0, space), call.slice(space + 1)];
}

/** The absolute URL of a call, for the two requests that must tell a 401 apart and so keep their own fetch. */
export function urlOf<C extends Call>(call: C, ...[params]: keyof ParamsOf<RouteOf<C>> extends never ? [] : [ParamsOf<RouteOf<C>>]): string {
  return new URL(apiPath(split(call)[1], params as Record<string, string> | undefined), getApiUrl()).toString();
}

/**
 * Sends one request of the contract, or reads one cache key, and answers its JSON — `undefined`
 * for a 204. Throws an `ApiError` for any non-2xx, and whatever `fetch` threw when nothing came back.
 */
export function api<P extends Read>(key: ApiKey<P>): Promise<Answer<P>>;
export function api<C extends Call>(call: C, ...input: Args<C>): Promise<Reply<C>>;
export async function api(target: string | ApiKey, input: { body?: unknown; params?: Record<string, string>; query?: Record<string, string> } = {}): Promise<unknown> {
  const [method, path] = typeof target === "string" ? split(target) : ["GET", null];
  const url = new URL(path === null ? target[0] : apiPath(path, input.params), getApiUrl());
  if (input.query) url.search = new URLSearchParams(input.query).toString();
  const res = await fetch(url.toString(), {
    method,
    headers: input.body ? { "Content-Type": "application/json" } : {},
    body: input.body ? JSON.stringify(input.body) : undefined,
    credentials: "include",
  });
  await throwIfResNotOk(res);
  return res.status === 204 ? undefined : res.json();
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
