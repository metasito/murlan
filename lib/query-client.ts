import { fetch } from "expo/fetch";
import { QueryClient } from "@tanstack/react-query";
import type { BodyOf, ParamsOf, QueryOf, ResOf, Route } from "@/shared/http";
import { ApiError, parseServerPayload } from "./apiError";
import type { Answer, ApiKey, Read } from "./queries";

/** Native has a `window` without a `location`, so only the web build can fall back to its own origin. */
export function hasServer(): boolean {
  return Boolean(process.env.EXPO_PUBLIC_DOMAIN) || typeof window?.location?.origin === "string";
}

export function getApiUrl(): string {
  const host = process.env.EXPO_PUBLIC_DOMAIN;

  if (!host) {
    if (typeof window?.location?.origin === "string") return window.location.origin;
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
/** `any` is tested first because it also extends `void`. */
export type Unvoided<R> = 0 extends 1 & R ? R : [R] extends [void] ? undefined : R;
export type Reply<C extends Call> = Unvoided<ResOf<RouteOf<C>>>;
export type Sent<C extends Call> = BodyOf<RouteOf<C>>;

type ParamsField<K extends Route> = keyof ParamsOf<K> extends never ? unknown : { params: ParamsOf<K> };
type Fields<K extends Route> = (undefined extends BodyOf<K> ? { body?: Exclude<BodyOf<K>, undefined> } : { body: BodyOf<K> }) &
  ParamsField<K> &
  (QueryOf<K> extends undefined ? unknown : { query: QueryOf<K> });
type Optional<I> = object extends I ? [input?: I] : [input: I];
type Args<C extends Call> = Optional<Fields<RouteOf<C>>>;

export function apiPath(path: string, params?: Record<string, string>): string {
  return `/api/${path.replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(params![name]))}`;
}

function split(call: string): [method: string, path: string] {
  const space = call.indexOf(" ");
  return [call.slice(0, space), call.slice(space + 1)];
}

function urlFor(apiPathname: string): URL {
  return new URL(apiPathname, getApiUrl());
}

/** The `fetch` arguments of a call, for the two requests that must tell a 401 apart and so keep their own fetch (D9). */
export function requestOf<C extends Call>(call: C, ...[input]: Optional<ParamsField<RouteOf<C>>>): [url: string, init: RequestInit] {
  const [method, path] = split(call);
  const { params } = (input ?? {}) as { params?: Record<string, string> };
  return [urlFor(apiPath(path, params)).toString(), { method, credentials: "include" }];
}

/**
 * Sends one request of the contract, or reads one cache key, and answers its JSON — `undefined`
 * for a 204 or 205. Throws an `ApiError` for any non-2xx or any other 2xx whose body is not JSON,
 * an empty one included, and whatever `fetch` threw when nothing came back.
 */
export function api<P extends Read>(key: ApiKey<P>): Promise<Answer<P>>;
export function api<C extends Call>(call: C, ...input: Args<C>): Promise<Reply<C>>;
export async function api(target: string | ApiKey, input: { body?: unknown; params?: Record<string, string>; query?: Record<string, string> } = {}): Promise<unknown> {
  const [method, path] = typeof target === "string" ? split(target) : ["GET", null];
  const url = urlFor(path === null ? target[0] : apiPath(path, input.params));
  if (input.query) url.search = new URLSearchParams(input.query).toString();
  const res = await fetch(url.toString(), {
    method,
    headers: input.body ? { "Content-Type": "application/json" } : {},
    body: input.body ? JSON.stringify(input.body) : undefined,
    credentials: "include",
  });
  await throwIfResNotOk(res);
  if (res.status === 204 || res.status === 205) return undefined;
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(res.status, null, text);
  }
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
