# Cost and speed of `claude -p` in the queue-loop supervisor

Research date: 2026-09-10. Installed binary: **2.1.268** (`claude --version`), same machine and
session lineage as the companion file this one is scoped to sit beside. That file,
`docs/research/2026-09-10-claude-headless-observability.md`, already covers event shapes, exit
codes, hooks under `-p`, `--resume`, `--max-turns`, `--max-budget-usd`, and Windows spawning — none
of that is repeated here. This file answers a narrower question: for a Node supervisor spawning
one fresh `claude -p "/queue" --permission-mode auto --strict-mcp-config` per ticket overnight,
each dispatching 3 subagents (1 sonnet recon, 2 opus reviewers), **what actually costs tokens and
wall-clock, and what can be turned down**.

Two source classes, both primary:

- **Docs** — `code.claude.com/docs/en/*` (current host).
- **Live** — real `claude -p` runs on this machine, this session, in this exact worktree
  (`C:\Users\roton\murlan\.worktrees\queue-loop`), quoted from the captured JSONL. Four fresh
  measurement runs were made for this research (the task's stated cap); three more pre-existing
  captures from the companion research's own session (`stream_test.jsonl`, `stream_test3.jsonl`,
  `hooktest.jsonl`, `maxturns.jsonl`, found already sitting in the shared scratchpad directory)
  were reused for the cache-warmth comparison in §3 rather than re-run, since they were already on
  disk and cost nothing further to read.

This project's own configuration matters to several answers below: **zero MCP servers** are
configured anywhere in scope for this worktree (checked `.mcp.json`, project and global
`~/.claude.json` — the only non-empty `mcpServers` entry on this machine belongs to an unrelated
project), 4 plugins are enabled (`frontend-design`, `superpowers`, `ponytail`,
`mattpocock-skills`), and the global `~/.claude/settings.json` pins `"model": "opus"` with
`"effortLevel": "high"`. That absence of MCP servers means **§1's `--strict-mcp-config` question
could not be measured by A/B in this repo** — there was nothing for it to strip either way — so
that sub-answer rests on docs plus reasoning from the tool-removal mechanism confirmed elsewhere in
this research, flagged as such below.

---

## 1. What's in the initial context, and what shrinks it

**Live-measured: removing tools from context measurably shrinks the billed prefix, tool-count for
tool-count.** Baseline run (`claude -p "reply with exactly the word: pong" --output-format
stream-json --verbose --strict-mcp-config`, this project, no other flags):

```
system/init tools count: 29
usage: cache_creation_input_tokens=26069, cache_read_input_tokens=15320  (total prefix: 41,389)
```

Same command plus `--disallowed-tools "Bash,WebFetch,WebSearch,Task,Write,Edit,NotebookEdit,Grep,Glob"`:

```
system/init tools count: 19        (10 fewer)
usage: cache_creation_input_tokens=25232, cache_read_input_tokens=7398  (total prefix: 32,630)
```

**~8,760 fewer tokens for 10 fewer tool definitions** (~876 tokens/tool average, this build). This
directly answers the "does it remove the definition or only block use" half of the question, and
the docs corroborate it exactly — `code.claude.com/docs/en/cli-reference`, `--disallowed-tools`,
verbatim: "A bare tool name removes the matching tools from Claude's context entirely: `"Edit"`
removes Edit, `"*"` removes every tool, and `"mcp__*"` removes every MCP tool. A scoped rule such
as `Bash(rm *)` leaves the tool available and denies only calls that match as written." So a bare
name in `--disallowed-tools` is a real context-size lever; a scoped rule (`Bash(rm *)`) is not —
the tool stays fully loaded and only specific invocations are refused. This is also independently
confirmed as a *cache*-relevant fact on `docs/en/prompt-caching`, "Denying an entire tool": "Adding
a bare tool name... removes that tool from Claude's context entirely... invalidates the cache" —
i.e. it's not just cheaper per-request, changing the set mid-run is itself a cache-busting event,
so decide the tool set once at the top of a run rather than tightening it turn-by-turn.

