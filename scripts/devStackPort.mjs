/**
 * Which host port the dev Postgres container takes.
 *
 * The daemon's verdict is not enough on its own. On Docker Desktop for
 * Windows, `docker run -p 55432:5432` against a port a *non-Docker* process
 * already holds returns 0 and reports the mapping as live — measured, not
 * assumed — and the container is then reachable at that address by nobody.
 * Docker-against-Docker does fail cleanly, which is why a collision between
 * two containers looks like the whole story until it isn't.
 *
 * So a port is taken on any of three counts, and all three are needed:
 *
 *   1. this process cannot bind it — catches the holder Docker will not see;
 *   2. `docker run` says the address is in use — catches the other container,
 *      and races that opened between 1 and 2;
 *   3. Postgres does not answer on it from the host afterwards — the only
 *      check that speaks for the thing actually being asked for, and the one
 *      that catches a mapping the daemon reported and did not deliver.
 *
 * The base port still wins whenever it can, so the common case is the
 * documented one and a reader looking for the container finds it at 55432.
 */

/** Twenty containers on one machine is a leak, not a queue. */
export const PORT_SPAN = 20;

/**
 * Ports this repo has already spoken for, which the search must not wander
 * into. 55433 is `murlan-verify-pg`, the CI-substitute Postgres
 * (`docs/agents/loops.md`); taking it would leave the ticket pipeline unable
 * to start its own database, and its cleanup removes by container name, so it
 * would not even be able to clear what was in the way.
 */
export const RESERVED_PORTS = [55433];

/**
 * Whether a failed `docker run` failed for want of the port.
 *
 * Four wordings. The first two are the daemon's, which changed between
 * versions and both remain in the wild. The last two are Windows reporting an
 * OS-level bind refusal through it — the second of those is a port inside an
 * excluded or reserved dynamic range, which is common enough on a Windows
 * developer machine to be the usual case rather than an exotic one.
 *
 * Anything else — no such image, no daemon, no pull access — is the caller's
 * problem and must not be retried: walking twenty ports would turn one clear
 * error into twenty confusing ones.
 */
export function isAddressInUse(stderr) {
  return /address already in use|port is already allocated|only one usage of each socket address|forbidden by its access permissions/i.test(
    stderr ?? ""
  );
}

/** The ports the search may try, in order, skipping what the repo reserves. */
export function candidatePorts(start, span = PORT_SPAN, reserved = RESERVED_PORTS) {
  const out = [];
  for (let port = start; out.length < span && port < start + span * 2; port++) {
    if (!reserved.includes(port)) out.push(port);
  }
  return out;
}

/**
 * Start the container on `start`, or on the first port after it that is
 * actually usable.
 *
 * `explicit` marks a port that was asked for by name rather than defaulted.
 * Asking for one and silently getting another is worse than failing — whoever
 * set the variable had a reason, and a second Postgres on an unexpected port
 * is how two suites end up talking to different databases.
 *
 * `canBind(port)` reports whether this process can take the port itself.
 * `run(port)` performs the attempt and reports `{ status, stderr }`.
 * `verify(port)` reports whether Postgres answers there, from the host.
 * `discard()` removes a container that started and then failed to be reachable.
 */
export function startOnFreePort({
  start,
  run,
  verify,
  canBind = (_port) => true,
  discard = () => {},
  explicit = false,
  span = PORT_SPAN,
  reserved = RESERVED_PORTS,
}) {
  const ports = explicit ? [start] : candidatePorts(start, span, reserved);
  for (const port of ports) {
    if (!canBind(port)) continue;
    const r = run(port);
    if (r.status !== 0) {
      if (!isAddressInUse(r.stderr)) {
        throw new Error(r.stderr || `docker run failed on port ${port}`);
      }
      continue;
    }
    if (verify(port)) return port;
    // Reported as mapped and is not: the container is ours and useless, and
    // leaving it behind would block the name on the next attempt.
    discard();
  }
  if (explicit) {
    throw new Error(
      `MURLAN_DEV_PG_PORT asked for ${start} and it is not usable — something else is on it. ` +
        `Free it, or unset MURLAN_DEV_PG_PORT to let the container pick its own port.`
    );
  }
  throw new Error(
    `no usable port for the dev Postgres in ${start}..${ports[ports.length - 1] ?? start}`
  );
}

/**
 * The host port a running container is actually published on, from the output
 * of `docker port <name> 5432`.
 *
 * Asked rather than remembered. `up` and `env` are separate processes, so a
 * port carried from one to the other through a file or a variable can describe
 * a container that has since been replaced; the daemon cannot be out of date
 * about where its own container is. Docker prints one line per address family
 * and they are the same port, so the first line settles it.
 */
export function hostPortOf(stdout) {
  const line = (stdout ?? "").split("\n").find((l) => l.trim().length > 0);
  if (!line) return null;
  const port = Number(line.trim().split(":").pop());
  return Number.isFinite(port) ? port : null;
}

/**
 * The bytes a client sends to ask a Postgres server whether it speaks TLS:
 * an 8-byte packet carrying its own length and the magic 80877103.
 *
 * This is the cheapest thing that tells Postgres apart from anything else
 * holding the port. A plain TCP connect proves only that *something* accepted,
 * which is exactly the case being guarded against — the squatter accepts too.
 */
export function sslRequestPacket() {
  const buf = Buffer.alloc(8);
  buf.writeInt32BE(8, 0);
  buf.writeInt32BE(80877103, 4);
  return buf;
}

/** Postgres answers the above with a single byte, `S` or `N`, and nothing else does. */
export function isPostgresReply(chunk) {
  return chunk?.length === 1 && (chunk[0] === 0x53 || chunk[0] === 0x4e);
}
