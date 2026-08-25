# Working loops

Which loop to run for which change, what each one costs, and what it can and cannot see.
Read this **before** starting a change, not after a loop has already lied to you.

## Ask which platform the report came from, first

Every loop below except the last runs **Chromium**. The owner tests on **iOS through Expo
Go**. A whole session has been spent fixing a table on web, pixel-matching it to the
prototype, and shipping nothing the reporter could see — because the defect was native-only
and no loop here could reach it.

So before touching a rendering bug, answer in one line: *which renderer produced the
screenshot I am fixing?* Then pick the loop that runs on it. One loop does reach iOS — a
Maestro job on a CI simulator — but it *drives* the app rather than looking at it, so a pixel
still comes back from a capture. The next section is both. Reporting a green web run as a fix
for a native defect is not one of the options.

**What differs between the two renderers is not cosmetic.** `react-native-svg` on native is
a different implementation, not a polyfill:

| Written as | Web (`react-native-svg-web`) | Native (`RadialGradient.tsx` → `extractGradient`) |
| --- | --- | --- |
| `<RadialGradient rx ry>` | ignored — falls back to `r="50%"` | **this is what it reads** (`rx: rx \|\| r`) |
| `<RadialGradient gradientTransform>` | honoured, unit space | user-space matrix — a unit-space `translate(0.5,…)` means nothing |
| `overflow: "clip"` | clips without a scroll box | not a value RN knows |
| `willChange`, `boxShadow` | real | inert |

The portable way to shape a radial is neither: give the **rect** the radii (`2*rx` by
`2*ry`) and let the gradient keep its default `r="50%"`, which is the inscribed ellipse on
both. `tests/vignette.test.ts` pins that no radial shapes itself.

## The iOS loop: a CI simulator, or ask for a capture