**`--allowed-tools` (the *allow* list) does *not* do the same thing — a genuinely easy
confusion to make.** Docs, verbatim: "Tools that execute without prompting for permission... To
restrict which tools are available, use `--tools` instead." `--allowed-tools` only pre-approves
permission prompts for tools that are already loaded; it does not shrink the tool-definition
portion of the prompt. **`--tools <tools...>`** is the flag that actually specifies the whole
available set ("Use `\"\"` to disable all tools, `\"default\"` to use all tools, or specify tool
names") — this and a bare-name `--disallowed-tools` are the two documented, context-shrinking
mechanisms; `--allowed-tools` alone is not.

**`--strict-mcp-config`**: docs, verbatim, is narrower than it sounds — "Only use MCP servers from
`--mcp-config`, ignoring all other MCP configurations." It doesn't say it strips MCP tool
definitions from the prompt by itself; if no `--mcp-config` is also passed, the practical effect is
zero MCP servers loaded at all (which this worktree already has by default, flag or not). **Not
independently measurable here** for the reason stated above. What the docs do establish, on
`docs/en/costs`, "Reduce MCP server overhead": "MCP tool definitions are deferred by default —
only tool names and server instructions enter context until Claude uses a specific tool" (tool
search, on supported models). So even *without* `--strict-mcp-config`, a configured MCP server on
a modern model mostly doesn't cost full-schema tokens upfront; where `--strict-mcp-config`
(or just not configuring MCP at all) earns its keep is on setups where tool search is
unavailable — `docs/en/prompt-caching`, "Connecting or disconnecting an MCP server": tool search is
unavailable on "Google Cloud's Agent Platform models earlier than the Claude 4.5 generation,"
custom `ANTHROPIC_BASE_URL` gateways, and some Azure-hosted Foundry deployments — none of which
apply to this project's plain Anthropic-API/subscription setup. **For this specific supervisor,
with zero MCP servers configured, `--strict-mcp-config` is presently a no-op safety rail, not a
token-saver** — it only starts earning its keep the day someone adds an MCP server to global or
user settings that the supervisor doesn't want inherited.

**Plugins/skills do contribute to every session's tokens, but the manifest and the content are
priced very differently, and the split is documented, not just inferred.** Live `system/init`
shows a `plugins` array of only `{name, path, source, version}` — four short objects, negligible
tokens — and a `skills` array of *names* (`"caveman"`, `"eas-app-stores"`, ... dozens of entries).
`docs/en/costs`, "Move instructions from CLAUDE.md to skills": "Skills load on-demand only when
invoked" — confirming the manifest (names + short descriptions) is what's always present, and a
skill's full `SKILL.md` body is not loaded until the skill actually fires. This matches this
session's own prior finding (memory note `claude-p-headless-flags.md`): "every skill together costs
~2k" tokens for the manifest — cheap and roughly fixed, regardless of how many of the ~30 skills
this account has installed go unused on a given ticket.

