export const meta = {
  name: 'murlan-full-audit',
  description: 'Specialist lenses audit Murlan read-only; findings merged, adversarially verified, gaps re-swept, synthesized',
  phases: [
    { title: 'Map', detail: 'cartographer builds the shared system map' },
    { title: 'Audit', detail: 'one agent per lens, in parallel' },
    { title: 'Merge', detail: 'cross-lens dedup' },
    { title: 'Verify', detail: 'skeptics per finding, judges per proposal, fact-check of the infra research' },
    { title: 'Gaps', detail: 'completeness critic until a round finds nothing new' },
    { title: 'Synthesize', detail: 'scored report and ticket batches' },
  ],
}

const { repo: REPO, sha, openIssues, webUrl } = args
const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical']
const SIZES = ['XS', 'S', 'M', 'L', 'XL']
const MAX_GAP_ROUNDS = 3

const LENSES = [
  {
    key: 'security', model: 'opus', skills: ['security-review', 'best-practices'],
    start: 'server/ (authTokens, ticket, session, socketSafety, validate, schemas, cors, admin, adminPage, bugReports, clientErrors, codes, routes, mail, deleteAccount), shared/socketSchemas.ts, lib/wire.ts, app/(online), app/+native-intent.tsx, app.json, .github/workflows',
    refs: 'OWASP ASVS 5.0 (V6 auth, V7 session, V8 authz, V13 config, V16 logging); OWASP Top 10:2025 (A01 access control, A02 misconfiguration, A10 exceptional conditions); OWASP MASVS for token storage on device; expressjs.com security best practices; socket.io docs on auth and middleware.',
    ask: `Threat-model first: a hostile client holds a valid session and a seat at the table.
- Handshake: only a ticket or a live session is accepted.
- Every socket and HTTP handler validates payload shape, membership, seat and turn on the server.
- Sanitized state never leaks another player's hand, the deck, or exchange cards.
- Sessions: cookie flags, SESSION_SECRET, fixation. CSRF on cookie-authenticated mutations. CORS, helmet/CSP, x-powered-by.
- Rate limits on auth, recovery, verify-email, invites and bug reports.
- Password hashing: its cost, and whether it blocks the event loop.
- Recovery and verification tokens: entropy, expiry, single use.
- Admin authorization. XSS and log injection through bug reports and client errors shown on the admin page.
- Room-code enumeration. Raw sql\`\` injection. Payload size limits. Stack traces in responses.
- Secrets in EXPO_PUBLIC_* or in committed files. Deep-link intent handling.
- Actions: token permissions, pull_request_target.`,
  },
  {
    key: 'network', model: 'opus', skills: ['react-native-best-practices'],
    start: 'lib/socket.ts, lib/sendIntent.ts, context/SocketContext.tsx, context/OnlineGameContext.tsx, server/socket/*.ts, server/game/game{Room,Turn,Timers,Ownership}.ts, server/socket/emit.ts, server/socket/events.ts, server/game/tableRouter.ts, server/store/roomStore.ts, server/http/shutdown.ts, server/store/drainPool.ts, docs/DISCONNECT-POLICY.md, docs/adr/0003-*',
    refs: 'socket.io/docs/v4: delivery-guarantees (at-most-once by default), connection-state-recovery (maxDisconnectionDuration), using-multiple-nodes, adapter; Nielsen heuristic 1 (visibility of system status) for reconnect states.',
    ask: `Build a table of every client<->server event: name, direction, acked?, idempotent?, and what happens if it is lost, duplicated or reordered.
- Listeners are registered before any await.
- Reconnect converges to server truth (full resync or recovered events).
- Intents are idempotent across retries. Ack timeouts. Backoff with jitter.
- Flapping networks. iOS background and foreground.
- Turn timers survive an instance handoff. Ownership races. The postgres adapter is really wired in.
- Graceful shutdown mid-manche. Room and presence cleanup. One socket per user. The session-replaced path. OfflineBanner semantics.
- Every line of DISCONNECT-POLICY.md has code, and all such code has a policy line.`,
  },
  {
    key: 'game-logic', model: 'opus', skills: [],
    start: 'lib/game/gameEngine.ts, docs/GAME-RULES.md, docs/GAME-RULES.md § Decisions, lib/game/autoMove.ts, server/game/botSeat.ts, server/game/dealManche.ts, lib/exchangeCeremony.ts, lib/game/placement.ts, lib/game/standings.ts, lib/game/rating.ts, server/game/ratings.ts, lib/game/replay.ts, lib/game/matchState.ts, lib/offlineSave.ts, lib/game/sharedGameFlow.ts, server/game/gameOver.ts',
    refs: 'docs/GAME-RULES.md is the specification; docs/GAME-RULES.md § Decisions records every rule change.',
    ask: `Build a matrix: rule in docs/GAME-RULES.md -> engine code -> pinning test. Report every row with a gap on any side.
Edge cases to cover:
- the last card; passes wrapping round the table; bombs; ties;
- the end of a partita; a vacated seat; a bot taking over mid-turn;
- the exchange with a disconnected player; replay determinism.
Invariants to confirm:
- the server decides every outcome;
- a card appears exactly once;
- the winner is stated as player_N;
- offline and online share one flow;
- the rating maths is right;
- the bot never reads hidden state.`,
  },
  {
    key: 'data', model: 'sonnet', skills: [],
    start: 'shared/schema.ts, server/store/schemaDdl.ts, server/store/db.ts, drizzle.config.ts, server/store/*Store.ts, server/store/friendRows.ts, server/game/retention.ts, server/game/replays.ts, server/game/stats.ts, server/http/deleteAccount.ts, scripts/backup-db.mjs, docs/PRIVACY.md, docs/DEPLOY-RUNBOOK.md',
    refs: 'node-postgres pooling (max, idleTimeoutMillis, connectionTimeoutMillis, one shared pool); GDPR data minimisation, export and erasure (Usercentrics mobile-games checklist).',
    ask: `- Every query has an index for its WHERE and ORDER BY.
- Multi-row writes run in a transaction. Races on unique constraints.
- Pool sizing against max_connections: no host is chosen yet (ADR-0006, #1105), so state the connections one instance opens and which Postgres tiers the \`infra\` lens compares would fit it.
- Unbounded tables have retention.
- DDL is additive and idempotent (DEDUPE_ON_BOOT).
- The session table is handled correctly.
- Account deletion reaches every table.
- PRIVACY.md matches what is actually stored and logged (PII, emails, IPs).
- Backup and restore work.`,
  },
  {
    key: 'stability', model: 'opus', skills: ['react-native-best-practices'],
    start: 'components/ErrorBoundary.tsx, components/ErrorFallback.tsx, lib/errorReporting.ts, server/http/logger.ts, server/index.ts, server/app.ts, server/http/shutdown.ts, context/, .github/workflows/soak.yml, tests/soak/',
    refs: 'OWASP Top 10:2025 A10 (mishandling of exceptional conditions); structured logs carrying a correlation id across HTTP and socket, with tokens and cookies redacted.',
    ask: `- Unhandled rejections and exceptions, on client and server.
- The error boundary covers every route.
- Effects clean up their timers, listeners, sockets and animations.
- Server per-room timers and maps that only grow (soak memory).
- Null game-state paths. Worklet crashes.
- Builtins newer than Node 22 in server code.
- Health and readiness endpoints. Crash loops on boot.
- When production breaks, what reaches the owner, and how fast?`,
  },
  {
    key: 'perf-client', model: 'opus', skills: ['react-native-best-practices', 'performance', 'core-web-vitals'],
    start: 'components/GameTable.tsx, components/table/, components/CardView.tsx, context/, lib/device/sounds.ts, lib/device/music.ts, lib/device/fonts*.ts, metro.config.js, babel.config.js, docs/WEB-PERF.md, docs/BUNDLE.md, scripts/bundle-budget.mjs',
    refs: 'Reanimated performance and worklets guides (no large captures, no functions in shared values); react.dev React Compiler; web.dev Core Web Vitals (LCP < 2.5 s, INP < 200 ms, CLS < 0.1).',
    ask: `- Re-render storms: context value identity, prop churn during card flights.
- React Compiler bailouts.
- Animation work on the JS thread.
- Layout maths recomputed every frame.
- Asset, font and audio loading, and startup time.
- Bundle size against its budget. Web vitals.
- Frame budget on a low-end Android. Memory held by audio instances.
Quote measured numbers from the docs, and name what is still unmeasured.`,
  },
  {
    key: 'perf-server', model: 'sonnet', skills: [],
    start: 'server/socket/socketGameplay.ts, server/socket/socketTable.ts, server/game/tableActions.ts, server/game/tableHandlers.ts, server/game/gamePersistence.ts, server/socket/emit.ts, lib/wire.ts, server/app.ts, server/http/staticPaths.ts, tests/soak/',
    refs: 'socket.io/docs/v4 adapter and performance-tuning pages.',
    ask: `- DB writes per move.
- Broadcast fan-out and state payload size.
- N+1 queries.
- Event-loop blocking: sync crypto, large JSON.
- Compression and cache headers on the static web.
- Timers per room. Adapter overhead.
Estimate how many concurrent tables one server instance can carry per unit of CPU and memory — no host is chosen yet (ADR-0006, #1105) — and state what that estimate rests on.`,
  },
  {
    key: 'ui-visual', model: 'opus', skills: ['expo-design-system', 'game-ui-design', 'frontend-design:frontend-design'],
    start: 'lib/theme.ts, lib/tokens.ts, components/, components/table/, app/, docs/FEEL-BAR.md, tests/e2e/57-polish-audit/captures/, tests/ui-rules/tokenRoles.test.ts, docs/agents/checks.md (renderer table)',
    refs: 'docs/FEEL-BAR.md; top mobile card and casino games as the ceiling.',
    ask: `Judge against FEEL-BAR, not against "fine".
- Tokens used in their named role. Layer zIndex.
- Shared components reused rather than copied or shadowed by name.
- Visual hierarchy. Menu consistency (MenuLayout, with app/profile.tsx as the reference).
- Portrait and landscape. Safe areas and the notch.
- Contrast. The type scale. Card legibility at the smallest scale.
- Ionicons names passed as literals.
- Divergence between web and native renderers.
Any claim about native pixels is inferred.`,
  },
  {
    key: 'ux-flows', model: 'opus', skills: ['game-ui-design'],
    start: 'app/ (index, auth, lobby, (online), game, result, tutorial, rules, profile, recover, verify-email), components/StateBlock.tsx, components/NotificationBanner.tsx, context/NotificationContext.tsx, docs/BETA-PLAYTEST.md',
    refs: 'Nielsen Norman 10 usability heuristics (weight: visibility of status, error prevention and recovery).',
    ask: `Walk each journey as a new player and as a returning one:
- install -> first game;
- invite a friend -> play;
- lose the connection -> recover;
- finish -> rematch;
- forgotten password.
For each journey, count taps and dead ends, and check the empty, loading and error states.
Also check:
- onboarding and tutorial clarity;
- whether it is clear whose turn it is and which plays are legal;
- confirmations and undo;
- retention loops;
- how bot difficulty is chosen.
List what BETA-PLAYTEST found that is still unaddressed.`,
  },
  {
    key: 'polish', kind: 'opportunities', model: 'opus', skills: ['game-feel', 'game-ui-design', 'react-native-best-practices'],
    start: 'docs/FEEL-BAR.md, components/useTableFeedback.ts, components/flightPhysics.ts, components/table/, components/ReactionLayer.tsx, components/GameOverOverlay.tsx, lib/device/sounds.ts, lib/device/music.ts, lib/device/haptics.ts, lib/theme.ts (Motion), assets/sounds/, assets/music/, app/index.tsx',
    refs: 'game-feel skill (hit-stop, easing, squash and stretch, layered feedback); FEEL-BAR references per moment.',
    ask: `You propose improvements; you do not hunt defects.
Cover every FEEL-BAR moment (Deal, Card landing, Bomb, Pass, Turn hand-off, Win, Loss, Reconnect, Idle table), plus menus, lobby, results and transitions.
For each one:
- what happens today, with path:line;
- what would make it land like a top-tier card or casino game: easing, anticipation, stagger, sound layering and variation, haptics, particles and light, music cues, microcopy.
Every proposal must respect Motion tokens, motionMs() under reduced motion, impactDelayMs() timing and the a11y invariants, and must name the assets it needs.
Return every concrete, buildable proposal that clears FEEL-BAR, ranked by impact per size.`,
  },
  {
    key: 'a11y', model: 'sonnet', skills: ['accessibility'],
    start: 'lib/a11y.tsx, lib/accessibility.ts, components/tableA11y.ts, components/AppModal.tsx, components/IconButton.tsx, tests/ui-rules/a11y*.test.ts, tests/ui-rules/touchTargets.test.ts, tests/e2e/a11yOverlays.spec.ts, tests/e2e/ariaTwins.spec.ts',
    refs: 'WCAG 2.2 AA (new: focus not obscured, dragging alternative, target size minimum, consistent help); reactnative.dev/docs/accessibility; gameaccessibilityguidelines.com (colour-safe suits, text size, timing).',
    ask: `The key question: can a screen-reader user play a whole manche?
Check:
- one accessible node per labelled control;
- a11yGroup containers;
- live regions;
- focus management in modals;
- touch target sizes;
- reduced motion routed through motionMs;
- colour-only suit signals;
- font scaling;
- keyboard play on web;
- turn-timer pressure.`,
  },
  {
    key: 'i18n', model: 'sonnet', skills: [],
    start: 'locales/, lib/i18n.ts, lib/relativeTime.ts, lib/cardNames.ts, server/http/mail.ts, lib/apiError.ts, tests/ui-rules/i18n.test.ts',
    refs: 'Key parity is already a compile error; the gaps are plurals, interpolation, overflow and server-originated text.',
    ask: `- Strings that bypass t(), including accessibility labels, emails, errors and push notifications.
- it or sq values identical to en.
- Plurals and interpolation.
- Albanian terminology against the research doc.
- The longest locale at the smallest layout.
- Date and number formatting.
- Locale detection and switching.`,
  },
  {
    key: 'architecture', model: 'opus', skills: ['mattpocock-skills:codebase-design', 'ponytail:ponytail-audit'],
    start: 'CONTEXT.md, docs/ARCHITECTURE.md, docs/adr/, shared/, server/, lib/, context/, components/, tools/loop/, scripts/',
    refs: 'Ousterhout deep modules (interface size vs depth); ISO/IEC 25010 maintainability (modularity, reusability, analysability).',
    ask: `Classify modules as deep or shallow. Then check:
- the seams among the server/socket/ and server/game/ files;
- what each client context is responsible for;
- shared/ as the single client-server contract;
- logic duplicated between offline and online, or between client and server;
- duplicated shared components;
- dead files and unused exports;
- god files, circular imports;
- sprawl in tools/loop and scripts;
- whether ARCHITECTURE.md matches the code.
Propose the simpler shape for each finding.`,
  },
  {
    key: 'code-quality', model: 'sonnet', skills: [],
    start: 'tsconfig*.json, eslint.config.js, eslint.selectors.cjs, then app/ components/ context/ lib/ server/ shared/',
    refs: 'CLAUDE.md "Comments" and "Design system" sections; CONTEXT.md glossary.',
    ask: `Run \`npx tsc --noEmit\` and \`node scripts/checkStrictIndexed.mjs\`, and report the output.
Grep for \`as any\`, \`as unknown as\`, non-null \`!\`, \`@ts-\` and \`eslint-disable\`, and judge each hit.
Also check:
- floating promises;
- error typing;
- naming against the glossary;
- bare colour literals;
- comments that restate code or narrate history;
- two patterns used for the same job.`,
  },
  {
    key: 'tests-ci', model: 'opus', skills: [],
    start: 'tests/, tools/loop/tests/, jest.config.js, tests/e2e/playwright.config.ts, .github/workflows/, docs/agents/checks.md, tools/loop/check-steps.mjs',
    refs: 'docs/agents/checks.md ("What a green loop does not mean", "A scan needs a planted floor", "The native harness is async").',
    ask: `Check:
- critical mechanisms with no test: socket auth, reconnect, engine rules, deletion;
- tests that assert the outcome rather than the mechanism;
- scans with no planted floor;
- fireEvent calls without await;
- DEADLINE_SCALE applied to a lower bound;
- source scans a decoy can satisfy;
- workflows that never run;
- self-defeating safeguards;
- where CI spends its time.
Run at most one node --test file.`,
  },
  {
    key: 'docs', model: 'sonnet', skills: ['mattpocock-skills:writing-for-agents'],
    start: 'CLAUDE.md, README.md, CONTEXT.md, docs/*.md, docs/agents/, docs/adr/, .claude/commands/',
    refs: 'Murlan is not live: a doc implying real accounts or player data to preserve is stale.',
    ask: `Check each factual claim against the code. List the stale, contradicted and unverifiable ones.
Also check:
- rules restated outside docs/agents/RULES.md;
- sediment;
- load-bearing decisions with no ADR;
- drift in the ADR index;
- docs that nothing points at;
- setup steps a stranger could not follow.`,
  },
  {
    key: 'supply-chain', model: 'sonnet', skills: ['eas-app-stores'],
    start: 'package.json, package-lock.json, skills-lock.json, app.json, eas.json, .github/workflows/',
    refs: 'OWASP Top 10:2025 A03 (software supply chain); npm ci + audit in CI; Actions pinned by SHA with least-privilege permissions.',
    ask: `Run \`npm audit --omit=dev\` and \`npx expo install --check\`, and report the output.
Then check:
- outdated or abandoned dependencies, and duplicate versions;
- whether patch-package's postinstall step (package.json) still has anything to apply — no patches/ directory exists today;
- APIs the code uses against server:build --target=node22;
- app.json permissions and store readiness;
- Actions pinning and permissions;
- licences.`,
  },
  {
    key: 'infra', kind: 'research', model: 'opus', skills: ['eas-app-stores'],
    start: 'deploy/runtime.json, docs/adr/0001-*, docs/adr/0003-*, docs/DEPLOY-RUNBOOK.md, docs/adr/0006-*, server/index.ts, server/socket/socketAdapter.ts, package.json scripts, eas.json, app.json',
    refs: 'Use WebSearch and WebFetch. Official pricing pages only; record the URL and the date read for every price.',
    ask: `The Replit subscription has ended (ADR-0006); the next host is undecided (#1105). Research where the app should live next.
Requirements: free at the start, reasonable cost as it grows, mature and boring. \`deploy/runtime.json\` is the contract any host must meet — read it first, then confirm the host also runs:
- Socket.IO WebSockets on more than one instance (ADR-0003);
- the socket.io postgres adapter and connect-pg-simple sessions;
- static web hosting;
- secrets, logs and deploys from GitHub.
Compare at least: Fly.io, Render, Railway, Koyeb, Google Cloud Run, Northflank, Oracle Cloud Always Free, and a Hetzner-class VPS with Coolify or Dokku.
For Postgres, compare at least: Neon, Supabase, Aiven, and each host's own offering.
For each option record:
- what the free tier really includes: sleep or cold starts, WebSocket limits, hours, egress;
- the monthly cost at 100, 1k and 10k DAU, stating your assumptions;
- the multi-instance story; lock-in; maturity; the migration steps from this repo.
List every place the code or CI assumes Replit, with path:line.
Then assess the EAS build path the owner tests on (a build of the app, never a host client):
- the EAS free-tier limits;
- what it costs in workflow;
- how a build reaches the owner's iPhone.
Finish with one recommended stack and a phased migration.`,
  },
]
const LENS_KEYS = LENSES.map(l => l.key)
const kindOf = lens => lens.kind || 'findings'

