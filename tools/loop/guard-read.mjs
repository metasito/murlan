/**
 * PreToolUse cap on how many source lines one call puts into the main loop session. #1102's
 * builder dumped ~190k characters of source in 80 calls and ran out of context at 30 minutes;
 * a subagent reads for it instead. Subagents are exempt: reading is their job.
 *
 * Exit 0 always. stdout carries the deny, or nothing.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { commands, withoutQuotedBodies } from "./guard-bash.mjs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

export const READ_CAP = 150;
const BINARY = /\.(png|jpe?g|gif|webp|pdf|ipynb)$/i;
const WHOLE = new Set(["cat", "type", "get-content", "gc", "nl", "bat", "less", "more"]);
const BYTES_PER_LINE = 40;

const realCount = (p) => {
  if (BINARY.test(p) || !existsSync(p)) return null;
  const text = readFileSync(p, "utf8");
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
};

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

function fromCommand(c, cwd, count) {
  const name = c.cmd.toLowerCase();
  const at = (f) => count(resolve(cwd, f)) ?? 0;
  if (name === "sed" && c.args.includes("-n")) {
    return c.args.reduce((sum, a) => {
      const m = /^(\d+)(?:,(\d+))?p$/.exec(a);
      return m ? sum + (m[2] ? Number(m[2]) - Number(m[1]) + 1 : 1) : sum;
    }, 0);
  }
  if (name === "head" || name === "tail") {
    const files = fileArgs(c.args);
    const bytes = flagValue(c.args, ["-c", "--bytes"], false);
    const lines = bytes === null ? (flagValue(c.args, ["-n", "--lines"]) ?? 10) : Math.ceil(bytes / BYTES_PER_LINE);
    return files.length ? lines * files.length : 0;
  }
  if (WHOLE.has(name)) {
    const limit = flagValue(c.args, ["-totalcount", "-head", "-tail", "-first", "-last"]);
    const files = fileArgs(c.args.filter((a, i) => !/^-(totalcount|head|tail|first|last)$/i.test(c.args[i - 1] ?? "")));
    return files.reduce((sum, f) => sum + (limit ?? at(f)), 0);
  }
  return 0;
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
  const raw = withoutQuotedBodies(String(input.command ?? ""));
  // ponytail: the parser drops separators, so "no pipe anywhere in the call" stands in for "this
  // reader is a pipeline's last stage": `sed -n 1,400p f | head` is not counted, and neither is
  // `sed -n 1,400p f | cat`. awk is never counted: its range is a program, not a flag.
  if (/\|/.test(raw)) return 0;
  return commands(raw).reduce((sum, c) => sum + fromCommand(c, cwd, count), 0);
}

export function verdict(payload, count = realCount) {
  const n = linesRequested(payload, count);
  return n > READ_CAP
    ? `This call would put ${n} lines into the loop session; the cap is ${READ_CAP} per call. Read the range ` +
        `you will edit (Read with offset/limit, or sed -n A,Bp under ${READ_CAP} lines), find it first with ` +
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