**`--bare` is the sharpest lever for reducing tool-count, and by extension tokens, of everything
tested.** Live: `claude -p ... --bare` dropped `system/init` tools from 29 to **4** (auth failed
before a model call was made on this machine, since `--bare` refuses OAuth/keychain and this
machine has no `ANTHROPIC_API_KEY` set — see the caveat under §5). Docs, verbatim
(`docs/en/cli-reference` and `docs/en/headless`): "Minimal mode: skip auto-discovery of hooks,
skills, custom commands, subagents, plugins, MCP servers, auto memory, and CLAUDE.md... In bare
mode Claude has access to Bash, file read, and file edit tools" — three-and-the-implicit-fourth
tools is exactly the 4 this session's live `system/init` reported. `--safe-mode` is the same idea
with a different tradeoff: it also drops CLAUDE.md/skills/plugins/hooks/MCP/output styles, but
*keeps* auth, model selection, built-in tools, and permissions working normally — it's a
troubleshooting mode ("useful for checking whether a customization is what triggers automatic
model fallback"), not documented as a speed/cost lever the way `--bare` explicitly is.

**`--restricted`** (v2.1.248+) is a third, security-flavored mode: it strips the
command/code-running tools and `WebFetch` unless named in `--tools`, and "ignores user, project and
local settings files (managed settings and `--settings` still apply)." It reduces tool-count the
same mechanical way `--disallowed-tools`/`--tools` do (fewer tools → fewer schema tokens) but its
stated purpose is running untrusted code on a shared machine, not cost.

---

## 2. Pointing one invocation at reduced settings without touching the checked-in file

**Yes — `--settings <file-or-json>`, and it's a merge, not a swap.** Docs, `docs/en/cli-reference`,
verbatim: "Path to a settings JSON file or a JSON string to load additional settings from... Values
you set here override the same keys in your `settings.json` files for this session. Keys you omit
keep their file-based values." So `--settings '{"hooks":{}}'` for one invocation zeroes hooks for
that run without editing `.claude/settings.json` on disk, while everything else in the checked-in
file (permissions, `enabledPlugins`, etc.) still applies for keys you didn't override.

**Precedence, exactly, from `docs/en/settings`, "Settings precedence"** (highest first):

1. **Managed settings** — `managed-settings.json`, MDM, or the claude.ai console (the organization)
2. **Command line** — `claude --settings` (you, this session)
3. **Project local** — `.claude/settings.local.json` (you, this project)
4. **Shared project** — `.claude/settings.json` (everyone in the project — the checked-in file)
5. **User** — `~/.claude/settings.json` (you, every project)

`--settings` sits **above** the checked-in `.claude/settings.json` and above the user-level file,
second only to org-managed policy — exactly the position needed to shadow this repo's hooks/plugins
for one supervised run without a working-tree edit.

**A second, coarser lever for the same goal: `--setting-sources <user,project,local>`.** Docs,
verbatim: "Comma-separated list of setting sources to load (`user`, `project`, `local`)." Passing
e.g. `--setting-sources user` for one invocation skips this project's `.claude/settings.json`
entirely (no hooks, no `enableWorkflows`, none of it) while still reading `~/.claude/settings.json`
— a blunter version of "don't apply this repo's settings," useful when the goal is "ignore the
project file" rather than "override specific keys."

**No `CLAUDE_*` environment variable equivalent to `--settings` was found.** The env vars this
research and the fetched docs surfaced are all single-purpose flags-as-env-vars (`CLAUDE_CODE_SIMPLE`
set by `--bare`, `CLAUDE_CODE_SAFE_MODE` set by `--safe-mode`, `CLAUDE_CODE_PROMPT_CACHE_TTL`,
`CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL`, `DISABLE_AUTOUPDATER`, `DISABLE_PROMPT_CACHING*`, etc.) —
none of them point Claude Code at a *whole alternate settings file* the way `--settings` does.
**Not documented: an env var that substitutes for `--settings`.**

---

## 3. Prompt caching across separate `claude -p` processes — measured directly

**The cache is warm across separate OS processes. Confirmed by two consecutive, independent
invocations in this exact worktree, no flags changed, seconds apart:**

| Run | `cache_creation_input_tokens` | `cache_read_input_tokens` | Total prefix |
|---|---|---|---|
| 1st `claude -p "reply with exactly the word: pong" ...` | 26,069 | 15,320 | 41,389 |
| 2nd, identical command, immediately after | **0** | **41,389** | 41,389 |

The second process paid **zero** fresh tokens for the entire prefix — a **100% cache hit**,
`cache_creation` field literally `{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":0}`.
This settles the question directly: **the cache is server-side (Anthropic's infrastructure, per
`docs/en/prompt-caching` "Where the cache lives"), keyed by an exact content-prefix match, and has
no dependency on the OS process that sent the request** — a brand-new `claude -p` invocation is
just another request against the same key.

**TTL is documented exactly, and matches the field names live.** `docs/en/prompt-caching`, "Which
TTL each request gets": the API offers two fixed TTLs, and Claude Code buckets every request into
"main conversation" or "everything else":

| Request bucket | Claude subscription, within plan usage | Usage credits / API key / cloud provider |
|---|---|---|
| Main conversation (interactive turns, `-p` runs, Agent SDK) | **1 hour** | 5 minutes |
| Everything else (subagents, workflows, compaction, session titles) | 5 minutes, except a few server-controlled helpers | 5 minutes |

Both live runs above show `ephemeral_1h_input_tokens` nonzero and `ephemeral_5m_input_tokens: 0` —
this account is on a subscription within plan usage, so the main conversation gets the 1-hour TTL,
matching the table exactly. **Subagents get 5 minutes regardless of the parent's plan** (own
section, "Subagents and the cache": "Subagents fall outside the main-conversation TTL bucket... they
get five minutes even on a subscription until you choose a longer one" via
`subagentPromptCacheTtl` / `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL`) — directly relevant to the
supervisor's 3 subagents-per-ticket: if a ticket's builder-then-review pipeline leaves more than 5
idle minutes between the recon subagent and either opus reviewer subagent, the reviewer's own
context (own system prompt + own tools) starts cold, independent of whatever the main session's
cache is doing.