const COMMON = `You are one specialist in a READ-ONLY audit of Murlan (${REPO}) at commit ${sha}.
- Change nothing: no edits, commits, branch or worktree changes, and spawn no subagents.
- Read files whole with Read; search with Grep. If the checkout has moved, read with \`git -C ${REPO} show ${sha}:<path>\`.
- Allowed commands: npx tsc --noEmit, npx eslint <paths>, npm audit --omit=dev, npx expo install --check, one node --test <file>, git log/blame, gh issue view.
  Nothing wider: rule 2 holds here too, and another session may be sharing this machine.
- Load every skill named for your lens with the Skill tool first, and apply its checklist.
- Every finding cites path:line with the quoted line and is marked measured (you ran it or traced the full path) or inferred.
  Native rendering claims reasoned from source or Chromium are inferred.
- Before calling a choice a defect, check docs/adr, docs/GAME-RULES.md § Decisions and the test that pins it.
  If you still disagree with a recorded decision, report it as info and name the decision.
- Name the defect class, the smallest root-cause fix, and the check that would catch the next instance while failing on a planted one.
- Skip what tsc and eslint already enforce.
- A start path that no longer exists goes in coverage.not_reached.
- Set "tracked" when an open issue already covers the finding: ${JSON.stringify(openIssues)}
${webUrl
  ? `- A live web build is at ${webUrl}; inspect it with the claude-in-chrome tools, and never trigger a dialog.`
  : '- No live build is available: use source, tests/e2e/57-polish-audit/captures/ and test-results/.'}`

