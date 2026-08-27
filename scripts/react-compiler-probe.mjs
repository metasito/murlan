import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
const require = createRequire(path.join(process.cwd(), "package.json"));
// Resolved through Node, not `cwd + "node_modules/…"`: a git worktree has no
// `node_modules` of its own and depends on the ancestor lookup finding the
// real one.
const presetRequire = createRequire(require.resolve("babel-preset-expo/package.json"));
const { transformSync } = require("@babel/core");
const reactCompiler = presetRequire("babel-plugin-react-compiler");
const OPTS = { target: "19", environment: { enableResetCacheOnSourceFileChanges: false }, panicThreshold: "NONE" };

for (const file of process.argv.slice(2)) {
  const events = [];
  transformSync(readFileSync(file, "utf8"), {
    filename: file,
    babelrc: false, configFile: false,
    presets: [[require("@babel/preset-typescript"), { isTSX: true, allExtensions: true }]],
    plugins: [[reactCompiler, { ...OPTS, logger: { logEvent: (_f, e) => events.push(e) } }]],
  });
  const bail = events.filter((e) => e.kind === "CompileError");
  console.log(`${file}: ${bail.length ? "BAILS" : "clean"}`);
  for (const b of bail) {
    console.log(`   line ${b.fnLoc?.start?.line}  ${b.detail?.reason ?? ""} ${b.detail?.description ?? ""}`);
  }
}
