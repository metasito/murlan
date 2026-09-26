import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deadlineMs, FILE_DEADLINE_MS } from "../helpers/fileDeadline.mjs";
import { RUN_IDLE_MS, runIdleMs } from "../helpers/filesRunReporter.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).scripts.test as string;

const PLANTED = {
  "syncChild.test.mjs":
    'import { test } from "node:test";\nimport { execFileSync } from "node:child_process";\n' +
    'test("waits on a child", () => { execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 20000)"]); });\n',
  "topLevel.test.mjs": 'import "node:test";\nawait new Promise(() => setInterval(() => {}, 1000));\n',
};

describe("a test file that never finishes fails npm test by name", () => {
  test("npm test's own flags kill each planted hang and name it", async () => {
    const [node, ...args] = script.split(" ").slice(0, -1);
    assert.equal(node, "node");
    const dir = mkdtempSync(path.join(tmpdir(), "planted-hang-"));
    try {
      for (const [name, body] of Object.entries(PLANTED)) writeFileSync(path.join(dir, name), body);
      const env = { ...process.env };
      env.MURLAN_TEST_FILE_DEADLINE_MS = "2000";
      delete env.NODE_TEST_CONTEXT;
      const files = Object.keys(PLANTED).map((f) => path.join(dir, f));
      const run = await new Promise<{ code: unknown; out: string }>((resolve) =>
        execFile(process.execPath, [...args, ...files], { cwd: repoRoot, env, timeout: 60_000 }, (err, stdout, stderr) =>
          resolve({ code: err ? err.code : 0, out: stdout + stderr })
        )
      );
      assert.equal(run.code, 1, run.out);
      for (const name of Object.keys(PLANTED)) assert.ok(run.out.includes(`${name}: still running after 2s`), run.out);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the deadline can be shortened and never lengthened or switched off", () => {
    assert.equal(deadlineMs({ MURLAN_TEST_FILE_DEADLINE_MS: "2000" }), 2000);
    for (const asked of [String(FILE_DEADLINE_MS * 10), "0", "-1", "off", undefined]) {
      assert.equal(deadlineMs({ MURLAN_TEST_FILE_DEADLINE_MS: asked }), FILE_DEADLINE_MS);
    }
  });
});

describe("a run that stops hearing from its files fails by name", () => {
  test("a runner whose own loop stops is killed, naming the files it had in flight", async () => {
    const reporter = pathToFileURL(path.join(repoRoot, "tests", "helpers", "filesRunReporter.mjs")).href;
    const file = path.join(repoRoot, "tests", "fake.test.ts");
    const blocked = [
      `import filesRun from ${JSON.stringify(reporter)};`,
      "async function* source() {",
      `  yield { type: "test:dequeue", data: { nesting: 0, name: ${JSON.stringify(file)}, file: ${JSON.stringify(file)} } };`,
      "  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);",
      "}",
      "for await (const line of filesRun(source())) process.stdout.write(line);",
    ].join("\n");
    const env = { ...process.env };
    env.MURLAN_TEST_RUN_IDLE_MS = "2000";
    delete env.NODE_TEST_CONTEXT;
    const run = await new Promise<{ signal: unknown; out: string }>((resolve) =>
      execFile(process.execPath, ["--input-type=module", "-e", blocked], { cwd: repoRoot, env, timeout: 30_000 }, (err, stdout, stderr) =>
        resolve({ signal: err?.killed ? "timed out" : err?.signal, out: stdout + stderr })
      )
    );
    assert.equal(run.signal, "SIGKILL", run.out);
    assert.match(run.out, /nothing reported for 2s; still running: tests\/fake\.test\.ts/);
  });

  test("its idle limit outlasts a file's own deadline, and can only be shortened", () => {
    assert.ok(RUN_IDLE_MS > FILE_DEADLINE_MS, "a stuck file is named by its own guard first");
    assert.equal(runIdleMs({ MURLAN_TEST_RUN_IDLE_MS: "2000" }), 2000);
    for (const asked of [String(RUN_IDLE_MS * 10), "0", "-1", "off", undefined]) {
      assert.equal(runIdleMs({ MURLAN_TEST_RUN_IDLE_MS: asked }), RUN_IDLE_MS);
    }
  });
});

describe("no file blocks the event loop its in-process server needs", () => {
  // register replies before its mint commits, holding the user row; a synchronous child that
  // waits on that row stops the very loop that would commit it.
  const hosts = (readdirSync(path.join(repoRoot, "tests"), { recursive: true }) as string[])
    .map((f) => f.split(path.sep).join("/"))
    .filter((f) => f.endsWith(".test.ts") && !f.startsWith("tooling/"))
    .map((f) => ({ f, src: readFileSync(path.join(repoRoot, "tests", f), "utf8") }))
    .filter(({ src }) => /\bstartTestServer\(/.test(src));

  test("the scan finds the files that host a server", () => {
    assert.ok(hosts.length >= 40, `only ${hosts.length} files call startTestServer`);
  });

  test("none of them runs a child synchronously", () => {
    const blocking = hosts.filter(({ src }) => /\b(execFileSync|execSync|spawnSync)\(/.test(src)).map(({ f }) => f);
    assert.deepEqual(blocking, []);
  });
});
