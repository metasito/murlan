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

// Replit writes its own run logs under `.local/state/workflow-logs`, and rotates
// them while the packager is running. Metro's fallback watcher opens a handle on
// every directory it walks, so a log file that disappears between the walk and
// the watch throws ENOENT out of an fs callback — which nothing catches, and the
// packager exits. Nothing here is source, so keep the watcher out of it.
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : config.resolver.blockList
      ? [config.resolver.blockList]
      : []),
  /[\\/]\.local[\\/]state[\\/].*/,
];

// Metro keeps one transform cache for the whole machine (`%TEMP%/metro-cache`), and
// `getTransformCacheKey` is handed `projectRoot` but never hashes it. `babel-preset-expo`
// inlines expo-router's app root into `expo-router/_ctx.web.js` as a path relative to that
// file — one physical file shared by every checkout, since a worktree's `node_modules` is a
// junction to this one. So two checkouts need different output from the same input and land
// on the same cache entry: whichever exported first wins, and the other gets a bundle whose
// route context points at a directory Metro is not watching. It carries `_layout`, no routes,
// and fails nowhere until the browser 404s. `cacheVersion` is the only part of that key a
// config can reach.
config.cacheVersion = `${config.cacheVersion}-${__dirname}`;

module.exports = config;
