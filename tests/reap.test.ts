import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { orphans, staleByAge, netstatListeners, toolingRoots, ownedByTooling } from "../scripts/reap.mjs";
import { memoryVerdict, memoryFloor } from "../scripts/preflightMemory.mjs";

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
