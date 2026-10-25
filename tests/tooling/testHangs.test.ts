import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deadlineMs, EXIT_MARKERS_ENV, FILE_DEADLINE_MS } from "../helpers/fileDeadline.mjs";
import { EXIT_GRACE_MARGIN_MS, EXIT_GRACE_MS, exitGraceMs, MIN_EXIT_GRACE_MS, RUN_IDLE_MS, runIdleMs } from "../helpers/filesRunReporter.mjs";
import { EXIT_TICK_MS, exitGuard } from "../helpers/exitGuard.mjs";
import { TABLE_TIMEOUT_MS, tableTimeoutMs } from "../../scripts/lib/proc.mjs";
import { posixWorld, windowsWorld } from "../helpers/processWorlds.ts";
import { trackedFiles } from "../helpers/trackedFiles.ts";
import { blankCommentsAndStrings, sourcesUnder } from "../helpers/sourceScan.ts";
import { NO_BACKGROUND_JIT } from "../../scripts/nodeTest.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).scripts.test as string;

const PLANTED = {
  "syncChild.test.mjs":
    'import { test } from "node:test";\nimport { execFileSync } from "node:child_process";\n' +
    'test("waits on a child", () => { execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 20000)"]); });\n',
  "topLevel.test.mjs": 'import "node:test";\nawait new Promise(() => setInterval(() => {}, 1000));\n',
  "movesCwd.test.mjs":
    'import "node:test";\nprocess.chdir(import.meta.dirname);\nawait new Promise(() => setInterval(() => {}, 1000));\n',
};

