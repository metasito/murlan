# 0017. ESLint 10 without the Expo preset, and TypeScript 7 for `typecheck`

**Status:** Accepted
**Date:** 2026-11-02

## Context

ADR-0015 decision 5 kept two tools a major behind, each "for a reason a later ticket can lift"
(#1923):

- ESLint stayed on 9 "until eslint-config-expo's plugins run on 10". 9.x reached end of life on
  2026-08-06. The preset pulls eslint-plugin-react 7.37.5 and eslint-plugin-import 2.32, which
  both declare ESLint 9 at most. eslint-plugin-react's React version `detect` calls
  `context.getFilename()`, which ESLint 10 removed, so every file crashes the run. Neither plugin
  has released for ESLint 10, and eslint-config-expo 58 still pulls both.
- TypeScript stayed on 6 for every API consumer and for typescript-eslint, which peers
  `typescript <6.1`. A spike was to measure 7 for `npm run typecheck` alone.

The rules the preset enabled that have fired on this repo, from history: `import/first` and
`@typescript-eslint/no-require-imports` (76 sites under `tests/native/`, #84),
`@typescript-eslint/array-type`, `@typescript-eslint/no-unused-vars`,
`import/no-named-as-default`, the `expo/*` env-var rules and the `react-hooks/*` rules. No
`react/*` rule has a recorded hit.

## Decision

1. **ESLint 10, with the preset's rules wired in `eslint.base.cjs`.** Waiting has no end date,
   so the repo drops `eslint-config-expo` and keeps every rule it enabled, at the same level and
   options, rather than only the ones that have fired:
   - `@typescript-eslint/*`, `react-hooks/*` and `expo/*` come from the same plugins as before.
     eslint-plugin-expo's own pinned ESLint 9 is overridden to the root ESLint.
   - The `import/*` rules come from eslint-plugin-import-x, the fork that supports ESLint 10, as
     `import-x/*`. Its node resolver ignores `exports`, as eslint-plugin-import's did.
   - The `react/*` rules stay on eslint-plugin-react, with the React version read from the
     install instead of detected. That is the only call ESLint 10 broke. The plugin stays outside
     its declared peer range, allowed by an `overrides` entry.

   `tests/tooling/eslintBase.test.ts` plants a breach for each `react/*`, `import-x/*` and
   `expo/*` rule, and fails when one is enabled without a plant. Before the switch, every file's
   computed config matched the preset's, and every plant and the full lint gave the same results
   on ESLint 9 with the preset as on ESLint 10 with the base.

2. **minimatch 11 under the ESLint chain.** ESLint 10, `@eslint/config-array`,
   typescript-estree and eslint-plugin-import-x pin minimatch 10, inside GHSA-g3hv-75wg-m249's
   `<11.0.1`. An `overrides` entry gives each of them 11.0.4. They call only `minimatch()`,
   `new Minimatch()` and `.match()`, which 11 keeps. eslint-plugin-react stays on minimatch 3,
   which has no fixed release, so it is the one ESLint package `npm audit` still lists. None of
   its rules that this repo enables calls minimatch.

3. **TypeScript 7 runs `npm run typecheck`, and 6 runs everything else.** 7 is installed as
   `typescript7` (`npm:typescript@~7.0.2`) beside `typescript ~6.0.3`. Measured on this repo,
   with the two compilers interleaved on one 4-core host:

   | | TypeScript 6 | TypeScript 7 |
   |---|---|---|
   | cold, three runs | 76.4 s, 129.2 s, 103.3 s | 31.7 s, 37.8 s, 31.5 s |
   | incremental, three runs | 17.8 s, 25.4 s, 21.0 s | 8.1 s, 8.3 s, 6.5 s |

   That is about 3x cold and 2.6x incremental. Both report nothing on `tsconfig.json`, and the
   same 156 diagnostics on `tsconfig.strictIndexed.json`.

   `typecheck:strict` stays on 6, because `scripts/checkStrictIndexed.mjs` takes its floor from
   the TypeScript 6 API's reading of the config, and 7 has no stable API to read it with. One
   compiler then both reads the config and checks it.

   `tools/loop/tests/incrementalTypecheck.test.ts` now runs its cached-build case against each
   compiler.

## Consequences

- Both packages ship a `tsc` bin; which one `node_modules/.bin/tsc` links to is npm's choice
  (6 after `npm ci` here), and either reports the same. The scripts name their compiler by
  path.
- Expo SDK bumps no longer move the lint rules. A rule the next preset adds is adopted by editing
  `eslint.base.cjs`.
- eslint-plugin-react and the `overrides` entry for it go once a release supports ESLint 10, or
  once a replacement carries the same rules.
- When TypeScript 7.1 ships a stable API and typescript-eslint supports 7, `typescript` itself can
  move, and `typescript7` goes.
