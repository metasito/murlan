export const meta = {
  name: 'ticket-pipeline',
  description: 'Claim, gate, implement, verify, independently review, and land one murlan queue ticket end to end',
  phases: [
    { title: 'Claim', detail: 'claim the routed ticket and run the design-first gate', model: 'haiku' },
    { title: 'Implement', detail: 'implement, commit, push, open the pull request', model: 'sonnet' },
    { title: 'Verify', detail: "ci.yml's verdict on the pushed branch", model: 'sonnet' },
    { title: 'Review', detail: 'three independent lenses', model: 'opus' },
    { title: 'Fix', model: 'sonnet' },
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
  review: 'opus', // CI proves the suite still passes; only this asks whether the change is right
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

// A ceiling, not a budget. `stalled` below ends the loop the moment a round stops improving on
// the one before it, so a run that is going nowhere costs one round and this number never
// applies to it. What the number decides is how far a run that *is* converging may go: #293 came
// down 7 -> 5 -> 1 confirmed findings with CI going red -> green, and was cut off one round short
// of clean by a limit that was counting attempts.
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

// Review needs to know whether the diff is prose before it can drop the behaviour lens, and it
// now starts at the same moment as Verify — so whoever commits works it out, not Verify.
const PROSE_CAPTURE_NOTE = `Before you report, classify the diff you just committed so the review
stage does not have to wait on Verify to learn it — two commands:
  git diff --name-only origin/main...HEAD
Turn those lines into a JSON array of repo-relative paths and run:
  npx tsx lib/ticketPipeline/verifyPlan.ts <<< '["path/one.ts","path/two.ts"]'
Report its "prose" field verbatim.`

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
    prose: { type: 'boolean' },
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

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          summary: { type: 'string' },
          verdict: { type: 'string', enum: ['CONFIRMED', 'PLAUSIBLE', 'REJECTED'] },
        },
        required: ['file', 'summary', 'verdict'],
      },
    },
  },
  required: ['findings'],
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
function reported(verify, review) {
  return [
    verify ?? {
      pass: false,
      infrastructure: true,
      failedStep: 'the verify agent died before reporting',
    },
    review ?? { findings: [], failedLenses: ['every lens — the review agent died before reporting'] },
  ]
}

async function runReview(claim, scopeNote, onlyKeys, prose, sinceRef) {
  // The scope has to be the git command, not a sentence above it. Told "review only the fix" and
  // handed `origin/main...HEAD` anyway, three fresh lenses re-read the whole branch every round
  // and each round found new prose to object to — 23 findings, then 31, on a diff that was
  // converging. A round reviews what that round changed.
  const range = sinceRef ? `${sinceRef}..HEAD` : 'origin/main...HEAD'
  const diffScope = scopeNote
    ? `only this round's fix for: ${scopeNote}`
    : 'the whole diff'
  const allLenses = [
    {
      key: 'standards',
      prompt: `Review ${diffScope} on branch ${claim.branch} (git diff ${range}) using
mattpocock-skills:code-review's standards axis: documented repo conventions (CLAUDE.md) plus the
Fowler smell baseline. You did not write this code — read it cold. CLAUDE.md's comment policy is
one of those conventions and the one most often broken: flag as CONFIRMED any new or changed
comment that narrates history, restates the code below it, or explains a defect the diff just
fixed. Report findings: file, line, summary, verdict (CONFIRMED/PLAUSIBLE/REJECTED).`,
    },
    {
      key: 'spec',
      prompt: `Review ${diffScope} on branch ${claim.branch} (git diff ${range}) against
issue #${claim.number}, which you should read yourself with: gh issue view ${claim.number} --repo ${REPO}
Using mattpocock-skills:code-review's spec axis: missing requirements, scope creep, anything
implemented but wrong. Report findings: file, line, summary, verdict (CONFIRMED/PLAUSIBLE/REJECTED).`,
    },
    {
      key: 'adversarial',
      needsCode: true,
      prompt: `For every new or changed test or runtime guard in ${diffScope} on branch ${claim.branch}
(git diff ${range}): try to prove it passes on broken code — invert or delete the logic it
claims to protect, rerun it, confirm whether it would actually catch the break. Any test/guard that
still passes on broken code is a CONFIRMED finding. Report: file, line, summary, verdict.`,
    },
  ]
  // A re-review after a fix only has to re-ask the lens that raised the finding: the other
  // lenses read a diff that has not moved since they cleared it. And a lens that reviews
  // behaviour has none to review in a prose diff — on the last docs ticket the adversarial lens
  // ran three times and reported, each time, that there was nothing to invert.
  const applicable = allLenses.filter((l) => !(l.needsCode && prose))
  const lenses = onlyKeys ? applicable.filter((l) => onlyKeys.includes(l.key)) : applicable
  const results = await parallel(
    lenses.map((l) => () => agent(l.prompt, { model: MODELS.review, phase: 'Review', label: label(`review:${l.key}`), schema: FINDING_SCHEMA }))
  )
  const failedLenses = lenses.filter((l, i) => !results[i]).map((l) => l.key)
  if (failedLenses.length) {
    log(`Review lenses reported nothing: ${failedLenses.join(', ')} — counted as unreviewed, not as clean.`)
  }
  return {
    // Index against `lenses`, not against the filtered array — a lens that returned nothing
    // shifts every later result onto the wrong name, and the next round then re-runs whichever
    // lens the mislabelling happened to point at.
    findings: results.flatMap((r, i) => (r?.findings || []).map((f) => ({ ...f, lens: lenses[i].key }))),
    failedLenses,
  }
}

