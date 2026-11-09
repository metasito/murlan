# The loop is a second product, with its own gate

Read before a change under `tools/loop/`, `.claude/` hooks, or the loop's evidence. Rules live in
`docs/agents/RULES.md`; the loop's procedure is `.claude/commands/queue.md`.

`tools/loop/` — supervisor, gate, picker, workspace tools — has its own suite
(`tools/loop/tests/`, which `ci.yml`'s `harness` job runs) that shares nothing with the game's `npm
test` but the repository. `ci.yml`'s `scope` job sets one `jobs` output, `JOBS` in
`tools/ci/scopeOf.mjs` applied to `scopeOf`'s scope, and each job's `if:` reads its own key. A diff
confined to `tools/loop/` (plus a short list of shared scripts) is `harness` and not `app`; anything
else is `app`; the protocol files (`docs/agents/`, `.claude/`, `CLAUDE.md`) are **both**, since
both `tests/tooling/rulesAreSingleSourced.test.ts` and
`tools/loop/tests/loopDocsAreExecutable.test.ts` read them. A third part, `scans`, is true for
any change at all and runs `verify` (`npm test`) even when `app` is false: `docReferences` and the
other scans that list the repository from its root reach every tracked path, prose included, so a
doc-only change skips the browser, build and lint jobs but never the Node suite
(`tests/tooling/ciScope.test.ts`). The harness job also runs `typecheck`
and `eslint tools/loop`, since the game's jobs that would otherwise do that are skipped on a
loop-only change. Beside it, `harness-windows` runs every loop test file with a test that skips off
`win32` on a Windows runner and fails if any test in them skips: Linux skips those tests, so this
is the only place they run.

**Run a loop test from the repo root, never through `npm --prefix tools/loop`** — its tests read
the repository itself, so npm's cwd sends every one of them looking in the wrong place. **Move by
subject, not filename**: `tests/ui-rules/contextSlices.test.ts` reads like harness tooling but
asserts the game's React contexts stay a partition, so it stays on the game's side.

**Some hooks act only in a loop session.** `.claude/settings.json` registers guard-bash for every
session, and its loop-only rules act only with `LOOP_TURNS` set; `tools/loop/loop-settings.json`
alone registers guard-write and guard-agent-model (rule 29's model and effort), so no other
session starts them. What each refuses is its own source and tests — `tools/loop/guard-bash.mjs`
(`tools/loop/tests/guardBash.test.ts`), `tools/loop/guard-write.mjs` — read there, not restated
here. The device-run wait they push toward is `await-run.mjs` (`docs/agents/device-runs.md`).

No hook refuses a `VERDICT: LAND`. Before it arms auto-merge, the supervisor's `runSettle`
(`tools/loop/settle.mjs`) asks `reviewerRan` (`tools/loop/loop-gate.mjs`) whether a
`loop-review` or `loop-fix` agent completed for the ticket inside the process that posted the
LAND, after that process's last commit, read from the ticket's stream, and leaves a head no
reviewer cleared to the owner (rule 29). There is no LAND at the round cap: the ticket goes to the
owner.

## The loop's evidence key

The supervisor signs the loop's evidence (ledger rows, stream lines, report entries) with a key kept
outside the repo: `LOOP_EVIDENCE_KEY_FILE` for the supervisor, else `%LOCALAPPDATA%\murlan-loop\evidence.key`
on Windows or `$XDG_STATE_HOME`/`~/.local/state/murlan-loop/evidence.key`. A session is never handed it,
and `guard-write.mjs` and `guard-bash.mjs` refuse a loop session's Read, Grep, Glob and shell commands
that name it. Tests run it from a temp path (`scripts/nodeTest.mjs`, `clearLoopEnv.mjs`) and fail if one
resolves the real path.

Known limits, none of which the guards can close: a process running as the same OS user can read the
file, so stronger isolation means running the supervisor as a separate OS user (or an ACL-protected
`LOOP_EVIDENCE_KEY_FILE`); and a guard reads one command line, so a script built by a program, or
reached through a `cd` the line does not spell, is not seen.
