import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  orphans,
  staleByAge,
  netstatListeners,
  toolingRoots,
  ownedByTooling,
  cpuRatios,
  isSystemProcess,
  burningOrphans,
  psTimeToMs,
  stalePortHolders,
} from "../scripts/reap.mjs";
import preflightMemory, { memoryVerdict, memoryFloor } from "../scripts/preflightMemory.mjs";

const HOUR = 60 * 60 * 1000;
const NOW = 1_700_000_000_000;
const GB = 1024 ** 3;

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

  test("takes only what is listening on the port asked for", () => {
    assert.deepEqual(netstatListeners(netstat, 5199), [4242]);
  });

  /**
   * A client connected *to* the port holds a socket naming it. Killing that is killing whoever
   * was talking to the server rather than the server.
   */
  test("never takes a connection merely involving the port", () => {
    assert.equal(netstatListeners(netstat, 5199).includes(9999), false);
  });

  test("with no port, every listener — this is the spare-list, so it must not miss one", () => {
    assert.deepEqual(
      netstatListeners(netstat).sort((a: number, b: number) => a - b),
      [777, 4242]
    );
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

describe("stalePortHolders", () => {
  const table = [
    { pid: 500, ppid: 42, startedAt: NOW - HOUR, name: "node.exe", commandLine: "node e2e-server.mjs" },
    { pid: 501, ppid: 999, startedAt: NOW - HOUR, name: "node.exe", commandLine: "node e2e-server.mjs" },
    { pid: 42, ppid: 1, startedAt: NOW - HOUR, name: "node.exe", commandLine: "playwright" },
  ];

  /**
   * A sweep must not be able to end a suite that is running. Playwright stays alive for the whole
   * run and the webServer is its child, so a live holder has a live parent — the same signal
   * `orphans` uses, and a much better one than age here.
   */
  test("leaves a holder whose launcher is still running", () => {
    assert.deepEqual(stalePortHolders([500], table), []);
  });

  test("takes a holder left behind by a session that exited", () => {
    assert.deepEqual(stalePortHolders([501], table), [501]);
  });

  /**
   * A pid the process table does not describe cannot be shown to be a leftover, and this is the
   * one class that kills something no ownership rule vouched for. It has to fail closed.
   */
  test("leaves a holder it cannot find in the process table", () => {
    assert.deepEqual(stalePortHolders([777], table), []);
  });

  test("judges each holder on its own parent", () => {
    assert.deepEqual(stalePortHolders([500, 501], table), [501]);
  });
});

describe("cpuRatios", () => {
  const before = [{ pid: 7, cpuMs: 1_000 }, { pid: 8, cpuMs: 5_000 }];

  test("a process that burned a full second of CPU in a second reads as a whole core", () => {
    const after = [{ pid: 7, cpuMs: 2_000 }, { pid: 8, cpuMs: 5_000 }];
    const byPid = new Map(
      cpuRatios(before, after, 1_000).map((p: { pid: number; cpuRatio: number }) => [p.pid, p.cpuRatio])
    );
    assert.equal(byPid.get(7), 1);
    assert.equal(byPid.get(8), 0);
  });

  /**
   * Cumulative CPU time is what the platform reports, and a process that burned a core for hours
   * and then went idle still carries all of it. Only the delta across the interval says it is
   * burning one *now*, which is the difference between measuring and assuming.
   */
  test("a long-idle process that once burned hours of CPU reads as idle", () => {
    const idled = [{ pid: 7, cpuMs: 225_000_000 }];
    assert.equal(cpuRatios(idled, idled, 1_000)[0].cpuRatio, 0);
  });

  test("a process absent from the first sample is not rated at all", () => {
    assert.deepEqual(cpuRatios(before, [{ pid: 99, cpuMs: 900 }], 1_000), []);
  });

  test("an unreadable CPU time yields no rating rather than a wrong one", () => {
    for (const cpuMs of [NaN, undefined]) {
      assert.deepEqual(
        cpuRatios([{ pid: 7, cpuMs: 0 }], [{ pid: 7, cpuMs } as { pid: number; cpuMs: number }], 1_000),
        []
      );
    }
  });
});

describe("isSystemProcess", () => {
  const win = { systemRoot: "C:/Windows", platform: "win32" as const };

  test("anything running out of the Windows directory is never a candidate", () => {
    assert.equal(
      isSystemProcess({ pid: 900, commandLine: String.raw`C:\Windows\System32\svchost.exe -k netsvcs` }, win),
      true
    );
  });

  /**
   * Sampled on the owner's machine: the System Idle Process, pid 0, reads at 2297% of a core
   * because its CPU time is summed across all of them. It is the single largest burner the scan
   * sees and it must never be a candidate — nor pid 4, `System`, behind it.
   */
  test("the kernel's own low pids are never candidates, however hot they read", () => {
    assert.equal(isSystemProcess({ pid: 0, commandLine: "" }, win), true);
    assert.equal(isSystemProcess({ pid: 4, commandLine: "System" }, win), true);
  });

  /**
   * On Windows a command line that cannot be read is the signature of a protected process, so the
   * unreadable case has to fail closed — the opposite of `ownedByTooling`, which claims nothing
   * for the same reason.
   */
  test("a process whose command line could not be read is never a candidate", () => {
    assert.equal(isSystemProcess({ pid: 900, commandLine: "" }, win), true);
  });

  test("a Git Bash utility under Program Files is a candidate", () => {
    assert.equal(
      isSystemProcess({ pid: 900, commandLine: String.raw`C:\Program Files\Git\usr\bin\awk.exe !seen[$0]++` }, win),
      false
    );
  });

  test("init and the service managers are never candidates on posix", () => {
    const posix = { platform: "linux" as const };
    assert.equal(isSystemProcess({ pid: 1, commandLine: "/sbin/init" }, posix), true);
    assert.equal(isSystemProcess({ pid: 900, commandLine: "/usr/lib/systemd/systemd-journald" }, posix), true);
    assert.equal(isSystemProcess({ pid: 900, commandLine: "/usr/bin/awk !seen[$0]++" }, posix), false);
  });
});

describe("burningOrphans", () => {
  const opts = {
    livePids: new Set([1, 42]),
    minAgeMs: 2 * HOUR,
    now: NOW,
    keep: new Set<number>(),
    minRatio: 0.2,
    systemRoot: "C:/Windows",
    platform: "win32" as const,
  };
  const burner = (over: Record<string, unknown> = {}) => ({
    pid: 7,
    ppid: 999,
    startedAt: NOW - 62 * HOUR,
    cpuRatio: 1,
    commandLine: String.raw`C:\Program Files\Git\usr\bin\awk.exe !seen[$0]++`,
    ...over,
  });

  /**
   * The case this class exists for: a `tr | fold | awk` pipeline reading `/dev/urandom`, orphaned
   * by a killed Git Bash session that had no SIGHUP to send, burning a core for 62 hours. It
   * names nothing of this repo's, so every ownership-based class was blind to it.
   */
  test("takes a parentless process burning a core for hours, though it is not ours", () => {
    assert.deepEqual(burningOrphans([burner()], opts).map((p: { pid: number }) => p.pid), [7]);
  });

  test("leaves a parentless process that is merely resident", () => {
    assert.deepEqual(burningOrphans([burner({ cpuRatio: 0.01 })], opts), []);
  });

  test("leaves a busy process whose parent is still alive", () => {
    assert.deepEqual(burningOrphans([burner({ ppid: 42 })], opts), []);
  });

  test("leaves a busy orphan that is younger than the age floor", () => {
    assert.deepEqual(burningOrphans([burner({ startedAt: NOW - HOUR })], opts), []);
  });

  test("never takes a Windows process, however busy and however orphaned", () => {
    const system = burner({ commandLine: String.raw`C:\Windows\System32\MsMpEng.exe` });
    assert.deepEqual(burningOrphans([system], opts), []);
  });

  test("never takes what it was told to keep", () => {
    assert.deepEqual(burningOrphans([burner()], { ...opts, keep: new Set([7]) }), []);
  });
});

describe("memoryVerdict", () => {
  test("refuses when free memory is under the floor, naming exhaustion", () => {
    const verdict = memoryVerdict({ freeBytes: 0.2 * GB, totalBytes: 16 * GB });
    assert.equal(verdict.ok, false);
    assert.match(verdict.message, /memory/i);
  });

  test("passes when there is room", () => {
    assert.equal(memoryVerdict({ freeBytes: 8 * GB, totalBytes: 16 * GB }).ok, true);
  });

  /**
   * A fixed floor is a trigger with no floor of its own: on a small box every
   * run sits under it and the check becomes something to switch off.
   */
  test("the floor never exceeds a tenth of the machine, however small it is", () => {
    assert.ok(memoryFloor(2 * GB) <= 0.2 * GB);
    assert.equal(memoryVerdict({ freeBytes: 0.25 * GB, totalBytes: 2 * GB }).ok, true);
  });
});

describe("preflightMemory", () => {
  const settled = () => Promise.resolve();
  // This suite runs on CI too, where the real process.env.CI makes the function return before it
  // samples anything — every case below then passes without exercising a line of it.
  const local = { wait: settled, env: {} as NodeJS.ProcessEnv };

  // A suite tearing down frees its workers in one burst — the other session's hold ~2.6 GB. A
  // reading taken inside that burst refused a run that the identical command, retried a second
  // later with nothing changed, then completed.
  test("a reading taken mid-teardown does not refuse a run the machine can afford", async () => {
    const samples = [0.2 * GB, 8 * GB];
    await preflightMemory({
      sample: () => samples.shift()!,
      totalBytes: 16 * GB,
      ...local,
    });
  });

  test("a machine that is still starved a moment later is still refused", async () => {
    await assert.rejects(
      preflightMemory({ sample: () => 0.2 * GB, totalBytes: 16 * GB, ...local }),
      /memory/i
    );
  });

  // The first report of this was unsound because the refusal's own numbers had scrolled away and
  // had to be reconstructed from a second reading taken seconds later. A refusal has to carry
  // what it saw, or the next one cannot be told from a transient dip either.
  test("a refusal names every reading it took, not just the one it ruled on", async () => {
    const samples = [0.2 * GB, 0.4 * GB];
    await assert.rejects(
      preflightMemory({ sample: () => samples.shift()!, totalBytes: 16 * GB, ...local }),
      (err: Error) => /0\.20 GB/.test(err.message) && /0\.40 GB/.test(err.message)
    );
  });

  // Taking the better of the two readings would clear a box that fell further while we waited,
  // on the strength of a number that had already stopped being true.
  test("a box that degrades while settling is judged on the later reading", async () => {
    const samples = [1.4 * GB, 0.3 * GB];
    await assert.rejects(
      preflightMemory({ sample: () => samples.shift()!, totalBytes: 16 * GB, ...local }),
      /0\.30 GB free/
    );
  });

  test("a machine with room is never sampled twice", async () => {
    let taken = 0;
    await preflightMemory({
      sample: () => {
        taken++;
        return 8 * GB;
      },
      totalBytes: 16 * GB,
      ...local,
    });
    assert.equal(taken, 1);
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

describe("psTimeToMs", () => {
  test("reads ps's cumulative CPU column in each width it prints", () => {
    assert.equal(psTimeToMs("00:00"), 0);
    assert.equal(psTimeToMs("01:30"), 90_000);
    assert.equal(psTimeToMs("02:01:30"), 7_290_000);
    assert.equal(psTimeToMs("2-02:01:30"), 180_090_000);
  });

  test("an unparseable column yields NaN, which cpuRatios then declines to rate", () => {
    assert.equal(Number.isNaN(psTimeToMs("-")), true);
  });
});
