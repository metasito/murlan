# What `claude -p` exposes for a supervising Node script

Research date: 2026-09-10. Installed binary on this machine: native install at
`~/.local/bin/claude.exe`, version **2.1.267** per `claude --version`, auto-updated to
**2.1.268** by the time the live tests below ran (visible in each test's own
`system/init.claude_code_version` field — native installs auto-update in the background, per
`docs/en/setup` §"Auto-updates"). Every claim below is tagged with its source. Two source
classes are used, both treated as primary:

- **Docs** — `code.claude.com/docs/en/*` (current host; `docs.claude.com`/`docs.anthropic.com`
  redirect here, matching what `docs/research/2026-09-03-anthropic-sdlc.md` already
  established), `nodejs.org` for the one Node.js-internals question (§8), and the npm registry's
  own published `package.json` for `@anthropic-ai/claude-code` (Anthropic's own shipped
  artifact, not a write-up about it).
- **Live** — actual output of `claude -p` and `claude --help` run on this machine during this
  research session, quoted verbatim from the captured JSONL/text. This is higher-trust than the
  docs for exact field shapes, because it's the artifact itself, not a description of it — and
  it caught at least one place where the docs and the installed binary disagree (see §7).

No blog post, newsletter, or secondary write-up is cited for any claim. Where a claim rests only
on a small-model paraphrase of a doc page (WebFetch summarizes with a fast model) rather than a
verbatim quote or a live test, that is flagged explicitly.

---

## 1. `--output-format stream-json`, `--input-format`, and the event shapes

**`--verbose` is mandatory alongside `--output-format stream-json` in print mode — confirmed
live, not just documented.** Running:

```
claude -p "reply with exactly the word: pong" --output-format stream-json
```

fails immediately with `Error: When using --print, --output-format=stream-json requires
--verbose` (exit code 1, live test, this session). `code.claude.com/docs/en/headless` corroborates
it in prose: "Use `--output-format stream-json` with `--verbose` and `--include-partial-messages`
to receive tokens as they're generated."

