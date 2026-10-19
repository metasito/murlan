// A modelled win32 process table for `scripts/lib/proc.mjs`'s seam: this suite runs on Linux.
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { procFor } from "../../scripts/lib/proc.mjs";

/** A win32 process table: spawning starts cmd.exe → npm → node → a worker; taskkill /T is the only tree-kill. */
export function windowsWorld() {
  const parent = new Map<number, number>();
  const children = new Map<number, FakeChild>();
  const calls: { file: string; args: string[]; opts: Record<string, unknown> }[] = [];
  let next = 1000;

  class FakeChild extends EventEmitter {
    pid = next++;
    stdout = new PassThrough();
    stderr = new PassThrough();
    kill() {
      end(this.pid);
      return true;
    }
  }

  function end(pid: number) {
    parent.delete(pid);
    const child = children.get(pid);
    if (!child) return;
    children.delete(pid);
    child.emit("exit", 1);
    child.stdout.end();
    child.stderr.end();
    setImmediate(() => child.emit("close", 1));
  }

  const spawn = (file: string, args: string[], opts: Record<string, unknown>) => {
    calls.push({ file, args, opts });
    const child = new FakeChild();
    children.set(child.pid, child);
    parent.set(child.pid, 0);
    let above = child.pid;
    for (let i = 0; i < 3; i++) {
      const pid = next++;
      parent.set(pid, above);
      above = pid;
    }
    return child;
  };

  const execFileSync = (file: string, args: string[], opts: Record<string, unknown> = {}) => {
    calls.push({ file, args, opts });
    if (/^taskkill(\.exe)?$/i.test(file) && args.includes("/T") && args.includes("/F")) {
      const root = Number(args[args.indexOf("/PID") + 1]);
      if (!parent.has(root)) throw new Error("not found");
      const doomed = [root];
      for (const cur of doomed) for (const [p, pp] of parent) if (pp === cur) doomed.push(p);
      doomed.forEach(end);
      return "";
    }
    throw new Error(`unexpected ${file}`);
  };

  const kill = (pid: number) => {
    if (!parent.has(pid)) throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
    end(pid);
  };

  return { proc: procFor({ platform: "win32", spawn, execFileSync, kill } as never), alive: () => [...parent.keys()], calls };
}

