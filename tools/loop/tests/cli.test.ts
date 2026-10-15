import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { firstLine, gh, git, statusOf } from "../cli.mjs";

const LOOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(path.join(tmpdir(), "loop-cli-"));

function stub(name: string, body: string): string {
  const file = path.join(scratch, `${name}-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(file, body);
  return file;
}

function withEnv<T>(name: string, value: string, run: () => T): T {
  process.env[name] = value;
  try {
    return run();
  } finally {
    delete process.env[name];
  }
}

describe("the test override", () => {
  test("LOOP_GH_SCRIPT runs a node script in place of gh, with gh's arguments", () => {
    const out = withEnv("LOOP_GH_SCRIPT", stub("gh", "console.log(JSON.stringify(process.argv.slice(2)));"), () =>
      gh(["issue", "view", "7"]),
    );
    assert.deepEqual(JSON.parse(out), ["issue", "view", "7"]);
  });

  test("LOOP_GIT_SCRIPT does the same for git, in the cwd it was handed", () => {
    const out = withEnv("LOOP_GIT_SCRIPT", stub("git", "console.log(process.cwd() + '|' + process.argv.slice(2).join(' '));"), () =>
      git(scratch)(["rev-parse", "HEAD"]),
    );
    assert.equal(out.trim(), `${scratch}|rev-parse HEAD`);
  });
});

describe("one policy", () => {
  test("a payload past node's 1MB default is read whole, not an ENOBUFS throw", () => {
    const out = withEnv("LOOP_GH_SCRIPT", stub("big", "process.stdout.write('x'.repeat(3 * 1024 * 1024));"), () => gh(["run", "view"]));
    assert.equal(out.length, 3 * 1024 * 1024);
  });

  test("stderr is captured on the error, never printed", () => {
    const script = stub("loud", "process.stderr.write('HTTP 502: bad gateway\\nmore\\n'); process.exit(4);");
    const err = withEnv("LOOP_GH_SCRIPT", script, () => {
      try {
        gh(["pr", "view"]);
      } catch (e) {
        return e as { status: number; stderr: string };
      }
      return null;
    });
    assert.equal(err?.status, 4);
    assert.match(err?.stderr ?? "", /bad gateway/);
    assert.equal(firstLine(err), "HTTP 502: bad gateway");
  });

  test("a spent budget still times out, rather than reading as no timeout", () => {
    const slow = stub("slow", "setTimeout(() => {}, 5_000);");
    for (const timeout of [0, -5_000]) {
      const code = withEnv("LOOP_GH_SCRIPT", slow, () => {
        try {
          gh(["run", "watch"], { timeout });
        } catch (e) {
          return (e as { code?: string }).code;
        }
        return "exited";
      });
      assert.equal(code, "ETIMEDOUT", `timeout ${timeout}`);
    }
  });

  test("statusOf reads the exit code a call threw with", () => {
    assert.equal(withEnv("LOOP_GIT_SCRIPT", stub("one", "process.exit(1);"), () => statusOf(() => git(scratch)(["merge-base"]))), 1);
    assert.equal(withEnv("LOOP_GIT_SCRIPT", stub("zero", ""), () => statusOf(() => git(scratch)(["merge-base"]))), 0);
  });

  test("firstLine falls back to the message when the tool said nothing", () => {
    assert.equal(firstLine(Object.assign(new Error("Command failed: gh x\nrest"), { stderr: "  \n" })), "Command failed: gh x");
    assert.equal(firstLine("plain"), "plain");
  });
});

/**
 * `cli.mjs` is the one place a loop tool starts `git` or `gh`. Every other top-level loop file is
 * read, the tests (whose fixtures build real repos) are not.
 */
describe("no git or gh outside cli.mjs", () => {
  const SPAWN = /\b(?:execFileSync|execFile|spawnSync|spawn|execSync|exec)\s*\(\s*["'`](?:git|gh)\b/;
  const VIA_VARIABLE = /\b(?:execFileSync|execFile|spawnSync|spawn|execSync|exec)\s*\(\s*(?:file|cmd|tool)\b/;
  const namesNoGitOrGh = (text: string) => !/["'`](?:git|gh)["'`]/.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""));
  /** The files that start a binary a variable names, and why that is never git or gh there. */
  const OTHER_BINARIES: Record<string, (text: string) => boolean> = {
    "queue-loop.mjs": (text) =>
      /\bconst sh = \(file, args, opts = \{\}\) => \{\s*if \(file === "git"\) return gitAt\(opts\.cwd\)\(args, opts\);\s*if \(file === "gh"\) return ghCli\(args, opts\);/.test(text),
    "reap.mjs": namesNoGitOrGh,
    "loop-screen.mjs": namesNoGitOrGh,
  };
  const files = readdirSync(LOOP).filter((f) => /\.(mjs|ts)$/.test(f) && f !== "cli.mjs");

  test("the scan reads the loop's files", () => {
    assert.ok(files.includes("queue-loop.mjs") && files.includes("ciVerdict.ts") && files.length > 20, files.join(" "));
  });

  for (const file of files) {
    test(file, () => {
      const text = readFileSync(path.join(LOOP, file), "utf8");
      const line = text.split("\n").findIndex((l) => SPAWN.test(l));
      assert.equal(line, -1, `${file}:${line + 1} starts git or gh itself; call tools/loop/cli.mjs`);
      if (VIA_VARIABLE.test(text)) {
        assert.ok(OTHER_BINARIES[file]?.(text),`${file} starts a binary named by a variable; route git and gh through cli.mjs`);
      }
    });
  }

  test("a planted call is caught", () => {
    assert.ok(SPAWN.test(`const x = execFileSync("git", ["status"]);`));
    assert.ok(SPAWN.test(`spawnSync('gh', args)`));
    assert.ok(VIA_VARIABLE.test(`execFileSync(file, args, { encoding: "utf8" })`));
  });
});