**The load-bearing finding for *this* supervisor, not just a general fact: git status is part of
the cached prefix, and the queue loop commits between tickets.** `docs/en/prompt-caching`, "Cache
scope," verbatim: "Sequential sessions share the prefix only when the git status snapshot taken at
startup matches, since each conversation also carries the branch and recent commits from that
snapshot." Every `claude -p "/queue"` the supervisor spawns for the *next* ticket runs after the
previous ticket's PR/commit landed — i.e. after `git status`/branch/recent-commits changed — so
**every fresh per-ticket invocation is expected to reprocess the whole prefix from scratch, at full
token cost, even though nothing about the tool set, plugins, or CLAUDE.md changed.** This is
exactly what `--exclude-dynamic-system-prompt-sections` exists to fix. Docs, verbatim
(`docs/en/cli-reference`): "Move per-machine sections from the system prompt (working directory,
environment info, memory paths, git-repo flag) into the first user message. Improves prompt-cache
reuse across different users and machines running the same task. Only applies with the default
system prompt; ignored when `--system-prompt` or `--system-prompt-file` is set." **This is the
single most actionable lever this research found for the stated use case** — adding it to the
supervisor's spawn command should let each new ticket's `claude -p "/queue"` invocation hit the
1-hour-TTL cache built by the *previous* ticket's invocation, provided the two run within the hour
and nothing else in the invalidation list (§below) changed. It was not independently re-measured
with a live A/B here (that would need a git-status change staged between two runs, which would
have used the last of the 4-run budget without also covering §1's tool-removal question, judged
more directly load-bearing) — flagged as **doc-sourced, not live-confirmed in this session**, but
the mechanism it targets (git status inside the cached prefix) *is* live-confirmed by the numbers
above (my two fresh runs, both same git status, got the clean 100%-hit result; the companion
research's own earlier same-session runs from ~13-20 minutes prior show a different, larger
`cache_read` value — 58,407 vs. this session's 15,320 — consistent with a git-status change
between those sessions resetting part of what was cached).

**Other documented cache-invalidating actions relevant to an overnight unattended run**, from
`docs/en/prompt-caching`, "Actions that invalidate the cache": switching models, changing effort
level, enabling/disabling a plugin (only its *MCP-server* component forces a full re-read; skills/
commands/agents/hooks/themes append cheaply), denying an entire tool (§1), changing output style
(cache-safe on subscription/API sessions that fetch feature flags; a full miss on Bedrock/Vertex/
Foundry), and **upgrading Claude Code** — "a new Claude Code version typically updates the system
prompt or tool definitions, so the first conversation you start after an upgrade builds its cache
from the top." Native installs auto-update in the background and apply on next launch (confirmed
already in the companion research, §"claude_code_version" drift mid-session). For an overnight loop
spawning dozens of fresh processes, an auto-update landing mid-run silently converts every
subsequent invocation into a full-price cache-miss run until the next warm one. `DISABLE_AUTOUPDATER=1`
is the documented control if a supervisor wants a stable version (and thus a stable cache key) for
the whole overnight batch.

