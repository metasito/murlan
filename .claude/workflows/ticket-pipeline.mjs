export const meta = {
  name: 'ticket-pipeline',
  description: 'Claim, gate, implement, verify, independently review, and land one murlan queue ticket end to end',
  phases: [
    { title: 'Claim', detail: 'claim the routed ticket and run the design-first gate', model: 'haiku' },
    { title: 'Implement', model: 'sonnet' },
    { title: 'Verify', detail: "ci.yml's sweep, locally", model: 'sonnet' },
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
  review: 'opus', // the only gate between a defect and an --admin merge with CI dead
  land: 'sonnet',
  cleanup: 'sonnet', // deletes branches and kills processes on a judgement call
}

// `args` names a ticket when the queue's own ordering is not the one wanted — a blocker that has
// to land before the item that needs it. Unset, the router picks as before.
const forcedTicket = typeof args === 'number' ? args : args?.ticket

const MAX_FIX_ROUNDS = 2
const REPO = 'metasito/murlan'
const E2E_PORT = 5199
const BOOT_PORT = 5050

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
    summary: { type: 'string' },
    filesTouched: { type: 'array', items: { type: 'string' } },
    prose: { type: 'boolean' },
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
    prose: { type: 'boolean' },
    skippedJobs: { type: 'string' },
    preExistingFailures: { type: 'array', items: { type: 'string' } },
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

// The ports travel with the state so cleanup.ts frees the same two this file binds. A copy of the
// numbers over there is the thing that would go stale; which command frees them is that module's
// call, since it runs under `npx tsx` on the machine that owns them.
const state = {
  worktreePath: null,
  dockerStarted: false,
  localBranch: null,
  merged: false,
  ports: [E2E_PORT, BOOT_PORT],
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

async function runVerify(claim, sinceRef) {
  // Teardown is owed from the moment the container can exist, not from the agent's report:
  // a verify agent that dies after `docker run` never reports, and the container leaks.
  state.dockerStarted = true
  // A fix round only needs to re-check what it itself touched: the rest of the branch already
  // passed the jobs it needed against a diff that hasn't changed since. `sinceRef` is the commit
  // the previous verify call already covered, so a re-verify diffs from there, not from
  // origin/main again.
  const diffRef = sinceRef ? `${sinceRef}..HEAD` : 'origin/main...HEAD'
  const roundNote = sinceRef
    ? `\n  This diff range is this round's fix only, not the whole PR — the rest of the branch\n  already passed the jobs it needed in an earlier round and hasn't changed since.\n`
    : ''
  return agent(
    `${BASH_NOTE}
${cwdNote(claim)}
GitHub Actions is not running at all right now, so this local sweep is the only thing standing
between a defect and main. Run ci.yml's jobs locally. Within a job, do not stop at the first red
step — in CI these are independent parallel jobs and one run is expected to report every failure.

STEP 0 — which jobs does this diff need? A module decides, not you:
  git fetch origin main -q
  git diff --name-only ${diffRef} > /tmp/verify-changed.txt
  An empty list is a failure, not a pass: this stage exists to sweep a diff, and no diff means
  you are looking at the wrong tree. Report pass: false with the range and HEAD you saw. Only a
  documentation-only diff (below) may pass without running a job — never an absent one.
  Print that list, then turn it into a JSON array of repo-relative paths and:
    npx tsx lib/ticketPipeline/verifyPlan.ts <<< '["path/one.ts","path/two.ts"]'
  It prints {"verify":..,"native":..,"browser":..,"build":..,"prose":..}. Run only the jobs it
  marks true — STEP 3's first three commands are the "verify" job, "native" gates STEP 3's
  test:native line, "browser" gates STEP 4, "build" gates STEP 5. Anything it marks false is
  skipped, and say so in your output. Its allowlist fails safe: an unrecognised path marks
  everything true.
${roundNote}
  If every changed path is under docs/, .claude/ or ends in .md, the change is documentation only
  and ci.yml skips even the verify job — report pass: true with output "documentation only" and
  stop here. (.github/workflows/ is NOT prose: a change there must exercise itself.)

STEP 0b — the baseline. If any check below fails, it is only this ticket's failure if it does not
already fail on origin/main. Before reporting a red check, re-run that one check against a clean
origin/main in a scratch worktree, which cannot disturb this branch:
    git worktree add /tmp/verify-baseline origin/main && cd /tmp/verify-baseline
    (run the single failing command there, with the same env)
    cd - && git worktree remove /tmp/verify-baseline --force
  If it fails there too, the failure is pre-existing: do NOT count it against this ticket. Report
  it in preExistingFailures, open an issue for it with gh (label needs-triage) if no open issue
  already names that check, and judge pass on the remaining checks alone. Fixing it is not this
  ticket's job, and letting it drive the fix loop burns a full round per attempt on a defect the
  diff did not cause.

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
  The build commands themselves run on whatever Node this machine has — esbuild's
  --target=node22 is a cross-compiler and does not need to run under 22 to lower syntax.

  npm run expo:web:build && npm run server:build
  npm run bundle:budget
  EXPO_PUBLIC_DOMAIN=example.invalid npm run expo:static:build

  Then boot the built server and check it reaches the database. This is ci.yml's "This job's
  Node is the one production runs" check, and it is the ONLY part that must run under
  production's Node: --target=node22 lowers syntax and knows nothing about APIs, so a
  Node-24-only runtime builtin compiles at exit 0 and only throws when the bundle is actually
  executed under 22. So execute it under 22, in a container, rather than on this machine's Node:

    replit=$(grep -oE 'nodejs-[0-9]+' .replit | head -1 | cut -d- -f2)
    test -f dist/index.html
    test -f server_dist/index.mjs
    docker rm -f murlan-verify-boot   (ignore "no such container")
    MSYS_NO_PATHCONV=1 docker run --rm -d --name murlan-verify-boot \\
      -p ${BOOT_PORT}:${BOOT_PORT} -e PORT=${BOOT_PORT} -e NODE_ENV=production \\
      -e DATABASE_URL="postgres://postgres:postgres@host.docker.internal:55433/murlan_test" \\
      -e SESSION_SECRET=verify-local \\
      -v "$PWD/server_dist:/app/server_dist:ro" -v "$PWD/dist:/app/dist:ro" \\
      -v "$PWD/assets:/app/assets:ro" -v "$PWD/static-build:/app/static-build:ro" \\
      -v "$PWD/node_modules:/app/node_modules:ro" \\
      -w /app "node:$replit-alpine" node server_dist/index.mjs

    Four things here are load-bearing, each one verified rather than assumed:
      MSYS_NO_PATHCONV=1 — without it Git Bash rewrites -w /app to C:/Program Files/Git/app and
        docker exits 125 before starting anything.
      host.docker.internal — the database is a separate container, so localhost inside this one
        is itself; the host's published 55433 is reached through that name.
      node_modules is mounted — server:build uses --packages=external, so the bundle imports its
        dependencies at runtime instead of containing them. Without this mount it cannot start.
      assets/ and static-build/ are mounted — server/app.ts serves both from process.cwd().
      Every mount source is under $PWD. Do not stage files in /tmp and mount those: /tmp is a
        Git Bash path, Docker Desktop resolves it inside the VM, and the mount silently comes up
        empty — which looks exactly like the server failing to start.
      The image tag comes from .replit, so if production's Node moves and nothing else changes,
        this check moves with it instead of silently testing the wrong runtime.

    Confirm the container really is on production's Node:
      docker exec murlan-verify-boot node -p "process.versions.node"
    Then poll "curl -fsS http://127.0.0.1:${BOOT_PORT}/health -o health.json" up to 30 times,
    1s apart, stopping as soon as it succeeds.
    Always "docker rm -f murlan-verify-boot" afterwards, including when the poll timed out, so
    port ${BOOT_PORT} is free for the next run.
    grep -q '"db":"connected"' health.json — if that does not match, the build boots but never
      reaches Postgres, which is a FAILURE.
    If docker run itself fails — image pull, mount, port — that is a real FAILURE of this check,
    not something to excuse. Docker is already a hard requirement of this pipeline.

Report:
  pass — true ONLY if every command that ran exited 0, the integration-suite grep did NOT match,
    and (when the build job ran) /health reported "db":"connected". A failure you confirmed is
    pre-existing on origin/main does not make this false. Anything else does.
  skippedJobs — the jobs verifyPlan marked false, and the paths that decision was made from.
  prose — verifyPlan's "prose" field, verbatim. Informational only: Implement or Fix already
    computed this over the whole diff for the review stage, before this call started.
  preExistingFailures — each check that failed here AND on origin/main, with the issue number you
    opened or found for it. Empty when there were none.
  failedStep — the first command that failed, prefixed with its job, e.g.
    "verify: npm run lint" or "build: npm run bundle:budget". Empty when pass is true.
  output — for each failing job, its name and at most the last 40 lines of its output: enough
    that another agent can fix it without running the sweep again, and no more. Name every job
    that failed, not just the first. Empty when pass is true — a passing sweep's log is read by
    nobody and costs every later stage that carries it.
  dockerStarted — whether you started the container.`,
    { model: MODELS.verify, phase: 'Verify', label: label('verify'), schema: VERIFY_SCHEMA }
  )
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

Commit your work (do not push yet).
${PROSE_CAPTURE_NOTE}
Report: committed, commitSha, summary, filesTouched, prose.`,
    { model: MODELS.implement, phase: 'Implement', label: label('implement'), schema: IMPLEMENT_SCHEMA }
  )
  if (!impl.committed) {
    releaseReason = `implementation didn't complete: ${impl.summary || 'no reason given'}`
    return { landed: false, ticket: claim.number, reason: 'implement failed' }
  }

  // Verify and Review both read the same committed branch and neither writes to it, so they run
  // concurrently rather than paying for each other's wall clock. A failing verify does not waste
  // the concurrent review: the fix agent below gets both together and fixes them in one round.
  let [verify, review] = await parallel([
    () => runVerify(claim),
    () => runReview(claim, null, null, impl.prose, null),
  ])
  // Only a commit whose sweep actually PASSED can narrow the next round's diff range. Advancing
  // this after a failed sweep lets the next round skip the job that was red: a fix touching only
  // docs would scope the re-verify to docs, skip the browser job, and report a pass over a
  // browser failure nothing had re-run.
  let verifiedSha = verify.pass ? impl.commitSha : null
  // Unlike verifiedSha, this advances whatever the lenses said: they have read that commit, so
  // re-reading it is what produced a fresh crop of prose objections every round.
  let reviewedSha = impl.commitSha
  let round = 0
  while (actionable(verify, review) && round < MAX_FIX_ROUNDS) {
    round++
    phase('Fix')
    const confirmed = confirmedIn(review)
    const lensesThatFound = [...new Set(confirmed.map((f) => f.lens).filter(Boolean))]
    const findingList = confirmed
      .map((f) => `- ${f.file}${f.line ? ':' + f.line : ''} — ${f.summary}`)
      .join('\n')
    const verifyNote = verify.pass
      ? ''
      : `\nThe local CI sweep is also failing — make it pass. First failing step: ${
          verify.failedStep || '(not reported)'
        }\nOutput:\n${verify.output || '(none reported)'}`
    const fix = await agent(
      `${cwdNote(claim)}
Fix exactly these findings and nothing else, then commit. A
failure the verify stage reported as pre-existing on origin/main is not yours to fix — leave it.
Findings:\n${
        findingList || '- (no review findings; the failing verification below is the whole job)'
      }${verifyNote}
${PROSE_CAPTURE_NOTE}
Report: committed, commitSha, summary, filesTouched, prose.`,
      { model: MODELS.fix, phase: 'Fix', label: label(`fix round ${round}`), schema: IMPLEMENT_SCHEMA }
    )
    if (!fix.committed) break
    ;[verify, review] = await parallel([
      () => runVerify(claim, verifiedSha),
      () => runReview(claim, confirmed.map((f) => f.summary).join('; '), lensesThatFound, fix.prose, reviewedSha),
    ])
    verifiedSha = verify.pass ? fix.commitSha || verifiedSha : null
    reviewedSha = fix.commitSha || reviewedSha
  }

  if (!isClean(verify, review)) {
    releaseReason = `${round} fix round(s) didn't reach a clean state. Remaining: ${JSON.stringify(
      confirmedIn(review)
    )}. Verify pass: ${verify.pass}. Review lenses that reported nothing: ${
      review.failedLenses.join(', ') || 'none'
    }.`
    return { landed: false, ticket: claim.number, reason: `not clean after ${round} fix round(s)` }
  }

  phase('Land')
  const land = await agent(
    `${BASH_NOTE}
${cwdNote(claim)}
Branch ${claim.branch} is clean (local verify passed, independent review clean). Push and open the
PR in one chained call — the body needs a file since it's multi-line and must end with
"Closes #${claim.number}" (never in the commit message):

  cat > /tmp/pipeline-pr-body.md <<'EOF'
<a short PR body summarizing what shipped>

Closes #${claim.number}
EOF
  git push -u origin ${claim.branch} && \\
  gh pr create --repo ${REPO} --title "<a short title>" --body-file /tmp/pipeline-pr-body.md

CI is billing-blocked today — that is the one genuinely conditional step here, so judge it on its
own rather than folding it into the chain above: check the run once; if the scope job dies with no
steps (the known billing failure, confirm via
gh api repos/${REPO}/check-runs/<id>/annotations), don't wait on it further; otherwise take its
real result. Once you've decided the PR is mergeable, with <N> the PR number gh pr create printed,
chain the rest into one call:

  gh pr merge --merge --admin --delete-branch <N> && \\
  gh issue close ${claim.number} --repo ${REPO} --comment "<one line summarizing what shipped>"

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

That teardown list frees ports ${E2E_PORT} and ${BOOT_PORT}, removes both pipeline containers, and
(when this run did not merge) deletes the local branch only if it holds no commits origin/main
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
