/**
 * PreToolUse cap on how many source lines one call puts into the main loop session. #1102's
 * builder dumped ~190k characters of source in 80 calls and ran out of context at 30 minutes;
 * a subagent reads for it instead. Subagents are exempt: reading is their job.
 *
 * Exit 0 always. stdout carries the deny, or nothing.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { commands, withoutQuotedBodies } from "./guard-bash.mjs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

export const READ_CAP = 150;
const BINARY = /\.(png|jpe?g|gif|webp|pdf|ipynb)$/i;
const WHOLE = new Set(["cat", "type", "get-content", "gc", "nl", "bat", "less", "more"]);
const BYTES_PER_LINE = 40;

const realCount = (p) => {
  if (BINARY.test(p) || !existsSync(p) || !statSync(p).isFile()) return null;
  const text = readFileSync(p, "utf8");
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
};

/** Git Bash spells `C:\x` as `/c/x` and its temp dir as `/tmp`; Node would read both as paths on the current drive. */
export const native = (p) =>
  process.platform === "win32"
    ? p.replace(/^\/tmp(?=\/|$)/, tmpdir().replace(/\\/g, "/")).replace(/^\/([a-z])(?=\/|$)/i, "$1:")
    : p;
const MOVES = /^(cd|chdir|pushd|set-location|sl|push-location)$/;
const NARROWS = new Set(["grep", "rg", "wc", "sort", "uniq", "cut", "jq", "select-string", "sls", "findstr", "measure-object"]);

function flagValue(args, names, lineShorthand = true) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const eq = names.find((n) => a.toLowerCase().startsWith(`${n}=`));
    if (eq) return Number(a.slice(eq.length + 1));
    if (names.includes(a.toLowerCase()) && /^\d+$/.test(args[i + 1] ?? "")) return Number(args[i + 1]);
    if (lineShorthand && /^-n\d+$/.test(a)) return Number(a.slice(2));
    if (lineShorthand && /^-\d+$/.test(a)) return Number(a.slice(1));
  }
  return null;
}

function fileArgs(args) {
  return args.filter((a) => !a.startsWith("-") && !/^\d+$/.test(a) && !/^[<>]/.test(a));
}

function sedLines(args) {
  return args.flatMap((a) => a.split(";")).reduce((sum, a) => {
    const m = /^(\d+)(?:,(\d+))?p$/.exec(a.trim());
    return m ? sum + (m[2] ? Number(m[2]) - Number(m[1]) + 1 : 1) : sum;
  }, 0);
}

function headLines(args) {
  const bytes = flagValue(args, ["-c", "--bytes"], false);
  return bytes === null ? (flagValue(args, ["-n", "--lines"]) ?? 10) : Math.ceil(bytes / BYTES_PER_LINE);
}

/** The most lines a pipeline's last stage lets through, or null when it bounds nothing. */
function bound(c) {
  const name = c.cmd.toLowerCase();
  if (name === "head" || name === "tail") return headLines(c.args);
  if (name === "sed" && c.args.includes("-n")) return sedLines(c.args) || null;
  if (name === "select-object") return flagValue(c.args, ["-first", "-last"]);
  return null;
}

function fromCommand(c, cwd, count) {
  const name = c.cmd.toLowerCase();
  const at = (f) => count(resolve(cwd, native(f))) ?? 0;
  if (name === "sed" && c.args.includes("-n")) return sedLines(c.args);
  if (name === "head" || name === "tail") {
    const files = fileArgs(c.args);
    return files.length ? headLines(c.args) * files.length : 0;
  }
  if (WHOLE.has(name)) {
    const limit = flagValue(c.args, ["-totalcount", "-head", "-tail", "-first", "-last"]);
    const files = fileArgs(c.args.filter((a, i) => !/^-(totalcount|head|tail|first|last)$/i.test(c.args[i - 1] ?? "")));
    return files.reduce((sum, f) => sum + (limit ?? at(f)), 0);
  }
  if (name === "git" && c.args[0] === "show") {
    return c.args.slice(1).reduce((sum, a) => {
      const m = /^[^-][^:]*:(.+)$/.exec(a);
      return m ? sum + (count(resolve(cwd, native(c.dir ?? "."), native(m[1]))) ?? 0) : sum;
    }, 0);
  }
  return 0;
}

function pipeline(stages, cwd, count) {
  const first = fromCommand(stages[0], cwd, count);
  if (stages.length === 1) return first;
  if (stages.slice(1).some((s) => NARROWS.has(s.cmd.toLowerCase()))) return 0;
  const most = bound(stages.at(-1));
  if (most === null) return first;
  return first ? Math.min(first, most) : most;
}

export function linesRequested(payload, count = realCount) {
  const input = payload?.tool_input ?? {};
  const cwd = payload?.cwd ?? process.cwd();
  if (payload?.tool_name === "Read") {
    const total = count(resolve(cwd, String(input.file_path ?? ""))) ?? 0;
    const left = Math.max(0, total - Math.max(0, (input.offset ?? 1) - 1));
    return Math.min(left, input.limit ?? left);
  }
  if (payload?.tool_name !== "Bash" && payload?.tool_name !== "PowerShell") return 0;
  let at = cwd;
  let total = 0;
  let stages = [];
  for (const c of commands(withoutQuotedBodies(String(input.command ?? "")))) {
    if (MOVES.test(c.cmd.toLowerCase())) {
      const to = c.args.find((a) => !a.startsWith("-"));
      if (to) at = resolve(at, native(to));
      continue;
    }
    stages.push(c);
    if (c.piped) continue;
    total += pipeline(stages, at, count);
    stages = [];
  }
  return total + (stages.length ? pipeline(stages, at, count) : 0);
}

export function verdict(payload, count = realCount) {
  const n = linesRequested(payload, count);
  return n > READ_CAP
    ? `This call would put ${n} lines into the loop session; the cap is ${READ_CAP} per call. Read the range ` +
        `you will edit (Read with offset/limit, sed -n A,Bp, or a pipe ending in | head -n ${READ_CAP}), find it first with ` +
        "`grep -n`, or give a question spanning files to one sonnet subagent that answers in a few lines " +
        '(queue.md, phase C: "Read ranges, not files").'
    : null;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  try {
    const payload = JSON.parse(readFileSync(0, "utf8") || "{}");
    const reason = process.env.LOOP_TURNS && payload && !payload.agent_id ? verdict(payload) : null;
    if (reason) {
      process.stdout.write(
        JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } })
      );
    }
  } catch {
    process.exit(0);
  }
}
