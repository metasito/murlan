/**
 * One line of `claude -p --output-format stream-json` as a fact the loop can act on.
 *
 * Everything here is pure: a line in, a fact or null out. The supervisor does the IO.
 */

/**
 * Which command in `queue.md` marks a phase `loop-derive.mjs` cannot see. A, B and E leave no trace
 * in git or the tracker at the moment they start, so they are read from what the session runs — and
 * `tests/loopDocsAreExecutable.test.ts` is what keeps each `doc` a command queue.md actually names.
 *
 * F is not here. Closing out is the supervisor's: it reads CI, merges and removes the worktree after
 * the session has exited, so no line of the session's stream can mark it and the supervisor prints
 * that phase from its own work.
 *
 * Nothing the loop *does* depends on this table. A marker that stops matching costs a phase line,
 * never a decision.
 */
export const PHASE_MARKERS = [
  { phase: "A", tool: "Bash", doc: "gh issue edit <n> --add-label in-progress" },
  { phase: "B", tool: "Task" },
  { phase: "E", tool: "Bash", doc: "git push -u origin agent/<n>-<slug>" },
];

/** A `<placeholder>` stands for one argument; everything else in the doc string is literal. */
export function toPattern(doc) {
  const escaped = doc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped.replace(/<[a-z-]+>/g, "\\S+"));
}

const COMPILED = PHASE_MARKERS.map((m) => ({ ...m, pattern: m.doc ? toPattern(m.doc) : null }));

/** A Bash command after which the derived phase may have moved. */
export const REDERIVE = /^(git commit|gh issue comment|node scripts\/loop-gate\.mjs)/;

export function phaseOf(call) {
  for (const m of COMPILED) {
    if (m.tool !== call.name) continue;
    if (!m.pattern) return m.phase;
    if (m.pattern.test(call.command)) return m.phase;
  }
  return null;
}

export function readLine(line) {
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    return null;
  }
  if (e.type === "system" && e.subtype === "init") {
    return { kind: "init", sessionId: e.session_id ?? null, version: e.claude_code_version ?? null };
  }
  // This event is a usage meter, not an alarm: it arrives every few turns of a perfectly healthy
  // session with `status: "allowed"` and the window's utilisation. Only a status that is not
  // "allowed" means work was actually refused. Reading the type alone reports a throttle on a
  // session running at 30% of its five-hour window, several times a minute.
  if (e.type === "rate_limit_event") {
    const info = e.rate_limit_info ?? {};
    return {
      kind: "rate_limit",
      status: info.status ?? "unknown",
      blocked: Boolean(info.status) && info.status !== "allowed",
      resetsAt: info.resetsAt ?? null,
      window: info.rateLimitType ?? null,
      used: info.unifiedWindows?.[info.rateLimitType]?.utilization ?? null,
    };
  }
  if (e.type === "assistant") {
    const calls = (e.message?.content ?? [])
      .filter((b) => b.type === "tool_use")
      .map((b) => ({
        name: b.name,
        command: String(b.input?.command ?? ""),
        parent: e.parent_tool_use_id ?? null,
      }));
    return calls.length ? { kind: "tool", calls } : null;
  }
  if (e.type === "result") {
    return {
      kind: "result",
      isError: Boolean(e.is_error),
      subtype: e.subtype ?? null,
      terminalReason: e.terminal_reason ?? null,
      cost: e.total_cost_usd ?? 0,
      turns: e.num_turns ?? 0,
      durationMs: e.duration_ms ?? 0,
      models: e.modelUsage ?? {},
      subagents: e.subagent_stats ?? null,
      cache: {
        created: e.usage?.cache_creation_input_tokens ?? 0,
        read: e.usage?.cache_read_input_tokens ?? 0,
      },
    };
  }
  return null;
}
