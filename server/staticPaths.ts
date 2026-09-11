// What the app's own static mounts could have answered, decided from the path
// alone. `server/app.ts` uses it to pick a Cache-Control; `server/logger.ts`
// uses it to say what kind of request went unmatched without writing the path,
// which is the client's own text.
import path from "node:path";

// Metro names its build output with a 32-hex content hash — `<name>.<hash>.<ext>`
// for assets (optionally followed by an `@2x` density suffix) and
// `<name>-<hash>.<ext>` for the JS bundles. Those URLs never change their bytes.
export const CONTENT_HASHED = /[.-][0-9a-f]{32}(@[0-9]+x)?\.[^.]+$/;

/** The files under `dist/` that keep their URL across deploys. */
const SHELL_FILES = new Set(["index.html", "favicon.ico", "metadata.json"]);

/** Where `configureExpoAndLanding` mounts `express.static`. */
const STATIC_MOUNT = /^\/(assets|_expo)\//;

/**
 * One of three words for a request no route claimed, so that a lost file under
 * `dist/` and a scan sweep of the API are not the same line. Never the path
 * itself: the only text an unmatched request carries is whatever the client
 * chose to ask for.
 *
 * A missing asset does not 404 — the SPA catch-all answers it with the shell,
 * 200 — so the status code alone cannot tell the two apart.
 */
export function unmatchedKind(pathname: string): "api" | "asset" | "other" {
  if (pathname === "/api" || pathname.startsWith("/api/")) return "api";
  const name = path.basename(pathname);
  if (STATIC_MOUNT.test(pathname) || CONTENT_HASHED.test(name) || SHELL_FILES.has(name))
    return "asset";
  return "other";
}
