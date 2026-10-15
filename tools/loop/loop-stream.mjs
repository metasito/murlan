/**
 * One line of `claude -p --output-format stream-json` as a fact the loop can act on.
 *
 * Everything here is pure: a line in, a fact or null out. The supervisor does the IO.
 */
import { commands, withoutQuotedBodies } from "./shell.mjs";

/** One line of its own, anywhere in the message. Prose mentioning a phase is not a phase report. */
// The fence is optional because the session's echo of queue.md's fenced marker is: it comes back
// bare or fenced, sometimes both ways in one run.
export const PHASE = /^[ \t]*`?PHASE ([A-F])`?[ \t]*$/m;
/**
 * The same report as a command of its own in a main-session call: `… && echo "PHASE C" && …`. Read
 * by the shell parser the supervisor already runs on these commands, so a quoted string or a
 * heredoc's body, text a command writes rather than runs, is never one.
 * @param {string} command
 */
export function echoedPhase(command) {
  const echo = commands(withoutQuotedBodies(command)).find((c) => c.cmd === "echo" && /^PHASE [A-F]$/.test(c.args.join(" ")));
  return echo ? echo.args.join(" ").slice(-1) : null;
}

/** What a `git commit` looks like in a `Bash` call, whatever else is on the line. */
export const COMMITTING = /\bgit(?:\s+(?:-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+)|--[\w-]+(?:=\S+)?))*\s+commit(?![\w-])/;

const EDITS = new Set(["Edit", "Write", "NotebookEdit"]);
const SCRATCH =
  /(^|[\\/])\.[^\\/]+\.md$|^\/tmp\/|[\\/]Temp[\\/]|[\\/]\.loop-logs[\\/]|[\\/]\.worktrees[\\/][^\\/]+[\\/][^\\/]+\.(md|txt|log|tsv)$/;

/**
 * Where a phase that does not build ends in the build with no `PHASE C`: the first edit
 * outside a scratch file, or commit — late, never before the build.
 * @param {{name: string, command?: string, file?: string, parent?: string|null}[]} calls
 */
export const scopeEnds = (calls) =>
  calls.some((c) => !c.parent && ((EDITS.has(c.name) && !SCRATCH.test(c.file ?? "")) || (c.name === "Bash" && COMMITTING.test(c.command ?? ""))));

/** A handoff names the phase the next process starts at, so an unknown letter is no handoff. */
export const HANDOFF = /^[A-F]$/;

/** @param {unknown} d a result's `structured_output` */
function declaration(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  return {
    ticket: Number(d.ticket) || null,
    branch: d.branch ?? null,
    pr: Number(d.pr) || null,
    phase: d.phase ?? null,
    handoff: HANDOFF.test(String(d.handoff ?? "")) ? String(d.handoff) : null,
    stoodDown: Boolean(d.stoodDown),
    why: d.why ?? null,
  };
}

/** A result's `structured_output` as the session's declaration, or null when it gives none. */
function given(out) {
  const said = declaration(out);
  return said && Object.values(out).some((v) => v != null) ? said : null;
}

// A subagent and a shell task share one task_id key space but close through different subtypes: a
// shell task's task_notification carries a flat `status`; a subagent's chain is closed by
// task_updated, whose only content is a `patch` — the closing `{status, end_time}` (with `error` if
// it failed), or mid-run just `{is_backgrounded: true}`. So every read falls through to `patch`,
// a subagent's only sign of life: it never emits an `assistant` fact.
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
    brief: typeof e.prompt === "string" ? e.prompt.split("\n")[0] : null,
    tool: e.last_tool_name ?? null,
    status: e.status ?? e.patch?.status ?? null,
    background: e.is_backgrounded ?? e.patch?.is_backgrounded ?? false,
    tokens: e.usage?.total_tokens ?? 0,
    toolUses: e.usage?.tool_uses ?? 0,
    ms: e.usage?.duration_ms ?? 0,
  };
}

/**
 * The tokens one `assistant` line billed, or null for any other line. A message streams as one line
 * per content block, each repeating the message's usage, so callers key on `id`.
 * @param {string} line
 */
export function usageOf(line) {
  if (!line.includes('"usage"') || !line.includes('"assistant"')) return null;
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    return null;
  }
  const u = e?.type === "assistant" ? e.message?.usage : null;
  if (!u || !e.message?.id || e.message.model === "<synthetic>") return null;
  return {
    id: String(e.message.id),
    model: e.message.model ?? null,
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheCreated: u.cache_creation_input_tokens ?? 0,
  };
}

export function readLine(line) {
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    return null;
  }
  return readEvent(e);
}

/** `readLine` for a line already parsed. */
export function readEvent(e) {
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
    if (!letter && !calls.length) return null;
    // The prose around the marker, which the board shows as the session's own account of what it is
    // doing.
    // One line per content block, each with the whole message's usage: count turns by `id`, not line.
    return { kind: "assistant", id: e.message?.id ?? null, letter, calls, text };
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
      declared: given(e.structured_output),
    };
  }
  return null;
}

/** The CLI's assistant-error codes no unattended wait cures: someone has to act on the account. */
export const ACCOUNT_ERRORS = new Set(["authentication_failed", "oauth_org_not_allowed", "account_on_hold", "verification_required", "billing_error"]);

