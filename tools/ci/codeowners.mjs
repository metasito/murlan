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
 * Whether a CODEOWNERS file gives `file` an owner to review it.
 * @param {string} text
 */
export function ownedBy(text) {
  const matchers = text
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .filter(([pattern, owner]) => pattern && !pattern.startsWith("#") && owner)
    .map(([pattern]) => matcher(/** @type {string} */ (pattern).replace(/^\//, "")));
  return (/** @type {string} */ file) => matchers.some((m) => m(file));
}
