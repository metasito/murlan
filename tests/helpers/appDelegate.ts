import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { gunzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const { insertSwiftUIFilters } = require("../../plugins/withSwiftUIFilters.js") as { insertSwiftUIFilters: (s: string) => string };

/** The AppDelegate `expo prebuild` writes, read out of the installed template's ustar archive. */
export function templateAppDelegate(): string {
  const tar = gunzipSync(readFileSync(require.resolve("expo/template.tgz")));
  const field = (at: number, len: number) => tar.toString("latin1", at, at + len).replace(/\0.*$/s, "");
  for (let at = 0; at + 512 <= tar.length && tar[at] !== 0; ) {
    const name = field(at + 345, 155) + "/" + field(at, 100);
    const size = parseInt(field(at + 124, 12).trim(), 8) || 0;
    if (name.endsWith("/AppDelegate.swift")) return tar.toString("utf8", at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error("the installed Expo template has no AppDelegate.swift");
}

export const patchedAppDelegate = (): string => insertSwiftUIFilters(templateAppDelegate());
export { insertSwiftUIFilters };

/** The pod that compiles `file`: the podspec beside it, its name and its source globs. */
export function podOf(file: string): { name: string; sourceFiles: string } {
  const dir = path.dirname(file);
  const specs = readdirSync(dir).filter((f) => f.endsWith(".podspec"));
  if (specs.length !== 1) throw new Error(`${dir} holds ${specs.length} podspecs, not one`);
  const spec = readFileSync(path.join(dir, specs[0]), "utf8");
  const name = spec.match(/s\.name = '([^']+)'/)?.[1];
  const sourceFiles = spec.match(/s\.source_files = '([^']+)'/)?.[1];
  if (!name || !sourceFiles) throw new Error(`${specs[0]} names no pod or no sources`);
  return { name, sourceFiles };
}
