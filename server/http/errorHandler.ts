import type { Request, Response, NextFunction } from "express";
import { logger } from "./logger.ts";
import { payload } from "../socket/payload.ts";

export const errorHandler = (err: unknown, req: Request, res: Response, next: NextFunction): void => {
  const error = err as {
    status?: number;
    statusCode?: number;
    message?: string;
  };
  const status = error.status || error.statusCode || 500;
  (req.log ?? logger).error({ err }, "Internal Server Error");
  // Delegating destroys the socket, which a finished response does not
  // deserve: express-session saves after `res.end`, so a store failing
  // there would drop a connection the client is still pooling.
  if (res.writableEnded) return;
  if (res.headersSent) return next(err);
  // A 4xx message was chosen for the caller (a body-parse failure, say);
  // a 5xx message is whatever internal thing threw, and has leaked
  // Postgres errors naming tables and columns straight into the UI.
  if (status >= 500) {
    res.status(status).json({ ...payload("INTERNAL_SERVER_ERROR") });
    return;
  }
  res
    .status(status)
    .json({ message: error.message || "Bad request", code: "INVALID_PAYLOAD" });
};
