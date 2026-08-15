const REQUIRED_ENV = ["SESSION_SECRET", "DATABASE_URL"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) throw new Error(`Missing required secret: ${key}`);
}

import express from "express";
import type { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { logger } from "./logger";
import { sessionMiddleware } from "./session";
import { pool } from "./db";
import { registerRoutes } from "./routes";
import { isAllowedOrigin, isBehindProxy } from "./cors";
import { installProcessGuards } from "./socketSafety";
import * as fs from "fs";
import * as path from "path";

export { sessionMiddleware };

const app = express();

// Exactly one proxy hop (Replit's TLS terminator). Without this the secure
// session cookie is never sent in production and express-rate-limit buckets
// every user under the proxy's IP — one attacker locks out every login.
if (isBehindProxy()) {
  app.set("trust proxy", 1);
}

installProcessGuards();

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
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

  app.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app.use(express.static(path.resolve(process.cwd(), "static-build")));

  if (hasWebBuild) {
    // Web build present — serve SPA for browser clients
    app.use(express.static(distPath));
    // Catch-all: any non-API path not matched by static files gets index.html (SPA routing)
    app.get("*path", (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith("/api")) return next();
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
      const message = error.message || "Internal Server Error";
      logger.error({ err }, "Internal Server Error");
      if (res.headersSent) return next(err);
      return res.status(status).json({ message });
    }
  );
}

(async () => {
  setupCors(app);
  setupBodyParsing(app);
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

  const { setupSocket } = await import("./socket");
  setupSocket(server);

  setupErrorHandler(app);

  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen({ port, host: "0.0.0.0", reusePort: true }, () => {
    logger.info(`express server serving on port ${port}`);
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Graceful shutdown initiated");
    server.close(async () => {
      await pool.end();
      logger.info("Server shut down cleanly");
      process.exit(0);
    });
    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10_000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
})();
