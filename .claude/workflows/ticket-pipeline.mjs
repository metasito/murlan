export const meta = {
  name: 'ticket-pipeline',
  description: 'Claim, gate, implement, land one murlan queue ticket — ci.yml is the gate',
  phases: [
    { title: 'Claim', detail: 'claim the routed ticket and run the design-first gate', model: 'haiku' },
    { title: 'Implement', detail: 'implement, commit, push, open the pull request', model: 'sonnet' },
    { title: 'Verify', detail: "ci.yml's verdict on the pushed branch", model: 'sonnet' },
    { title: 'Fix', detail: 'make a red run green', model: 'sonnet' },
    { title: 'Land', model: 'sonnet' },
    { title: 'Cleanup', model: 'sonnet' },
  ],
}

// Every agent() call names its model. An omitted one inherits the session's, which is how
// editing a label ends up costing what reviewing a diff costs. Judgement that cannot be redone
// cheaply gets the big model; everything that follows a written procedure does not.
const MODELS = {
  claim: 'haiku', // next-ticket.mjs, two gh writes, one CLI whose failure mode is fail-safe
  implement: 'sonnet',
  verify: 'sonnet', // long, scripted, and has to read failures back accurately
  fix: 'sonnet',
  land: 'sonnet',
  cleanup: 'sonnet', // deletes branches and kills processes on a judgement call
}

// `args` names a ticket when the queue's own ordering is not the one wanted — a blocker that has
// to land before the item that needs it. Unset, the router picks as before.
//
// `args: 290` can arrive as the string "290", so a bare `typeof === 'number'` test left the pin
// undefined and the router picked a different ticket — a caller who names one and silently gets
// another. An unusable pin now stops the run instead of routing around it.
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
// browser 526s — so a stage that reruns any of it locally pays those minutes twice for an answer
// already coming. #204's implement stage ran `npm test` three times while iterating on one spec.
const LOCAL_TEST_NOTE = `What to run here, and what not to.

While iterating, run only what you are iterating on: \`npm run typecheck\`, \`node --test <the one
file>\`, and for a browser test \`npx playwright test --config tests/e2e/playwright.config.ts
<one-spec.ts>\` or the same with \`-g "<one test name>"\`.

Once, before you push: \`npm run typecheck && npm run lint\`. About a minute together, and they are
what ci.yml fails on most often — worth it to not spend a nine-minute round learning it.

Never run \`npm test\`, \`npm run test:e2e\`, \`npm run test:native\` or \`npm run verify\`. That is the
sweep, and the run on your push is already doing it against a clean build.

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
    prNumber: { type: 'number' },
    summary: { type: 'string' },
    filesTouched: { type: 'array', items: { type: 'string' } },
  },
  required: ['committed'],
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

// No ports and no containers: the suites run on GitHub's runners now, so the worktree and the
// branch are all this run leaves behind. cleanup.ts still takes `dockerStarted`, and false is the
// honest answer rather than a field dropped from the payload it validates.
const state = {
  worktreePath: null,
  dockerStarted: false,
  localBranch: null,
  merged: false,
}

// The progress view shows a label per agent, and falls back to the head of the prompt when there
// is none — which is why an unlabelled run reads as seven walls of instructions with no ticket
// number anywhere. `ticket` is filled in once the claim stage knows what it took.
const run = { ticket: 'no ticket yet' }
function label(stage) {
  return `${stage} ${run.ticket}`
}

// Every stage after Claim starts in the directory the workflow was launched from, which is the
// shared main checkout — another session moves its HEAD whenever it merges. Two verify rounds
// once swept a different ticket's merged diff and reported a pass on it. So each stage is told
// where to stand and made to prove it got there before it does anything else.
function cwdNote(claim) {
  return `Work in ${claim.worktreePath}. Before anything else:
  cd ${claim.worktreePath} && git rev-parse --abbrev-ref HEAD