const LOCATION = {
  type: 'object',
  properties: { path: { type: 'string' }, line: { type: 'integer' } },
  required: ['path', 'line'],
}
const COVERAGE = {
  type: 'object',
  properties: {
    read: { type: 'array', items: { type: 'string' } },
    not_reached: { type: 'array', items: { type: 'string' } },
    skills_used: { type: 'array', items: { type: 'string' } },
  },
  required: ['read', 'not_reached', 'skills_used'],
}
const FINDING = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    lens: { type: 'string' },
    severity: { enum: SEVERITIES },
    confidence: { enum: ['measured', 'inferred'] },
    platform: { enum: ['all', 'web', 'ios', 'android', 'server', 'tooling'] },
    locations: { type: 'array', items: LOCATION, minItems: 1 },
    evidence: { type: 'string' },
    failure_scenario: { type: 'string', description: 'concrete state or input -> wrong outcome' },
    defect_class: { type: 'string' },
    fix: { type: 'string', description: 'root-cause fix plus the check that flags the next instance' },
    size: { enum: SIZES },
    tracked: { type: ['integer', 'null'] },
  },
  required: ['title', 'lens', 'severity', 'confidence', 'platform', 'locations', 'evidence', 'failure_scenario', 'defect_class', 'fix', 'size', 'tracked'],
}
const OPPORTUNITY = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    moment: { type: 'string' },
    today: { type: 'string', description: 'current behaviour with path:line' },
    proposal: { type: 'string', description: 'timings, easing, layers, assets' },
    reference: { type: 'string' },
    channels: { type: 'array', items: { enum: ['motion', 'sound', 'haptics', 'particles', 'light', 'layout', 'copy', 'music'] } },
    impact: { enum: ['high', 'medium', 'low'] },
    size: { enum: SIZES },
    constraints: { type: 'string' },
    tracked: { type: ['integer', 'null'] },
  },
  required: ['title', 'moment', 'today', 'proposal', 'reference', 'channels', 'impact', 'size', 'constraints', 'tracked'],
}
const lensReport = (itemsKey, item) => ({
  type: 'object',
  properties: {
    [itemsKey]: { type: 'array', items: item },
    strengths: { type: 'array', items: { type: 'string' } },
    score: { type: 'integer', minimum: 0, maximum: 10 },
    score_rationale: { type: 'string' },
    coverage: COVERAGE,
  },
  required: [itemsKey, 'strengths', 'score', 'score_rationale', 'coverage'],
})
const PLATFORM_OPTION = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    role: { enum: ['app-host', 'database', 'static-web', 'mobile-builds'] },
    free_tier: { type: 'string' },
    monthly_cost: {
      type: 'object',
      properties: { dau_100: { type: 'string' }, dau_1k: { type: 'string' }, dau_10k: { type: 'string' }, assumptions: { type: 'string' } },
      required: ['dau_100', 'dau_1k', 'dau_10k', 'assumptions'],
    },
    websockets_and_multi_instance: { type: 'string' },
    maturity_and_lock_in: { type: 'string' },
    migration_steps: { type: 'string' },
    sources: { type: 'array', items: { type: 'string' }, minItems: 1 },
  },
  required: ['name', 'role', 'free_tier', 'monthly_cost', 'websockets_and_multi_instance', 'maturity_and_lock_in', 'migration_steps', 'sources'],
}
const PLATFORM = {
  type: 'object',
  properties: {
    options: { type: 'array', items: PLATFORM_OPTION },
    replit_coupling: { type: 'array', items: { type: 'object', properties: { location: LOCATION, what: { type: 'string' } }, required: ['location', 'what'] } },
    expo_go_exit: {
      type: 'object',
      properties: { verdict: { type: 'string' }, unlocks: { type: 'array', items: { type: 'string' } }, costs: { type: 'string' }, owner_testing: { type: 'string' } },
      required: ['verdict', 'unlocks', 'costs', 'owner_testing'],
    },
    recommendation: { type: 'string' },
    migration_phases: { type: 'array', items: { type: 'string' } },
  },
  required: ['options', 'replit_coupling', 'expo_go_exit', 'recommendation', 'migration_phases'],
}
const REPORT_SCHEMA = {
  findings: lensReport('findings', FINDING),
  opportunities: lensReport('opportunities', OPPORTUNITY),
  research: lensReport('platform', PLATFORM),
}
const VERDICT = {
  type: 'object',
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' }, severity: { enum: SEVERITIES } },
  required: ['refuted', 'reason', 'severity'],
}
const KEEP = {
  type: 'object',
  properties: { keep: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['keep', 'reason'],
}
const GAPS = {
  type: 'object',
  properties: {
    gaps: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        properties: { lens: { enum: LENSES.filter(l => kindOf(l) === 'findings').map(l => l.key) }, task: { type: 'string' } },
        required: ['lens', 'task'],
      },
    },
  },
  required: ['gaps'],
}

