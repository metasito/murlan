// A run's deadline for each file whose exit has begun, ticked by tests/helpers/runWatch.mjs: the
// exit's teardown stops the file's own deadline worker, so only something outside it can end it.
import { readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

/** Polls of a marker that will not parse before it is dropped. */
const PARSE_TRIES = 3;

/**
 * Markers are `<pid>` files holding `{ file, started, at }`, written by tests/helpers/fileDeadline.mjs:
 * `started` is no earlier than the process's own start, `at` is when its exit began. One written
 * before `since` is a previous run's.
 * @param {{
 *   markers: string,
 *   graceMs: number,
 *   since: number,
 *   proc: { processStarts(): Map<number, number>, endTreeIfSame(pid: number, startedBy: number): boolean },
 *   write: (line: string) => void,
 *   now?: () => number,
 * }} opts
 * @returns {() => void} one tick, which never throws
 */
export function exitGuard({ markers, graceMs, since, proc, write, now = Date.now }) {
  const exiting = new Map();
  const unreadable = new Map();
  let broken = false;
  const fail = (err) => {
    if (broken) return;
    broken = true;
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
      if (seen.at >= since) exiting.set(Number(name), seen);
    }
  }

  return function tick() {
    try {
      collect();
      if (exiting.size === 0) return;
      const starts = proc.processStarts();
      for (const [pid, { file, started, at }] of exiting) {
        const start = starts.get(pid);
        if (start === undefined || start > started) exiting.delete(pid);
        else if (now() - at > graceMs) {
          exiting.delete(pid);
          if (proc.endTreeIfSame(pid, started)) {
            write(`${file}: hung after its tests finished, killed ${graceMs / 1000}s into its exit by tests/helpers/runWatch.mjs`);
          }
        }
      }
    } catch (err) {
      fail(err);
    }
  };
}
