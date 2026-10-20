import { z } from "zod";
import type { RequestHandler, Response } from "express";
import type { ParamsDictionary } from "express-serve-static-core";
import { payload, type ServerCode } from "../shared/payload.ts";
import { RouteParam } from "../../shared/httpSchemas.ts";

/** Read by server/http/mount.ts, which refuses a contract schema no layer of the chain validates. */
export const VALIDATES = Symbol("validates");

export type Validates = { [VALIDATES]: { in: "body" | "query"; schema: z.ZodTypeAny } };

export function validate<S extends z.ZodTypeAny>(
  schema: S
): RequestHandler<ParamsDictionary, unknown, z.infer<S>> & Validates {
  const handler: RequestHandler<ParamsDictionary, unknown, z.infer<S>> = (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        ...payload("INVALID_PAYLOAD"),
        details: result.error.flatten().fieldErrors,
      });
      return;
    }
    req.body = result.data;
    next();
  };
  return Object.assign(handler, { [VALIDATES]: { in: "body" as const, schema } });
}

/** A query the schema refuses answers 400 with `refusal`, the route's own code, and no field detail. */
export function validateQuery<S extends z.ZodTypeAny>(schema: S, refusal: ServerCode): RequestHandler & Validates {
  const handler: RequestHandler = (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({ ...payload(refusal) });
      return;
    }
    // Express 5's `req.query` is a getter with no setter, so the parsed value is
    // defined over it on the request itself.
    Object.defineProperty(req, "query", { value: result.data, enumerable: true });
    next();
  };
  return Object.assign(handler, { [VALIDATES]: { in: "query" as const, schema } });
}

/** The parsed path segment, or null after having already sent a 400. */
export function readParam(res: Response, raw: unknown): string | null {
  const parsed = RouteParam.safeParse(raw);
  if (!parsed.success) {
    res.status(400).json({ ...payload("INVALID_PARAMETER") });
    return null;
  }
  return parsed.data;
}
