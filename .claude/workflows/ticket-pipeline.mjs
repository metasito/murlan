export const meta = {
  name: 'ticket-pipeline',
  description: 'Claim, gate, implement, land one murlan queue ticket — ci.yml is the gate',
  phases: [
    { title: 'Claim', detail: 'claim the routed ticket and run the design-first gate', model: 'haiku' },
    { title: 'Implement', detail: 'mattpocock-skills:implement, commit only', model: 'sonnet' },
    { title: 'Review', detail: '/code-review --fix in the worktree, then push and open the PR', model: 'opus' },
    { title: 'Verify', detail: "ci.yml's verdict on the pushed branch", model: 'sonnet' },
    { title: 'Fix', detail: 'make a red run green', model: 'sonnet' },
    { title: 'Land', model: 'sonnet' },
    { title: 'Cleanup', model: 'sonnet' },
  ],
}

// Every agent() call names its model: an omitted one inherits the session's, which can be far
// larger than the stage needs. Anything following a written procedure takes the cheapest tier.
const MODELS = {
  claim: 'haiku', // next-ticket.mjs, two gh writes, one CLI whose failure mode is fail-safe
  implement: 'sonnet',
  review: 'opus', // independent review is the only thing between a defect and an --admin merge
  verify: 'sonnet', // long, scripted, and has to read failures back accurately
  fix: 'sonnet',
  land: 'sonnet',
  cleanup: 'sonnet', // deletes branches and kills processes on a judgement call
}

// `args` names a ticket when the queue's own ordering is not the one wanted — a blocker that has
// to land before the item that needs it. Unset, the router picks.
//
// Watch for: the value can arrive as a string, so it is coerced. A pin that cannot be read stops
// the run rather than falling back to the router, which would silently work a different ticket.
const rawTicket = args !== null && typeof args === 'object' ? args.ticket : args
const forcedTicket = rawTicket === undefined || rawTicket === null ? undefined : Number(rawTicket)
if (forcedTicket !== undefined && !Number.isInteger(forcedTicket)) {
  throw new Error(`ticket-pipeline: args named a ticket that is not a number: ${JSON.stringify(args)}`)
}

// Each round is a push and a full ci.yml run, about nine minutes. Four is where a red run stops
// being worth another attempt and becomes something to look at.
const MAX_FIX_ROUNDS = 4
const REPO = 'metasito/murlan'

const BASH_NOTE = [
  'Use the Bash tool (POSIX sh), not PowerShell.',
  'Never pass JSON as a command-line argument: the shell layer collapses the doubled backslash',
  'JSON uses for a literal backslash, which corrupts the payload. Each module below reads stdin.',
  'Search with the Grep tool, not a shelled-out grep or find. If you must shell out to search,',
  'exclude node_modules explicitly — `rg` does this by default, but a raw `grep -r` still walks',
  'every package even when `--include` only narrows what gets reported, turning a sub-second',
  'search into several minutes.',
].join(' ')

// ci.yml runs the whole sweep on the push — typecheck+tests+lint 223s, build-and-boot 162s,
// browser 526s. Anything a stage repeats locally is those minutes paid twice.
const LOCAL_TEST_NOTE = `What to run here, and what not to.

While iterating, run only what you are iterating on: \`npm run typecheck\`, \`node --test <the one
file>\`, and for a browser test \`npx playwright test --config tests/e2e/playwright.config.ts
<one-spec.ts>\` or the same with \`-g "<one test name>"\`.

Once, before you push: \`npm run typecheck && npm run lint && npm test\`. Around ninety seconds
together — \`npm test\` alone is 17s for 1164 tests — against a nine-minute round to learn the same
thing. Several of those tests are structural source-scans that no amount of running your own file
will reach: a11y props the web build drops, tokens used in the wrong role, a second declaration of
a shared constant. They fail on code that works.

Never run \`npm run test:e2e\` (526s), \`npm run test:native\`, or \`npm run verify\` (which is all of
them). Those are the sweep, and the run on your push is already doing it against a clean build.

\`E2E_SKIP_BUILD=1\` reuses the existing dist/ instead of rebuilding it, which is the difference
between a usable browser loop and an unusable one. It is safe only while your edit is confined to
the spec file: dist/ is a *build* of app/, components/ and lib/, so with that flag set a change to
any of those is not in the bundle under test and the run can pass having exercised nothing. After
every change to app code, run once without the flag before you trust a green.`

