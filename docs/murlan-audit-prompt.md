# Murlan — Full Repository Audit (READ-ONLY, multi-agent)

## 0. Context

- **Repo:** `metasito/murlan` — online multiplayer Murlan (Albanian card game, Big Two family)
- **Working dir:** you are already in the repo. Do not clone anything.

**Derive the rest yourself before doing anything else.** Do not ask me for it, and do not assume it — read it:

- **Stack:** from `package.json` / lockfile / config files / `README`. Runtime, framework, state management, realtime transport, DB, ORM, test runner, bundler.
- **Deploy target:** from CI configs, `Dockerfile`, `vercel.json` / `fly.toml` / `netlify.toml` / `render.yaml`, deploy scripts, or env var names.
- **What changed recently:** `git log --since="8 weeks ago" --oneline --stat` plus `git log --since="8 weeks ago" --name-only --pretty=format: | sort | uniq -c | sort -rn | head -30`. Identify the big refactors and features, and note anything that looks like it was landed in a hurry (large commits, "wip", "fix fix", reverted-then-reapplied, merge conflict artifacts).
- **Unfinished work:** branches not merged, stashes, feature flags that are off, `TODO`/`FIXME`/`HACK`/`XXX` inventory, commented-out blocks, files with no imports.
- **Out of scope:** anything gitignored, vendored, generated, or in `node_modules`. Skip lockfile contents except for dependency analysis.

Write all of this into `00-repo-map.md` and treat it as the shared brief for every agent.

**One thing only I can tell you — my priors on where the mess is:**

