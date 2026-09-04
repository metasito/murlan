import { pathToFileURL } from "node:url";

/**
 * Whether a Replit dev-preview sync attempt is a stopped workspace, a real
 * success, or a real failure — decided from the HTTP response itself, never
 * from a pipeline's exit status. See #905: the guard this replaces derived
 * its truth from `printf … | grep -q`, whose own exit code could go wrong
 * for reasons that had nothing to do with what Replit actually said.
 *
 * Replit answers every request to a workspace that is not running with a
 * 404. A *running* workspace answering 404 would mean the hook path itself
 * is wrong — a configuration error that could never have worked once — so
 * 404 is treated as "stopped" unconditionally.
 *
 * @param {{ code?: string | number, status: number, body?: string }} result
 *   `code` — the HTTP status curl's `--write-out '%{http_code}'` reported
 *   (curl prints `000` when it never got a response at all). `status` —
 *   curl's own exit code from the same invocation, called without `--fail`:
 *   0 means a response arrived, of whatever status. `body` accepted for the
 *   caller's own message-building; the verdict itself never reads it.
 * @returns {"stopped" | "ok" | "failed"}
 */
export function verdict({ code, status }) {
  const httpCode = String(code ?? "");
  if (httpCode === "404") return "stopped";
  if (status === 0 && /^2\d\d$/.test(httpCode)) return "ok";
  return "failed";
}

// CLI entry point for the workflow: `node replitSyncVerdict.mjs <code> <status>`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , code, status] = process.argv;
  process.stdout.write(verdict({ code, status: Number(status) }));
}
