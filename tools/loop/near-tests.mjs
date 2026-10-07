import path from "node:path";

export const NATIVE_TEST = /^tests\/native\/.+\.test\.tsx$/;
export const CODE = /\.(tsx?|m?js)$/;
const stem = (f) =>
  path.posix.basename(f).replace(/\.test\.tsx$/, "").replace(/(\.(web|native|ios|android))?\.(tsx?|m?js)$/, "");

/** @param {{changed: string[], related: string[], source: (file: string) => string}} io */
export function nearTests({ changed, related, source }) {
  const modules = changed.filter((f) => CODE.test(f) && !NATIVE_TEST.test(f));
  const specs = modules.map((m) => `@/${m.replace(CODE, "")}`);
  const stems = new Set(modules.map(stem));
  const near = related.filter(
    (t) => stems.has(stem(t)) || specs.some((s) => source(t).includes(`'${s}'`) || source(t).includes(`"${s}"`)),
  );
  return [...new Set([...changed.filter((f) => NATIVE_TEST.test(f)), ...near])].sort();
}
