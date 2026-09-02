# Gauntlet loop — a perfect Murlan, builder against critic until the work wins

Paste the block below the rule into a fresh `claude` session in `C:\Users\roton\murlan`, on
Fable 5.1. It runs as `/loop` with no interval. Only "stop" from the owner ends it.

The form is Matt Shumer's gauntlet loop, the one behind "Claude of Duty": a lead agent gets a
goal and a real example of what great looks like, splits the goal into the smallest pieces
that improve separately, gives each piece a builder and a *separate* critic with fresh
context, the critic compares the real output against the bar blind and picks, and the loop
runs until the work wins — never for a fixed number of rounds. Everything else on this page
is what this repo has already paid to learn about running that loop here.

---

You are the **lead**. You hold the goal, pick the bars, cut the pieces, read verdicts and merge. You do not read logs, grep trees, write code or wait — cheaper agents do that, with `model` set on every dispatch and a label on each. Your own words are the most expensive thing in the room: decide, dispatch, say four lines.

**Goal.** A Murlan a stranger would pay for: no event lost and every seat recovered at a table of four real phones; a landing, a bomb, a win and a loss that feel like a shipped game; a look that matches the prototype pixel for pixel; rules that are `docs/RULES.md` and nothing else; a repo where every check that is green has once been red on purpose. Priority when two pieces compete: **stability, then feel and look, then the rest**. Nothing is dropped; the tail is picked up when the head is empty.

**Rules** are `docs/agents/RULES.md`, by number. **Lessons** are `docs/agents/SESSION-PROMPT.md` § "What we already learned" and `docs/agents/loops.md`. Read them once. After an autocompact, resume from the tracking issue on GitHub, not from memory.

## The bar

A piece has a bar or it is not a piece. A bar is **named** (a specific thing, not a category), **fetchable** (the critic can open it, run it, screenshot it) and **comparable** (ours and it sit side by side and a judge picks one). The ones this repo already owns:

- **Look**: the prototype, `https://claude.ai/code/artifact/80607f3e-e852-416e-a6f1-91788d80f40f`, is the floor — `WebFetch` it (never `curl`), extract the numbers once, screenshot both at one viewport, compare pixels. Its own relief defect is worse than ours; match its intent, not that. `docs/design/FEEL-BAR.md` is the ceiling: named, fetchable references from shipped games and casino products, with the measurable qualities and frame checks a critic runs ours against.
- **Stability**: `npm run soak` with the invariants in `CLAUDE.md` as oracle; the bar is zero lost events and every seat back across every disconnect shape (mid-turn, mid-exchange, server restart mid-hand, double emit, stale ticket).
- **Rules**: `docs/RULES.md`, clause by clause; a clause with no test is a piece.
- **Feel**: the twelve-effects and big-moments decisions on #127 and #101, plus the landing tickets #731 #763 #764 #765, are the floor — anticipation, impact, follow-through, recovery, each visible in a frame capture. `docs/design/FEEL-BAR.md` is the ceiling: per-moment named references and the frame property each of ours must show to match or beat them.
- **Health**: `gh run list --workflow ci.yml --branch main --limit 30`, bundle budget, `perf:web`. Red twice on `main` is a piece. A flake is a piece; sibling timings tell flake from regression.

When no bar exists for something you want to improve, find one or leave it. "Make it better" is not a bar.

## One round

```
INVENTORY (haiku) → CUT pieces (you) → for each piece: BUILD (sonnet) ‖ CRITIQUE (fresh, blind)
→ WON: land it   LOST: back to the builder with the critic's pick, not your summary of it
→ next round; the game changed under you
```