const SKEPTICS = {
  code: 'Read every cited line and its callers. Refute if the code does not do what is claimed, or no real entry point reaches the failure.',
  intent: 'Refute if the behaviour is deliberate (ADR, docs/GAME-RULES.md § Decisions, CLAUDE.md, a pinning test) or a guard elsewhere already prevents it.',
  impact: 'Judge the severity: who hits this, how often, and what do they lose? Give the severity you would defend.',
}
const skepticsFor = severity =>
  severity === 'critical' || severity === 'high' ? ['code', 'intent', 'impact']
  : severity === 'medium' ? ['code']
  : []

const findingKey = f => `${f.locations[0].path}:${Math.floor(f.locations[0].line / 10)}:${f.defect_class.toLowerCase()}`
const uniqueByKey = list => [...new Map(list.map(f => [findingKey(f), f])).values()]
const rank = severity => SEVERITIES.indexOf(severity)
const settledSeverity = (claimed, verdicts) => {
  const ranks = verdicts.map(v => rank(v.severity)).sort((a, b) => a - b)
  return SEVERITIES[Math.min(rank(claimed), ranks[Math.floor(ranks.length / 2)])]
}

const runLens = (lens, map, task = '') => agent(`${COMMON}

LENS: ${lens.key}
Skills to load: ${lens.skills.join(', ') || 'none'}
Start from: ${lens.start}
References: ${lens.refs}
${task ? `GAP TASK (do only this): ${task}` : lens.ask}

System map:
${map}`, {
  label: `${task ? 'gap' : 'lens'}:${lens.key}`,
  phase: task ? 'Gaps' : 'Audit',
  model: lens.model,
  schema: REPORT_SCHEMA[kindOf(lens)],
}).then(r => r && { ...r, lens: lens.key })

