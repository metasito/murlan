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

function sedParts(args) {
  const s = { quiet: false, inPlace: false, scripts: [], files: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (/^(-e|--expression|-f|--file)$/.test(a)) s.scripts.push(args[++i] ?? "");
    else if (/^--(quiet|silent)$/.test(a)) s.quiet = true;
    else if (/^(-i|--in-place)/.test(a)) s.inPlace = true;
    else if (/^-[A-Za-z]+$/.test(a)) {
      s.quiet ||= a.includes("n");
      s.inPlace ||= a.includes("i");
    } else if (!a.startsWith("-")) (s.scripts.length ? s.files : s.scripts).push(a);
  }
  return s;
}

/** `$` is the last line of the whole input, so `A,$p` needs how long that input is. */
function sedLines(scripts, inputLines) {
  return scripts.flatMap((a) => a.split(";")).reduce((sum, a) => {
    const m = /^(\d+)(?:,(\d+|\$))?p$/.exec(a.trim());
    if (!m) return sum;
    const last = m[2] === "$" ? inputLines : Number(m[2] ?? m[1]);
    return sum + Math.max(0, last - Number(m[1]) + 1);
  }, 0);
}

const MATCH_ALL = new Set(["", "^", "$", ".*", "^.*", ".*$", "^.*$"]);

function grepParts(args) {
  const g = { patterns: [], files: [], invert: false, counts: false };
  let explicit = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (/^(-e|--regexp)$/.test(a) || /^-[A-Za-z]*e$/.test(a)) {
      g.invert ||= /^-[A-Za-z]*v/.test(a);
      g.patterns.push(args[++i] ?? "");
      explicit = true;
    } else if (/^(-[fmABCd]|--(file|max-count|after-context|before-context|context))$/.test(a)) i += 1;
    else if (a === "--invert-match") g.invert = true;
    else if (/^--(count|files-with-matches|files-without-match|quiet|silent)$/.test(a)) g.counts = true;
    else if (/^-[A-Za-z]+$/.test(a)) {
      g.invert ||= a.includes("v");
      g.counts ||= /[clLq]/.test(a);
    } else if (!a.startsWith("-")) (explicit || g.patterns.length ? g.files : g.patterns).push(a);
  }
  return g;
}

const grepsAll = (c) => {
  if (c.cmd.toLowerCase() !== "grep") return false;
  const g = grepParts(c.args);
  return !g.counts && (g.invert || g.patterns.some((p) => MATCH_ALL.has(p)));
};

function headLines(args) {
  const bytes = flagValue(args, ["-c", "--bytes"], false);
  return bytes === null ? (flagValue(args, ["-n", "--lines"]) ?? 10) : Math.ceil(bytes / BYTES_PER_LINE);
}

/** The most lines a pipeline's last stage lets through, or null when it bounds nothing. */
function bound(c) {
  const name = c.cmd.toLowerCase();
  if (name === "head" || name === "tail") return headLines(c.args);
  if (name === "sed") {
    const s = sedParts(c.args);
    const most = s.quiet ? sedLines(s.scripts, Infinity) : Infinity;
    return Number.isFinite(most) ? most || null : null;
  }
  if (name === "select-object") return flagValue(c.args, ["-first", "-last"]);
  return null;
}

function fromCommand(c, cwd, count) {
  const name = c.cmd.toLowerCase();
  const at = (f) => count(resolve(cwd, native(f))) ?? 0;
  if (name === "sed") {
    const s = sedParts(c.args);
    const input = s.files.reduce((sum, f) => sum + at(f), 0);
    return s.inPlace ? 0 : s.quiet ? sedLines(s.scripts, input) : input;
  }
  if (grepsAll(c)) return grepParts(c.args).files.reduce((sum, f) => sum + at(f), 0);
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
  if (stages.slice(1).some((s) => NARROWS.has(s.cmd.toLowerCase()) && !grepsAll(s))) return 0;
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
  let from = cwd;
  let total = 0;
  let stages = [];
  for (const { c, at } of located(withoutQuotedBodies(String(input.command ?? "")), cwd)) {
    if (!stages.length) from = at;
    stages.push(c);
    if (c.piped) continue;
    total += pipeline(stages, from, count);
    stages = [];
  }
  return total + (stages.length ? pipeline(stages, from, count) : 0);
}

/** Each command of the line, with the directory the `cd`s before it left the call in. */
export function located(command, cwd) {
  let at = cwd;
  const out = [];
  for (const c of commands(command)) {
    if (!MOVES.test(c.cmd.toLowerCase())) out.push({ c, at });
    else {
      const to = c.args.find((a) => !a.startsWith("-"));
      if (to) at = resolve(at, native(to));
    }
  }
  return out;
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
