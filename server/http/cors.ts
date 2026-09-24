import runtime from "../../deploy/runtime.json" with { type: "json" };

/**
 * Single source of truth for the CORS allowlist, shared by the Express
 * middleware and the socket.io server.
 */
export function allowedOrigins(): Set<string> {
  const origins = new Set<string>();
  if (process.env.PUBLIC_HOST) origins.add(`https://${process.env.PUBLIC_HOST}`);
  for (const origin of process.env.ALLOWED_ORIGINS?.split(",") ?? []) {
    if (origin.trim()) origins.add(origin.trim());
  }
  return origins;
}

export function isAllowedOrigin(origin: string | undefined | null): boolean {
  // No Origin header: the native app and same-origin
  // server-to-server calls. Nothing to check against, and blocking it would
  // break the mobile app.
  if (!origin) return true;
  // Localhost is only trusted with credentials outside production; the dev
  // loop needs it, production does not.
  const isLocalhost =
    origin.startsWith("http://localhost:") ||
    origin.startsWith("http://127.0.0.1:");
  if (isLocalhost && process.env.NODE_ENV !== "production") return true;
  return allowedOrigins().has(origin);
}

/**
 * Production sits behind the host's TLS terminator. Without `trust proxy`
 * Express never sees the connection as secure, so `cookie.secure = true`
 * silently drops every session cookie, and express-rate-limit keys every
 * request on the proxy IP (one global bucket for all users).
 */
export function trustProxySetting(): number | false {
  return process.env.NODE_ENV === "production" ? runtime.proxyHops : false;
}
