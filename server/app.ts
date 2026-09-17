import express from "express";
import type { Request, Response, NextFunction } from "express";
import compression from "compression";
import helmet from "helmet";
import type { Server as HttpServer } from "node:http";
import type { SocketServer as SocketIOServer } from "./socketTypes.ts";
import { createRequestLogger, logger } from "./logger.ts";
import { sessionMiddleware } from "./session.ts";
import { pool } from "./db.ts";
import { socketAdapterPoolStats } from "./socketAdapter.ts";
import { errorHandler } from "./errorHandler.ts";
import { installServerErrorRecorder } from "./serverErrors.ts";
import { registerRoutes } from "./routes.ts";
import { ensureSchema } from "./schemaDdl.ts";
import { allowedOrigins, isAllowedOrigin, isBehindProxy } from "./cors.ts";
import { registerGithubDevSyncHook } from "./devSyncHook.ts";
import { checkMailConfigOnBoot } from "./mail.ts";
import { ANSWERED_BY_SHELL, CONTENT_HASHED } from "./staticPaths.ts";
import { testOnlyEnv } from "./testOnlyEnv.ts";
import { createHash, randomBytes } from "node:crypto";
import * as fs from "fs";
import * as path from "path";

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function distRoot(): string {
  return path.resolve(process.cwd(), testOnlyEnv("MURLAN_WEB_DIST") ?? "dist");
}

/**
 * Every inline <script> Expo exported, as a CSP hash. Read from the built file
 * rather than pinned as a literal: a value written down here would go stale on
 * the next export with nothing to catch it, and a script-src that no longer
 * names the bootstrap is a blank page.
 */
function inlineScriptHashes(): string[] {
  let html: string;
  try {
    html = fs.readFileSync(path.join(distRoot(), "index.html"), "utf-8");
  } catch {
    return [];
  }
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => createHash("sha256").update(m[1] ?? "", "utf8").digest("base64"))
    .map((digest) => `'sha256-${digest}'`);
}

/**
 * The websocket origins the client is allowed to open, mirroring
 * `isAllowedOrigin` — a bare `ws:`/`wss:` names every host on the internet.
 */
function socketOrigins(): string[] {
  const origins = [...allowedOrigins()].map((o) => o.replace(/^https:/, "wss:"));
  if (process.env.NODE_ENV !== "production")
    origins.push("ws://localhost:*", "ws://127.0.0.1:*");
  return origins;
}

// `unsafe-inline` for styles is forced by what Expo emits: `dist/index.html`
// carries two inline <style> blocks and react-native-web injects its rules at
// runtime, neither of which a hash can cover. Its inline *scripts* are hashed
// above. `upgrade-insecure-requests` is deliberately absent — it breaks the
// http dev server.
const cspDirectives = () => ({
  "default-src": ["'self'"],
  "script-src": ["'self'", ...inlineScriptHashes()],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:", "blob:"],
  "font-src": ["'self'", "data:"],
  "connect-src": ["'self'", ...socketOrigins()],
  "worker-src": ["'self'", "blob:"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "frame-ancestors": ["'none'"],
  "form-action": ["'self'"],
});

/**
 * The landing page's own header. Its inline script interpolates the request's
 * host, so its bytes differ per request and no hash can name it; the QR library
 * it loads is wanted nowhere else in the app.
 */
function landingPageCsp(nonce: string): string {
  const directives = {
    ...cspDirectives(),
    "script-src": ["'self'", `'nonce-${nonce}'`, "https://unpkg.com"],
  };
  return Object.entries(directives)
    .map(([name, values]) => [name, ...values].join(" "))
    .join("; ");
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

function renderLandingPage(template: string, host: string, appName: string, nonce = ""): string {
  // Function replacements: a string one expands `$&`, `` $` `` and `$'`.
  return template
    .replace(/EXPS_URL_PLACEHOLDER/g, () => host)
    .replace(/APP_NAME_PLACEHOLDER/g, () => appName)
    .replace(/NONCE_PLACEHOLDER/g, () => nonce);
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
  const nonce = randomBytes(16).toString("base64");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Security-Policy", landingPageCsp(nonce));
  res.status(200).send(renderLandingPage(landingPageTemplate, host, appName, nonce));
}

export const __testables = { safeHost, renderLandingPage, cspDirectives, landingPageCsp };

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
  const distPath = distRoot();
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
      // Read by `loggedRequest`: the shell answering a request shaped like a
      // build file is how a deploy that lost one looks from the outside, and
      // it is a 200 like any other.
      (req as Request & { [ANSWERED_BY_SHELL]?: true })[ANSWERED_BY_SHELL] = true;
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
  installServerErrorRecorder();
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
        directives: cspDirectives(),
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(createRequestLogger());

  setupCors(app);
  setupBodyParsing(app);
  registerGithubDevSyncHook(app);

  // Before every response-generating handler — the static asset mounts and
  // registerRoutes' API responses both need to pass through this to be
  // compressed. Socket.io is unaffected regardless of position here: it
  // attaches to the raw http.Server, not the Express middleware chain.
  app.use(compression());

  // Before the session middleware, which reads `session` on the very first
  // request that carries a cookie — and before any route touches a table.
  await ensureSchema(pool);
  checkMailConfigOnBoot();

  app.use(sessionMiddleware);

  app.get("/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      // Unauthenticated, and scheduled probes are not the only readers: the
      // deployed commit and the environment name are `GET /api/admin/version`.
      res.json({
        status: "ok",
        db: "connected",
        uptime: Math.floor(process.uptime()),
        adapterPool: socketAdapterPoolStats(),
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

  app.use(errorHandler);

  return { app, server, io };
}
