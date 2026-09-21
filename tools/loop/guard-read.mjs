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
const CAT = new Set(["cat", "type", "get-content", "gc"]);

const realCount = (p) => {
  if (BINARY.test(p) || !existsSync(p)) return null;
  const text = readFileSync(p, "utf8");
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
};

function flagValue(args, names) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const eq = names.find((n) => a.toLowerCase().startsWith(`${n}=`));
    if (eq) return Number(a.slice(eq.length + 1));
    if (names.includes(a.toLowerCase()) && /^\d+$/.test(args[i + 1] ?? "")) return Number(args[i + 1]);
    if (/^-n\d+$/.test(a)) return Number(a.slice(2));
    if (/^-\d+$/.test(a)) return Number(a.slice(1));
  }
  return null;
}

function fileArgs(args) {
  return args.filter((a) => !a.startsWith("-") && !/^\d+$/.test(a) && !/^[<>]/.test(a));
}

function fromCommand(c, raw, cwd, count) {
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
    return files.length ? (flagValue(c.args, ["-n", "--lines"]) ?? 10) * files.length : 0;
  }
  // ponytail: "no pipe anywhere in the call" stands in for "this cat is a pipeline's last stage";
  // the parser drops the separators. A `cat big | grep` beside an unrelated `a | b` still counts.
  if (CAT.has(name) && !/\|/.test(raw)) {
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
    const lines = count(resolve(cwd, String(input.file_path ?? ""))) ?? 0;
    if (lines <= READ_CAP) return 0;
    return input.limit && input.limit <= READ_CAP ? 0 : (input.limit ?? lines);
  }
  if (payload?.tool_name !== "Bash" && payload?.tool_name !== "PowerShell") return 0;
  const raw = withoutQuotedBodies(String(input.command ?? ""));
  return commands(raw).reduce((sum, c) => sum + fromCommand(c, raw, cwd, count), 0);
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
