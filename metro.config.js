const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// @expo/vector-icons ships Ionicons and Feather whole — together 82% of the font
// bytes the web downloaded — for the few dozen glyphs this app draws.
// scripts/build-icon-fonts.mjs writes the subsets; this is what makes the bundle
// use them. tests/tooling/iconSubset.test.ts fails if a new icon is used that the subsets
// were not built with.
const ICON_SUBSETS = {
  Ionicons: path.resolve(__dirname, "assets/fonts/Ionicons.subset.ttf"),
  Feather: path.resolve(__dirname, "assets/fonts/Feather.subset.ttf"),
};
config.resolver.assetExts.push("flac");

// zod re-exports every locale it has as `z.locales`, and Metro does not tree-shake, so all of them
// shipped (about 38 KB gzipped) for the English one zod registers by itself. Nothing reads
// `z.locales` (tests/tooling/zodLocales.test.ts).
const ZOD_LOCALES = path.join(path.dirname(require.resolve("zod/package.json")), "v4", "locales", "index.");

const defaultResolve = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const family = Object.keys(ICON_SUBSETS).find((f) => moduleName.endsWith(`/Fonts/${f}.ttf`));
  if (family) return { type: "sourceFile", filePath: ICON_SUBSETS[family] };
  const resolved = (defaultResolve ?? context.resolveRequest)(context, moduleName, platform);
  return resolved.type === "sourceFile" && resolved.filePath.startsWith(ZOD_LOCALES) ? { type: "empty" } : resolved;
};

// Metro's transform cache is machine-wide, and its key covers neither the project root nor
// the `EXPO_PUBLIC_*` values babel inlines into the code it caches. Both are inputs the
// transform genuinely depends on, so both belong in the key.
// See docs/agents/traps.md, "Remaining traps".
const inlinedEnv = Object.keys(process.env)
  .filter((k) => k.startsWith("EXPO_PUBLIC_"))
  .sort()
  .map((k) => `${k}=${process.env[k]}`)
  .join(",");

config.cacheVersion = `${config.cacheVersion}-${__dirname}-${inlinedEnv}`;

module.exports = config;