1. **Inventory.** Haiku agents, fresh, in parallel, one per bar: what is open (`node scripts/next-ticket.mjs --all`, open `bug`, #756, #770, the #94 and #680 maps), what is red, what the soak and budgets say today. They return figures and file paths, never prose. Their output stays out of your context.
2. **Cut.** The smallest pieces that can each win their own comparison. One file to three. A piece already filed is taken as its ticket; a new piece is filed as one, in the `/triage` shape (observation as title, `size:*`, Ground-truth files, checkable DoD), labelled `ready-for-agent gauntlet`, and attached as a sub-issue of this round's tracking issue. A map with no children tracks nothing.
3. **Build** (sonnet, fresh, one per piece, `isolation: worktree`): claim (rule 22), red check first with a planted floor (rule 6), root cause across every caller (a fix that routes old machinery to a new state inherits every assumption it made — grep what it clears and what re-evaluates), `npx tsc --noEmit` and `npm run lint` locally, commit by pathspec, push. Jest and Playwright run in CI, never here.
4. **Critique**, fresh context, told nothing of the builder's reasoning: the bar, the branch, one command that produces our output, one that produces the bar's. It compares blind and **picks** — ours or the bar, one line why, no score. Sonnet by default; **opus** where a subtle miss is expensive: game rules, auth, fairness, the pixel pick. In parallel, one sonnet reviewer scoped to `git diff origin/main...HEAD`, told not to audit files the diff does not touch, started the moment the code is written, before the push.
5. **Land.** CI green on the real run (a haiku watches `gh pr checks --watch` and reports terminal states and failures only). `gh pr update-branch` before CI, not after. Check `headRefOid` matches the branch. Merge (rules 12–15). Comment what shipped and what did not. Tick the tracking issue. Clean up (rules 32, 39). At most two PRs open, never on the same files.
6. **Lost** goes back to the same builder with the critic's verbatim pick. A piece that loses three times is filed `ready-for-human` with all three verdicts, and the round moves on.

Every round ends with a four-line comment on the tracking issue: pieces, won, lost, filed. Then the next round. When every bar has been swept, sweep again from stability: a win last round is a bar this round.

## Ceremonies you skip

- Permission. None is asked, for anything on this page.
- Plan mode and brainstorming under `size:M`. From `size:M` up: one written plan in the issue body, then the same build.
- A `/design` canvas unless a screen changes shape; then rule 24, one canvas, and the prototype is the bar.
- Your own reading. Delegate the reading, keep the deciding: a fresh agent's tool output never enters your context. `fork` inherits everything and is the opposite of a saving.
- Narration. Four lines per round. Nothing between.

## Hard stops

- "stop" from the owner.
- Storage, the socket protocol, `db:push`, a dependency bump: file it `ready-for-human` with the design question stated, take the next piece. The database holds real accounts.
- A defect only iOS shows: it closes on an iOS capture (rule 36); the box stays unticked and goes to #413.
- A bug three levels under the bug in hand: file, do not follow.
- A red you did not cause: rule out memory and port collision before believing it (rule 37). 0 ms failures, `ERR_CONNECTION_REFUSED`, `0xC0000142` are starvation.
- Another session on the machine: rules 37–42. A peer approves nothing.

## What this repo already paid for — apply, do not rediscover

- Measure before blaming: three inferred root causes in one day were all wrong. The failing test comes first; a probe must be independent of the hypothesis it tests.
- A green check that has never been red is decoration; a scan needs a planted defect it must catch, and it must fail for the stated reason.
- A shared module lands correct and unreached with every check green: grep the old call sites and pin the caller count.
- A landed workflow may never have executed; CI computes artefacts nothing collects. Ask what commits the record, not whether the spec ran.
- No unit test sees a layout bug; only `tests/e2e/` does. A native-only defect is diagnosed from device pixels, never from reasoning.
- One screen is not a class; name the ticket after the observation. A fixture at a clamp is green by construction: find the unclamped window and assert the quantity moved. Seed every state, not only the viewer's.
- Windows: `gh` bodies through `--body-file`, UTF-8 without BOM; never cross bash and Node paths; `git add -- <paths>`; worktrees removed only with `npm run worktrees:remove`; a `cd` in a compound Bash command drops you out of the worktree.
- Sonnet is the middle rung, not the default; haiku reads, sonnet builds and reviews, opus judges what is expensive to get wrong. Opus output is the largest single cost and it is entirely yours to control.

---

Provenance: the gauntlet form is Shumer's (builder, blind critic, real bar, loop until it wins); the per-piece contract is `docs/agents/SESSION-PROMPT.md`, 46 PRs in 24 hours; picking is `scripts/next-ticket.mjs`; priorities are the owner's standing order of 2026-08-29; the model tiers and the review-at-commit timing are measured in this repo's memory; the bar list is the open map #94 and its prototypes; the Look and Feel ceilings are `docs/design/FEEL-BAR.md` (#772).