const verify = async finding => {
  const skeptics = skepticsFor(finding.severity)
  if (!skeptics.length) return { ...finding, verdict: 'unverified' }
  const votes = (await parallel(skeptics.map(s => () => agent(`${COMMON}

You are a skeptic. Try to REFUTE this finding. ${SKEPTICS[s]}
If you cannot tell, set refuted=false and say why.
${JSON.stringify(finding)}`, {
    label: `verify:${s}:${finding.title.slice(0, 40)}`,
    phase: 'Verify',
    model: finding.severity === 'critical' ? 'opus' : 'sonnet',
    schema: VERDICT,
  })))).filter(Boolean)
  const upheld = votes.filter(v => !v.refuted)
  if (!votes.length) return { ...finding, verdict: 'unverified' }
  if (upheld.length * 2 <= votes.length) return { ...finding, votes, verdict: 'refuted' }
  return { ...finding, votes, verdict: 'confirmed', severity: settledSeverity(finding.severity, upheld) }
}

const judgeOpportunity = o => agent(`${COMMON}

Judge this polish proposal. keep=false if it already exists, contradicts FEEL-BAR.md or an owner decision in the tracker,
breaks reduced motion or an invariant, or cannot be built on the current stack (Reanimated, expo-audio, expo-haptics, react-native-svg) at its stated size.
${JSON.stringify(o)}`, { label: `judge:${o.title.slice(0, 40)}`, phase: 'Verify', model: 'sonnet', schema: KEEP })
  .then(v => v && { ...o, ...v })

