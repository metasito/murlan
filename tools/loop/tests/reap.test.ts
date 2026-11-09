import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { ownerArg } from "../../ci/e2eOwner.mjs";
import {
  orphans,
  staleByAge,
  lsofSockets,
  readListeners,
  staleE2eServers,
  netstatSockets,
  toolingRoots,
  checkoutRoot,
  ownedByTooling,
  wouldTakeSelf,
  isSessionHost,
  parseWindowsProcessJson,
  readProcessTable,
  processTable,
  reap,
  worktreeOrphans,
  reapWorktree,
} from "../reap.mjs";

const HOUR = 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function proc(overrides: Partial<{ pid: number; ppid: number; startedAt: number }>) {
  return { pid: 100, ppid: 1, startedAt: NOW - 3 * HOUR, ...overrides };
}

describe("orphans", () => {
  const opts = { livePids: new Set([1, 42]), minAgeMs: 2 * HOUR, now: NOW, keep: new Set<number>() };

  test("reaps a process whose parent is gone and which is past the age floor", () => {
    assert.deepEqual(
      orphans([proc({ pid: 7, ppid: 999 })], opts).map((p: { pid: number }) => p.pid),
      [7]
    );
  });

  test("never reaps a process whose parent is still alive", () => {
    assert.deepEqual(orphans([proc({ pid: 7, ppid: 42 })], opts), []);
  });

  /**
   * The age floor is what separates a session that crashed from one that is
   * mid-run: a reaper with only the parent test would kill the suite that
   * invoked it the moment its launcher exited.
   */
  test("never reaps a process younger than the age floor", () => {
    assert.deepEqual(orphans([proc({ pid: 7, ppid: 999, startedAt: NOW - HOUR })], opts), []);
  });

  /**
   * A start time the platform did not give up reads as 1970, which is older than any floor.
   * The guard has to fail closed or it reaps everything it was written to spare.
   */
  test("never reaps a process whose start time could not be read", () => {
    for (const startedAt of [0, NaN, undefined]) {
      assert.deepEqual(
        orphans([{ pid: 7, ppid: 999, startedAt } as { pid: number; ppid: number; startedAt: number }], opts),
        [],
        `startedAt ${String(startedAt)} must not read as an old process`
      );
    }
  });

  test("never reaps a pid it was told to keep", () => {
    assert.deepEqual(orphans([proc({ pid: 7, ppid: 999 })], { ...opts, keep: new Set([7]) }), []);
  });
});

describe("netstatListeners", () => {
  const netstat = [
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    0.0.0.0:5199           0.0.0.0:0              LISTENING       4242",
    "  TCP    127.0.0.1:8081         0.0.0.0:0              LISTENING       777",
    "  TCP    127.0.0.1:5199         127.0.0.1:61000        TIME_WAIT       0",
    "  TCP    127.0.0.1:61001        127.0.0.1:5199         ESTABLISHED     9999",
  ].join("\n");

  test("reads the port off each listening socket and ignores connections", () => {
    assert.deepEqual(netstatSockets(netstat), [
      { pid: 4242, port: 5199 },
      { pid: 777, port: 8081 },
    ]);
  });

  test("lsof -Fpn output reads the same way", () => {
    assert.deepEqual(lsofSockets("p4242\nn*:41233\nn[::]:41233\np777\nn127.0.0.1:8081\n"), [
      { pid: 4242, port: 41233 },
      { pid: 4242, port: 41233 },
      { pid: 777, port: 8081 },
    ]);
  });

});

