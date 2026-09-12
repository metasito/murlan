/**
 * One line of `claude -p --output-format stream-json` as a fact the loop can act on.
 *
 * Everything here is pure: a line in, a fact or null out. The supervisor does the IO.
 */

/** One line, on its own, said by the session. Prose mentioning a phase is not a phase report. */
const PHASE = /^PHASE ([A-F])$/;

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
  // A meter, not an alarm: it ticks several times a minute on a healthy session, carrying
  // `status: "allowed"`. Only "rejected" is work refused — a warning is still being served.
  if (e.type === "rate_limit_event") {
    const info = e.rate_limit_info ?? {};
    // `resetsAt` is documented in the CLI bundle as unix epoch *seconds*. A window's own
    // `resetsAt` is preferred over the top-level one, and the type can name a window
    // `unifiedWindows` has no key for (`seven_day_opus`), so both reads fall back.
    const window = info.unifiedWindows?.[info.rateLimitType];
    const resetsAt = window?.resetsAt ?? info.resetsAt ?? null;
    return {
      kind: "rate_limit",
      status: info.status ?? "unknown",
      blocked: info.status === "rejected",
      // The only signal that arrives before work starts failing.
      warning: info.status === "allowed_warning",
      resetsAt,
      resetsAtMs: resetsAt ? (resetsAt > 1e12 ? resetsAt : resetsAt * 1000) : 0,
      window: info.rateLimitType ?? null,
      used: window?.utilization ?? info.utilization ?? null,
      errorCode: info.errorCode ?? null,
    };
  }
  if (e.type === "assistant") {
    const said = (e.message?.content ?? []).find((b) => b.type === "text");
    const phase = PHASE.exec(String(said?.text ?? "").trim());
    if (phase) return { kind: "phase", letter: phase[1] };
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
      // A background task's wake-up is a turn, and emits a result of its own. The session's real
      // one carries `origin: null`; every other carries origin.kind "task-notification".
      origin: e.origin ?? null,
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