const factCheck = platform => agent(`Fact-check this hosting research with WebFetch. Open every source it cites.
- Correct any price, free-tier limit or capability that the source does not support.
- Drop an option whose claims cannot be sourced.
- Revise the recommendation if a correction changes it.
Return the corrected research in the same shape, and list every correction in "corrections".
${JSON.stringify(platform)}`, {
  label: 'fact-check:infra',
  phase: 'Verify',
  model: 'sonnet',
  schema: {
    type: 'object',
    properties: { platform: PLATFORM, corrections: { type: 'array', items: { type: 'string' } } },
    required: ['platform', 'corrections'],
  },
})

phase('Map')
const map = await agent(`${COMMON}

You are the cartographer. Write a system map in markdown that the specialists will read instead of rediscovering the repo. Every lens reads all of it, so give path:line pointers rather than prose. Include:
- screens and routes;
- what each context owns;
- server modules, grouped by role;
- every socket event, with direction and handler path:line;
- HTTP routes and DB tables;
- the shared/ contract;
- for each CLAUDE.md invariant, the file that implements it and the test that pins it (or "unpinned").`,
  { label: 'cartographer', phase: 'Map', model: 'sonnet' })
if (!map) throw new Error('Cartographer returned nothing; the lenses would run blind.')

phase('Audit')
const reports = (await parallel(LENSES.map(l => () => runLens(l, map)))).filter(Boolean)
const failedLenses = LENS_KEYS.filter(k => !reports.some(r => r.lens === k))
if (failedLenses.length) log(`Lenses that returned nothing: ${failedLenses.join(', ')}`)

