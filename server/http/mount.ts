import type { Express, Request, RequestHandler, Response } from "express";
import type { ParsedQs } from "qs";
import type { z } from "zod";
import {
  HTTP,
  type ErrorBody,
  type ParamsOf,
  type ParsedBodyOf,
  type ParsedQueryOf,
  type ResOf,
  type Route,
  type Sendable,
} from "../../shared/http.ts";
import { requireAuth } from "./access.ts";
import { VALIDATES, type Validates } from "./validate.ts";

type Reply<K extends Route> = Sendable<ResOf<K>> | ErrorBody;
type Body<K extends Route> = ParsedBodyOf<K> extends undefined ? { [field: string]: unknown } | undefined : ParsedBodyOf<K>;
type Query<K extends Route> = ParsedQueryOf<K> extends undefined ? ParsedQs : ParsedQueryOf<K>;

export type Req<K extends Route> = Request<ParamsOf<K>, Reply<K>, Body<K>, Query<K>>;
export type Res<K extends Route> = Response<Reply<K>>;
export type Handler<K extends Route> = (req: Req<K>, res: Res<K>) => void | Promise<void>;
export type SignedInHandler<K extends Route> = (req: Req<K>, res: Res<K>, userId: string) => void | Promise<void>;

const VERBS = { GET: "get", POST: "post", PUT: "put", PATCH: "patch", DELETE: "delete" } as const;

function route(key: Route): { verb: (typeof VERBS)[keyof typeof VERBS]; path: string } {
  const [method, path] = key.split(" ") as [keyof typeof VERBS, string];
  return { verb: VERBS[method], path };
}

/** Throws at mount — so at boot — when the chain and the contract disagree about what is validated. */
function assertValidated(key: Route, chain: readonly unknown[]): void {
  const contract = HTTP[key] as { body?: z.ZodTypeAny; query?: z.ZodTypeAny };
  const validators = chain
    .map((layer) => (layer as Partial<Validates>)[VALIDATES])
    .filter((v): v is Validates[typeof VALIDATES] => v !== undefined);
  for (const where of ["body", "query"] as const) {
    const schema = contract[where];
    const checked = validators.filter((v) => v.in === where);
    if (schema && !checked.some((v) => v.schema === schema)) {
      throw new Error(`${key}: HTTP names a ${where} schema that no layer of its chain validates`);
    }
    if (checked.some((v) => v.schema !== schema)) {
      throw new Error(`${key}: its chain validates a ${where} schema HTTP does not name`);
    }
  }
}

/** Mounts `key` from the contract; a key not in HTTP is a compile error, and the key is the route's only spelling. */
export function on<K extends Route>(app: Express, key: K, ...chain: [...RequestHandler[], Handler<K>]): void {
  assertValidated(key, chain);
  const { verb, path } = route(key);
  app[verb](path, ...(chain as RequestHandler[]));
}

/** Mounts requireAuth first, then the chain; the handler receives the userId requireAuth has just proved. */
export function onSignedIn<K extends Route>(
  app: Express,
  key: K,
  ...chain: [...RequestHandler[], SignedInHandler<K>]
): void {
  assertValidated(key, chain);
  const handler = chain[chain.length - 1] as SignedInHandler<K>;
  const middleware = chain.slice(0, -1) as RequestHandler[];
  const signedIn: Handler<K> = (req, res) => handler(req, res, req.session.userId as string);
  const { verb, path } = route(key);
  app[verb](path, requireAuth, ...middleware, signedIn as unknown as RequestHandler);
}
