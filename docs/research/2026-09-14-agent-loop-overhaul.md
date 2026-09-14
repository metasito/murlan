# Overhauling the agent loop

Research, 2026-09-14. Prompted by a 30-ticket measurement of `.loop-logs`: phase D (review) reads
588M of the run's 806M tokens (73%), runs 6,174 model turns against build's 1,277, and 44 of 150
agent invocations are polls — ≤4 turns, <600 output tokens, the text literally `Waiting.` — while the
main session waits on two `opus` review subagents.

Five questions, each answered against first-party documentation, the installed `claude.exe`
(2.1.270) on this machine, and published research. **Where no primary source exists, this document
says so rather than asserting.** Every such gap is tagged **[unsourced]**.

Prior research this builds on rather than repeats:
[`2026-09-12-queue-loop-rearchitecture.md`](2026-09-12-queue-loop-rearchitecture.md) (the supervisor's
defects, `--max-budget-usd` semantics, why `PreToolUse` is the only real boundary) and
[`2026-09-10-headless-cost-and-speed.md`](2026-09-10-headless-cost-and-speed.md) (per-tool token cost,
cache warmth across processes).

---

## 0. The arithmetic that reorders the five questions

Before any of it: the four Claude tiers are related by **exactly** 0.4× and 0.2× on every price
column, so a tier swap is a clean multiplier
([pricing](https://platform.claude.com/docs/en/about-claude/pricing)).

| | base input | cache read | output | ratio to Opus 5 | context |
|---|---|---|---|---|---|
| Claude Opus 5 | $5 / MTok | $0.50 | $25 | 1.0× | 1M |
| Claude Sonnet 5 | $2 / MTok | $0.20 | $10 | **0.4×** | 1M |
| Claude Haiku 4.5 | $1 / MTok | $0.10 | $5 | **0.2×** | **200K** |

Applied to the measured split:

| Change | Share of the run's tokens it touches | Effect on spend |
|---|---|---|
| Both phase-D reviewers Opus 5 → Sonnet 5 | 73% | **−44% of total spend**, token volume unchanged (0.73 × 0.6) |
| Eliminate all 44 polls | 8.0M / 806M = **0.99%** | −1% of spend |

**The polling is a latency and turn-budget defect, not a cost defect.** It is worth fixing — 29% of
invocations and an unbounded wall clock buy nothing — but a document that leads with it is leading
with 1%. The 44% is §2.

---

## 1. Eliminating polling

### 1.1 The Agent tool call *is* awaited — but only when it runs in the foreground

> "The Agent tool spawns a subagent in a separate context window. The subagent works through its task
> autonomously, then returns a single text result to the parent conversation. The parent doesn't see
> the subagent's intermediate tool calls or outputs, only that final result."
> — [tools-reference](https://code.claude.com/docs/en/tools-reference)

So a *foreground* subagent needs no polling: the tool result is the report. The polling is not a
platform limitation. Its cause is the **default**:

> "Subagents run in the background by default. An Agent tool call that omits the `run_in_background`
> input launches a background subagent, and Claude sets `run_in_background: false` when it needs the
> result before continuing."
> — [agent-sdk/subagents](https://code.claude.com/docs/en/agent-sdk/subagents)

and the mode-selection order, whose fourth case is the one the loop lands in:

> "Where fork mode is off, Claude runs the subagent in the background by default and in the foreground
> when it needs the result before continuing. **Fork mode is off in non-interactive mode with `-p`**
> and in the Agent SDK unless you turn it on."
> — [sub-agents § Run subagents in foreground or background](https://code.claude.com/docs/en/sub-agents)

And what a background result does:

> "A background subagent's results reach Claude as a completion notification in a later turn. Claude
> waits for that notification before reporting the subagent's results, and if you ask about progress
> first, **it reports that the subagent is still running**."
> — [sub-agents](https://code.claude.com/docs/en/sub-agents)

That last sentence *is* the `Waiting.` turn, verbatim in behaviour. The 44 polls are the documented
response to asking a background subagent about its progress. **The loop's phase D prompt never states
that the verdict needs both reports in hand, so Claude has no reason to set `run_in_background: false`,
and every wake-up is a correctly-behaving session answering a question nobody needed asked.**

Confirmed against the installed binary (`claude 2.1.270`, `/c/Users/roton/.local/bin/claude`):
`run_in_background` is a real Agent-tool input (36 string hits), and the binary carries
`"The run_in_background and name parameters are not available in this context. Only synchronous
subagents are supported."` — i.e. a context exists in which the parameter is not offered and every
subagent is synchronous.

### 1.2 The levers, in order of how hard they bind

| Lever | Binds? | Source |
|---|---|---|
| `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` in the spawn env | **Yes.** "If you set `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` to `1`, Claude Code runs the subagent in the foreground, **in every kind of session** and whether or not fork mode is on." | [sub-agents](https://code.claude.com/docs/en/sub-agents); present in `claude.exe` 2.1.270 (4 hits) |
| Phase D prompt states the verdict needs both reports this turn | Steering only. "Either instruction only steers Claude, so set the limits as well." | [agent-sdk/subagents](https://code.claude.com/docs/en/agent-sdk/subagents) |
| Subagent frontmatter `background` | **Wrong direction.** `background: true` forces background "even when Claude wants the result". No documented `background: false` that forces foreground. | [agent-sdk/subagents § AgentDefinition](https://code.claude.com/docs/en/agent-sdk/subagents) |

**[unsourced]** Nothing in the docs offers a per-invocation way to *force* foreground from the
callee side. The env var is the only documented hard lever, and it is session-wide.

### 1.3 Hooks: what each actually gives you

From the [hooks reference](https://code.claude.com/docs/en/hooks). Every event carries the common
fields including `agent_id` and `agent_type`.

| Event | Fires on | Input it gets | Can it wake the parent? |
|---|---|---|---|
| `SubagentStart` | "When a subagent is spawned" | common fields | no |
| `SubagentStop` | "When a subagent finishes" | `agent_type`, `agent_id`, `last_assistant_message`, `stop_reason` | **No.** Its output is `additionalContext` / `suppressOutput`; exit 2 *prevents* the subagent from stopping. It can inject the report into the parent's context, it cannot schedule a parent turn. |
| `Stop` | "When Claude finishes responding" | `last_assistant_message`, `stop_reason` | It can *refuse* a stop (`continue: true`, or exit 2), which is the opposite problem |
| `PostToolUse` | "After a tool call succeeds" | `tool_name`, `tool_input`, `tool_use_id`, `tool_output` | Fires on the Agent tool's *result*, so for a foreground subagent it is already after the await |
| `Notification` | "When Claude Code sends a notification" | `notification_type`, `notification_title`, `notification_body`; **output is information-only (discarded)** | no |

**Conclusion: no hook replaces a polling loop.** `SubagentStop` is the closest and it is an
observer, not a scheduler. Its real use here is different and worth taking: it is the one place the
reviewer's `last_assistant_message` is available to a *script*, which is how the two review reports
could be written to the issue by `gh` instead of by the model re-emitting them.

### 1.4 The SDK / `claude -p` side

- **`claude -p` already blocks on background subagents.** "If Claude starts a background subagent or
  workflow, `claude -p` instead stays open until that work completes, because its result is part of
  the final output. By default the wait ends after 10 minutes of continuous idle waiting… To change
  the limit, set `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`, or set it to `0` to wait without one."
  ([headless](https://code.claude.com/docs/en/headless)). The binary's own telemetry string names the
  failure mode: *"`-p` giving up on a background subagent still running at its wait ceiling"*.
  So a phase-D reviewer that outruns 10 minutes is silently dropped, partial result discarded.
- **Exit semantics.** "Claude Code exits with code 0 on success and a non-zero code when the run
  fails… When a failure happens inside the run, such as missing authentication, Claude Code prints
  the failure as the result on stdout." SIGTERM → exit 143, turn left unfinished, no result recorded;
  SIGINT or the SDK's `interrupt()` ends the turn instead ([headless](https://code.claude.com/docs/en/headless)).
- **`--output-format stream-json`.** "The last line of the stream is a `result` message with the final
  response text, cost, and session metadata." Subagent messages carry `parent_tool_use_id`; by default
  only their `tool_use`/`tool_result` blocks are forwarded, and `--forward-subagent-text` (or
  `CLAUDE_CODE_FORWARD_SUBAGENT_TEXT`, v2.1.211+) adds their text and thinking, "so you can
  reconstruct each subagent's transcript" ([headless](https://code.claude.com/docs/en/headless)).
  **This is how a supervisor could read the two review reports without the session repeating them.**
- **An SDK orchestrator awaits a `query()`, not a subagent.** The documented shape is one async
  iterator per query: `for await (const message of query({ prompt, options: { agents: {...} } }))`
  ([agent-sdk/subagents](https://code.claude.com/docs/en/agent-sdk/subagents)). Subagent completion is
  observable (`parent_tool_use_id`, the `agentId:` trailer in the Agent tool result) but there is no
  documented handle to `await` one individual subagent from outside the query. **[unsourced]** —
  searched the SDK subagents and headless pages; nothing of the kind is described.
  *The consequence is architectural:* to `await` two reviews independently in Node, run **two
  `query()` calls** (or two `claude -p` processes) and `Promise.all` them. Each is its own awaitable;
  the orchestration then costs zero model turns.

### 1.5 What should replace the polling loop

Ranked by cost of the change.

1. **Set `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` in the env `queue-loop.mjs` passes to the session.**
   One line. Makes every phase-B and phase-D subagent foreground, which makes the Agent tool call a
   blocking await, which makes a `Waiting.` turn unreachable. It also removes the 10-minute
   background wait ceiling as a silent-drop vector, because foreground subagents are not subject to it.
   Cost: the session can no longer overlap the two reviewers. Measured against 6,174 review turns,
   that is the wrong thing to optimise.
2. **If the overlap is wanted, keep background and say so in the prompt** — phase D's brief adds that
   the session must have both reports before writing `VERDICT:`, which is the documented trigger for
   Claude to set `run_in_background: false`. Steering only; pair it with (1) or accept the polls.
3. **Structural: move phase D out of the session.** The supervisor spawns two `claude -p --agents …`
   processes on the diff, `Promise.all`s them, and posts both reports itself. Node awaits two
   processes for free; the session's only phase-D job becomes reading two files and emitting one
   `VERDICT:` line. This deletes the orchestration turns rather than making them cheaper, and it is
   the same "the supervisor owns what is a switch statement" argument that §5.4 of the 09-12 note
   made for the merge.

---

## 2. Model tiering per phase

### 2.1 What Anthropic publishes

| Claim | Source |
|---|---|
| "Most workloads start with Claude Opus 5." | [choosing-a-model](https://platform.claude.com/docs/en/about-claude/models/choosing-a-model) |
| "Use appropriate models: Choose Haiku for simple tasks, Sonnet for most production workloads, and Opus for the most complex reasoning" | [pricing § Cost optimization strategies](https://platform.claude.com/docs/en/about-claude/pricing) |
| Haiku 4.5's example use cases include, verbatim, **"sub-agent tasks"** | [choosing-a-model § Model selection matrix](https://platform.claude.com/docs/en/about-claude/models/choosing-a-model) |
| Sonnet 5: "Speed and capability for everyday coding, agent, and enterprise workloads"; examples "Code generation, data analysis… agentic tool use" | ibid. |
| Opus 5: "Complex agentic coding and enterprise work"; examples "Multihour autonomous coding agents, large-scale refactoring, complex systems engineering" | ibid. |
| "Tuning effort is often a better lever than switching models. On Claude Fable 5.1 and Claude Opus 5, start with the default (`high`) and adjust up or down based on your evals." | ibid. |
| "Multi-model strategies pair a lower-cost model with a frontier model so that most tokens are billed at the lower rate. The two common patterns are an executor that escalates hard decisions to an advisor, and an **orchestrator that delegates bulk work to lower-cost workers**." | ibid. |

The **only** first-party artifact that ties model strength to the *review* role specifically is a
code comment in the SDK docs' own example:

```ts
// Key insight: use a more capable model for high-stakes reviews
model: isStrict ? "opus" : "sonnet"
```
— [agent-sdk/subagents § Dynamic agent configuration](https://code.claude.com/docs/en/agent-sdk/subagents)

That is an illustrative snippet, not a measurement.

### 2.2 What is *not* published

**[unsourced]** Anthropic publishes **no** benchmark, model card, or guidance comparing a stronger
reviewer against a stronger builder. Model pages carry coding benchmarks (SWE-bench-family), but those
measure end-to-end patch generation — the *builder* role — and say nothing about review. Searched:
models overview, choosing-a-model, pricing, best-practices, agent-sdk/subagents. There is no published
Anthropic answer to "does the reviewer or the builder benefit more from Opus".

### 2.3 The third-party evidence, and it points the other way

[SWR-Bench (arXiv 2509.01494)](https://arxiv.org/abs/2509.01494), 1,000 manually verified PRs:

- Mainstream automated-code-review tools and LLMs were evaluated, "all of which exhibited **precision
  scores below 10%**"; best single system 16.65% (PR-Review + Gemini-2.5-Pro).
- "A primary factor limiting higher F1 scores for all techniques is their low precision, indicative of
  a high false positive rate."
- The winning intervention is **aggregation, not a bigger model**: "Gemini-2.5-Flash with Self-Agg
  (n=10) achieved an Overall F1 of 21.91% (a 43.67% increase)" and recall +118.83%. A *fast* model run
  ten times beat every single-pass system.

If that transfers — one benchmark, non-Anthropic models, so treat it as a lead not a law — then two
Opus reviewers is the expensive shape of the wrong idea, and N cheap independent reviews with
agreement-gating is the cheap shape of the right one.

### 2.4 Per-phase recommendation

| Phase | Today | Recommended | Why |
|---|---|---|---|
| A claim / F close | Opus 5 | **Sonnet 5** | `gh` calls and a fixed checklist. Close's context reaches 310k, so a 1M window is required — Haiku's 200K is not enough. |
| B scope | Sonnet | keep Sonnet 5 | already right |
| C build | Opus 5 | **keep Opus 5** | "complex agentic coding", and build is only 14% of tokens — the tier that is cheapest to keep expensive |
| D review ×2 | Opus 5 ×2 | **Sonnet 5 ×2**, or Sonnet 5 ×3 with agreement gating | −60% on 73% of the run = −44% of spend at unchanged token volume. §2.3 is the only evidence in play and it favours count over tier. |
| Orchestration / polls | Opus 5 | **delete, see §1.5** | not a model-tier problem |

Haiku 4.5 is disqualified for D and F on context alone: 200K window
([models overview](https://platform.claude.com/docs/en/about-claude/models/overview)) against a
measured review p90 of 187k and a close max of 310k. It also takes no `effort` parameter.

Second lever, cheaper to try than a tier swap: `effort`. Opus 5's default is `high`
([models overview](https://platform.claude.com/docs/en/about-claude/models/overview)); the docs call
tuning it "often a better lever than switching models", and recommend "`low` for subagents or simple
tasks". A `low`-effort Opus reviewer is an untested middle point between Opus-high and Sonnet.

---

## 3. Why LLM review produces low-value findings

### 3.1 Anthropic states the mechanism outright

> "A reviewer prompted to find gaps **will usually report some, even when the work is sound, because
> that is what it was asked to do.** Chasing every finding leads to over-engineering: extra
> abstraction layers, defensive code, and tests for cases that can't happen. **Tell the reviewer to
> flag only gaps that affect correctness or the stated requirements, and treat the rest as optional.**"
> — [best-practices § Add an adversarial review step](https://code.claude.com/docs/en/best-practices)

and in the same section's example prompt: *"Report gaps, not style preferences."*

Two supporting first-party points:

- **Fresh context is the reason to use a subagent at all.** "A fresh context improves code review
  since Claude won't be biased toward code it just wrote"; "A reviewer running in a fresh subagent
  context sees only the diff and the criteria you give it, not the reasoning that produced the
  change." (ibid.) — phase D already does this, and `queue.md:232` already forbids passing the
  session's reasoning. That part is right.
- **Refutation, not generation.** "a verification subagent or a dynamic workflow that checks its own
  findings has a fresh model **try to refute the result**, so the agent doing the work isn't the one
  grading it." (ibid.) — this is the documented shape of a falsifiability gate, and the loop does not
  have it: nothing in phase D tries to *kill* a finding.
- **Evidence over assertion.** "Have Claude show evidence rather than asserting success: the test
  output, the command it ran and what it returned, or a screenshot of the result." (ibid.)

### 3.2 Published research

| Finding | Source |
|---|---|
| ACR precision below 10% across mainstream tools; low precision is the primary F1 limiter | [SWR-Bench, arXiv 2509.01494](https://arxiv.org/abs/2509.01494) |
| LLM reviewers are **worst on exactly the prose/style class**: F1 26.20% on logic errors vs **14.30% on textual/documentation ("evolvability") changes**, because "the criteria for what constitutes a necessary change can vary significantly" and human reviewers themselves disagree there | ibid. |
| Multi-review aggregation raises F1 43.67% and recall 118.83% | ibid. |
| The canonical code-review-comment training corpus is itself mostly noise: "only 64% of sampled comments in the training set are valid"; LLM filtering reached 66–85% precision at identifying valid comments and cut the corpus 25–66% | [Too Noisy To Learn, arXiv 2502.02757](https://arxiv.org/abs/2502.02757) |

### 3.3 What the commercial tools document

| Mechanism | Who documents it | Exact wording |
|---|---|---|
| **Verbosity threshold** | CodeRabbit `reviews.profile` | "Set the review profile: **quiet** for only the most important feedback, **chill** for balanced feedback, **assertive** for more feedback (which may feel nitpicky)" — [configuration reference](https://docs.coderabbit.ai/reference/configuration) |
| **Diff/path scoping** | CodeRabbit `reviews.path_filters` | "Specify file patterns to include or exclude in a review using glob patterns". Guides add: "Excluding irrelevant files, such as lock files, binaries, and generated code, keeps reviews focused and fast" — [review instructions](https://docs.coderabbit.ai/guides/review-instructions) |
| **Scoping is not suppression** | CodeRabbit | "Path instructions only affect CodeRabbit's review guidance for matching files. **They do not disable other features that inspect the same code.**" (ibid.) |
| **Severity labelling** (triage, not suppression) | GitHub Copilot code review | "Copilot labels each comment with a severity level of 'High,' 'Medium,' or 'Low' to help you prioritize the issues it finds based on their importance" — [docs.github.com](https://docs.github.com/en/copilot/using-github-copilot/code-review/using-copilot-code-review) |
| **Custom instructions as the criteria channel** | Copilot | `.github/copilot-instructions.md`, `AGENTS.md`, `.github/instructions/**/*.instructions.md` (ibid.) |

**[unsourced], three ways:**
- **No confidence gating is documented by any of the three.** CodeRabbit's `profile` is a coarse
  verbosity dial, not a numeric confidence threshold; Copilot labels severity but documents no
  suppression of low-confidence findings.
- **No tool documents requiring a reproduction or a failing test as a precondition for a finding.**
  The nearest first-party statement in this whole space is Anthropic's "show evidence rather than
  asserting success", which is about the *builder*, not the reviewer.
- **Greptile's documentation could not be retrieved** (two fetch attempts, socket closed). Nothing
  about Greptile is asserted here.

### 3.4 Review rounds and diminishing returns

**[unsourced].** No primary source was found measuring defects-per-round across *LLM* review
iterations. Searched arXiv and the three vendors. What exists:

- The one directly relevant measurement points the **opposite** way: repeated independent review
  passes *improve* F1 by 43.67% (SWR-Bench self-aggregation at n=10). That is parallel aggregation,
  not sequential fix-and-re-review, so it does not license an unbounded round cap either.
- Human-review diminishing-returns findings (Fagan-lineage inspection studies, the "one hour" rule)
  concern reviewer fatigue and do not transfer to a model.
- Anthropic's nearest statement is behavioural, not quantitative: a reviewer "will usually report
  some \[gaps], even when the work is sound".

So `queue.md:266-270`'s rule — *"a round that raises no finding the previous round did not already
raise ends the review on that head"* — is a **well-chosen heuristic with no published backing**, and
should be documented as such rather than as a measured threshold. It is also the only stopping rule
in the loop that is derived from the findings themselves rather than from a count, which makes it the
right shape whatever the evidence says.

### 3.5 Techniques worth adopting, each with its source

1. **Name the finding classes that count, in the brief.** "flag only gaps that affect correctness or
   the stated requirements, and treat the rest as optional" (Anthropic best-practices). `queue.md:231`
   currently asks for "every documented-rule violation by number, and any baseline smell, named and
   quoted" — an instruction to enumerate, which is the thing the callout warns about.
2. **Add a refutation pass.** "has a fresh model try to refute the result" (ibid.). Concretely: a
   third cheap subagent whose only job is to try to *kill* each finding from the two reports, and a
   finding that survives is the finding that reaches the verdict. This is also the cheapest available
   approximation of SWR-Bench's aggregation win.
3. **Require an artifact per finding.** Not documented by anyone as a review gate, so propose it as
   this repo's own rule, not as best practice: a finding names a file:line and either a failing
   assertion, a documented RULES.md number, or a quoted line of the issue. Anything else is a note.
4. **Scope the diff, and know that scoping is not suppression** (CodeRabbit). Phase D already scopes
   by delta-per-round, which is right.
5. **Expect prose/style findings to be the worst class** and weight them accordingly: F1 14.30% vs
   26.20% (SWR-Bench). This is the measured justification for demoting exactly the findings the loop
   produces most of.

---

## 4. Mechanically enforcing comment minimalism

### 4.1 What already exists in this repo

- `tools/loop/comment-budget.mjs` — per-file, counts *added* comment lines against added code lines by
  multiset (`addedCounts`), `over()` fires when `comment > FLOOR && comment > code`, `FLOOR = 6`.
- Wired as `check:comments` (`package.json:44`) and run in CI's `lint` **and** `harness` jobs
  (`.github/workflows/ci.yml:397`). The 09-12 note's §5.5 rewrite landed: it reads file bytes, not a
  rendered diff.
- `eslint.config.js` has exactly one comment rule: `@typescript-eslint/ban-ts-comment` (line 108).

**What it cannot catch, against the measured 26% comment churn and 8% comment-only commits:**
a comment-only commit of ≤6 lines; a 40-line banner on a 200-line change (ratio 0.2, passes);
and a comment that restates the line below it at any size.

### 4.2 Core ESLint — the complete comment surface

From the [rules reference](https://eslint.org/docs/latest/rules/). Only three comment rules remain in
core; the rest moved to `@stylistic/eslint-plugin`:

| Rule | Status | Description |
|---|---|---|
| `capitalized-comments` | core | "Enforce or disallow capitalization of the first letter of a comment" |
| `no-inline-comments` | core | "Disallow inline comments after code" |
| `no-warning-comments` | core | "Disallow specified warning terms in comments" |
| `line-comment-position` | deprecated → `@stylistic` | — |
| `multiline-comment-style` | deprecated → `@stylistic` | — |
| `spaced-comment` | deprecated → `@stylistic` | — |
| `lines-around-comment` | deprecated → `@stylistic` | — |

**No core rule caps comment LENGTH, comment DENSITY, or bans JSDoc on non-exported symbols.**
Verified against the rules index; there is no `no-jsdoc` in core.

### 4.3 `eslint-plugin-jsdoc`

| Ask | Answer |
|---|---|
| Cap JSDoc block length | **No rule.** |
| Cap description length | **No rule.** |
| Forbid JSDoc on non-exported symbols | **No rule.** `require-jsdoc` is configurable but does not target exportedness. |
| Complete sentences | `require-description-complete-sentence` — "Requires that block description, explicit `@description`, and `@param`/`@returns` tag descriptions are written in complete sentences." |
| Forbid types redundant with TypeScript | `no-types` — "reports types being used on `@param` or `@returns` (redundant with TypeScript)"; also `no-undefined-types` |
| Ban specific tags | `check-tag-names`; `no-restricted-syntax` ("Reports when certain comment structures are present") |

**The one that matters most here** is
[`jsdoc/informative-docs`](https://gajus.github.io/eslint-plugin-jsdoc/rules/informative-docs):
*"Reports on JSDoc texts that serve only to restate their attached name."* It requires the comment to
contain at least one word not already in the identifier. Options: `aliases` (default
`{"a": ["an", "our"]}`), `uselessWords` (default `["a","an","i","in","of","s","the"]`), `excludedTags`.
Failing: `/** The user id. */` on `let userId`; `/** name */` on `class Name {}`;
`/** @param {number} param - the param */`.

**That is CLAUDE.md's "never: restating the line below" — already implemented, upstream, tested.**
Its limit: it only sees JSDoc blocks attached to a named symbol. It does not see a `//` line comment
above a statement, which is the form this repo's agents actually write.

### 4.4 A custom rule is feasible, and the APIs are documented

From [custom rules](https://eslint.org/docs/latest/extend/custom-rules):

> "ESLint provides the `sourceCode.getAllComments()`, `sourceCode.getCommentsBefore()`,
> `sourceCode.getCommentsAfter()`, and `sourceCode.getCommentsInside()` to access them."

Comments are not AST nodes; report with a `loc`, and the fixer's `removeRange(range)` deletes one.
`meta.schema` is mandatory when the rule has options; `meta.fixable` is mandatory for a fixable rule.

**typescript-eslint exposes the same trivia** — not by documentation, but by its own source. The
shipped `ban-ts-comment` rule does exactly this:

```ts
const comments = context.sourceCode.getAllComments();
comments.forEach(comment => { … if (comment.type === AST_TOKEN_TYPES.Line) { … } });
context.report({ node: comment, messageId: 'tsIgnoreInsteadOfExpectError', … });
```
— [`packages/eslint-plugin/src/rules/ban-ts-comment.ts`](https://github.com/typescript-eslint/typescript-eslint/blob/main/packages/eslint-plugin/src/rules/ban-ts-comment.ts)

**[unsourced]** The typescript-eslint
[custom-rules guide](https://typescript-eslint.io/developers/custom-rules) does not mention `SourceCode`
or comment APIs at all. The capability is demonstrated by its own rule source, not documented in the guide.

### 4.5 Published plugins that ban comments

| Plugin | What it does |
|---|---|
| [`eslint-plugin-no-comments`](https://github.com/wisniewski94/eslint-plugin-no-comments) | `disallowComments`; allow-list (defaults exempt `eslint`/`global` directives) |
| [`eslint-plugin-no-comment`](https://github.com/Ryandev/eslint-plugin-no-comment) | flags commented-out code |
| [`eslint-plugin-no-commented-code`](https://github.com/fernandotonon/eslint-plugin-no-commented-code) | disallows commented-out code, line and block |

None caps length or density. **[unsourced]: no published rule or plugin was found that caps or bans
comments in test files specifically.** Searched npm and GitHub.

### 4.6 Recommendation

**Adopt, no code:**

```js
// eslint.config.js
"jsdoc/informative-docs": "error",     // restating the attached name — CLAUDE.md's rule, upstream
"no-inline-comments": "error",         // core
"jsdoc/no-types": "error",             // "a contract the types can't carry" — not one they already carry
```

**Write one rule, because nothing upstream covers it.** `tools/loop/eslint-rules/comment-shape.js`,
two options, both pure-lexical so it needs no type information:

```js
// meta.schema: [{ type: "object", properties: {
//   maxBlockLines: { type: "integer" },       // default 5
//   restatementRatio: { type: "number" } } }]  // default 0.6
create(context) {
  const src = context.sourceCode;
  return { Program() {
    // Group consecutive Line comments + each Block comment into one "block".
    for (const block of groupComments(src.getAllComments())) {
      if (block.lines > maxBlockLines)
        context.report({ loc: block.loc, messageId: "tooLong", data: { n: block.lines } });
      // "restates the line below": tokens of the comment, minus uselessWords, that do not
      // appear in the identifiers of the next non-comment token's statement.
      const next = src.getTokenAfter(block.last, { includeComments: false });
      if (next && novelWordRatio(block.text, statementIdents(next)) < restatementRatio)
        context.report({ loc: block.loc, messageId: "restates" });
    }
  }};
}
```

`groupComments` merges adjacent `//` lines (same column, consecutive `loc.start.line`) so a 12-line
`//` banner counts as 12, not as twelve 1-line comments — that grouping is the whole rule. The
restatement half is `jsdoc/informative-docs`'s algorithm (novel-word ratio against the attached
identifier) applied to line comments and the statement below instead of to JSDoc and its symbol;
borrow its `uselessWords` default list. **[unsourced]** that this generalisation holds for line
comments — `informative-docs` is only specified for JSDoc. Land it as `warn` for one ticket, read
what it catches, then decide the threshold from that rather than from this document.

**Keep `comment-budget.mjs`.** It measures a different thing (per-change ratio) than the rule measures
(per-block shape), and neither subsumes the other. Two gaps in it that the measurements name:

- `FLOOR = 6` exempts every comment-only commit of ≤6 lines, and 8% of commits change only comments.
  A comment-only change has `code === 0`, so the ratio arm can never save it — the floor is doing all
  the work. Consider a second, lower floor when `code === 0`.
- It runs on `*.mjs|js|ts|tsx` only. Tests are in that set, which is right, but there is no separate
  budget for them; a test file's comment density is the least defensible in the repo.

---

## 5. Suppressing comment writing before it happens

### 5.1 The ladder, weakest to strongest

| Mechanism | Binds? | Reaches subagents? | Source |
|---|---|---|---|
| `CLAUDE.md` | **Advisory.** "Unlike CLAUDE.md instructions which are advisory, hooks are deterministic and guarantee the action happens." | Yes — a non-fork subagent receives "Project CLAUDE.md" | [best-practices](https://code.claude.com/docs/en/best-practices), [agent-sdk/subagents § What subagents inherit](https://code.claude.com/docs/en/agent-sdk/subagents) |
| Output style | Changes the system prompt every turn | **No.** "Output styles apply to the main conversation and to a fork… Other subagents run their own system prompt, so styles don't change how they respond." | [output-styles](https://code.claude.com/docs/en/output-styles) |
| `--append-system-prompt` / `--append-system-prompt-file` | "Appends to the system prompt without removing anything" | **[unsourced]** — not documented either way | [output-styles](https://code.claude.com/docs/en/output-styles), [headless](https://code.claude.com/docs/en/headless) |
| Skill | Loaded on demand / preloadable per agent (`AgentDefinition.skills`) | Yes, if listed | [agent-sdk/subagents](https://code.claude.com/docs/en/agent-sdk/subagents) |
| `PreToolUse` hook returning `deny` | **Yes, hard.** | **Yes** | [hooks](https://code.claude.com/docs/en/hooks) |

**A trap worth naming:** a *custom* output style is the wrong tool here and would make things worse.
"Custom output styles **leave out Claude Code's built-in software engineering instructions, such as
how to scope changes, write comments, and verify work**, unless `keep-coding-instructions` is set to
`true`" ([output-styles](https://code.claude.com/docs/en/output-styles)). Claude Code already ships
comment guidance in its own system prompt; a style file without that flag deletes it. If a style is
used at all, `keep-coding-instructions: true` is mandatory.

The built-in **Concise** style (v2.1.237+) is about response text, not generated code: "Claude leads
with the result, skips preamble and narration… while doing the engineering work as thoroughly as in
the Default style." It is the right answer to `queue.md:443`'s "if you catch yourself narrating",
and the wrong answer to comments in the diff.

### 5.2 `PreToolUse` can reject an Edit/Write — the exact shape

**Input** ([hooks reference](https://code.claude.com/docs/en/hooks)) — common fields plus:

```json
{ "tool_name": "Edit", "tool_input": { … }, "tool_use_id": "toolu_01ABC123..." }
```

`tool_input` carries the tool's own arguments, so for `Write` that is `file_path` and `content`, and
for `Edit` `file_path`, `old_string`, `new_string`. **The hook sees the text before it is written.**

**Three ways to deny**, all documented:

```bash
# 1. exit 2 + JSON (reason taken from permissionDecisionReason)
jq -n '{hookSpecificOutput:{hookEventName:"PreToolUse",
        permissionDecision:"deny",
        permissionDecisionReason:"Comment block exceeds 5 lines"}}'; exit 2
# 2. exit 2 + stderr (stderr becomes the reason)
echo "Blocked: comment restates the line below" >&2; exit 2
# 3. exit 0 + JSON permissionDecision:"deny"
```

- "Exit 2 means a blocking error. On events that can block, exit 2 blocks whether or not you print
  JSON: even a JSON `permissionDecision` of `"allow"` can't override it."
- With `"deny"`, "Claude Code cancels the tool call and feeds `permissionDecisionReason` back to
  Claude" — so the model is *told why* and can rewrite the edit.
- `permissionDecision` belongs **inside** `hookSpecificOutput`; at the top level it is silently
  ignored (`claude --debug` logs `Hook JSON output had unrecognized keys`).

**Registration**, matcher on the tool name
([hooks-guide](https://code.claude.com/docs/en/hooks-guide) — this is the doc's own `Edit|Write` example):

```json
{ "hooks": { "PreToolUse": [ { "matcher": "Edit|Write",
  "hooks": [ { "type": "command",
               "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/comment-shape.mjs" } ] } ] } }
```

**Why it is a real boundary, not a suggestion:**

- "`PreToolUse` hooks fire before any permission-mode check, in every permission mode, including
  `dontAsk`. A hook that returns `permissionDecision: "deny"` blocks the tool even in
  `bypassPermissions` mode or with `--dangerously-skip-permissions`."
- It fires for subagents: "Background subagents can't show a prompt in non-interactive mode.
  **Claude Code still runs the hooks for their tool calls**, and if no hook returns a decision, it
  denies the call."
- Multiple hooks: "the most restrictive answer applies, in the order `deny`, `defer`, `ask`, `allow`",
  and "One hook returning `deny` doesn't stop sibling hooks from executing."

This is the same mechanism `tools/loop/guard-bash.mjs` already uses for `Bash|PowerShell`; extending
the pattern to `Edit|Write` is the repo's existing shape, not a new one.

### 5.3 The judgement case: a `prompt` hook at Haiku prices

For "does this comment restate the line below", a regex is the wrong instrument and a second Opus is
absurd. Claude Code has a first-party middle:

> "For decisions that require judgment rather than deterministic rules, use `type: "prompt"` hooks.
> Instead of running a shell command, Claude Code sends your prompt and the hook's input data to a
> Claude model, **Haiku by default**, to make the decision… `PreToolUse`: the tool call is denied;
> by default the turn ends and the deny `reason` appears in the chat as a warning line. **Set
> `continueOnBlock: true`** on the hook to instead return the `reason` to Claude as the tool error,
> so it can adjust and continue."
> — [hooks-guide § Prompt-based hooks](https://code.claude.com/docs/en/hooks-guide)

`continueOnBlock: true` is the load-bearing flag: without it a denied edit **ends the turn**, which in
an unattended loop is a killed ticket rather than a corrected comment.

A `type: "agent"` hook also exists (multi-turn, tool access, 60s default, ≤50 turns) but the guide
marks it **experimental** and says "For production workflows, prefer command hooks."

---

## 6. What this means for `tools/loop`

Ordered by measured value, not by how interesting each is.

**6.1 — 44% of spend, one word per subagent brief.** Change phase D's two reviewers from `opus` to
`sonnet` in `.claude/commands/queue.md:226`. Sonnet 5 is 0.4× Opus 5 on base input, cache read *and*
output ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)), and review is 73% of
tokens. Anthropic documents Sonnet 5 as the tier for "everyday coding, agent, and enterprise
workloads" and Haiku's examples explicitly include "sub-agent tasks"; there is **no published evidence
that a reviewer benefits more from Opus than a builder does** (§2.2), and the one benchmark in play
favours running more cheap reviews over fewer expensive ones (§2.3). Keep phase C on Opus 5 — it is
14% of tokens and the phase the docs describe Opus for. Haiku is out for D and F: 200K context against
a 187k p90 and a 310k close.

**6.2 — Delete the polls, one env var.** Add `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1"` to the env
`queue-loop.mjs` passes to the session. In `-p` mode fork mode is off, so subagents default to
background, and asking a background subagent about its progress is documented to produce exactly the
`Waiting.` turn that 44 invocations contain. The env var forces foreground "in every kind of session",
which makes the Agent tool call a blocking await. Worth ~1% of tokens and 29% of invocations; it also
removes the 10-minute `-p` background wait ceiling as a silent result-dropping vector. Confirmed
present in the installed `claude.exe` 2.1.270.

**6.3 — Tell the reviewers what counts as a finding.** `queue.md:231` asks for "every documented-rule
violation by number, and any baseline smell" — an instruction to enumerate. Anthropic's own guidance
is the correction: "flag only gaps that affect correctness or the stated requirements, and treat the
rest as optional", "Report gaps, not style preferences". SWR-Bench measures the same asymmetry the
callout predicts: F1 26.20% on logic errors against 14.30% on textual/documentation changes. Demote
the class the loop produces most of.

**6.4 — Add the refutation pass phase D lacks.** "a fresh model try to refute the result, so the agent
doing the work isn't the one grading it" is documented, and the loop uses it for the *code* and not
for the *findings*. One cheap subagent whose only job is to kill findings, and a surviving finding is
what reaches the verdict. This is also the affordable approximation of the only intervention the
literature shows working (+43.67% F1 by aggregation, on a *fast* model).

**6.5 — Make the round cap's justification honest.** `queue.md:264-270` is right in shape — stop when
a round earns nothing — and **[unsourced]** in its premise: no published measurement of LLM
review-round diminishing returns exists, and the nearest evidence points the other way. Say that in
the file rather than implying a threshold was measured.

**6.6 — Two comment enforcers, neither of which the repo has.**
- Turn on `jsdoc/informative-docs` in `eslint.config.js`. It is CLAUDE.md's "never restate the line
  below", already written and tested upstream, for the JSDoc case.
- Write `comment-shape.js` (§4.6) for the case nothing upstream covers: consecutive `//` lines grouped
  into one block, capped, and checked for novel words against the statement below. `getAllComments()`
  and `context.report({node: comment})` are exactly what `@typescript-eslint/ban-ts-comment` does.
- Close `comment-budget.mjs`'s two holes: `FLOOR = 6` exempts every comment-only commit of ≤6 lines
  (8% of commits change only comments, and for those `code === 0` so the ratio arm is dead), and test
  files get the same budget as source.

**6.7 — If a comment must be stopped before it is written, the mechanism is `PreToolUse`, not
`CLAUDE.md`.** CLAUDE.md is documented as advisory and the measured 26% comment churn is the evidence
that it is. A `PreToolUse` hook on `matcher: "Edit|Write"` sees `tool_input.content` /
`tool_input.new_string` before the write, denies with
`hookSpecificOutput.permissionDecision: "deny"` plus a reason Claude is shown, fires "before any
permission-mode check, in every permission mode", and **runs for subagents' tool calls too**. For the
judgement half, a `type: "prompt"` hook runs on Haiku by default — but it **must** carry
`continueOnBlock: true`, or a denied edit ends the turn, which in an unattended loop kills the ticket
instead of fixing the comment. Do not reach for a custom output style: one without
`keep-coding-instructions: true` deletes Claude Code's own built-in instructions on "how to scope
changes, **write comments**, and verify work", and no output style reaches a non-fork subagent at all.

**6.8 — The bigger shape, if 6.1–6.2 are not enough.** Move phase D out of the session entirely: the
supervisor runs the two reviews as two concurrent `claude -p` processes and `Promise.all`s them.
Node awaits two processes for free, the orchestration costs zero model turns, and the session's
phase D collapses to reading two files and emitting one `VERDICT:` line. This is the same argument
the 09-12 note made for the merge — a model reading a CI log to decide that green means merge is a
model spending turns on a switch statement — applied to the phase that costs 73%. The SDK has no
documented handle for awaiting one subagent from outside a query (**[unsourced]**), so two processes,
not one process with two subagents, is the shape that actually gives Node something to await.

---

## What could not be verified from a primary source

Collected so no reader has to re-derive it:

1. **No Anthropic guidance or benchmark on reviewer-model strength vs builder-model strength**, in
   either direction (§2.2). The one first-party artifact is an illustrative code comment.
2. **No published evidence on LLM review-round diminishing returns** (§3.4). The nearest measurement
   favours more passes, not fewer.
3. **No documented confidence gating** in CodeRabbit or Copilot code review; no tool documents
   requiring a reproduction or a failing test as a precondition for a finding (§3.3).
4. **Greptile's documentation could not be retrieved** — two fetch attempts failed. Nothing about it
   is claimed here.
5. **No documented per-invocation way to force a subagent into the foreground**; the session-wide
   env var is the only hard lever (§1.2).
6. **No documented SDK handle for awaiting one individual subagent** from outside the `query()` (§1.4).
7. **Not documented whether `--append-system-prompt` reaches subagents** (§5.1).
8. **typescript-eslint's custom-rules guide does not document the comment APIs** — the capability is
   established from its own shipped rule source instead (§4.4).
9. **No published ESLint rule or plugin caps or bans comments in test files specifically** (§4.5).
10. **`jsdoc/informative-docs`' novel-word algorithm is specified for JSDoc only**; generalising it to
    line comments is this document's proposal, not an upstream guarantee (§4.6).
11. The Claude Code **environment-variable reference page truncated** on fetch. The six variables named
    here were instead confirmed by string-grep against the installed `claude.exe` 2.1.270, and their
    semantics quoted from the pages that describe them (sub-agents, headless, agent-sdk/subagents).

---

## Sources

**Anthropic, first-party:**
[sub-agents](https://code.claude.com/docs/en/sub-agents) ·
[agent-sdk/subagents](https://code.claude.com/docs/en/agent-sdk/subagents) ·
[hooks reference](https://code.claude.com/docs/en/hooks) ·
[hooks guide](https://code.claude.com/docs/en/hooks-guide) ·
[headless](https://code.claude.com/docs/en/headless) ·
[tools-reference](https://code.claude.com/docs/en/tools-reference) ·
[best practices](https://code.claude.com/docs/en/best-practices) ·
[output styles](https://code.claude.com/docs/en/output-styles) ·
[pricing](https://platform.claude.com/docs/en/about-claude/pricing) ·
[models overview](https://platform.claude.com/docs/en/about-claude/models/overview) ·
[choosing a model](https://platform.claude.com/docs/en/about-claude/models/choosing-a-model)

**Linting:**
[ESLint rules index](https://eslint.org/docs/latest/rules/) ·
[ESLint custom rules](https://eslint.org/docs/latest/extend/custom-rules) ·
[typescript-eslint custom rules](https://typescript-eslint.io/developers/custom-rules) ·
[`ban-ts-comment.ts`](https://github.com/typescript-eslint/typescript-eslint/blob/main/packages/eslint-plugin/src/rules/ban-ts-comment.ts) ·
[`jsdoc/informative-docs`](https://gajus.github.io/eslint-plugin-jsdoc/rules/informative-docs) ·
[eslint-plugin-jsdoc](https://github.com/gajus/eslint-plugin-jsdoc) ·
[eslint-plugin-no-comments](https://github.com/wisniewski94/eslint-plugin-no-comments)

**Review tooling and research:**
[CodeRabbit configuration](https://docs.coderabbit.ai/reference/configuration) ·
[CodeRabbit review instructions](https://docs.coderabbit.ai/guides/review-instructions) ·
[Copilot code review](https://docs.github.com/en/copilot/using-github-copilot/code-review/using-copilot-code-review) ·
[SWR-Bench, arXiv 2509.01494](https://arxiv.org/abs/2509.01494) ·
[Too Noisy To Learn, arXiv 2502.02757](https://arxiv.org/abs/2502.02757)

**Measured on this machine:** `claude --version` → 2.1.270; string-grep of
`C:\Users\roton\.local\bin\claude` for `run_in_background` (36),
`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` (4), `CLAUDE_CODE_SUBAGENT_MODEL` (15),
`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` (5), `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` (4),
`SubagentStop` (27), `permissionDecision` (33); and the repo's own
`tools/loop/comment-budget.mjs`, `tools/loop/check-steps.mjs`, `package.json:44`,
`.github/workflows/ci.yml:397`, `eslint.config.js:108`.
