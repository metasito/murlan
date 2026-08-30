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
  RESERVED_PORTS,
  candidatePorts,
  hostPortOf,
  isAddressInUse,
  isPostgresReply,
  sslRequestPacket,
  startOnFreePort,
} from "../scripts/devStackPort.mjs";

/** Every attempt succeeds and Postgres answers — the uneventful case. */
const OK = { status: 0, stderr: "" };

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
    verify: () => true,
    reserved: [],
    run: (p: number) => {
      tried.push(p);
      return p < 55434 ? { status: 1, stderr: IN_USE_STDERR } : OK;
    },
  });
  assert.equal(port, 55434);
  assert.deepEqual(tried, [55432, 55433, 55434]);
});

test("the base port still wins when it is free, so the documented one is the usual one", () => {
  const tried: number[] = [];
  const port = startOnFreePort({
    start: 55432,
    verify: () => true,
    run: (p: number) => {
      tried.push(p);
      return OK;
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
        verify: () => true,
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
        verify: () => true,
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
        verify: () => true,
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

// The finding that invalidated the first design. On Docker Desktop for
// Windows, `docker run -p` against a port a non-Docker process holds returns
// 0 and reports the mapping as live, so the daemon's verdict alone lets the
// search settle on a port the container cannot be reached at. Measured on the
// owner's machine, not reasoned about.
test("a port the daemon accepts but Postgres cannot be reached on is walked past", () => {
  const tried: number[] = [];
  const discarded: number[] = [];
  const port = startOnFreePort({
    start: 55432,
    reserved: [],
    run: (p: number) => {
      tried.push(p);
      return OK;
    },
    // 55432 maps "successfully" onto a squatter; nothing answers as Postgres.
    verify: (p: number) => p !== 55432,
    discard: () => discarded.push(tried[tried.length - 1]),
  });
  assert.equal(port, 55433);
  assert.deepEqual(tried, [55432, 55433]);
  assert.deepEqual(discarded, [55432], "the useless container is removed, not left holding the name");
});

test("a port this process cannot bind is never offered to docker at all", () => {
  const tried: number[] = [];
  const port = startOnFreePort({
    start: 55432,
    reserved: [],
    canBind: (p: number) => p !== 55432,
    verify: () => true,
    run: (p: number) => {
      tried.push(p);
      return OK;
    },
  });
  assert.equal(port, 55433);
  assert.deepEqual(tried, [55433], "the bind probe is what catches the holder docker does not see");
});

test("Windows' own bind refusals count as the port being taken", () => {
  assert.equal(
    isAddressInUse(
      "docker: Error response from daemon: Ports are not available: exposing port TCP 0.0.0.0:55432 -> 0.0.0.0:0: " +
        "listen tcp 0.0.0.0:55432: bind: Only one usage of each socket address (protocol/network address/port) is normally permitted."
    ),
    true
  );
  assert.equal(
    isAddressInUse(
      "docker: Error response from daemon: Ports are not available: listen tcp 0.0.0.0:55432: " +
        "bind: An attempt was made to access a socket in a way forbidden by its access permissions."
    ),
    true
  );
});

test("the search does not wander into a port this repo has already spoken for", () => {
  // 55433 is murlan-verify-pg, the CI-substitute Postgres. Taking it would
  // leave the ticket pipeline unable to start its own database, and its
  // cleanup removes by container name, so it could not clear what was there.
  assert.ok(RESERVED_PORTS.includes(55433));
  assert.deepEqual(candidatePorts(55432, 3), [55432, 55434, 55435]);
  assert.equal(candidatePorts(55432).length, PORT_SPAN);
  assert.equal(candidatePorts(55432).includes(55433), false);
});

test("the SSLRequest probe is the packet Postgres answers, and only its reply counts", () => {
  const packet = sslRequestPacket();
  assert.equal(packet.length, 8);
  assert.equal(packet.readInt32BE(0), 8, "the packet carries its own length");
  assert.equal(packet.readInt32BE(4), 80877103, "the SSLRequest magic");

  // A squatter accepts a connection too, so acceptance proves nothing; these
  // two bytes are the whole difference between Postgres and anything else.
  assert.equal(isPostgresReply(Buffer.from([0x53])), true);
  assert.equal(isPostgresReply(Buffer.from([0x4e])), true);
  assert.equal(isPostgresReply(Buffer.from([0x48])), false);
  assert.equal(isPostgresReply(Buffer.from([0x53, 0x53])), false);
  assert.equal(isPostgresReply(Buffer.alloc(0)), false);
});
