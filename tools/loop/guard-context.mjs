/**
 * PostToolUse notice for the loop's main session: past the context ceiling, hand off. Said once,
 * found by its own text in the transcript tail, so one that scrolled out of it may be said again.
 *
 * Exit 0 always. stdout carries the hook's additionalContext, or nothing.
 */
if (!process.env.LOOP_TURNS) process.exit(0);
const { closeSync, fstatSync, openSync, readFileSync, readSync } = await import("node:fs");

const CONTEXT_CEILING = 200_000;
const TAIL_BYTES = 4 * 1024 * 1024;

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

const parsed = (line) => {
  try {
    return line.trim() ? JSON.parse(line) : null;
  } catch {
    return null;
  }
};

/**
 * The newest row the predicate accepts, found from the end. This hook runs on every Bash, Read,
 * Grep, Glob and Agent call a session makes — 483 of them on #1088 — so parsing the whole
 * transcript to reach its last row was the cost of the notice, paid per call.
 */
function newest(lines, want) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const row = parsed(lines[i]);
    if (row && want(row)) return row;
  }
  return null;
}

const contextOf = (u) =>
  (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);

function notices(payload) {
  const text = tail(payload.transcript_path);
  const lines = text.split("\n");
  const said = [];

  const ceiling = "Context is past 200k. Commit what works and hand off to the phase of your last PHASE line.";
  if (!text.includes(ceiling)) {
    const last = newest(lines, (r) => r.type === "assistant" && r.message?.usage);
    if (last && contextOf(last.message.usage) > CONTEXT_CEILING) said.push(ceiling);
  }
  return said;
}

try {
  const payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  if (!payload.agent_id && payload.transcript_path) {
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
