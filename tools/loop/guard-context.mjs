/**
 * PostToolUse notice for the loop's main session: past the context ceiling, hand off; on a third
 * identical Bash command, batch the edits. Each notice is said once, remembered by finding its own
 * text in the transcript tail, so a notice that scrolled out of the tail may be said again.
 *
 * Exit 0 always. stdout carries the hook's additionalContext, or nothing.
 */
import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";

export const CONTEXT_CEILING = 150_000;
export const TAIL_BYTES = 4 * 1024 * 1024;
const REPEATS = 3;

function tail(file) {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString("utf8");
    return start > 0 ? text.slice(text.indexOf("\n") + 1) : text;
  } finally {
    closeSync(fd);
  }
}

function rows(text) {
  const out = [];
  for (const line of text.split("\n")) {
    try {
      if (line.trim()) out.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return out;
}

const contextOf = (u) =>
  (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);

function notices(payload) {
  const text = tail(payload.transcript_path);
  const all = rows(text);
  const said = [];

  const last = all.findLast((r) => r.type === "assistant" && r.message?.usage);
  const ceiling = "Context is past 150k. Commit what works and hand off to the phase of your last PHASE line.";
  if (last && contextOf(last.message.usage) > CONTEXT_CEILING && !text.includes(ceiling)) said.push(ceiling);

  const command = payload.tool_name === "Bash" ? payload.tool_input?.command : undefined;
  if (typeof command === "string") {
    const ids = new Set();
    for (const r of all) {
      for (const c of Array.isArray(r.message?.content) ? r.message.content : []) {
        if (c?.type === "tool_use" && c.name === "Bash" && c.input?.command === command) ids.add(c.id);
      }
    }
    ids.add(payload.tool_use_id ?? "current");
    const tag = createHash("sha256").update(command).digest("hex").slice(0, 8);
    const repeat = `same command three times: batch edits before re-running it [${tag}]`;
    if (ids.size >= REPEATS && !text.includes(repeat)) said.push(repeat);
  }
  return said;
}

try {
  const payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  if (process.env.LOOP_TURNS && !payload.agent_id && payload.transcript_path) {
    const said = notices(payload);
    if (said.length) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: said.join("\n") },
        })
      );
    }
  }
} catch {
  process.exit(0);
}
