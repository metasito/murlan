export const meta = {
  name: 'ticket-pipeline',
  description: 'Claim, gate, implement, verify, independently review, and land one murlan queue ticket end to end',
  phases: [
    { title: 'Claim' },
    { title: 'Implement' },
    { title: 'Verify' },
    { title: 'Review' },
    { title: 'Fix' },
    { title: 'Land' },
    { title: 'Cleanup' },
  ],
}

const MAX_FIX_ROUNDS = 2

const BASH_NOTE =
  'Use the Bash tool (POSIX sh), not PowerShell: the JSON argument below is already POSIX single-quote escaped.'

function shellArg(value) {
  return `'${JSON.stringify(value).replace(/'/g, "'\\''")}'`
}

const CLAIM_SCHEMA = {
  type: 'object',
  properties: {
    claimed: { type: 'boolean' },
    number: { type: 'number' },
    branch: { type: 'string' },
    title: { type: 'string' },
    body: { type: 'string' },
    filesTouched: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
  },
  required: ['claimed'],
}

const GATE_SCHEMA = {
  type: 'object',
  properties: { escalate: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['escalate', 'reason'],
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

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    dockerStarted: { type: 'boolean' },
    output: { type: 'string' },
  },
  required: ['pass', 'dockerStarted'],
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

const state = { worktreePath: null, dockerStarted: false, localBranch: null, merged: false }

async function runVerify(filesTouched) {
  // Teardown is owed from the moment the container can exist, not from the agent's report:
  // a verify agent that dies after `docker run` never reports, and the container leaks.
  state.dockerStarted = true
  return agent(
    `${BASH_NOTE}
Run: npx tsx lib/ticketPipeline/verifyPlan.ts ${shellArg(filesTouched || [])}
That prints a JSON array of shell commands to run, in order. If any command needs a
database, start a throwaway Postgres first with a FIXED name so cleanup can find it:
docker run -d --name murlan-verify-pg -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
-e POSTGRES_DB=murlan_test -p 55433:5432 postgres:16-alpine
then wait for pg_isready, then set DATABASE_URL=postgres://postgres:postgres@localhost:55433/murlan_test
and SESSION_SECRET=verify-local for every command in the plan. Run every command from the plan in order.
Report pass (true only if every command exited 0), dockerStarted (whether you started the container),
output (tail of any failing command's output).`,
    { phase: 'Verify', schema: VERIFY_SCHEMA }
  )
}

async function runReview(claim, scopeNote) {
  const diffScope = scopeNote ? `only the fix for: ${scopeNote}` : 'the whole diff'
  const lenses = [
    {
      key: 'standards',
      prompt: `Review ${diffScope} on branch ${claim.branch} (git diff origin/main...HEAD) using
mattpocock-skills:code-review's standards axis: documented repo conventions (CLAUDE.md) plus the
Fowler smell baseline. You did not write this code — read it cold. Report findings: file, line,
summary, verdict (CONFIRMED/PLAUSIBLE/REJECTED).`,
    },
    {
      key: 'spec',
      prompt: `Review ${diffScope} on branch ${claim.branch} (git diff origin/main...HEAD) against
issue #${claim.number}'s body:\n${claim.body}\nUsing mattpocock-skills:code-review's spec axis:
missing requirements, scope creep, anything implemented but wrong. Report findings: file, line,
summary, verdict (CONFIRMED/PLAUSIBLE/REJECTED).`,
    },
    {
      key: 'adversarial',
      prompt: `For every new or changed test or runtime guard in ${diffScope} on branch ${claim.branch}
(git diff origin/main...HEAD): try to prove it passes on broken code — invert or delete the logic it
claims to protect, rerun it, confirm whether it would actually catch the break. Any test/guard that
still passes on broken code is a CONFIRMED finding. Report: file, line, summary, verdict.`,
    },
    {
      key: 'comments',
      prompt: `Every new or changed comment in ${diffScope} on branch ${claim.branch}
(git diff origin/main...HEAD), checked against CLAUDE.md's comment policy (lines 85-98): a comment
only earns its place by naming an invisible constraint, a non-obvious why, a contract types can't
carry, or a pointer to authority. Flag as CONFIRMED anything that narrates history, restates the
code below it, or explains an already-fixed defect. Report: file, line, summary, verdict.`,
    },
  ]
  const results = await parallel(
    lenses.map((l) => () => agent(l.prompt, { phase: 'Review', label: `review:${l.key}`, schema: FINDING_SCHEMA }))
  )
  const failedLenses = lenses.filter((l, i) => !results[i]).map((l) => l.key)
  if (failedLenses.length) {
    log(`Review lenses reported nothing: ${failedLenses.join(', ')} — counted as unreviewed, not as clean.`)
  }
  return { findings: results.filter(Boolean).flatMap((r) => r.findings), failedLenses }
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

try {
  phase('Claim')
  const claim = await agent(
    `Run: node scripts/next-ticket.mjs
Take the routed ticket only if it's frontier implement work (ready-for-agent). If it routes to
triage/wayfinder/handoff instead, report claimed: false with why. Otherwise claim it per
docs/agents/issue-tracker.md: add the in-progress label, comment naming the branch you'll use
(agent/<number>-<slug>), then re-view the issue to confirm you won the race (stand down if an
older claim is already there). Report: claimed, number, branch, title, body (the full issue body),
filesTouched (best-effort list from the issue's Ground truth pointers), reason.`,
    { phase: 'Claim', schema: CLAIM_SCHEMA }
  )
  if (!claim.claimed) {
    log(`Nothing claimed: ${claim.reason}`)
    return { landed: false, reason: claim.reason }
  }
  claimOpen = true
  claimedNumber = claim.number
  state.localBranch = claim.branch

  const gate = await agent(
    `${BASH_NOTE}
Run: npx tsx lib/ticketPipeline/gate.ts ${shellArg({
      filesTouched: claim.filesTouched || [],
      body: claim.body || '',
    })}
Report its JSON stdout verbatim as escalate and reason.`,
    { phase: 'Claim', schema: GATE_SCHEMA }
  )
  if (gate.escalate) {
    await agent(
      `Issue #${claim.number}: remove the in-progress label, add ready-for-human, comment explaining
this needs an owner decision: ${gate.reason}`,
      { phase: 'Claim' }
    )
    claimOpen = false
    return { landed: false, ticket: claim.number, reason: `escalated: ${gate.reason}` }
  }

  phase('Implement')
  const impl = await agent(
    `Create branch ${claim.branch} from origin/main if it doesn't exist locally, check it out.
Implement issue #${claim.number} via the mattpocock-skills:implement workflow — TDD at pre-agreed
seams, typecheck and single test files while iterating. Issue body:\n${claim.body}\nCommit your
work (do not push yet). Report: committed, commitSha, summary, filesTouched.`,
    { phase: 'Implement', schema: IMPLEMENT_SCHEMA }
  )
  if (!impl.committed) {
    await agent(
      `Issue #${claim.number}: remove the in-progress label, add ready-for-human, comment that
implementation didn't complete: ${impl.summary || 'no reason given'}`,
      { phase: 'Implement' }
    )
    claimOpen = false
    return { landed: false, ticket: claim.number, reason: 'implement failed' }
  }

  phase('Verify')
  let verify = await runVerify(impl.filesTouched)

  phase('Review')
  let review = await runReview(claim, null)
  let round = 0
  while (actionable(verify, review) && round < MAX_FIX_ROUNDS) {
    round++
    phase('Fix')
    const confirmed = confirmedIn(review)
    const findingList = confirmed
      .map((f) => `- ${f.file}${f.line ? ':' + f.line : ''} — ${f.summary}`)
      .join('\n')
    const verifyNote = verify.pass
      ? ''
      : `\nLocal verification is also failing — make it pass. Tail of the failing command:\n${
          verify.output || '(none reported)'
        }`
    const fix = await agent(
      `On branch ${claim.branch}, fix exactly these findings and nothing else, then commit:\n${
        findingList || '- (no review findings; the failing verification below is the whole job)'
      }${verifyNote}`,
      { phase: 'Fix', schema: IMPLEMENT_SCHEMA }
    )
    if (!fix.committed) break
    verify = await runVerify(fix.filesTouched)
    review = await runReview(claim, confirmed.map((f) => f.summary).join('; '))
  }

  if (!isClean(verify, review)) {
    await agent(
      `Issue #${claim.number}: remove the in-progress label, add ready-for-human, comment that
${round} fix round(s) didn't reach a clean state. Remaining: ${JSON.stringify(
        confirmedIn(review)
      )}. Verify pass: ${verify.pass}. Review lenses that reported nothing: ${
        review.failedLenses.join(', ') || 'none'
      }.`,
      { phase: 'Land' }
    )
    claimOpen = false
    return { landed: false, ticket: claim.number, reason: `not clean after ${round} fix round(s)` }
  }

  phase('Land')
  const land = await agent(
    `Branch ${claim.branch} is clean (local verify passed, independent review clean). Push it, open a
PR that closes #${claim.number} (put "Closes #${claim.number}" in the PR body only, never the commit
message). CI is billing-blocked today — check the run once; if the scope job dies with no steps (the
known billing failure, confirm via gh api repos/metasito/murlan/check-runs/<id>/annotations), don't
wait on it further. Merge with gh pr merge --merge --admin --delete-branch, then close #${claim.number}
with a comment summarizing what shipped. Report: merged, prNumber, reason.`,
    { phase: 'Land', schema: LAND_SCHEMA }
  )
  state.merged = land.merged
  if (land.merged) claimOpen = false
  return { landed: land.merged, prNumber: land.prNumber, ticket: claim.number, reason: land.reason }
} finally {
  phase('Cleanup')
  // A throw here would replace whatever the try block returned or threw, so nothing escapes.
  try {
    if (claimOpen && claimedNumber) {
      await agent(
        `Issue #${claimedNumber}: the pipeline run stopped before landing it. Remove the in-progress
label, add ready-for-human, and comment that the run ended early so the claim is released.`,
        { phase: 'Cleanup' }
      )
    }
    const cleaned = await agent(
      `${BASH_NOTE}
Run: npx tsx lib/ticketPipeline/cleanup.ts ${shellArg(state)}
That prints a JSON array of shell commands. Run each one in order, tolerating "not found"-type
errors (idempotent teardown — a container or worktree that's already gone is not a failure).
One exception: before running a "git branch -D <branch>" command, run
"git log --oneline origin/main..<branch>". If that errors the branch was never created, so skip the
delete; if it lists any commits the branch holds work that was never pushed, so skip the delete and
say which branch you kept. Report the final "git status --short" output verbatim.`,
      { phase: 'Cleanup' }
    )
    log(`Cleanup finished: ${cleaned}`)
  } catch (error) {
    log(`Cleanup stage failed: ${(error && error.message) || error}`)
  }
}