**`--input-format`** accepts `text` (default) or `stream-json` for realtime streaming input, per
`claude --help`'s own text: `Input format (only works with --print): "text" (default), or
"stream-json" (realtime streaming input)`. This flag only appeared in `--help` output on the
CLI itself, not needing a docs fetch.

### Event shapes, captured live (not reconstructed from docs)

A one-line prompt (`claude -p "reply with exactly the word: pong" --output-format stream-json
--verbose`) produced, in order:

1. **`system`/`hook_started` and `system`/`hook_response`** — one pair per configured
   `SessionStart` hook, streaming *before* `system/init` (this project has three: ponytail,
   superpowers, and the queue-loop status hook). Confirms the docs' claim that these "stream as
   the hook produces them" and precede `system/init`.
2. **`system`/`init`** — the session-metadata event. Live fields observed:
   `cwd`, `session_id`, `tools` (array), `mcp_servers`, `model`, `permissionMode`,
   `slash_commands`, `terminal_slash_commands`, `apiKeySource`, `claude_code_version`,
   `output_style`, `agents`, `skills`, `plugins` (array of `{name, path, source, version}`),
   `capabilities` (array, e.g. `["interrupt_receipt_v1","interrupt_cancel_queued_v1",
   "msg_lifecycle_v1"]`), `analytics_disabled`, `product_feedback_disabled`, `uuid`,
   `memory_paths.auto`, `messaging_socket_path`, `fast_mode_state`,
   `fast_mode_disabled_reason`, `powershell_path`. No `mcp_server_errors` or `plugin_errors` keys
   were present because nothing failed to load — `docs/en/headless` states both keys are
   "omitted when there are no errors," which matches.
3. **`rate_limit_event`** — not asked about, but present unprompted: a top-level event
   (`type:"rate_limit_event"`) carrying `rate_limit_info.status`, `.resetsAt`, `.rateLimitType`,
   `.overageStatus`, `.unifiedWindows.{five_hour,seven_day}.{utilization,resetsAt}`. Not
   mentioned in the fetched docs; worth knowing it exists in the stream for anyone filtering by
   `type`.
4. **`assistant`** — one per completed content block. Live shape:
   `{"type":"assistant","message":{"model","id","type":"message","role":"assistant","content":[...],
   "container","stop_reason","stop_sequence","stop_details","usage":{...},"diagnostics",
   "context_management"},"parent_tool_use_id","session_id","uuid","timestamp","request_id"}`.
   `content` blocks observed live: `{"type":"text","text":...}`, `{"type":"thinking","thinking",
   "signature"}`, and `{"type":"tool_use","id","name","input","caller":{"type":"direct"}}`.
5. **`user`** — echoes tool results back into the transcript. Live shape (captured for a Bash
   tool call):
   ```json
   {"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_...",
   "type":"tool_result","content":"hi3","is_error":false}]},"parent_tool_use_id":null,
   "session_id":"...","uuid":"...","timestamp":"...",
   "tool_use_result":{"stdout":"hi3","stderr":"","interrupted":false,"isImage":false,
   "noOutputExpected":false}}
   ```
6. **`result`** (final line). Every field observed live, in one real payload:
   `duration_api_ms`, `stop_reason`, `session_id`, `total_cost_usd`, `usage` (with
   `output_tokens_details.thinking_tokens`, `cache_creation_input_tokens`,
   `cache_read_input_tokens`, `server_tool_use`, `service_tier`, `cache_creation`,
   `inference_geo`, `iterations`), `modelUsage` (per-model cost/token breakdown, keyed by
   canonical model name), `permission_denials` (array), `terminal_reason`, `fast_mode_state`,
   `fast_mode_disabled_reason`, `subagent_stats` (spawned/requested/started_in_background/
   max_depth/spawned_by_subagents/completed/failed/killed/refused/by_type), `is_error`,
   `num_turns`, `subtype`, `api_error_status`, `result` (the text), `ttft_ms`, `type`,
   `duration_ms`, `uuid`, `ttft_stream_ms`, `time_to_request_ms`, `first_content_frame_ms`,
   `queued_turn_count`, `result_index`. **All of `total_cost_usd`, `duration_ms`,
   `duration_api_ms`, `num_turns`, `session_id`, `is_error`, `subtype`, `usage`, and `result`
   text are confirmed present**, exactly as asked.

   `subtype` is not a fixed two-value field. Live-forced a second value by combining
   `--max-turns 1` with a task needing more than one turn: the final line came back with
   `"subtype":"error_max_turns"`, `"is_error":true`, `"terminal_reason":"max_turns"`, and an
   `"errors":["Reached maximum number of turns (1)"]` array — a field not present on a clean
   `"subtype":"success"` result. Process exit code for that run was **1** (see §4). Docs do not
   publish a complete enum of `subtype` values anywhere this research found (see §7); this
   session confirms at least `success` and `error_max_turns` exist.

`code.claude.com/docs/en/headless` adds one live-parity fact this session's own tests didn't need
to independently prove: with `--output-format json` (not `stream-json`), the same `result`,
`session_id`, and `total_cost_usd` fields come back as a single JSON object instead of a
streamed line, and "figures are client-side estimates and can differ from your actual bill" —
i.e., `total_cost_usd` is explicitly documented as an estimate, not a billing-accurate figure.

---

## 2. `--include-partial-messages`

Requires `--print` and `--output-format stream-json` (`claude --help`, verbatim). Live-tested
with `--include-partial-messages` added to a Bash-tool-calling prompt; it interleaves
`{"type":"stream_event","event":{...}}` lines between the `assistant`/`user` lines, carrying the
**raw Anthropic Messages API streaming event** (`code.claude.com/docs/en/agent-sdk/streaming-output`
calls this out explicitly: "The `event` field contains the raw streaming event from the Claude
API"). Event `type`s observed live, in the order they occur for one turn:

```
content_block_start   (index 0: thinking; later index 1: tool_use)
content_block_delta    (deltas — not observed with content mid-test since thinking signature was atomic here)
content_block_stop
message_delta          ({"delta":{"stop_reason":"tool_use"|"end_turn",...},"usage":{...},"context_management"})
message_stop
```

**What it costs:** strictly additive line volume — every `content_block_delta` becomes its own
JSON line, so a long streamed answer means many more lines than blocks/messages. The docs state
the *only* documented cost callout is unrelated to CPU/bandwidth: "If your consumer reads the
stream slowly, Claude Code waits for the queued output to drain before exiting, scaling the wait
with how much is still queued, capped at 30 seconds" (`docs/en/headless`, "Stream responses";
raised from ~2s before v2.1.214). No documented token-cost or dollar-cost difference from
enabling it — it's the same API stream, just also mirrored to your process instead of only
assembled internally.

A related, separate flag: **`--include-hook-events`** ("only works with
`--output-format=stream-json`") adds `hook_started`/`hook_response` events for hook types beyond
`SessionStart`/`Setup`. Live-confirmed: without this flag, a Bash-tool run through this
project's configured `PreToolUse` hook (`scripts/guard-bash.mjs`, matcher `Bash|PowerShell`)
produced **no** `PreToolUse` event in the stream even though the hook still ran (had it blocked
the call, the tool call itself would have failed); adding `--include-hook-events` made
`{"hook_name":"PreToolUse:Bash","hook_event":"PreToolUse",...}` `hook_started`/`hook_response`
pairs appear, alongside a `UserPromptSubmit` pair. **`SessionStart` is the one hook type that
streams by default with no flag** — this matches `docs/en/headless`'s wording that
`hook_started`/`hook_progress`/`hook_response` for a "configured `SessionStart` or `Setup` hook"
specifically precede `system/init` unconditionally, while every other hook type's events are
gated behind `--include-hook-events`.

---

## 3. One invocation, both a human-readable stream and machine events?

**Not documented as a built-in feature, and the docs' own recommended pattern is the opposite of
a tee.** `--output-format` is a single exclusive choice — `text`, `json`, or `stream-json`
(`claude --help`). There is no flag or documented combination that emits both plain narration
*and* JSON lines on the same or a second channel simultaneously. Concretely:

- With `stream-json`, stdout carries JSON lines only — verified live (the captured files are
  100% parseable JSONL, no interleaved prose).
- The docs' own worked example for building a human-readable *view* out of the JSON stream is to
  **parse the events yourself and render your own UI from them**
  (`code.claude.com/docs/en/agent-sdk/streaming-output`, "Build a streaming UI" — tracks an
  `in_tool` flag and writes `text_delta` chunks to `stdout` with `[Using Read...]` markers). This
  is the documented way to get a live, readable console view: build it from the JSON, not
  request it as a second channel.
- Nothing in `docs/en/headless`, `docs/en/agent-sdk/streaming-output`, or `docs/en/agent-sdk/typescript`
  mentions a hook, a `--tee`-style flag, or a secondary output stream for this. Stated plainly:
  **not documented.**

Practical corollary for a supervising Node script: don't ask Claude Code to give you a console
view; parse `stream-json` (optionally with `--include-partial-messages`) and synthesize whatever
human-facing progress line you want from `assistant`/`stream_event`/`result` events. `stdio:
"inherit"` isn't "replaced" by `stream-json` so much as moot — in print mode there was never an
interactive TUI on stdout to begin with (that only exists without `-p`); `-p` with `text` (the
default) already only prints the final answer, not a live view.

---

## 4. Exit codes

**Documented, generally:** `code.claude.com/docs/en/headless` states "Claude Code exits with code
0 on success and a non-zero code when the run fails, so your scripts can branch on the exit
status," and separately, for SIGTERM specifically: **"If you stop a `claude -p` run with
SIGTERM... Claude Code exits with code 143."** The same section documents the SIGTERM shutdown
sequence precisely: it "terminates the process tree of any Bash command that is still running,"
then "runs `SessionEnd` hooks and exits," starting no new tool call or model request and running
no other hook. A command mid-execution is "recorded as killed in the session"; a pending
permission prompt is "left unanswered" (bare SIGTERM) or cancelled (Agent SDK's `interrupt()`/
closing stdin). **SIGINT, not SIGTERM, is what ends the in-flight turn cleanly** — the docs
explicitly contrast: "To end the turn instead, send SIGINT... before you stop the process."

**Live-confirmed, two concrete non-zero cases beyond 143:**
- **`error_max_turns`**: hitting `--max-turns` mid-task exits **1**, with the JSON `result`
  event carrying `"is_error":true`, `"subtype":"error_max_turns"`, `"terminal_reason":"max_turns"`.
- **Auth failure** (tested live by running `--bare` with no `ANTHROPIC_API_KEY` set, which per
  docs, bare mode "never reads OAuth credentials or the system keychain"): exits **1**, with
  `"is_error":true`, `"subtype":"success"` (this specific combination — `is_error:true` paired
  with `subtype:"success"` — looks like a genuine inconsistency in this build, not a documented
  distinct failure subtype; noted as observed, not asserted as intentional), `"result":"Not
  logged in · Please run /login"`, and an extra `"error":"authentication_failed"` +
  `"is_api_error_message":true` on the preceding `assistant` message.

