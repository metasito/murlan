# The target never moves with the code

Rule 52 in `docs/agents/RULES.md`, explained. Read before a change that touches a parity target or
the guard itself. `TARGETS` in `tools/ci/target-freeze.mjs` is the only list of targets. The
invariant: the guard is decided by base-defined code and enforced by the ruleset.
`.github/workflows/target-freeze.yml` runs on `pull_request_target` into `main`, so GitHub runs
main's copy of the workflow and of the script, never the pull request's. A change that loosens the
script, empties the list, edits its test or rewrites the workflow is judged by the list it started
from; its edits take effect only once it has merged. A check inside `ci.yml` cannot do this: on
`pull_request` the head's `ci.yml` runs, and it decides whether any step of it runs at all.

**Nothing of the head runs outside a sandbox.** The job checks out main's tip without persisting its
token, fetches the event's `head.sha` by SHA as git objects (a fork's commits are reachable from the
base repository through `refs/pull/<n>/head`, which can lag the event, and a lag makes the fetch
fail, so the check goes red until the ref catches up; a fetch that fails or lands elsewhere is red),
and runs main's script on `HEAD...<head>` with renames off, so a target moved out of its path still
counts where it was. The head is read through `git diff`, `git ls-tree` and `git show`: no checkout
or install of it, no secret, read-only `contents`, and the pull request's fields reach the shell
through `env:`. The one thing of the head's that runs is its copy of the script, to read its list,
in a Node process under the sandbox below. Running the head's code outside it would be a
pwn-request. `edited` is among its types, so a stack retargeted onto `main` is judged again on its
new base.

**The ruleset makes it binding, and what stays spoofable.** The `main` ruleset routes every change
through a pull request, with no bypass actors. The owner is to require `Target freeze` there once
this workflow has merged; the pull request adding it is not judged by it, since main has no copy
yet. A ruleset's "Require workflows to pass" rule would bind the check to this file on `main`, and
GitHub's docs say it accepts `pull_request_target` workflows, but it exists only in organization
rulesets, and `metasito/murlan` belongs to a user account. So the requirement is a status check,
matched by name, and any workflow's job can report a check of that name: a head's `ci.yml` runs on
`pull_request` and could add a green `Target freeze` of its own. On a mixed pull request the real
check is red from the verdict already, so whether a spoof gets through rests on how GitHub resolves
a red and a green check of one name, which is not measured. Main's script also refuses a head whose
workflows name a job or step `Target freeze` outside this file (`impostors`); that only keeps a
spoof from landing on `main` through a clean pull request, and flags one that carries it. This file
is exempt because editing it is a target change, which a mixed pull request is refused for already.
The scan reads lines, so it misses a name built by an expression, YAML it does not parse (flow
mappings, block scalars, anchors, escapes, a quoted `name` key), and a check run or commit status
posted through the API with `GITHUB_TOKEN`. Moving the repository to an organization with the
workflows rule is what closes this.

A change to the guard (the script, this workflow, its test, CODEOWNERS) is a target change, and
today it lands with no review required.

