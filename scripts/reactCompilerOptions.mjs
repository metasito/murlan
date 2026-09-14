import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(repoRoot, "package.json"));
// Resolved through Node, not `repoRoot + "node_modules/…"`: a git worktree has
// no `node_modules` of its own and depends on the ancestor lookup finding the
// real one.
export const presetRequire = createRequire(require.resolve("babel-preset-expo/package.json"));
export const reactCompiler = presetRequire("babel-plugin-react-compiler");

/**
 * What babel-preset-expo passes babel-plugin-react-compiler for this repo,
 * asked of the preset rather than copied from it. `getReactCompilerPlugin` is
 * not exported and takes an options object the preset assembles internally, so
 * running babel.config.js through `loadOptions` is the only reading that cannot
 * drift from the build's. The caller is Metro's for a production client bundle;
 * get a flag wrong and the preset omits the plugin rather than erroring, which
 * is what the throw is for.
 */
export function reactCompilerOptions() {
  const { plugins } = require("@babel/core").loadOptions({
    root: repoRoot,
    configFile: path.join(repoRoot, "babel.config.js"),
    babelrc: false,
    filename: path.join(repoRoot, "components", "probe.tsx"),
    caller: {
      name: "metro",
      bundler: "metro",
      platform: "ios",
      isDev: false,
      isServer: false,
      isReactServer: false,
      isNodeModule: false,
      isHMREnabled: false,
      supportsReactCompiler: true,
      supportsStaticESM: true,
    },
  });
  const entry = plugins.find((p) => p.key === "react-forget");
  if (!entry?.options) {
    throw new Error(
      "babel-preset-expo returned no babel-plugin-react-compiler entry for a production client " +
        "build, so either app.json stopped turning the compiler on or the caller flags here no " +
        "longer reach it — and nothing asking this is running under the compiler at all"
    );
  }
  return entry.options;
}
