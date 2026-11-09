import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { toolchainFindings } from "../../scripts/toolchain.mjs";

const wantedBrowsers = [{ name: "chromium", revision: "1248" }, { name: "chromium-headless-shell", revision: "1248" }, { name: "ffmpeg", revision: "1013" }];
const asPinned = { node: "26.1.0", wantNodeMajor: 26, wantedBrowsers, browserState: () => "present" as const, dockerUp: true };

test("a machine as pinned has nothing to report", () => {
  assert.deepEqual(toolchainFindings(asPinned), []);
});

test("another Node major is an error", () => {
  const [found] = toolchainFindings({ ...asPinned, node: "22.23.4" });
  assert.equal(found!.level, "error");
  assert.match(found!.text, /22\.23\.4.*pin 26/);
});

test("a browser build that is an alias of another is named, and one that is missing is an error", () => {
  const findings = toolchainFindings({
    ...asPinned,
    browserState: (dir) => (dir === "chromium-1248" ? { aliasOf: "chromium-1243" } : "missing"),
  });
  assert.deepEqual(findings.map((f) => f.level), ["warn", "error", "error"]);
  assert.match(findings[0]!.text, /chromium-1248 is an alias of chromium-1243/);
  assert.match(findings[2]!.text, /ffmpeg-1013/);
});

test("a docker daemon that does not answer is reported", () => {
  assert.match(toolchainFindings({ ...asPinned, dockerUp: false })[0]!.text, /docker daemon/);
});

test("a build that is a copy of another revision is named too", () => {
  const [found] = toolchainFindings({ ...asPinned, browserState: (dir) => (dir === "chromium-1248" ? { copyOf: "chromium-1243" } : "present") });
  assert.match(found!.text, /chromium-1248 is a copy of chromium-1243/);
});

test("a browsers list with a build missing from it is an error, not a pass", () => {
  const findings = toolchainFindings({ ...asPinned, wantedBrowsers: [] });
  assert.deepEqual(findings.map((f) => f.level), ["error", "error", "error"]);
  assert.match(findings[0]!.text, /lists no chromium build/);
});

test("the startup hook prints the toolchain beside the loop's status, and never fails the session", () => {
  const settings = JSON.parse(readFileSync(new URL("../../.claude/settings.json", import.meta.url), "utf8"));
  const startup = settings.hooks.SessionStart.find((h: { matcher: string }) => h.matcher === "startup").hooks as { args: string[] }[];
  const args = startup.map((h) => h.args.join(" "));
  assert.ok(args.some((a) => a.endsWith("loop-status.mjs --startup")));
  assert.ok(args.some((a) => a.endsWith("scripts/toolchain.mjs --inform")));
});

test("--inform exits 0 and says so when the check itself cannot run, as with no node_modules", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "toolchain-"));
  try {
    mkdirSync(path.join(dir, "scripts", "lib"), { recursive: true });
    mkdirSync(path.join(dir, "deploy"));
    cpSync(new URL("../../scripts/toolchain.mjs", import.meta.url), path.join(dir, "scripts", "toolchain.mjs"));
    cpSync(new URL("../../scripts/lib/entry.mjs", import.meta.url), path.join(dir, "scripts", "lib", "entry.mjs"));
    cpSync(new URL("../../deploy/runtime.json", import.meta.url), path.join(dir, "deploy", "runtime.json"));
    const run = (...args: string[]) => spawnSync(process.execPath, [path.join(dir, "scripts", "toolchain.mjs"), ...args], { encoding: "utf8", cwd: dir, timeout: 30_000 });
    const informed = run("--inform");
    assert.equal(informed.status, 0, informed.stderr);
    assert.match(informed.stdout, /the toolchain check itself failed/);
    assert.equal(run().status, 1, "outside --inform a check that cannot run is red");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
