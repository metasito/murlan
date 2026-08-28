/**
 * Which port an e2e run takes.
 *
 * Playwright refuses a busy port before it ever runs the `webServer` command, so the port has to
 * be free by the time a run starts. Freeing it by killing whoever holds it is what a run must
 * never do: on a machine running two of them, that is the other run's server.
 *
 * The base port still wins whenever it can, so the common case is the documented one and a
 * reader looking for a run's server finds it at 5199. It only moves for a live neighbour.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
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
    // Reading a claim and writing one are two steps, so two runs starting in the same instant
    // both get here. `claim` is an exclusive create and settles it: one wins, the other is
    // told now rather than when its server cannot bind.
    if (!claim(port)) continue;
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

/**
 * Longer than any run, and short enough that an operating system reusing a pid cannot make a
 * claim outlive the run that filed it. Without this, a recycled pid reads as a live claim and
 * skips that port for as long as the unrelated process happens to live.
 */
export const CLAIM_TTL_MS = 30 * 60_000;

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The live process claiming `port`, or null — including when there is no claim file at all. */
export function claimedBy(port, self, now = Date.now()) {
  let pid, at;
  try {
    [pid, at] = readFileSync(claimFile(port), "utf8").trim().split(/\s+/).map(Number);
  } catch {
    return null;
  }
  if (!Number.isFinite(pid) || pid === self) return null;
  if (!Number.isFinite(at) || now - at > CLAIM_TTL_MS) return null;
  return alive(pid) ? pid : null;
}

/**
 * Files the claim, or reports that somebody else got there first.
 *
 * `wx` is the whole mechanism: an exclusive create is one operation the filesystem serialises,
 * so of two runs picking the same port in the same instant exactly one succeeds. A claim that
 * is merely *present* is not a winner — a dead or expired one is replaced, which is also the
 * only cleanup these files need.
 */
export function claimPort(port, owner, now = Date.now()) {
  const file = claimFile(port);
  const write = (flag) => writeFileSync(file, `${owner} ${now}`, { flag });
  try {
    write("wx");
    return true;
  } catch {
    if (claimedBy(port, owner, now) !== null) return false;
  }
  try {
    rmSync(file, { force: true });
    write("wx");
    return true;
  } catch {
    return false; // Somebody claimed it between the remove and the create.
  }
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
    claim: (port) => claimPort(port, owner),
  });
  if (chosen.clear.length) clearPort(chosen.port);
  return chosen.port;
}

if (import.meta.filename === process.argv[1]) console.log(takeE2ePort(undefined, process.ppid));
