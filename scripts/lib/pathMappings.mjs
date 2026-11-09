import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..", "..");
const paths = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile).config.compilerOptions.paths;

/** tsconfig's `paths` as [prefix, repository directory]: `@/*` is ["@/", ""]. */
export const ALIASES = Object.entries(paths).map(([key, [target]]) => [
  key.replace(/\*$/, ""),
  path.posix.normalize(target.replace(/\*$/, "")).replace(/^\.\/?$/, "").replace(/^\.\//, "").replace(/\/$/, ""),
]);

/** Every aliased spelling of an extensionless repository path: `lib/x` is `@/lib/x`, and `shared/y` is also `@shared/y`. */
export function aliasedSpellings(repoPath) {
  return ALIASES.filter(([, dir]) => dir === "" || repoPath.startsWith(`${dir}/`)).map(([prefix, dir]) => prefix + repoPath.slice(dir === "" ? 0 : dir.length + 1));
}
