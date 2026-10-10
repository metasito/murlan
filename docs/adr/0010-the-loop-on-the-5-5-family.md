# 0010. The loop on the 5.5 family: no Haiku executor, effort by round, Opus review

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

1. **The builder stays Opus 5.5, and there is no advisor.** A fix round costs a full review and a
   CI cycle, which is far more than the per-turn gap between Haiku and Opus. A Haiku executor
   loses solve rate, and an advisor it is not told to call adds nothing. Making Opus an
   orchestrator over Sonnet or Haiku builders was also rejected: Anthropic found delegation
   pays only on routine work or on work too large for one context window, and a ticket build is
   one dependent chain that fits in one.
2. **A fresh ticket is built at `medium`; a fix round at `high`.** `EFFORT_BY_PHASE` puts A and B
   at `medium`. The process that starts at A carries the build through C and D. A process that
   starts at C (a CI-red round) or D (a review round, and the HOLD fix it makes) stays at `high`.
   This is Anthropic's "low first, re-run the failures higher" trade, with the review and CI as
   the failure signal.
3. **Review runs on Opus at `medium`.** Rule 29's reviewers and refuter were `sonnet`, and their
   measured failure was precision. A false finding costs a HOLD round and a missed one costs a CI
   round, and either is a whole Opus process. Opus 5.5 at `medium` costs about 1.4 times a
   Sonnet 5.5 reviewer at `high`. The refuter stays, but on Opus: a weaker model refuting a
   stronger one's findings would kill true ones. `MODEL_BY_KIND` in `brief.mjs` holds each brief
   kind's model, and `guard-agent-model.mjs` denies a dispatch on any other.
4. **Recon and verification subagents run Sonnet at `medium`.** This covers scope, completeness
   and long reads. The effort is set with the Agent tool's `effort` parameter (Claude Code 2.1.292).
5. **Haiku 5.5 is not adopted for any loop subagent yet.** Its coding gap makes a wrong scope map
   likely, and the subagents' share of a ticket's cost bounds the saving.
6. **`loop-cost` prices each 5.5 release at its own rate**, including Haiku 5.5's long-prompt tier.
7. **Every `PreToolUse` guard is `onFailure: "block"`.**

## Consequences

- `loop-cost` must show the effort and reviewer changes paying off: cost per landed ticket, and
  HOLD and CI-red rounds per ticket, against the nights before this change. If first-build
  failures rise enough to eat the saving, A goes back to `high`. If Opus review does not cut
  rounds, the reviewers go back to `sonnet`.
- A guard that cannot run (node missing, a syntax error, a crash past its own `catch`) now stops the
  tool call instead of waving it through. This applies to interactive sessions too. Each guard
  still exits 0 on a payload it cannot read. The loop machine needs Claude Code 2.1.295 or later
  for `onFailure` and 2.1.292 or later for a subagent's `effort`; autoupdate is off there.
- Rows logged from 5.5 sessions show lower absolute prices and a different model share. Rows from
  Opus 5 and Sonnet 5, and rows spelled as a bare alias, keep the old family rate. The per-ticket
  dollar caps read Claude Code's own `total_cost_usd`, so they do not move.
- The context ceilings are not raised. Claude Code's docs say native-1M models compact near 967k,
  but every loop session that reached compaction compacted at 366–368k
  (`tools/loop/tests/queueLoop.test.ts`). Until a 5.5 session is seen to compact later, the 340k bound stands.
