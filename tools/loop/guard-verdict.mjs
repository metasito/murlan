/**
 * PreToolUse guard for the loop's main session: `VERDICT: LAND` goes up only after this round's own
 * reviewer ran (rule 29 of docs/agents/RULES.md). A round starts at its last `PHASE D`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";
import { apiMethod, parseHeader } from "./brief.mjs";
import { located, native } from "./guard-read.mjs";
import { PHASE } from "./loop-stream.mjs";

const LAND = /(^|["'=])[ \t]*VERDICT:[ \t]*LAND\b/m;
const ISSUE_URL = /\/issues\/(\d+)(?:[/?#]|$)/;
const API_COMMENTS = /(?:^|\/)issues\/(\d+)\/comments$/;

/** The issue a `gh issue comment` or a `gh api …/issues/<n>/comments` post names, and its body file. */
function postOf(c) {
  if (c.cmd !== "gh") return null;
  if (c.args[0] === "issue" && c.args[1] === "comment") {
    const at = c.args.findIndex((a) => a === "--body-file" || a === "-F" || a.startsWith("--body-file="));
    const file = at < 0 ? null : c.args[at].startsWith("--body-file=") ? c.args[at].slice(12) : c.args[at + 1];
    const target = c.args.slice(2).find((a) => /^\d+$/.test(a) || ISSUE_URL.test(a)) ?? "";
    return { n: Number(ISSUE_URL.exec(target)?.[1] ?? target) || null, file };
  }
  const endpoint = c.args[0] === "api" && c.args.map((a) => API_COMMENTS.exec(a)).find(Boolean);
  if (!endpoint || apiMethod(c.args) !== "POST") return null;
  const field = c.args.find((a) => a.startsWith("body=@"))?.slice(6);
  const input = c.args.includes("--input") ? c.args[c.args.indexOf("--input") + 1] : null;
  return { n: Number(endpoint[1]), file: field ?? input };
}
const PHASES = new RegExp(PHASE.source, "gm");

const readOr = (read, file) => {
  try {
    return read(file);
  } catch {
    return "";
  }
};

export function landOn(payload, read = (p) => readFileSync(p, "utf8")) {
  const raw = String(payload?.tool_input?.command ?? "");
  for (const { c, at: dir } of located(raw, payload.cwd ?? process.cwd())) {
    const post = postOf(c);
    if (!post) continue;
    const body = post.file && post.file !== "-" ? readOr(read, resolve(dir, native(post.file))) : "";
    if (LAND.test(`${raw}\n${body}`)) return post.n;
  }
  return null;
}

const rows = (text) =>
  text.split("\n").flatMap((line) => {
    try {
      return line.trim() ? [JSON.parse(line)] : [];
    } catch {
      return [];
    }
  });
const parts = (row) => (Array.isArray(row?.message?.content) ? row.message.content : []);
const startsD = (row) =>
  row.type === "assistant" &&
  parts(row).some((p) => p.type === "text" && [...String(p.text).matchAll(PHASES)].some((m) => m[1] === "D"));

export function denial(transcript, n) {
  const all = rows(transcript);
  const round = all.slice(Math.max(0, all.findLastIndex(startsD))).flatMap(parts);
  const uses = round.filter((p) => p.type === "tool_use");
  const kinds = new Set(
    uses
      .filter((p) => p.name === "Agent" || p.name === "Task")
      .map((p) => parseHeader(p.input?.prompt))
      .filter((h) => h?.n === n)
      .map((h) => h.kind),
  );
  if (kinds.has("review") || kinds.has("fix")) return null;
  return (
    `No VERDICT: LAND on #${n} before this round's own reviewers (rule 29 of docs/agents/RULES.md). ` +
    "Dispatch the review brief, or the fix brief, as queue.md phase D says, and post its REVIEW first. " +
    "A ticket never lands at the round cap: `node tools/loop/loop-gate.mjs --review-round` says what to do there."
  );
}

if (isInvokedDirectly(process.argv[1], import.meta.url) && process.env.LOOP_TURNS) {
  try {
    const payload = JSON.parse(readFileSync(0, "utf8") || "{}");
    const shell = payload.tool_name === "Bash" || payload.tool_name === "PowerShell";
    const n = shell && !payload.agent_id ? landOn(payload) : null;
    const path = payload.transcript_path;
    if (n && !path) process.stderr.write(`guard-verdict: the payload names no transcript, so the LAND on #${n} goes unchecked.\n`);
    const transcript = n && path ? readOr((p) => readFileSync(p, "utf8"), path) : null;
    const reason = !n || !path
      ? null
      : transcript
        ? denial(transcript, n)
        : `No VERDICT: LAND on #${n} while this session's transcript cannot be read (${path}): ` +
          "whether this round's reviewer ran is unknown, so it is refused rather than guessed.";
    if (reason) {
      process.stdout.write(
        JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }),
      );
    }
  } catch {
    process.exit(0);
  }
}
