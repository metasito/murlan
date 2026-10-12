const { withAppDelegate } = require("expo/config-plugins");

const FACTORY = "    reactNativeFactory = factory\n";
const CALL = "    MurlanReactNativeFlags.enableSwiftUIFilters()\n";

/** The generated AppDelegate, calling the override between creating the factory and starting it (MurlanReactNativeFlags.h). */
function insertSwiftUIFilters(source) {
  if (source.includes(CALL)) return source;
  if (!source.includes(FACTORY) || !source.includes("\nimport React\n")) {
    throw new Error("withSwiftUIFilters: the AppDelegate template changed; find where the factory is created and before it starts.");
  }
  return source.replace("\nimport React\n", "\nimport React\nimport MurlanDiagnostics\n").replace(FACTORY, FACTORY + CALL);
}

module.exports = (config) =>
  withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== "swift") throw new Error(`withSwiftUIFilters: expected a Swift AppDelegate, got ${mod.modResults.language}`);
    mod.modResults.contents = insertSwiftUIFilters(mod.modResults.contents);
    return mod;
  });
module.exports.insertSwiftUIFilters = insertSwiftUIFilters;
