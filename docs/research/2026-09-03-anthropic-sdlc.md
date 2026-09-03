# Verifying the "Anthropic AI-native SDLC" social post against primary sources

Research date: 2026-09-03. Every claim below carries the URL that was actually fetched
(WebFetch, not memory or a secondary write-up). Where a source doesn't answer a sub-question,
that is stated rather than filled in.

---

## 1. What was asked, and what was verified vs not

The social post claims: (a) Anthropic publishes an SDLC where every stage ends by committing
an artifact file — idea to `intent.md`, which triggers `spec.md`, which triggers `plan.md`,
which triggers the code — each handoff a git commit, the chain doubling as an audit trail;
(b) two guardrail layers, skills (policy the agent follows) vs hooks (a script that blocks
it); (c) AI reviews every PR but may never approve its own code, human keeps the merge
button.

**Verdict: the post is substantially accurate and is not overstating a secondary source's
gloss — it is paraphrasing a real Anthropic publication closely enough that most of its
claims are near-verbatim.** The one place it compresses reality is the artifact count: the
real chain has six named stages and six-ish artifact types, not three file names ending at
"the code." All three sub-claims (a), (b), (c) are directly sourced to Anthropic's own
domains, not inferred from a GitHub Action default.

Primary sources used:
- `https://claude.com/blog/the-ai-native-sdlc-playbook` — the playbook itself. Byline Louis
  Claxton, published August 21, 2026. This is the source of claims (a) and most of (b)/(c).
- `https://claude.com/blog/how-anthropic-secures-its-ai-native-software-development-lifecycle`
  — companion security post. Byline Jason Clinton, Deputy CISO, Anthropic, published July 21,
  2026. Independently corroborates the human-approval claim and adds governance detail the
  post omits.
- `https://code.claude.com/docs/en/hooks` — the hooks reference (this is Claude Code's
  current docs host; `docs.claude.com`/`docs.anthropic.com` now redirect content here and to
  `platform.claude.com` for the API/SDK docs).
- `https://code.claude.com/docs/en/skills` — the skills reference.
- `https://code.claude.com/docs/en/github-actions` — GitHub Actions integration docs,
  including the official review-workflow example.
- `https://code.claude.com/docs/en/code-review` — the managed "Code Review" product, with an
  explicit statement about approval authority.
- `https://github.com/anthropics/claude-code-action` — the GitHub Action source repo (linked
  from the docs above; not independently re-fetched beyond what the docs already quote).

Secondary sources (LinkedIn/Medium/newsletter-style write-ups) turned up in search results
were used only to locate the URLs above, never cited for a claim.

---

## 2. The artifact chain as Anthropic actually publishes it

`https://claude.com/blog/the-ai-native-sdlc-playbook`

The loop is **six stages**, not the three-artifact chain the post names: **Plan → Design →
Build → Test → Deploy → Maintain**. Each stage has a one-line thesis in the playbook:

1. **Plan** — "Ideas stop waiting for someone to write them up. Intent is captured once, in
   the originator's own words, as a version-controlled artifact the next stage can act on."
   Artifact: `intent.md`.
2. **Design** — "Requirements and design collapse into one session. Policy is applied while
   the spec is written, not discovered in a review weeks later." Artifact: `spec.md`.
3. **Build** — "Nothing is implemented without an accepted plan. Institutional knowledge
   becomes files the agent reads, and the guardrails run as code rather than as habits."
   Artifact: `plan.md`, produced in Claude Code plan mode.
4. **Test** — "Every session checks its own work before a human sees it, and the
   configuration that steers the agent gets regression-tested like the code it writes."
   Artifact: the diff and its tests.
5. **Deploy** — "Review runs in both directions, and governance is enforced as the agent
   acts. The agent does everything up to the production gate and nothing past it." Artifact:
   the PR with its review findings.
6. **Maintain** — "The loop closes. A trigger invokes Claude with no person in the invocation
   path, and what it finds re-enters the pipeline as `intent.md`." Artifact: the incident
   record, itself written in `intent.md` format, which restarts the loop.

