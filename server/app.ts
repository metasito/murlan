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

// `unsafe-inline` for both scripts and styles is forced by what Expo emits:
// `dist/index.html` carries an inline bootstrap script and two inline <style>
// blocks, and react-native-web injects its rules at runtime. unpkg is the QR
// library the Expo Go landing page loads, pinned by an integrity hash.
// `upgrade-insecure-requests` is deliberately absent — it breaks the http
// dev server.
const CSP_DIRECTIVES = {
  "default-src": ["'self'"],
  "script-src": ["'self'", "'unsafe-inline'", "https://unpkg.com"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:", "blob:"],
  "font-src": ["'self'", "data:"],
  "connect-src": ["'self'", "ws:", "wss:"],
  "worker-src": ["'self'", "blob:"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "frame-ancestors": ["'none'"],
  "form-action": ["'self'"],
};

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
    // Expo Go, not a player, reads this: plain text, no code, nothing to translate.
    return res
      .status(404)
      .type("text/plain")
      .send(`Manifest not found for platform: ${platform}`);
  }
  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");
  res.send(fs.readFileSync(manifestPath, "utf-8"));
}

const HOSTNAME = /^[A-Za-z0-9.-]+(:\d+)?$/;

// The Host and X-Forwarded-Host headers are client-controlled and the value
// lands inside a string literal in the landing page's inline script.
function safeHost(raw: string | undefined): string {
  if (raw && HOSTNAME.test(raw)) return raw;
  return (
    process.env.REPLIT_DEV_DOMAIN ||
    process.env.REPLIT_DOMAINS?.split(",")[0]?.trim() ||
    "localhost"
  );
}

function renderLandingPage(template: string, host: string, appName: string): string {
  // Function replacements: a string one expands `$&`, `` $` `` and `$'`.
  return template
    .replace(/EXPS_URL_PLACEHOLDER/g, () => host)
    .replace(/APP_NAME_PLACEHOLDER/g, () => appName);
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
  const host = safeHost(req.header("x-forwarded-host") || req.get("host"));
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(renderLandingPage(landingPageTemplate, host, appName));
}

export const __testables = { safeHost, renderLandingPage, CSP_DIRECTIVES };

// Metro names its build output with a 32-hex content hash — `<name>.<hash>.<ext>`
// for assets (optionally followed by an `@2x` density suffix) and
// `<name>-<hash>.<ext>` for the JS bundles. Those URLs never change their bytes.
const CONTENT_HASHED = /[.-][0-9a-f]{32}(@[0-9]+x)?\.[^.]+$/;

/**
 * Cache-Control for one file under `dist/`. Content-hashed files get a year;
 * everything else — `index.html`, `favicon.ico`, `metadata.json` — keeps its
 * URL across deploys, so caching it long pins the client to a build that no
 * longer exists, with no recovery short of a hard refresh.
 */
function setDistCacheControl(res: Response, filePath: string) {
  res.setHeader(
    "Cache-Control",
    CONTENT_HASHED.test(path.basename(filePath))
      ? "public, max-age=31536000, immutable"
      : "no-cache"
  );
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

  // scripts/moveSourceMaps.mjs already moves every .map out of dist/ after
  // export, so this never matches a real file — it exists so that guarantee
  // does not depend only on that script having run. A .map carries
  // sourcesContent, the original unminified source; server/sourceMaps.ts is
  // the only reader, from sourcemaps/, never over HTTP.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.endsWith(".map")) return res.status(404).end();
    next();
  });

  // Unhashed source assets — a deploy can change what a given path serves,
  // so this cannot be cached as long as the content-hashed build output below.
  app.use("/assets", express.static(path.resolve(process.cwd(), "assets"), { maxAge: "1h" }));
  app.use(express.static(path.resolve(process.cwd(), "static-build")));

  if (hasWebBuild) {
    // dist/ is a mix, so the header is decided per file rather than per mount:
    // most of it is content-hashed, three files (index.html, favicon.ico,
    // metadata.json) are not.
    app.use(express.static(distPath, { setHeaders: setDistCacheControl }));
    // Catch-all: any non-API path not matched by static files gets index.html (SPA routing)
    app.get("*path", (req: Request, res: Response, next: NextFunction) => {
      // /admin is server-rendered and owner-only, and registerRoutes runs
      // after this mount — without the exclusion the SPA shell answers it, so
      // every visitor gets a 200 and the owner never sees the dashboard.
      if (req.path.startsWith("/api") || req.path === "/admin") return next();
      res.set("Cache-Control", "no-cache");
      // `root` here, rather than folding it into an absolute path: without
      // it `send` dotfile-checks every segment of the *filesystem* path, so
      // a checkout under a dot directory (a worktree under `.claude/`, say)
      // 404s every client-side route instead of serving the SPA shell.
      res.sendFile("index.html", { root: distPath });
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
      // Delegating destroys the socket, which a finished response does not
      // deserve: express-session saves after `res.end`, so a store failing
      // there would drop a connection the client is still pooling.
      if (res.writableEnded) return;
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
      return res
        .status(status)
        .json({ message: error.message || "Bad request", code: "INVALID_PAYLOAD" });
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
      contentSecurityPolicy: {
        useDefaults: false,
        directives: CSP_DIRECTIVES,
      },
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