/**
 * The model family an id names. Keyed on the family word rather than on a full id, because the logs
 * carry four spellings of two models — `claude-opus-5`, `opus`, `claude-opus-5[1m]`, `sonnet`.
 */
export const familyOf = (model) => ["opus", "sonnet", "haiku"].find((f) => String(model).includes(f)) ?? null;

/**
 * Whether a task event says that task is over.
 *
 * A `task_updated` carries a status only when it is closing one; mid-run it says something else
 * entirely — a task flipping to the background — and reading that as "finished" empties the board
 * while the agent is still working.
 *
 * @param {{event: string, status: string|null}} fact
 */
export function closesTask({ event, status }) {
  if (event === "notification") return true;
  return event === "updated" && status !== null && status !== "in_progress";
}

/** A session before its first line, spawned into phase `at` (null: it names its own). */
export function sessionStart(at, now) {
  return {
    phase: at,
    phaseAt: now,
    phases: {},
    result: null,
    /** Each message's billed tokens by id, for a session that dies before it reports a cost. */
    usage: new Map(),
    declared: null,
    version: null,
    model: null,
    lastFact: null,
    blocked: false,
    blockedUntil: 0,
    accountError: null,
    wrongModel: null,
    apiErrorCode: null,
    /** Subagents running right now, in the order they were last heard from. */
    tasks: new Map(),
  };
}

/** Seconds in the phase just left, so the record carries where a night's time actually goes. */
export function closePhase(state, now) {
  if (!state.phase) return state;
  const secs = Math.round((now - state.phaseAt) / 1000);
  return { ...state, phases: { ...state.phases, [state.phase]: (state.phases[state.phase] ?? 0) + secs }, phaseAt: now };
}

/**
 * One stream line folded into a session's state, with what it asks of the supervisor: `session`,
 * `start`, `said`, `call`, `tasks` and `refused` for the screen, `kill` for the process. Reads no
 * clock, so `now` is handed in; `planned` is the model family phase `at` runs on.
 *
 * @param {ReturnType<typeof sessionStart>} state
 * @param {string} line
 * @param {{now: number, at?: string|null, planned: string}} ctx
 */
export function reduceSession(state, line, { now, at = null, planned }) {
  const effects = [];
  let next = state;
  const billed = usageOf(line);
  if (billed) next = { ...next, usage: new Map(next.usage).set(billed.id, billed) };
  const fact = readLine(line);
  if (!fact) return { state: next, effects };
  next = { ...next, lastFact: fact.kind };
  if (fact.kind === "init") {
    next.version = fact.version;
    next.model = fact.model;
    effects.push({ kind: "session", id: fact.sessionId });
    // `--model` passes an alias, which ANTHROPIC_DEFAULT_*_MODEL in the inherited or project env remaps.
    const family = familyOf(fact.model);
    if (family && family !== planned && !next.wrongModel) {
      next.wrongModel = `the session started on ${fact.model}, but phase ${at ?? "A"} runs on ${planned}`;
      effects.push({ kind: "kill" });
    }
  }
  if (fact.kind === "assistant") {
    const letter = fact.letter ?? (next.phase === "B" && scopeEnds(fact.calls) ? "C" : null);
    if (letter && letter !== next.phase) {
      next = { ...closePhase(next, now), phase: letter };
      effects.push({ kind: "start", letter });
    }
    // What the session said about what it is doing, then the calls it made.
    effects.push({ kind: "said", text: fact.text });
    for (const call of fact.calls) effects.push({ kind: "call", call });
  }
  // A foreground subagent emits nothing else into the parent stream, so without these the phase
  // line freezes on its last fact for the whole of phase D and a working session looks hung.
  if (fact.kind === "task") {
    const tasks = new Map(next.tasks);
    // Deleted before set, so the insertion order stays "least recently heard from first" and the
    // detail names the agent that just moved.
    tasks.delete(fact.id);
    if (!closesTask(fact)) tasks.set(fact.id, fact);
    next.tasks = tasks;
    effects.push({ kind: "tasks", tasks: [...tasks.values()] });
  }
  if (fact.kind === "api_error") {
    effects.push({ kind: "said", text: fact.text });
    if (ACCOUNT_ERRORS.has(fact.code)) next.accountError ??= `${fact.code}: ${fact.text}`;
    next.apiErrorCode = fact.code;
  }
  // A session emits one result per turn, and a background task's wake-up is a turn. The real one
  // carries `origin: null`; every other carries origin.kind "task-notification".
  if (fact.kind === "result" && !fact.origin) {
    next.result = fact;
    if (fact.declared) next.declared = fact.declared;
  }
  if (fact.kind === "rate_limit") {
    // Cleared on the next reading that is not a refusal: a session refused early that recovers
    // and pushes has done its work, and a sticky flag pre-empts every other reading of it.
    if (!fact.blocked && next.blocked) {
      next.blocked = false;
      next.blockedUntil = 0;
    }
    if (fact.blocked && !next.blocked) {
      next.blocked = true;
      next.blockedUntil = fact.resetsAtMs ?? 0;
      effects.push({ kind: "refused", window: fact.window, resetsAt: fact.resetsAt });
    }
  }
  return { state: next, effects };
}
