// tests/tooling/preflightMemory.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import preflightMemory, { memoryVerdict, memoryFloor } from "../../tools/ci/preflightMemory.mjs";

const GB = 1024 ** 3;

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
  /**
   * One settle and rule, which is what every case below was written against and what `--no-wait`
   * still does. The cases that exercise the wait itself state their own ceiling; giving these the
   * default would poll a fixed list of readings sixty times over.
   */
  const oneSettle = { ceilingMs: 1000, announce: () => {} };

  // A suite tearing down frees its workers in one burst — the other session's hold ~2.6 GB. A
  // reading taken inside that burst refused a run that the identical command, retried a second
  // later with nothing changed, then completed.
  test("a reading taken mid-teardown does not refuse a run the machine can afford", async () => {
    const samples = [0.2 * GB, 8 * GB];
    await preflightMemory({
      sample: () => samples.shift()!,
      totalBytes: 16 * GB,
      ...local,
      ...oneSettle,
    });
  });

  test("a machine that is still starved a moment later is still refused", async () => {
    await assert.rejects(
      preflightMemory({ sample: () => 0.2 * GB, totalBytes: 16 * GB, ...local, ...oneSettle }),
      /memory/i
    );
  });

  // The first report of this was unsound because the refusal's own numbers had scrolled away and
  // had to be reconstructed from a second reading taken seconds later. A refusal has to carry
  // what it saw, or the next one cannot be told from a transient dip either.
  test("a refusal names every reading it took, not just the one it ruled on", async () => {
    const samples = [0.2 * GB, 0.4 * GB];
    await assert.rejects(
      preflightMemory({ sample: () => samples.shift()!, totalBytes: 16 * GB, ...local, ...oneSettle }),
      (err: Error) => /0\.20 GB/.test(err.message) && /0\.40 GB/.test(err.message)
    );
  });

  // Taking the better of the two readings would clear a box that fell further while we waited,
  // on the strength of a number that had already stopped being true.
  test("a box that degrades while settling is judged on the later reading", async () => {
    const samples = [1.4 * GB, 0.3 * GB];
    await assert.rejects(
      preflightMemory({ sample: () => samples.shift()!, totalBytes: 16 * GB, ...local, ...oneSettle }),
      /0\.30 GB free/
    );
  });

  // A refusal is not a queue. Two sessions share this machine and the second has no way to know
  // when the first will finish, so it waits on the thing that actually gates the run (#642).
  test("a machine that frees up while we wait is not refused", async () => {
    const samples = [0.2 * GB, 0.3 * GB, 0.4 * GB, 8 * GB];
    let waits = 0;
    await preflightMemory({
      sample: () => samples.shift()!,
      totalBytes: 16 * GB,
      wait: async () => {
        waits++;
      },
      env: {} as NodeJS.ProcessEnv,
      announce: () => {},
    });
    // Four readings, so three waits — it stops on the one that passes rather than serving out the
    // ceiling it was given.
    assert.equal(waits, 3);
    assert.equal(samples.length, 0);
  });

  test("says it is waiting, once, rather than pausing in silence", async () => {
    const said: string[] = [];
    await assert.rejects(
      preflightMemory({
        sample: () => 0.2 * GB,
        totalBytes: 16 * GB,
        ceilingMs: 4000,
        announce: (m: string) => said.push(m),
        ...local,
      })
    );
    assert.equal(said.length, 1, "a wait announced per poll is a wait that reads as a loop");
    assert.match(said[0], /Waiting up to 4s/);
    assert.match(said[0], /0\.20 GB free/);
  });

  test("a box that never comes back is refused with what it read", async () => {
    await assert.rejects(
      preflightMemory({
        sample: () => 0.2 * GB,
        totalBytes: 16 * GB,
        ceilingMs: 3000,
        announce: () => {},
        ...local,
      }),
      // The same refusal it has always been, not a "waited too long" of its own.
      (err: Error) =>
        /Not enough free memory/.test(err.message) && /over 4 readings/.test(err.message)
    );
  });

  // Whether the box was climbing towards the floor or never moved is the difference between
  // waiting longer and going to find what is holding it.
  test("the refusal carries the best reading as well as the last", async () => {
    const samples = [0.2 * GB, 1.4 * GB, 0.3 * GB];
    await assert.rejects(
      preflightMemory({
        sample: () => samples.shift() ?? 0.3 * GB,
        totalBytes: 16 * GB,
        ceilingMs: 2000,
        announce: () => {},
        ...local,
      }),
      (err: Error) => /best 1\.40 GB/.test(err.message) && /last 0\.30 GB/.test(err.message)
    );
  });

  test("--no-wait's ceiling is one settle, which is what it always did", async () => {
    let waits = 0;
    const samples = [0.2 * GB, 0.3 * GB];
    await assert.rejects(
      preflightMemory({
        sample: () => samples.shift()!,
        totalBytes: 16 * GB,
        ceilingMs: 1000,
        wait: async () => {
          waits++;
        },
        env: {} as NodeJS.ProcessEnv,
        announce: () => {
          throw new Error("a single settle is not a wait worth announcing");
        },
      }),
      /0\.30 GB/
    );
    assert.equal(waits, 1);
  });

  // jest and Playwright call `globalSetup` with their own config object, so a command-line flag
  // reaches neither — and a person running one of those interactively is exactly who would rather
  // be refused now than waited for.
  test("the environment can shorten the wait where a flag cannot reach", async () => {
    let waits = 0;
    const samples = [0.2 * GB, 0.3 * GB];
    await assert.rejects(
      preflightMemory({
        sample: () => samples.shift()!,
        totalBytes: 16 * GB,
        wait: async () => {
          waits++;
        },
        env: { MURLAN_PREFLIGHT_WAIT_MS: "0" } as unknown as NodeJS.ProcessEnv,
        announce: () => {
          throw new Error("nothing was waited for, so nothing should be announced");
        },
      }),
      /0\.30 GB/
    );
    // Zero means "do not wait", not "do not look twice": the settle is what keeps a reading taken
    // inside another suite's teardown burst from being the one that decides.
    assert.equal(waits, 1);
  });

  test("the environment wins over the ceiling it was given", async () => {
    let waits = 0;
    await assert.rejects(
      preflightMemory({
        sample: () => 0.2 * GB,
        totalBytes: 16 * GB,
        ceilingMs: 60_000,
        wait: async () => {
          waits++;
        },
        env: { MURLAN_PREFLIGHT_WAIT_MS: "3000" } as unknown as NodeJS.ProcessEnv,
        announce: () => {},
      })
    );
    assert.equal(waits, 3);
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
