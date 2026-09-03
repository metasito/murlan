import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { payload } from "./payload.ts";

export function validate(schema: z.ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        ...payload("INVALID_PAYLOAD"),
        details: result.error.flatten().fieldErrors,
      });
    }
    req.body = result.data;
    next();
  };
}
