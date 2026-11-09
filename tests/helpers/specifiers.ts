import { builtinModules, createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..", "..");

const paths = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile).config.compilerOptions.paths as Record<string, string[]>;

/** The project's path mappings, as [prefix, repository directory]: `@/*` is ["@/", ""]. */
export const ALIASES: readonly (readonly [string, string])[] = Object.entries(paths).map(
  ([key, [target]]) => [key.replace(/\*$/, ""), path.posix.normalize(target!.replace(/\*$/, "")).replace(/^\.\/?$/, "").replace(/^\.\//, "")] as const,
);

export type Resolved = { kind: "local"; path: string } | { kind: "package"; name: string };

const here = createRequire(path.join(root, "package.json"));
const installed = (name: string) =>
  [name, `@types/${name.replace(/^@(.*)\/(.*)$/, "$1__$2")}`].some((dir) => {
    try {
      here.resolve(`${dir}/package.json`);
      return true;
    } catch (err) {
      return (err as { code?: string }).code === "ERR_PACKAGE_PATH_NOT_EXPORTED";
    }
  });

const packageName = (spec: string) => spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/");

/**
 * What a specifier names, from the file `from` (repository-relative, posix): a repository path
 * (extension not tried) or a package. A specifier that is none of those throws, so a scanner
 * never skips what it cannot place.
 */
export function resolveSpecifier(from: string, spec: string, strict = true): Resolved {
  if (spec.startsWith(".")) return { kind: "local", path: path.posix.join(path.posix.dirname(from), spec) };
  for (const [prefix, dir] of ALIASES) if (spec.startsWith(prefix)) return { kind: "local", path: path.posix.join(dir, spec.slice(prefix.length)) };
  const name = spec.startsWith("node:") ? spec : packageName(spec);
  if (!strict || name.startsWith("node:") || builtinModules.includes(name) || installed(name)) return { kind: "package", name };
  throw new Error(`${from}: "${spec}" is no relative path, no mapped path and no installed package`);
}

/** The repository path (posix, extension not tried) a specifier names, or null for a package. A fixture may name a package that is not installed: pass `strict = false`. */
export const localPath = (from: string, spec: string, strict = true): string | null => {
  const r = resolveSpecifier(from, spec, strict);
  return r.kind === "local" ? r.path : null;
};
