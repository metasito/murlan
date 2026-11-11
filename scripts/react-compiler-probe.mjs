import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { bailouts, reactCompiler, reactCompilerOptions } from "./reactCompilerOptions.mjs";
const require = createRequire(path.join(process.cwd(), "package.json"));
const { transformSync } = require("@babel/core");
// The same options tests/ui-rules/reactCompiler.test.ts compiles with, because this is
// what its failure message sends you to for the reason behind a bailout.
const OPTS = reactCompilerOptions();

for (const file of process.argv.slice(2)) {
  const events = [];
  const { ast } = transformSync(readFileSync(file, "utf8"), {
    filename: file,
    babelrc: false, configFile: false,
    ast: true, code: false,
    presets: [[require("@babel/preset-typescript"), { isTSX: true, allExtensions: true }]],
    plugins: [[reactCompiler, { ...OPTS, logger: { logEvent: (_f, e) => events.push(e) } }]],
  });
  const bail = bailouts(events, ast.program, OPTS);
  console.log(`${file}: ${bail.length ? "BAILS" : "clean"}`);
  for (const b of bail) {
    const at = b.line == null ? "" : ` (in the function at ${b.line})`;
    const where = b.blamed.length ? `line ${b.blamed.join(", ")}${at}` : b.line == null ? "" : `line ${b.line}`;
    console.log(`   ${where}  ${b.reason}`);
  }
}