**"Each handoff is a git commit" is Anthropic's own wording, not a poster's gloss.** Quoted
directly: "A stage ends by committing an artifact with the commit initiating the next stage.
An accepted `intent.md` triggers the requirements and design pass, an approved `spec.md`
triggers plan mode, a merged PR triggers the pipeline." And on the audit-trail claim: "Every
stage commits an artifact the next stage can read. Together, the intent, the spec, the plan,
the diff and the review findings are the audit trail" — and separately, "The chain of commits
is also the audit trail: who asked for what, what the agent produced, and who approved it."

So the social post's three named files (`intent.md`, `spec.md`, `plan.md`) are correct as far
as they go — those are exactly the Stage 1–3 artifact names — but it silently stops there.
The real chain keeps going past `plan.md` into artifacts that are not `.md` files: "For the
early stages, .md files are the predominant artifact because a product owner and an agent can
both read and act on the same file. From Build onward, the artifact is code and its records"
— i.e., the diff+tests, the reviewed PR, and the incident record. A reader who takes the post
literally (three files, then "the code") would miss that Deploy and Maintain each still
commit a distinct artifact (review findings; incident record) that the next stage consumes.

The playbook's own summary of the operating principle: "the agent can do everything up to the
production gate, but never crosses it."

---

## 3. Hooks: full authoritative reference

`https://code.claude.com/docs/en/hooks`

**What a hook is, per the playbook's own definition** (`claude.com/blog/the-ai-native-sdlc-playbook`):
"A hook is the deterministic layer" behind skills — it can "block edits to protected paths"
or "run the formatter and linter after file edits." The docs' fuller framing: hooks are
user-defined shell commands (or HTTP/MCP/prompt/agent handlers) that Claude Code runs
automatically at specific points in a session, configured in `settings.json`.

### Every hook event (33, per the current reference)

`SessionStart`, `Setup`, `UserPromptSubmit`, `UserPromptExpansion`, `PreToolUse`,
`PermissionRequest`, `PermissionDenied`, `PostToolUse`, `PostToolUseFailure`,
`PostToolBatch`, `Notification`, `MessageDisplay`, `SubagentStart`, `SubagentStop`,
`TaskCreated`, `TaskCompleted`, `Stop`, `StopFailure`, `TeammateIdle`, `InstructionsLoaded`,
`ConfigChange`, `CwdChanged`, `DirectoryAdded`, `FileChanged`, `WorktreeCreate`,
`WorktreeRemove`, `PreCompact`, `PostCompact`, `PreModelSwitch`, `PostModelSwitch`,
`Elicitation`, `ElicitationResult`, `SessionEnd`.

### Input/output contract

Common JSON input fields sent to every hook on stdin: `session_id`, `prompt_id`,
`transcript_path`, `cwd`, `permission_mode`, `effort.level`, `hook_event_name`, and (for
subagents) `agent_id`/`agent_type`. `PreToolUse`/`PostToolUse`/etc. additionally carry
`tool_name` and `tool_input`.

