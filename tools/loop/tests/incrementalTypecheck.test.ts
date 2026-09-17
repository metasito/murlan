// tools/loop/tests/incrementalTypecheck.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const TSC = require.resolve("typescript/bin/tsc");
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const options = (file = "tsconfig.json") => {
  const { config } = ts.readConfigFile(path.join(ROOT, file), ts.sys.readFile);
  return ts.parseJsonConfigFileContent(config, ts.sys, ROOT).options;
};

test("both typecheck configs are incremental, with their build info beside the config and ignored", () => {
  assert.equal(options("tsconfig.strictIndexed.json").incremental, true);
  assert.equal(options("tsconfig.strictIndexed.json").tsBuildInfoFile, undefined);
  const o = options();
  assert.equal(o.incremental, true);
  assert.equal(o.noEmit, true);
  assert.equal(o.tsBuildInfoFile, undefined, "node_modules is shared across worktrees; one build info would thrash");
  assert.match(fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8"), /^\*\.tsbuildinfo$/m);
});

test("a cached build still reports an error a dependency's edit introduces, run after run", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "incremental-"));
  try {
    const { incremental, noEmit } = options();
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, incremental, noEmit }, include: ["*.ts"] }),
    );
    fs.writeFileSync(path.join(dir, "b.ts"), 'import { v } from "./a";\nexport const w: number = v;\n');
    const write = (body: string) => fs.writeFileSync(path.join(dir, "a.ts"), body);
    const tsc = () => spawnSync(process.execPath, [TSC, "-p", dir], { encoding: "utf8" });

    write("export const v = 1;\n");
    assert.equal(tsc().status, 0);
    assert.ok(fs.readdirSync(dir).some((f) => f.endsWith(".tsbuildinfo")), "no build info was written");

    write('export const v = "s";\n');
    for (const run of [tsc(), tsc()]) {
      assert.notEqual(run.status, 0);
      assert.match(run.stdout, /b\.ts.*TS2322/);
    }

    write("export const v = 2;\n");
    assert.equal(tsc().status, 0);

    const config = (extra: object) =>
      fs.writeFileSync(
        path.join(dir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { strict: true, incremental, noEmit, ...extra }, include: ["*.ts"] }),
      );
    write("export const v = 2;\nexport const xs: number[] = [];\nexport const n: number = xs[0];\n");
    assert.equal(tsc().status, 0);
    config({ noUncheckedIndexedAccess: true });
    assert.match(tsc().stdout, /a\.ts.*TS2322/, "a config change must invalidate the cached build");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