> [OPTIONAL BUT WORTH IT: name the 2–4 areas you already suspect are shaky, half-finished, or that you touched last and never fully verified. Leave blank if you'd rather the audit come in cold.]

If that block is blank, do not ask me to fill it — infer the equivalent from commit churn and treat the top-churn files as the suspect set.

---

## 1. Your job

Run a full, evidence-based audit of this repository using parallel specialist subagents.
You are the **orchestrator**. You do not audit anything yourself — you scope, dispatch, verify, and consolidate.

**The deliverable is a findings backlog that a *different* Claude session can implement from cold, without asking me questions.** Optimize every decision for that.

---

## 2. Hard rules — these override everything else

1. **READ-ONLY.** No subagent modifies, creates, or deletes any file outside `audit/<YYYY-MM-DD>/`. No refactors, no "quick fixes", no formatting. If an agent is tempted to fix something, it writes a finding instead.
2. **Evidence or it doesn't exist.** Every finding must cite `path/file.ext:line` (a range is fine) and describe a concrete failure path — what input, what state, what the user or attacker does, what breaks. A finding that cannot name the line is deleted, not softened.
3. **No generic advice.** Banned outputs: "add more tests", "consider TypeScript strict mode", "improve error handling", "follow best practices", "add documentation" — unless tied to a specific named file and a specific concrete consequence. Generic findings are worse than no findings; they bury the real ones.
4. **Verify before reporting.** If an agent suspects a bug, it reads the surrounding code, the call sites, and the tests before writing it up. State whether it was confirmed by reading code, by running something, or is inferred. Inferred findings get `Confidence: Low` and must say what would confirm them.
5. **Distinguish "wrong" from "not my taste."** Style preferences go in a separate `Opinions` section at the bottom of each report, not in the findings list.
6. **Report uncertainty honestly.** If an agent couldn't cover its scope (context ran out, code was too tangled), it says so explicitly in a `Coverage gaps` section. Silent partial coverage is the worst outcome here.

---

## 3. Phase 0 — Recon (single agent, runs first, blocks everything)

Dispatch **one** agent to produce `audit/<date>/00-repo-map.md` containing:

- Directory tree with a one-line purpose per significant directory
- Entry points: server boot, client boot, build scripts
- The game loop: where a turn starts, where it's validated, where state is persisted, where it's broadcast
- Client/server trust boundary: what the server authoritatively owns vs. what the client computes
- State management: stores, reducers, sync mechanism, source of truth
- Data model: tables/collections/schemas and where migrations live
- Realtime layer: transport, event names, room lifecycle, reconnect path
- Test inventory: what exists, what it actually covers, how to run it
- Build/CI: commands, checks, deploy pipeline
- **Hot files:** top 15 files by recent churn (`git log --since=...` by change count) — these are where the half-baked work lives
- **Dead/orphaned code:** files not imported anywhere, feature flags never read, commented-out blocks

Also record baseline health: does the build pass, do tests pass, how long, any existing lint/type errors. Note the current git SHA and branch.

**Then read `00-repo-map.md` yourself before dispatching Phase 1.** Use it to give each specialist a concrete file list, not just a topic.

---

## 4. Phase 1 — Parallel specialists

Before dispatching: read the available custom commands and skills in this project (check `.claude/commands/`, `.claude/skills/`, and any plugin dirs) — specifically `code-review`, `web-quality-audit`, `security-review`, and `ponytail-review`. Read what each actually does, then pass the relevant one to the matching agent below as part of its instructions. Do not assume from the name.

Dispatch these agents **in waves of 4–5 simultaneous Task calls** (all calls for a wave in a single message so they run in parallel). Do not run all ten at once — output quality drops and you'll hit rate limits.

Each agent gets: the repo map, its scope, its explicit file list, the hard rules above, the finding schema below, and its output path. Each agent writes exactly one file and reports back only a summary count by severity.

### Wave A — correctness & trust

**A1 · Security & server authority** → `01-security.md`
Trust boundary violations. Can a modified client see hidden information (other players' hands, deck order)? Forge or replay a move? Play out of turn? Act for another player? Join a room it shouldn't? Check: input validation on every socket event and API route, authz on every mutation, session/token handling, secrets in the repo or bundled into client code, injection surfaces, rate limiting, dependency CVEs (`npm audit` / equivalent), CORS, cookie flags, XSS in any user-controlled string (usernames, chat). Explicitly answer: **what is the cheapest cheat a determined player could pull off today?**

**A2 · Game rules correctness** → `02-rules.md`
Audit the Murlan/Big Two rules engine against correct play. Card ranking and suit ordering, valid combination detection (singles, pairs, triples, straights, bombs/four-of-a-kind, and whatever variants this implementation supports), what beats what, bomb/wildcard precedence, passing and trick-clearing, first-play constraints, turn rotation, end-of-round detection, scoring and any president/asshole card-exchange phase, tie and edge cases (all-pass, simultaneous finish, disconnect mid-trick). Enumerate rules that are implemented but untested, and rules that are documented but not implemented. Where possible, construct a concrete card sequence that produces the wrong result.

**A3 · Netcode, state sync & reconnection** → `03-netcode.md`
Client/server state divergence. Race conditions between optimistic UI and server confirmation. Event ordering guarantees. What happens on: refresh mid-turn, network drop mid-trick, two tabs same account, host leaves, all players leave, server restart with live rooms, slow client, duplicate event delivery. Idempotency of move handling. Timer/turn-clock authority (client-driven timers are a finding). Room lifecycle and memory leaks from abandoned rooms.

**A4 · Resilience & error handling** → `04-resilience.md`
Unhandled rejections, swallowed catches, error paths that leave the UI stuck in a dead state. What the player sees when something fails — is there a way out, or do they have to refresh? Retry logic and its absence. Crash recovery. Logging: is there enough to diagnose a production incident, and is anything sensitive being logged? Graceful degradation.

### Wave B — experience & performance

**B1 · Performance** → `05-performance.md`
Render performance (unnecessary re-renders, missing memoization on hot paths, large lists), animation frame cost and jank, bundle size and code splitting, asset weight (card images, sounds), server hot paths, N+1 queries, memory growth over a long session, socket message volume and payload size. Measure where you can rather than eyeballing. Prioritize by user-visible impact — a 40ms render on a screen shown once is not a finding.

**B2 · UI visual quality** → `06-ui-visual.md`
Read the actual styles and components. Spacing rhythm and alignment inconsistencies, typographic scale, color and contrast, visual hierarchy on each screen, component states that were never designed (empty, loading, error, disabled, long username, 2 players vs 6 players), z-index and stacking bugs, responsive breakpoints, layout at small and very large viewports, dark mode consistency if present, inconsistent border radii/shadows/transitions across components. Name the screen and the component for every finding.

**B3 · UX & game feel** → `07-ux-gamefeel.md`
The moment-to-moment experience of playing. Is it always obvious whose turn it is, what you can legally play, and why a play was rejected? Feedback on every action. Animation timing, easing, and interruption behavior — do animations block input, can they be interrupted, do they queue up badly on fast play? Onboarding for a first-time player who doesn't know Murlan. Error message wording. Number of clicks for common actions. Sound design if present. Explicitly call out **animations that were started and never finished** or that fire inconsistently across code paths.

**B4 · Accessibility & mobile/touch** → `08-a11y-mobile.md`
Keyboard navigation and focus management, focus traps in modals, screen reader semantics on interactive game elements, ARIA correctness, color-only information (suits!), contrast ratios against WCAG AA, `prefers-reduced-motion`, text scaling. Then mobile: touch target sizes, hit areas on overlapping cards, drag vs tap, safe areas/notch, viewport and scroll locking, landscape, on-screen keyboard behavior, performance on a mid-range phone.

### Wave C — engineering

**C1 · Architecture & maintainability** → `09-architecture.md`
Module boundaries and leaks across them, duplicated logic (especially rules logic duplicated client and server — flag every divergence), god files and god components, dead code and unused exports, abandoned abstractions, inconsistent patterns for the same problem, type safety holes (`any`, unchecked casts, non-null assertions on untrusted data), naming that lies about behavior, TODO/FIXME/HACK inventory with an assessment of which still matter. Focus on the hot files from the repo map — that's where recent churn left mess.

**C2 · Testing, build & supply chain** → `10-testing-build.md`
What is actually covered vs. what the coverage number claims. Tests that assert nothing meaningful. Missing tests on the rules engine and the trust boundary (highest value gaps). Flaky or skipped tests. CI configuration and what it doesn't check. Build reproducibility. Dependency health: outdated majors, unmaintained packages, duplicate/bloated deps, lockfile integrity, license issues. Env/config handling and what breaks between local and prod.

---

## 5. Finding schema — every agent uses exactly this

```markdown
### [<PREFIX>-<NN>] Short imperative title
- **Severity:** Critical | High | Medium | Low
- **Confidence:** High (read the code) | Medium | Low (inferred — say what would confirm)
- **Effort:** S (<1h) | M (a few hours) | L (a day+) | XL (needs a design decision first)
- **Location:** `src/path/file.ts:120-145`, `src/other/file.tsx:88`
- **Problem:** What is wrong. Factual, specific, no hedging.
- **Impact:** The concrete consequence — who experiences it and when.
- **Repro / proof:** Steps, input, or the exact code path that demonstrates it.
- **Proposed fix:** Concrete enough to implement. Name files and the approach.
- **Acceptance criteria:** How the implementer knows they're done. Testable.
- **Fix risk:** What this change could break.
- **Depends on:** [other finding IDs] or None
```

Prefixes: `SEC` `RULE` `NET` `RES` `PERF` `UI` `UX` `A11Y` `ARCH` `TEST`.

**Severity definitions** (use these, don't invent your own):
- **Critical** — exploitable cheat, data loss, or the game becomes unplayable/unwinnable
- **High** — wrong game outcome, players get stuck, or a broken core flow
- **Medium** — degraded experience, real but recoverable; or a latent bug behind an unlikely path
- **Low** — polish, minor inconsistency, cleanup

Each report ends with: `Coverage gaps`, `Opinions (non-findings)`, and `Open questions for the human`.

---

## 6. Phase 2 — Consolidation (you do this, not a subagent)

Read all ten reports, then:

1. **Deduplicate.** Merge findings describing the same root cause across agents into one entry, keeping all cited locations and crediting all source reports. Overlap between PERF/UI and between SEC/NET is expected and heavy.
2. **Resolve contradictions.** Where two agents propose opposite fixes, decide, and record the reasoning in `CONFLICTS.md`.
3. **Sanity-check the Criticals and Highs yourself.** Open the cited file, confirm the line says what the finding claims. Downgrade or delete anything that doesn't hold up, and log what you dropped and why in `REJECTED.md` — I want to see this.
4. **Build the dependency order.** Findings that must be fixed before others go first.
5. **Write `BACKLOG.md`:** a single table of every surviving finding — `ID | Title | Severity | Effort | Category | Files | Depends on | Batch` — sorted by fix order, followed by the full detail entries.
6. **Batch the work** into implementation batches of coherent, independently shippable changes. Batch 1 = Criticals + anything blocking. Each batch: ~5–10 findings, one theme, one branch, testable on its own.
7. **Write `SUMMARY.md`:** counts by severity and category, the five things that matter most and why, an honest assessment of overall repo health, what surprised you, and what the audit could *not* determine.

---

## 7. Phase 3 — Implementation handoff

Using the plan-writing skill available in this project, produce `IMPLEMENTATION-PLAN.md`: per batch, the findings included, the order, the files touched, the tests to add or update, the verification command, and the rollback story. Written so a fresh Claude session with no memory of this audit can execute one batch cleanly.

---

## 8. Output layout

```
audit/<YYYY-MM-DD>/
  00-repo-map.md
  findings/01-security.md … 10-testing-build.md
  BACKLOG.md
  SUMMARY.md
  CONFLICTS.md
  REJECTED.md
  IMPLEMENTATION-PLAN.md
```

---

## 9. Start

Begin with Phase 0 immediately — no preamble, no plan confirmation, no clarifying questions. When Phase 0 is done, report the derived stack and the top-churn file list in under 15 lines, then dispatch Wave A without waiting for me. Report a short status after each wave. Only stop and ask if you find something that makes the audit itself unsafe or pointless (repo doesn't build at all, the rules engine is a stub, most of the code is generated).
