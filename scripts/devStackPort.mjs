/**
 * Which host port the dev Postgres container takes.
 *
 * The port is not probed before it is used. A probe answers a different
 * question — whether *this* process could bind it a moment ago — and the
 * binding is done by the Docker daemon, for which a free-looking port can
 * still fail and a busy-looking one can still work. So the attempt is the
 * test: `docker run` is asked, and its own complaint is what moves the search
 * on. Nothing can slip in between the check and the claim, because there is no
 * check.
 *
 * The base port still wins whenever it can, so the common case is the
 * documented one and a reader looking for the container finds it at 55432.
 */

/** Twenty containers on one machine is a leak, not a queue. */
export const PORT_SPAN = 20;

/**
 * Whether a failed `docker run` failed for want of the port.
 *
 * Two wordings, because the daemon changed its mind about this message and
 * older engines are still in the wild. Anything else — no such image, no
 * daemon, no pull access — is the caller's problem and must not be retried:
 * walking twenty ports turns one clear error into twenty confusing ones.
 */
export function isAddressInUse(stderr) {
  return /address already in use|port is already allocated/i.test(stderr ?? "");
}

/**
 * Start the container on `start`, or on the first port after it that the
 * daemon will accept.
 *
 * `explicit` marks a port that was asked for by name rather than defaulted.
 * Asking for one and silently getting another is worse than failing — whoever
 * set the variable had a reason, and a second Postgres on an unexpected port
 * is how two suites end up talking to different databases.
 *
 * `run(port)` performs the attempt and reports `{ status, stderr }`.
 */
export function startOnFreePort({ start, run, explicit = false, span = PORT_SPAN }) {
  const last = explicit ? start : start + span - 1;
  for (let port = start; port <= last; port++) {
    const r = run(port);
    if (r.status === 0) return port;
    if (!isAddressInUse(r.stderr)) throw new Error(r.stderr || `docker run failed on port ${port}`);
  }
  if (explicit) {
    throw new Error(
      `MURLAN_DEV_PG_PORT asked for ${start} and it is already in use. ` +
        `Free it, or unset MURLAN_DEV_PG_PORT to let the container pick its own port.`
    );
  }
  throw new Error(`no free port for the dev Postgres in ${start}..${last}`);
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