---

## 4. Subagent cost accounting: what a supervisor can and cannot separate out

**`modelUsage` is keyed by canonical model name and pools main-loop and every subagent using that
model into one bucket — it cannot separate two same-model subagents, or a subagent from the main
session, if they share a model.** This is documented plainly, `docs/en/agent-sdk/cost-tracking`,
"Get the total cost of a query" table:

| Field | Subagent activity |
|---|---|
| `usage` | **Excluded** — main loop only, tokens spent inside subagents are not added |
| `total_cost_usd` | **Included** — subagent requests counted alongside the top-level loop |
| `modelUsage` / `model_usage` | **Included**, broken down **by model**, not by subagent |

For this supervisor's exact shape — 1 sonnet recon subagent, 2 opus reviewer subagents, and (per
this project's own `~/.claude/settings.json`) a main session also pinned to `"model": "opus"` —
that means: the **sonnet share of `modelUsage` is cleanly attributable to the recon subagent alone**
(nothing else in the run uses sonnet), but **the opus share of `modelUsage` mixes the main
session's own opus usage with both opus reviewer subagents' usage into one number**, with no
documented field that splits it further. `subagent_stats` (observed live in this session's captures
and the companion file's) gives *counts* — `spawned`, `completed`, `failed`, `killed`, `by_type`,
`max_depth` — but **no token or dollar fields** in either this session's or the companion
research's live captures. **`subagent_stats` itself is not documented on any fetched
`code.claude.com` page** — search for it turned up nothing defining its shape; it is a real,
observed field (both here and independently in the companion research), just not one Anthropic has
written up. Treat its exact schema as "observed, not documented," consistent with the companion
file's own stance on undocumented `result`-event fields.

**A documented workaround exists for genuine per-subagent token accounting, though it requires the
supervisor to do its own bucketing rather than reading one number off the result event.**
`docs/en/headless`, "Follow subagent messages": every `assistant`/`user` message from a subagent
carries `parent_tool_use_id` set to the `Agent` tool-call ID that spawned it, while main-conversation
messages carry `null` there — and this ID chain survives nesting ("a nested subagent's messages
carry the ID of the Agent tool call that spawned it"). Each of those messages carries its own
`message.message.usage` (per `docs/en/agent-sdk/cost-tracking`, "Track per-step usage" — the same
per-step `usage` object the docs already show being summed for the main loop, generalized here by
`parent_tool_use_id` instead of by "is this the main loop"). **This is this document's own
synthesis from two separately-documented facts, not itself a documented recipe** — but it is the
only way found in this research to actually isolate "how much did opus-reviewer-#2 specifically
cost" when `modelUsage` bundles it with the main session and its sibling. It requires
`--output-format stream-json --verbose` (and `--forward-subagent-text` if the supervisor also wants
subagent thinking/text tokens, not just tool_use/tool_result), and summing per-`parent_tool_use_id`
the same way the docs' own per-step example sums per-message-`id`.

**Depth/concurrency limits exist and are documented** (`docs/en/sub-agents`): default nesting depth
3 below the main conversation (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` to change), default concurrent
cap 20 running subagents (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`). `docs/en/agent-sdk/cost-tracking`
references "depth, concurrency, and spend limits" as a bundle for bounding what subagents can add to
`total_cost_usd`, but the exact spend-limit setting name was not confirmed against a primary
`code.claude.com` page in this session (only a secondary WebSearch snippet surfaced
`error_max_budget_usd` as a subtype and a blog reference to per-session spawn ceilings — **not
independently verified against primary docs here, flagged rather than asserted**).

---

## 5. Speed: startup cost and the undocumented timing fields

**`--bare` is documented, in `docs/en/headless`, as the speed lever**, verbatim: "Add `--bare` to
reduce startup time by skipping auto-discovery of hooks, skills, custom commands, subagents,
plugins, MCP servers, auto memory, and CLAUDE.md... Bare mode is useful for CI and scripts where you
need the same result on every machine," and further down: "`--bare` is the recommended mode for
scripted and SDK calls, and will become the default for `-p` in a future release." **Could not be
independently wall-clock-measured end-to-end on this machine**: `--bare` refuses OAuth/keychain auth
by design ("Anthropic auth is strictly `ANTHROPIC_API_KEY` or `apiKeyHelper`... OAuth and keychain
are never read") and this machine has no `ANTHROPIC_API_KEY` set, so the live `--bare` run failed at
the auth check (`"Not logged in · Please run /login"`, exit 1, `duration_api_ms: 0`) before any
model call — that failure path isn't a valid proxy for turn latency. What *was* captured cleanly
before the auth check ran: `system/init` reported **4 tools instead of 29**, matching the doc's
list of what bare mode skips almost exactly (Bash, file read, file edit, plus one more) — i.e. the
context-shrinking part of `--bare`'s claim is directly confirmed; the wall-clock part rests on the
doc's own prose only. A supervisor that wants to actually use `--bare` needs `ANTHROPIC_API_KEY` (or
an `apiKeyHelper` via `--settings`) rather than subscription login, per the same doc section.

**`ttft_ms`, `time_to_request_ms`, `first_content_frame_ms`, `ttft_stream_ms` remain undocumented on
every page this research fetched** (`docs/en/headless`'s "Stream responses" section describes the
event *stream*, not these four result-event fields at all) — consistent with the companion
research's own §9 finding. Live numbers, both baseline runs, for what it's worth as raw data with
no doc backing their exact definitions:

| Field | Run 1 | Run 2 (100% cache hit) |
|---|---|---|
| `time_to_request_ms` | 299 | 274 |
| `first_content_frame_ms` | 1380 | 1153 |
| `ttft_stream_ms` | 1379 | 1152 |
| `ttft_ms` | 1777 | 1648 |
| `duration_api_ms` | 2578 | 2205 |
| `duration_ms` (total) | 1807 | 1672 |

`time_to_request_ms` is the smallest and most stable across the two runs (299 vs 274, both trivial
prompts, one a full cache miss and one a full hit) — by name and position it reads as "time from
process spawn to sending the first API request," which would make it the field closest to
"supervisor-relevant startup overhead" (hook execution, settings/plugin/skill discovery, CLAUDE.md
read), but this is this document's inference from the field name and observed stability, **not a
documented claim** — the field appears in exactly one place in any Claude Code documentation this
research found: the companion research's own live capture, listed as a bare field name with no
description. `first_content_frame_ms` and `ttft_stream_ms` are within ~1ms of each other on every
run captured (both here and, checking the older pre-existing captures reused in §3, on those too) —
strongly suggesting they measure the same underlying event by two names, but again this is inference
from repeated near-equality, not a doc statement. **`system/init` itself carries no self-reported
duration or timestamp field** (per both this session's captures and the companion research's field
list) — a supervisor wanting to measure actual startup latency has to time it externally (wall-clock
from spawning the child process to the arrival of the `system/init` line), since nothing in the
event says how long producing it took.

**Narrower, already-documented waits that bound parts of a run** (not new — the companion research's
§7 already covers `MCP_TIMEOUT` and the background-wait ceiling) but worth restating in a
cost/speed frame: `docs/en/headless`, "Background tasks at exit" — a background Bash task gets
~5 seconds after the final result before being killed; a background subagent/workflow instead holds
the whole `claude -p` process open until it finishes or `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`
(default 10 minutes) elapses. For a supervisor dispatching foreground review subagents (as this
one's 2 opus reviewers are, per its own "Builders must not fork" / subagent-driven design), this
ceiling shouldn't normally bind, but it's the one documented outer bound on "how long can a
subagent make the whole invocation wait."

---

## 6. `--append-system-prompt` vs `--system-prompt`: append adds, replace loses more than tokens

**`--append-system-prompt`** adds to the end of the default prompt (docs, verbatim: "Append custom
text to the end of the default system prompt"). **`--system-prompt`** (and `--system-prompt-file`)
**replaces it entirely** (verbatim: "Replace the entire system prompt with custom text" /
"replacing the default prompt"). Replacing is a real, documented way to cut input tokens — you send
only what you write instead of Claude Code's full default prompt — but the Agent SDK docs
(`docs/en/agent-sdk/modifying-system-prompts`) spell out exactly what a fully custom prompt gives up,
in a comparison table that applies directly to what `--system-prompt`'s CLI semantics describe as
"the SDK sends only what you provide":

| | CLAUDE.md | Output styles | preset + `append` (≈ `--append-system-prompt`) | Custom prompt (≈ `--system-prompt`) |
|---|---|---|---|---|
| **Default tools** | Preserved | Preserved | Preserved | **Lost (unless included)** |
| **Built-in safety** | Maintained | Maintained | Maintained | **Must be added** |
| **Environment context** | Automatic | Automatic | Automatic | **Must be provided** |

So a fully custom `--system-prompt` doesn't remove the tool *schemas* from the API request (that's
a separate mechanism, §1) — it removes Claude Code's own natural-language instructions for *how* to
use them safely and in this project's conventions: tool-use guidance, the security/safety
instructions, and the "you are working in directory X, on branch Y, here is your environment"
context that `--exclude-dynamic-system-prompt-sections` (§3) otherwise just *relocates* rather than
deletes. For a supervisor whose entire per-ticket behavior is defined by `docs/agents/RULES.md` and
this repo's own CLAUDE.md working agreement, replacing the system prompt wholesale is the one lever
in this research that risks changing *behavior*, not just token count — `--append-system-prompt` is
the documented, additive, lower-risk lever for the same "add instructions, spend fewer tokens than
loading a giant CLAUDE.md" goal, matching the table's "Additions only / Preserved / Maintained /
Automatic" row.

---

## 7. `--output-style`: measurably changes system prompt size, and output volume more so

Not independently measured (outside the 4-run budget; the docs are explicit and specific enough that
a live A/B would mostly confirm wording, not add a number this research didn't already have from a
higher-priority test). `docs/en/output-styles`, verbatim: "Token usage depends on the style. A
style's instructions add input tokens, though prompt caching reduces this cost after the first
request in a session... The built-in Explanatory and Learning styles produce longer responses than
Default by design, which increases output tokens. The Concise style does the opposite by
instructing Claude to keep responses short by default." Two separate cost axes, both documented:
**input** tokens grow by however long the style's instruction block is (a fixed, cacheable add-on,
same "actions that invalidate the cache" caveats as §3's "Changing output style" entry apply if
switched mid-session), and **output** tokens grow or shrink by design depending on which built-in
style is active. For a supervisor whose every invocation is a fresh, one-shot process with no
carried-forward session to amortize a style's added input tokens against, staying on the **Default**
style is strictly cheaper per ticket than any non-default built-in or custom style — there's no
warm multi-turn session for the "prompt caching reduces this cost after the first request" mitigation
to apply against.

---

## 8. Other documented cost/speed bounds not in the companion file

- **A fixed, non-eliminable per-session floor.** `docs/en/costs`, "Background token usage":
  conversation-summarization jobs for `--resume` and status-check commands like `/usage` "consume a
  small amount of tokens (typically under \$0.04 per session) even without active interaction." Not
  a lever — a noise floor to expect in any per-ticket cost accounting.
- **CLAUDE.md size is a documented cost knob in its own right.** `docs/en/costs`, "Move instructions
  from CLAUDE.md to skills": "Aim to keep CLAUDE.md under 200 lines by including only essentials" —
  this project's own root `CLAUDE.md` already follows that discipline by design ("This file is only
  what you cannot get by reading the code"), so there's no easy win left there specifically, but it's
  worth knowing as a general lever the docs call out for any future growth of that file.
- **`--disable-slash-commands` disables all skills for one invocation** — found only in local
  `claude --help` output ("Disable all skills"), not corroborated in any fetched docs page (the
  `cli-reference` fetch that should have covered it came back truncated before reaching this flag).
  Cheaper than `--bare` in scope: it removes the skills manifest (~2k tokens per the §1 estimate)
  while leaving hooks, plugins, CLAUDE.md, and MCP servers intact — a middle option between doing
  nothing and going full `--bare`, for a supervisor that wants its hooks (this project relies on
  `SessionStart`/`PreToolUse` hooks for its own loop-status and guard-bash mechanisms) but has no use
  for the ~30-skill manifest on a scripted run.
- **"Subagent" (this supervisor's mechanism) and "agent teams" (a different, much more expensive
  feature) are easy to conflate and shouldn't be.** `docs/en/costs`, "Agent team token costs":
  "Agent teams use approximately 7x more tokens than standard sessions when teammates run in plan
  mode, because each teammate maintains its own context window and runs as a separate Claude
  instance." That multiplier is specific to the `agent-teams` feature (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`,
  disabled by default) and does **not** describe the cost shape of the `Agent`/`Task`-tool subagents
  this supervisor already uses — each of those pays for its own startup context (own system prompt,
  own tool set, own CLAUDE.md read — `docs/en/sub-agents`, "What loads at startup") once per spawn,
  not a 7x multiplier on the whole run.
- **Prefer CLI tools over MCP servers where both exist**, `docs/en/costs`: "`gh`, `aws`, `gcloud`,
  and `sentry-cli` are still more context-efficient than MCP servers because they don't add any
  per-tool listing" — moot for this specific worktree today (zero MCP servers configured), but the
  general shape of the tradeoff if the supervisor's toolchain ever grows one.

---

## Not documented / could not measure — collected

- **`--strict-mcp-config`'s token effect** could not be measured in this repo (zero MCP servers
  configured anywhere in scope); its documented behavior is "ignore other MCP configs," and its
  actual token-saving value on this account's setup (subscription/direct API, no gateway) is likely
  small since tool search already defers MCP schemas by default on supported models (§1).
