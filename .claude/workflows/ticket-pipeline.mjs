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
const REPO = 'metasito/murlan'
const E2E_PORT = 5199
const BOOT_PORT = 5050

const BASH_NOTE = [
  'Use the Bash tool (POSIX sh), not PowerShell.',
  'Never pass JSON as a command-line argument: the shell layer collapses the doubled backslash',
  'JSON uses for a literal backslash, which corrupts the payload. Each module below reads stdin.',
].join(' ')

function sq(text) {
  return `'${String(text).replace(/'/g, "'\\''")}'`
}

// Every RULES pattern in verifyPlan.ts is forward-slash anchored, so a Windows-style path an
// agent reports would match no rule and silently skip its suite.
function normalizePaths(files) {
  return (files || []).map((f) => String(f).replace(/\\/g, '/'))
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
    failedStep: { type: 'string' },
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

async function runVerify() {
  // Teardown is owed from the moment the container can exist, not from the agent's report:
  // a verify agent that dies after `docker run` never reports, and the container leaks.
  state.dockerStarted = true
  return agent(
    `${BASH_NOTE}
GitHub Actions is not running at all right now, so this local sweep is the only thing standing
between a defect and main. Run ci.yml's jobs locally. Do not scope the app checks down by which
files changed, and do not skip a job because an earlier one failed — in CI these are independent
parallel jobs, and one run is expected to report every failure.

STEP 0 — ci.yml's "scope" job: is this change prose only?
  changed=$(git diff --name-only origin/main...HEAD)
  Print that list. Then apply ci.yml's own allowlist, which is deliberately an allowlist so an
  unrecognised path fails safe towards running everything:
    grep -qvE '^(docs/|\\.claude/)|\\.md$' <<< "$changed"
  If that finds NO file outside docs/, .claude/ or *.md, the change is documentation only.
  ci.yml skips every app check in that case, so skip STEPS 2-5 too and report pass: true with
  output "documentation only — app checks skipped, matching ci.yml's scope job". Otherwise
  continue. (.github/workflows/ is NOT prose: a change there must exercise itself.)

STEP 1 — dependencies, only if this change moved them.
  If package.json or package-lock.json is in the changed list, run "npm ci" once. Otherwise
  skip it: ci.yml runs npm ci per job because each job is a fresh runner, but this is one
  working tree and node_modules is already installed.

STEP 2 — one throwaway Postgres, started once and reused by everything below.
  docker run -d --name murlan-verify-pg -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_DB=murlan_test -p 55433:5432 postgres:16-alpine
  If a container with that name already exists, reuse it instead of starting a second one.
  Wait until "docker exec murlan-verify-pg pg_isready -U postgres" succeeds, then export for
  STEP 3 and STEP 5:
    DATABASE_URL=postgres://postgres:postgres@localhost:55433/murlan_test
    SESSION_SECRET=verify-local
  STEP 4 does NOT use this container: scripts/e2e-server.mjs overwrites DATABASE_URL and
  SESSION_SECRET and brings up its own disposable Postgres (murlan-dev-pg, port 55432).

STEP 3 — ci.yml's "verify" job. Run all four; ci.yml marks the last two if:!cancelled() so that
one run reports every failure, so do not stop at the first red one.
  npm run typecheck
  set -o pipefail; npm test | tee test-output.txt
  npm run test:native -- --maxWorkers=2
  npm run lint
  The --maxWorkers=2 is not optional and is not a way of hiding a slow test: jest defaults to
  one worker per core, and on a many-core developer machine that saturation pushes ordinary
  suites past their 5s per-test timeout, so a clean tree reports 13 failures that all pass when
  rerun alone. Two workers matches ci.yml's runner, goes green, and is FASTER in wall clock.
  If a suite still fails, rerun that one file alone before believing it — but a suite that
  fails alone is a real failure, never a flake.

  Then the floor ci.yml puts under "npm test" — a skipped integration suite still exits 0:
    grep -q "DATABASE_URL not set" test-output.txt
  If that MATCHES, the integration suites silently skipped because Postgres was unreachable.
  Treat it as a FAILURE (failedStep "verify: integration suites skipped"), never as a pass.

STEP 4 — ci.yml's "browser" job.
  npx playwright install chromium   — only if chromium is not already installed; check first,
  the download is slow and is needed once per machine, not once per run.
  npm run test:e2e

STEP 5 — ci.yml's "build" job, in this exact order. Each step consumes the previous one's
output, so here you DO stop at the first failure.
  This job runs AFTER the browser job and that order is load-bearing, not incidental: the e2e
  harness exports its own web bundle with EXPO_PUBLIC_E2E_FAST=1 (a zero-delay build) into
  dist/. Building here afterwards is what leaves dist/ holding the real production bundle for
  the budget check and the boot check below. Do not reorder these two, and do not try to save
  the duplicated export with E2E_SKIP_BUILD=1 — the two bundles are different artefacts, and
  scripts/assertNotE2EFast.js exists to stop the production one being built in fast mode.
  First, ci.yml's "This job's Node is the one production runs" check. That job pins Node 22
  because esbuild's --target=node22 lowers syntax and knows nothing about APIs, so a
  Node-24-only builtin compiles at exit 0 and throws on Replit:
    replit=$(grep -oE 'nodejs-[0-9]+' .replit | head -1 | cut -d- -f2)
    actual=$(node -p 'process.versions.node.split(".")[0]')
  If those differ and no Node "$replit" is available on this machine, DO run the rest of this
  step, but start your reported output with the line
    "PRODUCTION-RUNTIME CHECK NOT EXERCISED: built and booted on Node $actual, Replit deploys
    on Node $replit"
  and include it even when pass is true. Do not fail the ticket for it — it is this machine's
  limitation, not a defect in the diff — but never let a run imply that check happened.
  If a Node "$replit" is available (nvm/fnm/volta), use it for the rest of STEP 5 instead.

  npm run expo:web:build && npm run server:build
  npm run bundle:budget
  EXPO_PUBLIC_DOMAIN=example.invalid npm run expo:static:build
    On Windows this step cannot run: scripts/build.js spawns "npm" without shell:true, so it
    dies with "Error: spawn npm ENOENT" before building anything. That is this machine, not the
    diff. If and ONLY if the failure is that exact ENOENT-spawning-npm signature, treat the step
    as not exercised rather than failed, and say so in output. Any other failure from this step
    is a real failure. (See the report for the one-line fix that would close this.)
  Then boot the built server and check it reaches the database:
    test -f dist/index.html
    test -f server_dist/index.mjs
    PORT=${BOOT_PORT} NODE_ENV=production node server_dist/index.mjs &   (keep its PID)
    poll "curl -fsS http://127.0.0.1:${BOOT_PORT}/health -o health.json" up to 30 times, 1s
      apart, stopping as soon as it succeeds
    kill that PID — always, including when the poll timed out, so port ${BOOT_PORT} is free for
      the next run
    grep -q '"db":"connected"' health.json — if that does not match, the build boots but never
      reaches Postgres, which is a FAILURE.

Report:
  pass — true ONLY if every command above exited 0, the integration-suite grep did NOT match,
    and /health reported "db":"connected". Anything else is false.
  failedStep — the first command that failed, prefixed with its job, e.g.
    "verify: npm run lint" or "build: npm run bundle:budget". Empty when pass is true.
  output — the tail of every failing command's output, enough that another agent can fix it
    without running the sweep again. Name every job that failed, not just the first.
  dockerStarted — whether you started the container.`,
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
issue #${claim.number}, which you should read yourself with: gh issue view ${claim.number} --repo ${REPO}
Using mattpocock-skills:code-review's spec axis: missing requirements, scope creep, anything
implemented but wrong. Report findings: file, line, summary, verdict (CONFIRMED/PLAUSIBLE/REJECTED).`,
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
(git diff origin/main...HEAD), checked against CLAUDE.md's comment policy: a comment only earns its
place by naming an invisible constraint, a non-obvious why, a contract types can't carry, or a
pointer to authority. Flag as CONFIRMED anything that narrates history, restates the code below it,
or explains an already-fixed defect. Report: file, line, summary, verdict.`,
    },
  ]
  const results = await parallel(
    lenses.map((l) => () => agent(l.prompt, { phase: 'Review', label: `review:${l.key}`, schema: FINDING_SCHEMA }))
  )
  const failedLenses = lenses.filter((l, i) => !results[i]).map((l) => l.key)
  if (failedLenses.length) {
    log(`Review lenses reported nothing: ${failedLenses.join(', ')} — counted as unreviewed, not as clean.`)
  }
  return { findings: results.filter(Boolean).flatMap((r) => r.findings || []), failedLenses }
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
older claim is already there). Report: claimed, number, branch, title, filesTouched (best-effort
list from the issue's Ground truth pointers), reason. Do not report the issue body — every later
stage reads it from GitHub itself.`,
    { phase: 'Claim', schema: CLAIM_SCHEMA }
  )
  if (!claim.claimed) {
    log(`Nothing claimed: ${claim.reason}`)
    return { landed: false, reason: claim.reason }
  }
  claimOpen = true
  claimedNumber = claim.number
  state.localBranch = claim.branch

  const gateFiles = normalizePaths(claim.filesTouched)
  const gate = await agent(
    `${BASH_NOTE}
Build the gate input straight from the issue, so its body never passes through a shell argument:

gh issue view ${claim.number} --repo ${REPO} --json body --jq ${sq(
      `{filesTouched:${JSON.stringify(gateFiles)},body:.body}`
    )} > /tmp/ticket-pipeline-gate.json
npx tsx lib/ticketPipeline/gate.ts < /tmp/ticket-pipeline-gate.json

Report its JSON stdout verbatim as escalate and reason. If either command fails, or stdout is not
the JSON object the module prints, report escalate: true with the failure as the reason — this is
the pipeline's only escalation valve, so a gate that could not run must never answer "no
escalation needed".`,
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
seams, typecheck and single test files while iterating. Read the issue yourself with:
gh issue view ${claim.number} --repo ${REPO}
Commit your work (do not push yet). Report: committed, commitSha, summary, filesTouched.`,
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
  let verify = await runVerify()

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
      : `\nThe local CI sweep is also failing — make it pass. First failing step: ${
          verify.failedStep || '(not reported)'
        }\nOutput:\n${verify.output || '(none reported)'}`
    const fix = await agent(
      `On branch ${claim.branch}, fix exactly these findings and nothing else, then commit:\n${
        findingList || '- (no review findings; the failing verification below is the whole job)'
      }${verifyNote}`,
      { phase: 'Fix', schema: IMPLEMENT_SCHEMA }
    )
    if (!fix.committed) break
    verify = await runVerify()
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
known billing failure, confirm via gh api repos/${REPO}/check-runs/<id>/annotations), don't
wait on it further. Merge with gh pr merge --merge --admin --delete-branch, then close #${claim.number}
with a comment summarizing what shipped. Report: merged, prNumber, reason.`,
    { phase: 'Land', schema: LAND_SCHEMA }
  )
  state.merged = land.merged
  if (land.merged) claimOpen = false
  return { landed: land.merged, prNumber: land.prNumber, ticket: claim.number, reason: land.reason }
} finally {
  // A throw in here would replace whatever the try block returned or threw, so nothing escapes.
  try {
    phase('Cleanup')
    if (claimOpen && claimedNumber) {
      await agent(
        `Issue #${claimedNumber}: the pipeline run stopped before landing it. Remove the in-progress
label, add ready-for-human, and comment that the run ended early so the claim is released.`,
        { phase: 'Cleanup' }
      )
    }
    const cleaned = await agent(
      `${BASH_NOTE}
This run's branch is ${state.localBranch || '(none)'} and merged=${state.merged}.

1. Put the checkout back on main first, so no branch is pinned by being the current one:
   git checkout main || git checkout -B main origin/main
2. Free the local verification ports if anything is still bound to them, tolerating no match.
   ${E2E_PORT} is Playwright's webServer, ${BOOT_PORT} is the built server the sweep boots:
   netstat -ano | findstr :${E2E_PORT}   then, for any PID listed: taskkill /PID <pid> /F
   netstat -ano | findstr :${BOOT_PORT}  then, for any PID listed: taskkill /PID <pid> /F
   Also tear down the container the e2e harness brings up for itself, which the teardown list
   below does not know about, using the project's own command: node scripts/dev-stack.mjs down
   (safe because scripts/e2e-server.mjs recreates it from scratch on every run, so nothing
   durable lives there — but skip it if the user is known to be mid dev-session on it.)
3. Build the teardown list and run it:

${writeJsonCommand('/tmp/ticket-pipeline-cleanup.json', state)}
npx tsx lib/ticketPipeline/cleanup.ts < /tmp/ticket-pipeline-cleanup.json

   That prints a JSON array of shell commands. Run each one in order, tolerating "not found"-type
   errors (idempotent teardown — a container or worktree that's already gone is not a failure).
   One exception: before running a "git branch -D <branch>" command, run
   "git log --oneline origin/main..<branch>". If that errors the branch was never created, so skip
   the delete; if it lists any commits the branch holds work that was never pushed, so skip the
   delete and say which branch you kept.
4. If merged=true and the local branch still exists, delete it now with "git branch -D <branch>".
   The module deliberately omits that command, and "gh pr merge --delete-branch" only removes the
   remote copy, so without this the local branch survives every merged run.
5. Report the final "git status --short" output and the current branch verbatim.`,
      { phase: 'Cleanup' }
    )
    log(`Cleanup finished: ${typeof cleaned === 'string' ? cleaned : JSON.stringify(cleaned)}`)
  } catch (error) {
    log(`Cleanup stage failed: ${(error && error.message) || error}`)
  }
}
