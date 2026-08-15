/**
 * Single source of truth for the CORS allowlist, shared by the Express
 * middleware and the socket.io server (which previously used `origin: "*"`
 * together with `credentials: true` — an invalid and permissive combination).
 */
export function allowedOrigins(): Set<string> {
  const origins = new Set<string>();
  if (process.env.REPLIT_DEV_DOMAIN)
    origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
  if (process.env.REPLIT_DOMAINS) {
    process.env.REPLIT_DOMAINS.split(",").forEach((d: string) =>
      origins.add(`https://${d.trim()}`)
    );
  }
  return origins;
}

export function isAllowedOrigin(origin: string | undefined | null): boolean {
  // No Origin header: native clients (React Native, Expo Go) and same-origin
  // server-to-server calls. Nothing to check against, and blocking it would
  // break the mobile app.
  if (!origin) return true;
  const isLocalhost =
    origin.startsWith("http://localhost:") ||
    origin.startsWith("http://127.0.0.1:");
  return isLocalhost || allowedOrigins().has(origin);
}

/**
 * Replit terminates TLS in front of the app. Without `trust proxy` Express
 * never sees the connection as secure, so `cookie.secure = true` silently
 * drops every session cookie in production, and express-rate-limit keys every
 * request on the proxy IP (one global bucket for all users).
 */
export function isBehindProxy(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    !!process.env.REPLIT_DOMAINS ||
    !!process.env.REPLIT_DEV_DOMAIN
  );
}