Common JSON output shape a hook can return via stdout:
```json
{ "hookSpecificOutput": { "hookEventName": "...", "systemMessage": "...", "terminalSequence": "..." } }
```
Tool-decision events (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`,
`PermissionDenied`) additionally honor `permissionDecision` (`allow|deny|unknown`),
`permissionDecisionReason`, `additionalContext`, and `updatedInput`. Blocking-capable events
(`UserPromptSubmit`, `Stop`, `SubagentStop`, `TaskCreated`, `TaskCompleted`, `ConfigChange`,
`PostToolBatch`, `TeammateIdle`, `PreModelSwitch`, etc.) honor `hookSpecificOutput.blockReason`.

### Exit-code semantics

- **Exit 0**: success; stdout is parsed as JSON if it starts with `{` and ends with `}` and
  matched against the event's schema; otherwise treated as a non-blocking error or ignored
  depending on the event. stdout only reaches Claude directly on `UserPromptSubmit`,
  `UserPromptExpansion`, `SessionStart`, `PostModelSwitch`; elsewhere it goes to a debug log.
- **Exit 2**: blocking error — on an event that "can block" (see table below), this halts the
  action outright, with the reason taken from stderr or from a JSON blocking-decision field.
  Documented explicitly: "For a PreToolUse hook, exiting 2 blocks the tool call and the
  contents of stderr are surfaced to the model as the reason it was blocked." Even a JSON
  body claiming `"permissionDecision": "allow"` cannot override an exit-2 block.
- **Other codes (1, 3, ...)**: with valid JSON, decision fields are honored regardless of
  exit code; with invalid JSON or plain text, the action proceeds (non-blocking error).
  `WorktreeCreate` is a documented special case: *any* non-zero exit code aborts the worktree
  creation.

Per-event, whether exit 2 can block anything at all differs sharply — `PreToolUse`,
`UserPromptSubmit`, `Stop`, `SubagentStop`, `TaskCreated`, `TaskCompleted`, `ConfigChange`,
`PostToolBatch`, `TeammateIdle`, `WorktreeCreate`, `PreModelSwitch` can block; `PostToolUse`,
`PostToolUseFailure`, `PermissionRequest`, `StopFailure`, `PostModelSwitch`, `Elicitation`,
`ElicitationResult` explicitly cannot (the tool/turn has already happened, or the field is
ignored by design).

### What a hook can do that a skill cannot

A skill is advisory text loaded into the model's context — it can only change what Claude
*decides* to do. A hook runs outside the model entirely, as a real process with a real exit
code, so it is the only mechanism that can deterministically veto an action Claude has
already decided to take (block a tool call, block a config change, force a turn to continue).
The playbook states this contrast directly (see §4 below) and the security companion post
gives a concrete example of trading a skill for a hook to make a check load-bearing: "Some of
our customers choose to integrate `/security-review` with a `PreToolUse` hook, which makes
this step a harder gate" — implying that without the hook, `/security-review` (a skill/slash
command) is something Claude can be told to run but not mechanically forced to run.

### `settings.json` configuration shape

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "if": "Bash(rm *)",
            "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/block-rm.sh",
            "args": []
          }
        ]
      }
    ]
  },
  "disableAllHooks": false
}
```
- `matcher` is exact-string (letters/digits/`_`/`-`/spaces/`,`/`|`) or, when it contains other
  characters, an unanchored JS regex (e.g. `"^Notebook"`, `"mcp__memory__.*"`). What it
  matches against is event-specific (tool name for `PreToolUse`/`PostToolUse`; session-start
  reason for `SessionStart`; error type for `StopFailure`; etc.) — some events, like
  `UserPromptSubmit` and `Stop`, take no matcher at all and always fire.
- Handler `type` is one of `command`, `http`, `mcp_tool`, `prompt`, `agent`. A `command` hook
  either runs as a shell string (tokenized, supports pipes/`&&`/globs) or, when `args` is
  present, as an exec-form call with no shell interpretation.
- Default timeout is 600s (30s for `UserPromptSubmit`/`PreModelSwitch`/`PostModelSwitch`, 10s
  for `MessageDisplay`).
- Scopes, in override order: `~/.claude/settings.json` (user, all projects) →
  `.claude/settings.json` (project, shareable/commit-to-repo) → `.claude/settings.local.json`
  (project, gitignored) → managed/organization policy settings (cannot be disabled from
  outside) → plugin `hooks/hooks.json` → skill/subagent frontmatter (scoped to the session
  after invocation).
- `disableAllHooks: true` turns everything off; CLI `--settings` override beats local beats
  project beats user beats managed.

---

## 4. Skills: what they are, and precisely how they differ from hooks

`https://code.claude.com/docs/en/skills`, `https://claude.com/blog/the-ai-native-sdlc-playbook`

Definition, from the docs: "Skills extend what Claude can do. Create a `SKILL.md` file with
instructions, and Claude adds it to its toolkit. Claude uses skills when relevant, or you can
invoke one directly with `/skill-name`." A skill is a directory with a `SKILL.md` (YAML
frontmatter + markdown body) that Claude Code follows the [Agent Skills](https://agentskills.io)
open standard for. Frontmatter fields include `name`, `description` (what decides when Claude
auto-loads it), `disable-model-invocation` (only a human can invoke it — used for
side-effecting actions like `/deploy`), `user-invocable` (only Claude can invoke it),
`allowed-tools`/`disallowed-tools`, `model`, `effort`, `context: fork` (run as a subagent),
and — notably — a skill's own frontmatter can register `hooks` that stay active "for the rest
of the session" once the skill is invoked, meaning a skill can *install* a hook but is not
itself one.

The playbook's own contrast, quoted verbatim: "Skills are how an organization makes its
institutional knowledge operational. The instructions are explicit, version-controlled,
applied broadly, and updated centrally when policy changes." and "A skill is an advisory
control while a hook is the deterministic layer behind it." Skills fire during code
generation to *encourage* compliance (e.g., a security-standards skill that shapes how an API
is written); a hook fires *around* tool execution and can refuse to let an action happen
regardless of what the model decided.

Precisely stated: a skill changes Claude's context/knowledge before it acts; a hook is an
independent process with its own exit code that runs deterministically and can override or
veto what Claude decided, which a skill — being just more text in context — structurally
cannot do. This is exactly the two-layer split the social post names ("policy the agent
follows" vs "a script that blocks it"), and it is Anthropic's own framing, not a
simplification invented by the poster.

---

## 5. The review/merge policy: published vs inferred

This is **published policy**, stated in Anthropic's own words in two independent posts, not
merely inferable from a default GitHub Action config.

From the playbook (`claude.com/blog/the-ai-native-sdlc-playbook`):
- "Claude both gives and receives reviews. It reviews incoming PRs against the organization's
  policies and addresses review comments on its own PRs."
- "Approval comes from a human through branch protection, informed by the findings." And,
  the load-bearing separation-of-duties sentence: "Separation of duties is preserved, because
  the agent that wrote the code has no way to approve it."
- "Findings do not approve or block a PR on their own, and branch protection still requires
  approval from a code owner."

From the security companion post
(`claude.com/blog/how-anthropic-secures-its-ai-native-software-development-lifecycle`),
independently:
- "Human accountability is still central for code that is reviewed and merged by Claude.
  Every approval is logged with the signals and reasoning behind it, and a risk-weighted
  sample is reviewed by humans."
- "To be clear, agents aren't merging code to production unchecked. We tier our codebase by
  risk, and make deliberate decisions on what parts to automate."
- Even where Claude authors "about 80% of the code merged into our codebase today," and "more
  than half of all code" is merged by Claude *Tag* — the piece is explicit that a human
  still holds final approval on that flow ("human engineers focus on direction and final
  approval").
- On rolling out new automated reviewers cautiously: "Shadow mode for all new AI reviewers.
  New agents post comments for human approval until trust is earned."

This is corroborated, not just asserted, by the actual product configuration.
`https://code.claude.com/docs/en/code-review` (the managed "Code Review" product) states
outright: "Findings are tagged by severity and don't approve or block your PR, so existing
review workflows stay intact," and "The check run always completes with a neutral conclusion
so it never blocks merging through branch protection rules." The official example workflow at
`https://code.claude.com/docs/en/github-actions` for automated PR review grants the review job
only `contents: read`, `pull-requests: read`, `issues: read`, `id-token: write` — i.e., the
review job is architecturally incapable of approving or merging, because it is never given
write access to pull requests. So the merge-button claim is both a stated policy (quoted
above) and enforced by the shape of the shipped tooling — the social post is right on both
counts, and slightly undersells it: Anthropic's own security post adds that even the human
approval step is logged and *sampled for human review of the reviewers*, which the post
doesn't mention.

---

## 6. Anything else in Anthropic's SDLC material worth knowing

From the playbook:
- **`CLAUDE.md` is the institutional-knowledge file** that carries "conventions, commands,
  architecture, and the mistakes the team sees most often," and is explicitly meant to grow
  by correction: "when Claude errs twice, the fix enters `CLAUDE.md`."
- **Continuous evals** stand in for stage-gate QA: "When a new model is swapped in or a
  prompt is rewritten, the eval suite says whether the agent still does the work to the same
  standard" — evals run specifically when skills, hooks, or `CLAUDE.md` change, not just when
  code changes.
- **Production monitoring runs on statistical control bands, not binary alerts**: "At 1σ the
  script only logs, at 2σ it invokes Claude read-only to diagnose, and at 3σ Claude may act,
  though only by opening a PR into the review gate or triggering a pre-approved runbook." The
  Maintain stage's diagnosis is written back into the loop as `intent.md` — the anomaly, its
  evidence, a proposed outcome, and open questions — so an incident is structurally the same
  shape of artifact as a feature idea.
- **Role change, stated explicitly**: engineers move from "writing code" to "steering and
  reviewing all of them" across parallel sessions; product managers write `intent.md`
  directly rather than attending refinement meetings; human reviewer attention "moves up a
  level, to whether the change does what the plan intended and whether the risk is
  acceptable" rather than reading every line.

From the security companion post — largely orthogonal detail the social post omits entirely:
- **Concrete scale claims**: engineers ship "8x as much code per quarter as they did from
  2021 to 2025"; Claude "authors about 80% of the code merged into our codebase today"; "the
  share of PRs that get substantive review comments has grown from 16 to 54%"; roughly "a
  third of the bugs behind past claude.ai incidents would have been caught" by the automated
  process now in place.
- **Least-agency architecture for autonomous agents**: the incident-response agent "can't
  deploy the fix automatically. It's a single-purpose system account agent with three
  permissions: it can write new docs, post in company channels, and access production logs."
  A named lesson from building it: "When considering an agent's hard boundaries you need to
  include its access to other agents" — i.e., an agent's effective permissions include
  whatever any agent it can talk to is permitted to do.
- **Where the "hard gate" actually sits**: contrary to a naive reading of "skills are
  advisory," Anthropic states its own team "has chosen to incorporate our hard code review
  gate at the test/CI stage of the cycle" rather than as a `PreToolUse` hook mid-edit — they
  note customers who *do* wire `/security-review` to a `PreToolUse` hook to make it "a harder
  gate," implying Anthropic's own default is a softer, later gate at CI rather than blocking
  every edit as it happens.
- **Egress-allowlisted dev sandboxes**: developer-facing agent traffic runs on VMs with
  "agent traffic" that is "egress-allowlisted" — a containment control the post doesn't
  mention.
- **Security-side skills usage**: "encoded in CLAUDE.md files and references to org-wide
  skills so the code follows these best practices the minute it's generated" — skills as a
  distribution mechanism for security policy specifically, not just general conventions.

---

## 7. Not found / not published

- **No Anthropic page states the artifact chain as literally "three files then code."** The
  real chain is six stages/artifacts (`intent.md`, `spec.md`, `plan.md`, diff+tests, PR+review
  findings, incident record). This isn't a contradiction of the post so much as a detail the
  post compresses away — worth flagging if someone designs a pipeline off the post alone and
  stops at `plan.md`.
- **No single canonical hook-event list was found "pinned" outside `code.claude.com/docs/en/hooks`** —
  this is the one authoritative source; no anthropic.com engineering-blog post duplicates or
  summarizes the hook event table, so the reference doc is the only citation available for
  §3, by design (it's a docs page, not a blog post).
- **Anthropic does not publish a hard organization-wide rule that every skill/hook change is
  itself gated by human review before landing** — the playbook says evals run on such
  changes, but does not state who must approve a skill or hook edit before it ships, beyond
  the general `CLAUDE.md`-style "applied broadly, updated centrally" framing. This is a gap in
  the published material, not something this document is asserting either way.
- **No number is published for what fraction of PRs are reviewed by Claude** in absolute
  terms (only the "16% to 54%" *substantive-comment* growth stat, and "review runs... on
  every push" as one of the *possible* configured triggers) — "AI reviews every PR" is a
  configuration choice (`After every push` / `Once after PR creation` / `Manual` per the
  Code Review docs), not a universal fact Anthropic states about all repositories, including
  its own. This is a genuine overstatement in the social post if read as "every PR everywhere,
  always" — Anthropic's own product docs show review cadence is repo-configurable and can be
  fully manual.
