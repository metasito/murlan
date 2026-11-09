# 0019. The ruleset stays under its line cap, and a new rule frees a line first

**Status:** Accepted
**Date:** 2026-11-09

## Context

`docs/agents/RULES.md` was at 118 of 120 lines when rule 53 needed one (#1988 item 39), and the cap in
`tests/tooling/rulesAreSingleSourced.test.ts` was moved to fit it. #2004 weighed rule 47
against rule 48, the likeliest overlap, and found no rule redundant. The question that stayed open
was whether the cap itself should give.

## Decision

1. **The cap stays.** A ruleset nobody finishes is not enforced; the line count is the measure of
   that and is not loosened to fit a rule.
2. **A rule that does not fit frees a line first**, by merging two rules that name the same
   decision or retiring one in place (`*(retired)*`, which keeps the numbering). The review that
   reads the diff decides which, and records it in the commit that adds the rule.
3. **No rule is retired today.** Rules 47 and 48 each name a distinct decision (a module offers
   decisions rather than steps; one decision has one copy).

## Consequences

The next rule is a two-line trade, argued in review, not a cap edit. A change that raises the cap
without retiring a rule is a breach of this record.
