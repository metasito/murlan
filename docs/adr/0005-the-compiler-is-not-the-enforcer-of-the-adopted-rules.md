# ADR-0005 — The React Compiler is not the enforcer of the three rules #891 adopted

**Status:** Accepted
**Date:** 2026-09-14

## Context

`babel-plugin-react-compiler` refuses to compile a component that holds an ESLint suppression
naming one of the rules on its `eslintSuppressionRules` option. The one place this repo could set
it is `babel.config.js`, whose `babel-preset-expo` options are what the preset spreads into the
plugin (`...reactCompilerOptions`, from `platformOptions['react-compiler']`); it passes only
`unstable_transformImportMeta`. `app.json`'s `experiments.reactCompiler: true` travels a different
path — it is the on switch, not an options object. So the plugin's own default of
`react-hooks/exhaustive-deps` and `react-hooks/rules-of-hooks` stands.

The three rules #891 adopted (`react-hooks/set-state-in-effect`, `react-hooks/globals`,
`react-hooks/refs`) are on neither list, so suppressing one of them costs the file nothing at the
compiler. Four comments said the opposite, and #1043 is where that was measured instead of assumed.

Setting `eslintSuppressionRules` to include the three was the alternative the ticket named: it
would make the claim true rather than correcting it.

## Decision

Leave `eslintSuppressionRules` unset, which means leaving `babel.config.js`'s preset options
alone. The gate against a local suppression stands on ESLint
semantics — which rules are on is `eslint.config.js`'s to decide, and a comment must not take one
site out of that — and `tests/ui-rules/reactCompiler.test.ts` derives the compiler's real list by putting
every `eslint-plugin-react-hooks` rule to the compiler rather than naming any.

## Consequences

- The compiler's penalty for a suppression is a bailout, which ships the component unmemoized.
  Widening the list would turn a rule that is already refused by two source scans into a
  production performance cliff for the one case that ever slips past them — a worse outcome than
  the lint error those scans already give, and one nobody would see.
- The prose in `tests/ui-rules/hooksLint.test.ts`, `tests/ui-rules/reactCompiler.test.ts` and `eslint.config.js`
  gives the ESLint reason for refusing a suppression, not the compiler one.
- `CHARGED_FOR` in `tests/ui-rules/reactCompiler.test.ts` is measured, so a plugin release that adds the
  three to its default list reds the suite and brings this decision back up rather than passing
  quietly.