phase('Merge')
const rawFindings = uniqueByKey(reports.flatMap(r => (r.findings || []).map(f => ({ ...f, lens: r.lens }))))
const merged = await agent(`Merge duplicates in these audit findings. Two findings are duplicates when fixing one fixes the other.
For each group:
- keep the best-evidenced version;
- union the locations;
- keep the highest severity;
- join the contributing lenses in "lens" with "+".
Every input must survive in some output.
${JSON.stringify(rawFindings)}`, {
  label: 'merge',
  phase: 'Merge',
  model: 'sonnet',
  schema: { type: 'object', properties: { findings: { type: 'array', items: FINDING } }, required: ['findings'] },
})
const findings = merged && merged.findings.length ? merged.findings : rawFindings
log(`${rawFindings.length} raw findings -> ${findings.length} merged`)

phase('Verify')
const opportunities = reports.flatMap(r => r.opportunities || [])
const platformResearch = reports.find(r => r.platform)
const [judgedFindings, judgedOpportunities, checkedPlatform] = await Promise.all([
  parallel(findings.map(f => () => verify(f))),
  parallel(opportunities.map(o => () => judgeOpportunity(o))),
  platformResearch ? factCheck(platformResearch.platform) : null,
])
const infra = checkedPlatform || (platformResearch && { platform: platformResearch.platform, corrections: ['NOT FACT-CHECKED'] })
let judged = judgedFindings.filter(Boolean)

