# Issue tracker: GitHub

Issues live in GitHub Issues (`metasito/murlan`); `gh` infers the repo inside a clone. The rules
for taking, claiming, reading and releasing work are `docs/agents/RULES.md` 22–28. This file is
the vocabulary, the recipes, and claiming. Before writing an issue body, a wayfinder operation or
a pull-request triage, read `docs/agents/writing-tickets.md`.

## Labels

`tools/loop/next-ticket.mjs` routes on labels (`routeOf`, `classify`), and only issues opened by
an `OWNER` or `COLLABORATOR` (`TRUSTED_AUTHORS` in `tools/loop/tracker.mjs`, which
also decides whose comments carry a loop marker): anyone else's goes to the owner whatever it
carries. Their comments reach an agent through no read here: the picker, rule 25's command and
every `tools/loop/brief.mjs` brief keep only those authors' (`tests/tooling/issueReadsAreTrusted.test.ts`).

| Label | Means | Picker |
|---|---|---|
| `ready-for-agent` | Specified; every decision is made | route `implement` |
| `needs-triage`, or no label at all | Not yet a ticket | route `triage` |
| `wayfinder:research` / `prototype` / `grilling` / `task` | A child of a wayfinder map | route `wayfinder` |
| `wayfinder:map` | The map issue itself | never routed |
| `ready-for-human` / `needs-info` / `rejected` | The owner's; wins over `ready-for-agent`. `rejected` stays open (`docs/BRIEF.md`) | owner |
| `deferred` | Decided against for now; the owner can lift it. Wins over `ready-for-agent` | owner, never named as waiting |
| `in-progress` | Claimed | skipped, unless *stranded* (below) |
| `blocked` | Ready and approved, but waiting on something external — a dead CI, an unreleased dependency | skipped |
| `size:XS` … `size:XL` | A promise about the diff; the supervisor sets the session's turn budget from it | — |
| `loop` | The loop's own machinery: `tools/loop`, the supervisor, its guards | — |
| `main-red` | Filed by the supervisor when main's CI is red (`tools/loop/mainHealth.ts`); closed by the same module once a later `ci.yml` run on main is green | ranked first |
| `ci-flake` | A test that fails CI intermittently; the owner's to add, never a loop session's (`tools/loop/guard-bash.mjs` refuses it). The supervisor never reruns a red: it reaches a fix round, where a flake is fixed at its source (rule 53) | ranked with `main-red` |
| `soak` | Filed by the nightly soak (`.github/workflows/soak.yml`), one open per title (`tools/ci/report-to-tracker.sh`) | — |
| `device-run` | Filed by a red scheduled `ios.yml` or `maestro.yml` run (`tools/ci/report-to-tracker.sh`), one open per workflow; closed by hand once diagnosed | — |
| `mutation` | Filed by the weekly mutation run (`.github/workflows/mutation.yml`): one open issue, "Mutation testing: surviving mutants", commented on each week with every file's score and every survivor (`tools/ci/report-to-tracker.sh`) | owner |
| `gauntlet` | A piece in a gauntlet round, critiqued blind against a named bar | — |
| `parity` | Filed by a red nightly mockup-parity run (`.github/workflows/parity-nightly.yml`), one open issue, commented on each red night | owner |
| `noticed` | One open issue collecting the small defects a session saw outside its ticket, one comment each; the owner promotes what matters | owner |

The **Launch** milestone holds what v1 needs, and only the owner adds to it. The picker takes its
issues before any other `ready-for-agent`. An issue a session files is never `ready-for-agent`:
the owner decides whether it is work.

- **`blocked` sits alongside `ready-for-agent`, never instead of it.** That label carries a
  decision the owner already made, and removing it to stop the picker is how the decision is lost.
  Take `blocked` off when the dependency returns, and say so on the issue.
- **Blocking between issues lives only in GitHub's native dependencies** — the picker gates on
  `issue_dependencies_summary.blocked_by`, and nothing else encodes it. A blocker stated in prose
  on the *other* issue is invisible to it (rule 22).

## Recipes

Every multi-line body goes through `--body-file` (the shell contract, `docs/agents/checks.md`).

```sh
# Read one issue or pull request: rule 25's command.
node tools/loop/tracker.mjs read <n>
node tools/loop/tracker.mjs list --label <label>              # JSON: number, title
node tools/loop/tracker.mjs create --title "<title>" --body-file <file> --label <label> --label size:<size>
node tools/loop/tracker.mjs comment <n> --body-file <file>
node tools/loop/tracker.mjs label <n> --add <label> --remove <label>
node tools/loop/tracker.mjs close <n> --comment "<why>"

# <db-id> is the database id — gh api repos/{owner}/{repo}/issues/<n> --jq .id — never #<n> or node_id
gh api -X POST repos/{owner}/{repo}/issues/<n>/dependencies/blocked_by -F issue_id=<blocker-db-id>
gh api repos/{owner}/{repo}/issues/<n> --jq .issue_dependencies_summary.blocked_by   # open blockers
gh api -X POST repos/{owner}/{repo}/issues/<map>/sub_issues -F sub_issue_id=<child-db-id>
```

When a skill says **"publish to the issue tracker"**, create an issue. When it says **"fetch the
relevant ticket"**, run rule 25's read — title, body and thread together.

## Picking and claiming

The standard way to work an `implement` route is **`/queue`** (`.claude/commands/queue.md`): it
claims, builds in a worktree, has the diff reviewed by readers who did not write it, and hands CI
and the merge to the supervisor. `triage` and `wayfinder` go through `/triage` and `/wayfinder`
(rule 27), which run `mattpocock-skills:triage` and `mattpocock-skills:wayfinder`; those skills own
their procedures, and the command files carry only this repo's specifics.
`mattpocock-skills:implement` is not used: its closing full-suite run contradicts rule 2, so
`/queue` calls `mattpocock-skills:tdd` directly and reviews through `node tools/loop/brief.mjs review`. Nothing in that pack picks a
ticket here: its frontier query drops candidates on assignee, and every session authenticates as
the same GitHub account.

- **Pick** — `node tools/loop/next-ticket.mjs`, the single picker (rule 22); a bare issue number
  inspects that ticket without picking it. Its precedence (implement → triage → wayfinder →
  handoff, *stranded* tickets first) is `tools/loop/next-ticket.mjs`'s, and it prints the route,
  the body, the comments, whether the ticket is takeable and the claim commands when it is. A
  *stranded* ticket is `in-progress` or `ready-for-agent` with an open pull request on its own
  `agent/<n>-` branch and no worktree on this machine.
- **Claim** (rule 22). For `/queue`: `npm run queue:claim -- <n> "<title>"` — `.claude/commands/queue.md`'s
  phase A step 4 covers what it does. For `/triage` and `/wayfinder`: the label and comment the picker
  prints, then re-read the issue (rule 25); stand down for an older claim, per rule 22. The comment
  reads exactly ``Claimed by `<branch>`.`` — the loop parses that shape.
- **Release** (rules 26 and 28). Closing the issue ends the claim. Otherwise remove `in-progress`
  — always when relabelling `ready-for-human`. A leftover `in-progress` hides the ticket from the
  picker for good.
- **Stale claim**: `in-progress`, and the branch in the claim comment has no worktree
  (`git worktree list`) and no open pull request. Say so on the issue, remove `in-progress`, then
  claim it.
- **Abandoned branch**: an `agent/<n>-<slug>` branch on origin, in no worktree, with no open pull
  request — residue of a run that ended without landing. `claim.mjs` builds the next worktree on
  top of a branch of the same name, so either resume it or delete it
  (`git push origin --delete <branch>`), and say which on the issue.