`.github/workflows/ios.yml` drives `.maestro/smoke.yaml` and `.maestro/offline-game.yaml`
through Expo Go on a real iOS Simulator, on a free `macos-latest` GitHub runner (#205) — the
same flows `maestro.yml` already runs on Android, with the emulator-only failure classes
(#185, #186) gone because a Simulator is a process on the host rather than a virtualised
device. It is `workflow_dispatch` only until it has been run green twice; read its own header
before assuming it fires on every push or pull request.

That job proves the flows still run and the app still renders *something* on device — it does
not replace looking at the device. A rendering defect like #209 needs a screenshot regardless:
a named list of states, a screen that reaches each of them on the device, and the rule that a
native rendering fix is not claimed until the captures come back.

**The states are `lib/captureStates.ts`.** That list is the contract. `app/capture.tsx` walks it
on the device and `tests/e2e/lampSeats.spec.ts` walks it in Chromium, so a photograph and a web
run are of the same state rather than of two similar ones. Add a state there, not in a spec.

**Reaching one on the device**, in a development build (Expo Go, or any `npx expo start`):
navigate to `/capture`, pick a state, hold the device in landscape. The table is built in
memory and the turn is pinned — `/game` runs the AI turn loop, so a seeded save with the turn
on a bot is a bot's turn for about a second, long enough to navigate to and not to photograph.
The rail's lower knob swings the lamp to the next seat, which is the one state that needs an
input rather than a route.

**What to ask for**, verbatim, so the reply is comparable to the last one:

> On iOS, open `/capture` and send one landscape screenshot of each state in the list:
> `lamp-bottom`, `lamp-right`, `lamp-top`, `lamp-left`, `pile-right`. Name each file after
> the state it is of.

**Reading them.** Sample pixels, do not describe them. #209 is the worked example: measuring
its three captures put the boundary at 117 pt from the lamp on both axes and killed the
hypothesis the ticket had been written around. "The felt looks like it is covering the table"
and "the felt is continuous across the cut, so it is not the occluder" are the same image.

**Until a capture comes back, say so.** A green Playwright run on a native-only defect is not
evidence, and reporting one as a fix is the failure this loop exists to end.

## What a green loop does not mean

Each of these produced a confident, wrong "fixed" in one session:

- **`EXPO_PUBLIC_E2E_FAST=1`** (set by `scripts/e2e-server.mjs` and, unless
  `PARITY_REAL_DELAYS=1`, by `.scratch/parity/static-server.mjs`) sets every AI delay to
  `0`. The bots move instantly, so **no screenshot is ever taken on a bot's turn** — the
  state where the lamp is over someone else and the table is at its darkest. Turn it off to
  look at turn-handover. The one exception is a capture state: `openCaptureState` writes the
  suspend flag (`lib/e2eAiSuspend.ts`), which holds the seeded turn for as long as the page
  lives, and reads as nothing at all in any build that flag did not come from.
- **Metro caches the transform that inlines `process.env.EXPO_PUBLIC_*`.** Flipping that env
  var and rebuilding gives you the *previous* value. `expo export --clear` is what actually
  rebuilds it.
- **One frame is not a state.** Screenshotting a seeded table at the viewer's turn proves
  that one frame. Play real hands (`tests/e2e/helpers/bot.ts` drives one), and sample
  *through* a turn handover, not after it.
- **A piped Playwright run reports the pipe's exit code.** `playwright test … | grep` returns
  grep's status; a red run reads as green. Read the `N passed / N failed` line.
- **Compare pixels, not impressions.** "Looks darker" cost hours; sampling the same relative
  points out of both PNGs found the halved vignette radius in one run.

## Pick the loop by what you changed

| You changed | Loop | Catches | Cost |
| --- | --- | --- | --- |
| Pure logic (`lib/`, `*Model.ts`, `tableArc.ts`) | `node --test tests/<file>.test.ts` | the maths, the guards | ~1s |
| A component's props or tree | `npx jest tests/native/<file>` | render, memo, hook order | ~8s |
| Anything with a **layout** (flex, absolute, transform) | Playwright | which side of the screen it is on | ~35s |
| Anything **visual** (colour, gradient, shadow, size) | the parity harness below | pixels vs the prototype | ~40s |
| Tokens, contrast, roles | `node --test tests/contrast.test.ts tests/tokenRoles.test.ts tests/cosmetics.test.ts` | AA floors | ~1s |
| Anything the app must **boot and stay drivable through on iOS** | `.github/workflows/ios.yml`, dispatched by hand | a crash, a screen that never renders, a control the flows tap going missing — on a real simulator | unmeasured; the job's own ceiling is 75 min |

Full sweeps, for the end of an item only: `npx tsc --noEmit` (~5s) → `npm test` (~12s, 1066) →
`npx jest` (~50s, 527) → `npx eslint components lib tests app` (~25s).
`docs/agents/issue-tracker.md` covers when CI runs instead.

**No unit test can see a layout bug.** `react-test-renderer` never runs flexbox. A green
`npx jest` on a fan rendered off-screen is the normal outcome, not a surprise.

## Editing

Use `Edit`. Never a batched Python/sed rewrite of a `.tsx`: one bad match aborts the script
mid-run and silently discards every edit that preceded it, and you cannot tell from the exit
code which of ten hunks landed. `Edit` fails one hunk at a time, loudly.

## Worktrees

A worktree left behind by a killed, crashed or context-cleared session is not cleaned up by
anything else — `npm run worktrees:prune` (`-- --dry-run` to only see the classification)
after any session that ends without landing, or as a periodic sweep, removes what it can
prove is merged or gone and leaves anything uncommitted or still under an open pull request
alone.

## Local ports

Every port this repo's local tooling binds — including the local-substitute path CLAUDE.md's
"When Actions cannot start" describes when CI can't run:

| Port | For | Owner |
| --- | --- | --- |
| `5000` | The Express server (`PORT`) | `server/index.ts`, `.replit` (`[[ports]]` localPort/externalPort, `[env] PORT`, `waitForPort`), `package.json` (`expo:dev`, `expo:dev:clean`) |
| `8081` | Metro (`npx expo start` / `npm start`) | `scripts/build.js`, `.replit` |
| `5199` | Playwright's e2e webServer (`E2E_PORT`) | `tests/e2e/playwright.config.ts`, `scripts/e2e-server.mjs`, `.claude/workflows/ticket-pipeline.mjs`; freed by `lib/ticketPipeline/cleanup.ts` |
| `55432` | The dev-stack's disposable Postgres (`MURLAN_DEV_PG_PORT`) | `murlan-dev-pg` container — `scripts/dev-stack.mjs`, `scripts/e2e-server.mjs` |
| `55433` | The verify-only Postgres substituted for CI's database | `murlan-verify-pg` container — `.claude/workflows/ticket-pipeline.mjs`, `lib/ticketPipeline/cleanup.ts`; also bound manually by CLAUDE.md's "When Actions cannot start" |
| `5050` | The ticket-pipeline's boot-check server (`BOOT_PORT`) | `murlan-verify-boot` container — `.claude/workflows/ticket-pipeline.mjs`; container and port both freed by `lib/ticketPipeline/cleanup.ts` |

## Playwright, locally

```sh
# first run of a session, or after ANY source change — builds the bundle
npx playwright test --config tests/e2e/playwright.config.ts <spec>
# iterating on the spec only, source untouched
E2E_SKIP_BUILD=1 npx playwright test --config tests/e2e/playwright.config.ts <spec>
```

`E2E_SKIP_BUILD=1` reuses the last bundle. Set it after a source edit and you measure the old
code and it passes.

Reach a table without playing to one: `openSeededGame(page, baseURL, 4)`
(`tests/e2e/helpers/offlineSeed.ts`). Four seats with bots is the worst case for height.

Real safe-area insets on web come from a hidden probe `div` the safe-area-context polyfill
appends to `<body>`. Override it in a spec with
`div[style*="safe-area-inset-left"] { padding-left: Npx !important }`.

Scratch specs go in the **scratchpad dir**, never `tests/e2e/` — that directory is the
suite's contract. Point Playwright at them with `--config` plus an explicit path.

## Visual parity against a prototype

The prototype is the primary source. Read it **once, first**, and extract the numbers; do not
reconstruct it from a summary of itself.

1. `WebFetch` the `claude.ai/code/artifact/<uuid>` URL — it is fetchable and returns the full
   HTML, saved to a local file whose path the result names. `curl` gets an SPA shell or a 403.
2. Copy that file into the scratchpad and screenshot it at the target handset. The prototype
   sets its own size from a `PHONES` table; index 5 is 844×390 notch, inset-x 47, inset-b 21 —
   the same viewport the e2e specs use.
3. Screenshot ours at the same viewport with `openSeededGame`, and diff. Compare images, not
   prose descriptions of images.
4. **Sample both PNGs on the same grid** rather than describing them. Load each into a canvas
   in a throwaway spec and print the pixel at a handful of relative points down each third of
   the frame. A halved gradient radius reads as "hmm, darker" by eye and as
   `104 vs 132` in one line of output.
5. Do it at **every lamp position**, not just the viewer's turn. The prototype exposes them:
   `document.querySelector('#turn button[data-turn="top|left|right|me"]').click()`.

The prototype's own numbers, for the parts most often re-derived wrongly:
felt stops are `FeltGradients.verde` verbatim; the falloff ellipse is `76% 100%` at the lamp
and the vignette `128% 104%` at the felt's centre; the hand is `26/90` of a card below the
safe line with an arc of `radius 2200, step .68w, rise 15`; `Gioca`/`Passa` are
`max(48, 56*s)` square at `radius 14*s`, brass **whenever the turn is yours** and
`rgba(239,234,219,.3)` on `rgba(0,0,0,.3)` when it is not; the opponent's back is
`linear-gradient(155deg, #1E6544, #0A3120)`.

## React Native Web traps

Each of these compiles, type-checks, passes every native test, and renders nothing on web —
which is the platform this app ships as. The table above under *Ask which platform* lists the
ones that run the other way, breaking native while web stays green.

- **`shadowColor` / `shadowOffset` / `shadowOpacity` / `shadowRadius` are inert.**
  react-native-web wants `boxShadow`. Use `makeShadow(color, x, y, opacity, radius, elevation)`
  from `lib/theme.ts`, which emits the right one per platform. The frozen `Shadow.*` map is the
  same helper pre-applied; reach for `makeShadow` directly when the radius scales with the card.
- **`<RadialGradient rx ry>` is ignored.** SVG has no `rx`/`ry` on `radialGradient`;
  react-native-svg passes them through and the browser falls back to `r="50%"`. An elliptical
  radial needs `r` plus a `gradientTransform`.
- **Text is rasterised before transform**, so a scaled container blurs its own label. Scale the
  `fontSize`, never the box.

Confirm any of these by dumping the rendered DOM from a spec
(`page.evaluate(() => el.outerHTML)`) rather than by reasoning about it.
