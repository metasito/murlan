import { z } from "zod";
import type { RequestHandler } from "express";
import type { ParamsDictionary } from "express-serve-static-core";
import { payload } from "../socket/payload.ts";

export function validate<S extends z.ZodTypeAny>(schema: S): RequestHandler<ParamsDictionary, unknown, z.infer<S>> {
  return (req, res, next) => {
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
}
