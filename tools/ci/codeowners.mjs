/**
 * CODEOWNERS patterns: a trailing `/` is a directory, a pattern holding `/` is anchored at the root,
 * one without matches a file name anywhere, and `*` stays inside one path segment.
 * @param {string} pattern
 */
export function matcher(pattern) {
  const dir = pattern.endsWith("/");
  const body = dir ? pattern.slice(0, -1) : pattern;
  const glob = body
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*");
  const re = new RegExp(`${body.includes("/") ? "^" : "(^|/)"}${glob}${dir ? "/" : "$"}`);
  return (/** @type {string} */ file) => re.test(file);
}

/**
 * Whether a CODEOWNERS file gives `file` an owner to review it. The last matching line decides,
 * and a line naming no owner un-owns what it matches.
 * @param {string} text
 */
export function ownedBy(text) {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/(^|\s)#.*$/, "").trim().split(/\s+/))
    .filter(([pattern]) => pattern)
    .map(([pattern, owner]) => ({ matches: matcher(/** @type {string} */ (pattern).replace(/^\//, "")), owned: Boolean(owner) }));
  return (/** @type {string} */ file) => lines.findLast((l) => l.matches(file))?.owned ?? false;
}
