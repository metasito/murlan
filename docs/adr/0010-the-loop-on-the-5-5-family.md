# 0010. The loop on the 5.5 family: no Haiku executor, measured effort, guards that fail closed

**Status:** Accepted
**Date:** 2026-10-10

## Context

The owner asked whether the loop should move to the "advisor mode" that shipped with the 5.5
family: a Haiku 5.5 executor that consults Opus at decision points, which was expected to cut cost,
handoffs and context. Opus 5.5 (2026-09-22), Sonnet 5.5 (09-28) and Haiku 5.5 (10-07) are out, and
Claude Code 2.1.293 accepts Haiku 5.5 as both main model and advisor. Anthropic's own numbers:

- **The advisor is only used when it is asked for.** On GPQA Diamond, Haiku 5.5 and Sonnet 5.5 each
  ran with an Opus 5.5 advisor and no prompt asking for it. Neither called it on any of 198
  questions, so the advisor gained nothing. Anthropic's rule: "first price the advisor's model
  alone at low effort; that is the baseline to beat."
  ([cost and intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence))
- **Opus 5.5 is now the cheap option per solved coding task.** On SWE-bench Pro, Opus 5.5 at
  `medium` solved 92.8% at $0.22 per solved task. Sonnet 5 solved 77.4% at $0.84 and Fable 5.1
  92.3% at $1.19. Opus 5.5 with a Fable 5.1 advisor scored 1.7 points over Opus 5.5 alone at
  `high`, for 2.1 times the cost: about what more effort buys.
- **Haiku 5.5 is a subagent model, not a builder.** It reportedly scores 64.8% on SWE-bench Pro
  against 81.3% for Sonnet 5.5. Anthropic positions it for "summaries, subagent work on coding
  tasks", classification and routing. Every rate is five times higher on a request whose prompt is
  over 100k tokens. It also keeps every earlier thinking block in context.
- **Effort defaults moved.** Opus, Sonnet and Haiku 5.5 default to `medium`. Claude Code's guidance
  is to start Opus 5.5 at `medium`, not at Opus 5's level, and to keep `high` for "bug fixes in
  existing codebases where verification matters". On SWE-bench Pro, `medium` gave up about 2.5
  points against `high` at about 70% of the cost. Running at `low` and re-running only the failures
  at `high` reached 97% at $0.17 per task, against 95.3% at $0.29 for everything at `high`.
- **Prices changed under `loop-cost`.** Opus 5.5 is $4 in and $20 out, with cache reads at $0.20
  (Opus 5: $5, $25, $0.50). Sonnet 5.5 cache reads are $0.10. Haiku 5.5 is $0.10 in and $0.50 out.
  `PRICE` priced all three at their family's older rate.
- **Hooks can now fail closed.** Since Claude Code 2.1.295, `onFailure: "block"` blocks the action
  when a command hook cannot start, times out, or exits with a code other than 0 or 2. Without it,
  a guard that crashed let the tool call through: a safeguard that is green because it never looked.

## Decision

1. **The builder stays Opus 5.5.** A fix round in this loop costs a full review and a CI cycle,
   which is far more than the gap between Haiku and Opus per turn. The evidence above says a Haiku
   executor loses solve rate, and an advisor it is not told to call adds nothing. `--advisor` is not
   passed to `queueLoopArgs`.
2. **An advisor is adopted only once an A/B on the loop's own tickets shows a gain**, measured with
   `loop-cost` as cost per landed ticket and fix rounds per ticket. Two candidates are worth a run:
   Opus 5.5 at `medium` with an Opus advisor for `size:XS`/`size:S`, and Sonnet 5.5 with an Opus
   advisor for processes that start at E/F. Either run's prompt has to tell the executor when to
   consult: before the first write, when an error recurs, and before `LOOP-RESULT`.
3. **Effort is swept before it is changed.** `EFFORT_BY_PHASE` stays `high` for A to D for now. The
   process that starts at A carries on through C and D, so lowering A's effort lowers the build's.
   The sweep compares `medium` with `high` on ticket outcomes. The Agent tool's `effort` parameter
   (2.1.292) can lower review and scope subagents' effort without touching the builder's.
4. **Haiku 5.5 is a candidate only for read-and-summarise subagents**, such as phase B's scope map
   and phase C's long-log reads, and only behind the same A/B. Reviewers and the refuter stay
   `sonnet` (rule 29: precision is the measured failure). A Haiku dispatch must keep its prompt
   under 100k, or it pays five times the rate.
5. **`loop-cost` prices each 5.5 release at its own rate**, including Haiku 5.5's long-prompt tier.
6. **Every `PreToolUse` guard is `onFailure: "block"`.**

## Consequences

- A guard that cannot run (node missing, a syntax error, a crash past its own `catch`) now stops the
  tool call instead of waving it through. Each guard still exits 0 on a payload it cannot read, so
  that path is unchanged.
- Rows logged from 5.5 sessions show lower absolute prices and a different model share. Rows from
  Opus 5 and Sonnet 5, and rows spelled as a bare alias, keep the old family rate.
- The advisor, effort and Haiku questions are A/B experiments, still to be filed as tickets and run.
  Until one lands, rule 29 and `MODEL_BY_PHASE` are unchanged.
- `guard-context.mjs` and `CONTEXT_BY_SIZE` still assume auto-compaction at about 366k. Claude Code
  now compacts native-1M models (Opus 5.5 included) at about 967k. The handoff ceilings are a cost
  choice that is still valid, but the 340k bound that clamps `LOOP_CONTEXT` should be
  re-derived when the context experiment runs.
