// Modelled process tables for `scripts/lib/proc.mjs`'s seam: this suite runs on Linux, and neither a
// Windows tree nor a fork racing a kill can be produced on demand.
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { procFor } from "../../scripts/lib/proc.mjs";

type Row = { ppid: number; started: string; alive: boolean; stopped: boolean; ignoresTerm: boolean; forks: number; child?: FakeChild };

export class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  pid: number;
  private signal: (pid: number, sig: string | number) => void;
  constructor(pid: number, signal: (pid: number, sig: string | number) => void) {
    super();
    this.pid = pid;
    this.signal = signal;
  }
  kill(sig: string = "SIGTERM") {
    try {
      this.signal(this.pid, sig);
      return true;
    } catch {
      return false;
    }
  }
}

const esrch = () => Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });

function table(init: number) {
  const rows = new Map<number, Row>();
  let next = 1000;
  let clock = 0;
  const add = (ppid: number, extra: Partial<Row> = {}) => {
    const pid = next++;
    rows.set(pid, { ppid, started: `t${clock++}`, alive: true, stopped: false, ignoresTerm: false, forks: 0, ...extra });
    return pid;
  };
  const die = (pid: number, reparentTo: number | null) => {
    const row = rows.get(pid);
    if (!row?.alive) return;
    row.alive = false;
    if (reparentTo !== null) for (const r of rows.values()) if (r.alive && r.ppid === pid) r.ppid = reparentTo;
    const child = row.child;
    if (child) {
      child.exitCode = 1;
      child.emit("exit", null, "SIGKILL");
      child.stdout.end();
      child.stderr.end();
      setImmediate(() => child.emit("close", null, "SIGKILL"));
    }
  };
  const below = (pid: number) => {
    const out = [pid];
    for (const cur of out) for (const [p, r] of rows) if (r.alive && r.ppid === cur) out.push(p);
    return out;
  };
  const alive = () => [...rows].filter(([, r]) => r.alive).map(([p]) => p).filter((p) => p !== init);
  return { rows, add, die, below, alive };
}

/**
 * Windows: no re-parenting, so `taskkill /T` reaches nothing below a parent that already exited; a
 * `.cmd` will not start without a shell; a console process refuses a close without `/F`; and every
 * other kill is TerminateProcess of one pid.
 */
export function windowsWorld({ depth = 3 } = {}) {
  const t = table(0);
  const calls: { file: string; args: string[]; opts: Record<string, any> }[] = [];
  const isCmd = (file: string) => /^(npm|npx)$|\.cmd$/i.test(file);
  const einval = () => Object.assign(new Error("spawn EINVAL"), { code: "EINVAL" });

  const kill = (pid: number, sig: string | number) => {
    if (!t.rows.get(pid)?.alive) throw esrch();
    if (sig !== 0) t.die(pid, null);
  };

  const spawn = (file: string, args: string[], opts: Record<string, any> = {}) => {
    calls.push({ file, args, opts });
    if (isCmd(file) && !opts.shell) throw einval();
    const root = t.add(0);
    const child = new FakeChild(root, kill);
    t.rows.get(root)!.child = child;
    let above = root;
    for (let i = 0; i < depth; i++) above = t.add(above);
    return child;
  };

  const execFileSync = (file: string, args: string[], opts: Record<string, any> = {}) => {
    calls.push({ file, args, opts });
    if (isCmd(file) && !opts.shell) throw einval();
    if (!/^taskkill(\.exe)?$/i.test(file)) throw new Error(`unexpected ${file}`);
    const pid = Number(args[args.indexOf("/PID") + 1]);
    if (!t.rows.get(pid)?.alive) throw Object.assign(new Error("not found"), { status: 128, stderr: "not found" });
    if (!args.includes("/F")) throw Object.assign(new Error("refused"), { status: 1, stderr: "can only be terminated forcefully" });
    for (const p of args.includes("/T") ? t.below(pid) : [pid]) t.die(p, null);
    return "";
  };

  return {
    proc: procFor({ platform: "win32", spawn, execFileSync, kill } as never),
    alive: t.alive,
    end: (pid: number) => t.die(pid, null),
    below: t.below,
    calls,
    spawn,
  };
}

