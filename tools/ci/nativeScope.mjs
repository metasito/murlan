/**
 * Prints whether a change needs the Android and iOS compiles, for ci.yml's scope job, which runs
 * before any `npm ci`: only `node:` imports here. The native projects are generated from app config (CNG).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

const CONFIG = /^(app\.json|app\.config\.(js|ts)|eas\.json|modules\/.+)$/;

const deps = (text) => {
  try {
    return JSON.parse(text).dependencies ?? {};
  } catch {
    return null;
  }
};

const NATIVE_SOURCE = /(^|\/)(ios|android|apple|cpp)\/|\.(mm|m|h|cpp|java|kt|podspec)$/;

const patchIsNative = (text) =>
  text === null || [...text.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].some((m) => NATIVE_SOURCE.test(m[1]) || NATIVE_SOURCE.test(m[2]));

/** @param {(file: string) => string | null} [readPatch] */
export function needsNative(changed, before, after, readPatch = () => null) {
  if (changed.some((f) => CONFIG.test(f))) return true;
  if (changed.some((f) => f.startsWith("patches/") && patchIsNative(readPatch(f)))) return true;
  if (!changed.includes("package.json")) return false;
  const [a, b] = [deps(before), deps(after)];
  if (!a || !b) return true;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].some((k) => a[k] !== b[k]);
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  let answer = true;
  try {
    const base = process.argv[2];
    const changed = git("diff", "--name-only", base, "HEAD").split("\n").filter(Boolean);
    const before = changed.includes("package.json") ? git("show", `${base}:package.json`) : "";
    const readPatch = (f) => {
      for (const rev of ["HEAD", base]) {
        try {
          return git("show", `${rev}:${f}`);
        } catch {
          continue;
        }
      }
      return null;
    };
    answer = needsNative(changed, before, readFileSync("package.json", "utf8"), readPatch);
  } catch {
    answer = true;
  }
  console.log(answer);
}
