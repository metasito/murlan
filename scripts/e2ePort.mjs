/**
 * Which port an e2e run takes.
 *
 * Playwright refuses a busy port before it ever runs the `webServer` command, so the port has
 * to be free by the time the run starts. `npm run test:e2e` used to guarantee that by killing
 * whoever held it — which is exactly how two concurrent runs took each other's server (#491).
 * A run that picks a port already free has nothing to kill.
 *
 * The base port still wins whenever it can, so the common case is the documented one and a
 * reader looking for a run's server finds it at 5199. It only moves for a live neighbour.
 */
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearPort, portListeners, staleAmong } from "./reap.mjs";

export const BASE_PORT = 5199;
/** Enough for every run a machine can host at once; a wall this wide is a leak, not a queue. */
export const PORT_SPAN = 20;

/**
 * The first port from `base` that this run may take, and the pids to kill to take it.
 *
 * A port is unavailable on either of two counts, and both are needed. `listeners(port)` gives
 * the pids bound to it. `claimedBy(port)` gives a live run that has *chosen* it and not bound it
 * yet — a server takes the better part of a minute to build and boot, so a listener check alone
 * hands the same port to every run that starts inside that window.
 *
 * `staleAmong(pids)` names holders whose parent is gone. A port held only by those is a crashed
 * run's leftovers and is cleared, so a crash does not poison the base port for as long as the
 * machine stays awake. A port with any live holder belongs to somebody and is stepped past.
 */
export function chooseE2ePort(base, { listeners, staleAmong, claimedBy, claim }) {
  for (let port = base; port < base + PORT_SPAN; port++) {
    if (claimedBy(port) !== null) continue;
    const held = listeners(port);
    const stale = held.length ? staleAmong(held) : [];
    // Half a port's holders killed frees nothing and breaks whoever owned the other half.
    if (held.length && stale.length !== held.length) continue;
    claim(port);
    return { port, clear: stale };
  }
  throw new Error(
    `no free e2e port in ${base}..${base + PORT_SPAN - 1} — run \`npm run reap\` to clear what crashed`
  );
}

/**
 * A run's claim on a port, as a file in the machine's temp directory naming the process that
 * made it. The temp directory rather than the repo: two worktrees are two checkouts of the same
 * machine, and it is the machine's ports they compete for.
 *
 * The claim dies with the process that made it — nothing has to clean it up, and a run killed
 * mid-flight does not poison a port. Once the server binds, the listener check takes over.
 */
const claimFile = (port) => path.join(os.tmpdir(), `murlan-e2e-port-${port}`);

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The live process claiming `port`, or null — including when there is no claim file at all. */
export function claimedBy(port, self) {
  let pid;
  try {
    pid = Number(readFileSync(claimFile(port), "utf8").trim());
  } catch {
    return null;
  }
  return Number.isFinite(pid) && pid !== self && alive(pid) ? pid : null;
}

/**
 * `chooseE2ePort` against this machine, with the claiming and clearing actually done.
 *
 * `owner` is the process the claim is filed under, and it has to outlive the run — not this
 * one. Playwright loads its config as CommonJS and so cannot import this module; it runs it
 * instead, and the picker it spawns exits immediately, which would expire the claim the moment
 * it was made. The CLI below therefore claims for its parent.
 */
export function takeE2ePort(base = Number(process.env.E2E_PORT ?? BASE_PORT), owner = process.pid) {
  const chosen = chooseE2ePort(base, {
    listeners: portListeners,
    staleAmong,
    claimedBy: (port) => claimedBy(port, owner),
    claim: (port) => writeFileSync(claimFile(port), String(owner)),
  });
  if (chosen.clear.length) clearPort(chosen.port);
  return chosen.port;
}

if (import.meta.filename === process.argv[1]) console.log(takeE2ePort(undefined, process.ppid));
