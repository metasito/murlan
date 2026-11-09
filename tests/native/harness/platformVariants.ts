import { jest } from '@jest/globals';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
// Metro's own resolver, with the project's own source extensions: the one resolution order there is.
import { resolve as metroResolve } from 'metro-resolver';

export const OSES = ['ios', 'android', 'web'] as const;
export type OS = (typeof OSES)[number];
/** Every file that answers one import, keyed by the extensionless name the import gives: `dir/name`. */
export type Variants = Map<string, string[]>;

const PLATFORM_FILE = /^(.*?)(?:\.(?:ios|android|web|native))?\.[cm]?[jt]sx?$/;

/** The modules among `files` with a platform variant, each with every file that could answer an import of it, whatever its extension. */
export function variantsOf(files: Iterable<string>): Variants {
  const found: Variants = new Map();
  const infixed = new Set<string>();
  for (const file of files) {
    const key = PLATFORM_FILE.exec(file)?.[1];
    if (key === undefined) continue;
    found.set(key, [...(found.get(key) ?? []), file]);
    if (/\.(ios|android|web|native)\.[cm]?[jt]sx?$/.test(file)) infixed.add(key);
  }
  return new Map([...found].filter(([key]) => infixed.has(key)));
}

function sourceExts(root: string): string[] {
  const config = require(path.join(root, 'metro.config.js')) as { resolver: { sourceExts: string[] } };
  return config.resolver.sourceExts;
}

/** The file Metro answers an import of `key` with on `os`, found the way Metro finds it. */
export function loadedAs(root: string, os: OS, key: string): string | undefined {
  const lookup = (p: string) => {
    const at = path.resolve(root, p);
    return existsSync(at) ? { exists: true as const, type: statSync(at).isDirectory() ? ('d' as const) : ('f' as const), realPath: at } : { exists: false as const };
  };
  const context = {
    allowHaste: false,
    assetExts: new Set<string>(),
    customResolverOptions: {},
    disableHierarchicalLookup: true,
    doesFileExist: (p: string) => lookup(p).exists,
    extraNodeModules: null,
    dev: true,
    getPackage: () => null,
    getPackageForModule: () => null,
    fileSystemLookup: lookup,
    mainFields: [],
    originModulePath: path.join(root, path.dirname(key), '__origin__.ts'),
    nodeModulesPaths: [],
    preferNativePlatform: os !== 'web',
    resolveAsset: () => null,
    redirectModulePath: (p: string) => p,
    resolveHasteModule: () => null,
    resolveHastePackage: () => null,
    sourceExts: sourceExts(root),
    unstable_conditionNames: [],
    unstable_conditionsByPlatform: {},
    unstable_enablePackageExports: false,
    unstable_incrementalResolution: false,
    unstable_logWarning: () => {},
  };
  const found = metroResolve(context as never, `./${path.posix.basename(key)}`, os);
  return found.type === 'sourceFile' ? path.relative(root, found.filePath).split(path.sep).join('/') : undefined;
}

/** Every file on disk that could answer an import of `key`, whatever its extension. */
function answers(root: string, key: string): string[] {
  const dir = path.posix.dirname(key);
  return readdirSync(path.join(root, dir))
    .filter((f) => PLATFORM_FILE.exec(f)?.[1] === path.posix.basename(key))
    .map((f) => path.posix.join(dir, f));
}

let taken = new Map<string, string>();

/** The absolute path of every file that answers an import of a module with variants, for `os`; `platformVariant` then names the file each takes. */
export function variantTargets(root: string, os: OS, variants: Variants): string[] {
  taken = new Map();
  for (const key of variants.keys()) {
    const chosen = loadedAs(root, os, key);
    if (chosen) for (const file of answers(root, key)) taken.set(path.join(root, file), path.join(root, chosen));
  }
  return [...taken.keys()];
}

/** The file of a module, among those `variantTargets` last named, that its platform loads. */
export const platformVariant = (target: string): string => taken.get(target)!;

export function restoreVariants(root: string, variants: Variants) {
  for (const key of variants.keys()) for (const file of answers(root, key)) jest.dontMock(path.join(root, file));
}