**Not documented: a full enumerated table of exit codes for `claude -p` itself.** The only other
codes this research found documented anywhere on `code.claude.com` are context-specific and not
about `-p` runs: **137** is documented only for the *install script* ("Installation was killed
before it could finish"), and `claude auth status` documents 0 (logged in) / 1 (not logged in)
as its own subcommand's codes — neither is a `claude -p` exit-code table. **What distinguishes a
"crash," a "refusal," and a clean completion is carried in the JSON `result` event
(`is_error`, `subtype`, `terminal_reason`, `errors[]`), not in a documented taxonomy of process
exit codes** — the process exit code is documented only as a coarse zero/non-zero signal plus
the one specific SIGTERM case. A supervising script that wants to distinguish *why* a run failed
should parse the last `stream-json` line, not branch on the numeric exit code beyond 0-vs-nonzero
(and 143 specifically for "someone/something sent SIGTERM").

---

## 5. Hooks: payload shape, and whether they fire under `-p`

**Confirmed live, directly, in this repository, during this research session:** `SessionStart`,
`UserPromptSubmit`, and `PreToolUse` hooks all fired during plain `claude -p ...` runs on this
machine — not inferred from docs, watched happening. The evidence:
- Every `-p` stream-json capture in this session opened with `hook_started`/`hook_response`
  pairs for this project's three `SessionStart` hooks (ponytail, superpowers,
  `scripts/loop-status.mjs`) before `system/init` ever appeared.
