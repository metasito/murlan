// A run's deadline for each file whose exit has begun, ticked by tests/helpers/runWatch.mjs: the
// exit's teardown stops the file's own deadline worker, so only something outside it can end it.
import { readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

/** How often runWatch.mjs ticks the guard. */
export const EXIT_TICK_MS = 250;

/** Polls of a marker that will not parse before it is dropped. */
const PARSE_TRIES = 3;

/** At most one "unavailable" notice this often, so a guard that recovers is heard from again. */
const NOTICE_EVERY_MS = 60_000;

/**
 * Markers are `<pid>` files holding `{ file, identity, at }`, written by tests/helpers/fileDeadline.mjs:
 * `identity` is proc.mjs's `identityOf` for that process, `at` is when its exit began. One written
 * before `since` is a previous run's.
 *
 * It ends a file only when its identity is exact and still matches; past the grace without one, it
 * names the file and ends nothing.
 * @param {{
 *   markers: string,
 *   graceMs: number,
 *   since: number,
 *   platform: string,
 *   proc: { identityOf(pid: number): string | undefined | null, endTreeIf(pid: number, identity: string): boolean, alive(pid: number): boolean },
 *   write: (line: string) => void,
 *   now?: () => number,
 * }} opts
 * @returns {() => void} one tick, which never throws
 */
export function exitGuard({ markers, graceMs, since, platform, proc, write, now = Date.now }) {
  const exiting = new Map();
  const unreadable = new Map();
  let noticedAt = -Infinity;
  const unavailable = (err) => {
    if (now() - noticedAt < NOTICE_EVERY_MS) return;
    noticedAt = now();
    write(`exit guard unavailable: ${err.message}`);
  };

  function collect() {
    let names;
    try {
      names = readdirSync(markers);
    } catch {
      return;
    }
    for (const name of names.filter((n) => /^\d+$/.test(n))) {
      const marker = path.join(markers, name);
      let seen;
      try {
        seen = JSON.parse(readFileSync(marker, "utf8"));
      } catch (err) {
        const tries = (unreadable.get(name) ?? 0) + 1;
        unreadable.set(name, tries);
        if (tries < PARSE_TRIES) continue;
        unreadable.delete(name);
        rmSync(marker, { force: true });
        write(`exit guard dropped the unreadable marker of pid ${name}: ${err.message}`);
        continue;
      }
      rmSync(marker, { force: true });
      if (!(seen.at < since)) exiting.set(Number(name), seen);
    }
  }

  function check(pid, { file, identity, at }) {
    const readable = Number.isFinite(at) && typeof identity === "string" && /^\d+$/.test(identity);
    const exact = readable ? proc.identityOf(pid) : null;
    if (exact === undefined || (exact !== null && exact !== identity)) return exiting.delete(pid);
    if (now() - at <= graceMs) return;
    if (exact === null) {
      exiting.delete(pid);
      if (proc.alive(pid)) write(`${file}: still alive ${graceMs / 1000}s after its tests finished; not killed, identity unverifiable on ${platform}`);
      return;
    }
    if (proc.endTreeIf(pid, identity)) {
      exiting.delete(pid);
      write(`${file}: hung after its tests finished, killed ${graceMs / 1000}s into its exit by tests/helpers/runWatch.mjs`);
    }
  }

  return function tick() {
    try {
      collect();
    } catch (err) {
      unavailable(err);
    }
    for (const [pid, entry] of exiting) {
      try {
        check(pid, entry);
      } catch (err) {
        unavailable(err);
      }
    }
  };
}
