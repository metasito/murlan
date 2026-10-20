import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).scripts.test as string;

// The runner stops reading for a second while the last test writes until the pipe to it is full,
// whatever its size: a write is left queued or, once stdout blocks, waits on the runner. The
// failure's report then waits on stdout as the file's process exits.
const LAST_FAILS_UNREAD =
  'import { test } from "node:test";\n' +
  'import { spawn } from "node:child_process";\n' +
  'import { writeFileSync } from "node:fs";\n' +
  'import path from "node:path";\n' +
  'test("passes", () => {});\n' +
  'test("the planted last test fails", () => {\n' +
  '  spawn(process.execPath, ["-e", `setTimeout(() => process.kill(${process.ppid}, "SIGCONT"), 1000)`], { detached: true, stdio: "ignore" }).unref();\n' +
  '  process.kill(process.ppid, "SIGSTOP");\n' +
  "  for (let kib = 1; kib <= 16384; kib++) {\n" +
  "    const start = Date.now();\n" +
  '    process.stdout.write(`${"x".repeat(1023)}\\n`);\n' +
  "    if (process.stdout.writableLength > 0 || Date.now() - start > 500) {\n" +
  '      writeFileSync(path.join(import.meta.dirname, "filled"), String(kib));\n' +
  "      break;\n" +
  "    }\n" +
  "  }\n" +
  '  throw new Error("planted failure message");\n' +
  "});\n";

test("npm test prints a file's last failing test by name and message, though it read the file's report late", { skip: process.platform === "win32" && "no SIGSTOP" }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "planted-report-"));
  try {
    const file = path.join(dir, "lastFailsUnread.test.mjs");
    writeFileSync(file, LAST_FAILS_UNREAD);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const run = await new Promise<{ code: unknown; out: string }>((resolve) =>
      execFile(process.execPath, [...script.split(" ").slice(1, -1), file], { cwd: repoRoot, env, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
        resolve({ code: err ? err.code : 0, out: stdout + stderr })
      )
    );
    const tail = run.out.slice(-3000);
    assert.ok(existsSync(path.join(dir, "filled")), `the planted test never filled its pipe, so nothing could go unread\n${tail}`);
    assert.equal(run.code, 1, tail);
    assert.ok(run.out.includes("✖ the planted last test fails"), tail);
    assert.ok(run.out.includes("planted failure message"), tail);
    assert.ok(/ℹ tests 2\b/.test(run.out), tail);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
