import type { Request, Response, NextFunction } from "express";
import { logger } from "../shared/logger.ts";
import { payload } from "../shared/payload.ts";

export const errorHandler = (err: unknown, req: Request, res: Response, next: NextFunction): void => {
  const error = err as {
    status?: number;
    statusCode?: number;
  };
  const status = error.status || error.statusCode || 500;
  (req.log ?? logger).error({ err }, "Internal Server Error");
  // Delegating destroys the socket, which a finished response does not
  // deserve: express-session saves after `res.end`, so a store failing
  // there would drop a connection the client is still pooling.
  if (res.writableEnded) return;
  if (res.headersSent) return next(err);
  // The thrown message never reaches the body: a 5xx's is whatever internal
  // thing threw, and has leaked Postgres errors naming tables and columns
  // straight into the UI.
  res.status(status).json(payload(status >= 500 ? "INTERNAL_SERVER_ERROR" : "INVALID_PAYLOAD"));
};
