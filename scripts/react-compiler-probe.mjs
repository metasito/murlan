import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { reactCompiler, reactCompilerOptions } from "./reactCompilerOptions.mjs";
const require = createRequire(path.join(process.cwd(), "package.json"));
const { transformSync } = require("@babel/core");
// The same options tests/ui-rules/reactCompiler.test.ts compiles with, because this is
// what its failure message sends you to for the reason behind a bailout.
const OPTS = reactCompilerOptions();

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
    // The function's own line is where the bailout is *reported*; the detail
    // carries the line that caused it, which is the one worth reading.
    const opts = b.detail?.options ?? b.detail;
    const blamed = (opts?.details ?? [])
      .map((d) => `${d.loc?.start?.line}:${d.loc?.identifierName ?? ""}`)
      .join(", ");
    const where = blamed ? `line ${blamed} (in the hook at ${b.fnLoc?.start?.line})` : `line ${b.fnLoc?.start?.line}`;
    console.log(`   ${where}  ${opts?.reason ?? ""} ${opts?.description ?? ""}`);
  }
}
