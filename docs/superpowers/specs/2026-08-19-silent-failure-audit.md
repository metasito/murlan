# Silent-Failure Audit — Specification

**Status:** open · **Raised by:** the owner, 2026-08-19 · **Runs after:** the beta-readiness plan's Task 4b

---

## 1. What this is

The owner's instruction, in their words:

> *"If you can find other issues like this or other hidden wrong implementations, flag them and
> do a research for each to find out the best way to handle it. If update of libraries, node,
> frameworks, test suites, plugins, etc. is needed or gets rid of such problems, feel free to go
> for it. As I said I want no bullshit no workaround."*

This document turns that into a specification: what class of defect to hunt, how a candidate
becomes a finding, what counts as a fix, and what "done" means.

## 2. The defect class

The trigger was this: `app.json` sets `experiments.reactCompiler: true`, every build pays to run
the React Compiler, and **sixteen components silently opted out of it**. Nothing was broken.
Nothing failed. A test existed and passed — while loading a different copy of the compiler than
the one that builds the app.

Generalised, the class is:

> **Something the project has configured, claimed, or tested is not true at runtime, and nothing
> in the repo can tell.**

Four recurring shapes, each with a worked example already found in this codebase:

| Shape | Found example |
|---|---|
| **Configured but inert** — an option is set, the tool ignores it or something downstream undoes it | `experiments.reactCompiler` on, sixteen components opted out by suppressions |
| **Measured against the wrong thing** — a test exists, passes, and is not looking at what ships | `tests/reactCompiler.test.ts` loaded the root `babel-plugin-react-compiler`; the build uses `babel-preset-expo`'s nested copy |
| **A guard that cannot fail** — a check whose failing branch is unreachable | CI's unfailable test step (TEST-01), an unreachable accessibility label (A11Y-01), a duplicate constant the test could not detect (ARCH-02) — `CLAUDE.md` names this as having shipped three times |
| **A suppression standing in for a fix** — a comment or exclusion that silences a signal rather than answering it | fifteen `eslint-disable react-hooks` comments, each of which disabled the React Compiler for its whole file |

**Explicitly out of scope:** ordinary bugs, missing features, style. This audit is only about
things that are *false while appearing true*. A bug that fails loudly belongs in
`docs/BACKLOG.md`, not here.

## 3. Method

**Every finding is measured, never asserted.** The React Compiler finding was worth acting on
because a probe compiled each file with the real plugin and read its error events. A finding
that rests on reading code and reasoning is a *candidate*, not a finding.

For each candidate, in order:

1. **Probe it.** Write the smallest program that answers "is this true at runtime?" and run it.
   Record the command and its real output.
2. **Establish the blast radius.** How many files, screens, users, or code paths? A finding
   affecting one dev-only script is not the same as one affecting every menu screen.
3. **Research the correct handling before choosing one.** Upstream docs, the library's own issue
   tracker and discussions, the framework's release notes, and how comparable apps solve it.
   Cite what you read. *"I think the fix is X"* is not research.
4. **Prefer the fix that removes the class**, in this order:
   1. A version bump — of a library, Node, the framework, a test runner or a plugin — that makes
      the defect structurally impossible.
   2. A code change that removes the cause.
   3. A guard that makes the defect fail loudly next time.
   4. — and there is no fourth. Documenting it is not a fix.
5. **Leave a check behind.** Every fix ships with something that fails if the defect returns, and
   that check is proven able to fail before the work is called done.

## 4. Upgrades are in scope

The owner has authorised upgrading libraries, Node, frameworks, test suites and plugins where
that removes a problem rather than working around it. Two constraints bound it:

- **Expo pins its own dependency versions.** `react-native`, `react-native-reanimated`,
  `react-native-gesture-handler` and friends are pinned by the SDK. Bumping one against the SDK's
  pin is not an upgrade, it is a break. An SDK upgrade is a legitimate proposal; a single pinned
  package moved underneath it is not.
- **The app must still launch from Replit's Run button with no setup**, and production runs
  Node 22 (`.replit` `modules`). An upgrade that needs local tooling or a newer runtime than
  Replit offers is not available.

A proposed upgrade is itself a finding: it states what it removes, what it risks, and what proves
it worked.

## 5. Candidate surfaces

Where to look, and what "measured" means for each. This list is where the hunt starts, not where
it ends.

| # | Surface | The question | How to measure it |
|---|---|---|---|
| S1 | Type suppressions | What does each `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` hide? | Remove it, run `tsc --noEmit`, read the real error |
| S2 | Lint suppressions | Same, per rule — and does the suppression itself cost something (as `react-hooks` did)? | Remove, run `eslint`, and probe any downstream tool that reads the file |
| S3 | TypeScript strictness | Which strict-family flags are off, and what do they let through? | Turn each on, count the errors it surfaces |
| S4 | Tests that cannot fail | Which tests have no assertion, assert a constant, are skipped, or would pass with the code deleted? | Scan for shape, then mutate the code under test and confirm the test goes red |
| S5 | Build configuration | Is every option in `app.json`, `babel.config.js`, `metro.config.js`, `tsconfig.json`, `eas.json` actually read by the tool it targets, and does it take effect? | Probe the tool's real output, not the config file |
| S6 | Test-runner configuration | Do `jest.config.js` and `playwright.config.ts` cover what they claim? Any silently excluded path? | Compare the discovered file set against the files on disk |
| S7 | Dependency drift | Where does the installed version differ from the declared one, or a second copy exist? | `npm ls --all` for duplicates; `npm outdated`; compare declared against resolved |
| S8 | Deprecated APIs | What does the app call that its own dependencies have deprecated? | Build and test with warnings surfaced, not suppressed |
| S9 | Runtime assumptions | Node 22 in production against 24 in CI — what else differs between the two, beyond the syntax `--target` covers? | Enumerate API-level differences used by `server/` |
| S10 | Dead configuration | Which config keys does nothing read any more? | Grep each key against the tool's documented schema for the installed version |

## 6. Acceptance criteria

- Every surface in §5 has been probed, and the probe's real output is recorded — including the
  surfaces that turned up nothing. *"S4 is clean"* without the command and its output is not a
  result.
- Every finding carries: the measurement, the blast radius, the research with sources, the chosen
  fix and why it beat the alternatives, and the check left behind.
- Every check left behind has been proven able to fail, by breaking the thing it guards and
  watching it go red.
- `npm run verify`, `npm run lint`, `npm run test:e2e` and `npm run expo:web:build` all pass at
  the end.
- No finding is closed by documenting it. A finding that cannot be fixed is escalated to the
  owner with the research attached and a recommendation — not filed as accepted.
- Anything genuinely deferred is written into `docs/BACKLOG.md` with what was measured, so the
  next person starts from the evidence rather than from the beginning.

## 7. What "no workaround" rules out, concretely

Stated plainly, because each of these is tempting and each has been reached for in this repo:

- Adding a file to an exclusion list so a check passes.
- Widening a tolerance, a timeout, or a threshold until a flake stops.
- Recording a known-bad state in a constant so a test can assert it.
- A suppression comment with a justifying sentence. **The justifying comment is the tell.**
- Pinning to an old version to avoid dealing with a new one's behaviour.
- Deleting or skipping a test that has started failing honestly.

Where one of these is genuinely the right answer — and it sometimes is — it stops being a
workaround only when it is a recorded decision with the alternatives named and rejected in
writing.
