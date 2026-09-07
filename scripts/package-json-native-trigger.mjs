// Whether a package.json edit can change what either native project compiles
// — anything but a non-lifecycle `.scripts` entry. `postinstall` runs
// patch-package, which edits native sources directly (.github/workflows/ci.yml
// `scope` job), so the install-lifecycle scripts must stay in the comparison
// or this exempts the exact edit it exists to catch. Not to be confused with
// scripts/native-scope.mjs, which answers a different question: whether a
// change can reach the native *jest* suite.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const INSTALL_LIFECYCLE_SCRIPTS = ["preinstall", "install", "postinstall", "prepare"];

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeysDeep(value[k])]));
  }
  return value;
}

function normalize(pkg) {
  const { scripts = {}, ...rest } = pkg;
  const lifecycle = {};
  for (const key of INSTALL_LIFECYCLE_SCRIPTS) {
    if (key in scripts) lifecycle[key] = scripts[key];
  }
  return sortKeysDeep({ ...rest, scripts: lifecycle });
}

/**
 * @param {string} beforeText @param {string} afterText @returns {boolean}
 * A parse failure fails unsafe (true) — same posture as the workflow around this call.
 */
export function packageJsonTouchesNative(beforeText, afterText) {
  let before, after;
  try {
    before = JSON.parse(beforeText);
    after = JSON.parse(afterText);
  } catch {
    return true;
  }
  return JSON.stringify(normalize(before)) !== JSON.stringify(normalize(after));
}

export function isInvokedDirectly(argv1, moduleUrl) {
  return Boolean(argv1) && pathToFileURL(path.resolve(argv1)).href === moduleUrl;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const [baseRef] = process.argv.slice(2);
  if (!baseRef) {
    console.error("usage: package-json-native-trigger.mjs <base-ref>");
    process.exit(2);
  }
  let beforeText;
  try {
    beforeText = execFileSync("git", ["show", `${baseRef}:package.json`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    beforeText = "{}"; // package.json didn't exist at the base — an add, which is a native trigger.
  }
  const afterText = readFileSync("package.json", "utf8");
  console.log(packageJsonTouchesNative(beforeText, afterText) ? "native" : "not-native");
}
