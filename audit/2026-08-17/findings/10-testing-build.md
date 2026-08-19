# C2 — Testing, build & supply chain

Repo `C:\Users\roton\murlan` @ `b894af4`, branch `main`. Read-only pass.

**Commands run this session** (all read-only): `npm test` (672 tests / 670 pass / 2 skipped,
exit 0) · `node --test --test-reporter=tap` (to enumerate the skips) · `npm audit --json` ·
`npm outdated --json` · `npm ls esbuild --all` · a scratch probe importing every
`server/*.ts` under plain Node type-stripping · a scratch harness that replays each
source-scanning test's own regex against synthetic violations. **Not run** (forbidden — they
write into the repo): `expo:web:build`, `expo:static:build`, `server:build`, Playwright,
Maestro, `npm install`, `npm audit fix`.

The 2 skipped tests are `tests/integration/schemaBootstrap.test.ts:21` and
`tests/integration/testServerCleanup.test.ts:31` — the two integration files that gate with
`t.skip(skipMessage())` inside a `test()` rather than `describe(…, { skip })`. Both correctly
`return` after skipping. Same `DATABASE_URL` gate as the other 9; not a finding.

---

### [TEST-01] Make CI's test step able to fail — the pipe into `tee` discards `npm test`'s exit code
- **Severity:** High
- **Confidence:** High (read the workflow, confirmed the pipeline semantics locally, confirmed GitHub's default-shell behaviour against GitHub's own docs and `actions/runner` issues #353 / #1955)
- **Effort:** S (<1h)
- **Location:** `.github/workflows/ci.yml:61-62`, and the guard it undercuts at `.github/workflows/ci.yml:67-74`
- **Problem:** The test step is `run: npm test | tee test-output.txt` with **no `shell:` key**.
  GitHub Actions runs a `run:` block with no `shell:` as `bash -e {0}` — `-e` only, **no
  `pipefail`**. `shell: bash` is the variant that adds `-o pipefail`, and it is not used here.
  Without `pipefail` a pipeline's exit status is the *last* command's, so the step's status is
  `tee`'s, which is always 0. `npm test` exiting 1 produces a green step.
- **Impact:** No unit or integration test failure can fail CI. All 672 unit tests and all 11
  DB-gated integration suites — socket auth, impersonation, hand secrecy, the exchange bypass,
  seat vacancy, ratings, replays — are advisory only. Any regression in them merges on green.
  `typecheck` (`:59`) and `lint` (`:77`) are unpiped and still gate, which is why the repo
  reads as healthy: the two checks that can fail are the two nobody piped.
- **Repro / proof:** Locally, `false | tee /dev/null; echo $?` → `0`; the same with
  `set -o pipefail` → `1`. Applied to `.github/workflows/ci.yml:62`, an `npm test` that exits 1
  yields a step exit of 0. The follow-on step at `:67-74` does not rescue this: it greps only
  for the literal `DATABASE_URL not set` and is blind to `# fail 3`.
- **Note for the implementer:** this is precisely the "no self-defeating safeguards" shape
  `CLAUDE.md` describes. The `:67-74` assertion was added to stop a *skipped* suite passing
  silently, and it sits downstream of a pipe that had already made a *failing* suite pass
  silently. Fixing the pipe is what makes that guard mean something.
- **Proposed fix:** In `.github/workflows/ci.yml`, add `shell: bash` to the Test step (this
  switches it to `bash --noprofile --norc -eo pipefail {0}`). Do the same, or drop the pipe
  entirely, anywhere else a pipeline is introduced. A belt-and-braces alternative that does not
  depend on remembering the shell rule: `run: npm test > test-output.txt 2>&1 || (cat
  test-output.txt; exit 1)` followed by `cat test-output.txt`. Also consider adding
  `defaults: { run: { shell: bash } }` at workflow level so future steps inherit pipefail.
- **Acceptance criteria:** On a scratch branch, change one assertion in
  `tests/scoring.test.ts` so it fails, push, and the CI job reports failure at the Test step.
  Revert. Repeat with a deliberately skipped integration suite and confirm `:67-74` still fires.
- **Fix risk:** `pipefail` can surface pre-existing failures that were being swallowed. Run
  `npm test` locally first (it is green today at 670/672), so the first CI run after the fix
  should be green.
- **Depends on:** None

---

### [TEST-02] Test the two server-authority checks that stop the obvious cheats — playing out of turn, and playing a card you do not hold
- **Severity:** High
- **Confidence:** High (read the handler, read every integration suite's test names and the two nearest bodies)
- **Effort:** M (a few hours)
- **Location:** guards at `server/socket.ts:1414` and `server/socket.ts:1417-1420`; start-card guard at `server/socket.ts:1430-1440`; card ids minted at `lib/gameEngine.ts:184-189`; nearest existing test `tests/integration/gameplay.test.ts:161`
- **Problem:** Three checks carry the entire integrity half of the client/server trust boundary:

  ```ts
  const currentIdx = gameState.currentTurnIndex;
  if (playerMap[currentIdx] !== userId) return;          // :1414  out-of-turn
  ...
  const unique = Array.from(new Set(cardIds));
  const cards = player.hand.filter((c) => unique.includes(c.id));
  if (cards.length !== unique.length) return;            // :1418-1420  card ownership
  ```

  No test in the repo emits `game:play` from the wrong seat, and no test emits `game:play`
  with a card id the sender does not hold. I read the test names of all 11 integration suites
  and the bodies of `gameplay.test.ts` and `spectator.test.ts`: the closest are "a player
  never receives another player's hand" (`gameplay.test.ts:161`) and "a spectator cannot play
  or pass" (`spectator.test.ts:152`). The first proves **confidentiality**, not integrity. The
  second exercises a different branch — a spectator is not in `socketRoomMap`, so it returns at
  `socket.ts:1396` and never reaches `:1414` or `:1418`.
- **Impact:** Card ids are fully deterministic — `id: \`${rank}_${suit}\`` plus `joker_bw` /
  `joker_colored` (`lib/gameEngine.ts:184-189`). Every client already knows every possible id
  without ever seeing another hand, so `:1418-1420` is the *only* thing between a hand-crafted
  `socket.emit("game:play", { cardIds: ["joker_colored"] })` and winning a rated ladder game
  with cards the sender never held. The guards are correct today (I read them); the finding is
  that nothing anywhere would notice if a refactor of the hottest file in the repo
  (`server/socket.ts`, 23 changes in 8 weeks) weakened them.
- **Repro / proof:** Read path — `server/socket.ts:1391-1465`. Coverage check —
  `grep -rn "cardIds" tests/` returns only well-formed plays from the seat whose turn it is
  (`gameplay.test.ts:264`, `spectator.test.ts:105,162`) and the malformed-payload smoke test
  (`gameplay.test.ts:349`, which sends `42`, caught by zod before the handler).
- **Proposed fix:** Add to `tests/integration/gameplay.test.ts`, using the existing
  `tests/helpers/gameDriver.ts` harness that already seats two humans and starts a hand:
  1. "a player cannot play out of turn" — the seat whose turn it is **not** emits `game:play`
     with a card it genuinely holds; assert the broadcast `game:state` `currentTurnIndex` and
     both `handCount`s are unchanged after a round-trip.
  2. "a player cannot play a card they do not hold" — the seat on turn emits `game:play` with
     an id taken from the *other* player's hand (read it server-side from the harness, or just
     enumerate `${rank}_${suit}` and pick one absent from the sender's own hand); assert state
     unchanged.
  3. "the opening play must contain the start card" — the seat on turn, with
     `firstPlayMade === false`, emits a legal single that is not `startCard`; assert a
     `game:error` with `code: "MUST_PLAY_START_CARD"` and unchanged state.
  Each of the three currently returns silently with no emit except (3), so assert on the
  *absence of state change* (compare the `game:state` payload before and after) rather than on
  an error message.
- **Acceptance criteria:** Three new tests in `tests/integration/gameplay.test.ts` that fail if
  the corresponding line in `server/socket.ts` is deleted. Verify by deleting each line in turn
  locally with `DATABASE_URL` set and confirming exactly one new test goes red per deletion.
- **Fix risk:** None to production code. The tests need a live Postgres, so they only run in CI
  and for developers with a database — acceptable, since that is where the rest of the socket
  coverage already lives.
- **Depends on:** [TEST-01] (without it these tests can fail in CI without failing the job)

---

### [TEST-03] Declare `esbuild` — the production server bundle is built by an undeclared, dev-only, 2023-era transitive
- **Severity:** High
- **Confidence:** High (read `package.json`, resolved `node_modules/.bin/esbuild`, read `package-lock.json`, ran `npm ls esbuild --all`)
- **Effort:** S (<1h)
- **Location:** `package.json:12` (`server:build`), `package.json:74-94` (devDependencies — no `esbuild` entry), `.replit:10`
- **Problem:** `"server:build": "esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=server_dist"` — the sole command that produces the production server artifact — invokes a binary that no manifest declares. `npm ls esbuild --all` shows three copies, none of them direct:

  ```
  ├─┬ drizzle-kit@0.31.10
  │ ├─┬ @esbuild-kit/esm-loader@2.6.5 → @esbuild-kit/core-utils@3.3.2 → esbuild@0.18.20
  │ └── esbuild@0.25.12                       (nested)
  └─┬ tsx@4.21.0 → esbuild@0.27.2             (nested)
  ```

  The hoisted top-level copy — the one `node_modules/.bin/esbuild` links to, and therefore the
  one `npm run server:build` executes — is **0.18.20**, confirmed by
  `npx --no-install esbuild --version`. It arrives via `@esbuild-kit/core-utils`, a deprecated
  package pulled in by `drizzle-kit`, and the lockfile marks it `"dev": true`.
- **Impact:** Three concrete failure modes, none of which CI can see (it runs no build — see
  [TEST-04]), and all of which land first on a Replit Cloud Run deploy (`.replit:10`):
  1. Bump or replace `drizzle-kit` (npm audit currently proposes exactly that; see [TEST-12])
     and `@esbuild-kit/*` disappears. The hoisted top-level `esbuild` goes with it, `.bin`
     no longer resolves, and `npm run server:build` fails with `esbuild: not found` during the
     deploy build.
  2. Any install that omits dev dependencies leaves the build command with no binary at all,
     because the lockfile classifies the only resolvable copy as dev-only.
  3. Today the production server is compiled by esbuild 0.18.20 (Aug 2023) while 0.27.2 sits
     nested one directory away — an unowned, unpinned, three-year-old compiler on the shipped
     artifact. `npm audit` flags this exact version under GHSA-67mh-4wv8-2f99.
- **Repro / proof:** `node -e "console.log(require('./node_modules/esbuild/package.json').version)"`
  → `0.18.20`. `node_modules/.bin/esbuild` contains
  `exec node "$basedir/../esbuild/bin/esbuild" "$@"`. `grep -n esbuild package.json` matches
  only line 12, the script itself.
- **Proposed fix:** Add `"esbuild": "^0.27.2"` to `devDependencies` in `package.json` (match
  the version `tsx` already carries so npm can dedupe), run `npm install` to update
  `package-lock.json`, and verify `npx esbuild --version` reports the new version.
  While there, add `--target=node22` to the `server:build` command — see [TEST-16].
- **Acceptance criteria:** `npm ls esbuild` lists `esbuild@0.27.x` as a direct dependency of
  `expo-app`; `npx --no-install esbuild --version` reports it; `npm run server:build` produces
  `server_dist/index.js` and `NODE_ENV=production node server_dist/index.js` boots against a
  test database.
- **Fix risk:** esbuild 0.18 → 0.27 spans nine minor releases. Bundling a Node ESM entry with
  `--packages=external` is the most stable path esbuild has, so breakage is unlikely, but the
  resulting `server_dist/index.js` must be booted once before deploying.
- **Depends on:** None

---

### [TEST-04] Exercise the production build in CI — nothing verifies it before Replit runs it
- **Severity:** High
- **Confidence:** High (read all three workflows and `.replit`)
- **Effort:** S (<1h)
- **Location:** `.github/workflows/ci.yml:42-77` (five steps, no build), `.replit:10`, `package.json:10-12`, `scripts/build.js` (563 L)
- **Problem:** CI runs `npm ci`, `typecheck`, `npm test`, the skip assertion, and `lint`. It
  never runs `expo:web:build`, `server:build` or `expo:static:build`. Replit's deployment build
  (`.replit:10`) runs all three in sequence, so the deploy is the first and only execution of
  563 lines of `scripts/build.js`, the Metro web export, and the esbuild server bundle. There
  is no earlier signal and no GitHub-side deploy job to catch it.
- **Impact:** A break anywhere in the build chain — a Metro config change, an esbuild
  resolution change ([TEST-03]), a Babel/React-Compiler bump ([TEST-13]), a bad
  `app.json` plugin entry — passes typecheck, test and lint, merges to `main`, and is
  discovered when the owner clicks Deploy. `docs/BACKLOG.md` O5 already records that Replit
  boot has been unverified since the `reusePort` fix, so this is the second unverified step in
  the same pipeline.
- **Repro / proof:** `grep -n "run:" .github/workflows/ci.yml` yields `npm ci`,
  `npm run typecheck`, `npm test | tee …`, the grep block, `npm run lint`. No build. The other
  two workflows are `workflow_dispatch` only (`eas-build.yml:7-8`, `maestro.yml:16-17`).
- **Proposed fix:** Add a second job to `.github/workflows/ci.yml` (no Postgres service
  needed):
  ```yaml
  build:
    name: Production build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run expo:web:build
      - run: npm run server:build
      - run: test -f dist/index.html && test -f server_dist/index.js
  ```
  `expo:static:build` cannot be added unchanged: `scripts/build.js:41-59` exits 1 unless one of
  `REPLIT_INTERNAL_APP_DOMAIN`, `REPLIT_DEV_DOMAIN` or `EXPO_PUBLIC_DOMAIN` is set. Set
  `EXPO_PUBLIC_DOMAIN: example.invalid` on that step to exercise it, and pair it with the
  assertion from [TEST-05] so a vacuous "success" is caught.
- **Acceptance criteria:** The new job is green on `main` today, and goes red if `esbuild` is
  removed from `node_modules` or if `metro.config.js` is made syntactically invalid.
- **Fix risk:** Adds a few minutes of CI wall-clock. The `expo export` step downloads nothing
  beyond what `npm ci` already installed.
- **Depends on:** [TEST-03]

---

### [TEST-05] Fail the static build when the asset extractor finds nothing — zero assets is currently reported as success
- **Severity:** Medium
- **Confidence:** High (read the code path end to end)
- **Effort:** S (<1h)
- **Location:** `scripts/build.js:314-353` (`extractAssets`), `scripts/build.js:355-358` (early return), `scripts/build.js:540-544` (the guarded call)
- **Problem:** `extractAssets` finds assets by running a regex over the *text of the built
  bundle*:
  ```js
  const assetPattern =
    /httpServerLocation:"([^"]+)"[^}]*hash:"([^"]+)"[^}]*name:"([^"]+)"[^}]*type:"([^"]+)"/g;
  ```
  It depends on Metro emitting those four properties, in that order, within one object literal.
  If Metro's asset-registry output shape changes — property order, an inserted field with a `}`
  in it, a different quoting style — the regex matches nothing and `assets` is `[]`. The script
  then treats that as "nothing to do": `downloadAssets` returns 0 at `:356-358`, and `:542`
  reads `if (assetCount > 0) updateBundleUrls(timestamp, baseUrl)` — so the rewrite that
  repoints every `httpServerLocation` from `http://localhost:8081` to the deployment domain is
  **skipped**. `main()` continues to `updateManifests`, logs "Build complete!", and exits 0.
- **Impact:** The Expo Go static build deploys "successfully" with every asset URL still
  pointing at `http://localhost:8081`. Every Expo Go client that loads the published manifest
  fails to fetch card art, sounds, icons and fonts. The build reports success, CI never runs it
  ([TEST-04]), and the first evidence is a user on a phone. This repo always has assets
  (`assets/images/cards/`, 12 WAVs in `assets/sounds/`, icons), so `assets.length === 0` is
  never a legitimate state.
- **Repro / proof:** Read path. `extractAssets` (`:349-352`) returns
  `Array.from(assetsMap.values())` with no assertion; `downloadAssets` (`:356-358`) is
  `if (assets.length === 0) { return 0; }`; `main` (`:540-544`) gates `updateBundleUrls` on
  `assetCount > 0`. Nothing between them raises.
- **Proposed fix:** In `scripts/build.js`, after `const assets = extractAssets(timestamp);`
  (`:529`), add `if (assets.length === 0) exitWithError("Asset extraction found 0 assets — the
  Metro bundle format the regex at extractAssets() expects has changed.");`. Then drop the
  `if (assetCount > 0)` guard at `:542` and call `updateBundleUrls` unconditionally, since the
  zero case can no longer be reached.
- **Acceptance criteria:** Temporarily corrupt `assetPattern` (e.g. `hash:"` → `hashx:"`) and
  confirm `npm run expo:static:build` exits non-zero with the new message instead of printing
  "Build complete!". Restore, and confirm a normal run still reports a non-zero asset count.
- **Fix risk:** If any legitimate configuration genuinely produces zero assets, the build now
  fails. This app has assets in every configuration, so that state does not exist here.
- **Depends on:** None

---

### [TEST-06] Stop `scripts/build.js` adopting a Metro server it did not start — its `EXPO_PUBLIC_*` values are baked into the bundle, not this script's
- **Severity:** Medium
- **Confidence:** High (read the code; the env-inlining semantics are stated by the repo's own comment at `scripts/e2e-server.mjs:11-16`)
- **Effort:** S (<1h)
- **Location:** `scripts/build.js:108-152` (`startMetro`), specifically `:109-113` and the log at `:116`; `.replit:71-75` (the dev workflow that occupies port 8081); `scripts/e2e-server.mjs:34`
- **Problem:** `startMetro(expoPublicDomain)` opens with:
  ```js
  const isRunning = await checkMetroHealth();      // GET http://localhost:8081/status
  if (isRunning) { console.log("Metro already running"); return; }
  ```
  It then logs `Setting EXPO_PUBLIC_DOMAIN=${expoPublicDomain}` at `:116` and passes that env
  only to a Metro **it spawns itself** (`:117-125`). When something else already holds port
  8081, the script downloads bundles from that foreign server and never applies the env at all,
  while the log line above suggests it did. `EXPO_PUBLIC_*` variables are inlined by Metro at
  transform time from the *server's* environment — the repo states this itself at
  `scripts/e2e-server.mjs:11-16` — so the query parameters `dev=false&minify=true` that
  `downloadBundle` sets (`:194-197`) control transform mode but cannot retroactively change
  which `EXPO_PUBLIC_*` values were compiled in.
- **Impact:** On the Replit workspace the "Start Frontend" task (`.replit:71-75`) runs
  `npm run expo:dev`, which listens on 8081 with `EXPO_PUBLIC_DOMAIN=$REPLIT_DEV_DOMAIN:5000`
  (`package.json:7`). A static build run while that is up silently ships a bundle carrying the
  dev domain rather than the deployment domain, so Expo Go clients point at the wrong host —
  and the build log says otherwise. This is also the **only** path by which
  `EXPO_PUBLIC_E2E_FAST` could reach a shipped bundle: I traced every setter and there is
  exactly one, `scripts/e2e-server.mjs:34`, which sets it in its own process before a one-shot
  `npx expo export` and leaves no Metro running. So no repo script leaks it today — but nothing
  prevents a Metro started by hand with it set from being adopted here, and the flag zeroes
  `AI_DELAY` / `AI_EXCHANGE_DELAY` / `RESULT_DELAY` (`app/game.tsx:20-29`) and `GAME_OVER_DELAY`
  (`app/(online)/game.tsx:31-41`).
- **Repro / proof:** Read path `scripts/build.js:108-125`, `:190-212`. The early return at
  `:110-113` performs no environment check of any kind against the running server.
- **Proposed fix:** In `scripts/build.js`, replace the unconditional early return with a
  refusal: if `checkMetroHealth()` succeeds and this process did not start it, call
  `exitWithError("A Metro server is already listening on 8081. Its EXPO_PUBLIC_* values are
  baked into the bundle and this script cannot change them. Stop it and re-run.")`. Additionally,
  at the top of `main()` (`:499`), add
  `if (process.env.EXPO_PUBLIC_E2E_FAST) exitWithError("EXPO_PUBLIC_E2E_FAST is set — this
  would ship a zero-delay build.")`, and the same check in a small wrapper for
  `expo:web:build`, since that is the command the Replit deploy actually ships the web bundle
  from.
- **Acceptance criteria:** With `npx expo start` running on 8081, `npm run expo:static:build`
  exits non-zero with the new message. With nothing on 8081 it proceeds as before. With
  `EXPO_PUBLIC_E2E_FAST=1` set it exits non-zero regardless.
- **Fix risk:** Removes a local convenience (reusing a warm Metro). That convenience is what
  produces the wrong bundle, so losing it is the point; note it in `docs/TESTING.md` if anyone
  relies on it.
- **Depends on:** None

---

### [TEST-07] Make `tests/reducedMotion.test.ts` check animations, not files — it is currently a no-op for all 118 of them
- **Severity:** Medium
- **Confidence:** High (read the test, enumerated the files it scans and their contents)
- **Effort:** M (a few hours)
- **Location:** `tests/reducedMotion.test.ts:34-50` and `:54-63`; the 13 files it nominally covers
- **Problem:** Both tests are per-file boolean checks:
  ```ts
  if (!ANIMATES.test(source)) continue;
  if (source.includes("usePrefersReducedMotion")) continue;   // ← whole file exempted
  offenders.push(rel);
  ```
  One occurrence of the string `usePrefersReducedMotion` anywhere in a file — including inside
  a comment — exempts every animation in it. I enumerated every `.tsx` under `app/` and
  `components/` that calls a Reanimated builder: **all 13 already contain the string**, holding
  118 animation call sites between them:
  `components/GameShared.tsx` (32), `components/GameTable.tsx` (21), `app/index.tsx` (16),
  `app/result.tsx` (12), `components/NotificationBanner.tsx` (8),
  `components/GameOverOverlay.tsx` (8), `components/ExchangeModal.tsx` (7),
  `components/ReactionLayer.tsx` (5), `components/CardView.tsx` (4), `app/rules.tsx` (2),
  `components/OfflineBanner.tsx` (1), `components/MenuButton.tsx` (1),
  `components/ExchangeAnnouncement.tsx` (1).
- **Impact:** The test can only ever catch a *brand-new* `.tsx` file that animates, or the
  wholesale removal of the hook from a file. The two regressions its own comment
  (`:6-9`) says it exists to prevent — the home screen's floating cards and the result screen's
  glow, both `withRepeat(…, -1)` — live in `app/index.tsx` and `app/result.tsx`, which are now
  permanently exempt. A new endless animation added to either is invisible to it. Scope is also
  narrower than the comment implies: `sourcesUnder` (`:21-29`) collects `.tsx` only, so a `.ts`
  helper under `components/` is unscanned, and `context/` and `lib/` are not walked at all
  (neither animates today — verified by grep — so that half is latent, not live).
- **Repro / proof:** I replayed the test's own logic against a synthetic file containing a
  guarded entrance animation *and* an unguarded `withRepeat(withTiming(1), -1)`: **MISSED**.
  Same for a file whose only occurrence of the hook name is in a comment: **MISSED**. A clean
  new file with only the unguarded loop: CAUGHT. Verified with a scratch script replaying
  `ANIMATES` and the `.includes()` check verbatim.
- **Proposed fix:** Change the unit from the file to the call site. For each `.tsx` under `app/`
  and `components/`, split the source into top-level function/component bodies (a brace-matching
  walk like the one `tests/orientation.test.ts:33-58` already implements for `<Modal>` tags is
  the established pattern in this repo) and require that any body containing a Reanimated
  builder also references `usePrefersReducedMotion` or a value derived from it. Strip comments
  before scanning so a mention in prose cannot satisfy the check. Keep the two existing tests as
  a coarse outer net, and extend `sourcesUnder` to `.ts` as well.
- **Acceptance criteria:** Add an unguarded `withRepeat(withTiming(1), -1)` inside a component
  in `app/index.tsx` that does not consult the preference; the suite goes red naming that
  component. Remove it; green. Move the hook reference into a `//` comment in a file that
  animates; red.
- **Fix risk:** A stricter scanner will flag legitimate cases where the preference is consulted
  in a parent and threaded down as a prop. Expect to add an explicit allowance for a
  `reduceMotion`/`reduced` prop, and to touch several of the 13 files.
- **Depends on:** None

---

### [TEST-08] Close the blind spots in the three other source-scanning tests — each misses a form that `tsc` and `expo lint` also allow
- **Severity:** Medium
- **Confidence:** High (replayed each scanner's exact regex against synthetic violations)
- **Effort:** M (a few hours)
- **Location:** `tests/socketEvents.test.ts:31` and `:46`; `tests/tokenRoles.test.ts:68`; `tests/motion.test.ts:78-84`
- **Problem:** Each of these tests pins a real invariant by reading source text, and each has a
  self-check case proving the scanner still matches *something* — good practice. But each
  regex is narrower than the invariant it claims, and nothing else in the toolchain covers the
  gap: there is no Prettier config in the repo and `eslint.config.js` adds no quote-style or
  member-access rule, so all of the forms below pass `npx tsc --noEmit` and `npx expo lint`
  cleanly today.

  | Scanner | Invariant claimed | Form it misses |
  |---|---|---|
  | `socketEvents.test.ts:31` `/socket\.on\(\s*"([^"]+)"/g` | "no inbound socket event bypasses `onEvent`" | `socket.on('x', …)` (single quotes) · `` socket.on(`x`, …) `` · `socket.on(EVENT, …)` (constant) · any registration in a file other than `server/socket.ts` (`:21` reads that one file) |
  | `tokenRoles.test.ts:68` `/(?<![A-Za-z])color\s*[:=]\s*\{?\s*(Colors\|Scrim\|Highlight)\.…/g` | "no fill, border or scrim token is used as a text or icon colour" | `color: active ? Colors.gold : Colors.goldMuted` (only the token *immediately* after `color:` is examined, so the second branch of every ternary is unscanned) · `tintColor:` on an icon/image · `placeholderTextColor={…}` · a token aliased through a local const · `Theme.Colors.x` |
  | `motion.test.ts:80` `/damping:\s*\d/g` | "no spring is written inline" | `damping: D` where `D` is a const · `dampingRatio: 0.4` (Reanimated's other spring config, never matched) · `withSpring(v, s)` where `s` is an object built elsewhere · anything under `context/` or `lib/` (`:78` walks `app` and `components` only) |

  The ternary case in `tokenRoles` is the one most likely to occur naturally — a conditional
  text colour whose inactive branch is a translucent fill renders as almost nothing, which is
  exactly the bug the test exists to catch.
- **Impact:** Each invariant is documented in `CLAUDE.md` as a shipped bug that must not
  recur (`room:unspectate` outside the wrapper; a translucent token as a text colour; springs
  duplicated inline). A regression written in any form above lands green through typecheck,
  lint and the test that names the invariant.
- **Repro / proof:** Scratch harness replaying each regex verbatim. Results —
  socketEvents: double-quoted CAUGHT, single-quoted/backtick/constant MISSED.
  tokenRoles: plain `color: Colors.goldMuted` CAUGHT, ternary / `tintColor` /
  `placeholderTextColor` / aliased const / `Theme.Colors.x` MISSED.
  motion: literal `damping: 14` CAUGHT, `damping: D` / `dampingRatio: 0.4` / spread MISSED.
- **Proposed fix:** Per file:
  - `socketEvents.test.ts` — widen the capture to `['"\`]` and add a second assertion that no
    `socket.on(` appears with a non-literal first argument; extend `:21` to read every file
    under `server/` rather than only `socket.ts`.
  - `tokenRoles.test.ts` — scan the whole right-hand side of a `color`/`tintColor`/
    `placeholderTextColor` assignment (to the end of the statement or the closing brace) for any
    `(Colors|Scrim|Highlight).<key>` in the fill set, instead of only the first token; add
    `tintColor` and `placeholderTextColor` to the property alternation.
  - `motion.test.ts` — match `damping:` and `dampingRatio:` followed by anything, and extend the
    walk at `:78` to `context/` and `lib/`.
  Add one negative fixture per missed form so the widened scanner is itself pinned.
- **Acceptance criteria:** For each of the eleven missed forms in the table, inserting it into a
  real file turns the corresponding suite red; removing it turns it green. The existing
  self-check tests (`tokenRoles.test.ts:105`, `socketEvents.test.ts:45`,
  `orientation.test.ts:79`) still pass unchanged.
- **Fix risk:** Widening `tokenRoles` past the first token will surface genuine existing
  conditional colours that need review — that is the finding, not a false positive, but budget
  for a handful of real fixes in `components/`.
- **Depends on:** None

---

### [TEST-09] Complete `tests/serverLoadable.test.ts` — it checks 11 of 21 server modules while claiming to check every one
- **Severity:** Medium
- **Confidence:** High (read the test; ran a probe importing all of them)
- **Effort:** S (<1h)
- **Location:** `tests/serverLoadable.test.ts:4-9`
- **Problem:** The file's own comment is
  `// Integration tests boot the real server. That is only possible if every server module
  loads under Node's native type-stripping — no bundler, no path aliases.`
  The `MODULES` list then names 11: `logger, db, session, cors, validate, schemas,
  socketSchemas, socketSafety, ticket, storage, onlineGameLogic`. `server/` holds 22 `.ts`
  files. The ten omitted (excluding `index.ts`, correctly omitted because importing it binds a
  port) are `socket`, `routes`, `testApp`, `schemaDdl`, `stats`, `ratings`, `replays`, `push`,
  `replayShape`, `pushShape`. There is no comment explaining the omission, and I verified it is
  not a technical one: **all ten import cleanly today**, checked by a scratch probe that
  dynamically imported each under plain Node with dummy `DATABASE_URL`/`SESSION_SECRET`
  (`OK socket.ts`, `OK routes.ts`, `OK testApp.ts`, `OK schemaDdl.ts`, `OK stats.ts`,
  `OK ratings.ts`, `OK replays.ts`, `OK push.ts`, `OK replayShape.ts`, `OK pushShape.ts`).
- **Impact:** The omitted set is exactly the set that matters. `testApp.ts`, `routes.ts`,
  `socket.ts` and `schemaDdl.ts` are what `tests/helpers/testServer.ts:102-108` boots, and
  `stats.ts`, `ratings.ts`, `replays.ts`, `push.ts` have no test file of their own at all. Add
  a `@/` path alias or an extension-less import to `server/socket.ts` and: typecheck passes
  (`tsconfig.json:9-16` declares the aliases), lint passes, the 45 unit files pass, and the
  only thing that fails is the 11 integration suites — which skip silently for every developer
  without Postgres. So a change that makes the server unbootable produces a fully green local
  `npm test`.
- **Repro / proof:** `wc -l server/*.ts` lists 22 files; `MODULES` names 11. The probe above
  proves the other ten load. `tsconfig.json:9-16` declares `@/*` and `@shared/*`, which Node's
  type-stripping does not resolve — the precise failure this test exists to prevent.
- **Proposed fix:** Extend `MODULES` in `tests/serverLoadable.test.ts:6-9` to every `.ts` file
  under `server/` except `index.ts`. Better: derive it — `readdirSync("server")`, filter to
  `.ts`, exclude `index.ts` with a one-line comment saying why (it calls `listen()` and installs
  signal handlers at import). Deriving it means a new server module is covered the day it lands
  rather than the day someone remembers the list.
- **Acceptance criteria:** The suite generates one test per file in `server/` minus `index.ts`,
  and all pass at `b894af4`. Adding `import { x } from "@/lib/theme";` to `server/socket.ts`
  turns exactly that test red without a database.
- **Fix risk:** None. Verified all ten currently load.
- **Depends on:** None

---

### [TEST-10] Cover the rematch decision — three pure functions decide whether a table plays again and none is referenced by any test
- **Severity:** Medium
- **Confidence:** High (grepped every test file for each symbol; read the functions and both call sites)
- **Effort:** S (<1h)
- **Location:** `lib/gameEngine.ts:1247-1260` (`matchIsClosing`), `:1267-1269` (`botWantsRematch`), `:1272-1274` (`isMajority`); consumers `server/socket.ts:961-974` (`countRematchAnswers`) and `:988-991` (`tableWantsRematch`), `context/GameContext.tsx:145,265,483`, `context/OnlineGameContext.tsx:571`
- **Problem:** A symbol-by-symbol sweep of `tests/` for every function `lib/gameEngine.ts`
  exports turns up exactly four with zero references anywhere in the test tree:
  `matchIsClosing`, `botWantsRematch`, `isMajority`, `pickGivebackCard`. The first three are the
  whole rematch decision, in both authorities. `tests/scoring.test.ts` covers `scoreHand`,
  `addHandScores`, `MATCH_TARGETS`/`nextMatchTarget` and `resolveMatch` — it stops one step
  short of the functions that use their output.
- **Impact:** Concrete behaviours nothing pins:
  - `isMajority(yes, seats) => yes * 2 > seats` — "a table split down the middle stops". In a
    2-player online game this means **both** must say yes. Flip the comparison to `>=` and every
    2-player table rematches on one vote, with no test red.
  - `countRematchAnswers` (`server/socket.ts:961-974`) implements "a human who never answered
    counts as a no" by only incrementing on `rematchIntents.get(userId) === true`. Nothing
    asserts that an absent or `false` answer is a no, which is the rule `CLAUDE.md` states.
  - `matchIsClosing` gates the prompt on `leader + (playerCount - 1) >= target`. `playerCount - 1`
    is an unwritten restatement of the top per-manche award in `scoreHand` (3 at 4 players, 2 at
    3, 1 at 2). If the point table in `lib/gameEngine.ts` ever changes, this constant desyncs
    silently and the rematch prompt appears a manche early or never appears.
  - `botWantsRematch(botScore, leaderScore) => leaderScore === 0 || botScore * 2 >= leaderScore` —
    a bot-carried table's verdict, untested in either direction.
- **Repro / proof:** For each exported function of `lib/gameEngine.ts`,
  `grep -rlw <name> tests/*.test.ts tests/integration/*.test.ts | wc -l` → 0 for those four.
  `tests/scoring.test.ts` mentions none of them.
- **Proposed fix:** Add a `describe("the rematch decision")` block to `tests/scoring.test.ts`
  (it already owns the match arithmetic and imports from `lib/gameEngine.ts`):
  `isMajority` at 2/3/4 seats including every tie; `botWantsRematch` for a leader on 0, a bot at
  exactly half the leader, and a bot below it; `matchIsClosing` for `length: "single"`, for a
  hand where the smallest hand is above and below `CLOSING_HAND_CARDS`, and one case asserting
  `playerCount - 1` equals `Math.max(...Object.values(scoreHand(rankings, playerCount)))` so the
  two stay coupled. Add one integration case to `tests/integration/gameplay.test.ts` where one
  of two seats emits `game:rematch_intent` with `true` and the other never answers, asserting
  `game:rematch_intents` reports `{ yes: 1, total: 2 }` and the match does not continue.
- **Acceptance criteria:** Changing `isMajority`'s `>` to `>=` turns the new tests red; changing
  `CLOSING_HAND_CARDS` or the `scoreHand` top award turns the coupling test red.
- **Fix risk:** None — pure functions, new tests only.
- **Depends on:** None

---

### [TEST-11] Give `handleGameOver` a testable seam — 213 lines of scoring, ratings, replays and achievements with no unit coverage
- **Severity:** Medium
- **Confidence:** High (read `server/socket.ts` module scope, `setupSocket`, `__testables`, and the whole of `handleGameOver`; probed importability)
- **Effort:** L (a day+)
- **Location:** `server/socket.ts:732-945` (`handleGameOver`), `:125-138` (module-scope mutable state), `:146-158` (env-derived constants read once), `:212-235` (`__testables`), `:1004-1049` (`setupSocket`), `:1051` (the connection closure)
- **Problem — why the file is untestable, diagnosed:** it is **not** an import problem. I probed
  `server/socket.ts` under plain Node type-stripping and it loads fine, leaving no live handles.
  Three other things block unit testing:
  1. **Module-scope mutable state.** `activeGames`, `socketRoomMap`, `spectatorRoomMap`,
     `userSocketMap`, `publicRoomIds` and the three timer maps (`:125-138`) are module
     singletons. A test cannot construct an isolated world, and two tests in one process share
     every room, seat and timer. Node's ESM cache is per-specifier, so there is no re-import.
  2. **Every handler is a closure created inside `io.on("connection")`** (`:1051`), capturing
     `socket`, `userId` and `io`. None is reachable without a real Socket.io server and a real
     connected client — which is why the only coverage is the DB-gated integration suites.
  3. **Env-derived constants are read once at module scope** (`:153-158`), so one process can
     only ever hold one timing configuration. The comment at `:141-146` acknowledges this and
     accepts it because "a test process boots this module a single time".
  `__testables` (`:212-235`) is the existing workaround and it works — but it exposes five
  functions, and `handleGameOver` is not among them.
- **Impact:** `handleGameOver` decides the per-hand scoreboard, whether the *partita* is over,
  who won, whether the target escalates, what goes to `recordGameResult`, `recordRatedResult`
  and `saveReplay`, and whether a bot-majority table is recorded at all
  (`isContestedTable`, `:900-921`). Its only coverage is end-to-end through
  `tests/integration/stats.test.ts` and `tests/integration/ladderAndReplay.test.ts`, which run
  one happy-path table each. Edge cases — a draw at the final target, an escalation, a vacated
  seat's `bot:<seat>` key leaking into `cumulativeScores`, `opponentsFinished` when nobody
  emptied their hand — have no coverage in either mode, and each is a wrong-outcome bug.
- **Repro / proof:** `grep -rn "handleGameOver" tests/` → no hits. `__testables` at `:212-235`
  lists `actingSeat`, `autoMoveForSeat`, `autoMoveForSeatWithFlags`, `readPersistedPlayerMap`,
  `pruneAbandonedGames`, `pruneStaleRooms` — not `handleGameOver`.
- **Proposed fix:** Split the decision from the effects, into the module that already exists as
  `socket.ts`'s tested pure half (`server/onlineGameLogic.ts`, 243 L, covered by
  `tests/onlineGameLogic.test.ts`). Add:
  ```ts
  export function resolveHandEnd(input: {
    state: GameState; playerMap: Record<number, string>;
    cumulativeScores: Record<string, number>; matchTarget: number;
    matchLength: MatchLength; gameMode: GameMode;
    handFlags: Record<number, { bomb: boolean; joker: boolean }>;
  }): {
    handByKey: Record<string, number>; cumulativeScores: Record<string, number>;
    matchOver: boolean; matchTarget: number; matchWinners: string[]; isDraw: boolean;
    detailed: …; byName: Record<string, number>; winnerNames: string[];
    gameResults: GameResult[]; recordable: boolean;
  }
  ```
  covering `server/socket.ts:744-818` (scoring, match resolution, `detailed`/`byName`/
  `winnerNames`) and `:862-898` (`gameResults` shaping and the `isContestedTable` gate).
  `handleGameOver` then becomes: call it,
  assign the results onto `game`, emit, persist, and fire the three unawaited writers. Nothing
  moves that touches `io`, the database or a timer.
- **Acceptance criteria:** A new `tests/handEnd.test.ts` (plain `node --test`, no database)
  covering at minimum: free-for-all match resolution at and below target; a tie at the final
  target reported as a draw; an escalation setting the new target; teams resolution on the
  summed pair total; a vacated seat scored under `bot:<seat>` and excluded from
  `cumulativeScores`; `opponentsFinished` when zero, one and all-but-one seats emptied their
  hand; `recordable === false` for a one-human bot table. The two integration suites still pass
  unchanged.
- **Fix risk:** This touches the game-over path, which decides ratings and stats. Land it with
  the integration suites green against a real Postgres before and after, and diff the emitted
  `game:over` payload for an identical input to prove the refactor is behaviour-preserving.
- **Depends on:** None

---

### [TEST-12] Plan the `drizzle-orm` upgrade — it is the one high-severity advisory inside code the production server actually runs
- **Severity:** Medium
- **Confidence:** High (`npm audit --json` this session; read `server/db.ts`, `storage.ts`, `stats.ts`, `ratings.ts`, `replays.ts` for the reachable call shapes)
- **Effort:** M (a few hours)
- **Location:** `package.json:35` (`"drizzle-orm": "^0.39.3"`, installed 0.39.3), `docs/BACKLOG.md` O9
- **Problem:** `npm audit` today reports **31 vulnerabilities: 0 critical, 14 high, 17
  moderate, 0 low** across 1419 packages. `docs/BACKLOG.md` O9 records 30; the count has
  drifted by one. Enumerated by reachability in the *shipped* artifacts (`server_dist/index.js`
  + its runtime imports, and the Metro-built `dist/` web bundle):

  | High advisory | Package | Reachable at runtime? |
  |---|---|---|
  | GHSA-gpj5-g38j-94v9 — SQL injection via improperly escaped SQL identifiers | **drizzle-orm** `<0.45.2` | **Yes — the server imports it on every request** |
  | GHSA-3jxr-9vmj-r5cp, GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895, GHSA-f886-m6hf-6m8v — ReDoS/OOM | brace-expansion `<=1.1.17` | No — reached only through `glob`/`minimatch` in build and lint tooling |
  | GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849 — arbitrary `.map` file read via `sourceMappingURL` | postcss `<=8.5.22` | No — `@expo/metro-config`, build time |
  | GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq — infinite-loop DoS in ICNS/JXL/HEIF parsers | image-size | No — Metro asset pipeline, build time |
  | aggregate advisories | `@expo/cli`, `@expo/metro`, `@expo/metro-config`, `metro`, `metro-config`, `metro-transform-worker`, `expo` | No — bundler/CLI, build time |
  | via `@react-native/community-cli-plugin` → metro | `react-native` | No — the vulnerable component is the dev CLI plugin, not the runtime |
  | via react-native | `@testing-library/react-native` | No — devDependency, test only |

  Note that npm marks `metro`, `postcss` and `image-size` `"dev": false` in the lockfile only
  because `expo` sits in `dependencies`; they are installed on the Replit host but never loaded
  by `server_dist/index.js`, whose import graph is express, socket.io, pg, drizzle-orm, pino,
  helmet, express-session, connect-pg-simple, bcryptjs and zod.

  **Exploitability of the one that is reachable is nil today**: the advisory concerns identifier
  interpolation, and every `sql` template in `server/` interpolates a drizzle column object or a
  bound parameter (`server/stats.ts:88-94`, `server/ratings.ts:57`, `server/replays.ts:14,43`).
  There is no `sql.raw` and no `sql.identifier` anywhere. So this is an upgrade-path finding,
  not a live vulnerability — which is precisely why it should be scheduled rather than treated
  as urgent.
- **Impact:** Left alone, the one advisory in shipped runtime code stays open, and every
  proposed remediation is a major bump: `expo@57` (from 54), `react-native@0.72.17`
  (a **downgrade**, which npm proposes and which must not be taken), `drizzle-kit@0.18.1`
  (also a downgrade). `npm audit fix --force` would wreck this project, which is what O9
  already records.
- **Repro / proof:** `npm audit --json` this session. `npm outdated --json`: `drizzle-orm`
  current 0.39.3, wanted 0.39.3, latest 0.45.2.
- **Proposed fix:** Do the one upgrade that is both narrow and reachable: bump
  `package.json:35` to `"drizzle-orm": "^0.45.2"` and `drizzle-zod` to `^0.8.3` (it pairs with
  drizzle-orm's version), run `npx tsc --noEmit`, `npm test` with `DATABASE_URL` set, and check
  `shared/schema.ts` against drizzle's 0.40–0.45 changelogs (the `pgTable` third-argument
  signature changed from an object to an array in 0.41). Leave the Expo/Metro tree alone —
  those advisories are build-tooling only and `expo@54 → 57` is a separate, owner-sized piece of
  work. Update `docs/BACKLOG.md` O9 with the current count and this reachability table so the
  next reader does not re-derive it.
- **Acceptance criteria:** `npm audit` reports 0 high advisories in packages the server
  imports; `npm test` with `DATABASE_URL` set is green including all 11 integration suites;
  `docs/BACKLOG.md` O9 reflects the post-upgrade count.
- **Fix risk:** drizzle-orm 0.39 → 0.45 crosses the `pgTable` config-argument change and
  `drizzle-zod` 0.7 → 0.8. `shared/schema.ts` and `server/schemaDdl.ts` (which reflects over
  drizzle's table config via `getTableConfig`) both need re-verifying;
  `tests/schemaDdl.test.ts` and `tests/integration/schemaBootstrap.test.ts` are the safety net.
- **Depends on:** [TEST-01]

---

### [TEST-13] Pin `babel-plugin-react-compiler` — the caret on a prerelease lets the compiler float, and the installed build is not the declared one
- **Severity:** Medium
- **Confidence:** High (read `package.json`, `app.json`, `npm outdated --json`)
- **Effort:** S (<1h)
- **Location:** `package.json:84`, `app.json:57-60`
- **Problem:** `"babel-plugin-react-compiler": "^19.0.0-beta-e993439-20250117"`. Under semver a
  caret on a prerelease admits any later prerelease of the same `19.0.0` tuple, so this range
  floats across React Compiler beta builds. `npm outdated` confirms it already has: **installed
  is `19.0.0-beta-ebf51a3-20250411`**, three months newer than the declared build, and `latest`
  is now the stable `1.0.0`. `app.json:57-60` sets `"experiments": { "reactCompiler": true }`,
  so this plugin rewrites every component in the app.
- **Impact:** `CLAUDE.md`'s Known Pitfalls already records this compiler miscompiling
  `useEffect` references in this codebase ("if you see `useEffect doesn't exist`, check compiler
  output"). `npm ci` uses the lockfile so CI and Replit are consistent today, but any
  `npm install` or `npm update` can move the compiler under the app without a package.json diff
  — and since CI runs no build ([TEST-04]) and the native suite does not compile through Babel's
  production pipeline, the first place a miscompile surfaces is a Replit deploy or a user's
  browser.
- **Repro / proof:** `package.json:84` declares `…-e993439-20250117`;
  `npm outdated --json` reports `"babel-plugin-react-compiler": { "current":
  "19.0.0-beta-ebf51a3-20250411", "wanted": "19.0.0-beta-ebf51a3-20250411", "latest": "1.0.0" }`.
  Declared and installed differ, and `wanted` equals `current`, confirming the range resolves
  past the declared build.
- **Proposed fix:** Two steps, in order. (1) Immediately remove the caret so the manifest states
  what is installed: `"babel-plugin-react-compiler": "19.0.0-beta-ebf51a3-20250411"`. (2)
  Separately, evaluate the stable `1.0.0` — build the web bundle, run the native suite, and
  exercise the game table by hand, because `CLAUDE.md`'s pitfall says this specific plugin has
  broken this specific code before. Do not combine the two changes in one commit.
- **Acceptance criteria:** `npm ls babel-plugin-react-compiler` reports the exact version named
  in `package.json`; `npm outdated` shows `current === wanted`; a clean
  `rm -rf node_modules && npm install` reproduces the same version.
- **Fix risk:** Step (1) is a manifest-only change and cannot break anything. Step (2) is a
  compiler major and must not ship without a real build and a manual pass over an animated game
  table.
- **Depends on:** [TEST-04]

---

### [TEST-14] Run `test:native` in CI — 230 tests covering the only layer that executes `Platform.OS` branches never gate a merge
- **Severity:** Medium
- **Confidence:** High (read `ci.yml`, `jest.config.js`, `docs/TESTING.md`; ran `npx jest`)
- **Effort:** S (<1h)
- **Location:** `.github/workflows/ci.yml:42-77`, `package.json:20`, `jest.config.js:19-21`
- **Problem:** `npm run test:native` is 18 suites / 230 tests (10 files × ios + android
  projects) and completes in 21 s locally with zero external services. It is absent from
  `ci.yml`. `npm run verify` (`package.json:23`) does include it, but `verify` is not what CI
  runs.
- **Impact:** `docs/TESTING.md:75-78` states plainly that this is "the only layer that runs app
  code the way a phone does" — the Playwright suite goes through `react-native-web` and takes
  the *other* side of every `Platform.OS` branch, and it is not in CI either. Unguarded by any
  merge gate today: `hapticsBypass` (no module imports `expo-haptics` directly — the bug that
  made the haptics setting a no-op on eight screens), `a11yCollapse` (one accessible node per
  labelled control, a `CLAUDE.md` invariant), `theme` (`Shadow.*` yields native props, never web
  `boxShadow`), `motionPreference` (the in-app override beats the OS preference in both
  directions), `offlineResume` (a killed match returns with its hand and its exchange),
  `render` (the always-mounted `NotificationBanner`), `sounds` (12 cases over the `expo-audio`
  contract), `resultExchange` (12 cases including the two-joker exception and the
  double-navigation bug). Every one of those is a shipped bug the suite was written to prevent.
- **Repro / proof:** `grep -n "test:native\|jest" .github/workflows/*.yml` → no matches.
  `npx jest` this session: 18 suites, 230 tests, all pass, 21 s.
- **Proposed fix:** Add to the `verify` job in `.github/workflows/ci.yml`, after the Test step
  and before Lint: `- name: Native renderer tests` / `run: npm run test:native`. No services,
  no extra setup — `jest-expo` is already a devDependency and `npm ci` installs it.
  Do **not** add `test:e2e` in the same change: it needs a Docker Postgres, a built web bundle
  and a browser download, and it has its own timing hazard ([TEST-15]).
- **Acceptance criteria:** The CI job runs `test:native` and reports 230 passing tests; breaking
  one assertion in `tests/native/a11yCollapse.test.tsx` on a branch fails the job.
- **Fix risk:** Adds ~30 s of CI. `jest-expo` downloads nothing at run time.
- **Depends on:** [TEST-01]

---

### [TEST-15] Raise the E2E AFK timeout above the card-click budget — the server auto-passes at 5 s while the driver allows 4 s per click
- **Severity:** Medium
- **Confidence:** Medium (arithmetic from the two constants plus the timer semantics read in `server/socket.ts`; Playwright was not run — it is forbidden here)
- **Effort:** S (<1h)
- **Location:** `scripts/e2e-server.mjs:35`, `tests/e2e/helpers/bot.ts:73` and `:177,:261,:330`, `tests/e2e/playwright.config.ts:18` (`retries: 0`), `tests/e2e/playwright.config.ts:41-50`
- **Problem:** `scripts/e2e-server.mjs:35` sets `MURLAN_AFK_TIMEOUT_MS ??= "5000"` for the whole
  E2E run. `playwright.config.ts:41-50` overrides only `MURLAN_DISCONNECT_GRACE_MS`, so the 5 s
  AFK stands. Meanwhile `tests/e2e/helpers/bot.ts:73` sets `CARD_CLICK_TIMEOUT_MS = 4_000` and
  spends it **per click** (`:177`, `:261`, `:330`) — selecting a three-card combination is three
  clicks plus a "Gioca" press.

  The AFK timer is armed the instant it becomes a seat's turn (`server/socket.ts:549`,
  `armTurn` calling `startAfkTimer`) and is cleared only by `clearRoomTimers` on the *next* turn, a
  vacate, or a disconnect (callers at `:300,:311,:613,:657,:1921`). **Selecting a card is
  entirely client-side and never touches the server**, so the whole selection sequence must
  complete inside 5 s or the server auto-passes that seat mid-selection.
- **Impact:** On a fast machine each click is tens of milliseconds and this never fires. On a
  cold or loaded runner — exactly the environment where the suite would land if it were promoted
  to CI — one slow click makes the server pass for the player. The spec then fails somewhere
  downstream with a confusing symptom (the wrong seat on turn, an unexpected `game:notification`
  of type `afk`) rather than at the cause. With `retries: 0` (`playwright.config.ts:18`) that is
  an immediate red build. `retries: 0` is the right call — it exposes flake rather than hiding
  it — which is why this timing margin should be widened instead.
- **Repro / proof:** Read path only; Playwright is forbidden in this audit. The constants are
  `5_000` (`e2e-server.mjs:35`) against `4_000` per click (`bot.ts:73`), and
  `server/socket.ts:612-631` shows nothing resets the timer between turns.
- **Proposed fix:** In `tests/e2e/playwright.config.ts:41-50`, add
  `MURLAN_AFK_TIMEOUT_MS: "30000"` alongside the existing `MURLAN_DISCONNECT_GRACE_MS`, with a
  comment stating the constraint: *the AFK window must exceed the worst-case card-selection
  sequence, which is `CARD_CLICK_TIMEOUT_MS` × the largest combination the driver builds.* No
  spec deliberately tests the AFK auto-pass today (`grep -rn "afk" tests/e2e/*.ts` → no hits),
  so nothing needs the short value. If one is added later, give it its own short-timeout server
  rather than shortening the timer globally.
- **Acceptance criteria:** `npm run test:e2e` passes with the raised value, and
  `tests/e2e/online.spec.ts` in particular shows no `PLAYER_AFK_AUTO_PASS` notification in its
  trace. Confirm the constraint is written down at the point of use.
- **Fix risk:** None to production — this is a test-only environment variable, and the server's
  production default (30 s, `server/socket.ts:153`) is untouched.
- **Depends on:** None

---

### [TEST-16] Reconcile the Node version split, and give `server:build` a `--target`
- **Severity:** Low
- **Confidence:** Medium (read `.replit`, `ci.yml`, `package.json`; the runtime consequence is inferred from esbuild's documented default of "no downlevelling without `--target`")
- **Effort:** S (<1h)
- **Location:** `.github/workflows/ci.yml:52` (`node-version: 24`), `.replit:2` (`modules = ["nodejs-22", …]`), `package.json:12`
- **Problem:** CI tests on Node 24; production runs Node 22. `package.json:12`'s esbuild
  invocation passes no `--target`, and esbuild without one performs no syntax downlevelling —
  it emits whatever the source contains. So any Node-24-only syntax or API used anywhere under
  `server/` typechecks (TypeScript's lib comes from `expo/tsconfig.base`, not from the runtime),
  bundles, passes CI, and throws at boot on Replit.
- **Impact:** Latent rather than live — I found no Node-24-only construct in `server/` today,
  and the deploy would fail loudly at boot rather than misbehave. But it is the one runtime
  nothing tests, and `docs/BACKLOG.md` O5 already flags that Replit boot has been unverified
  since the `reusePort` fix. Note the type-stripping concern is *not* the risk here: production
  runs `node server_dist/index.js`, plain JavaScript, so `node --test`'s TypeScript support is
  irrelevant to the deploy. It does mean `npm test` may behave differently if run on the Replit
  box itself.
- **Repro / proof:** `.replit:2` vs `.github/workflows/ci.yml:52`. `package.json:12` contains
  no `--target` flag.
- **Proposed fix:** Pick one and state it. Either raise `.replit:2` to `nodejs-24` (Replit
  offers it; this removes the split entirely and is the cleaner answer), or add
  `--target=node22` to `server:build` in `package.json:12` and add an `engines` field
  (`"engines": { "node": ">=22" }`) so the constraint is declared rather than implied. Doing
  both is fine. Whichever is chosen, add a line to `CLAUDE.md`'s Replit Constraints naming the
  runtime, since it currently names none.
- **Acceptance criteria:** CI's `node-version` and `.replit`'s module agree, or
  `server:build` carries `--target` matching `.replit`'s module. `node server_dist/index.js`
  boots on the Replit box.
- **Fix risk:** Bumping Replit to Node 22 → 24 changes the production runtime; boot it once
  before deploying. Adding `--target=node22` only constrains output and cannot break a build
  that already works.
- **Depends on:** None

---

### [TEST-17] Correct the test counts in `docs/TESTING.md` — all three are wrong
- **Severity:** Low
- **Confidence:** High (ran both suites this session)
- **Effort:** S (<1h)
- **Location:** `docs/TESTING.md:9` and `docs/TESTING.md:11`
- **Problem:** The layer table states `708 pass (with DATABASE_URL; 664 without)` for `npm test`
  and `228 (114 × ios/android)` for `npm run test:native`. Measured at `b894af4` with no
  `DATABASE_URL`: **672 tests, 670 pass, 2 skipped** — not 664. `npx jest`: **18 suites, 230
  tests** — not 228. The 708 figure cannot be checked here (no Postgres) but is stale by the
  same drift.
- **Impact:** These numbers are the only record of how many tests exist, and `docs/TESTING.md`
  is the file a contributor reads to decide whether their local run is complete. A run showing
  670 against a documented 664 tells them nothing — they cannot distinguish "the doc is stale"
  from "six tests vanished". The file is otherwise unusually careful about being verified
  rather than assumed (`:145` "Verified on the development machine, not assumed"), which makes
  the drift more misleading, not less.
- **Repro / proof:** `npm test` → `ℹ tests 672 / ℹ pass 670 / ℹ skipped 2`.
  `npx jest` → `Tests: 230 passed, 230 total`, `Test Suites: 18 passed`.
- **Proposed fix:** Update `docs/TESTING.md:9` to `670 pass, 2 skipped (without DATABASE_URL)`
  plus the with-database figure re-measured on a machine that has Postgres, and `:11` to
  `230 (115 × ios/android)`. Since these drift on every commit that adds a test, consider
  replacing the exact numbers with the shape ("45 unit files plus 11 integration files";
  "10 suites × 2 platforms") which stays true.
- **Acceptance criteria:** The numbers in `docs/TESTING.md` match a fresh run of each command,
  or have been replaced by counts that do not change per test added.
- **Fix risk:** None.
- **Depends on:** None

---

## Coverage gaps

1. **Playwright, Maestro and all three build commands were not run** — every one writes into
   `dist/`, `server_dist/`, `static-build/`, `tests/e2e/test-results/` or
   `~/.maestro/`, which the read-only rule forbids. So "does the production build pass at
   `b894af4`?" is **unanswered by this audit**, exactly as it is unanswered by CI ([TEST-04]).
   [TEST-05], [TEST-06] and [TEST-15] are all read-path findings for that reason; each names the
   command that would confirm it.
2. **The 11 integration suites did not execute** (no `DATABASE_URL` here). I read every test
   name and the bodies of `gameplay`, `spectator`, `schemaBootstrap` and `auth`, which is what
   [TEST-02] rests on, but I did not observe any of them pass.
3. **No coverage instrumentation was installed** (out of scope by instruction, and it would
   mutate the lockfile). The covered/not-covered claims in [TEST-02], [TEST-09], [TEST-10] and
   [TEST-11] come from symbol-level greps of `tests/` against the exported surface of
   `lib/gameEngine.ts` and `server/`, not from line coverage. That method finds *unreferenced*
   functions reliably; it cannot find a referenced function whose branches are half-tested.
4. **`tests/e2e/playwright-report/` and `tests/e2e/test-results/` are present in the working
   tree** from a previous local run. They are not tracked by git (the working tree is clean apart
   from `audit/2026-08-17/PROMPT.md`), so this is not a finding — noted only because a naive
   `grep -r tests/e2e` hits 90 KB of minified report HTML.
5. **`scripts/bundle-report.mjs` and `docs/BUNDLE.md` were not exercised** — the report needs a
   built bundle. Bundle size is B1's territory in any case.
6. **Replit's install semantics were not verified.** `.replit:82-83` sets
   `NODE_ENV = "production"` for the production environment. Whether that causes Replit's install
   step to omit devDependencies decides whether [TEST-03]'s failure mode 2 is live or theoretical;
   I could not determine it without a deploy. If it does omit them, `esbuild`, `patch-package`
   (the `postinstall` hook) and `drizzle-kit` are all absent at build time and the deploy build
   fails outright — worth the owner checking a deploy log.

## Opinions (non-findings)

- **`test-renderer@^1.2.0` is correct and should stay.** The recon flagged it as an unrelated
  npm package name worth a supply-chain look. It is a **required peer dependency** of
  `@testing-library/react-native@14` — `peerDependencies: { jest, react, react-native,
  "test-renderer": "^1.0.0" }` — authored by the RNTL maintainer (Maciej Jastrzebski, MIT,
  `github.com/mdjastrzebski/test-renderer`) as the React 19 replacement for the deprecated
  `react-test-renderer`. Declaring it directly is the documented install. Not a typosquat, no
  action.
- **Licences are clean.** All 1419 lockfile entries carry a permissive licence or none: 1200
  MIT, 73 ISC, 34 Apache-2.0, 61 BSD, 12 MPL-2.0 (weak, file-level), 9 BlueOak, and single
  entries of Python-2.0, CC-BY-4.0, CC0 and `(BSD-3-Clause OR GPL-2.0)` where the BSD side can
  be taken. No AGPL, no GPL-only. 16 packages declare no licence field. Nothing here needs
  action for a closed-source app; `npx license-checker` would have needed an install and was
  not run.
- **`patches/expo-asset+12.0.13.patch` still applies.** The lockfile pins `expo-asset@12.0.13`,
  the installed copy is 12.0.13, and the patched line is present in
  `node_modules/expo-asset/build/AssetSources.js:39`. The patch carries its own removal
  condition (`TODO: Remove after upgrading to expo 55`) — the one legitimate `TODO` in the repo,
  and it is in a vendored diff rather than in source, so recon's "zero markers" claim stands.
  Note the patch targets a *transitive* version that no manifest pins: `expo: ~54.0.27` lets
  `npm install` (not `npm ci`) move `expo-asset` past 12.0.13, at which point `postinstall` fails
  the install. Pinning `expo-asset` explicitly would remove that fragility; I would not bother
  before the expo 55 upgrade that deletes the patch.
- **`tests/native/hapticsBypass.test.tsx` needs no change.** It is the one source-scanner whose
  file-level granularity is correct: it checks for the *absence* of an import, and an import is
  a file-level fact. Its `scans the whole UI surface` self-check (`:33`) is the right shape.
  Same for `tests/orientation.test.ts`, which does a real brace-matching walk (`:33-58`) instead
  of a regex and is the pattern the other scanners should copy.
- **`npm run verify` omitting lint** (`package.json:23`) is defensible, since CI runs lint
  separately and `expo lint` takes 10 s. I would add it anyway so `verify` means what its name
  says, but this is taste, not a defect.
- **`retries: 0` in `tests/e2e/playwright.config.ts:18` is the right call** and should stay.
  Retries hide flake; zero retries surface it. The problem is not the retry count, it is the 5 s
  AFK margin behind it ([TEST-15]).
- **The integration-skip design is genuinely good** and I want to record that, since it is the
  positive counterexample to [TEST-01]: the skip lets a contributor with no Postgres run
  `npm test`, and `.github/workflows/ci.yml:67-74` makes that skip fatal where it matters. That
  is the correct shape. It just happens to be sitting on a pipe that made the whole step
  advisory.

## Open questions for the human

1. **Does the Replit deployment build install devDependencies?** This decides whether
   [TEST-03]'s second failure mode is live. Check a deploy log for `patch-package` running in
   the `postinstall` phase — if it does not appear, dev deps are being omitted and
   `npm run server:build` is finding `esbuild` by luck.
2. **Is `expo@57` on the roadmap?** Twelve of the fourteen high advisories in [TEST-12] clear
   only with that major, and `patches/expo-asset+12.0.13.patch` deletes itself at expo 55. If it
   is not planned, [TEST-12] shrinks to the single drizzle-orm bump and the rest should be
   recorded as accepted build-tooling risk in `docs/BACKLOG.md` O9 rather than left as an open
   count that drifts each week.
3. **Should the React Compiler stay on a beta?** `app.json:59` enables it, stable `1.0.0` now
   exists, and `CLAUDE.md` records it miscompiling this codebase once already. Moving to 1.0.0
   is an owner-sized decision because it needs a real build and a manual pass over the game
   table ([TEST-13] step 2); pinning the current beta ([TEST-13] step 1) is not.
4. **Is promoting `test:e2e` to CI wanted?** It would need a Postgres service, a Chromium
   download and roughly 15–20 minutes of serial runtime at `workers: 1`. [TEST-15] should land
   first either way. `docs/BACKLOG.md` Q11/Q12 track the Maestro half of the same question and
   are now unblocked (O11 is stale — the push has happened).
