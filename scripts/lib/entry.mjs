/**
 * "Was this file run, or imported?" — one answer, for every script that has both jobs.
 *
 * Both sides resolve to a real path before comparing, so a junction or subst drive matches too.
 * A suffix match says yes to any same-named file invoked from elsewhere; comparing unresolved
 * says no to a relative invocation.
 */
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {string|undefined} argv1 `process.argv[1]`
 * @param {string} moduleUrl `import.meta.url`
 */
export function isInvokedDirectly(argv1, moduleUrl) {
  if (!argv1) return false;
  try {
    return realpathSync(path.resolve(argv1)) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
