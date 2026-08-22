# Working loops

Which loop to run for which change, what each one costs, and what it can and cannot see.
Read this **before** starting a change, not after a loop has already lied to you.

## Pick the loop by what you changed

| You changed | Loop | Catches | Cost |
| --- | --- | --- | --- |
| Pure logic (`lib/`, `*Model.ts`, `tableArc.ts`) | `node --test tests/<file>.test.ts` | the maths, the guards | ~1s |
| A component's props or tree | `npx jest tests/native/<file>` | render, memo, hook order | ~8s |
| Anything with a **layout** (flex, absolute, transform) | Playwright | which side of the screen it is on | ~35s |
| Anything **visual** (colour, gradient, shadow, size) | the parity harness below | pixels vs the prototype | ~40s |
| Tokens, contrast, roles | `node --test tests/contrast.test.ts tests/tokenRoles.test.ts tests/cosmetics.test.ts` | AA floors | ~1s |

Full sweeps, for the end of an item only: `npx tsc --noEmit` (~5s) → `npm test` (~12s, 1066) →
`npx jest` (~50s, 527) → `npx eslint components lib tests app` (~25s).
`docs/agents/issue-tracker.md` covers when CI runs instead.

**No unit test can see a layout bug.** `react-test-renderer` never runs flexbox. A green
`npx jest` on a fan rendered off-screen is the normal outcome, not a surprise.

## Editing

Use `Edit`. Never a batched Python/sed rewrite of a `.tsx`: one bad match aborts the script
mid-run and silently discards every edit that preceded it, and you cannot tell from the exit
code which of ten hunks landed. `Edit` fails one hunk at a time, loudly.

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

## React Native Web traps

Each of these compiles, type-checks, passes every native test, and renders nothing on web —
which is the platform this app ships as.

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