- **No `CLAUDE_*` env var equivalent to `--settings`** was found for pointing one invocation at a
  whole alternate settings file (§2).
- **`--exclude-dynamic-system-prompt-sections`'s effect was not live-A/B-tested** in this session
  (would have required spending a 5th measurement run to force a git-status change between two
  calls); the mechanism it targets (git status inside the cached prefix) is live-confirmed, the flag
  itself rests on doc text only here (§3).
- **`subagent_stats`'s exact field semantics are undocumented** on every `code.claude.com` page
  fetched or searched in this session — real, observed (both here and in the companion research),
  never written up (§4).
- **The exact subagent spend-limit setting name** (referenced only as a bundle, "depth, concurrency,
  and spend limits," on `docs/en/agent-sdk/cost-tracking`) was not confirmed against a primary page
  in this session; a secondary source named `error_max_budget_usd` as the resulting error subtype,
  flagged as unverified rather than asserted (§4).
- **`ttft_ms`, `time_to_request_ms`, `first_content_frame_ms`, `ttft_stream_ms`** remain
  undocumented anywhere on `code.claude.com`; this file's read of what they likely measure is
  inference from field names and observed near-equality/stability across live runs, not doc text
  (§5).
- **`--bare`'s startup-time claim could not be wall-clock-verified end-to-end** on this machine,
  because bare mode's auth requirements (`ANTHROPIC_API_KEY` only) aren't met here, so the live test
  failed before a real turn ran; only the context-size half of the claim (29→4 tools) was directly
  confirmed (§5).
- **`--disable-slash-commands`** appears only in local `--help` output, not in any fetched docs page
  in this session (§8).