describe("readListeners", () => {
  const withPath = <T,>(dir: string, run: () => T): T => {
    const was = process.env.PATH;
    process.env.PATH = dir;
    try {
      return run();
    } finally {
      process.env.PATH = was;
    }
  };

  test("sees a socket this process is listening on", async () => {
    const server = net.createServer().listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const { port } = server.address() as net.AddressInfo;
      const { sockets, blind } = readListeners();
      assert.equal(blind, null);
      assert.ok(sockets.some((s: { pid: number; port: number }) => s.pid === process.pid && s.port === port));
    } finally {
      server.close();
    }
  });

  /** An unreadable machine must not read as an empty one: the sweep would take what it could not see held a port. */
  test("a PATH without lsof is blind, never an empty list", () => {
    const empty = mkdtempSync(path.join(tmpdir(), "reap-nopath-"));
    try {
      const { sockets, blind } = withPath(empty, () => readListeners({ platform: "linux" }));
      assert.deepEqual(sockets, []);
      assert.match(blind ?? "", /lsof could not run/);
      assert.match(withPath(empty, () => readListeners({ platform: "win32" })).blind ?? "", /netstat could not run/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test("a tool that ran and found nothing is not blind", () => {
    const bin = mkdtempSync(path.join(tmpdir(), "reap-lsof-"));
    try {
      writeFileSync(path.join(bin, "lsof"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
      assert.deepEqual(withPath(bin, () => readListeners({ platform: "linux" })), { sockets: [], blind: null });
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });
});

describe("staleByAge", () => {
  const opts = { maxAgeMs: 24 * HOUR, now: NOW, keep: new Set([9]) };

  /**
   * The processes this exists for keep a live parent — a crashed session leaves its bash and cmd
   * resident too — so it must not repeat the parent test that already missed them.
   */
  test("takes an old process even though its parent is alive", () => {
    assert.deepEqual(
      staleByAge([proc({ pid: 7, ppid: 1, startedAt: NOW - 100 * HOUR })], opts).map(
        (p: { pid: number }) => p.pid
      ),
      [7]
    );
  });

  test("leaves anything younger than the age alone", () => {
    assert.deepEqual(staleByAge([proc({ pid: 7, startedAt: NOW - 3 * HOUR })], opts), []);
  });

  test("never takes its own caller, however old the session is", () => {
    assert.deepEqual(staleByAge([proc({ pid: 9, startedAt: NOW - 100 * HOUR })], opts), []);
  });

  test("never takes a process whose start time could not be read", () => {
    assert.deepEqual(staleByAge([proc({ pid: 7, startedAt: 0 })], opts), []);
  });
});

describe("staleE2eServers", () => {
  const server = (pid: number, ppid: number, owner: number | null, extra = "") => ({
    pid,
    ppid,
    name: "node",
    commandLine: `node ${checkoutRoot()}/server/index.ts${owner === null ? "" : ` ${ownerArg(owner)}`}${extra}`,
    startedAt: NOW - HOUR,
  });
  const wrapper = (pid: number) => ({ pid, ppid: 1, name: "node", commandLine: `node ${checkoutRoot()}/scripts/e2e-server.mjs`, startedAt: NOW - 2 * HOUR });
  const init = { pid: 1, ppid: 0, name: "init", commandLine: "/sbin/init", startedAt: NOW - 100 * HOUR };
  const listening = (...pids: number[]) => pids.map((pid) => ({ pid, port: 40000 + pid }));
  const take = (table: ReturnType<typeof server>[], pids: number[]) =>
    staleE2eServers(listening(...pids), table, table.filter((p) => p.pid !== 1)).map((s: { pid: number }) => s.pid);

  /** Orphans are reparented to pid 1, which is alive: parentage cannot tell a leftover from a run. */
  test("takes a server whose run is gone, though pid 1 is its live parent", () => {
    assert.deepEqual(take([init, server(500, 1, 900)], [500]), [500]);
  });

  test("leaves a server whose run is alive", () => {
    assert.deepEqual(take([init, wrapper(900), server(500, 900, 900)], [500]), []);
  });

  test("a pid reused by another program is not the run", () => {
    const reused = { pid: 900, ppid: 1, name: "node", commandLine: "node something-else.js", startedAt: NOW - 2 * HOUR };
    assert.deepEqual(take([init, reused, server(500, 1, 900)], [500]), [500]);
    assert.deepEqual(take([init, { ...wrapper(900), startedAt: NOW }, server(500, 1, 900)], [500]), [500]);
  });

  test("a run whose command line could not be read is not shown to be dead", () => {
    assert.deepEqual(take([init, { ...wrapper(900), commandLine: "" }, server(500, 1, 900)], [500]), []);
  });

  /** The class kills what no ownership rule vouched for otherwise, so a server naming no run is never taken. */
  test("spares a server that names no run, and one whose path only resembles ours", () => {
    const lookalike = { ...server(501, 1, null), commandLine: `node ${checkoutRoot()}/observer/index.ts` };
    assert.deepEqual(take([init, server(500, 1, null), lookalike], [500, 501]), []);
  });

  test("takes a pid it cannot describe for nothing", () => {
    assert.deepEqual(take([init], [777]), []);
  });

  test("names a server once however many sockets it holds", () => {
    assert.deepEqual(take([init, server(500, 1, 900)], [500, 500]), [500]);
  });
});

describe("checkoutRoot", () => {
  /** The main worktree, which `git worktree list` names first — a different question from the one
   * `checkoutRoot` asks, so the two agreeing is a check and not the implementation restated. */
  const mainWorktreeOf = (cwd: string) =>
    execFileSync("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8" })
      .split("\n")[0]
      .replace(/^worktree /, "")
      .trim();

  /**
   * The one input `ownedByTooling` is matched against. One directory out and every class — orphan,
   * stale — quietly matches nothing, and `--dry-run` reports a clean machine.
   */
  test("is the checkout the suite's own tree hangs off", () => {
    assert.equal(checkoutRoot(), mainWorktreeOf(path.dirname(fileURLToPath(import.meta.url))));
    assert.ok(
      ownedByTooling(`node ${path.join(checkoutRoot(), "tools", "loop", "queue-loop.mjs")}`, toolingRoots({ repoRoot: checkoutRoot() })),
      "the root it derives does not match a process running out of this checkout"
    );
  });

  /**
   * A repository of its own, because the answer has to differ from the question: CI checks out one
   * worktree and nothing else, so a case that reads only the tree it runs in agrees with every
   * wrong answer there and reds for nobody but an agent on this machine.
   *
   * The fixture sits outside `.worktrees/` on purpose. Inside it, a root derived from the
   * worktree's own path lands on the checkout anyway and the case stops discriminating.
   */
  test("from inside a worktree, answers the checkout and not the worktree", () => {
    const repo = mkdtempSync(path.join(tmpdir(), "reap-checkout-"));
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], {
        cwd,
        encoding: "utf8",
      }).trim();
    try {
      git(repo, "init", "-q");
      git(repo, "commit", "-q", "--allow-empty", "-m", "root");
      const worktree = path.join(repo, "elsewhere", "wt");
      git(repo, "worktree", "add", "-q", "--detach", worktree, "HEAD");

      assert.notEqual(
        git(worktree, "rev-parse", "--show-toplevel"),
        mainWorktreeOf(repo),
        "the fixture is not a second worktree, so nothing here tells the two answers apart"
      );
      assert.equal(checkoutRoot(worktree), mainWorktreeOf(repo));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("ownedByTooling", () => {
  const roots = toolingRoots({
    repoRoot: "C:/Users/roton/murlan",
    env: { LOCALAPPDATA: "C:/Users/roton/AppData/Local" } as unknown as NodeJS.ProcessEnv,
    platform: "win32",
  });
  const owned = (cl: string) => ownedByTooling(cl, roots, "win32");

  test("claims a jest worker, which runs out of the repo's own node_modules", () => {
    assert.equal(
      owned(String.raw`"C:\Program Files\nodejs\node.exe" C:\Users\roton\murlan\node_modules\jest-worker\build\workers\processChild.js`),
      true
    );
  });

  /**
   * Playwright keeps its browsers in the user's profile, not under the checkout, so a rule that
   * knew only the repo root would leave every stray browser behind — and the browser is the
   * process class that actually costs hundreds of megabytes.
   */
  test("claims a Playwright browser, which lives outside the checkout entirely", () => {
    assert.equal(
      owned(String.raw`C:\Users\roton\AppData\Local\ms-playwright\chromium_headless_shell-1234\chrome-headless-shell-win64\chrome-headless-shell.exe --headless`),
      true
    );
  });

  test("claims a process running from a worktree of the repo", () => {
    assert.equal(
      owned(String.raw`"node" C:\Users\roton\murlan\.worktrees\w465\node_modules\.bin\jest`),
      true
    );
  });

  /**
   * The reason this is a path rule and not a list of process names. All three of these were
   * running on the owner's machine while the reaper was being written.
   */
  test("never claims something that merely shares a name with our tooling", () => {
    for (const cl of [
      String.raw`"C:\Program Files\Google\Chrome\Application\chrome.exe" --profile-directory=Default`,
      String.raw`C:\Users\roton\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe -m hermes_cli.main gateway run`,
      String.raw`"C:\Program Files (x86)\Microsoft\EdgeWebView\Application\msedgewebview2.exe" --type=renderer`,
    ]) {
      assert.equal(owned(cl), false, cl.slice(0, 60));
    }
  });

  /** A command line the platform would not give up names nothing, so it claims nothing. */
  test("claims nothing when the command line could not be read", () => {
    for (const cl of [null, undefined, ""]) {
      assert.equal(ownedByTooling(cl as unknown as string, roots, "win32"), false);
    }
  });
});

/**
 * The session this reaper runs inside. `node` is the reaper; every link above it is a real
 * one read off the owner's machine, ending — as it always does on Windows — at a launcher
 * that has already exited and so is absent from the table.
 */
const SESSION = [
  { pid: 42320, ppid: 1, name: "<gone>", commandLine: "", startedAt: NOW - 9 * HOUR, absent: true },
  {
    pid: 12148,
    ppid: 42320,
    name: "WindowsTerminal.exe",
    commandLine: String.raw`"C:\Program Files\WindowsApps\Microsoft.WindowsTerminal_1.24.0_x64__8wekyb3d8bbwe\wt.exe" -d C:\Users\roton\murlan`,
    startedAt: NOW - 9 * HOUR,
  },
  { pid: 9436, ppid: 12148, name: "powershell.exe", commandLine: String.raw`C:\windows\System32\WindowsPowerShell\v1.0\powershell.exe`, startedAt: NOW - 9 * HOUR },
  { pid: 24044, ppid: 9436, name: "claude.exe", commandLine: String.raw`"C:\Users\roton\.local\bin\claude.exe"`, startedAt: NOW - 9 * HOUR },
  { pid: 43240, ppid: 24044, name: "bash.exe", commandLine: String.raw`"C:\Program Files\Git\bin\bash.exe" -c -l "cd C:\Users\roton\murlan && npm run reap"`, startedAt: NOW - 60_000 },
  { pid: 39464, ppid: 43240, name: "node.exe", commandLine: String.raw`node C:\Users\roton\murlan\scripts\reap.mjs`, startedAt: NOW - 5_000 },
].filter((p) => !p.absent);

const WIN = { platform: "win32" as const };
const REAP_PID = 39464;

describe("wouldTakeSelf", () => {
  /**
   * The defect that stopped two unattended runs. `taskkill /T` ends the whole tree, and the
   * terminal's tree is the session: the reaper, the shell, the agent, the window.
   */
  test("refuses the terminal hosting the reaper", () => {
    assert.equal(wouldTakeSelf(SESSION, 12148, REAP_PID), true);
  });

  test("refuses every link between the terminal and the reaper", () => {
    for (const pid of [9436, 24044, 43240, 39464]) {
      assert.equal(wouldTakeSelf(SESSION, pid, REAP_PID), true, `pid ${pid}`);
    }
  });

  /**
   * The guard has to leave real leftovers takeable, or it is just an off switch. A sibling
   * tree shares no link with the reaper's.
   */
  test("allows a tree the reaper is not inside", () => {
    const table = [
      ...SESSION,
      { pid: 700, ppid: 99999, name: "node.exe", commandLine: String.raw`node C:\Users\roton\murlan\node_modules\.bin\jest`, startedAt: NOW - 5 * HOUR },
      { pid: 701, ppid: 700, name: "node.exe", commandLine: "worker", startedAt: NOW - 5 * HOUR },
    ];
    assert.equal(wouldTakeSelf(table, 700, REAP_PID), false);
  });

  test("a table that does not describe the reaper proves nothing safe, so it refuses", () => {
    assert.equal(wouldTakeSelf([], 700, REAP_PID), true, "no table");
    const blindToSelf = [{ pid: 700, ppid: 99999, name: "node.exe", commandLine: "x", startedAt: NOW }];
    assert.equal(wouldTakeSelf(blindToSelf, 700, REAP_PID), true, "a table missing the reaper's own pid");
  });

  /**
   * The whole point of reading the tree downward rather than walking parents upward: the walk
   * stops at the first pid the snapshot is missing, and on Windows the launcher above a
   * terminal is always missing. The tree cannot be fooled that way.
   */
  test("still refuses the terminal when its own parent is absent from the table", () => {
    assert.equal(
      SESSION.some((p) => p.pid === 42320),
      false,
      "the fixture must reproduce the broken parent link"
    );
    assert.equal(wouldTakeSelf(SESSION, 12148, REAP_PID), true);
  });
});

describe("isSessionHost", () => {
  /**
   * A terminal's command line carries the directory it was opened in, so `ownedByTooling`
   * reads `-d C:\Users\roton\murlan` and claims the window as this repo's tooling. Where a
   * process was started is not what it is running.
   */
  test("a terminal opened in the repo is never claimed as tooling", () => {
    const terminal = SESSION.find((p) => p.pid === 12148)!;
    const roots = toolingRoots({
      repoRoot: "C:/Users/roton/murlan",
      env: { LOCALAPPDATA: "C:/Users/roton/AppData/Local" } as unknown as NodeJS.ProcessEnv,
      platform: "win32",
    });
    assert.match(
      terminal.commandLine.toLowerCase(),
      /murlan/,
      "the command line really does name the repo — that is the trap"
    );
    assert.equal(isSessionHost(terminal.commandLine, WIN), true);
    assert.equal(ownedByTooling(terminal.commandLine, roots, "win32"), false);
  });

  /** The shell and the console host between the window and the agent, same reasoning. */
  test("neither is the shell the terminal runs, nor its console host", () => {
    const roots = toolingRoots({
      repoRoot: "C:/Users/roton/murlan",
      env: { LOCALAPPDATA: "C:/Users/roton/AppData/Local" } as unknown as NodeJS.ProcessEnv,
      platform: "win32",
    });
    for (const cl of [
      String.raw`C:\windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -Command cd C:\Users\roton\murlan`,
      String.raw`\??\C:\windows\system32\conhost.exe 0x4 C:\Users\roton\murlan`,
    ]) {
      assert.equal(ownedByTooling(cl, roots, "win32"), false, cl.slice(0, 60));
    }
  });

  test("claims the console host and the shell it runs", () => {
    assert.equal(isSessionHost(String.raw`\??\C:\windows\system32\conhost.exe 0x4`, WIN), true);
    assert.equal(
      isSessionHost(String.raw`C:\windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile`, WIN),
      true
    );
  });

  test("claims nothing that actually runs our work", () => {
    for (const cl of [
      String.raw`node C:\Users\roton\murlan\scripts\reap.mjs`,
      String.raw`"C:\Program Files\nodejs\node.exe" C:\Users\roton\murlan\node_modules\jest-worker\build\workers\processChild.js`,
      String.raw`C:\Users\roton\AppData\Local\ms-playwright\chromium-1234\chrome-headless-shell.exe --headless`,
      "",
    ]) {
      assert.equal(isSessionHost(cl, WIN), false, cl.slice(0, 50));
    }
  });
});

/**
 * `killPid` is the last thing between a wrong selection and a terminated session, and it is
 * not exported — nothing above can reach it. Reading the source is the only way to state that
 * it still asks, and the claim is worth stating: every other guard in the file has failed at
 * least once.
 */
describe("killPid consults the tree it is about to end", () => {
  const source = readFileSync(new URL("../reap.mjs", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("function killPid("));

  test("checks wouldTakeSelf before any kill", () => {
    const guard = body.indexOf("wouldTakeSelf");
    const kill = body.indexOf("killTree(");
    assert.ok(guard > 0, "killPid must consult wouldTakeSelf");
    assert.ok(kill > 0, "killPid must kill through killTree");
    assert.ok(guard < kill, "and must consult it before terminating anything");
  });
});

/**
 * One process carrying a raw control byte in its command line once took the whole reaper down —
 * and with it `npm run agent:check`, because `JSON.parse` rejects the entire table over a single
 * unescaped byte and nothing above `processTable` catches it.
 */
describe("parseWindowsProcessJson", () => {
  const row = (commandLine: string) =>
    `[{"ProcessId":42,"ParentProcessId":7,"Name":"node.exe","CommandLine":"${commandLine}",` +
    `"Started":1700000000000}]`;

  test("reads the shape ConvertTo-Json emits", () => {
    assert.deepEqual(parseWindowsProcessJson(row("node index.mjs")), [
      {
        pid: 42,
        ppid: 7,
        name: "node.exe",
        commandLine: "node index.mjs",
        startedAt: 1_700_000_000_000,
      },
    ]);
  });

  test("survives a raw control byte the serializer left unescaped", () => {
    const raw = row(`node a${String.fromCharCode(1)}b.mjs`);
    assert.throws(() => JSON.parse(raw), "the fixture must be what JSON.parse rejects");

    const [only] = parseWindowsProcessJson(raw);
    assert.equal(only.commandLine, "node ab.mjs", "the byte is dropped, the rest of the line is not");
    assert.equal(only.pid, 42, "and the row it sat in still arrives");
  });

  test("keeps an escaped control character, which is legitimate JSON", () => {
    const [only] = parseWindowsProcessJson(row("node a\\tb.mjs"));
    assert.equal(only.commandLine, `node a${String.fromCharCode(9)}b.mjs`);
  });

  test("a single object is one row, not a table of its keys", () => {
    const rows = parseWindowsProcessJson(row("node solo.mjs").slice(1, -1));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].pid, 42);
  });

  test("no output is no processes, not a parse error", () => {
    assert.deepEqual(parseWindowsProcessJson("  \n"), []);
  });
});

describe("readProcessTable", () => {
  test("an answer that is not a table degrades to an empty one, named blind, instead of crashing the sweep", () => {
    const out = readProcessTable("Impossibile trovare il testo del messaggio...", "pwsh");
    assert.deepEqual(out.rows, []);
    assert.match(out.blind ?? "", /pwsh/, "the skip names which binary produced it, not just that one happened");
  });

  test("a PowerShell that answered nothing, or is missing, is blind, never a machine with no processes", () => {
    const out = readProcessTable("", "pwsh");
    assert.deepEqual(out.rows, []);
    assert.match(out.blind ?? "", /pwsh.*no process table/);
  });

  test("still reads a well-formed table, and sees", () => {
    const out = readProcessTable('[{"ProcessId":1,"ParentProcessId":0,"Name":"x","CommandLine":"x","Started":1}]', "pwsh");
    assert.equal(out.rows.length, 1);
    assert.equal(out.blind, null);
  });
});

describe("worktreeOrphans", () => {
  const ROOT = "C:\\Users\\roton\\murlan";
  const TREE = `${ROOT}\\.worktrees\\agent-1641`;
  const row = (pid: number, ppid: number, name: string, commandLine: string) => ({ pid, ppid, name, commandLine, startedAt: NOW - 60_000 });
  const table = [
    row(10, 1, "node.exe", `node ${ROOT}\\tools\\loop\\queue-loop.mjs`),
    row(20, 10, "claude.exe", `claude.exe -p "/queue 1641" --cwd ${TREE}`),
    row(21, 20, "node.exe", `node ${ROOT}\\node_modules\\npm\\bin\\npm-cli.js run agent:check --prefix ${TREE}`),
    row(22, 21, "node.exe", `node ${TREE}\\tools\\loop\\agent-check.mjs`),
    row(30, 999, "node.exe", `node ${TREE}\\node_modules\\eslint\\bin\\eslint.js --cache-location=${TREE}\\.expo\\cache\\eslint\\`),
    row(31, 999, "node.exe", `node ${ROOT}\\.worktrees\\agent-1650\\tools\\loop\\agent-check.mjs`),
    row(32, 999, "node.exe", `node ${ROOT}\\.worktrees\\agent-16\\node_modules\\jest\\bin\\jest.js`),
    row(33, 999, "bash.exe", `bash.exe -c "cd ${TREE} && sleep 1000"`),
    row(34, 999, "node.exe", `node ${TREE}\\node_modules\\expo\\bin\\cli start --port 5199`),
  ];
  const take = (keep = new Set<number>()) =>
    worktreeOrphans(table, { worktree: TREE, selfPid: 22, keep, platform: "win32" }).map((p: { pid: number }) => p.pid);

  test("reaps this worktree's stale eslint however young it is, and keeps the peer, the supervisor and its own chain", () => {
    assert.deepEqual(take(new Set([34])), [30]);
  });

  test("a peer worktree whose name is a prefix of this one is not this one", () => {
    const peer = worktreeOrphans(table, { worktree: `${ROOT}\\.worktrees\\agent-16`, selfPid: 22, platform: "win32" });
    assert.deepEqual(peer.map((p: { pid: number }) => p.pid), [32]);
  });

  test("run from the shared checkout it takes nothing: every peer and the supervisor sit below that root", () => {
    const shared = worktreeOrphans(table, { worktree: `${ROOT}\\`, checkout: ROOT, selfPid: 22, platform: "win32" });
    assert.deepEqual(shared, []);
  });

  test("keeps what it is told to, such as a server holding a port", () => {
    assert.deepEqual(take(), [30, 34]);
  });

  test("takes only node, never a shell that merely sits in the tree", () => {
    assert.ok(!take().includes(33));
  });

  test("a worktree path given with forward slashes or a trailing separator matches the same processes", () => {
    const slashed = worktreeOrphans(table, { worktree: `${TREE.replace(/\\/g, "/")}/`, selfPid: 22, keep: new Set([34]), platform: "win32" });
    assert.deepEqual(slashed.map((p: { pid: number }) => p.pid), [30]);
  });

  test("reapWorktree names each one it would take, and kills nothing on a dry run", () => {
    const said: string[] = [];
    const self = row(process.pid, 22, "node.exe", `node ${TREE}\\tools\\loop\\agent-check.mjs`);
    const took = reapWorktree(TREE, {
      dryRun: true,
      say: (l: string) => said.push(l),
      readTable: () => ({ rows: [...table, self], blind: null }),
      listeners: () => ({ sockets: [{ pid: 34, port: 5199 }], blind: null }),
    });
    assert.deepEqual(took, [30]);
    assert.match(said.join("\n"), /would kill node\.exe pid 30/);
  });
});

describe("the sweep, called in-process as housekeeping calls it", () => {
  test("says each line through its caller and counts exactly what it named to take", async () => {
    const said: string[] = [];
    const self = { pid: process.pid, ppid: 1, name: "node", commandLine: "node reap-test", startedAt: Date.now() };
    const { took } = await reap({
      dryRun: true,
      stale: true,
      say: (l: string) => said.push(l),
      readTable: () => ({ rows: [self], blind: null }),
      listeners: () => ({ sockets: [], blind: null }),
    });
    assert.ok(said.some((l) => /e2e server/.test(l)), said.join("\n"));
    assert.equal(took, said.filter((l) => /would (kill|clear)/.test(l)).length, said.join("\n"));
  });

  const OURS = () => `node ${checkoutRoot()}/server/index.ts ${ownerArg(999999)}`;
  const orphan = (commandLine: string, ppid = 999999) => ({ pid: 777, ppid, name: "node", commandLine, startedAt: Date.now() });

  async function sweep(proc: ReturnType<typeof orphan>, port: number, others: ReturnType<typeof orphan>[] = []) {
    const said: string[] = [];
    const { took } = await reap({
      dryRun: true,
      say: (l: string) => said.push(l),
      readTable: () => ({ rows: [proc, ...others], blind: null }),
      listeners: () => ({ sockets: [{ pid: 777, port }], blind: null }),
    });
    return { said: said.join("\n"), took };
  }

  test("finds an e2e server on whatever port the OS gave it", async () => {
    const { said, took } = await sweep(orphan(OURS()), 41233);
    assert.match(said, /would clear the e2e server on port 41233, node pid 777/);
    assert.equal(took, 1);
  });

  test("a server whose run is alive is left alone", async () => {
    const run = { pid: 888, ppid: 1, name: "node", commandLine: `node ${checkoutRoot()}/scripts/e2e-server.mjs`, startedAt: Date.now() - 60_000 };
    const { said, took } = await sweep(orphan(OURS().replace("999999", "888"), 888), 41233, [run]);
    assert.equal(took, 0, said);
  });

  test("an unmarked detached server, on any port, is not a leftover", async () => {
    for (const port of [5000, 41233]) {
      const { took } = await sweep(orphan(`node ${checkoutRoot()}/server/index.ts`), port);
      assert.equal(took, 0, `port ${port}`);
    }
  });

  test("an orphan that is not ours is left alone", async () => {
    const { said, took } = await sweep(orphan("node some-other-dev-server.js"), 41233);
    assert.equal(took, 0, said);
    assert.doesNotMatch(said, /would clear/);
  });

  test("a listener of ours that is not the server is left alone", async () => {
    const { took } = await sweep(orphan(`node ${checkoutRoot()}/serve.js`), 41233);
    assert.equal(took, 0);
  });

  test("a blind table comes back blind and is said, never read as a clean machine", async () => {
    const said: string[] = [];
    const { took, blind } = await reap({
      dryRun: true,
      say: (l: string) => said.push(l),
      readTable: () => ({ rows: [], blind: "no table" }),
      listeners: () => ({ sockets: [], blind: null }),
    });
    assert.equal(blind, "no table");
    assert.ok(said.includes("reap: no table"), said.join("\n"));
    assert.equal(took, 0);
  });
});

describe("a sweep that cannot see what is listening", () => {
  test("says so, takes nothing and reports blind, never a clean machine", async () => {
    const said: string[] = [];
    const server = { pid: 777, ppid: 1, name: "node", commandLine: `node ${checkoutRoot()}/server/index.ts ${ownerArg(999999)}`, startedAt: Date.now() };
    const self = { pid: process.pid, ppid: 1, name: "node", commandLine: "node reap-test", startedAt: Date.now() };
    const { took, blind } = await reap({
      say: (l: string) => said.push(l),
      readTable: () => ({ rows: [self, server], blind: null }),
      listeners: () => ({ sockets: [], blind: "lsof could not run" }),
    });
    assert.equal(took, 0);
    assert.equal(blind, "lsof could not run");
    assert.ok(said.includes("reap: lsof could not run"), said.join("\n"));
  });

  test("the worktree sweep takes nothing either", () => {
    const TREE = "/w/tree";
    const stray = { pid: 30, ppid: 999, name: "node", commandLine: `node ${TREE}/node_modules/eslint/bin/eslint.js`, startedAt: Date.now() };
    const self = { pid: process.pid, ppid: 1, name: "node", commandLine: "node x", startedAt: Date.now() };
    const said: string[] = [];
    const took = reapWorktree(TREE, {
      dryRun: true,
      say: (l: string) => said.push(l),
      readTable: () => ({ rows: [self, stray], blind: null }),
      listeners: () => ({ sockets: [], blind: "lsof could not run" }),
    });
    assert.deepEqual(took, []);
  });
});

/**
 * Real processes: an orphan is parented by whatever adopts it, which no table fixture can state.
 * The table handed to the sweep is cut to these and the reaper, so nothing else on the machine is
 * in reach of the kill.
 */
describe("a real orphaned e2e server", () => {
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  async function leave(dir: string, ...args: string[]) {
    const script = path.join(dir, "listen.mjs");
    writeFileSync(script, 'import net from "node:net";\nnet.createServer().listen(0, "127.0.0.1", () => console.log("pid " + process.pid));\nsetInterval(() => {}, 1000);\n');
    const out = path.join(dir, `out-${args.length}-${Math.random().toString(36).slice(2)}`);
    // The shell exits at once, so the node it started is adopted by pid 1 (or the nearest subreaper).
    execFileSync("sh", ["-c", `"${process.execPath}" "${script}" "$@" > "${out}" 2>&1 &`, "sh", ...args]);
    for (let i = 0; i < 100; i++) {
      const pid = Number(readFileSync(out, "utf8").match(/pid (\d+)/)?.[1]);
      if (pid) return pid;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("the orphan never listened");
  }

  test("is found and reaped; an unmarked one and one with a live run are spared", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "reap-orphan-"));
    const entry = path.join(checkoutRoot(), "server", "index.ts");
    const pids: number[] = [];
    try {
      const dead = execFileSync(process.execPath, ["-e", "console.log(process.pid)"], { encoding: "utf8" }).trim();
      const marked = await leave(dir, entry, ownerArg(Number(dead)));
      const unmarked = await leave(dir, entry);
      const wrapperDir = path.join(dir, "wrapper");
      mkdirSync(wrapperDir);
      const live = await leave(wrapperDir, path.join(checkoutRoot(), "scripts", "e2e-server.mjs"));
      const guarded = await leave(dir, entry, ownerArg(live));
      pids.push(marked, unmarked, live, guarded);

      const parent = (pid: number) => Number(execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" }).trim());
      assert.ok(!alive(parent(marked)) || parent(marked) <= 1 || parent(marked) !== process.pid, "the fixture must be adopted, not ours");

      const { rows } = processTable();
      const cut = rows.filter((p: { pid: number }) => [process.pid, ...pids].includes(p.pid));
      const said: string[] = [];
      const { took } = await reap({ say: (l: string) => said.push(l), readTable: () => ({ rows: cut, blind: null }) });

      for (let i = 0; i < 100 && alive(marked); i++) await new Promise((r) => setTimeout(r, 50));
      assert.equal(alive(marked), false, said.join("\n"));
      assert.equal(alive(unmarked), true, "an unmarked server must be spared");
      assert.equal(alive(guarded), true, "a server whose run is alive must be spared");
      assert.equal(took, 1, said.join("\n"));
    } finally {
      for (const pid of pids) if (alive(pid)) process.kill(pid, "SIGKILL");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("processTable", () => {
  test("sees this host's processes, this one among them", () => {
    const { rows, blind } = processTable();
    assert.equal(blind, null);
    assert.ok(rows.some((p: { pid: number }) => p.pid === process.pid), "the table does not show the process reading it");
  });
});
