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

/** The two prefixes under which the build and the repo emit files, and nothing else. */
const STATIC_MOUNT = /^\/(assets|_expo)\//;

/**
 * Marks a request the SPA catch-all answered. `express.static` sets no
 * `req.route` and neither does a wildcard worth logging, so without this a file
 * that is present and one that is missing are the same line: both 200, both
 * with no address. A symbol rather than a field, so nothing serializes it.
 */
export const ANSWERED_BY_SHELL = Symbol("murlan.answeredByShell");

/**
 * One of four words for a request no route claimed, so that a lost file under
 * `dist/` and a scan sweep of the API are not the same line. Never the path
 * itself: the only text an unmatched request carries is whatever the client
 * chose to ask for.
 *
 * `shell` is the one that names a fault — a request shaped like a build file
 * that the SPA fallback answered with `index.html`, which is what a deploy
 * missing a bundle looks like from the outside. It is not a 404, so the status
 * code alone reports nothing.
 */
export function unmatchedKind(
  pathname: string,
  answeredByShell = false
): "api" | "asset" | "shell" | "other" {
  if (pathname === "/api" || pathname.startsWith("/api/")) return "api";
  // A URL path, so never the platform-flavoured `path.basename`: on Windows it
  // would cut `/xundle-<hash>.js` at the backslash and the deploy would not.
  const name = path.posix.basename(pathname);
  if (STATIC_MOUNT.test(pathname) || CONTENT_HASHED.test(name) || SHELL_FILES.has(name))
    return answeredByShell ? "shell" : "asset";
  return "other";
}