function sq(text) {
  return `'${String(text).replace(/'/g, "'\\''")}'`
}

function writeJsonCommand(path, value) {
  return `printf '%s' ${sq(JSON.stringify(value))} > ${path}`
}

const CLAIM_SCHEMA = {
  type: 'object',
  properties: {
    claimed: { type: 'boolean' },
    number: { type: 'number' },
    branch: { type: 'string' },
    title: { type: 'string' },
    filesTouched: { type: 'array', items: { type: 'string' } },
    worktreePath: { type: 'string' },
    escalate: { type: 'boolean' },
    gateReason: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['claimed'],
}

const IMPLEMENT_SCHEMA = {
  type: 'object',
  properties: {
    committed: { type: 'boolean' },
    commitSha: { type: 'string' },
    summary: { type: 'string' },
    filesTouched: { type: 'array', items: { type: 'string' } },
  },
  required: ['committed'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    pushed: { type: 'boolean' },
    prNumber: { type: 'number' },
    findingsFixed: { type: 'number' },
    summary: { type: 'string' },
  },
  required: ['pushed'],
}

const CI_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    runId: { type: 'number' },
    failedStep: { type: 'string' },
    output: { type: 'string' },
    // A run that never started says nothing about the diff, and a fix agent sent after one is
    // hunting a defect nothing reported.
    infrastructure: { type: 'boolean' },
  },
  required: ['pass'],
}

const LAND_SCHEMA = {
  type: 'object',
  properties: { merged: { type: 'boolean' }, prNumber: { type: 'number' }, reason: { type: 'string' } },
  required: ['merged'],
}

// The worktree and the branch are all a run leaves behind: the suites run on GitHub's runners, so
// there are no local ports or containers. `dockerStarted` stays in the payload cleanup.ts
// validates, answered honestly rather than dropped.
const state = {
  worktreePath: null,
  dockerStarted: false,
  localBranch: null,
  merged: false,
}

// The progress view labels each agent, falling back to the head of its prompt when none is given.
// `ticket` is filled in by the claim stage so every later label carries the number.
const run = { ticket: 'no ticket yet' }
function label(stage) {
  return `${stage} ${run.ticket}`
}

// Every stage starts in the directory the workflow was launched from: the shared main checkout,
// whose HEAD any other session can move. Each stage is told where to stand and made to prove it
// got there, so nothing it measures belongs to another ticket.
function cwdNote(claim) {
  return `Work in ${claim.worktreePath}. Before anything else:
  cd ${claim.worktreePath} && git rev-parse --abbrev-ref HEAD
If that does not print ${claim.branch}, stop and report failure — you are in a checkout that
belongs to another session, and nothing you measure there is about this ticket.

A sub-agent you dispatch does NOT inherit that cd: it starts in the shared main checkout, where
this branch's diff does not exist. So name ${claim.worktreePath} in the prompt of every one you
send, and read "no diff to review" from any of them as proof it stood in the wrong checkout —
never as a clean result. Re-dispatch it with the path before believing it.`
}

