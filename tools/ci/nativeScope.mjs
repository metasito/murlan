/**
 * Whether a change needs the Android and iOS compiles, for `scope.mjs`, which runs before any
 * `npm ci`: only `node:` imports here. The native projects are generated from app config (CNG).
 */

export const CONFIG = /^(app\.json|app\.config\.(js|ts)|eas\.json|modules\/.+|plugins\/.+)$/;

const deps = (text) => {
  try {
    return JSON.parse(text).dependencies ?? {};
  } catch {
    return null;
  }
};

const NATIVE_SOURCE = /(^|\/)(ios|android|apple|cpp)\/|\.(mm|m|h|hpp|c|cpp|swift|java|kt|gradle|podspec)$/;

const unquote = (p) => (p.startsWith('"') ? p.slice(1, -1).replace(/\\([0-7]{3}|.)/g, (_, e) => (e.length === 3 ? "_" : e)) : p);

// git quotes a path with special characters, and leaves one with spaces bare.
const headerPaths = (rest) => rest.split(/ (?="?b\/)/).map((p) => unquote(p).replace(/^[ab]\//, ""));

const patchIsNative = (text) => {
  if (text === null) return true;
  const headers = [...text.matchAll(/^diff --git (.+?)\r?$/gm)];
  return headers.length === 0 || headers.some((m) => headerPaths(m[1]).some((p) => NATIVE_SOURCE.test(p)));
};

export const patchReader = (show, base) => (f) => {
  for (const rev of ["HEAD", base]) {
    try {
      return show(rev, f);
    } catch {
      continue;
    }
  }
  return null;
};

/** @param {(file: string) => string | null} [readPatch] */
export function needsNative(changed, before, after, readPatch = () => null) {
  if (changed.some((f) => CONFIG.test(f))) return true;
  if (changed.some((f) => f.startsWith("patches/") && patchIsNative(readPatch(f)))) return true;
  if (!changed.includes("package.json")) return false;
  const [a, b] = [deps(before), deps(after)];
  if (!a || !b) return true;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].some((k) => a[k] !== b[k]);
}