/**
 * POSIX: an exited parent's children go to init, a stopped process forks no more, and `ps` is the
 * only view of the tree. `forks` makes each running tree member fork on every read of the table.
 */
export function posixWorld({ depth = 2, forks = 0, ignoresTerm = false } = {}) {
  const INIT = 1;
  const t = table(INIT);
  t.rows.set(INIT, { ppid: 0, started: "t-init", alive: true, stopped: false, ignoresTerm: true, forks: 0 });
  const self = t.add(INIT);
  const signals: [number, string | number][] = [];
  let psFails = false;
  const afterRead: (() => void)[] = [];

  const kill = (pid: number, sig: string | number) => {
    const row = t.rows.get(pid);
    if (!row?.alive) throw esrch();
    signals.push([pid, sig]);
    if (sig === "SIGSTOP") row.stopped = true;
    else if (sig === "SIGCONT") row.stopped = false;
    else if (sig === "SIGKILL" || (sig === "SIGTERM" && !row.ignoresTerm)) t.die(pid, INIT);
  };

  const spawn = (_file: string, _args: string[]) => {
    const root = t.add(self, { ignoresTerm, forks });
    const child = new FakeChild(root, kill);
    t.rows.get(root)!.child = child;
    let above = root;
    for (let i = 0; i < depth; i++) above = t.add(above, { ignoresTerm, forks });
    return child;
  };

  const execFileSync = (file: string) => {
    if (file !== "ps") throw new Error(`unexpected ${file}`);
    if (psFails) throw new Error("ps: command not found");
    const listing = [...t.rows].filter(([, r]) => r.alive).map(([p, r]) => `${p} ${r.ppid} ${r.started}`).join("\n");
    // After the listing, as in life: what a read shows is already behind what runs.
    for (const [pid, row] of [...t.rows]) {
      if (row.alive && !row.stopped && row.forks > 0) {
        row.forks--;
        t.add(pid, { ignoresTerm: row.ignoresTerm });
      }
    }
    afterRead.shift()?.();
    return listing;
  };

  return {
    proc: procFor({ platform: "linux", spawn, execFileSync, kill, selfPid: self } as never),
    alive: () => t.alive().filter((p) => p !== self),
    below: t.below,
    signals,
    self,
    end: (pid: number) => t.die(pid, INIT),
    /** The pid dies and a stranger, started later, takes its number. */
    reuse(pid: number) {
      t.die(pid, INIT);
      t.rows.set(pid, { ppid: INIT, started: "t-stranger", alive: true, stopped: false, ignoresTerm: true, forks: 0 });
    },
    stopped: () => [...t.rows].filter(([, r]) => r.alive && r.stopped).map(([p]) => p),
    failPs: () => (psFails = true),
    /** Each step runs right after one read of the table, in order. */
    afterRead: (...steps: (() => void)[]) => afterRead.push(...steps),
  };
}

/**
 * POSIX over hand-made children: each signal goes to the child's own `kill`, so a test sees exactly
 * what was sent, and a child is gone once it emits `exit` or `close`.
 */
export function adoptingWorld() {
  const SELF = 50;
  const children = new Map<number, EventEmitter & { kill: (sig: string) => unknown }>();
  const dead = new Set<number>();
  let next = 2000;
  const adopt = <C extends EventEmitter & { kill: (sig: string) => unknown }>(child: C): C => {
    const pid = next++;
    Object.assign(child, { pid });
    children.set(pid, child);
    child.on("exit", () => dead.add(pid));
    child.on("close", () => dead.add(pid));
    return child;
  };
  const execFileSync = () =>
    [`${SELF} 1 t-self`, ...[...children.keys()].filter((p) => !dead.has(p)).map((p) => `${p} ${SELF} t${p}`)].join("\n");
  const kill = (pid: number, sig: string | number) => {
    const child = children.get(pid);
    if (!child || dead.has(pid)) throw esrch();
    if (sig !== 0) child.kill(String(sig));
  };
  return { proc: procFor({ platform: "linux", execFileSync, kill, selfPid: SELF } as never), adopt };
}