// ci.yml runs typecheck, tests, lint, native, browser and build-and-boot against the pushed
// branch, in parallel, on runners that are free for a public repo. This stage reads that verdict
// and never reproduces it.
async function runVerify(claim, prNumber, round) {
  return agent(
    `${BASH_NOTE}
${cwdNote(claim)}
Pull request #${prNumber} is open on this branch, so ci.yml is already running against this exact
tree. Your job is to read its verdict, not to reproduce it: do not run the suites, the build or a
database locally. ci.yml's own \`scope\` job decides which jobs a prose-only diff can skip, so
there is no plan to compute here either.

  gh pr checks ${prNumber} --repo ${REPO} --watch --interval 20 > /tmp/ci-${round}.txt ; \
  gh run list --repo ${REPO} --branch ${claim.branch} --limit 1 --json databaseId,conclusion,status

Take the verdict from that JSON's "conclusion", never from the watcher's exit status. Piped into
anything, that status belongs to the pipe's last command, so a red run reads as a pass.

If the conclusion is "success", report pass: true with the runId, and stop.

Otherwise, establish whether the run said anything about the diff at all before calling it a
failure. A job that dies in seconds with no steps is infrastructure, not a red suite:
  gh run view <runId> --repo ${REPO} --json jobs --jq '.jobs[] | {name, conclusion, steps: (.steps | length)}'
  gh api repos/${REPO}/check-runs/<jobId>/annotations
An annotation naming billing, a quota or a runner failure means the suite never ran. Report
pass: false with infrastructure: true and the job's name — the pipeline stops there rather than
sending a fix agent after a defect nothing reported.

A run that failed with real steps is a real failure. Take what a fix agent needs and no more:
  gh run view <runId> --repo ${REPO} --log-failed | tail -60
Report: pass, runId, failedStep (the job and the step that failed), output (that tail),
infrastructure false.`,
    { model: MODELS.verify, phase: 'Verify', label: label(`ci round ${round}`), schema: CI_SCHEMA }
  )
}

// `agent()` returns null when a subagent dies on a terminal API error after its retries. A DNS
// outage killed five of them mid-run and the next line read `.infrastructure` off null, so the
// workflow threw and the ticket kept its `in-progress` label with nobody left to release it.
// A stage that never reported is not a verdict — it is the same "nothing was learned" case as a
// CI run that never started, which the caller already knows how to end cleanly.
function reported(verify) {
  return (
    verify ?? {
      pass: false,
      infrastructure: true,
      failedStep: 'the verify agent died before reporting',
    }
  )
}

let claimOpen = false
let claimedNumber = null
// Every path that abandons a claim sets this instead of spawning its own agent to say so: the
// cleanup agent has to run anyway, and it is in the finally, so it cannot be skipped.
let releaseReason = 'the run ended early'

