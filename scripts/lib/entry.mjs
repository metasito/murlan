/**
 * "Was this file run, or imported?" — one answer, for every script that has both jobs.
 *
 * It was written nine times in seven shapes. Three were this; three matched a bare suffix of
 * `process.argv[1]`, which says yes to any same-named file invoked from anywhere else; one compared
 * paths without resolving, so a relative invocation silently said no and the script did nothing.
 * A test could only ever pin the copy it imported.
 *
 * Resolve both sides to a filesystem path before comparing: `import.meta.url` is a URL and
 * `process.argv[1]` is whatever the caller typed.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {string|undefined} argv1 `process.argv[1]`
 * @param {string} moduleUrl `import.meta.url`
 */
export function isInvokedDirectly(argv1, moduleUrl) {
  if (!argv1) return false;
  try {
    return path.resolve(argv1) === fileURLToPath(moduleUrl);
  } catch {
    return false;
  }
}
