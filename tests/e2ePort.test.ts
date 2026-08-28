// tests/e2ePort.test.ts — which port an e2e run takes, and whose it does not take.
//
// #489 stopped a routine sweep from taking a port someone is using. This is the other half:
// two runs at once. `npm run test:e2e` used to free the port unconditionally, because
// Playwright refuses a busy one before it ever runs the webServer command — so the run that
// started second took the first one's server, and a webServer pulled out from under Playwright
// reads as a connection error or a 0ms failure rather than as what it is.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { chooseE2ePort, PORT_SPAN } from "../scripts/e2ePort.mjs";

/** A machine where `held` maps a port to the pids listening on it. */
const machine = (
  held: Record<number, number[]>,
  stale: number[] = [],
  claimed: Record<number, number | null> = {}
) => ({
  listeners: (port: number) => held[port] ?? [],
  staleAmong: (pids: number[]) => pids.filter((pid) => stale.includes(pid)),
  claimedBy: (port: number) => claimed[port] ?? null,
  claim: () => {},
});

describe("choosing the port an e2e run will take", () => {
  test("takes the base port when nothing holds it", () => {
    const { port, clear } = chooseE2ePort(5199, machine({}));
    assert.equal(port, 5199);
    assert.deepEqual(clear, []);
  });

  test("steps past a port a live run holds, rather than taking it", () => {
    const { port, clear } = chooseE2ePort(5199, machine({ 5199: [4242] }));
    assert.equal(port, 5200);
    assert.deepEqual(clear, [], "the neighbour's server is not ours to kill");
  });

  test("steps past as many live neighbours as there are", () => {
    const busy = { 5199: [1], 5200: [2], 5201: [3] };
    assert.equal(chooseE2ePort(5199, machine(busy)).port, 5202);
  });

  // Without this a crashed run leaves 5199 poisoned, and every later run drifts one port
  // further up for as long as the machine stays awake.
  test("clears a holder whose parent is gone and keeps the base port", () => {
    const { port, clear } = chooseE2ePort(5199, machine({ 5199: [4242] }, [4242]));
    assert.equal(port, 5199);
    assert.deepEqual(clear, [4242]);
  });

  test("a port held by both a stale and a live process is somebody's, so it steps past", () => {
    const { port, clear } = chooseE2ePort(5199, machine({ 5199: [4242, 99] }, [4242]));
    assert.equal(port, 5200);
    assert.deepEqual(clear, [], "killing half a port's holders frees nothing and breaks a run");
  });

  test("gives up rather than scanning forever", () => {
    const wall: Record<number, number[]> = {};
    for (let p = 5199; p < 5199 + PORT_SPAN; p++) wall[p] = [1];
    assert.throws(() => chooseE2ePort(5199, machine(wall)), /5199/);
  });

  test("an explicit base is honoured, so a proof can still pin its own port", () => {
    assert.equal(chooseE2ePort(5233, machine({})).port, 5233);
  });

  // The half a listener check cannot see. A run's server takes the better part of a minute to
  // build and boot, so a second run starting inside that window finds the port unlistened and
  // takes it — and then both bind the same number, which is what watching two real runs do
  // showed: both picked 5200, and the loser died on EADDRINUSE. A port is reserved from the
  // moment it is chosen, not from the moment something binds it.
  test("steps past a port another run has claimed but not yet bound", () => {
    const { port } = chooseE2ePort(5199, machine({}, [], { 5199: 4242 }));
    assert.equal(port, 5200);
  });

  test("a claim by a process that is gone does not hold the port", () => {
    const { port } = chooseE2ePort(5199, machine({}, [], { 5199: null }));
    assert.equal(port, 5199);
  });

  test("claims the port it returns, so the next run sees it", () => {
    const claimed: number[] = [];
    const { port } = chooseE2ePort(5199, {
      ...machine({}),
      claim: (p: number) => claimed.push(p),
    });
    assert.deepEqual(claimed, [port]);
  });

  test("a listener and a claim are both disqualifying, in either order", () => {
    assert.equal(chooseE2ePort(5199, machine({ 5199: [1] }, [], { 5200: 2 })).port, 5201);
  });
});
