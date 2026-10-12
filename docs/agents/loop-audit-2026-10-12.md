# Loop audit, 2026-10-12

A read-only audit of what PRs #1515–#1518 (ADR 0010 and ADR 0011) changed in the queue loop, and of
how the loop behaved from their merge (2026-10-11 13:50 UTC) to 2026-10-12 ~08:00 UTC. Rules are
cited by number from `docs/agents/RULES.md`. Line numbers are at main `efbb5f89`.

**Method.** Six auditors read the code, diffs, `.loop-logs/` transcripts and ledger, the issue
threads and the CI runs, one per area: review and verdict; picker and intake; CI gates; rules and
docs; live behaviour against `queue.md`; cost and efficiency. Three separate verifiers then tried
to disprove every finding. Only findings that survived are listed here, with the verifiers'
corrections applied. Refuted findings are listed at the end.

## Summary

- **Throughput.** 11 tickets landed in the window: #1469, #1438, #1423, #1466, #1470, #1473, #1476,
  #1478, #1481, #1496 and #1497. #1503 is in flight. No ticket was parked after the 16:47 restart.
- **Cost.** The median landed ticket cost $6.99 and took 69 min of wall time. Including earlier
  spend on the resumed tickets, the median is $9.11.
  - **Against the ADR 0010 period:** ADR 0011 removed that period's regression ($12.94 median,
    2.18 HOLDs per ticket).
  - **Against the pre-0010 baseline:** it only matches it ($7.80, 57 min). Per size it does not
    beat it.
  - **The build (phase C) is 71% of spend and did not move under either ADR.**
- **Reviews now converge.**
  - **HOLDs:** 0.73 HOLDs per ticket. Every HOLD in the window was a real bug, and no nit held a
    ticket.
  - **Rounds:** the 3-round cap was respected, and #1423 and #1481 landed at round 3 with no
    Blocking finding.