describe("a test file that never finishes fails npm test by name", () => {
  test("npm test's own flags kill each planted hang and name it", async () => {
    const [node, ...args] = script.split(" ").slice(0, -1);
    assert.equal(node, "node");
    const dir = mkdtempSync(path.join(tmpdir(), "planted-hang-"));
    try {
      for (const [name, body] of Object.entries(PLANTED)) writeFileSync(path.join(dir, name), body);
      const env = { ...process.env };
      env.MURLAN_TEST_FILE_DEADLINE_MS = "1000";
      delete env.NODE_TEST_CONTEXT;
      const files = Object.keys(PLANTED).map((f) => path.join(dir, f));
      const started = Date.now();
      const run = await new Promise<{ code: unknown; out: string }>((resolve) =>
        execFile(process.execPath, [...args, ...files], { cwd: repoRoot, env, timeout: 60_000 }, (err, stdout, stderr) =>
          resolve({ code: err ? err.code : 0, out: stdout + stderr })
        )
      );
      assert.equal(run.code, 1, run.out);
      // A hang that survives its deadline is still ended by --test-timeout, which also exits 1.
      const testTimeout = Number(/--test-timeout=(\d+)/.exec(script)?.[1]);
      assert.ok(testTimeout > 0 && Date.now() - started < testTimeout / 2, `not killed by its own deadline\n${run.out}`);
      for (const name of Object.keys(PLANTED)) assert.ok(run.out.includes(`${name}: still running after 1s`), run.out);
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

describe("a test file that hangs on its way out fails npm test by name", () => {
  const passes = 'import { test } from "node:test";\ntest("passes", () => {});\n';
  // A stopped process runs no thread, so its own deadline worker is as gone as process.exit leaves it.
  const hangsOnExit = `${passes}process.on("exit", () => process.kill(process.pid, "SIGSTOP"));\n`;
  const run = (argv: string[], env: NodeJS.ProcessEnv) =>
    new Promise<{ code: unknown; out: string }>((resolve) =>
      execFile(process.execPath, argv, { cwd: repoRoot, env, timeout: 60_000 }, (err, stdout, stderr) =>
        resolve({ code: err ? err.code : 0, out: stdout + stderr })
      )
    );
  const planted = (files: Record<string, string>) => {
    const dir = mkdtempSync(path.join(tmpdir(), "planted-exit-hang-"));
    for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
    return { dir, glob: path.relative(repoRoot, path.join(dir, "*.test.mjs")) };
  };
  const quiet = () => {
    const env = { ...process.env };
    delete env.MURLAN_TEST_EXIT_GRACE_MS;
    delete env[EXIT_MARKERS_ENV];
    delete env.NODE_TEST_CONTEXT;
    return env;
  };

  test("a file whose exit stops past its own deadline's reach is killed after the grace, and named", { skip: process.platform === "win32" && "no SIGSTOP" }, async () => {
    const { dir, glob } = planted({ "hangsOnExit.test.mjs": hangsOnExit, "exits.test.mjs": passes });
    try {
      const env = { ...quiet(), MURLAN_TEST_FILE_DEADLINE_MS: "2000", MURLAN_TEST_RUN_IDLE_MS: "15000", MURLAN_TEST_EXIT_GRACE_MS: "1000" };
      const { code, out } = await run([...script.split(" ").slice(1, -1), glob], env);
      assert.equal(code, 1, out);
      assert.match(out, /hangsOnExit\.test\.mjs: hung after its tests finished, killed 1s into its exit/);
      assert.doesNotMatch(out, /exits\.test\.mjs: hung/);
      assert.doesNotMatch(out, /still running after|nothing reported for/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a run without the exit watch says nothing of it", async () => {
    const { dir, glob } = planted({ "exits.test.mjs": passes });
    try {
      const argv = ["scripts/nodeTest.mjs", "--import", "./tests/helpers/fileDeadline.mjs", "--test", "--test-force-exit", "--test-reporter=spec", glob];
      const { code, out } = await run(argv, quiet());
      assert.equal(code, 0, out);
      assert.doesNotMatch(out, /unwatched|exit guard/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a file a run is watching, whose exit it cannot mark, says so once", async () => {
    const { dir, glob } = planted({ "exits.test.mjs": passes });
    try {
      writeFileSync(path.join(dir, "notADirectory"), "");
      const env = { ...quiet(), [EXIT_MARKERS_ENV]: path.join(dir, "notADirectory", "markers") };
      const argv = ["scripts/nodeTest.mjs", "--import", "./tests/helpers/fileDeadline.mjs", "--test", "--test-force-exit", "--test-reporter=spec", glob];
      const { code, out } = await run(argv, env);
      assert.equal(code, 0, out);
      assert.equal(out.match(/exits\.test\.mjs: its exit is unwatched/g)?.length, 1, out);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the ps timeout can be shortened and never lengthened or switched off", () => {
    assert.equal(tableTimeoutMs({ MURLAN_TEST_TABLE_TIMEOUT_MS: "2000" }), 2000);
    for (const asked of [String(TABLE_TIMEOUT_MS * 10), "0", "-1", "off", undefined]) {
      assert.equal(tableTimeoutMs({ MURLAN_TEST_TABLE_TIMEOUT_MS: asked }), TABLE_TIMEOUT_MS);
    }
  });

  test("the exit grace keeps a tick and a stalled ps clear of the run's idle limit, never under its floor, and can only be shortened", () => {
    assert.ok(EXIT_GRACE_MARGIN_MS >= Math.max(1000, EXIT_TICK_MS + TABLE_TIMEOUT_MS));
    const room = MIN_EXIT_GRACE_MS + EXIT_GRACE_MARGIN_MS;
    const settings = [
      {},
      { MURLAN_TEST_RUN_IDLE_MS: "15000" },
      { MURLAN_TEST_RUN_IDLE_MS: "15000", MURLAN_TEST_EXIT_GRACE_MS: "999999" },
      { MURLAN_TEST_RUN_IDLE_MS: String(room) },
      { MURLAN_TEST_EXIT_GRACE_MS: "1" },
    ];
    for (const env of settings) {
      const grace = exitGraceMs(env);
      assert.ok(grace !== undefined && grace >= MIN_EXIT_GRACE_MS && grace + EXIT_GRACE_MARGIN_MS <= runIdleMs(env), `${JSON.stringify(env)}: ${grace}`);
    }
    for (const idle of [String(room - 1), "1000"]) assert.equal(exitGraceMs({ MURLAN_TEST_RUN_IDLE_MS: idle }), undefined, idle);
    assert.equal(exitGraceMs({ MURLAN_TEST_EXIT_GRACE_MS: "2000" }), 2000);
    for (const asked of [String(EXIT_GRACE_MS * 10), "0", "-1", "off", undefined]) {
      assert.equal(exitGraceMs({ MURLAN_TEST_EXIT_GRACE_MS: asked }), EXIT_GRACE_MS);
    }
  });
});

describe("the exit guard, over modelled process tables", () => {
  const GRACE = 1000;
  // Every marker here is an exit that began at T; each guard's clock starts there too.
  const T = 1_000_000;
  type World = ReturnType<typeof posixWorld> | ReturnType<typeof windowsWorld>;
  const guarded = (w: World, { platform = "linux", since = 0, proc = w.proc as Parameters<typeof exitGuard>[0]["proc"] } = {}) => {
    const markers = mkdtempSync(path.join(tmpdir(), "exit-markers-"));
    const lines: string[] = [];
    let clock = T;
    const tick = exitGuard({ markers, graceMs: GRACE, since, platform, proc, write: (l) => lines.push(l), now: () => clock });
    const mark = (pid: number, body: object | string) =>
      writeFileSync(path.join(markers, String(pid)), typeof body === "string" ? body : JSON.stringify(body));
    const later = (ms: number) => (clock += ms);
    /** One tick inside the grace, which must do nothing, then one just past it. */
    const throughGrace = () => {
      later(GRACE);
      tick();
      assert.deepEqual(lines, [], "acted inside the grace");
      later(1);
      tick();
    };
    return { markers, lines, tick, mark, later, throughGrace, done: () => rmSync(markers, { recursive: true, force: true }) };
  };
  const exiting = (identity: unknown) => ({ file: "f.test.ts", identity, at: T });
  const started = (w: World) => {
    const pid = w.proc.startBin("node", ["f.test.ts"], {}).pid!;
    return { pid, identity: w.proc.identityOf(pid) };
  };

  test("a file still in its exit past the grace is ended with its tree, and named", () => {
    const w = posixWorld();
    const { pid, identity } = started(w);
    const g = guarded(w);
    try {
      g.mark(pid, exiting(identity));
      g.throughGrace();
      assert.deepEqual(w.alive(), []);
      assert.deepEqual(g.lines, ["f.test.ts: hung after its tests finished, killed 1s into its exit by tests/helpers/exitWatch.mjs"]);
    } finally {
      g.done();
    }
  });

  test("a pid reused after its file exited, before the poll, is never ended", () => {
    const w = posixWorld({ depth: 0 });
    const { pid, identity } = started(w);
    const g = guarded(w);
    try {
      g.mark(pid, exiting(identity));
      w.reuse(pid);
      g.throughGrace();
      assert.deepEqual(w.alive(), [pid]);
      assert.deepEqual(g.lines, []);
    } finally {
      g.done();
    }
  });

  test("it never asks to end a pid whose identity differs from the marker's", () => {
    const w = posixWorld({ depth: 0 });
    const ended: number[] = [];
    const proc = { identityOf: () => "2", endTreeIf: (pid: number) => (ended.push(pid), true), alive: () => true };
    const g = guarded(w, { proc });
    try {
      g.mark(77, exiting("1"));
      g.throughGrace();
      assert.deepEqual(ended, []);
      assert.deepEqual(g.lines, []);
    } finally {
      g.done();
    }
  });

  test("an exit nobody has reaped yet is not a hang", () => {
    const w = posixWorld({ depth: 0 });
    const { pid, identity } = started(w);
    const g = guarded(w);
    try {
      g.mark(pid, exiting(identity));
      w.zombie(pid);
      g.throughGrace();
      assert.deepEqual(g.lines, []);
      assert.deepEqual(w.signals.filter(([, s]) => s !== 0), []);
    } finally {
      g.done();
    }
  });

  test("a previous run's marker is dropped unread", () => {
    const w = posixWorld({ depth: 0 });
    const { pid, identity } = started(w);
    const g = guarded(w, { since: T + 1 });
    try {
      g.mark(pid, exiting(identity));
      g.throughGrace();
      assert.deepEqual(w.alive(), [pid]);
      assert.deepEqual(readdirSync(g.markers), []);
    } finally {
      g.done();
    }
  });

  for (const [what, body] of [
    ["an identity it cannot read", (identity: unknown) => ({ ...exiting(identity), identity: "NaN" })],
    ["no identity at all", (identity: unknown) => ({ ...exiting(identity), identity: undefined })],
  ] as const) {
    test(`a marker with ${what} is named once past the grace, and nothing is ended`, () => {
      const w = posixWorld({ depth: 0 });
      const { pid, identity } = started(w);
      const g = guarded(w);
      try {
        g.mark(pid, body(identity));
        g.throughGrace();
        assert.deepEqual(w.alive(), [pid]);
        assert.deepEqual(g.lines, ["f.test.ts: still alive 1s after its tests finished; not killed, identity unverifiable on linux"]);
      } finally {
        g.done();
      }
    });
  }

  test("win32: a file still in its exit past the grace is named, and nothing is ended", () => {
    const w = windowsWorld();
    const { pid, identity } = started(w);
    assert.equal(identity, null);
    const g = guarded(w, { platform: "win32" });
    try {
      g.mark(pid, exiting(identity));
      g.throughGrace();
      assert.ok(w.alive().includes(pid));
      assert.deepEqual(g.lines, ["f.test.ts: still alive 1s after its tests finished; not killed, identity unverifiable on win32"]);
    } finally {
      g.done();
    }
  });

  test("a kill that fails keeps the file pending, and says so no more than once a minute", () => {
    const w = posixWorld({ depth: 0 });
    const { pid, identity } = started(w);
    const g = guarded(w);
    try {
      g.mark(pid, exiting(identity));
      w.failPs();
      g.later(GRACE + 1);
      g.tick();
      g.tick();
      assert.equal(g.lines.length, 1);
      assert.match(g.lines[0], /^exit guard unavailable: .*process table/);
      g.later(61_000);
      g.tick();
      assert.equal(g.lines.length, 2);
      w.failPs(false);
      g.tick();
      assert.deepEqual(w.alive(), []);
      assert.match(g.lines[2], /hung after its tests finished/);
    } finally {
      g.done();
    }
  });

  for (const [what, body] of [
    ["will not parse", "{"],
    ["has no time its exit began", JSON.stringify({ file: "f.test.ts", identity: "1", at: "soon" })],
  ] as const) {
    test(`a marker that ${what} is dropped after three polls, with a notice, and ends nothing`, () => {
      const w = posixWorld({ depth: 0 });
      const { pid } = started(w);
      const g = guarded(w);
      try {
        g.mark(pid, body);
        g.later(GRACE + 1);
        g.tick();
        g.tick();
        assert.deepEqual(g.lines, []);
        g.tick();
        assert.equal(g.lines.length, 1);
        assert.match(g.lines[0], new RegExp(`dropped the unreadable marker of pid ${pid}`));
        assert.deepEqual(readdirSync(g.markers), []);
        assert.deepEqual(w.alive(), [pid]);
      } finally {
        g.done();
      }
    });
  }

  test("a marker directory it cannot read is reported, not passed over", () => {
    const w = posixWorld({ depth: 0 });
    const g = guarded(w);
    g.done();
    g.tick();
    assert.equal(g.lines.length, 1);
    assert.match(g.lines[0], /^exit guard unavailable: ENOENT/);
  });
});

describe("a test file that passed always exits", () => {
  const FORCE_EXIT = ["--test", "force-exit"].join("-");
  const FORCE_EXIT_ANY = new RegExp(`${FORCE_EXIT}(?:=\\S*)?`);
  const COMMENT = /^\s*(#|\/\/|\/?\*)/;
  const CONTINUATION = /\\\r?\n\s*/g;
  const OWNER = /^(?:\.\/)?scripts\/nodeTest\.mjs$/;

  /** The `run:` values of a workflow or action, each read as one shell script. */
  function runBlocks(text: string): string[] {
    const lines = text.split("\n");
    const blocks: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const key = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i]);
      if (!key) continue;
      if (!/^[|>][-+]?\s*$/.test(key[2])) {
        blocks.push(key[2]);
        continue;
      }
      const body: string[] = [];
      while (i + 1 < lines.length && (lines[i + 1].trim() === "" || lines[i + 1].search(/\S/) > key[1].length)) body.push(lines[++i]);
      const kept = body.filter((l) => !COMMENT.test(l));
      blocks.push(key[2].startsWith(">") ? kept.map((l) => l.trim()).join(" ") : kept.join("\n"));
    }
    return blocks;
  }

  /** Each shell invocation in `script`: continuations joined, split at `&&`, `||`, `;`, `|` and newlines. */
  const invocations = (script: string) =>
    script
      .replace(CONTINUATION, " ")
      .split(/\n|&&|\|\||;|\|/)
      .map((s) => s.trim())
      .filter((s) => s && !COMMENT.test(s));

  /** The command from its `node` on, when the first program it runs is the owner. */
  function routedFrom(invocation: string): string | undefined {
    const node = /(?:^|[\s"'`=(])node\s+(\S+)/.exec(invocation);
    if (!node || !OWNER.test(node[1].replace(/["'`]/g, ""))) return undefined;
    return invocation.slice(invocation.indexOf("node", node.index)).replace(/["'`,]+$/, "");
  }

  /** Every run that force-exits, split into those through `scripts/nodeTest.mjs` and those around it. */
  function scan(file: string, text: string): { routed: string[]; bypasses: string[] } {
    const routed: string[] = [];
    const bypasses: string[] = [];
    const judge = (invocation: string) => {
      if (!FORCE_EXIT_ANY.test(invocation)) return;
      const through = routedFrom(invocation);
      if (through) routed.push(through);
      else bypasses.push(`${file}: ${invocation}`);
    };
    let shell = text.split("\n").filter((l) => !COMMENT.test(l)).join("\n");
    if (/\.[cm]?[jt]s$/.test(file)) {
      for (const option of shell.matchAll(new RegExp(`\\b${FORCE_EXIT_OPTION}\\s*:\\s*(?!false\\b)\\S`, "g"))) bypasses.push(`${file}: ${option[0]}`);
      shell = shell.replace(/\[[^[\]]*\]/g, (argv) => {
        if (!FORCE_EXIT_ANY.test(argv)) return argv;
        const first = /^\[\s*["'`]([^"'`]*)["'`]/.exec(argv)?.[1] ?? "";
        if (OWNER.test(first)) routed.push(argv);
        else bypasses.push(`${file}: ${argv.replace(/\s+/g, " ")}`);
        return "[]";
      });
    }
    const scripts = /\.ya?ml$/.test(file) ? runBlocks(text) : [shell];
    for (const script of scripts) for (const invocation of invocations(script)) judge(invocation);
    return { routed, bypasses };
  }

  const scanned = () =>
    trackedFiles(repoRoot, "package.json", ".github", ".claude", "scripts", "tools", "tests")
      .filter((f) => /\.(json|ya?ml|sh|md|[cm]?[jt]s)$/.test(f))
      .map((f) => [f, scan(f, readFileSync(path.join(repoRoot, f), "utf8"))] as const);

  test("every command that force-exits a test run goes through scripts/nodeTest.mjs", () => {
    const found = scanned();
    assert.ok(found.some(([f]) => f === ".claude/settings.json"), "the scan no longer reads .claude/");
    const routed = found.flatMap(([, s]) => s.routed);
    assert.ok(routed.length >= 4, `the scan found ${routed.length} routed runs; it has stopped seeing them`);
    assert.deepEqual(found.flatMap(([, s]) => s.bypasses), []);
  });

  const FORCE_EXIT_OPTION = ["force", "Exit"].join("");
  const ROUTED = "node scripts/nodeTest.mjs";
  const PLANTS: [string, string, string, { routed: number; bypasses: number }][] = [
    ["a comment naming a routed run", "scripts/x.mjs", `// runs as \`${ROUTED} --test ${FORCE_EXIT}\``, { routed: 0, bypasses: 0 }],
    ["a routed command", "package.json", `"t": "${ROUTED} --import ./x.mjs --test ${FORCE_EXIT} \\"g\\""`, { routed: 1, bypasses: 0 }],
    ["a bare command", ".github/workflows/x.yml", `      - run: node --test ${FORCE_EXIT} x.test.ts`, { routed: 0, bypasses: 1 }],
    ["a commented-out command", ".github/workflows/x.yml", `      # - run: node --test ${FORCE_EXIT} x`, { routed: 0, bypasses: 0 }],
    ["a backslash continuation", "scripts/x.sh", `node --test \\\n  ${FORCE_EXIT} x.test.ts`, { routed: 0, bypasses: 1 }],
    ["a literal run block", ".github/workflows/x.yml", `      - run: |\n          set -e\n          node --test \\\n            ${FORCE_EXIT} x.test.ts\n      - name: next`, { routed: 0, bypasses: 1 }],
    ["a folded run block", ".github/workflows/x.yml", `      - run: >\n          node --test\n          ${FORCE_EXIT} x.test.ts`, { routed: 0, bypasses: 1 }],
    ["a folded routed block", ".github/workflows/x.yml", `      - run: >\n          ${ROUTED}\n          --test ${FORCE_EXIT} x.test.ts`, { routed: 1, bypasses: 0 }],
    ["a bypass sharing a line with a routed run", "scripts/x.sh", `${ROUTED} --version && node --test ${FORCE_EXIT} x`, { routed: 0, bypasses: 1 }],
    ["an argv on a line naming the constant", "tools/x.mjs", `const NO_BACKGROUND_JIT = 1, argv = ["--test", "${FORCE_EXIT}"];`, { routed: 0, bypasses: 1 }],
    ["a quoted argv", "tools/x.mjs", `spawn(process.execPath, ["--test", "${FORCE_EXIT}", file]);`, { routed: 0, bypasses: 1 }],
    ["a template-literal argv", "tools/x.ts", `spawn(process.execPath, [\`${FORCE_EXIT}\`, file]);`, { routed: 0, bypasses: 1 }],
    ["an argv with a value", "tools/x.mjs", `spawn(process.execPath, ["--test",\n  "${FORCE_EXIT}=true", file]);`, { routed: 0, bypasses: 1 }],
    ["a routed argv", "tools/x.mjs", `spawn(process.execPath, ["scripts/nodeTest.mjs", "--test", "${FORCE_EXIT}", file]);`, { routed: 1, bypasses: 0 }],
    ["node:test's run() forcing exit", "tools/x.mjs", `await run({ files, ${FORCE_EXIT_OPTION}: true });`, { routed: 0, bypasses: 1 }],
    ["node:test's run() not forcing exit", "tools/x.mjs", `await run({ files, ${FORCE_EXIT_OPTION}: false });`, { routed: 0, bypasses: 0 }],
    ["a hook in .claude", ".claude/settings.json", `{ "command": "node --test ${FORCE_EXIT} x.test.ts" }`, { routed: 0, bypasses: 1 }],
  ];

  for (const [name, file, text, expected] of PLANTS) {
    test(`the scan judges a plant: ${name}`, () => {
      const found = scan(file, text);
      assert.deepEqual({ routed: found.routed.length, bypasses: found.bypasses.length }, expected, JSON.stringify(found));
    });
  }

  /** A routed command's own arguments after `node`, with its file operands dropped. */
  function argvOf(command: string): string[] {
    const words = command.split(/\s+/).slice(1).map((w) => w.replace(/^["'`]|["'`]$/g, ""));
    while (words.length > 0 && !words.at(-1)!.startsWith("-") && words.at(-2) !== "--import") words.pop();
    return words;
  }

  test("each routed run's own flags reach every file's process and keep the JIT off background threads", async () => {
    const scripts: Record<string, string> = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).scripts;
    const runs = [
      ...["test", "loop:test"].map((name) => [`npm run ${name}`, scan("package.json", scripts[name]).routed] as const),
      ...[".github/workflows/ci.yml"].flatMap((f) =>
        scan(f, readFileSync(path.join(repoRoot, f), "utf8")).routed.map((r) => [`${f}: ${r}`, [r]] as const)
      ),
    ];
    assert.ok(runs.length >= 4, `found ${runs.length} routed runs to probe`);
    const dir = mkdtempSync(path.join(tmpdir(), "jit-flags-"));
    try {
      const probe = path.join(dir, "flags.test.mjs");
      writeFileSync(
        probe,
        'import { test } from "node:test";\nimport assert from "node:assert/strict";\n' +
          `test("compiles on the main thread", () => { for (const f of ${JSON.stringify(NO_BACKGROUND_JIT)}) assert.ok(process.execArgv.includes(f), f); });\n`
      );
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      for (const [where, routed] of runs) {
        assert.equal(routed.length, 1, `${where} is not one routed run`);
        const run = await new Promise<{ code: unknown; out: string }>((resolve) =>
          execFile(process.execPath, [...argvOf(routed[0]), probe], { cwd: repoRoot, env, timeout: 60_000 }, (err, stdout, stderr) =>
            resolve({ code: err ? err.code : 0, out: stdout + stderr })
          )
        );
        assert.equal(run.code, 0, `${where}\n${run.out}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("a run that stops hearing from its files fails by name", { concurrency: true }, () => {
  const reporter = pathToFileURL(path.join(repoRoot, "tests", "helpers", "filesRunReporter.mjs")).href;
  const file = JSON.stringify(path.join(tmpdir(), "fake.test.ts"));
  const dequeued = `{ type: "test:dequeue", data: { nesting: 0, name: ${file}, file: ${file} } }`;
  const drive = (source: string, after: string, idleMs: string, extra: Record<string, string> = {}) => {
    const script = `import filesRun from ${JSON.stringify(reporter)};\nasync function* source() {\n${source}\n}\n` +
      `for await (const line of filesRun(source())) process.stdout.write(line);\n${after}`;
    const env = { ...process.env };
    delete env.MURLAN_TEST_EXIT_GRACE_MS;
    Object.assign(env, extra);
    env.MURLAN_TEST_RUN_IDLE_MS = idleMs;
    delete env.NODE_TEST_CONTEXT;
    return new Promise<{ signal: unknown; out: string }>((resolve) =>
      execFile(process.execPath, ["--input-type=module", "-e", script], { cwd: repoRoot, env, timeout: 30_000 }, (err, stdout, stderr) =>
        resolve({ signal: err?.killed ? "timed out" : err?.signal ?? err?.code ?? null, out: stdout + stderr })
      )
    );
  };

  test("a runner whose own loop stops is killed, naming the files it had in flight", async () => {
    const child = `spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { stdio: "ignore" }).pid`;
    const run = await drive(
      `yield ${dequeued};\nconst { spawn } = await import("node:child_process");\n` +
        `process.stderr.write("child " + ${child} + "\\n");\nAtomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);`,
      "",
      "2000"
    );
    // win32 raises no signal: TerminateProcess just exits 1.
    assert.equal(run.signal, process.platform === "win32" ? 1 : "SIGKILL", run.out);
    assert.match(run.out, /nothing reported for 2s; still running: \S*fake\.test\.ts/);
    const pid = Number(/child (\d+)/.exec(run.out)?.[1]);
    assert.ok(pid > 0, run.out);
    const alive = () => {
      try {
        process.kill(pid, 0);
      } catch {
        return false;
      }
      try {
        return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
      } catch {
        return true;
      }
    };
    for (let i = 0; i < 100 && alive(); i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(alive(), false, "the runner's child outlived it");
  });

  test("a ps that stalls the exit guard never holds up the idle watchdog", { skip: process.platform !== "linux" && "the exit guard kills only on Linux" }, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stalled-ps-"));
    try {
      const log = path.join(dir, "ps.log");
      // Each call logs its start, and its end only when the guard's own timeout stops it.
      const fakePs =
        `#!${process.execPath}\nconst { appendFileSync } = require("node:fs");\nappendFileSync(${JSON.stringify(log)}, "start\\n");\n` +
        `process.on("SIGTERM", () => { appendFileSync(${JSON.stringify(log)}, "timed out\\n"); process.exit(1); });\nsetInterval(() => {}, 1000);\n`;
      writeFileSync(path.join(dir, "ps"), fakePs, { mode: 0o755 });
      const proc = pathToFileURL(path.join(repoRoot, "scripts", "lib", "proc.mjs")).href;
      const hung =
        `const { spawn } = await import("node:child_process");\nconst fs = await import("node:fs");\nconst { identityOf } = await import(${JSON.stringify(proc)});\n` +
        `const pid = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" }).pid;\n` +
        `const markers = process.env.${EXIT_MARKERS_ENV};\nfs.mkdirSync(markers, { recursive: true });\n` +
        `fs.writeFileSync(markers + "/" + pid, JSON.stringify({ file: "hung.test.ts", identity: identityOf(pid), at: Date.now() }));\n` +
        `yield ${dequeued};\nawait new Promise(() => {});`;
      // A 1 s grace, then a read stalled for the whole ps timeout: the idle limit falls between the
      // second read's start (at most a tick past the grace and one ps timeout) and its own give-up.
      const psMs = 3_000;
      const idle = String(MIN_EXIT_GRACE_MS + psMs + 1_750);
      const env = {
        PATH: `${dir}${path.delimiter}${process.env.PATH}`,
        MURLAN_TEST_EXIT_GRACE_MS: String(MIN_EXIT_GRACE_MS),
        MURLAN_TEST_TABLE_TIMEOUT_MS: String(psMs),
      };
      const run = await drive(hung, "", idle, env);
      assert.match(run.out, /nothing reported for/, run.out);
      const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
      assert.deepEqual(calls, ["start", "timed out", "start"], run.out);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a run that keeps reporting, and then ends, is never killed", async () => {
    const steady = `for (let i = 0; i < 8; i++) { yield ${dequeued}; await new Promise((r) => setTimeout(r, 200)); }`;
    const run = await drive(steady, "await new Promise((r) => setTimeout(r, 1500));", "1000");
    assert.equal(run.signal, null, run.out);
    assert.doesNotMatch(run.out, /nothing reported/);
  });

  test("a run whose idle limit leaves no room for an exit grace says so once", async () => {
    const run = await drive(`yield ${dequeued};`, "", "1000");
    assert.equal(run.signal, null, run.out);
    assert.equal(run.out.match(/no room for an exit grace/g)?.length, 1, run.out);
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
  const hosts = sourcesUnder(repoRoot, ["tests"], /\.test\.ts$/)
    .filter(([f]) => !f.startsWith("tests/tooling/"))
    .map(([f, text]) => ({ f, src: blankCommentsAndStrings(text) }))
    .filter(({ src }) => /\bstartTestServer\(/.test(src));

  test("the scan finds the files that host a server", () => {
    assert.ok(hosts.length >= 40, `only ${hosts.length} files call startTestServer`);
  });

  test("none of them runs a child synchronously", () => {
    const blocking = hosts.filter(({ src }) => /\b(execFileSync|execSync|spawnSync)\(/.test(src)).map(({ f }) => f);
    assert.deepEqual(blocking, []);
  });
});