`tests/tooling/targetFreeze.test.ts` holds `.github/CODEOWNERS` equal to the list and to `JUDGES`
(rule 53's judge, routed to the owner but frozen with nothing), every nightly
spec inside it, no other workflow naming a job `Target freeze`, and the workflow's shape: its
trigger, branches and types, read-only permissions, a checkout of the base, pinned actions, and its
one `run`, verbatim. It plants diffs in a scratch repository and judges them: mixed, target-only
and code-only diffs; a target and the code in separate commits; a rename out of the list; a deleted
nightly spec; the workflow beside code; a target retired in one pull request; an impostor job; a
branch that merges main; a merge ref. It runs the workflow's own `run` from a clone of the base on
a head fetched by SHA: one that tampers the verdict or empties the list, which head's copy passes
and base's refuses; one that merged a newer main; and a SHA it cannot fetch, or none. The
guard is floored: a pattern that names no file in the base turns it red, and so does a base or head
that is missing, cannot be read, shares no merge base or is the same commit. A pattern that names no
file in the head but is still in the head's copy of the list turns it red too, so a pull request
cannot delete a target's last file and keep its pattern; retiring one removes both. The head's
list is not scanned as text: its copy of the script and the files it imports are written to a
scratch directory and evaluated in a Node process under `--permission` with read access to that
directory alone (no write, network, child process or environment), and only the patterns come back.
A head with no script, or one that does not evaluate, is red. `listAt` throws on Node before 25,
where the permission model leaves the network open. A head can still detect the sandbox and export
an empty `TARGETS`; owner review of the script, a target, and the dead-pattern floor turning every
later pull request red are what answer that.

**What it leaves out, on purpose.** These change with the code by design, and freezing them would
make every intended change unlandable:

- `tests/fixtures/tableLayout.json` and `handRow.json` pin the code's own output.
- The polish-audit captures (`tests/e2e/57-polish-audit/captures/`) and `.txt` surveys are
  readings of the app. The captures are written under `AUDIT_UPDATE=1` and never compared. The
  survey is compared, and it is regenerated with every layout change.
- Thresholds that live in unit tests that also judge the app:
  - `tests/ui-rules/lampRig.test.ts`'s 1.2-point mockup-seat tolerance.
  - `tests/ui-rules/cardShadows.test.ts`'s shadow bounds, which are the owner's 2026-11-03 ruling.
- `tests/e2e/pileBeaten.spec.ts` and `reconnect.spec.ts`, which mostly assert app behaviour.
- A threshold written inside app code. The list covers only the files it names.

The measuring helpers (`tableTrace.ts`, `renderCounters.ts`, `virtualClock.ts`) and the measurement
conditions (`phones.ts`, `settle.ts`, `safeArea.ts`, `phoneTable.ts`) are targets, and so is
`cardOnCardCss.ts`, the mockup's card shadow. `targetFreeze.test.ts` follows every import from a
target through the test-side files, targets included, with the TypeScript import scanner (side-
effect, re-export and dynamic imports, `.js` specifiers). Each file it reaches that is not a target
must be in that test's `PLUMBING`, with the reason it measures nothing, and every entry must still
be reached. The test is a target, so widening `PLUMBING` is reviewed as the list is. App files it
reaches stop the walk; each must also be imported by the app, so a threshold written for the specs
alone cannot hide in `lib/`. A guard holds that no file under those roots, test-named ones included,
imports anything under `tests/`. It reads static imports only: a computed dynamic `import(path)`
cannot be seen by any static scan, so the guard is not complete. `lib/e2eTrace.ts` is app code:
`components/` import it for the trace they emit.

Some targets take their values from the app, so a code change moves them without touching the
list:

- `tests/e2e/helpers/lanternDepartures.ts` injects `LIGHT_ABOVE`, `GLIDE`, `LAMP_LIGHT` and
  `lampPools` from `components/table/lampRig.ts`.
- `tests/e2e/helpers/handParity.ts` asserts `HAND_NEAR_RATIO` from `components/cardFaceModel.ts`.

**Landing a target change.** First, open a pull request that touches only targets and cites the
decision. Then open the code pull request, which meets the new target. A pull-request test that
compares the app with the mockup can go red in between: `tests/helpers/lanternFixture.ts`'s
oracles, `pileBeaten.spec.ts`, `reconnect.spec.ts`, and `handParity.spec.ts`, which is itself a
target. If the test that goes red is not a target, the target pull request may mark it
expected-failing, citing the decision, and the code pull request removes the mark. If it is a
target, a third, target-only pull request follows the code pull request. Never move the code and
the target together to dodge this. A ratchet that loosens itself is what rule 52 exists to stop.

**A target helper that imports an app module** (an export's name, the `OfflineSave` shape, a
`testID`) changes in three steps, expand and contract:

1. A code pull request adds the new name beside the old one.
2. A target-only pull request switches the targets to the new name.
3. A code pull request removes the old name.

**CODEOWNERS is routing, not the guard.** It routes target changes to the repository owner, `OWNER`
in the script. The owner also authors the pull requests, so it adds no required review today, and
it binds only under branch protection that requires code-owner review. The script is the guard.
CODEOWNERS is there for a future second reviewer. GitHub silently ignores an entry for an account
without write access, so check it with `gh api repos/metasito/murlan/codeowners/errors`.
