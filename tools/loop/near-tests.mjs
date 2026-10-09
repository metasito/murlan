import path from "node:path";

export const NATIVE_TEST = /^tests\/native\/.+\.test\.tsx$/;
export const CODE = /\.(tsx?|m?js)$/;
export const LOCAL_PROJECTS = ["ios", "compiled"];
const stem = (f) =>
  path.posix.basename(f).replace(/\.test\.tsx$/, "").replace(/(\.(web|native|ios|android))?\.(tsx?|m?js)$/, "");

/**
 * Changed test files first, then tests named after a changed module, then importers: `capNear`
 * keeps the head of this order.
 *
 * @param {{changed: string[], related: string[], source: (file: string) => string}} io
 */
export function nearTests({ changed, related, source }) {
  const modules = changed.filter((f) => CODE.test(f) && !NATIVE_TEST.test(f));
  const specs = modules.map((m) => `@/${m.replace(CODE, "")}`);
  const stems = new Set(modules.map(stem));
  const named = related.filter((t) => stems.has(stem(t)));
  const importers = related.filter((t) => specs.some((s) => source(t).includes(`'${s}'`) || source(t).includes(`"${s}"`)));
  return [...new Set([...changed.filter((f) => NATIVE_TEST.test(f)).sort(), ...named.sort(), ...importers.sort()])];
}

export const NEAR_CAP = 10;

/** @param {string[]} tests in priority order */
export function capNear(tests, cap = NEAR_CAP) {
  return { run: tests.slice(0, cap), left: tests.length > cap ? `… ${tests.length - cap} more left to ci.yml native` : null };
}

/** jest `--listTests` prints a project banner among the absolute paths. */
export function listedTests(out, cwd) {
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((f) => path.isAbsolute(f))
    .map((f) => path.relative(cwd, f).replaceAll("\\", "/"));
}