phase('Gaps')
const seen = new Set(rawFindings.map(findingKey))
for (let round = 1; round <= MAX_GAP_ROUNDS; round++) {
  const critique = await agent(`You are the completeness critic for this audit. Name up to 6 gaps:
- an area no lens read;
- a risk class nobody checked;
- a confirmed finding whose sibling instances were not searched.
Return an empty list only if coverage is genuinely complete.
Coverage: ${JSON.stringify(reports.map(r => ({ lens: r.lens, coverage: r.coverage })))}
Confirmed: ${JSON.stringify(judged.filter(f => f.verdict === 'confirmed').map(f => `${f.lens}: ${f.title}`))}`,
    { label: `critic:${round}`, phase: 'Gaps', model: 'opus', schema: GAPS })
  if (!critique || !critique.gaps.length) break
  const extra = (await parallel(critique.gaps.map(g => () =>
    runLens(LENSES.find(l => l.key === g.lens), map, g.task)))).filter(Boolean)
  const fresh = extra.flatMap(r => r.findings).filter(f => !seen.has(findingKey(f)))
  fresh.forEach(f => seen.add(findingKey(f)))
  log(`Gap round ${round}: ${fresh.length} new findings`)
  if (!fresh.length) break
  judged = judged.concat((await parallel(fresh.map(f => () => verify(f)))).filter(Boolean))
}

phase('Synthesize')
const confirmed = judged.filter(f => f.verdict !== 'refuted')
const refuted = judged.filter(f => f.verdict === 'refuted')
const kept = judgedOpportunities.filter(o => o && o.keep)
const report = await agent(`Write the Murlan audit report in markdown, for commit ${sha}. Use only the data below; invent nothing.
Sections:
1. Executive summary: what the owner should act on first.
2. Scorecard: every lens with its score and a one-line rationale.
3. Top 15 findings by risk x reach, each with path:line.
4. Findings by lens. Label each confirmed or unverified.
5. Cross-cutting defect classes, each with the one check that prevents a recurrence.
6. Polish roadmap: opportunities grouped by moment, ranked by impact per size.
7. Strengths to preserve.
8. Refuted appendix: one line of reason each, so nobody raises them again.
9. Coverage gaps: failed lenses (${failedLenses.join(', ') || 'none'}), unverified findings, and anything that needs an iOS or Android capture.
10. Infrastructure: a comparison table, the Replit coupling, the EAS build assessment, the recommended stack, the migration phases, and the fact-check corrections.
11. Proposed ticket batches: one per defect class, each with a title, size, covered findings and any tracked issue.
    Add a wayfinder map for the infrastructure migration.
Lens scores: ${JSON.stringify(reports.map(r => ({ lens: r.lens, score: r.score, why: r.score_rationale, strengths: r.strengths })))}
Findings: ${JSON.stringify(confirmed)}
Refuted: ${JSON.stringify(refuted.map(f => ({ title: f.title, lens: f.lens, reasons: f.votes.map(v => v.reason) })))}
Opportunities: ${JSON.stringify(kept)}
Infrastructure: ${JSON.stringify(infra)}`,
  { label: 'synthesis', phase: 'Synthesize', model: 'opus' })

return {
  report,
  confirmed,
  opportunities: kept,
  infra,
  refuted,
  failedLenses,
  coverage: reports.map(r => ({ lens: r.lens, coverage: r.coverage })),
}
