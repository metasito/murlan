import express from "express";
import type { Request, Response, NextFunction } from "express";
import compression from "compression";
import helmet from "helmet";
import pinoHttp from "pino-http";
import type { Server as HttpServer } from "node:http";
import type { Server as SocketIOServer } from "socket.io";
import { logger } from "./logger.ts";
import { sessionMiddleware } from "./session.ts";
import { pool } from "./db.ts";
import { registerRoutes } from "./routes.ts";
import { ensureSchema } from "./schemaDdl.ts";
import { isAllowedOrigin, isBehindProxy } from "./cors.ts";
import * as fs from "fs";
import * as path from "path";

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function setupCors(app: express.Application) {
  app.use((req, res, next) => {
    const origin = req.header("origin");
    res.header("Vary", "Origin");
    if (origin && isAllowedOrigin(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
      );
      res.header("Access-Control-Allow-Headers", "Content-Type");
      res.header("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
  });
}

function setupBodyParsing(app: express.Application) {
  app.use(
    express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } })
  );
  app.use(express.urlencoded({ extended: false }));
}

function getAppName(): string {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveExpoManifest(platform: string, res: Response) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json"
  );
  if (!fs.existsSync(manifestPath)) {
    return res
      .status(404)
      .json({ error: `Manifest not found for platform: ${platform}` });
  }
  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");
  res.send(fs.readFileSync(manifestPath, "utf-8"));
}

function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName,
}: {
  req: Request;
  res: Response;
  landingPageTemplate: string;
  appName: string;
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const host = req.header("x-forwarded-host") || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;
  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}

function configureExpoAndLanding(app: express.Application) {
  const distPath = path.resolve(process.cwd(), "dist");
  const webIndexPath = path.join(distPath, "index.html");
  const hasWebBuild = fs.existsSync(webIndexPath);

  // Expo Go sends manifest requests to both / and /manifest with expo-platform header
  const expoManifestHandler = (req: Request, res: Response, next: NextFunction) => {
    const platform = req.header("expo-platform");
    if (platform === "ios" || platform === "android")
      return serveExpoManifest(platform, res);
    next();
  };
  app.use("/manifest", expoManifestHandler);
  app.get("/", expoManifestHandler);

  // Unhashed source assets — a deploy can change what a given path serves,
  // so this cannot be cached as long as the content-hashed build output below.
  app.use("/assets", express.static(path.resolve(process.cwd(), "assets"), { maxAge: "1h" }));
  app.use(express.static(path.resolve(process.cwd(), "static-build")));

  if (hasWebBuild) {
    // Every file under dist/ carries a content hash in its name (Metro's
    // doing), so a given URL's bytes never change — safe to cache for a
    // year. `index.html` is the one file in this tree without a hash, and
    // it names the current hashed bundle; caching it long would pin a
    // client to a stale build with no recovery short of a hard refresh.
    // `index: false` stops this mount from auto-serving it for "/" so the
    // catch-all below is the only path that ever sends it, with its own
    // explicit no-cache header.
    app.use(express.static(distPath, { maxAge: "1y", immutable: true, index: false }));
    // Catch-all: any non-API path not matched by static files gets index.html (SPA routing)
    app.get("*path", (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith("/api")) return next();
      res.set("Cache-Control", "no-cache");
      res.sendFile(webIndexPath);
    });
    logger.info("Serving Expo web build from dist/");
  } else {
    // No web build — show Expo Go QR landing page
    const templatePath = path.resolve(process.cwd(), "server", "templates", "landing-page.html");
    const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
    const appName = getAppName();
    app.get("/", (req: Request, res: Response) => {
      serveLandingPage({ req, res, landingPageTemplate, appName });
    });
    logger.info("No web build found — serving Expo Go landing page");
  }
}

function setupErrorHandler(app: express.Application) {
  app.use(
    (err: unknown, _req: Request, res: Response, next: NextFunction) => {
      const error = err as {
        status?: number;
        statusCode?: number;
        message?: string;
      };
      const status = error.status || error.statusCode || 500;
      logger.error({ err }, "Internal Server Error");
      if (res.headersSent) return next(err);
      // A 4xx message was chosen for the caller (a body-parse failure, say);
      // a 5xx message is whatever internal thing threw, and has leaked
      // Postgres errors naming tables and columns straight into the UI.
      if (status >= 500) {
        return res.status(status).json({
          message: "Internal server error",
          code: "INTERNAL_SERVER_ERROR",
        });
      }
      return res.status(status).json({ message: error.message || "Bad request" });
    }
  );
}

export interface CreatedApp {
  app: express.Express;
  server: HttpServer;
  io: SocketIOServer;
}

/**
 * Builds the full Express + Socket.io app — middleware, CORS, sessions,
 * routes, sockets, error handler — but does not bind a port or install
 * process shutdown handlers. `server/index.ts` owns both of those (the
 * Replit run path), so this factory can also be called directly by the
 * integration test harness (`tests/helpers/testServer.ts`) to boot the real
 * server against a throwaway database schema without ever listening on the
 * real PORT.
 */
export async function createApp(): Promise<CreatedApp> {
  const app = express();

  // Exactly one proxy hop (Replit's TLS terminator). Without this the secure
  // session cookie is never sent in production and express-rate-limit buckets
  // every user under the proxy's IP — one attacker locks out every login.
  if (isBehindProxy()) {
    app.set("trust proxy", 1);
  }

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === "/health" },
    })
  );

  setupCors(app);
  setupBodyParsing(app);

  // Before every response-generating handler — the static asset mounts and
  // registerRoutes' API responses both need to pass through this to be
  // compressed. Socket.io is unaffected regardless of position here: it
  // attaches to the raw http.Server, not the Express middleware chain.
  app.use(compression());

  // Before the session middleware, which reads `session` on the very first
  // request that carries a cookie — and before any route touches a table.
  await ensureSchema(pool);

  app.use(sessionMiddleware);

  app.get("/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({
        status: "ok",
        db: "connected",
        uptime: Math.floor(process.uptime()),
        env: process.env.NODE_ENV,
      });
    } catch (err) {
      logger.error({ err }, "Health check DB failure");
      res.status(503).json({ status: "error", db: "disconnected" });
    }
  });

  configureExpoAndLanding(app);

  const server = await registerRoutes(app);

  const { setupSocket } = await import("./socket.ts");
  const io = setupSocket(server);

  setupErrorHandler(app);

  return { app, server, io };
}