If that does not print ${claim.branch}, stop and report failure — you are in a checkout that
belongs to another session, and nothing you measure there is about this ticket.`
}

// GitHub Actions runs ci.yml against the pushed branch — typecheck, tests, lint, native,
// browser and the build-and-boot, in parallel on runners that are free and unlimited for a
// public repo. This stage reads that verdict. It used to reproduce the whole sweep locally,
// which is what the pipeline did while Actions was billing-blocked, and it cost about twenty
// minutes a round to learn what the run reports anyway.
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

Take the verdict from that JSON's "conclusion", never from the watcher's exit status: piped into
anything, that status belongs to the pipe's last command, so a red run reads as a pass. That is
how a broken branch once reached main.

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

A "Claimed by \`<branch>\`" comment does not by itself mean somebody is working on it. Apply the
test in CLAUDE.md rather than judging by eye, and do not assert either answer without running it:

  git ls-remote --heads origin <that-branch> ; git worktree list

A branch in neither is a stale claim — say so on the issue, then take it. A branch in either is
live: stand down. Then claim it per`
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

Then take a worktree, so no later stage shares a checkout whose HEAD another session moves:

  git worktree add -b <BRANCH> ../murlan-wt-<NUM> origin/main && cd ../murlan-wt-<NUM> && pwd

Report that absolute path as worktreePath; if the command fails, report claimed: false. Run the
gate below from there too.

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
  // way out from here has to hand back all three. Registering them before the first exit is what
  // makes that true by construction: #204's escalated run left its worktree standing, so
  // `git worktree list` still named the branch, and the staleness test in CLAUDE.md read the
  // claim as live — the ticket then refused every later run that tried to take it.
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
Implement issue #${claim.number} via the mattpocock-skills:implement workflow — TDD at pre-agreed
seams.

${LOCAL_TEST_NOTE}

Read the issue yourself with:
gh issue view ${claim.number} --repo ${REPO} --comments
The comments are part of the specification, not commentary on it: the owner's rulings, the
decisions a triage pass settled and the traps found later all arrive there, and the body is
often the state of the question before any of them. Read the whole issue before deciding
anything.
The claim stage read it as touching: ${(claim.filesTouched || []).join(', ') || '(nothing listed)'}

Read each file you are going to change ONCE, whole, with the Read tool. Do not rebuild your
picture of a file from repeated sed/grep windows — each window costs a turn, and a file read in
twenty pieces costs far more than the file. Re-read only what you have edited.

Commit your work, then push it and open the pull request — that is what starts ci.yml against
this tree, and the verify stage reads its verdict rather than repeating the suite locally. The
body needs a file since it is multi-line, and ends with "Closes #${claim.number}" (which closes
the issue on merge; never put that in a commit message, where it closes at push time):

  cat > /tmp/pipeline-pr-body.md <<'EOF'
<a short PR body saying what shipped and how it was checked>

Closes #${claim.number}
EOF
  git push -u origin ${claim.branch} && \\
  gh pr create --repo ${REPO} --title "<a short title>" --body-file /tmp/pipeline-pr-body.md

Report that pull request's number as prNumber; if the push or the create fails, report
committed: true with prNumber omitted and say so in summary.
Report: committed, commitSha, prNumber, summary, filesTouched.`,
    { model: MODELS.implement, phase: 'Implement', label: label('implement'), schema: IMPLEMENT_SCHEMA }
  )
  // Same absence as `reported()` handles below, one stage earlier: a session limit killed the
  // implement agent, `agent()` returned null, and reading `.committed` off it threw before the
  // claim could be released. Every stage that can die has to read as "it did not get there".
  if (!impl?.committed) {
    releaseReason = `implementation didn't complete: ${impl.summary || 'no reason given'}`
    return { landed: false, ticket: claim.number, reason: 'implement failed' }
  }
  if (!impl.prNumber) {
    releaseReason = `the branch never reached a pull request, so nothing ran against it: ${
      impl.summary || 'no reason given'
    }`
    return { landed: false, ticket: claim.number, reason: 'no pull request' }
  }

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
  state.merged = land.merged
  if (land.merged) claimOpen = false
  return { landed: land.merged, prNumber: land.prNumber, ticket: claim.number, reason: land.reason }
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
directory you are already in, and do NOT change its branch: this checkout is shared, and another
session was once pulled off its own branch mid-sweep by a teardown tidying up after itself. The
branch this run used lives in the worktree, so removing the worktree is what frees it. Everything
below is already decided, so run it as one chained call rather than as separate steps — idempotent
teardown tolerates a container, worktree or branch that's already gone, which is why the later
pieces are joined with ";" instead of "&&":

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
