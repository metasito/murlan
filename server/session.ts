import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "./db.ts";

/** What `/api/auth/*` puts on the session, and what the socket handshake reads back. */
declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}

const PgSession = connectPgSimple(session);

const isProduction = process.env.NODE_ENV === "production";

export const sessionMiddleware = session({
  store: new PgSession({
    pool,
    tableName: "session",
    createTableIfMissing: false,
  }),
  secret: process.env.SESSION_SECRET!,
  resave: false,
  saveUninitialized: false,
  proxy: isProduction,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    // Requires `app.set("trust proxy", 1)` (see server/index.ts): behind
    // Replit's TLS terminator Express otherwise never considers the connection
    // secure and silently refuses to send this cookie at all.
    secure: isProduction,
    // Deliberately "lax", not "none": the production web build is served from
    // the same origin as this API, and native clients do not implement
    // SameSite at all — so "lax" costs nothing and keeps the CSRF surface
    // closed (a cross-site form POST would otherwise ride the session).
    // Native sockets, which genuinely cannot carry this cookie, authenticate
    // with the single-use ticket from /api/auth/socket-ticket instead.
    sameSite: "lax",
  },
});