- **The biggest problems found:**
  1. **The loop does not survive the laptop going to sleep.** This is NEW. It caused both
     infrastructure parks (#1465 and #1466) and the "3h07m" on #1466.
  2. **A ticket with its own open PR is invisible to the picker** (known defect 1). #1438 was
     invisible for 8h45m.
  3. **Retries were removed from Playwright, but they came back as unrecorded in-session
     `gh run rerun`.** 6 of 11 landings went through a rerun. One flake
     (`tests/e2e/reducedMotionWobbleReset.spec.ts`) reddens about 1 in 4 runs, and its fix
     ticket (#1528) ranks as ordinary work.
  4. **Every loop process loads the owner's personal auto-memory.** That is about 5–9k tokens,
     and it contradicts rule 25 (comment reads) and cites a retired rule.
  5. **The cost gauge ADR 0010 relies on is blind.** `loop:cost` skips 9 of 11 tickets.

## The three known defects

### K1. A `ready-for-agent` issue with an open `agent/<n>-` PR but no `in-progress` label is invisible to the picker — confirmed, High

- **Root cause.** The stranded rescue is keyed on the claim label, but every release path removes
  that label.
  - **What `stranded()` requires:**
    - It requires `in-progress` (`tools/loop/next-ticket.mjs:67-69`).
    - Only `in-progress` issues get the open-PR and worktree evidence (`:82-88`).
  - **What `takeable()` does:** it drops any issue with an open PR as "claimed elsewhere"
    (`:157-162`). So the ticket's own PR counts as a peer's claim.
  - **What `park()` does:** it removes `in-progress` and `ready-for-agent`, adds
    `ready-for-human`, and leaves the PR open (`tools/loop/queue-loop.mjs:747-760`). Its comment
    then tells the owner to swap the label back and says "the next run resumes from the branch"
    (`:774-775`). The owner follows that instruction, and the ticket disappears.
  - **Why it covers most parks:** `publishForReview` opens a draft PR at every C→D handoff
    (`queue-loop.mjs:2332-2334`). So this applies to almost every park from phase D on.
- **A test pins the bug.** `tools/loop/tests/nextTicket.test.ts:167-170`, "a ticket carrying no
  claim is never stranded", asserts that an `openPr: true` ticket is *not* stranded.
- **Evidence: #1438's timeline.**
  - 05:25:58Z: parked, with PR #1502 open.
  - 08:33:33Z: the owner swaps the labels.
  - The picks at 09:00:49 (#1464), 09:08:34 (#1465), 12:04:10 (stranded #1465), ~13:36 (#1519),
    13:39:22 (#1466) and 16:47:51 (#1469) all passed over it. The 13:05 run never ran the picker.
  - 17:19:03Z: a side session re-adds `in-progress` by hand.
  - 18:03:17Z: picked as stranded.
  - 19:12Z: merged.
  - Nothing is in this state right now.
- **Fix.**
  - **Gather evidence for more issues:** in `classify`, gather it for `routeOf === "implement"`
    issues as well as `in-progress` ones.
  - **Widen the stranded test:** stranded becomes `(in-progress || implement) && openPr &&
    !liveWorktree`. Tag those issues `_stranded`, and have `takeable` read the tag.
  - **Safe for side sessions:** `BRANCH` matches only `^agent/(\d+)-`, so their `claude/` PRs are
    unaffected.
  - **Tests:** invert the pinning test. Add a round-trip test: the label arguments `park()` passes,
    then the owner's swap, then `classify`, which must put the issue at the head of the frontier.

### K2. A session that exits with `api_error` is parked instead of retried — confirmed, Medium; half fixed by #1523

- **What happened to #1466.**
  - At 13:52:50Z the session ended with `is_error: true`, `api_error_status: null`,
    `terminal_reason: api_error` and an assistant `error: server_error`. The text was "SSL
    certificate hostname mismatch" (`.loop-logs/1466.jsonl:396-398`).
  - The loop was running f85d8bd, whose `apiFailure` only matched status ≥500 or 429. So the error
    became a soft "exited 1", then a park.
  - The diagnosis also had no network. It "ended success" because it printed `subtype` for an
    `is_error` result. That led to `handBack`, which parks.
- **#1523** (merged 21:20Z, live from the 21:30 run) now maps a null status plus `server_error`
  to "unreachable", which holds and respawns. That covers TLS, ECONNREFUSED, ECONNRESET and
  no-response, plus 529/5xx and 429.
- **Still parked.**
  - **The stall path.** A session that goes silent mid-retry is killed as `stalled`, with no
    result, so `apiFailure` returns null (`queue-loop.mjs:471-476`, `:631-632`).
  - **The diagnosis path.** A soft stop whose diagnosis also fails offline is handed back, which
    parks (`:2418-2424`, `:2441-2444`).
  - **The real trigger in the window was sleep** (see F1), not an API outage.
- **Fix.**
  - `loop-stream` parses `system/api_retry`. A stall whose last fact is an `api_retry` counts as
    unreachable.
  - The diagnosis reports `apiDown` when `terminal_reason === "api_error"`, and `diagnosed()`
    returns an overloaded pass, not `handBack`.
  - **Tests:** replay `1465.jsonl` lines 968-998, then stall, and expect `overloaded`. A diagnose
    stub returning `api_error` must give `overloaded`.

### K3. "Phase C ran 3h07m on #1466 without pushing" — the premise is wrong; the cause is standby

- **The session lasted 13 minutes.** It ran from 13:39:32 to 13:52:50, 49 turns, with B taking
  259 s and C 546 s. Tool time was 7 min and model time 6 min.
- **The 3h07m is the run report's "working 3:11:06".** That figure is run wall time, and it
  includes the laptop's standby.
- **The System event log** (Kernel-Power 506/507/172) shows:
  - Standby from 13:53:03Z. The network was "Disconnected" from 13:53:14Z.
  - A 14-second connected window at 16:05:51Z. The diagnosis ran inside it, at about
    16:05:41–55Z, and failed.
  - The network back at 16:46:40Z. The park's label landed at 16:46:51Z, 11 s later.
- **Nothing was lost.** The park committed the edits as WIP, and process 1 (20:47Z, after the
  owner requeued at 20:42Z) started from "helpers exist".
- **The real costs:**
  - #1466 sat `ready-for-human` for 4 hours.
  - The ledger books standby as "working".
  - The parked row's `started` is computed as `now - ms` (`queue-loop.mjs:2732`), so it reads
    16:33Z.
- A push checkpoint in C would not have helped, because the network was down. See F1 for the fix.

## Surviving findings

Severity is after verification. The IDs in brackets are the auditors' own, for tracing.

### F1. The loop does not survive the laptop sleeping — High (NEW) [verifiers; 2.2, 2.3, 2.4, 5.1]

- **Mechanism.**
  - Every wall-clock budget fires on wake: the stall watchdog (`Date.now() - lastFactAt`,
    `queue-loop.mjs:1668`, `STALL_MS` 30 min), the poll deadline (`:2026`) and the diagnosis
    timeout.
  - Battery standby also cuts the network for hours.
  - Nothing holds the system awake during a run.
- **Evidence.**
  - #1465: asleep from 10:05:24 to 11:56:37. On wake it was killed as "no output for 30m", its
    diagnosis failed with no network, its park's `gh` steps failed, and the run stopped with "the
    shared checkout is not usable".
  - #1466: see K3.
  - Overnight (19:33Z–07:40Z) the machine was in *connected* standby on mains power, and the loop
    worked normally. So the damage comes from standby with the network off.
- **Fix.** The owner ruled not to keep the machine awake; see Owner decisions.
  - **Treat a watchdog or poll tick that arrives far later than its interval as a suspension:**
    reset `lastFactAt` and the deadlines, book the gap as asleep, and hold for the network instead
    of parking.
  - **Latent and lower priority:** `sh` (`queue-loop.mjs:543-554`) gives `gh` no timeout. A
    timeout would not have helped here.

### F2. Retries came back as unrecorded in-session reruns; one flake reddens ~1 in 4 runs — High [3.1, 5.3, 1.1, 3.2]

- **What changed with #1516.** It set Playwright `retries: 0` (`tests/e2e/playwright.config.ts:58-59`:
  "A blocking spec gets no retry anywhere") and deleted the step that recorded
  retried-then-passed tests.
- **What happens instead.** D sessions now run `gh run rerun <id> --failed` themselves, LAND on
  the green attempt 2, and argue the red away in prose under rule 37.
  - Rule 37 is about memory, ports and peers. It sets no criteria for a CI waiver.
  - `queue.md:172-174` allows ruling out "a red it did not cause", and `guard-bash` deliberately
    allows non-device reruns.
  - So this is within the protocol as written. It defeats #1516's intent with no count and no cap.
- **Evidence.** 6 of 11 landings had an attempt-2 green, all triggered by the loop's account:
  - #1438: 38166186124
  - #1466: 38179674862
  - #1473: 38188271467
  - #1476: 38190503667
  - #1478: 38193065506 (the native-budget red was never named in its verdict, which `queue.md:174`
    requires)
  - #1497: 38218241285
- **"Main is green" is weaker evidence than it reads.**
  - 12 of 13 main runs skipped every job, because the tree equalled a PR head that had passed.
  - That pass can itself be a rerun. Main 38189115110 inherits 38188271467, where the wobble spec
    failed. Main 38191391346 inherits the `tableUnmount` rerun.
  - #1478's and #1497's verdicts cited such "green" runs. Both conclusions were still right, on
    other grounds.
- **#1528** (the wobble flake) was filed at 21:31Z, `ready-for-agent`, size:S. It is still
  unpicked, because `rank()` (`tools/loop/next-ticket.mjs:172-175`) puts only `main-red` ahead of
  ordinary work.
- **Fix.**
  - **Take #1528 next.**
  - **Rank flakes higher:** a flake that hit two or more tickets ranks with `main-red`. Capped that
    way, so the loop's own filings cannot jump the queue.
  - **Amend `queue.md:197`.** D may LAND on a red only when an open flake issue names that test id,
    or CI named an infrastructure cause.
  - **Make reruns mechanical:** one rerun per run id (attempt 1 only), enforced by the guard and
    recorded in the ledger, or leave the supervisor's once-per-head rerun as the only one.
  - **When main's run was skipped,** `mainFailures` (`tools/loop/mainHealth.ts`) should read
    attempt 1 of the PR run it inherited from.
- **Fix to avoid.** "Deny all session reruns" on its own forces a HOLD on every infrastructure
  red, which burns a counted review round.

### F3. Loop processes load the owner's auto-memory — Medium-High [4.1, 4.2, 6.6]

- **The memory is in the prompt.** The `claude -p` spawn env (`queue-loop.mjs:1550-1566`) does
  not disable auto-memory.
- **Proof.** On three tickets, two processes on the same `loop_sha` started at different sizes, and
  each change lines up with a write in the memory directory:
  - #1261: +15 tokens
  - #1263: +73 tokens
  - #1266: +9 tokens
- **Size.** `MEMORY.md` is 19.6 KB, about 5–9k tokens per process, at 2–4 processes per ticket.
- **What it injects:**
  - An index line saying to read issues with `--comments` at pick-up. That contradicts rule 25,
    which prescribes the trusted-author read.
  - "RULES.md 45" lines, a retired rule.
  - Owner-only procedures, such as auto-merge and parallel builders.
- **Behaviour.** Since #1517, 49 of 65 main-agent comment reads (75%, in 11 of 13 transcripts) have
  no author filter.
  - Most of them are `--json comments` reads with a body-prefix select (`startswith("DOD-CHECK")`).
    A stranger's comment starting `DOD-CHECK` or `REVIEW` would match.
  - This is latent. No outsider has commented, and the loop tools themselves (`loop-derive`,
    `brief`) do filter by author.
  - Nothing enforces rule 25. `tests/tooling/issueReadsAreTrusted.test.ts` scans docs, not
    behaviour.
- **Fix.**
  - Set `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in the spawn env; it exists in CLI 2.1.296. Confirm
    that the first request drops below 33.6k tokens.
  - In loop sessions, `guard-bash` refuses a comment-reading issue or PR read without
    `TRUSTED_SELECT`; reuse the test's matcher.
  - Correct the two memory index lines.

### F4. The 3-round cap is not enforced on the merge path — Medium [1.2, 1.7]

- **Where the cap lives.** It is enforced only by `loop-gate --review-round` and the E push gate
  (`tools/loop/loop-gate.mjs:105,132`). The session runs both voluntarily.
- **What the merge path checks.** `poll`'s cleared check (`queue-loop.mjs:2009,2091`) is
  `mergeCleared` (`loop-gate.mjs:164-181`), and that reads only LAND and REVIEW. `guard-verdict`
  has no round check either.
- **How a ticket lands past the cap.**
  - A round-4 D process that crashes, stalls, hits max turns in E, or omits LOOP-RESULT goes to
    settle and then merges.
  - There is also a path with no misbehaviour: `derive` returns G for a LAND on a pushed head with
    an open PR (`loop-derive.mjs:521-522`). A supervisor restart or a post-compaction
    `loop-status` then settles it.
- **Not observed.** Every session ran `--review-round`.
- **Fix.**
  - `cleared` also requires reviewRounds ≤ MAX, and fails closed on null.
  - Do *not* park at handoff D when reviewRounds ≥ MAX. That would wrongly park a CI fix round
    after a round-3 LAND.

### F5. The cost gauge is blind and its fix-round metrics are wrong — Medium [6.1, 6.2, 6.3]

- **Markers in commands are skipped.** `readTicket` (`tools/loop/loop-cost.mjs:175`) only reads
  `PHASE` from text blocks.
  - Since #1430 (2026-10-09) the model writes markers as `echo "PHASE X" &&` in commands: 46 of 54
    sessions on 10-11, and 15 of 16 on 10-12.
  - So `loop:cost` skips 9–10 of 11 tickets and books 85% of spend to `pre`. It prints the skip
    count, so it is visibly blind rather than silently wrong.
- **The supervisor misses some markers too.** Its own `ECHOED` (`tools/loop/loop-stream.mjs`)
  matches only at the head of a command. So E and F markers that come mid-chain are lost from
  ledger phases.
- **"Fix rounds" reads $0.00.** It counts only `retry` rows, and the last one was 2026-10-10. HOLD
  fix processes actually cost $21.40 of $92 (23%).
- **"Unjudged" is miscounted.** It counts zero-turn supervisor rows.
- **Result.** ADR 0010's own revert check cannot be run with the tool it names.
- **Fix.** Use one parser for the gauge and the supervisor that accepts the marker at any `&&` or
  `;` boundary. Count HOLD rounds per ticket, exclude zero-turn rows, and add an echoed-marker case
  to `tools/loop/tests/loopCost.test.ts`.
- **Validation.** A patched copy counts 11 of 11 tickets with `pre` at 6%.

### F6. A failed park is recorded as parked; the tracker is untouched — Medium [2.3]

- **What happens.** Each `park()` step is caught (`queue-loop.mjs:719-786`), and `parkAndRecord`
  discards the result (`:2192-2205`). So the ledger says `parked` while the issue still has
  `in-progress` and `ready-for-agent`, and no comment.
- **Failure scenario.** For a park in phases A–C (no PR), the issue then sits `in-progress` with no
  PR and no worktree, and the picker skips it for good.
- **Evidence.** #1465's park at 11:57Z, 30 s after the wake, with no network:
  - The ledger says parked, and the issue timeline shows nothing.
  - It was rescued only because a draft PR existed.
  - The step failure was printed to the console only (`:729`).
- **Fix.** Record `park_failed`, raise a notice, and retry the label step. Do *not* keep the
  worktree after a failed label step, because `liveRoute` would resume a ticket meant for the
  owner.

### F7. Budget warnings have no reader, so the cost lands on a later PR — Medium [3.3]

- **What #1516 changed.** Timing budgets now warn below 3× (`tools/ci/native-budget.mjs`,
  `tools/ci/e2e-budget.mjs`). Nothing in `tools/loop/` reads a `::warning`; `ciVerdict.ts:29`
  reads annotations only to detect a cancel.
- **The `mancheOutcomeOnTheFelt` chain.**
  1. #1469 landed `mancheOutcomeOnTheFelt` at 32.9 s against a 15 s budget. The warning was on its
     own green run, 38161718656.
  2. #1470 grew it to 37–39 s.
  3. A 2× slow runner took it to 45.7 s, past 3×, which reddened unrelated #1478.
  4. On #1496 it read 43.4 s, 1.6 s from red.
- **Other files that warn on every run:**
  - `pileMountsOnceFull` (47 s)
  - `tableProportions.spec.ts` (94 s against 75.6 s)
  - `dealTurnGrowth`
  - `botMoveCost.compiled`
- **Fix.**
  - **Within the loop's remit:** the D reviewer treats an over-budget annotation on a file the
    diff touches as Blocking.
  - **Needs an owner ruling (rule 46):** failing at 1× for touched files.

### F8. The weekly timings cron ratifies slowdowns into the budget baseline — Medium [3.4]

- **How the ceiling grows.** The e2e hard ceiling is about 6× the recorded time plus 90 s
  (`tools/ci/e2e-budget.mjs:14-16,26,69`). The Monday cron (`.github/workflows/ci.yml:855-899`)
  commits measured durations to `timings.json`, which `committedTimings()` then uses as the
  baseline. Its only check is shard balance.
- **Effect.** It resamples in both directions, so it is not a one-way ratchet. But a slowdown that
  only warns gets ratified with no review.
- **Live instance.** `tableProportions` is recorded at 22.8 s and runs at 76–94 s. The next cron
  makes its ceiling about 570 s.
- **Fix.** Use the cron's timings for shard balance only, or require review for any spec whose new
  value exceeds its committed value by more than the ratio.

### F9. Parity moved off PRs to a nightly that has never been exercised, and whose red routes nowhere — Medium [3.5]

- **No run yet.** `.github/workflows/parity-nightly.yml` has 0 runs. It has had one scheduled slot,
  and no `workflow_dispatch` smoke run was done.
- **Parity work checked locally only.** 7 PRs in the window changed parity specs or the harness
  with no CI execution. Their parity Definition-of-done boxes were ticked on local runs
  (`dod-1497.md`: "the nightly runs it").
- **Where a red goes.**
  - On red, the workflow files an issue labelled only `parity`. That label does not exist yet, and
    the commit message says reds go under `noticed`.
  - `routeOf` returns null for an issue labelled only `parity`, so it goes to the owner bucket. It
    gates nothing.
- **Fix.**
  - Dispatch the workflow once now.
  - Label the failure issue so it routes (`ready-for-agent`, or `main-red` if parity should gate,
    which is the owner's call).
  - Parity DoD boxes cite a dispatched parity run on the branch.

### F10. `queue.md`'s fix-round step runs the whole native suite locally, against rule 2 — Medium [5.4]

- **The conflict.** `queue.md:113-114` says `npm run agent:check -- --also test:native`. Rule 2
  forbids running `npm run test:native` by hand, and RULES wins over queue.md.
- **Evidence.** #1473 ran it from 00:17 to 00:27Z: 24 suites and 58 tests failed in 475 s, all
  later ruled out as load.
- **Fix.** Drop `--also test:native`, because CI runs it.

### F11. ADR 0011's "files no agent work" was not carried past `queue.md` — Medium [4.4, 4.5, 4.6, 4.7]

- **issue-tracker.md (Medium).** `docs/agents/issue-tracker.md:166-169` still says "the queue fixes
  what it meets in the files and the defect class the ticket names". `queue.md:129-131` now fixes
  only the lines the diff changes. Triage writes ticket bodies from issue-tracker.md, so
  same-area defects fall between the two.
- **Rules 33 and 34 (Low-Medium).** They still say "file an issue" with no label. An unlabelled
  issue routes to triage (`next-ticket.mjs:45`), which can make it `ready-for-agent`. This has not
  been observed; the triage route runs only on an empty frontier.
- **Wayfinder and triage (Low).** `.claude/commands/wayfinder.md:20` ("a new ticket for the
  queue") and `issue-tracker.md:201` ("split it") still create agent work.
- **Stale references (Low).** `issue-tracker.md:74-75` names `code-review`, which #1515 removed.
  `:145-146` misdescribes rules 3 and 5.
- **Fix.** One doc edit across these lines. Loop filings go `ready-for-human` or into the `noticed`
  issue, never unlabelled.
- **Compliance in the window was clean.** The loop filed only #1521 (`noticed`), #1524, #1529 and
  #1536 (all `ready-for-human`). #1525, #1526 and #1528 came from an out-of-loop triage session.

### F12. The "loop-status first" step is pinned by a test that passes on a decoy — Medium [4.3]

- **The decoy.** #1517 removed the regex that pinned phase A step 1. The surviving test
  (`tests/tooling/rulesAreSingleSourced.test.ts`, "phase A checks loop-status.mjs before the
  picker") uses `indexOf`, and that hits `queue.md:11` and `:33` before the picker line.
  - So deleting step 1 leaves the test green.
  - In loop processes the SessionStart hook is silent (`silentAt`, `tools/loop/loop-status.mjs:81`).
    Step 1 is therefore the only way a resumed process learns its phase, which is the class of the
    #911 and #915 bugs.
- **The pressure to cut it.** `queue.md` is 2199 words against a cap of 2200
  (`tests/tooling/claudeMdScope.test.ts:17`). The next edit to queue.md has to cut words.
- **Fix.** Scope the existing structural test to the `## A — Start` slice. Do not re-pin prose,
  which #1517 removed deliberately. Make room under the cap before the next edit; see the efficiency
  section.

### Low

- **Later-round delta brief [1.3, 1.6].** It is `base...HEAD` (`tools/loop/brief.mjs:31`).
  - After a rebase or a main merge between rounds, the brief carries the whole ticket plus main.
    #1466 round 2 reviewed 23 files, including #1523. This predates #1518.
  - Fix, both parts needed: no rebase between rounds (the base must be an ancestor), and
    `--first-parent --no-merges` for the delta.
  - The header's worktree argument is unchecked: `review 1466 . c8e8050` was dispatched seven
    times.
- **Fix-kind review rounds [1.4].** After a CI-RED, these are not counted toward the cap. They are
  bounded only by `MAX_HANDOFFS = 8` and the dollar ceiling.
- **Round count reset [1.5].** A new claim resets the round count (`loop-derive.mjs:299`). #1438's
  ledger says 1 round against 3 real ones, and ADR 0010's HOLD metric reads that field.
- **guard-verdict [1.7].**
  - A URL issue argument passes (`guard-verdict.mjs:30`), and `gh api` posts are never inspected
    (`:26`).
  - A throw exits 0 (`:78-80`).
  - `pushVerdict` and `mergeCleared` still require a REVIEW, so the residual risk is a hand-written
    REVIEW.
- **Legacy shim [1.8].** The `## Standards`/`## Spec` shim in `reviewFor` (`loop-derive.mjs:240-241`)
  is no longer needed.
- **Brief contradictions [1.9, 4.8].**
  - The brief says "Report Blocking findings only", and the same brief asks for three headings.
  - `effort` is never checked by `guard-agent-model`. #1423 delegated a 20-min Opus build subagent
    with effort unset, against the spirit of ADR 0010 decision 1.
  - Rule 29 says "Mechanical: haiku", but ADR 0010 decision 5 says no Haiku.
  - The 0010 row in `docs/adr/README.md` is not marked as partly superseded.
  - `OWNER_LABELS` lacks `deferred`.
  - `queue.md:205`'s "steps 1–4" reference is ambiguous.
- **D order in queue.md [4.8, 5.6].** queue.md D1/D2 says wait for CI, then dispatch the reviewer.
  In practice, 14 of 18 rounds already dispatched first, which is better. Rewrite the order to
  match.
  - #1481 posted two HOLDs before CI finished. That is harmless: only a LAND needs CI.
- **No Launch milestone [2.6].** `gh api …/milestones` returns none. Launch-first ordering is
  therefore oldest-first, as before #1515, and nothing tells the owner.
- **"Waiting on you" [2.5].** It names the eight oldest asks, seven of them `deferred`, and omits
  #1536 and #1529.
- **size:S turn cap [2.7, 5.5, 6.9].** It is 160, and #1496's build used 153 (also #1438 151, #1470
  137). The code's own "cap ≥ 2× the busiest" is printed, not enforced. Hitting the cap costs a
  fresh session, not a park. Raise S to at least 310.
- **ADR 0010:47 [2.8].** It says the A process "carries the build through C and D". Since
  2026-09-17 C has handed off to D, so round-1 review runs on a fresh `high` process.
- **Pinned tickets [2.9].** A pinned ticket ignores label changes (`queue-loop.mjs:199-202`).
- **DoD `path:line` check [5.2].** Any line that resolves satisfies it.
  - On 4 of 11 tickets a box with no code site was re-posted with an arbitrary citation, e.g.
    `check-steps.mjs:1` for "agent:check green".
  - Fix: accept the agent:check box on `buildPassed`, and allow `n/a: <reason>`.
- **Product calls in HOLD rounds [5.7].** #1423's r2 HOLD came from a product call made in a HOLD
  round: the r1 fix decided a draw plays `partitaLost`. Product calls go to the owner.
- **Guard denials [5.8].** Guard denials cost 1–4 turns per ticket:
  - the 150-line cap
  - `sed -i` under rule 44
  - jest memory-preflight retries
- **ECR Public pull limit [3.6].** ECR Public's data limit reddened 3 browser shards
  (`scripts/dev-stack.mjs`). The `services:` postgres pulls the same image, so cache or mirror it.
- **ios-wall ceiling [3.7].** The ios-wall 3× ceiling (`tools/ci/ios-wall.mjs`) equals the flows
  job's 45-min timeout, so it is near-dead.
- **CI polling [6.8].** `await-run` pays a full-context turn every 240 s. #1481's build took about
  40 polls at up to 290k context.

## Flaky specs, window census

Each row was re-checked against the job logs.

| Spec or cause | Fails | Rate | Tickets it reddened | Handled by |
|---|---|---|---|---|
| `tests/e2e/reducedMotionWobbleReset.spec.ts`:28 (line 53, "flying-cards node must still be on screen after the toggle"), the same assertion every time | 6, plus 1 at 13:05Z | ~6 of 25 executions (24%); 5 of 12 PR branches | #1438, #1423, #1473 (×2), #1478, #1497 | 3 reruns, 3 re-pushes; waived 5× |
| `tests/e2e/tableUnmount.spec.ts`:42 (`hover` timeout on Gioca), shard 17 | 2 | ~8% | #1476, #1497 | rerun, waived |
| ECR Public `toomanyrequests: Data limit exceeded` (postgres pull) | 3 | – | #1466, #1481 (×2, cancelled) | rerun |
| Native budget past 3× on `mancheOutcomeOnTheFelt`, untouched file (45.7 s against 15 s) | 1 | warns on every run | #1478 r2 | rerun; argued as runner slowdown |
| `reconnect.spec.ts`:40 | 1 | – | #1473 | "not reproduced" |
| `hooksLint.test.ts`, 31.1 s against 30 s | 1 | – | #1473 | waived |
| `npm test` 180 s watchdog in `seatLayoutTakesNoCount` | 1 | – | #1469 | next head green |

The one waived on both #1438 and #1423 is the wobble spec. It is #1528's spec. No whole review
round was lost to a flake alone, because every red that coincided with a HOLD also had a real
Blocking finding.

## Safeguards these changes weakened

Each was checked against the CLAUDE.md invariant "No self-defeating safeguards".

- **Retries (F2).** Removing Playwright retries and the flaky-test record left an uncapped,
  unrecorded, LLM-decided rerun as the retry. The flake signal now survives only as prose in
  verdicts.
- **Timing budgets (F7, F8).** Budgets became warnings with no reader. The weekly cron can ratify a
  warned slowdown into the baseline.
- **Parity (F9).** Parity coverage left PRs for a nightly that has not run and whose red gates
  nothing.
- **The review cap (F4).** It is enforced only by commands the session chooses to run.
- **Prose pins (F12).** Removing them left the one structural pin on phase A step 1 passing on a
  decoy, under a word cap with one word of slack.
- **The DoD citation gate (Low, 5.2).** Any resolvable line satisfies it.
- **Rule 25 (F3).** It is prose only, and the injected memory contradicts it.
- **Checked and not weakened:**
  - All five PreToolUse guards keep `onFailure: "block"`.
  - #1518's narrowing of `guard-agent-model`'s name list is deliberate and tested, and
    `guard-verdict` still requires a real brief per round.
  - `e2e-budget` reads the committed baseline, so a run cannot raise its own budget.
  - The `HARD_FACTOR <= 3` pins are real.

## Cost, time and efficiency

### Before and after, per landed ticket

Tickets are grouped by `loop_sha` era; a ticket belongs to the era of its first process.
- **E0:** before ADR 0010.
- **E1:** ADR 0010 only. Claude Code 2.1.292→2.1.296 changed at the same moment, which confounds
  E0→E1.
- **E2:** ADR 0011.

| Era | n | $ median | $ mean | Wall median | Processes | Turns median | HOLDs | Opus $ share |
|---|---|---|---|---|---|---|---|---|
| E0 | 18 | 7.80 | 9.92 | 57 min | 3 | 177 | 1.33 | 73% |
| E1 | 11 | 12.94 | 11.04 | 76 min | 5 | 233 | 2.18 | 96% |
| E2 | 11 | 6.99 (9.11 with resumed tickets' earlier spend) | 8.12 | 69 min | 3 | 171 | 0.73 | 94% |

- **By size, E2 does not beat E0.**
  - S: $5.15 against $5.24.
  - M: $11.13 against $9.01, although the M means are $10.53 against $11.66.
- **HOLDs are not like for like,** because ADR 0011 redefined a HOLD as Blocking-only.
- **All spend divided by landed tickets:** E0 $9.98, E1 $13.18, E2 $8.59.
- **Verdict:**
  - ADR 0011 undid ADR 0010's review regression, and reviews now converge.
  - Medium-effort builds (ADR 0010 decision 2) did not lower build cost.
  - First builds did not fail more, so there is no case for going back to `high`.

### Where the money goes (E2, patched gauge)

| Phase | Share | Per ticket |
|---|---|---|
| C build | 70–71% | $5.77 (E0 $5.62, E1 $5.20) |
| D review | 15–16% | $1.33 (E1 $5.10) |
| B scope | 5% | $0.38 |
| pre | 6–7% | $0.47 |
| E+F | ~2% | $0.19 |

- **By process:** the build process is 65%, HOLD-fix processes 24% ($2.67 each), and the LAND
  process 11%.
- **Token composition:**
  - Cache reads 39%.
  - Cache writes 38%. The main session is all at the 1-hour TTL; subagents are already at 5 minutes.
  - Output 23%, of which about a third is thinking.

### Machinery against thinking (E2, 80 min of process wall per ticket, mean)

| Bucket | All tickets | Excluding #1481 (iOS) |
|---|---|---|
| Machinery: CI wait, tests/tsc/lint, agent:check, Playwright | 59% | 51% |
| — CI wait alone | 25% | 9% |
| Model time | 17% | 20% |
| Subagents | 12% | 16% |
| Shell reads, `gh`, git, edits | ~11% | – |

- **Outside processes:** time between processes is about 1 min per ticket, and between tickets
  about 50 s.
- **D process:** a D process takes 16.5 min mean, of which CI is 5.1 and model time 2.8.
- **Slowest single calls:**
  1. A 23.6-min Sonnet "Measure pile 720 gap" agent (#1438).
  2. A 19.9-min Opus build subagent (#1423).
  3. #1481's iOS `await-run` loop.
  4. `--also test:native` at 10.3 min (#1473, F10).
- **No context compaction** happened in any window process.

### Instructions and docs

- **Fixed load per process:** about 33.6k tokens on the first request.
  - Root CLAUDE.md: 798 words.
  - Global CLAUDE.md: 145 words.
  - Auto-memory: 5–9k tokens (F3).
  - `queue.md` as the `/queue` body: 2199 words.
  - 67 skill descriptions.
  - RULES.md (1418 words) is then `cat`-ed by 29 of 31 processes.
  - `checks.md` (6519 words) is read in pieces only.
  - `issue-tracker.md` (2279 words) is never read by queue processes.
- **Re-reading the protocol costs about $0.4 per ticket (~5%).** Re-reading the 33.6k prefix every
  turn costs about $1.15 per ticket (~14%).
- **The docs are not the cost driver; the build's turn count is (171 median).** The doc changes
  worth making are small:
  - Drop auto-memory (F3): about $0.25–0.45 per ticket, and it removes contradicting guidance.
  - Allowlist rather than denylist skills and plugins.
  - Make room in `queue.md`. Fold Halt and Output into F step 4. Move A step 4's by-hand claim
    text to `issue-tracker.md`, which already points back at it. Drop D1's `gh run list` block,
    since agents use `await-run`. Together about 135 words.
  - Cut rule 46 to one sentence pointing at the constants (−110 words; the loop never tunes CI
    budgets).
- **One instruction is dead text.** `queue.md` names `mattpocock-skills:tdd`/`diagnosing-bugs`, but
  there were 0 Skill calls in all 90 processes under ADR 0010 and ADR 0011. Either drop the
  reference or make the step concrete.
- **Keep "a round is a process" and E/F inside D.** Continuing D in the build's context would cost
  more: about $0.97 per ticket mean, $0.46 median, to save about 45 s per round.
- **Options measured but not urgent:**
  - A 5-minute main-session cache TTL (`CLAUDE_CODE_PROMPT_CACHE_TTL`) would save about $0.35 per
    ticket. It is incompatible with a longer `await-run` budget.
  - The account is a subscription (`apiKeySource: none`), so every dollar figure here is
    usage-window headroom at list price, not cash.

## Refuted

- **"The supervisor hung 2h53m on untimed `gh` calls" (2.2, 5.1).** The machine was in standby
  with the network down (F1, K3). The missing `gh` timeout is real but latent.
- **"#1466's phase C ran 3h07m" (the premise of K3).** The session ran 13 min.
- **"Dispatch the reviewer before waiting for CI to save ~3 min" (6.7).** 14 of 18 rounds already
  do; the residual saving is about 0.5 min per ticket. What remains is the doc order (Low list).
- **"Re-add `code review` to `guard-agent-model`'s names" (part of 1.9).** It reverses a
  deliberate, tested narrowing in #1518.
- **"Wait for CI before a HOLD verdict" (part of 5.6).** It adds about 4 min per HOLD for nothing.

## Owner decisions

- **The loop machine (F1), ruled 2026-10-12.**
  - Do not keep it awake. The loop stops when the laptop sleeps.
  - The fix is only that sleep must not hurt a ticket. A long gap counts as a suspension: no
    stall kill, no diagnosis, no park. The ticket resumes on wake.
- **Parity (F9), ruled 2026-10-12.**
  - A red nightly parity run never blocks work.
  - It must be visible: it is reported where the owner and the loop's status will see it, not
    filed as a ticket the picker takes.
- **Slow tests (F7), delegated to the lead and decided 2026-10-12.** The owner: "ideally these
  slow downs shouldn't occur at all".
  - CI's red line stays where rule 46 puts it. Making CI itself fail at 1× would turn runner
    variance (up to 2× in this window) into red runs on innocent tickets.
  - The loop gets a mechanical land gate instead. A LAND is refused while the head's CI run carries
    an over-budget warning for a test file the diff added or changed. The builder makes the test
    fast before the ticket can land. This does not depend on a reviewer noticing.
  - The slowdown is caught on the ticket that caused it, and a warned file can no longer land.
- **Still open:** the Launch milestone is empty, so the picker cannot work toward launch (Low list).
