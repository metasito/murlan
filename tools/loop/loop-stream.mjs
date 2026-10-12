/**
 * One line of `claude -p --output-format stream-json` as a fact the loop can act on.
 *
 * Everything here is pure: a line in, a fact or null out. The supervisor does the IO.
 */

/** One line of its own, anywhere in the message. Prose mentioning a phase is not a phase report. */
// The fence is optional because the session's echo of it is: from queue.md's one fenced marker the
// same model returned it bare in four runs of eight, fenced in three, and both ways inside one.
export const PHASE = /^[ \t]*`?PHASE ([A-F])`?[ \t]*$/m;
const ECHO = /^[ \t]*echo[ \t]+(["']?)PHASE ([A-F])\1[ \t]*(?=&&|;|\r?\n|$)/;
const HEREDOC = /^<<(-?)[ \t]*(["']?)([\w.-]+)\2/;

/**
 * The same report as a statement of its own in a main-session command — at its head or after a
 * `&&`, `;` or newline, never inside a quoted string or a heredoc's body, which is text the command
 * writes rather than runs.
 * @param {string} command
 */
export function echoedPhase(command) {
  let quote = "";
  let start = true;
  const heredocs = [];
  for (let i = 0; i < command.length; i++) {
    if (start && !quote) {
      const m = ECHO.exec(command.slice(i));
      if (m) return m[2];
      start = false;
    }
    const c = command[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = "";
    } else if (c === "\\") i++;
    else if (c === '"' || c === "'") quote = c;
    else if (command.startsWith("<<<", i)) i += 2;
    else if (c === "<" && HEREDOC.test(command.slice(i))) {
      const m = HEREDOC.exec(command.slice(i));
      heredocs.push({ word: m[3], tabs: m[1] === "-" });
      i += m[0].length - 1;
    } else if (c === ";" || c === "\n" || (c === "&" && command[i + 1] === "&")) {
      if (c === "&") i++;
      if (c === "\n") i = bodiesEnd(command, i + 1, heredocs.splice(0)) - 1;
      start = true;
    }
  }
  return null;
}

/** Where the bodies of the heredocs a line opened end, each at its delimiter's own line. */
function bodiesEnd(command, from, heredocs) {
  let at = from;
  for (const { word, tabs } of heredocs) {
    while (at < command.length) {
      const nl = command.indexOf("\n", at);
      const end = nl < 0 ? command.length : nl;
      const line = command.slice(at, end).replace(/\r$/, "");
      at = end + 1;
      if ((tabs ? line.replace(/^\t+/, "") : line) === word) break;
    }
  }
  return Math.min(at, command.length);
}

/**
 * What the session says it did, once, before it exits — the one channel that is a statement rather
 * than an inference. Everything else the supervisor knows about a finished session it reconstructs
 * from side effects the session is separately told to clean up, and phase F's teardown destroys
 * five of them at once.
 */
const DECLARED = /^[ \t]*LOOP-RESULT (\{.*\})[ \t]*$/m;

/** What a `git commit` looks like in a `Bash` call, whatever else is on the line. */
export const COMMITTING = /\bgit(?:\s+(?:-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+)|--[\w-]+(?:=\S+)?))*\s+commit(?![\w-])/;

const EDITS = new Set(["Edit", "Write", "NotebookEdit"]);
const SCRATCH =
  /(^|[\\/])\.[^\\/]+\.md$|^\/tmp\/|[\\/]Temp[\\/]|[\\/]\.loop-logs[\\/]|[\\/]\.worktrees[\\/][^\\/]+[\\/][^\\/]+\.(md|txt|log|tsv)$/;

/**
 * Where a phase that does not build ends in the build with no `PHASE C` (#1098): the first edit
 * outside a scratch file, or commit — late, never before the build.
 * @param {{name: string, command?: string, file?: string, parent?: string|null}[]} calls
 */
export const scopeEnds = (calls) =>
  calls.some((c) => !c.parent && ((EDITS.has(c.name) && !SCRATCH.test(c.file ?? "")) || (c.name === "Bash" && COMMITTING.test(c.command ?? ""))));

/** A handoff names the phase the next process starts at, so an unknown letter is no handoff. */
export const HANDOFF = /^[A-F]$/;

/** @param {string} text */
function declaredIn(text) {
  const m = DECLARED.exec(text);
  if (!m) return null;
  try {
    const d = JSON.parse(m[1]);
    return {
      ticket: Number(d.ticket) || null,
      branch: d.branch ?? null,
      pr: Number(d.pr) || null,
      phase: d.phase ?? null,
      handoff: HANDOFF.test(String(d.handoff ?? "")) ? String(d.handoff) : null,
      stoodDown: Boolean(d.stoodDown),
      why: d.why ?? null,
    };
  } catch {
    return null;
  }
}

// A dispatched subagent and a plain shell task share one task_id key space but close through
// different subtypes: a shell task's task_started/task_notification pair carries a flat `status`;
// a subagent's task_started/task_progress chain is closed by task_updated, whose only content is
// a `patch` — sometimes the closing `{status, end_time}` (an `error` string too, if it failed),
// sometimes mid-run just `{is_backgrounded: true}`. One mapping covers all four by reading through
// to `patch` wherever the flat field is absent, which is also the only way a subagent's phase ever
// shows a sign of life: it is the one caller of readLine() that never emits an `assistant` fact.
const TASK_EVENT = {
  task_started: "started",
  task_progress: "progress",
  task_notification: "notification",
  task_updated: "updated",
};

/** @param {unknown} s */
function trimmedOrNull(s) {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t || null;
}

/** @param {string} event */
function taskFact(event, e) {
  return {
    kind: "task",
    event,
    id: e.task_id,
    of: e.tool_use_id ?? null,
    what: trimmedOrNull(e.description ?? e.summary ?? e.patch?.error),
    agent: e.subagent_type ?? null,
    tool: e.last_tool_name ?? null,
    status: e.status ?? e.patch?.status ?? null,
    background: e.is_backgrounded ?? e.patch?.is_backgrounded ?? false,
    tokens: e.usage?.total_tokens ?? 0,
    toolUses: e.usage?.tool_uses ?? 0,
    ms: e.usage?.duration_ms ?? 0,
  };
}

export function readLine(line) {
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    return null;
  }
  if (e.type === "system" && e.subtype === "init") {
    return {
      kind: "init",
      sessionId: e.session_id ?? null,
      version: e.claude_code_version ?? null,
      model: e.model ?? null,
      plugins: (e.plugins ?? []).map((p) => p.source ?? p.name),
    };
  }
  if (e.type === "system" && e.subtype === "api_retry") {
    return { kind: "api_retry", attempt: e.attempt ?? null, status: e.error_status ?? null, error: e.error ?? null };
  }
  if (e.type === "system" && TASK_EVENT[e.subtype]) {
    if (!e.task_id) return null;
    return taskFact(TASK_EVENT[e.subtype], e);
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
  // One fact per message, not one per block. A turn ending in a text block and no tool call is the
  // final answer in print mode, so a marker that must be the whole of a message can end the
  // session on turn one — the marker and that phase's first command have to be able to share a turn.
  if (e.type === "assistant" && typeof e.error === "string") {
    const text = (e.message?.content ?? []).filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("\n");
    return { kind: "api_error", code: e.error, text };
  }
  if (e.type === "assistant") {
    const blocks = e.message?.content ?? [];
    const text = blocks
      .filter((b) => b.type === "text")
      .map((b) => String(b.text ?? ""))
      .join("\n");
    const phase = PHASE.exec(text);
    const calls = blocks
      .filter((b) => b.type === "tool_use")
      .map((b) => ({
        name: b.name,
        command: String(b.input?.command ?? ""),
        // Whole, because what names a call best differs by tool: a path for Read, a pattern for
        // Grep, and for Bash the `description` the model wrote for a person rather than the command
        // it wrote for a shell. Choosing between them is the renderer's job, not this one's.
        input: b.input ?? {},
        parent: e.parent_tool_use_id ?? null,
      }));
    const echoed = calls
      .filter((c) => c.parent === null && (c.name === "Bash" || c.name === "PowerShell"))
      .map((c) => echoedPhase(c.command))
      .find(Boolean);
    const letter = phase?.[1] ?? echoed ?? null;
    const declared = declaredIn(text);
    if (!letter && !declared && !calls.length) return null;
    // The prose around the marker, which the board shows as the session's own account of what it is
    // doing. Two markers were parsed out of it and the rest was dropped.
    // One line per content block, each with the whole message's usage: count turns by `id`, not line.
    return { kind: "assistant", id: e.message?.id ?? null, letter, declared, calls, text };
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
      apiStatus: e.api_error_status ?? null,
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