- With `--include-hook-events` added, a run that submitted a prompt and called the `Bash` tool
  additionally produced a `UserPromptSubmit` hook pair and a `PreToolUse:Bash` hook pair (this
  project's `scripts/guard-bash.mjs`, matcher `Bash|PowerShell`), both with `"outcome":"success"`,
  `"exit_code":0`.

This project's own `.claude/settings.json` configures only `PreToolUse` and `SessionStart`
hooks, so `Stop`, `SessionEnd`, `PostToolUse`, `Notification`, and `PreCompact` could not be
live-confirmed the same way without adding a hook to a file outside this research's stated
scope — those five rest on the docs text only, flagged below as such.

**Common payload fields**, previously verified verbatim against `code.claude.com/docs/en/hooks`
in `docs/research/2026-09-03-anthropic-sdlc.md` §3 (not re-derived here, cited forward): every
hook receives `session_id`, `prompt_id`, `transcript_path`, `cwd`, `permission_mode`,
`effort.level`, `hook_event_name` on stdin, plus `agent_id`/`agent_type` for a subagent. A fresh
fetch this session additionally surfaced a literal `SessionStart` JSON example from the docs
page: `{"session_id","transcript_path","cwd","permission_mode":"default","hook_event_name":
"SessionStart","model":"claude-opus-5","startup_type":"startup"}` — i.e. `SessionStart` also
reports `model` and a `startup_type` (matcher value, e.g. `"startup"` vs `"resume"`/`"clear"`
per the matcher list already logged in the prior research).

For `Stop`, `SessionEnd`, `PostToolUse`, `Notification`, `PreCompact` specifically: this
session's docs fetch for exact per-event JSON examples was answered by a small-model summary of
the (very large) hooks page rather than a verbatim quote for each — flagged rather than
presented as fact. What the summary reported, to be treated as **unverified paraphrase, not
quote**, for those five: `PostToolUse` additionally carries `tool_name`, `tool_input`,
`tool_use_id`, `tool_output`; `SessionEnd` additionally carries `exit_reason` (one of
`clear|resume|logout|prompt_input_exit|other`); `Notification` additionally carries
`notification_type` and `notification_data`; `PreCompact` additionally carries `trigger`
(`manual|auto`). None of these four extra-field claims were confirmed against a verbatim doc
quote or a live payload in this session — **stated as reported-but-unverified**, not as fact.

**Whether these five fire under `-p`:** the docs describe each event's trigger condition
(`Stop`: "When Claude finishes responding"; `SessionEnd`: "When a session terminates";
`PostToolUse`: "After a tool call succeeds"; etc.) with **no interactive-only qualifier attached
to any of them** in what this session could fetch — but this session did not find one explicit
sentence stating "fires in `-p` mode" for these five either. Given that `SessionStart`,
`UserPromptSubmit`, and `PreToolUse` all demonstrably fire under `-p` on this machine, and
`docs/en/headless`'s own SIGTERM section says an in-flight `-p` shutdown "runs `SessionEnd`
hooks and exits" (naming `SessionEnd` by name as something a `-p` process runs), it is reasonable
to expect the remaining four also fire under `-p` — but that is this document's inference from
adjacent evidence, not a verbatim doc statement or a direct observation, and is flagged as such
rather than asserted as confirmed fact.

**Can a hook write a file a parent tails?** Yes, and this is squarely what
`transcript_path` and `SessionEnd` are for, per `code.claude.com/docs/en/sessions`: "React to
session events: read the `transcript_path` field that hooks... receive as input. A `SessionEnd`
hook can archive the transcript when a session ends." A hook is an ordinary child process with
its own stdin/stdout/exit code (`docs/en/hooks`, cited fully in the prior research's §3) — it can
write to any file its own permissions allow, including one path a parent Node process watches
(e.g. `fs.watch` or a poll loop), with nothing Claude-Code-specific required to make that work:
the hook process and the supervising Node script are just two unrelated OS processes sharing a
filesystem.

---

## 6. `--resume <session_id>` / `--continue`, and killed-mid-flight recovery

**How the parent learns the `session_id`:** confirmed live — the `system/init` event's top-level
`session_id` field is present on line 1 of every `stream-json` capture in this session (e.g.
`"session_id":"fdbd4997-39b4-455e-bec4-ded5dd60cc7b"`), and it is also present on the terminal
`result` event, and on every `assistant`/`user`/`stream_event` line in between. `docs/en/headless`
documents the same pattern for scripting: `session_id=$(claude -p "Start a review"
--output-format json | jq -r '.session_id')` then `claude -p "Continue that review" --resume
"$session_id"`.

**Resuming a session killed mid-flight — documented explicitly, and load-bearing for a
resilience design:** `code.claude.com/docs/en/sessions`, "What a resumed session restores":

> "A tool that was still running when the previous process ended, for example in a crash,
> doesn't finish or run again when you resume; Claude continues without its output."

This is the single most important resilience fact in this research. It means a supervising
script cannot assume a resumed session picks up a truncated tool call — the tool result for
whatever was running at kill-time is simply absent from context, and the model proceeds without
it. Conversation history, model, agent, and (with caveats) permission mode are restored;
`--mcp-config`, `--settings`, `--plugin-dir`, `--fallback-model`, and `--add-dir` are **not**
restored and must be passed again on resume.

**Permission-mode-on-resume for a headless run specifically:** per the same page's table, a
`claude -p --resume`/`claude -p --continue` run does **not** restore the permission mode the
killed session was in — "Claude Code starts the run in the permission mode a new `claude -p` run
would start in" — except a session that ended in `plan` mode, which resumes in `plan` mode only
under four conjunctive conditions (`--permission-prompt-tool` passed, no `--permission-mode`/
`--dangerously-skip-permissions`, no `--fork-session`, not started through channels). A
supervisor that killed a run mid-permission-prompt should not assume the resumed run continues
under the same relaxed mode it was launched with unless it re-passes the same flags.

**`--continue` vs `--resume` scope, live-confirmed against `--help` and cross-checked against
docs:** `claude --help`'s own text: `-c, --continue: Continue the most recent conversation in
the current directory`. Docs add the exclusion `claude -p` and Agent SDK and `/loop`-first-prompt
sessions are skipped by plain `--continue`, but **`claude -p --continue` includes them** — so a
Node supervisor re-invoking with `-p --continue` does pick up its own prior `-p` runs, which
`claude --continue` alone would not.

**SIGTERM's interaction with resume**, from `docs/en/headless`: "When you resume the session,
Claude Code continues the turn that SIGTERM left unfinished" — i.e. resume doesn't just replay
history, it re-drives the turn that was cut off, modulo the tool-output-loss caveat above.

---

## 7. Per-invocation timeout / idle-timeout / max-turns

**`--max-turns` exists, works, and is documented — but is absent from this machine's own
`claude --help` and `claude -p --help` output.** This is a direct docs-vs-binary discrepancy
worth flagging on its own: `code.claude.com/docs/en/cli-reference` documents it verbatim:

> "Limit the number of agentic turns (print mode only). Exits with an error when the limit is
> reached. No limit by default. With `--input-format stream-json`, a message still queued when
> the limit ends a turn stays queued and starts a new turn with its own limit."

but grepping this session's full captured `claude --help` and `claude -p --help` text for
`max-turns`, `turns`, `timeout`, or `idle` returned **nothing** — the flag simply isn't listed.
Live-tested anyway: `claude -p ... --max-turns 1` was accepted (no "unknown option" error) and
behaved exactly as documented — see §1/§4's `error_max_turns` result. **Conclusion: `--max-turns`
is a real, working, documented flag that this installed version's own `--help` text omits.**
Whether that's a deliberate "advanced/undocumented-in-help" flag or a `--help` regression isn't
stated anywhere this research found — flagged as an open discrepancy, not resolved.

**No per-invocation wall-clock timeout or idle-timeout flag exists for the whole run** — none
appeared in `--help`, and no such flag is named on the fetched `cli-reference`/`headless` pages.
What *is* documented are narrower, mechanism-specific waits, none of which bound the total
runtime of a `claude -p` call:

- **`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`** (default 10 minutes) — bounds how long `claude -p`
  waits, after Claude's own final result, for a background subagent/workflow it started to
  finish; "At that point Claude Code stops whatever is still running and drops its partial
  result." Set to `0` to wait without a ceiling.
- **`MCP_TIMEOUT`** (default 30s) — how long `-p` waits at startup for still-pending
  `--mcp-config` servers before running the first turn.
- **A Monitor watch** started during a `-p` run times out after 5 minutes by default, or the
  10-minute background-wait ceiling above, whichever comes first.
- Background Bash tasks (e.g. a dev server) get a fixed ~5-second grace period after the final
  result before Claude Code kills them.

**Conclusion, stated plainly: a supervising Node script must impose its own overall timeout**
(e.g. `child_process`'s own `timeout`/`killSignal` option, or an external watchdog sending
SIGTERM/SIGINT) — Claude Code documents no flag that bounds total `-p` wall-clock time on its
own. `--max-turns` bounds agentic *turns*, not wall-clock time, and is the only budget knob found
besides `--max-budget-usd` (documented in `claude --help`: "Maximum dollar amount to spend on API
calls (only works with --print)" — a spend ceiling, not a time ceiling).

---

## 8. Windows: spawning `claude` from Node without a shell

**This machine's own install is a genuine native `.exe`, not a Node/npm shim** — checked
directly: `where claude` resolves to `C:\Users\roton\.local\bin\claude.exe`, a 221MB
Authenticode-signed binary (per `docs/en/setup`, "Windows: signed by 'Anthropic, PBC'. Verify
with `Get-AuthenticodeSignature .\claude.exe`") installed by the native installer
(`irm https://claude.ai/install.ps1 | iex`), not npm — this session has no
`@anthropic-ai/claude-code` under the npm global `node_modules` at all.

**The npm path installs the identical binary, not a Node-invoking wrapper** — `code.claude.com/docs/en/setup`,
"Install with npm," verbatim: "The npm package installs the same native binary as the standalone
installer. npm pulls the binary in through a per-platform optional dependency such as
`@anthropic-ai/claude-code-darwin-arm64`, and a postinstall step links it into place. **The
installed `claude` binary does not itself invoke Node.**" Confirmed independently against the
package's own published manifest (`unpkg.com/@anthropic-ai/claude-code/package.json`, fetched
this session): `"bin": {"claude": "bin/claude.exe"}`, `"optionalDependencies"` listing
`@anthropic-ai/claude-code-win32-x64`/`-win32-arm64` among the platform packages, and a
`postinstall: "node install.cjs"` script that presumably places the right platform binary at
that path. The `bin` field literally names a `.exe` target, on every platform's package.json —
i.e. even the field npm reads to link a `claude` command points at a native executable, not a
`.js` entry point.

**CVE-2024-27980, precisely, per Node.js's own security advisory** (`nodejs.org/en/blog/vulnerability/april-2024-security-releases-2`):
the vulnerability is that "due to the improper handling of batch files in `child_process.spawn` /
`child_process.spawnSync`, a malicious command line argument can inject arbitrary commands and
achieve code execution even if the shell option is not enabled" — but **only when the spawned
target itself is a `.bat` or `.cmd` file** on Windows. The fix makes Node's `spawn`/`spawnSync`
throw `EINVAL` if a `.bat`/`.cmd` target is passed without `{shell: true}`, forcing the caller to
either opt into `shell: true` (with the injection risk that implies for unsanitized args) or
spawn `cmd.exe` directly. Node's own `child_process` docs (`nodejs.org/api/child_process.html`)
state the underlying reason: "On Windows, `.bat` and `.cmd` files are not executable on their own
without a terminal, and therefore cannot be launched using `child_process.execFile()`" — the
whole CVE class is specific to batch-file targets needing `cmd.exe` as an intermediary parser.

**Conclusion for this question: CVE-2024-27980 does not apply to spawning `claude` on Windows,
because the target is a `.exe`, not a `.bat`/`.cmd`.** `execFileSync`/`spawnSync` with
`shell: false` against a `.exe` target go straight to Windows `CreateProcess` with no `cmd.exe`
parsing step in between, so there is no batch-file argument-injection surface for the CVE's fix
to guard against, and no `EINVAL` guard to trip. This holds whether the caller resolves the
native-installer's `~/.local/bin/claude.exe` or npm's linked `bin/claude.exe` — both are the same
kind of artifact per the docs quote above.

**The one real, separate Windows gotcha this research can state only as inference, not as a
documented Claude Code fact:** Windows' `CreateProcess` (what Node's non-shell `spawn` calls)
does not perform the `PATHEXT`-based extension search that `cmd.exe` does for a bare command name
— that resolution is a `cmd.exe`/shell behavior, not something `CreateProcess` does on its own.
Practically, this means spawning the **bare string `"claude"`** with `shell: false` may fail to
resolve depending on how Node's `child_process` module resolves the executable on this platform,
whereas spawning the **fully-qualified path with its `.exe` extension**
(`C:\Users\<user>\.local\bin\claude.exe`, discoverable the way this session did it —
`where claude` / PowerShell's `Get-Command claude`) is unambiguous and needs no shell. **This
specific claim is this document's own reasoning from Node's and Windows' documented behavior, not
a sentence found in Claude Code's own docs** — flagged as inference per the instruction to
distinguish that from a sourced fact. The reliable spawn form, combining what is and isn't
documented: resolve the absolute path once (`where`/`Get-Command`), then
`execFileSync(resolvedPath, args, { shell: false })`.

---

## 9. Not found / explicitly undocumented

Collected here rather than scattered, per this task's standard: things a design could easily
assume exist, that this research checked for directly and did not find documented.

- **No documented way to get a live human-readable console AND stream-json from one invocation**
  (§3) — the docs' own answer is "parse the JSON and build your own view," not a dual-channel
  flag.
- **No documented enumerated exit-code table for `claude -p`** beyond 0/non-zero and the one
  named case (143, SIGTERM) (§4). Failure *kind* lives in the JSON result, not the exit code.
- **No documented complete `subtype` enum** for the `result` event — only `success` and
  `error_max_turns` are confirmed (one live, one live-forced); nothing enumerates the full set
  (§1, §7).
- **No verbatim-quoted JSON payload example for `Stop`, `SessionEnd`, `PostToolUse`,
  `Notification`, or `PreCompact`** was obtained in this session (only a small-model paraphrase,
  flagged as such) (§5) — and none of the five was live-fired in this repo's own configuration,
  so "fires under `-p`" for those five rests on inference from adjacent documented/observed
  behavior, not a direct quote or a direct observation.
- **No per-invocation wall-clock or idle timeout flag** — only turn-count (`--max-turns`),
  spend (`--max-budget-usd`), and several narrower mechanism-specific waits exist (§7).
- **`--max-turns` is documented on the website but missing from this version's own `--help`
  output** — an unreconciled discrepancy between the docs and the installed binary, not
  something this research can explain from the sources available (§7).
- **The Windows `PATHEXT`/bare-name spawn-resolution behavior is not addressed by any Claude
  Code doc** — it's general Node/Windows platform behavior, cited here only as this document's
  own inference (§8).