function confirmedIn(review) {
  return review.findings.filter((f) => f.verdict === 'CONFIRMED')
}

function actionable(verify, review) {
  return !verify.pass || confirmedIn(review).length > 0
}

function isClean(verify, review) {
  return !actionable(verify, review) && review.failedLenses.length === 0
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
and take it only if it is open, ready-for-agent and unclaimed; report claimed: false with why
otherwise. Then claim it per`
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

gh issue view <NUM> --repo ${REPO} --json body --jq '{filesTouched:["lib/foo.ts","tests/foo.test.ts"],body:.body}' > /tmp/ticket-pipeline-gate.json
npx tsx lib/ticketPipeline/gate.ts < /tmp/ticket-pipeline-gate.json

Report: claimed, number, branch, title, worktreePath, filesTouched (that same repo-relative list), escalate and
gateReason taken verbatim from the gate's JSON stdout, reason. If either gate command fails, or
its stdout is not the JSON object the module prints, report escalate: true with the failure as
gateReason — this is the pipeline's only escalation valve, so a gate that could not run must never
answer "no escalation needed". If it does escalate, hand the ticket back before you report: remove
in-progress, add ready-for-human, comment the gate's reason. Do not report the issue body; every
later stage reads it from GitHub itself.`,
    { model: MODELS.claim, phase: 'Claim', label: 'claim the next queue ticket', schema: CLAIM_SCHEMA }
  )
  if (!claim.claimed) {
    log(`Nothing claimed: ${claim.reason}`)
    return { landed: false, reason: claim.reason }
  }
  run.ticket = `#${claim.number}`
  log(`#${claim.number} ${claim.title || ''} — on ${claim.branch}`)
  if (claim.escalate) {
    log(`#${claim.number} handed back: ${claim.gateReason}`)
    // The claim comment is posted before the gate runs, so escalating leaves one naming a branch
    // that was never pushed. `in-progress` comes off, but the comment stays and the next run reads
    // it as somebody else's work — #204 escalated at the gate and then refused itself. Releasing
    // here makes cleanup retract the comment as well as the label.
    claimOpen = true
    claimedNumber = claim.number
    releaseReason = `the design gate handed this back: ${claim.gateReason}. No branch was pushed, so this claim is withdrawn.`
    return { landed: false, ticket: claim.number, reason: `escalated: ${claim.gateReason}` }
  }
  if (!claim.worktreePath) {
    releaseReason = 'the claim stage reported no worktree, so no later stage has a checkout it owns'
    return { landed: false, ticket: claim.number, reason: 'no worktree' }
  }
  claimOpen = true
  claimedNumber = claim.number
  state.localBranch = claim.branch
  state.worktreePath = claim.worktreePath

  phase('Implement')
  const impl = await agent(
    `${cwdNote(claim)}
Implement issue #${claim.number} via the mattpocock-skills:implement workflow — TDD at pre-agreed
seams, typecheck and single test files while iterating. Read the issue yourself with:
gh issue view ${claim.number} --repo ${REPO}
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
${PROSE_CAPTURE_NOTE}
Report: committed, commitSha, prNumber, summary, filesTouched, prose.`,
    { model: MODELS.implement, phase: 'Implement', label: label('implement'), schema: IMPLEMENT_SCHEMA }
  )
  if (!impl.committed) {
    releaseReason = `implementation didn't complete: ${impl.summary || 'no reason given'}`
    return { landed: false, ticket: claim.number, reason: 'implement failed' }
  }
  if (!impl.prNumber) {
    releaseReason = `the branch never reached a pull request, so nothing ran against it: ${
      impl.summary || 'no reason given'
    }`
    return { landed: false, ticket: claim.number, reason: 'no pull request' }
  }

  // CI runs on the push while the lenses read the same commit, so the run's ~9 minutes overlap
  // the review instead of following it. A red run does not waste the concurrent review either:
  // the fix agent gets both together and answers them in one round.
  let [verify, review] = await parallel([
    () => runVerify(claim, impl.prNumber, 1),
    () => runReview(claim, null, null, impl.prose, null),
  ])
  ;[verify, review] = reported(verify, review)
  // The lenses advance whatever they said — they have read that commit, and re-reading it is what
  // produced a fresh crop of prose objections every round. CI needs no such marker: every push
  // runs the whole workflow, and ci.yml's own scope job decides what the diff can skip.
  let reviewedSha = impl.commitSha
  if (verify.infrastructure) {
    releaseReason = `CI could not run: ${verify.failedStep || 'no job reported steps'}`
    return { landed: false, ticket: claim.number, reason: 'ci unavailable' }
  }
  let round = 0
  // A fix round can make things worse, and twice it has: #291 went 11 -> 18 -> 14 confirmed
  // findings on a two-file prose diff, and #294's fix rounds turned a green run red and then
  // red again while findings climbed 6 -> 7 -> 14. Neither run was converging, and both spent
  // every round they had finding that out. `stalled` ends the loop the moment a round fails to
  // improve on the one before it, so the rounds are a budget for progress rather than for
  // attempts.
  let prevConfirmed = confirmedIn(review).length
  let prevPass = verify.pass
  let stalled = null
  while (actionable(verify, review) && round < MAX_FIX_ROUNDS && !stalled) {
    round++
    phase('Fix')
    const confirmed = confirmedIn(review)
    const lensesThatFound = [...new Set(confirmed.map((f) => f.lens).filter(Boolean))]
    const findingList = confirmed
      .map((f) => `- ${f.file}${f.line ? ':' + f.line : ''} — ${f.summary}`)
      .join('\n')
    const verifyNote = verify.pass
      ? ''
      : `\nCI is red on this branch — make it green. Failing step: ${
          verify.failedStep || '(not reported)'
        }\nOutput:\n${verify.output || '(none reported)'}`
    const fix = await agent(
      `${cwdNote(claim)}
Fix exactly these findings and nothing else, then commit and push. The push is what re-runs
ci.yml on the pull request, which is the next stage's evidence.
Findings:\n${
        findingList || '- (no review findings; the red run below is the whole job)'
      }${verifyNote}
${PROSE_CAPTURE_NOTE}
Report: committed, commitSha, summary, filesTouched, prose.`,
      { model: MODELS.fix, phase: 'Fix', label: label(`fix round ${round}`), schema: IMPLEMENT_SCHEMA }
    )
    if (!fix.committed) break
    // A fix that edits a file the implement commit never touched is answering something other
    // than the ticket. #291's third round rewrote scripts/next-ticket.mjs, which that issue's
    // Definition of done had named as out of scope.
    const widened = (fix.filesTouched || []).filter((f) => !(impl.filesTouched || []).includes(f))
    ;[verify, review] = await parallel([
      () => runVerify(claim, impl.prNumber, round + 1),
      () => runReview(claim, confirmed.map((f) => f.summary).join('; '), lensesThatFound, fix.prose, reviewedSha),
    ])
    ;[verify, review] = reported(verify, review)
    reviewedSha = fix.commitSha || reviewedSha
    // A run that never started is not a defect to chase: the fix loop would spend its rounds on
    // a failure nothing reported, and the branch would be handed back as though it were red.
    if (verify.infrastructure) {
      releaseReason = `CI could not run: ${verify.failedStep || 'no job reported steps'}`
      return { landed: false, ticket: claim.number, reason: 'ci unavailable' }
    }
    const nowConfirmed = confirmedIn(review).length
    if (prevPass && verify.pass === false) {
      stalled = `fix round ${round} turned a green run red: the commit under review passed ci.yml and the fix did not`
    } else if (widened.length > 0 && nowConfirmed >= prevConfirmed) {
      stalled = `fix round ${round} edited ${widened.join(', ')}, which the implement commit never touched, and did not reduce findings (${prevConfirmed} -> ${nowConfirmed})`
    } else if (nowConfirmed >= prevConfirmed && verify.pass === prevPass) {
      stalled = `fix round ${round} did not converge: ${prevConfirmed} confirmed finding(s) before, ${nowConfirmed} after`
    }
    prevConfirmed = nowConfirmed
    prevPass = verify.pass
  }
  if (stalled) log(`Stopping the fix loop — ${stalled}`)

  if (!isClean(verify, review)) {
    releaseReason = `${
      stalled ? `Stopped early — ${stalled}. ` : ''
    }${round} fix round(s) didn't reach a clean state. Remaining: ${JSON.stringify(
      confirmedIn(review)
    )}. Verify pass: ${verify.pass}. Review lenses that reported nothing: ${
      review.failedLenses.join(', ') || 'none'
    }.`
    return {
      landed: false,
      ticket: claim.number,
      reason: stalled || `not clean after ${round} fix round(s)`,
    }
  }

  phase('Land')
  const land = await agent(
    `${BASH_NOTE}
${cwdNote(claim)}
Pull request #${impl.prNumber} is green on ci.yml and clean through three independent review
lenses. Land it.

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
