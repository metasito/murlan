// tests/devStackPort.test.ts — `dev-stack up` steps past a port somebody else holds.
//
// A CI shard died in 47 seconds because an unrelated Postgres already had
// 55432 and `docker run` treats that as fatal (#580). Re-running the same job
// passed, which is what makes this class expensive: it reads as a broken
// branch and costs a re-run to disprove.
//
// The port search is tested without Docker on purpose. What it needs from
// Docker is one bit — did this attempt fail because the port was taken — so
// the runner is injected and the daemon's own message is the fixture.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PORT_SPAN,
  hostPortOf,
  isAddressInUse,
  startOnFreePort,
} from "../scripts/devStackPort.mjs";

/** The daemon's verdict, verbatim from the failing job in #580. */
const IN_USE_STDERR =
  "docker: Error response from daemon: failed to set up container networking: " +
  "driver failed programming external connectivity on endpoint murlan-dev-pg: " +
  "failed to bind host port for 0.0.0.0:55432:172.17.0.2:5432/tcp: address already in use";

/** Docker before it reworded that, still in the wild on older engines. */
const ALLOCATED_STDERR =
  "docker: Error response from daemon: driver failed programming external " +
  "connectivity on endpoint murlan-dev-pg: Bind for 0.0.0.0:55432 failed: port is already allocated";

test("the daemon's port complaints are recognised, and other failures are not", () => {
  assert.equal(isAddressInUse(IN_USE_STDERR), true);
  assert.equal(isAddressInUse(ALLOCATED_STDERR), true);
  assert.equal(isAddressInUse(""), false);
  // A pull failure and a bad image are not the port's fault, and retrying the
  // next twenty ports would turn one clear error into twenty confusing ones.
  assert.equal(
    isAddressInUse("docker: Error response from daemon: pull access denied for postgres"),
    false
  );
  assert.equal(isAddressInUse("Cannot connect to the Docker daemon. Is the docker daemon running?"), false);
});

test("a taken port is stepped past rather than fatal", () => {
  const tried: number[] = [];
  const port = startOnFreePort({
    start: 55432,
    run: (p: number) => {
      tried.push(p);
      return p < 55434 ? { status: 1, stderr: IN_USE_STDERR } : { status: 0, stderr: "" };
    },
  });
  assert.equal(port, 55434);
  assert.deepEqual(tried, [55432, 55433, 55434]);
});

test("the base port still wins when it is free, so the documented one is the usual one", () => {
  const tried: number[] = [];
  const port = startOnFreePort({
    start: 55432,
    run: (p: number) => {
      tried.push(p);
      return { status: 0, stderr: "" };
    },
  });
  assert.equal(port, 55432);
  assert.deepEqual(tried, [55432]);
});

test("an explicitly requested port that is taken fails, and says so", () => {
  let calls = 0;
  assert.throws(
    () =>
      startOnFreePort({
        start: 55432,
        explicit: true,
        run: () => {
          calls++;
          return { status: 1, stderr: IN_USE_STDERR };
        },
      }),
    (e: Error) => {
      // Asking for a port and silently getting a different one is worse than
      // failing: whoever set the variable had a reason.
      assert.match(e.message, /55432/);
      assert.match(e.message, /MURLAN_DEV_PG_PORT/);
      return true;
    }
  );
  assert.equal(calls, 1, "an explicit port is tried once and not walked past");
});

test("a failure that is not about the port is reported as itself, at once", () => {
  let calls = 0;
  assert.throws(
    () =>
      startOnFreePort({
        start: 55432,
        run: () => {
          calls++;
          return { status: 1, stderr: "docker: no such image: postgres:16-alpine" };
        },
      }),
    /no such image/
  );
  assert.equal(calls, 1);
});

test("the search gives up rather than walking forever", () => {
  const tried: number[] = [];
  assert.throws(
    () =>
      startOnFreePort({
        start: 55432,
        run: (p: number) => {
          tried.push(p);
          return { status: 1, stderr: IN_USE_STDERR };
        },
      }),
    /55432/
  );
  assert.equal(tried.length, PORT_SPAN);
});

test("where the container actually is, read back from docker", () => {
  // `docker port` is asked rather than the chosen port remembered: `up` and
  // `env` are two processes, and a value carried between them can go stale
  // while the container it describes is still running.
  assert.equal(hostPortOf("0.0.0.0:55433\n"), 55433);
  assert.equal(hostPortOf("0.0.0.0:55433\n[::]:55433\n"), 55433);
  assert.equal(hostPortOf("127.0.0.1:55440"), 55440);
  assert.equal(hostPortOf(""), null);
  assert.equal(hostPortOf("\n"), null);
});
