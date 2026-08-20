const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// @expo/vector-icons ships Ionicons and Feather whole — together 82% of the font
// bytes the web downloaded — for the few dozen glyphs this app draws.
// scripts/build-icon-fonts.mjs writes the subsets; this is what makes the bundle
// use them. tests/iconSubset.test.ts fails if a new icon is used that the subsets
// were not built with.
const ICON_SUBSETS = {
  Ionicons: path.resolve(__dirname, "assets/fonts/Ionicons.subset.ttf"),
  Feather: path.resolve(__dirname, "assets/fonts/Feather.subset.ttf"),
};

const defaultResolve = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const family = Object.keys(ICON_SUBSETS).find((f) => moduleName.endsWith(`/Fonts/${f}.ttf`));
  if (family) return { type: "sourceFile", filePath: ICON_SUBSETS[family] };
  return (defaultResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