try {
  phase('Claim')
  const claim = await agent(
    `${BASH_NOTE}
Work in as few Bash calls as you can — each one costs a full turn, and this whole stage is six
commands. ${
      forcedTicket
        ? `The ticket is already chosen: #${forcedTicket}. Read it with
  gh issue view ${forcedTicket} --repo ${REPO} --comments
and take it only if it is open and ready-for-agent; report claimed: false with why otherwise.

A "Claimed by \`<branch>\`" comment does not by itself mean somebody is working on it. Run the
test rather than judging by eye, and do not assert either answer without running it:

  git ls-remote --heads origin <that-branch> ; git worktree list ; \\
  gh pr list --repo ${REPO} --head <that-branch> --state open --json number

- In no worktree, and no branch on origin → stale. Say so on the issue, then take it.
- In a worktree, or a branch with an **open pull request** → live. Stand down.
- A branch on origin with **no open pull request** → abandoned residue, not a claim: a run that
  ended without landing leaves one behind. Say so, delete it
  (\`git push origin --delete <that-branch>\`), then take the ticket. Left alone it reads as a
  live claim forever and the ticket can never be run again.

Then claim it per`
        : `Start with:

  node scripts/next-ticket.mjs

Take the routed ticket only if it's frontier implement work (ready-for-agent). If it routes to
triage/wayfinder/handoff instead, report claimed: false with why. Otherwise claim it per`
    }
docs/agents/issue-tracker.md in ONE chained call, with <NUM> the number and <BRANCH> the
agent/<number>-<slug> branch you will use:

  gh issue edit <NUM> --repo ${REPO} --add-label in-progress && \\
  gh issue comment <NUM> --repo ${REPO} --body 'Claimed by \`<BRANCH>\`.' && \\
  gh issue view <NUM> --repo ${REPO} --comments

Read that last output to confirm you won the race — stand down if a claim older than yours is
already there.

Then take a worktree, so no later stage shares a checkout whose HEAD another session moves. The
commands are generated, not composed here — run exactly what this prints, in order, joined with
"&&", with <NUM> the number and <BRANCH> the agent/<number>-<slug> branch:

  ${writeJsonCommand('/tmp/ticket-pipeline-worktree.json', { number: '<NUM>', branch: '<BRANCH>' })}
  npx tsx lib/ticketPipeline/worktree.ts < /tmp/ticket-pipeline-worktree.json | \\
    jq -r 'join(" && ")' > /tmp/ticket-pipeline-worktree.sh && \\
  bash /tmp/ticket-pipeline-worktree.sh

The last command prints the worktree's absolute path — report that as worktreePath. The one before
it resolves a package: it fails if the checkout cannot see the install, and a failure anywhere in
the chain means report claimed: false rather than handing later stages somewhere nothing runs.
Run the gate below from that worktree.

Then run the design-first gate yourself, with <NUM> the number you just claimed and the array
literal the issue's Ground truth pointers as repo-relative paths (lib/foo.ts — an absolute
Windows path breaks this quoting, which is the point). The body reaches the module through a
file, never a shell argument:

gh issue view <NUM> --repo ${REPO} --json body,comments --jq '{filesTouched:["lib/foo.ts","tests/foo.test.ts"],body:([.body]+[.comments[].body]|join("\\n\\n"))}' > /tmp/ticket-pipeline-gate.json
npx tsx lib/ticketPipeline/gate.ts < /tmp/ticket-pipeline-gate.json

Report: claimed, number, branch, title, worktreePath, filesTouched (that same repo-relative list),
escalate and gateReason taken verbatim from the gate's JSON stdout, reason. If either gate command fails, or
its stdout is not the JSON object the module prints, report escalate: true with the failure as
gateReason — this is the pipeline's only escalation valve, so a gate that could not run must never
answer "no escalation needed". If it does escalate, hand the ticket back before you report: remove
in-progress, add ready-for-human, comment the gate's reason. Do not report the issue body; every
later stage reads it from GitHub itself.`,
    { model: MODELS.claim, phase: 'Claim', label: 'claim the next queue ticket', schema: CLAIM_SCHEMA }
  )
  if (!claim?.claimed) {
    log(`Nothing claimed: ${claim?.reason ?? 'the claim agent died before reporting'}`)
    return { landed: false, reason: claim?.reason ?? 'claim agent died' }
  }
  run.ticket = `#${claim.number}`
  log(`#${claim.number} ${claim.title || ''} — on ${claim.branch}`)
  // The claim comment, the worktree and the branch all exist by the time the gate runs, so every
  // exit from here has to hand back all three. Registering them before the first `return` makes
  // that true by construction. Watch for: a worktree left standing keeps the branch in
  // `git worktree list`, where the staleness test reads it as a live claim forever.
  claimOpen = true
  claimedNumber = claim.number
  state.localBranch = claim.branch
  state.worktreePath = claim.worktreePath ?? null

  if (claim.escalate) {
    log(`#${claim.number} handed back: ${claim.gateReason}`)
    releaseReason = `the design gate handed this back: ${claim.gateReason}`
    return { landed: false, ticket: claim.number, reason: `escalated: ${claim.gateReason}` }
  }
  if (!claim.worktreePath) {
    releaseReason = 'the claim stage reported no worktree, so no later stage has a checkout it owns'
    return { landed: false, ticket: claim.number, reason: 'no worktree' }
  }

  phase('Implement')
  const impl = await agent(
    `${cwdNote(claim)}
Take issue #${claim.number} to a finished state. You are the only stage that writes code, and
nothing downstream will improve the change — ci.yml can only tell you whether it broke something.
So finish it here: no stubs, no "left as a follow-up" for something the ticket asked for, no
tests that assert around the part that was hard. Take the time it takes.

## 1. Read the whole issue

gh issue view ${claim.number} --repo ${REPO} --comments

The comments are part of the specification, not commentary on it: the owner's rulings, the
decisions a triage pass settled and the traps found later all arrive there, and the body is often
the state of the question before any of them.

**Write down its Definition of done as a checklist before you start**, and treat those boxes as
the contract. If the ticket names a floor — a test that must fail before the fix — that is one of
the boxes, not a suggestion. If a box turns out to be impossible or wrong, say so in your summary
rather than quietly dropping it.

The claim stage read it as touching: ${(claim.filesTouched || []).join(', ') || '(nothing listed)'}

## 2. Pick your approach to the size of the job

A small, decided ticket — one behaviour, files you can hold in your head — is written directly.

For a big one — several subsystems, an order that matters, or a change you cannot hold in one
pass — spend the time up front: \`superpowers:writing-plans\` turns the ticket into a staged plan,
and \`superpowers:executing-plans\` walks it with checkpoints. That is cheap next to discovering
halfway through that step three needed step one to have gone differently. Do not reach for it on
something you could have finished in the time it takes to plan.

## 3. Build it

Run \`mattpocock-skills:implement\` and follow it — TDD at pre-agreed seams via \`/tdd\`, typecheck
and single test files as you go.

**Two overrides, and only two.**

That skill says to run the full test suite once at the end. **Do not.** \`ci.yml\` runs it against
a clean build on the push, and running it here pays those minutes twice for an answer already on
its way:

${LOCAL_TEST_NOTE}

And do **not** run \`/code-review\` yourself, or dispatch any sub-agent to review the diff. The
Review phase below this one does it, in this same worktree, and its findings come back to you as
data. A review dispatched from inside this stage starts in whatever directory this workflow was
launched from — the shared main checkout, where this branch's diff does not exist — and reports a
clean bill against an empty diff.

One habit the skill does not cover: read each file you are going to change ONCE, whole, with the
Read tool. A file rebuilt from twenty sed/grep windows costs far more than the file.

## 4. Check yourself against the contract

Walk the Definition of done checklist one box at a time and confirm each against the code you
actually wrote — not against what you intended.

## 5. Commit, and stop there

Commit your work on ${claim.branch}. **Do not push, and do not open a pull request** — the Review
phase after this one does both, once it has reviewed what you committed. Pushing here would start
ci.yml against a tree the review has not seen yet, and pay for a second run when it changes
anything.

In summary, say which Definition of done boxes you closed and name any you did not, with why.
An honest gap is worth more than a green report — it is the thing a human can act on.
Report: committed, commitSha, summary, filesTouched.`,
    { model: MODELS.implement, phase: 'Implement', label: label('implement'), schema: IMPLEMENT_SCHEMA }
  )
  // Same absence as `reported()` handles below, one stage earlier: a session limit killed the
  // implement agent, `agent()` returned null, and reading `.committed` off it threw before the
  // claim could be released. Every stage that can die has to read as "it did not get there".
  if (!impl?.committed) {
    releaseReason = `implementation didn't complete: ${impl.summary || 'no reason given'}`
    return { landed: false, ticket: claim.number, reason: 'implement failed' }
  }

  // Review is a phase, not something the implement agent dispatches. A sub-agent it spawns starts
  // in the directory this workflow was launched from — the shared main checkout, where this
  // branch's diff does not exist — and three separate runs had one report a clean bill against an
  // empty diff. Here the worktree comes from the script, so the reviewer cannot be anywhere else.
  phase('Review')
  const review = await agent(
    `${BASH_NOTE}
${cwdNote(claim)}
Issue #${claim.number} is committed on ${claim.branch} but not pushed. Review it, then ship it.

## 1. Review what is committed

  git diff origin/main...HEAD --stat

That diff is non-empty. **If it is empty you are in the wrong checkout** — stop and report
pushed: false rather than reviewing nothing.

Run \`/code-review --fix\` over it, from here. Read what it changed; you own the result, it does
not. Then re-run the narrow tests it touched, because a fix that improves the code can still make
a test wrong. Anything it could not fix, fix yourself or say why it stands in your summary. Do not
push past a correctness finding. Commit whatever the review changed.

## 2. Push and open the pull request

That is what starts ci.yml against this tree; the verify stage reads its verdict rather than
repeating the suite locally. The body needs a file since it is multi-line, and ends with
"Closes #${claim.number}" — which closes the issue on merge. Never put that in a commit message,
where it closes at push time, before CI has said anything:

  cat > /tmp/pipeline-pr-body.md <<'EOF'
<a short PR body saying what shipped and how it was checked>

Closes #${claim.number}
EOF
  git push -u origin ${sq(claim.branch)} && \\
  gh pr create --repo ${REPO} --title "<a short title>" --body-file /tmp/pipeline-pr-body.md

Report: pushed, prNumber, findingsFixed (how many the review applied), summary.`,
    { model: MODELS.review, phase: 'Review', label: label('review'), schema: REVIEW_SCHEMA }
  )
  if (!review?.prNumber) {
    releaseReason = `the branch never reached a pull request, so nothing ran against it: ${
      review?.summary || impl.summary || 'no reason given'
    }`
    return { landed: false, ticket: claim.number, reason: 'no pull request' }
  }
  impl.prNumber = review.prNumber

  // CI is the gate, and the only one. It runs the real suite against the real tree, it is free on
  // this repo, and it cannot be argued out of a verdict. Model reviewers can: every spiral this
  // pipeline produced came from lenses debating a diff, never from the suite.
  let verify = reported(await runVerify(claim, impl.prNumber, 1))
  if (verify.infrastructure) {
    releaseReason = `CI could not run: ${verify.failedStep || 'no job reported steps'}`
    return { landed: false, ticket: claim.number, reason: 'ci unavailable' }
  }
  // The loop is only ever entered on a red run, so there is no "it was green and got worse" case
  // to guard against and no finding count to watch converge. That whole apparatus existed to
  // contain model reviewers arguing with each other; with the suite as the only judge, the round
  // cap is the entire termination condition.
  let round = 0
  while (!verify.pass && round < MAX_FIX_ROUNDS) {
    round++
    phase('Fix')
    const fix = await agent(
      `${cwdNote(claim)}
ci.yml is red on this branch. Make it green, and change nothing the failure does not require.

Failing step: ${verify.failedStep || '(not reported)'}
Output:
${verify.output || '(none reported)'}

${LOCAL_TEST_NOTE}

Run the failing test here and watch it pass before you push. Pushing a guess costs a nine-minute
round to find out, and a fix round has turned a working branch broken more than once.

If the failure is not obvious from the output above, \`mattpocock-skills:diagnosing-bugs\` drives
the diagnosis loop rather than leaving you to guess at it — reach for it before a second round,
not after the fourth.

The push re-runs ci.yml, which is the next round's evidence.
Report: committed, commitSha, summary, filesTouched.`,
      { model: MODELS.fix, phase: 'Fix', label: label(`fix round ${round}`), schema: IMPLEMENT_SCHEMA }
    )
    if (!fix?.committed) break
    verify = reported(await runVerify(claim, impl.prNumber, round + 1))
    // A run that never started is not a defect to chase: the loop would spend its rounds on a
    // failure nothing reported, and the branch would be handed back as though it were red.
    if (verify.infrastructure) {
      releaseReason = `CI could not run: ${verify.failedStep || 'no job reported steps'}`
      return { landed: false, ticket: claim.number, reason: 'ci unavailable' }
    }
  }

  if (!verify.pass) {
    releaseReason = `ci.yml is still red after ${round} fix round(s). Failing step: ${
      verify.failedStep || '(not reported)'
    }. The branch and its pull request are left in place to pick up from.`
    return { landed: false, ticket: claim.number, reason: `ci red after ${round} fix round(s)` }
  }

  phase('Land')
  const land = await agent(
    `${BASH_NOTE}
${cwdNote(claim)}
Pull request #${impl.prNumber} is green on ci.yml. Land it.

ci.yml's scope job skips a main push whose tree the pull request already passed, and that holds
only while main has not moved underneath. So check whether it has, first:

  gh pr view ${impl.prNumber} --repo ${REPO} --json mergeStateStatus,mergeable

BEHIND means main moved: run "gh pr update-branch ${impl.prNumber} --repo ${REPO}", then wait for
the run on that new tree the way the verify stage did (gh pr checks --watch, verdict from
gh run view --json conclusion) and merge only if it is green. One run either way — merging a stale
branch buys a full billed suite on main instead.

CLEAN, and with the merge body already carrying "Closes #${claim.number}", one chained call:

  gh pr merge --merge --delete-branch ${impl.prNumber} --repo ${REPO} && \\
  gh issue view ${claim.number} --repo ${REPO} --json state --jq .state

No --admin: the branch has a real green run, so let the merge take the ordinary path. The issue
closes itself from the pull request body — that last command is the confirmation, and if it does
not read CLOSED, close it yourself with a one-line comment saying what shipped.

Report: merged, prNumber, reason.`,
    { model: MODELS.land, phase: 'Land', label: label('land'), schema: LAND_SCHEMA }
  )
  // The last stage that can die and take the claim with it: without this, a merged pull request
  // can go unrecorded, or a green branch can throw on its way out.
  if (!land?.merged) {
    releaseReason = `ci.yml was green but the branch did not merge: ${
      land?.reason || 'the land agent died before reporting'
    }. Pull request #${impl.prNumber} is green and ready to merge by hand.`
    return { landed: false, ticket: claim.number, prNumber: impl.prNumber, reason: 'land failed' }
  }
  state.merged = true
  claimOpen = false
  return { landed: true, prNumber: land.prNumber ?? impl.prNumber, ticket: claim.number, reason: land.reason }
} finally {
  // A throw in here would replace whatever the try block returned or threw, so nothing escapes.
  try {
    phase('Cleanup')
    // Whether a claim needs releasing and whether the local branch survived a merge are both
    // already known here — nothing about either is the cleanup agent's judgement call, so the
    // commands for them are assembled now rather than left for it to decide at runtime.
    const releaseCommand =
      claimOpen && claimedNumber
        ? `gh issue edit ${claimedNumber} --repo ${REPO} --remove-label in-progress --add-label ready-for-human && ` +
          `gh issue comment ${claimedNumber} --repo ${REPO} --body ${sq(releaseReason)} ; `
        : ''
    const branchDeleteCommand =
      state.merged && state.localBranch ? `git branch -D ${sq(state.localBranch)} 2>/dev/null ; ` : ''
    const cleaned = await agent(
      `${BASH_NOTE}
This run's branch is ${state.localBranch || '(none)'} and merged=${state.merged}. Run this from the
directory you are already in, and do NOT change its branch: this checkout is shared, and moving its
HEAD pulls whatever session owns it off its own work. The branch this run used lives in the
worktree, so removing the worktree is what frees it. Everything below is already decided — run it
as one chained call. The later pieces are joined with ";" rather than "&&" because teardown is
idempotent and tolerates a worktree or branch that is already gone:

  ${releaseCommand}${writeJsonCommand('/tmp/ticket-pipeline-cleanup.json', state)} && \\
  npx tsx lib/ticketPipeline/cleanup.ts < /tmp/ticket-pipeline-cleanup.json | \\
    jq -r 'join(" ; ")' > /tmp/ticket-pipeline-cleanup.sh && \\
  bash /tmp/ticket-pipeline-cleanup.sh ; \\
  ${branchDeleteCommand}git status --short

That teardown list removes this run's worktree and, when the run did not merge, deletes the local
branch only if it holds no commits origin/main
lacks — "gh pr merge --delete-branch" only removes the remote copy on a merge, which is why
${
  branchDeleteCommand ? 'this run also deletes it directly, since it did merge.' : 'that direct delete is skipped here.'
}
Report the final "git status --short" output and the current branch verbatim.`,
      { model: MODELS.cleanup, phase: 'Cleanup', label: label('clean up after') }
    )
    log(`Cleanup finished: ${typeof cleaned === 'string' ? cleaned : JSON.stringify(cleaned)}`)
  } catch (error) {
    log(`Cleanup stage failed: ${(error && error.message) || error}`)
  }
}
